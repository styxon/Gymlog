import {
  isMinutesTrackingMode,
  isTimedTrackingMode,
  WorkoutRole,
  WorkoutRuntimeTemplate,
  WorkoutTemplateSession,
  WorkoutTemplateV1,
  WorkoutTrackingMode,
} from '../features/workout/workoutTypes';
import { t } from './i18n';
import { ComposedProgramWeek } from './programDayComposer';
import { ProgramInsightSummary } from './programInsights';
import { getRecommendationProgrammeSummary } from './recommendationProgramme';
import { getReadyProgramContent, ReadyProgramContentSection } from './readyProgramContent';
import { buildSessionGuidance, SessionGuidance } from './sessionGuidance';
import type { AppLanguage } from '../types/models';
import { doseUnitSuffix, removeTrailingZeros } from './format';
import { ProgrammeMinutesOptions, readyTemplateCardMinutes } from './programmeMinutes';
import { doseAfterSwap } from './swapDose';

export type ProgramDetailSource = 'ready' | 'custom';

export interface ProgramDetailHighlightItem {
  label: string;
  value: string;
  detail?: string | null;
}

export interface ProgramDetailExerciseItem {
  id: string;
  name: string;
  role: WorkoutRole;
  sets: number;
  /**
   * The numbers behind `prescription`, carried so the day screen can offer a
   * stepper on them. The string is for reading; these are for editing.
   */
  repMin: number;
  repMax: number;
  /** A hold is prescribed in seconds, and its stepper has to say so. */
  timed: boolean;
  /** Steady cardio is prescribed in minutes — "1 × 20 min". */
  minutes: boolean;
  /** How the row is logged, which a swap for today converts from (lib/swapDose). */
  trackingMode: WorkoutTrackingMode;
  prescription: string;
  /** "tauko"-less rest range, e.g. "45–105 s" or "1,5–2,5 min". */
  restLabel: string;
  /** The lower bound in seconds — what the dose sheet's rest stepper edits. */
  restSeconds: number;
  /** Carried so the day view can offer the same swap the session honours. */
  slotId?: string;
  substitutionGroup?: string;
  /**
   * The superset this lift belongs to, so the day view can badge it and say
   * that no rest follows it. The rule is in src/lib/supersetGrouping.ts.
   */
  supersetGroup?: string | null;
}

export interface ProgramDetailSessionItem {
  id: string;
  name: string;
  orderIndex: number;
  exerciseCount: number;
  totalSets: number;
  preview: string;
  guidance: SessionGuidance | null;
  statusLine: string | null;
  exercises: ProgramDetailExerciseItem[];
}

export interface ProgramDetailViewModel {
  id: string;
  source: ProgramDetailSource;
  title: string;
  subtitle: string;
  description: string;
  badges: string[];
  tailoringBadges: string[];
  highlights: ProgramDetailHighlightItem[];
  infoSections: ReadyProgramContentSection[];
  progressionSummary: string | null;
  primaryActionLabel: string;
  sessionActionLabel: string;
  sessions: ProgramDetailSessionItem[];
  /**
   * Training days in the programme's own week — the number the catalog row,
   * the cover and the adoption sheet all state.
   *
   * Stated here rather than derived from `sessions.length` on the screen.
   * The two are kept equal for every ready programme by a guard, because the
   * plan engine pins one session to each training day; when Strength
   * Foundations 5x5 carried daysPerWeek: 3 on two sessions, the page counted
   * sessions and drew a two-day programme under a catalog row that said
   * "3 ×" (#bugs 2026-09-01). One reader of one number, and a guard that
   * keeps the number honest, is how the two stop disagreeing.
   */
  daysPerWeek: number;
}

