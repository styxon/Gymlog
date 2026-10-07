import { buildAiCoachPlanSchema } from './aiCoachPlan';
import { exerciseTypeOf, isSpecialtyExercise } from './exerciseClassification';
import { exerciseNameLabel } from './exerciseNameLabel';
import { findGuidedLibraryIndex } from './guidedPlayer';
import { isHoldExerciseName } from './holdExercises';
import { AICoachPlanSchema } from '../types/aiCoachPlan';
import {
  AiPlannerDaysPerWeek,
  AiPlannerEquipment,
  AiPlannerExperience,
  AiPlannerGoal,
  AppPreferences,
  ExerciseLibraryItem,
  SetupFocusArea,
  WorkoutTemplateDraft,
} from '../types/models';

/**
 * "AI assisted" — the programme you describe in your own words.
 *
 * The old branch was a form behind the Pro gate that asked the onboarding
 * questions again (goal, days, level, equipment, recovery) and ran a
 * deterministic composer over the answers. It was not AI and it was not
 * assisted: the reader typed what the app already knew.
 *
 * The rebuild (feedback round 2, #3): ONE text field. "3 päivää, penkki
 * painopisteenä, olkapää kipeä." What the app already knows from onboarding
 * — days, level, equipment, cautions — travels as context without being asked
 * again. This module reads the brief for the signals the composer can act on,
 * lays them over the stored preferences, and composes.
 *
 * Two paths, one contract:
 *  - Preview (the shipped default): the brief is parsed here and the same
 *    deterministic composer the app already trusts builds the week.
 *  - Live: the brief and context go to the coach endpoint and Claude returns
 *    a proposal. Every exercise name it returns is forced through the library
 *    alias matcher; a name that does not resolve is DROPPED and listed, never
 *    shown as if it were a lift. This is the plan composer's own rule
 *    (invented exercise names reached the user once already) applied at the
 *    boundary where the risk actually is.
 *
 * Nothing here is an estimate. The proposal is a week of real library
 * exercises with sets and reps; the reader saves it as a programme of their
 * own — which is what the free-tier cap counts, and is meant to.
 */

export interface ProgrammeBriefSignals {
  daysPerWeek: AiPlannerDaysPerWeek | null;
  /**
   * The number of days the brief actually asked for, before the composer's
   * ceiling. Only set when the two differ.
   *
   * The composer plans at most four sessions, and it used to quietly hand
   * back four while the screen reported "read from your brief: 4 days" — the
   * app putting a number in the reader's mouth that they had not written
   * (user asked for five, 2026-08-26). What the composer can build is a limit
   * worth saying out loud; misquoting the request to hide it is not.
   */
  requestedDaysPerWeek: number | null;
  sessionMinutes: number | null;
  goal: AiPlannerGoal | null;
  equipment: AiPlannerEquipment | null;
  /**
   * Only from a labelled sentence ("Kokemus: 1–3 vuotta"), which is how the
   * frame questions write it (lib/programIntake). Read loosely from free
   * prose, "vuosi" or "years" means too many things to trust.
   */
  experience: AiPlannerExperience | null;
  /** Canonical lift names the brief asked for ("Bench Press"). */
  lifts: string[];
  /** Setup focus areas the brief leans towards ('chest', 'arms'). */
  focusBodyParts: SetupFocusArea[];
  /** Body parts the brief says hurt ('shoulder'); drives the avoid list. */
  cautions: string[];
  /** Name fragments the composer must not pick ("overhead press"). */
  avoidTerms: string[];
}

