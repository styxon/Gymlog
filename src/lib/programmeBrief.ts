import { buildAiCoachPlanSchema, fitsPlannerEquipment, isAvoidedByPlannerLimits, plannerLimits } from './aiCoachPlan';
import { getCatalogTrackingMode } from './catalogExercisePools';
import { exerciseTypeOf, isSpecialtyExercise } from './exerciseClassification';
import { exerciseNameLabel } from './exerciseNameLabel';
import { getExerciseTemplateDefaults } from './exerciseSuggestions';
import { prescriptionUnitOf } from '../features/workout/workoutTypes';
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

/**
 * `avoid`: the lift as the composer's avoid terms, which it matches inside
 * library names — the library's own words, since "back squat" and "overhead
 * press" are in no name there (Barbell Full Squat, Standing Military Press).
 * The catalog's own words too, since a ready programme is checked against the
 * same list before it is opened in place of the build (briefProgrammeMatch):
 * its squat is "Back Squat".
 */
const LIFT_KEYWORDS: ReadonlyArray<{ pattern: RegExp; lift: string; exclude?: RegExp; avoid: readonly string[] }> = [
  { pattern: /penkki|penkkipunnerru|bench/i, lift: 'Bench Press', avoid: ['bench press'] },
  // Plain squat only: goblet, front and split squats are their own lifts, and
  // a brief naming one of those must not be read as a back squat.
  { pattern: /(?:^|[^a-zäö-])(?:taka)?kyykky|(?:back |barbell )?squat/i, lift: 'Back Squat', avoid: ['barbell squat', 'barbell full squat', 'back squat'], exclude: /goblet|etukyykky|front|split|bulgarian|askel/i },
  { pattern: /maastave|\bmave\b|deadlift/i, lift: 'Deadlift', avoid: ['deadlift'] },
  { pattern: /pystypunnerru|overhead|\bohp\b|military|olkapääpunnerru|shoulder press/i, lift: 'Overhead Press', avoid: ['military press', 'overhead press', 'shoulder press'] },
  { pattern: /kulmasoutu|tankosoutu|barbell row|bent[- ]over row/i, lift: 'Barbell Row', avoid: ['barbell row'] },
  { pattern: /leuanve|leukoja|leuat|pull[- ]?ups?|chin[- ]?ups?/i, lift: 'Pullups', avoid: ['pullup', 'pull-up', 'chin-up'] },
  { pattern: /lantionnosto|hip thrust/i, lift: 'Hip Thrust', avoid: ['hip thrust'] },
  { pattern: /jalkapr[äa]ssi|leg press/i, lift: 'Leg Press', avoid: ['leg press'] },
  // "punnerrus" alone is the push-up; "penkkipunnerrus" and "pystypunnerrus"
  // carry their own prefix and are matched above.
  { pattern: /(?:^|[^a-zäö])punnerru|push[- ]?ups?/i, lift: 'Pushups', avoid: ['pushup', 'push-up'] },
  { pattern: /dipp|\bdips?\b/i, lift: 'Dips - Triceps Version', avoid: ['dips'] },
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
    // The presses overhead by their other names too: a ready programme with
    // "Seated Dumbbell Press" or a thruster was opened for "olkapää kipeä"
    // (bug hunt, 2026-10-07).
    avoid: ['overhead press', 'shoulder press', 'upright row', 'behind the neck', 'dips', 'seated dumbbell press', 'kettlebell seated press', 'arnold', 'push press', 'thruster'],
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

/** "knees are fine", "selkä kunnossa": the body part is named to say it needs nothing. */
const HEALTHY = /(?:^|\s)(?:fine|ok|okay|healthy|kunnossa|terveet?)(?=\s|$|[.,!?])/i;

/**
 * A clause that goes on about the pain before it: "olkapää kipeä, varsinkin
 * penkissä" names the bench as where it hurts, not as a lift to put in.
 */
const PAIN_CONTINUES = /^(?:varsinkin|etenkin|erityisesti|lähinnä|kun|especially|particularly|mostly|when|during|in|with)(?=\s|$)/i;

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

/**
 * The clauses of a sentence. "Polvi kipeä, penkki mukaan" — the intake's own
 * placeholder — is a caution and a request: read as one painful sentence, the
 * bench was dropped, and so was the "ei maastavetoa" after "olkapää kipeä,"
 * (bug hunt, 2026-10-07).
 */
function splitClauses(sentence: string): string[] {
  return sentence
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The words that deny a pain itself: "no shoulder pain", "polvi ei ole kipeä", "knee doesn't hurt". */
const PAIN_NEGATORS = new Set([
  'ei', 'eikä', 'en', 'enkä', 'eivät', 'ilman',
  'no', 'not', 'nor', 'never', 'without', 'nothing', "don't", 'dont', "doesn't", 'doesnt', "isn't", "aren't",
]);

/**
 * Whether the clause denies the pain at `index`. Only a negator that governs
 * the pain does: "I can't squat because my knee hurts", "kyykky ei onnistu
 * koska polvi on kipeä" negate the lift, and read as denying the pain they
 * dropped the knee caution (review, 2026-10-07). The "because" turns the
 * clause (wordsBefore); a negation of a verb ("en pysty", "ei onnistu") or
 * with a lift between ("ei kyykkyä polvi kipeä") is the lift's, not the
 * pain's.
 */
function painDenied(text: string, index: number): boolean {
  const before = wordsBefore(text, index);
  for (let at = before.length - 1; at >= 0; at -= 1) {
    if (!PAIN_NEGATORS.has(before[at])) {
      continue;
    }
    if (TRAILING_REFUSAL_VERBS.has(before[at + 1] ?? '')) {
      return false;
    }
    const between = before.slice(at + 1).join(' ');
    return !LIFT_KEYWORDS.some((entry) => entry.pattern.test(between));
  }
  return false;
}

/**
 * Which clauses say something hurts. A pain word the clause denies is none:
 * "no shoulder pain", "ei polvikipuja", "no injuries". A bare list item takes
 * the pain of the clause it leads into ("polvi, olkapää ja selkä kipeitä"),
 * and a clause that goes on about the pain shares it.
 */
function painfulClauses(clauses: readonly string[]): boolean[] {
  const painful = clauses.map((clause) => {
    const lower = clause.toLowerCase();
    return [...lower.matchAll(new RegExp(PAIN.source, 'gi'))].some((match) => !painDenied(lower, match.index ?? 0));
  });
  for (let index = clauses.length - 2; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (
      !painful[index] &&
      painful[index + 1] &&
      clause.split(/\s+/).length <= 2 &&
      BODY_PART_KEYWORDS.some((entry) => entry.pattern.test(clause))
    ) {
      painful[index] = true;
    }
  }
  for (let index = 1; index < clauses.length; index += 1) {
    if (!painful[index] && painful[index - 1] && PAIN_CONTINUES.test(clauses[index])) {
      painful[index] = true;
    }
  }
  return painful;
}

/** The days a number names, or null when it is no count of days in a week. */
function weekDays(value: string): number | null {
  const days = Number(value);
  return days >= 1 && days <= 7 ? days : null;
}

/** What the brief asked for, uncapped — null when it named no number. */
function parseRequestedDays(brief: string): number | null {
  // "5x5" and "3x10" are sets by reps, not days: read as the first "x", a
  // "5x5 voimaohjelma, 3 päivää viikossa" opened a five-day programme
  // (bug hunt, 2026-10-07).
  const lower = brief.toLowerCase().replace(/\d+\s*[x×]\s*\d+(?![\d\s]*min)/g, ' ');
  // A number with a day or per-week unit outranks a bare "4x" or "3 treeniä"
  // earlier in the brief; two digits, so "12 days" is not read as 2.
  const explicit = /(?:^|\D)(\d{1,2})\s*(?:päiv|pv\b|days?\b|treenipäiv|(?:x|×|krt|kertaa)\s*(?:viikossa|vko|a week|per week|\/\s*(?:vko|wk|week)))/g;
  const loose = /(?:^|\D)(\d{1,2})\s*(?:x|×|krt|kertaa|kerta|pv|päiv|day|d\b|treeni|sessio|session|treenipäiv)/g;
  let days: number | null = null;
  for (const pattern of [explicit, loose]) {
    for (const match of lower.matchAll(pattern)) {
      days = weekDays(match[1]);
      if (days !== null) {
        break;
      }
    }
    if (days !== null) {
      break;
    }
  }
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

/** The goals in the order a brief naming more than one is read. */
const GOAL_KEYWORDS: ReadonlyArray<{ goal: AiPlannerGoal; pattern: RegExp }> = [
  { goal: 'fat_loss', pattern: /rasva|laihdu|painonpudo|pudottaa|kiinte|fat|lean|cut\b|lose weight/g },
  { goal: 'strength', pattern: /voima|vahv|maksimi|strength|strong|1rm/g },
  { goal: 'muscle', pattern: /massa|lihas|kokoa|kasvat|hypertrof|muscle|size|bigger|bulk/g },
  { goal: 'fitness', pattern: /kunto|yleiskunto|jaksa|fitness|conditioning|health|terveys/g },
];

/**
 * A goal the brief names only to rule it out is no goal: "build muscle, not
 * lose weight" was read as fat loss, because that keyword is checked first
 * (bug hunt, 2026-10-07).
 */
function readGoal(text: string): AiPlannerGoal | null {
  const lower = text.toLowerCase();
  return GOAL_KEYWORDS.find((entry) => asksFor(lower, entry.pattern))?.goal ?? null;
}

function parseEquipment(brief: string): AiPlannerEquipment | null {
  const labelled = labelledFragment(brief, ['paikka', 'where']);
  const fromLabel = labelled === null ? null : readEquipment(labelled);
  return fromLabel ?? readEquipment(brief);
}

/**
 * The place as the planner's equipment answer. A place the brief negates is
 * no answer: "no gym access" was read as a full gym. Dumbbells with no bar or
 * gym beside them are the 'minimal' set, not a home gym — the intake's "Koti
 * (käsipainot)" composed a week of barbell lifts, because 'home_gym' carries
 * a barbell (bug hunt, 2026-10-07).
 */
function readEquipment(text: string): AiPlannerEquipment | null {
  const lower = text.toLowerCase();
  // These name the absence themselves, so they are read as written.
  if (
    /ilman välineitä|ei välineitä|no equipment|without equipment/.test(lower) ||
    asksFor(lower, /kehonpaino|bodyweight|calisthenic/g)
  ) {
    return 'bodyweight';
  }
  const gym = asksFor(lower, /salilla|sali\b|kuntosali|gym/g);
  if (asksFor(lower, /kuminauh|vastuskumi|band/g) && !gym) {
    return 'minimal';
  }
  if (
    asksFor(lower, /käsipaino|dumbbell/g) &&
    !gym &&
    !asksFor(lower, /(?:^|\s)(?:levy)?tan[gk]|barbell|rack|teline|kotisali|home gym/g)
  ) {
    return 'minimal';
  }
  if (asksFor(lower, /kotisali|kotona|home/g)) {
    return 'home_gym';
  }
  return gym ? 'full_gym' : null;
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
  const refusedLifts: (typeof LIFT_KEYWORDS)[number][] = [];

  for (const sentence of splitSentences(brief)) {
    const clauses = splitClauses(sentence);
    const painful = painfulClauses(clauses);
    clauses.forEach((clause, index) => {
      const lower = clause.toLowerCase();
      for (const entry of BODY_PART_KEYWORDS) {
        if (!entry.pattern.test(clause)) {
          continue;
        }
        if (painful[index]) {
          if (!cautions.includes(entry.caution)) {
            cautions.push(entry.caution);
          }
          for (const term of entry.avoid) {
            if (!avoidTerms.includes(term)) {
              avoidTerms.push(term);
            }
          }
        } else if (
          // "no leg day", "älä keskity rintaan", "knees are fine" name the
          // part to say it is not the point (bug hunt, 2026-10-07).
          !HEALTHY.test(clause) &&
          asksFor(lower, new RegExp(entry.pattern.source, 'gi')) &&
          !focusBodyParts.includes(entry.part)
        ) {
          focusBodyParts.push(entry.part);
        }
      }
      for (const entry of LIFT_KEYWORDS) {
        if (entry.exclude?.test(clause) || !entry.pattern.test(clause)) {
          continue;
        }
        // "ilman maastavetoa", "no deadlifts", "älä laita leuanvetoja" name
        // the lift to keep it out. Read as a request, the composer forced in
        // the very lift the reader refused (review, 2026-10-07). A lift in a
        // painful clause is where it hurts, never an ask — but "I can't
        // squat because my knee hurts" still refuses it.
        if (asksFor(lower, new RegExp(entry.pattern.source, 'gi'))) {
          if (!painful[index] && !lifts.includes(entry.lift)) {
            lifts.push(entry.lift);
          }
        } else if (!refusedLifts.includes(entry)) {
          refusedLifts.push(entry);
        }
      }
    });
  }
  for (const entry of refusedLifts) {
    if (lifts.includes(entry.lift)) {
      continue;
    }
    for (const term of entry.avoid) {
      if (!avoidTerms.includes(term)) {
        avoidTerms.push(term);
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
  /**
   * Live only: lifts whose name carries a term the brief avoids — a lift it
   * refused, or one that loads the area it says hurts. Dropped, and shown.
   */
  briefLeftOut?: string[];
  /** Live only: lifts that need gear the reader does not have. Dropped, and shown. */
  gearLeftOut?: string[];
}

/**
 * Whether the week on the card is not the whole answer it was built from:
 * something was dropped by the library or the brief. The card then says the
 * check took lifts out instead of reading as a week that passed it whole.
 */
export function proposalLeftSomethingOut(proposal: ProgrammeProposal): boolean {
  return [proposal.unresolvedNames, proposal.specialtyLeftOut, proposal.briefLeftOut, proposal.gearLeftOut].some(
    (list) => (list?.length ?? 0) > 0,
  );
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
  if (
    [item.name, exerciseNameLabel('fi', item.name)].some((name) =>
      asksFor(text, new RegExp(escapeRegExp(name.toLowerCase()), 'g')),
    )
  ) {
    return true;
  }
  const implement = SPECIALTY_IMPLEMENTS[item.name.trim().toLowerCase()];
  return implement ? asksFor(text, new RegExp(implement.source, 'g')) : false;
}

/**
 * The implement each specialty movement is asked for by. The full name alone
 * missed how people write: "atlas stone" (Atlas Stones), "Atlas-kiviä",
 * "tyre flips" (Tire Flip), "yoke carries" (Yoke Walk), "sledgehammer work"
 * — each a request the composer then dropped (review, 2026-10-07). A stem,
 * so the Finnish cases match too ("renkaan", "moukarilla", "tukkia").
 */
const SPECIALTY_IMPLEMENTS: Readonly<Record<string, RegExp>> = {
  'atlas stone trainer': /atlas/,
  'atlas stones': /atlas/,
  'axle deadlift': /\baxle|paksu(?:lla)? tango/,
  'backward drag': /sled drag|reen ?ved|reen ?veto|\bdrags?\b/,
  'bear crawl sled drags': /sled drag|reen ?ved|reen ?veto|\bdrags?\b/,
  'car deadlift': /car deadlift|auton ?nost/,
  'circus bell': /circus|sirkuskuul/,
  "conan's wheel": /conan/,
  crucifix: /crucifix|ristiinpit/,
  'forward drag with press': /sled drag|reen ?ved|reen ?veto|\bdrags?\b/,
  'heavy bag thrust': /heavy bag|nyrkkeilysäk|nyrkkeilysak/,
  'keg load': /\bkegs?\b|tynnyr/,
  'log lift': /\blog (?:lift|press)|tukki|tukin|tukkia/,
  'power stairs': /power stairs|voimaporta/,
  'rickshaw carry': /rickshaw|riksa/,
  'rickshaw deadlift': /rickshaw|riksa/,
  'sandbag load': /sandbag|hiekkasäk|hiekkasak/,
  'sled drag - harness': /sled drag|reen ?ved|reen ?veto|valjai|harness/,
  'sledgehammer swings': /sledgehammer|moukari/,
  'tire flip': /\btires?\b|\btyres?\b|tire flip|tyre flip|rengas|renkaa/,
  'yoke walk': /\byoke/,
};

/**
 * Words that, anywhere before a mention in the same clause, refuse it: "ei
 * erikoisliikkeitä", "no strongman", "I don't want to do deadlifts", "en
 * todellakaan halua tehdä maastavetoa". The last three words were read
 * before, and the "don't" of the longer phrasings fell outside them — the
 * refused lift was put in the week as a main lift (bug hunt, 2026-10-07).
 */
const REFUSAL_WORDS = new Set([
  'ei', 'eikä', 'en', 'enkä', 'eivät', 'älä', 'älkää', 'ilman', 'paitsi', 'inhoan', 'vihaan',
  'vältä', 'vältän', 'välttää', 'välttäisin', 'poista', 'jätä', 'pois',
  'no', 'not', 'nor', 'without', 'avoid', 'avoiding', 'never', 'skip', 'skipping', 'except', 'exclude', 'remove',
  "don't", 'dont', "won't", "can't", 'cant', 'cannot', 'unable', 'nothing', 'hate', 'dislike',
]);

/** A word just after a mention that refuses it: "maastaveto pois", "maastaveto kokonaan pois". */
const TRAILING_REFUSAL_WORDS = new Set(['pois']);

/** The Finnish negation verb, after the mention: "maastavetoa ei saa olla". */
const TRAILING_NEGATORS = new Set(['ei', 'en', 'eivät', 'enkä']);

/**
 * "dippejä en halua", "maastavetoa ei kiitos", "maastaveto ei sovi minulle",
 * "kyykky ei onnistu", "erikoisliikkeet eivät kiinnosta": the refusal after
 * the mention. Not "ole": "kyykky ei ole ongelma" is no refusal.
 */
const TRAILING_REFUSAL_VERBS = new Set([
  'halua', 'haluu', 'kiitos', 'tarvitse', 'saa', 'sovi', 'onnistu', 'käy', 'kiinnosta', 'pysty', 'voi', 'tee', 'jaksa',
]);

/**
 * Words that turn a clause round, so a refusal before them does not reach
 * past them: "ei koneita vaan strongman" asks for strongman — the usual
 * Finnish way to — and so does "no machines but strongman" (CI review of
 * #332, 2026-10-07). Not "ja" / "and" alone: "ilman koneita ja strongmania"
 * refuses both — only when a fresh ask follows it (FRESH_ASK).
 */
const CONTRAST_WORDS = new Set(['vaan', 'mutta', 'but', 'instead', 'rather', 'joten', 'siksi', 'therefore']);

/**
 * "so" turns the clause like "joten" — "I don't have a lot of time so focus
 * on squats" refused the squats it asked for (review, 2026-10-07) — but not
 * right after a refusal, where it is "not so keen on deadlifts".
 */
const SO = 'so';

/**
 * A reason starts a clause of its own: in "I can't squat because my knee
 * hurts" the "can't" is the squat's, and read as reaching the pain it dropped
 * the knee caution (review, 2026-10-07). Not "as" ("no deadlifts as well as
 * squats") and not the postposition "takia", which follows its reason.
 */
const CAUSAL_WORDS = new Set(['because', 'since', 'koska', 'kun', 'sillä']);

/** After "ja" / "and", a new request: "en halua koneita ja haluan maastavetoa". */
const FRESH_ASK = new Set(['haluan', 'lisää', 'pidä', 'i', 'keep', 'add', 'include', 'want', 'focus', 'learn']);

/**
 * An ask verb no refusal governs turns the clause on its own: "I don't have
 * much time I want squats". Governed means a refusal, or an ask verb itself
 * governed, in the two words before it: "don't want", "don't really want",
 * "would not want to learn", "älä lisää".
 */
const ASK_VERBS = new Set(['haluan', 'lisää', 'pidä', 'keep', 'add', 'include', 'want', 'focus', 'learn']);

/** A word as the refusal sets spell it: lower case, one apostrophe, no punctuation round it. */
function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

/** The index of the last word that turns the clause round, -1 for none. */
function lastTurn(words: readonly string[]): number {
  let turn = -1;
  const governedAsks = new Set<number>();
  words.forEach((word, at) => {
    if (ASK_VERBS.has(word)) {
      const from = Math.max(turn + 1, at - 2);
      const governed = words
        .slice(from, at)
        .some((earlier, offset) => REFUSAL_WORDS.has(earlier) || governedAsks.has(from + offset));
      if (governed) {
        governedAsks.add(at);
      } else {
        turn = at;
      }
      return;
    }
    if (
      CONTRAST_WORDS.has(word) ||
      CAUSAL_WORDS.has(word) ||
      (word === SO && !REFUSAL_WORDS.has(words[at - 1] ?? '')) ||
      ((word === 'ja' || word === 'and') && FRESH_ASK.has(words[at + 1] ?? ''))
    ) {
      turn = at;
    }
  });
  return turn;
}

/** The clause's words before `index`, from the last turn on. */
function wordsBefore(text: string, index: number): string[] {
  const clause = text.slice(0, index).split(/[.,;:!?\n]/).pop() ?? '';
  const words = clause.split(/\s+/).map(normalizeWord).filter(Boolean);
  return words.slice(lastTurn(words) + 1);
}

/** The clause's words after `index`, up to the next turn — the rest of the mentioned word left out. */
function wordsAfter(text: string, index: number): string[] {
  const clause = text.slice(index).split(/[.,;:!?\n]/)[0].replace(/^[\p{L}\p{N}-]*/u, '');
  const words = clause.split(/\s+/).map(normalizeWord).filter(Boolean);
  const turn = words.findIndex((word) => CONTRAST_WORDS.has(word) || CAUSAL_WORDS.has(word) || word === SO);
  return turn === -1 ? words : words.slice(0, turn);
}

/**
 * Whether a refusal before `index` in its clause reaches the mention there.
 * "leave" refuses only as "leave out"; "no problem with", "en ole tehnyt",
 * "never done" refuse nothing.
 */
function refusedBefore(text: string, index: number, after: readonly string[] = []): boolean {
  const before = wordsBefore(text, index);
  return before.some((word, at) => {
    const refusal = REFUSAL_WORDS.has(word) || (word === 'leave' && (before[at + 1] === 'out' || after[0] === 'out'));
    return (
      refusal &&
      !NOT_AN_OBJECTION.has(before[at + 1] ?? '') &&
      !(COMPARATIVES.has(before[at + 1] ?? '') && before[at + 2] === 'than') &&
      !before.slice(at + 1).some((later) => NOT_YET_DONE.has(later))
    );
  });
}

/**
 * After a negator and its verb, the lift must stay: "maastaveto ei saa jäädä
 * pois", "penkki ei voi puuttua". Read as "ei saa" + "pois", the very lift
 * the reader insisted on was avoided (review, 2026-10-07).
 */
const MUST_STAY = new Set(['puuttua', 'puutu', 'jäädä', 'jää', 'unohtua', 'unohdu']);

/** Whether the words after a mention refuse it: "maastaveto pois", "penkkiä ei", "bench is not for me". */
function refusedAfter(after: readonly string[]): boolean {
  const negator = after.slice(0, 2).findIndex((word) => TRAILING_NEGATORS.has(word));
  if (negator !== -1 && after.slice(negator + 1, negator + 3).some((word) => MUST_STAY.has(word))) {
    return false;
  }
  // "pois" refuses unless a negation before it turns it round: "kyykky ei jää pois".
  const away = after.slice(0, 3).findIndex((word) => TRAILING_REFUSAL_WORDS.has(word));
  if (away !== -1 && !after.slice(0, away).some((word) => TRAILING_NEGATORS.has(word) || word === 'älä')) {
    return true;
  }
  if (negator !== -1) {
    const verbs = after.slice(negator + 1, negator + 3);
    // A bare clause-final "ei": "Penkkiä ei."
    if (verbs.length === 0 || verbs.some((word) => TRAILING_REFUSAL_VERBS.has(word))) {
      return true;
    }
  }
  // One word of the lift's name may come first: "bench press is not for me".
  return /^(?:[\p{L}-]+\s+)?(?:(?:is|are)\s+)?(?:not|isn't|aren't)\s+for\s+me(?:\s|$)/u.test(after.join(' '));
}

/** Whether some mention matched by `pattern` (global) is not refused in its own clause. */
function asksFor(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const after = wordsAfter(text, index + match[0].length);
    if (!refusedBefore(text, index, after) && !refusedAfter(after)) {
      return true;
    }
  }
  return false;
}

/**
 * The word after a refusal word that turns it into a yes: "no problem with
 * strongman", "ei haittaa", "en pelkää strongmania", "don't mind".
 */
const NOT_AN_OBJECTION = new Set(['problem', 'problems', 'worries', 'mind', 'haittaa', 'pelkää', 'haittais', 'haittaisi', 'ongelmaa']);

/**
 * A refusal word, one of these and "than" is a cap, not a refusal: "no more
 * than 45 minutes with squats" refused the squats (review, 2026-10-07).
 */
const COMPARATIVES = new Set(['more', 'less', 'longer', 'fewer']);

/**
 * A refusal word followed by one of these says what the reader has not done
 * yet, not what they refuse: "en ole tehnyt maastavetoa", "never done
 * deadlifts, want to learn". Read as a refusal, the lift they came to learn
 * was avoided.
 */
const NOT_YET_DONE = new Set(['tehnyt', 'tehny', 'kokeillut', 'kokeillu', 'osaa', 'done', 'tried', 'did']);

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
 *
 * Then the brief, as the preview composer reads it: the brief laid over the
 * stored preferences (applyBriefToPreferences) gives the same avoid terms
 * and gear (aiCoachPlan.plannerLimits). A lift that carries an avoided term
 * or needs gear the reader lacks is dropped and listed — the model is told
 * the same in its prompt, and this is what holds when it does not listen
 * (bug hunt, 2026-10-07: "Ei maastavetoa." kept Barbell Deadlift).
 */
export function resolveLiveProposal(
  raw: LiveProgrammeProposal,
  brief: string,
  library: ExerciseLibraryItem[],
  defaultRestSeconds: number,
  preferences: AppPreferences,
): ProgrammeProposal {
  const names = library.map((item) => item.name);
  const signals = parseProgrammeBrief(brief);
  const limits = plannerLimits(applyBriefToPreferences(preferences, signals, library));
  const unresolvedNames: string[] = [];
  const specialtyLeftOut: string[] = [];
  const briefLeftOut: string[] = [];
  const gearLeftOut: string[] = [];
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
      // The preview composer's own test, on the week the coach wrote.
      const leftOut = isAvoidedByPlannerLimits(item, limits)
        ? briefLeftOut
        : !fitsPlannerEquipment(item, limits)
          ? gearLeftOut
          : null;
      if (leftOut) {
        if (!leftOut.includes(item.name)) {
          leftOut.push(item.name);
        }
        continue;
      }
      const sets = Math.max(1, Math.min(8, Math.round(exercise.sets || 3)));
      const restSeconds =
        exercise.restSeconds && exercise.restSeconds > 0 ? Math.round(exercise.restSeconds) : defaultRestSeconds;
      // The model doses every row in reps, and the player reads a hold's
      // numbers as seconds and a cardio machine's as minutes: Plank 3 x 10-15
      // ran as a 15 s hold and Elliptical Trainer 3 x 10-12 as three 12-minute
      // bouts (re-hunt, 2026-10-07). Those rows take the add sheet's defaults
      // for their unit (getExerciseTemplateDefaults) — a hold keeps the
      // model's sets and rest, a bout of minutes is one bout with no rest.
      const unit = prescriptionUnitOf(getCatalogTrackingMode(item.name));
      if (unit !== 'reps') {
        const dose = getExerciseTemplateDefaults(item, defaultRestSeconds);
        exercises.push({
          name: item.name,
          libraryItemId: item.id,
          sets: unit === 'minutes' ? dose.targetSets : sets,
          repsMin: dose.repMin,
          repsMax: dose.repMax,
          restSeconds: unit === 'minutes' ? dose.restSeconds : restSeconds,
          tracked: liveExerciseTracked(item),
        });
        continue;
      }
      const repsMin = Math.max(1, Math.round(exercise.repsMin || 1));
      exercises.push({
        name: item.name,
        libraryItemId: item.id,
        sets,
        repsMin,
        repsMax: Math.max(repsMin, Math.round(exercise.repsMax || repsMin)),
        restSeconds,
        tracked: liveExerciseTracked(item),
      });
    }
    if (exercises.length > 0) {
      sessions.push({ name: session.name, focus: session.focus ?? '', exercises });
    }
  }
  const includedIds = new Set(sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryItemId)));
  const unmetLifts = signals.lifts.filter((lift) => {
    const name = resolveLiftToLibraryName(lift, library);
    const item = name ? library.find((entry) => entry.name === name) : null;
    return !item || !includedIds.has(item.id);
  });
  return {
    source: 'live',
    title: raw.title.trim() || 'Vinha AI',
    sessions,
    signals,
    unmetLifts,
    unresolvedNames,
    specialtyLeftOut,
    briefLeftOut,
    gearLeftOut,
  };
}

/**
 * The resolved live answer, or the preview composer's week when nothing in
 * the answer resolved. What the discarded answer knew that the composer does
 * not comes with it: the names it could not place, and the specialty
 * movements, avoided lifts and missing gear it was refused — or a card that
 * promises "never silently" lists nothing in exactly the case the list is for
 * (review, 2026-10-07).
 */
export function liveProposalOrPreview(resolved: ProgrammeProposal, preview: () => ProgrammeProposal): ProgrammeProposal {
  if (resolved.sessions.length > 0) {
    return resolved;
  }
  return {
    ...preview(),
    unresolvedNames: resolved.unresolvedNames,
    specialtyLeftOut: resolved.specialtyLeftOut,
    briefLeftOut: resolved.briefLeftOut,
    gearLeftOut: resolved.gearLeftOut,
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