function titleCase(value: string) {
  return value
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

/**
 * "4 × 3–5", the way a program is written down.
 *
 * It read "4 sets x 3-5 reps", which is two English words on every row of a
 * Finnish screen — and longer than the thing it describes. The design writes
 * it in numbers, which needs no language at all.
 */
function buildPrescription(
  repsMin: number,
  repsMax: number,
  sets: number,
  trackingMode: WorkoutTrackingMode,
) {
  const reps = repsMin === repsMax ? `${repsMin}` : `${repsMin}–${repsMax}`;
  // A hold's numbers are seconds. Without the unit the catalog's own
  // "Plank 3x30-60" read as sixty repetitions; a bike's are minutes.
  return `${sets} × ${reps}${doseUnitSuffix({
    timed: isTimedTrackingMode(trackingMode),
    minutes: isMinutesTrackingMode(trackingMode),
  })}`;
}

/**
 * A day's row as today's swap will start it: the swapped lift's sets and dose
 * (lib/swapDose: its own default once the unit changes), or the row as it is
 * with no swap. The day screen printed the programme's "3 × 8" over a plank
 * that would open on seconds (swap hunt, 2026-10-07).
 */
export function exerciseAfterSessionSwap(
  exercise: ProgramDetailExerciseItem,
  swapName: string | null | undefined,
): Pick<ProgramDetailExerciseItem, 'sets' | 'prescription'> {
  if (!swapName) {
    return { sets: exercise.sets, prescription: exercise.prescription };
  }
  const dose = doseAfterSwap(
    {
      trackingMode: exercise.trackingMode,
      sets: exercise.sets,
      repsMin: exercise.repMin,
      repsMax: exercise.repMax,
      supersetGroup: exercise.supersetGroup ?? null,
    },
    swapName,
  );
  return {
    sets: dose.sets,
    prescription: buildPrescription(dose.repsMin, dose.repsMax, dose.sets, dose.trackingMode),
  };
}

/**
 * "tauko 45–105 s" / "tauko 1,5–2,5 min" — seconds until the minute reads
 * cleaner, matching the design's day view.
 */
function buildRestLabel(minSeconds: number, maxSeconds: number): string {
  const lo = Math.max(0, minSeconds);
  const hi = Math.max(lo, maxSeconds);
  if (hi < 120) {
    return lo === hi ? `${lo} s` : `${lo}–${hi} s`;
  }
  const toMin = (value: number) => {
    const minutes = value / 60;
    return Number.isInteger(minutes) ? `${minutes}` : removeTrailingZeros(Number(minutes.toFixed(1)));
  };
  return lo === hi ? `${toMin(lo)} min` : `${toMin(lo)}–${toMin(hi)} min`;
}

function buildSessionPreview(exercises: Array<{ exerciseName: string }>) {
  return exercises.slice(0, 3).map((exercise) => exercise.exerciseName).join(' | ');
}

function buildSessionItems(
  sessions: WorkoutTemplateSession[],
  sessionStatusById: Record<string, string> = {},
  template?: WorkoutTemplateV1,
  sessionMinutes = 0,
): ProgramDetailSessionItem[] {
  return [...sessions]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((session) => ({
      id: session.id,
      name: session.name,
      orderIndex: session.orderIndex,
      exerciseCount: session.exercises.length,
      preview: buildSessionPreview(session.exercises),
      guidance: template ? buildSessionGuidance(template, session, sessionMinutes) : null,
      statusLine: sessionStatusById[session.id] ?? null,
      totalSets: session.exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
      exercises: session.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.exerciseName,
        role: exercise.role,
        sets: exercise.sets,
        repMin: exercise.repsMin,
        repMax: exercise.repsMax,
        timed: isTimedTrackingMode(exercise.trackingMode),
        minutes: isMinutesTrackingMode(exercise.trackingMode),
        trackingMode: exercise.trackingMode,
        prescription: buildPrescription(exercise.repsMin, exercise.repsMax, exercise.sets, exercise.trackingMode),
        restLabel: buildRestLabel(exercise.restSecondsMin, exercise.restSecondsMax),
        restSeconds: exercise.restSecondsMin,
        slotId: exercise.slotId,
        substitutionGroup: exercise.substitutionGroup,
        supersetGroup: exercise.supersetGroup ?? null,
      })),
    }));
}

/**
 * The session minutes a ready programme's page quotes — the one number for
 * everything on that page that talks about time.
 *
 * The badge read this while the "Why it fits" line summed the catalog's
 * hand-written `estimatedSessionDuration`: Athletic Starter's badge said 35
 * min and its weekly minutes were worked out from 50, and 43 of 68 programmes
 * were 10+ minutes apart the same way (bug hunt, 2026-10-05, B14). The
 * composed week when it is the reader's plan, otherwise the Programs card's
 * own estimate with the same options.
 */
export function readyProgramSessionMinutes(
  template: WorkoutTemplateV1,
  composedWeek?: ComposedProgramWeek | null,
  minutesOptions: ProgrammeMinutesOptions = {},
): number {
  return composedWeek?.sessionMinutes || readyTemplateCardMinutes(template, minutesOptions);
}