const LIFT_KEYWORDS: ReadonlyArray<{ pattern: RegExp; lift: string; exclude?: RegExp }> = [
  { pattern: /penkki|penkkipunnerru|bench/i, lift: 'Bench Press' },
  // Plain squat only: goblet, front and split squats are their own lifts, and
  // a brief naming one of those must not be read as a back squat.
  { pattern: /(?:^|[^a-zäö-])(?:taka)?kyykky|(?:back |barbell )?squat/i, lift: 'Back Squat', exclude: /goblet|etukyykky|front|split|bulgarian|askel/i },
  { pattern: /maastave|\bmave\b|deadlift/i, lift: 'Deadlift' },
  { pattern: /pystypunnerru|overhead|\bohp\b|military|olkapääpunnerru|shoulder press/i, lift: 'Overhead Press' },
  { pattern: /kulmasoutu|tankosoutu|barbell row|bent[- ]over row/i, lift: 'Barbell Row' },
  { pattern: /leuanve|leukoja|leuat|pull[- ]?ups?|chin[- ]?ups?/i, lift: 'Pullups' },
  { pattern: /lantionnosto|hip thrust/i, lift: 'Hip Thrust' },
  { pattern: /jalkapr[äa]ssi|leg press/i, lift: 'Leg Press' },
  // "punnerrus" alone is the push-up; "penkkipunnerrus" and "pystypunnerrus"
  // carry their own prefix and are matched above.
  { pattern: /(?:^|[^a-zäö])punnerru|push[- ]?ups?/i, lift: 'Pushups' },
  { pattern: /dipp|\bdips?\b/i, lift: 'Dips - Triceps Version' },
];

const BODY_PART_KEYWORDS: ReadonlyArray<{ pattern: RegExp; part: SetupFocusArea; caution: string; avoid: string[] }> = [
  {
    pattern: /rinta|rinnat|chest|pecs?/i,
    part: 'chest',
    caution: 'chest',
    avoid: ['bench press', 'dips', 'fly'],
  },
  {
    // `lats?\b` had a boundary only at the end, so it matched the tail of any
    // word ending in "lat" — and Finnish "jalat" (legs) is exactly that. Asking
    // for legs flagged the back as well, which then vetoed deadlifts and pulled
    // back-tagged programmes up the match (found 2026-08-26).
    pattern: /selk[äa]|back(?! squat)|\blats?\b/i,
    part: 'back',
    caution: 'back',
    avoid: ['deadlift', 'good morning', 'bent over', 'back extension'],
  },
  {
    pattern: /olkap[äa]|hartia|shoulder|delts?\b/i,
    part: 'shoulders',
    caution: 'shoulder',
    avoid: ['overhead press', 'shoulder press', 'upright row', 'behind the neck', 'dips'],
  },
  {
    pattern: /jala|jalka|reisi|reidet|legs?\b|quads?\b|hamstring/i,
    part: 'legs',
    caution: 'knee',
    avoid: ['jump', 'box jump', 'lunge', 'leg extension'],
  },
  {
    pattern: /polvi|polve|knee/i,
    part: 'legs',
    caution: 'knee',
    avoid: ['jump', 'box jump', 'lunge', 'leg extension', 'pistol'],
  },
  {
    pattern: /pakara|glute|butt/i,
    part: 'glutes',
    caution: 'hip',
    avoid: [],
  },
  {
    pattern: /hauis|bicep|k[äa]det|k[äa]sivar|\barms?\b/i,
    part: 'arms',
    caution: 'elbow',
    avoid: ['skullcrusher', 'close-grip', 'triceps extension'],
  },
  {
    pattern: /ojentaja|tricep/i,
    part: 'arms',
    caution: 'elbow',
    avoid: ['skullcrusher', 'close-grip', 'triceps extension'],
  },
  {
    pattern: /kyyn[äa]rp[äa]|elbow/i,
    part: 'arms',
    caution: 'elbow',
    avoid: ['skullcrusher', 'close-grip', 'triceps extension', 'preacher'],
  },
  {
    pattern: /vatsa|keskivartalo|core|abs\b|abdominal/i,
    part: 'core',
    caution: 'lower back',
    avoid: ['sit-up', 'good morning'],
  },
  {
    pattern: /alasel|lower back|lanne/i,
    part: 'back',
    caution: 'lower back',
    avoid: ['deadlift', 'good morning', 'bent over', 'back extension', 'sit-up'],
  },
];