export function buildReadyProgramDetail(
  template: WorkoutTemplateV1,
  insights?: ProgramInsightSummary,
  fitExplanation?: string | null,
  tailoringBadges: string[] = [],
  /**
   * The user's composed week for this program, when it is their active plan.
   * The detail must describe the plan they actually run — composed day count
   * and composed sessions — not the raw catalog template (truth-plan rule).
   */
  composedWeek?: ComposedProgramWeek | null,
  /**
   * The reader's language.
   *
   * This was omitted, so every program's summary came back in English and the
   * detail screen could not show it in a Finnish app — the description simply
   * was not rendered, which is a worse fix than passing the argument.
   */
  language: AppLanguage = 'en',
  /**
   * Whether this programme is the one the reader is already running.
   *
   * The button said "Ota ohjelma käyttöön" whatever the state, so opening your
   * own programme offered to adopt it again — and adoption returns early for a
   * programme already active, leaving a button that reads like a decision and
   * does nothing but send you Home.
   */
  isActivePlan = false,
  /** Held, but some other programme is the one Home leads with. */
  isHeldNotLeading = false,
  /**
   * The reader's gear and drill swaps, which decide the warm-up and cool-down
   * and so the minutes — the same options the Programs cards are given, or the
   * card and this page quote two numbers for one programme.
   */
  minutesOptions: ProgrammeMinutesOptions = {},
): ProgramDetailViewModel {
  const goal = titleCase(template.goalType);
  const level = titleCase(template.level);
  const content = getReadyProgramContent(template.id, language);
  const programmeSummary = getRecommendationProgrammeSummary(template.id);
  const composed = composedWeek && composedWeek.sessions.length > 0 ? composedWeek : null;
  const daysPerWeek = composed ? composed.days : template.daysPerWeek;
  const sessionMinutes = readyProgramSessionMinutes(template, composedWeek, minutesOptions);
  const detailSessions: WorkoutTemplateSession[] = composed
    ? composed.sessions.map((session) => ({
        id: session.id,
        name: session.name,
        orderIndex: session.orderIndex,
        exercises: session.exercises,
      }))
    : template.sessions;

  return {
    id: template.id,
    source: 'ready',
    title: template.name,
    subtitle: `${goal} | ${level} | ${daysPerWeek} ${pluralize(daysPerWeek, 'day')} / week`,
    description:
      content?.summary ??
      `${titleCase(template.splitType)} program with ${template.sessions.length} sessions and repeatable progression rules for consistent logging.`,
    badges: [
      goal,
      level,
      `${daysPerWeek} ${pluralize(daysPerWeek, 'day')}`,
      `${sessionMinutes} min`,
    ],
    tailoringBadges,
    highlights: insights?.highlights ?? [],
    infoSections: content
      ? [
          ...(fitExplanation ? [{ kicker: 'Why it fits', body: fitExplanation }] : []),
          { kicker: 'Who it fits', body: content.audience },
          { kicker: 'Equipment', body: content.equipmentProfile },
          { kicker: 'Why it works', body: content.whyItWorks },
        ]
      : fitExplanation
        ? [{ kicker: 'Why it fits', body: fitExplanation }]
        : [],
    progressionSummary: [programmeSummary, template.progressionRules.primary].filter(Boolean).join(' '),
    // Was the hardcoded English "Start first session" — and it never reached a
    // screen, so nothing showed it was untranslated.
    // No "show this on Home" state. A running programme carries the Active
     // switch instead, and the one thing that button did — promoting a held
     // programme to the lead — now follows from training it (user 2026-09-07,
     // "'nayta kodissani' nappi on ihan turha").
    primaryActionLabel: t(
      language,
      isActivePlan || isHeldNotLeading ? 'detail.startNext' : 'detail.adopt',
    ),
    // Home's words, in the reader's language — it was an English literal.
    sessionActionLabel: t(language, 'home.startWorkout'),
    sessions: buildSessionItems(detailSessions, insights?.sessionStatusById, template, sessionMinutes),
    daysPerWeek,
  };
}

/**
 * `language` is not optional here either. Every string this returned was an
 * English literal, and the description is rendered as the lead paragraph of the
 * detail screen — so a Finnish user's OWN program was introduced to them in
 * English, on the screen that exists to describe it.
 */