// "pain" is bounded: Finnish "painopiste" (focus) and "paino" (weight) contain
// it, and a brief that says "penkki painopisteenä" is the opposite of a caution.
const PAIN = /kipe|kipu|s[äa]rke|vamma|(?:^|\s)arka|hurt|(?:^|\s)pain(?:ful|s)?(?=\s|$|[.,!?])|sore|injur|tender|ei kest/i;

const FINNISH_NUMBERS: Record<string, number> = {
  yksi: 1,
  yhden: 1,
  kaksi: 2,
  kahden: 2,
  kahdesti: 2,
  kolme: 3,
  kolmen: 3,
  kolmesti: 3,
  neljä: 4,
  neljän: 4,
  neljästi: 4,
  viisi: 5,
  viiden: 5,
  kuusi: 6,
  one: 1,
  two: 2,
  twice: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/** Sentences, so "olkapää kipeä" only taints the shoulder, not the whole brief. */
function splitSentences(brief: string): string[] {
  return brief
    .split(/[.!?;\n]+|,\s*(?=[^,]*(?:mutta|but)\b)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** What the brief asked for, uncapped — null when it named no number. */
function parseRequestedDays(brief: string): number | null {
  const lower = brief.toLowerCase();
  const numeric = lower.match(/(\d)\s*(?:x|×|krt|kertaa|kerta|pv|päiv|day|d\b|treeni|sessio|session|treenipäiv)/);
  let days: number | null = numeric ? Number(numeric[1]) : null;
  if (days === null) {
    for (const [word, value] of Object.entries(FINNISH_NUMBERS)) {
      // No \b: JavaScript's word boundary is ASCII, and "neljä" ends in a
      // letter it does not know. "kolmesti" / "twice" already mean "times",
      // so they need no unit after them.
      const impliesTimes = word.endsWith('sti') || word === 'twice';
      const wordMatch = new RegExp(
        `(?:^|\\s)${word}(?:\\s*(?:kertaa|krt|päivää|päivä|pv|treeniä|days?|times|sessions?)|${impliesTimes ? '(?=\\s|$)' : '(?!)'})`,
        'i',
      );
      if (wordMatch.test(lower)) {
        days = value;
        break;
      }
    }
  }
  return days;
}

/** The composer plans this many sessions at most. */
const COMPOSER_MAX_DAYS = 4;

function capDays(requested: number | null): AiPlannerDaysPerWeek | null {
  if (requested === null) {
    return null;
  }
  // More days than the composer can lay out become four rather than an
  // invented fifth split — but the screen says so; see requestedDaysPerWeek.
  return Math.max(1, Math.min(COMPOSER_MAX_DAYS, requested)) as AiPlannerDaysPerWeek;
}

function parseMinutes(brief: string): number | null {
  const match = brief.toLowerCase().match(/(\d{2,3})\s*(?:min|minuut)/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes >= 15 && minutes <= 180 ? minutes : null;
}

/**
 * The text after a label such as "Tavoite:", up to the end of its sentence,
 * or null when the brief has no such label.
 *
 * The frame questions write each tapped answer under a label, and the free
 * text the reader adds goes after them. Read across the whole brief, a word
 * in that free text could outrank the tapped answer — the goal and equipment
 * readers below go by keyword priority, not position, so "haluan vahvat
 * jalat" turned a tapped Lihasmassa into strength. A labelled answer is read
 * first, on its own.
 */
function labelledFragment(brief: string, labels: readonly string[]): string | null {
  const match = brief.match(new RegExp(`(?:^|[.!?\\n]\\s*)(?:${labels.join('|')})\\s*:\\s*([^.!?\\n]+)`, 'i'));
  return match ? match[1] : null;
}

function parseGoal(brief: string): AiPlannerGoal | null {
  const labelled = labelledFragment(brief, ['tavoite', 'goal']);
  const fromLabel = labelled === null ? null : readGoal(labelled);
  return fromLabel ?? readGoal(brief);
}

function readGoal(text: string): AiPlannerGoal | null {
  const lower = text.toLowerCase();
  if (/rasva|laihdu|painonpudo|pudottaa|kiinte|fat|lean|cut\b|lose weight/.test(lower)) {
    return 'fat_loss';
  }
  if (/voima|vahv|maksimi|strength|strong|1rm/.test(lower)) {
    return 'strength';
  }
  if (/massa|lihas|kokoa|kasvat|hypertrof|muscle|size|bigger|bulk/.test(lower)) {
    return 'muscle';
  }
  if (/kunto|yleiskunto|jaksa|fitness|conditioning|health|terveys/.test(lower)) {
    return 'fitness';
  }
  return null;
}

function parseEquipment(brief: string): AiPlannerEquipment | null {
  const labelled = labelledFragment(brief, ['paikka', 'where']);
  const fromLabel = labelled === null ? null : readEquipment(labelled);
  return fromLabel ?? readEquipment(brief);
}

function readEquipment(text: string): AiPlannerEquipment | null {
  const lower = text.toLowerCase();
  if (/kehonpaino|ilman välineitä|ei välineitä|bodyweight|no equipment|calisthenic/.test(lower)) {
    return 'bodyweight';
  }
  if (/kuminauh|vastuskumi|band/.test(lower) && !/sali|gym/.test(lower)) {
    return 'minimal';
  }
  if (/kotisali|kotona|home/.test(lower)) {
    return 'home_gym';
  }
  if (/salilla|sali\b|kuntosali|gym/.test(lower)) {
    return 'full_gym';
  }
  return null;
}

function parseExperience(brief: string): AiPlannerExperience | null {
  const labelled = labelledFragment(brief, ['kokemus', 'experience']);
  if (labelled === null) {
    return null;
  }
  // Only the unambiguous forms, read from the start of the fragment. A loose
  // match read "yli vuoden" (more than ONE year) and "en ole kokenut" (not
  // experienced) as advanced, and "discovered" as "over". Anything else is
  // no signal, and the stored level stands.
  const lower = labelled.trim().toLowerCase();
  if (/^(?:alle|under|less than)\s+(?:a\s+|1\s+|yksi\s+|yhden\s+)?(?:vuo|year)/.test(lower)) {
    return 'beginner';
  }
  if (/^1\s*[–—-]\s*3(?:\s|$)/.test(lower)) {
    return 'intermediate';
  }
  if (/^(?:yli|over|more than)\s+(?:3|kolme)\s/.test(lower) || /^3\s*\+/.test(lower)) {
    return 'advanced';
  }
  return null;
}

/**
 * Read the brief. Deterministic, sentence-aware, and deliberately narrow: a
 * word the dictionary does not know is simply not a signal. The composer
 * fills the rest from the stored preferences, so a brief of "3 päivää" is a
 * complete instruction.
 */
export function parseProgrammeBrief(brief: string): ProgrammeBriefSignals {
  const lifts: string[] = [];
  const focusBodyParts: SetupFocusArea[] = [];
  const cautions: string[] = [];
  const avoidTerms: string[] = [];

  for (const sentence of splitSentences(brief)) {
    const painful = PAIN.test(sentence);
    for (const entry of BODY_PART_KEYWORDS) {
      if (!entry.pattern.test(sentence)) {
        continue;
      }
      if (painful) {
        if (!cautions.includes(entry.caution)) {
          cautions.push(entry.caution);
        }
        for (const term of entry.avoid) {
          if (!avoidTerms.includes(term)) {
            avoidTerms.push(term);
          }
        }
      } else if (!focusBodyParts.includes(entry.part)) {
        focusBodyParts.push(entry.part);
      }
    }
    if (!painful) {
      for (const entry of LIFT_KEYWORDS) {
        if (entry.exclude?.test(sentence)) {
          continue;
        }
        if (entry.pattern.test(sentence) && !lifts.includes(entry.lift)) {
          lifts.push(entry.lift);
        }
      }
    }
  }

  // A lift the reader asked for is never also avoided because a body part in
  // another sentence hurts — the explicit ask wins, and the caution stays in
  // the notes for the reader to see.
  const requestedLower = lifts.map((lift) => lift.toLowerCase());
  const filteredAvoid = avoidTerms.filter((term) => !requestedLower.some((lift) => lift.includes(term)));

  const requestedDays = parseRequestedDays(brief);
  const cappedDays = capDays(requestedDays);

  return {
    daysPerWeek: cappedDays,
    // Only when the ask and the answer differ — otherwise the screen would
    // repeat the same number twice.
    requestedDaysPerWeek: requestedDays !== null && requestedDays !== cappedDays ? requestedDays : null,
    sessionMinutes: parseMinutes(brief),
    goal: parseGoal(brief),
    equipment: parseEquipment(brief),
    experience: parseExperience(brief),
    lifts,
    focusBodyParts,
    cautions,
    avoidTerms: filteredAvoid,
  };
}

/** The lift's exact library name, so the composer's substring search hits it and nothing longer. */
function resolveLiftToLibraryName(lift: string, library: ExerciseLibraryItem[]): string | null {
  const index = findGuidedLibraryIndex(lift, library.map((item) => item.name));
  return index === null ? null : library[index].name;
}

/**
 * The brief laid over the stored preferences. Only what the brief actually
 * said is overridden; everything else stays what onboarding recorded.
 */
export function applyBriefToPreferences(
  preferences: AppPreferences,
  signals: ProgrammeBriefSignals,
  library: ExerciseLibraryItem[],
): AppPreferences {
  const mustInclude = signals.lifts
    .map((lift) => resolveLiftToLibraryName(lift, library))
    .filter((name): name is string => Boolean(name));
  const focus = signals.focusBodyParts[0];
  return {
    ...preferences,
    aiPlannerGoal: signals.goal ?? preferences.aiPlannerGoal,
    aiPlannerDaysPerWeek: signals.daysPerWeek ?? preferences.aiPlannerDaysPerWeek,
    aiPlannerSessionMinutes: signals.sessionMinutes ?? preferences.aiPlannerSessionMinutes,
    aiPlannerEquipment: signals.equipment ?? preferences.aiPlannerEquipment,
    aiPlannerExperience: signals.experience ?? preferences.aiPlannerExperience,
    aiPlannerMustInclude: mustInclude.join(', '),
    aiPlannerAvoid: signals.avoidTerms.join(', '),
    aiPlannerLimitations: signals.cautions.join(', '),
    setupFocusAreas: focus ? [focus] : preferences.setupFocusAreas,
  };
}

export interface ProposedExercise {
  name: string;
  libraryItemId: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  /**
   * Whether the lift is in the progression ("Ei seurannassa" when not). Stored
   * as the programme's `trackedDefault`, which decides for every lift the
   * library does not call compound (customWorkoutAdapter). The saved
   * programme wrote a flat false here, and that only went unnoticed while the
   * library filed every curl and raise as compound; with the category
   * following the source mechanic (2026-10-06), a coach's curl day would have
   * had no lift in the trend. See `liveExerciseTracked` and `planToProposal`.
   */
  tracked: boolean;
}

export interface ProposedSession {
  name: string;
  focus: string;
  exercises: ProposedExercise[];
}

export interface ProgrammeProposal {
  source: 'preview' | 'live';
  title: string;
  sessions: ProposedSession[];
  signals: ProgrammeBriefSignals;
  /** Lifts the brief asked for that the week could not fit. Shown, not hidden. */
  unmetLifts: string[];
  /** Live only: names the model returned that resolve to nothing. Dropped, and shown. */
  unresolvedNames: string[];
  /** Live only: specialty movements the model put in that the brief did not ask for. Dropped, and shown. */
  specialtyLeftOut?: string[];
}

/**
 * Whether the brief asks for this specialty movement: by its name in either
 * language, or for specialty / strongman work as such. "Missään ohjelmassa ei
 * saa olla erikoisliikkeitä, eikä AI saa ehdottaa niitä ellei käyttäjä
 * erikseen kysy" (user, 2026-10-06).
 */
export function briefAsksForSpecialty(brief: string, item: Pick<ExerciseLibraryItem, 'name'>): boolean {
  const text = brief.toLowerCase();
  if (asksFor(text, /strongman|erikoisliik|specialty|special lifts/g)) {
    return true;
  }
  return [item.name, exerciseNameLabel('fi', item.name)].some((name) =>
    asksFor(text, new RegExp(escapeRegExp(name.toLowerCase()), 'g')),
  );
}

/** Words that, a few words before a mention in the same clause, refuse it: "ei erikoisliikkeitä", "no strongman". */
const REFUSAL_WORDS = new Set([
  'ei', 'eikä', 'en', 'älä', 'ilman', 'paitsi',
  'no', 'not', 'without', 'avoid', 'never', 'skip', 'except', "don't", 'dont',
]);

/**
 * Words that turn a clause round, so a refusal before them does not reach
 * past them: "ei koneita vaan strongman" asks for strongman — the usual
 * Finnish way to — and so does "no machines but strongman" (CI review of
 * #332, 2026-10-07). Not "ja" / "and": "ilman koneita ja strongmania" refuses
 * both.
 */
const CONTRAST_WORDS = new Set(['vaan', 'mutta', 'but', 'instead', 'rather']);

/** Whether some mention matched by `pattern` is not refused by a word just before it. */
function asksFor(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const clause = text.slice(0, match.index).split(/[.,;:!?\n]/).pop() ?? '';
    const words = clause.split(/\s+/).filter(Boolean);
    const turn = words.reduce((last, word, index) => (CONTRAST_WORDS.has(word) ? index : last), -1);
    const before = words.slice(turn + 1).slice(-3);
    if (!before.some((word) => REFUSAL_WORDS.has(word.replace(/[’']/g, "'")))) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function planToProposal(
  plan: AICoachPlanSchema,
  signals: ProgrammeBriefSignals,
  library: ExerciseLibraryItem[],
  source: 'preview' | 'live',
): ProgrammeProposal {
  const sessions: ProposedSession[] = plan.sessions.map((session) => ({
    name: session.name,
    focus: session.focus,
    exercises: session.exercises
      .filter((exercise): exercise is typeof exercise & { libraryItemId: string } => Boolean(exercise.libraryItemId))
      .map((exercise) => ({
        name: exercise.name,
        libraryItemId: exercise.libraryItemId,
        sets: exercise.sets,
        repsMin: exercise.repsMin,
        repsMax: exercise.repsMax,
        restSeconds: exercise.restSeconds,
        // The plan's own answer: its warm-ups and accessory slots are out of
        // the trend, its primary and secondary lifts are in it.
        tracked: exercise.tracked,
      })),
  }));
  const includedIds = new Set(sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryItemId)));
  const unmetLifts = signals.lifts.filter((lift) => {
    const name = resolveLiftToLibraryName(lift, library);
    const item = name ? library.find((entry) => entry.name === name) : null;
    return !item || !includedIds.has(item.id);
  });
  return { source, title: plan.title, sessions, signals, unmetLifts, unresolvedNames: [] };
}

/** The preview path: parse here, compose with the deterministic composer. */
export function composeProgrammePreview(
  brief: string,
  preferences: AppPreferences,
  library: ExerciseLibraryItem[],
): ProgrammeProposal {
  const signals = parseProgrammeBrief(brief);
  const overlaid = applyBriefToPreferences(preferences, signals, library);
  const plan = buildAiCoachPlanSchema(overlaid, library);
  return planToProposal(plan, signals, library, 'preview');
}

/** What the live endpoint is asked to return — names, not ids; the client resolves. */
export interface LiveProgrammeProposal {
  title: string;
  sessions: Array<{
    name: string;
    focus?: string;
    exercises: Array<{ name: string; sets: number; repsMin: number; repsMax: number; restSeconds?: number }>;
  }>;
}

/**
 * The sweep. Every name the model returned goes through the library alias
 * matcher; what does not resolve is dropped and listed. A session left with
 * no exercises is dropped too — an empty day is not a day.
 */
export function resolveLiveProposal(
  raw: LiveProgrammeProposal,
  brief: string,
  library: ExerciseLibraryItem[],
  defaultRestSeconds: number,
): ProgrammeProposal {
  const names = library.map((item) => item.name);
  const unresolvedNames: string[] = [];
  const specialtyLeftOut: string[] = [];
  const sessions: ProposedSession[] = [];
  for (const session of raw.sessions) {
    const exercises: ProposedExercise[] = [];
    for (const exercise of session.exercises) {
      const index = findGuidedLibraryIndex(exercise.name, names);
      if (index === null) {
        if (!unresolvedNames.includes(exercise.name)) {
          unresolvedNames.push(exercise.name);
        }
        continue;
      }
      const item = library[index];
      if (isSpecialtyExercise(item) && !briefAsksForSpecialty(brief, item)) {
        if (!specialtyLeftOut.includes(item.name)) {
          specialtyLeftOut.push(item.name);
        }
        continue;
      }
      const repsMin = Math.max(1, Math.round(exercise.repsMin || 1));
      exercises.push({
        name: item.name,
        libraryItemId: item.id,
        sets: Math.max(1, Math.min(8, Math.round(exercise.sets || 3))),
        repsMin,
        repsMax: Math.max(repsMin, Math.round(exercise.repsMax || repsMin)),
        restSeconds:
          exercise.restSeconds && exercise.restSeconds > 0 ? Math.round(exercise.restSeconds) : defaultRestSeconds,
        tracked: liveExerciseTracked(item),
      });
    }
    if (exercises.length > 0) {
      sessions.push({ name: session.name, focus: session.focus ?? '', exercises });
    }
  }
  const signals = parseProgrammeBrief(brief);
  const includedIds = new Set(sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryItemId)));
  const unmetLifts = signals.lifts.filter((lift) => {
    const name = resolveLiftToLibraryName(lift, library);
    const item = name ? library.find((entry) => entry.name === name) : null;
    return !item || !includedIds.has(item.id);
  });
  return { source: 'live', title: raw.title.trim() || 'Vinha AI', sessions, signals, unmetLifts, unresolvedNames, specialtyLeftOut };
}

/**
 * The resolved live answer, or the preview composer's week when nothing in
 * the answer resolved. What the discarded answer knew that the composer does
 * not comes with it: the names it could not place, and the specialty
 * movements it was refused — or a card that promises "never silently" lists
 * nothing in exactly the case the list is for (review, 2026-10-07).
 */
export function liveProposalOrPreview(resolved: ProgrammeProposal, preview: () => ProgrammeProposal): ProgrammeProposal {
  if (resolved.sessions.length > 0) {
    return resolved;
  }
  return {
    ...preview(),
    unresolvedNames: resolved.unresolvedNames,
    specialtyLeftOut: resolved.specialtyLeftOut,
  };
}

/**
 * Whether a lift the live coach returned is in the progression.
 *
 * The live answer names lifts and doses, not roles, so the plan cannot say
 * which of its lifts are accessories; the library decides. A strength lift —
 * compound, or an isolation lift such as a curl or a leg curl — is tracked: on
 * a coach's arm day the curl IS the main lift, and before 2026-10-06 every one
 * of them was tracked through the library's old all-compound filing. A
 * stretch, a hold, core and cardio work are not, as they were not then.
 * (The preview composer's plan does name roles; its own `tracked` is used.)
 */
export function liveExerciseTracked(item: ExerciseLibraryItem): boolean {
  if (item.category === 'compound') {
    return true;
  }
  if (isHoldExerciseName(item.name) || exerciseTypeOf(item) === 'stretch') {
    return false;
  }
  return item.category === 'isolation';
}

/**
 * The proposal as a programme of the reader's own. Session names come from
 * the composer in English ("Upper A"); they are stored as-is and localised on
 * display like every other custom session name.
 */
export function buildProgrammeDraft(proposal: ProgrammeProposal, existingNames: readonly string[]): WorkoutTemplateDraft {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  let name = proposal.title.trim() || 'Vinha AI';
  let suffix = 2;
  while (taken.has(name.toLowerCase())) {
    name = `${proposal.title.trim() || 'Vinha AI'} ${suffix}`;
    suffix += 1;
  }
  return {
    name,
    sessions: proposal.sessions.map((session) => ({
      name: session.name,
      exercises: session.exercises.map((exercise) => ({
        name: exercise.name,
        targetSets: exercise.sets,
        repMin: exercise.repsMin,
        repMax: exercise.repsMax,
        restSeconds: exercise.restSeconds,
        // The proposal's own answer — see ProposedExercise.tracked.
        trackedDefault: exercise.tracked === true,
        libraryItemId: exercise.libraryItemId,
      })),
    })),
  };
}

/**
 * The request, laid out.
 *
 * The build offer quoted the brief back as one sentence and asked yes or no.
 * On a five-day request that sentence runs six lines, and the reader could not
 * tell what they were agreeing to — "tähän joku että oikeasti voisi nähdä
 * kokonaisuuden" (#bugs 2026-08-27).
 *
 * This is the REQUEST, not the week. The week is composed after the offer is
 * accepted, and on the live path it comes back from the model — so drawing a
 * week here would be drawing one the build might not produce. What can be
 * shown honestly before anything runs is what the app read from the sentence,
 * which is also the thing worth checking: get the days or the lifts wrong and
 * the whole build is wrong.
 */
export interface ProgrammeBriefOutline {
  /** What the composer will lay out. */
  plannedDays: number | null;
  /**
   * What the brief asked for, when the composer cannot give it. Null when the
   * two agree — saying "you asked for 4, I build 4" is noise.
   */
  requestedDays: number | null;
  sessionMinutes: number | null;
  lifts: string[];
  focusAreas: SetupFocusArea[];
}

export function outlineProgrammeBrief(signals: ProgrammeBriefSignals): ProgrammeBriefOutline {
  return {
    plannedDays: signals.daysPerWeek,
    requestedDays:
      signals.requestedDaysPerWeek !== null && signals.requestedDaysPerWeek !== signals.daysPerWeek
        ? signals.requestedDaysPerWeek
        : null,
    sessionMinutes: signals.sessionMinutes,
    lifts: signals.lifts,
    focusAreas: signals.focusBodyParts,
  };
}

/**
 * Whether there is anything to draw.
 *
 * A brief the parser got nothing out of must not produce an empty box with a
 * heading over it: that reads as the app having understood nothing, which is
 * worse than the sentence on its own.
 */
export function hasProgrammeBriefOutline(outline: ProgrammeBriefOutline): boolean {
  return (
    outline.plannedDays !== null ||
    outline.sessionMinutes !== null ||
    outline.lifts.length > 0 ||
    outline.focusAreas.length > 0
  );
}