/**
 * @param isActivePlan whether this program is one of the plans Home reads. The
 *   button used to say "start the first session" whatever the answer, because
 *   adopting a program of your own was not a thing the app could do — so the
 *   one route onto the home screen was the catalog or onboarding, neither of
 *   which knows about a program the reader imported.
 */
export function buildCustomProgramDetail(
  template: WorkoutRuntimeTemplate,
  insights?: ProgramInsightSummary,
  language: AppLanguage = 'en',
  isActivePlan = false,
  /** Held, but some other programme is the one Home leads with. */
  isHeldNotLeading = false,
): ProgramDetailViewModel {
  const sessionCount = template.sessions.length;
  const exerciseCount = template.sessions.reduce((sum, session) => sum + session.exercises.length, 0);
  const hasExercises = exerciseCount > 0;
  const counts = t(language, sessionCount === 1 ? 'prog.custom.countsOne' : 'prog.custom.counts', {
    sessions: sessionCount,
    exercises: exerciseCount,
  });

  return {
    id: template.id,
    source: 'custom',
    title: template.name,
    subtitle: `${t(language, 'prog.custom.badge')} | ${counts}`,
    /*
     * No lead paragraph. It was one fixed sentence on every custom programme
     * — "Rakennettu omista treeneistäsi ja sarjamääristäsi. Avaa muokataksesi
     * tai aloita juuri se treeni, jonka haluat kirjata." — which described
     * none of them and explained tapping a row to somebody already on the
     * page (#bugs 2026-09-05). A ready programme keeps its real description,
     * because a ready programme has one.
     */
    description: '',
    // badges[1] is read as a level slug by the detail screen; a custom program
    // has no level, so it stays a count and simply does not match.
    badges: [t(language, 'prog.custom.badge'), counts],
    tailoringBadges: [],
    highlights: insights?.highlights ?? [],
    infoSections: [],
    progressionSummary: null,
    primaryActionLabel: t(
      language,
      !hasExercises
        ? 'prog.custom.detail.editTemplate'
        : isActivePlan || isHeldNotLeading
          ? 'detail.startNext'
          : 'detail.adopt',
    ),
    sessionActionLabel: t(language, hasExercises ? 'prog.custom.detail.startSession' : 'prog.custom.detail.openSession'),
    sessions: buildSessionItems(template.sessions, insights?.sessionStatusById),
    // A custom programme names no day count of its own: one session per
    // training day is the only shape the editor can build.
    daysPerWeek: sessionCount,
  };
}

export function buildReadySessionRuntimeTemplate(template: WorkoutTemplateV1, sessionId: string): WorkoutRuntimeTemplate {
  const session = template.sessions.find((item) => item.id === sessionId) ?? template.sessions[0];
  if (!session) {
    throw new Error(`Ready template ${template.id} has no sessions.`);
  }

  return {
    id: template.id,
    name: `${template.name} - ${session.name}`,
    defaultScheduleMode: template.defaultScheduleMode,
    sessions: [
      {
        ...session,
        exercises: session.exercises.map((exercise) => ({ ...exercise })),
      },
    ],
  };
}

export function buildCustomSessionRuntimeTemplate(template: WorkoutRuntimeTemplate, sessionId: string): WorkoutRuntimeTemplate {
  const session = template.sessions.find((item) => item.id === sessionId) ?? template.sessions[0];
  if (!session) {
    throw new Error(`Custom template ${template.id} has no sessions.`);
  }

  return {
    ...template,
    name: `${template.name} - ${session.name}`,
    sessions: [
      {
        ...session,
        exercises: session.exercises.map((exercise) => ({ ...exercise })),
      },
    ],
  };
}

/**
 * Whether the composed week may stand in for the catalog's own days.
 *
 * The composed week renames every day — `onboarding_<programme>_<n>` — so a
 * plan whose entries point at the catalog's session ids cannot find its day
 * in it. Home's day rows carry those entry ids, and the day they opened was
 * looked up in the composed week: no match, and the reader got an empty
 * screen instead of the day they tapped (2026-09-15).
 *
 * The composed week describes what the reader WOULD run, so it stands in
 * only while nothing says otherwise. Once a plan exists and names its days,
 * those days are what the reader runs.
 */
export function composedWeekMatchesPlan(
  composedSessionIds: string[],
  planSessionIds: Array<string | null | undefined>,
): boolean {
  const named = planSessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (named.length === 0) {
    return true;
  }

  const composed = new Set(composedSessionIds);
  return named.every((id) => composed.has(id));
}
