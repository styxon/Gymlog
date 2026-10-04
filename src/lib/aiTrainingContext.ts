import { calendarDaysBetween, getRollingWindowStart, localDateKey } from './completedSessions';
import { getCardioMinutes } from './cardio';
import { HomeSummary } from './dashboard';
import { ExerciseProgressSummary } from './progression';
import {
  BodyweightEntry,
  CardioSession,
  CoachGoal,
  ExerciseLog,
  MeasurementEntry,
  SetupCautionFlag,
  SetupWeekday,
  UnitPreference,
  WorkoutSession,
} from '../types/models';
import {
  AICoachActiveSessionSummary,
  AICoachBody,
  AICoachBodyChange,
  AICoachBodyMeasurementTrend,
  AICoachCardio,
  AICoachCautionArea,
  AICoachGoal,
  AICoachHistory,
  AICoachHistoryConfidence,
  AICoachHistoryLift,
  AICoachHistoryRepsLift,
  AICoachHistorySchedule,
  AICoachHistorySession,
  AICoachHistoryWeek,
  AICoachHomeState,
  AICoachLastSession,
  AICoachLatestTopSet,
  AICoachLiftHighlight,
  AICoachPlannerSetupSummary,
  AICoachPlateauSummary,
  AICoachProfile,
  AICoachProgramme,
  AICoachProgrammeDay,
  AICoachRecentCompletedSession,
  AICoachRhythmDay,
  AICoachTrainingContext,
} from '../types/aiCoach';
import { DEFAULT_BUDGET_LIMITS } from './aiCoachBudget';
import { buildAiCoachContextText } from './aiCoachSystemContext';
import { cautionAreaLoadedBy } from './cautionAreaMatching';
import { detectPlateaus } from './progressionAnalyzer';
import { sessionBestPoints } from './trainingHistory';
import { buildFatigueModel } from './fatigueModel';
import { getComparableLogSets } from './exerciseLog';
import {
  buildTrainingHistory,
  DEFAULT_HISTORY_WINDOW_DAYS,
  normalizedName,
  sessionTime,
  sessionVolumeKg,
  topSetOf,
} from './trainingHistory';
import { CoachAdviceMemoryEntry, buildCoachAdviceLines, parseCoachAdviceLines } from './coachAdviceMemory';
import { MAX_DAYS as MAX_PROGRAMME_DAYS, MAX_EXERCISES as MAX_PROGRAMME_EXERCISES } from './aiCoachProgramme';
import type { TrainingSchedule } from './trainingSchedule';

/**
 * Caps on the history block. Model quality is bounded by what we tell it, but
 * an unbounded payload is a bill — these keep eight weeks of real training
 * inside a few kilobytes, and `truncated` says so when older work is dropped.
 */
const MAX_HISTORY_SESSIONS = 24;
// Every lift a real programme logs in eight weeks, near enough: at 10 a
// four-day split lost a third of its lifts, bench press among them, and the
// coach said the reader did not track it (emulator, 2026-09-30). A row is a
// couple of hundred characters; the shedding steps below still bound the whole.
const MAX_HISTORY_LIFTS = 24;
/** Names only, for the lifts past the cap — see AICoachHistory.liftsNotShown. */
const MAX_LIFT_NAMES_NOT_SHOWN = 40;
/**
 * The 56-day default window produces at most eight or nine calendar weeks
 * (buildWeeks in trainingHistory.ts); this leaves slack above that so a
 * normal payload always passes through whole.
 */
const MAX_HISTORY_WEEKS = 12;
const MAX_LAST_SESSION_EXERCISES = 12;
const MAX_LAST_SESSION_SETS = 8;
/** A cardio line is short, but it is still a line per session. */
const MAX_CARDIO_SESSIONS = 12;

/**
 * Caps for the endpoint's re-parse of a posted context (normalizeAiCoachTrainingContext,
 * below), sized to what the device's own builder in this file would ever
 * send. A posted context is otherwise unbounded on every one of these, and
 * the size check meant to catch that (fitAiCoachContextToCap) runs only on
 * the device — the endpoint renders the text straight from what it parses
 * (buildAiCoachContextText, called before its own budget check) — so an
 * oversized field here is cheap to accept and expensive only once it is
 * written out and joined into lines (recheck round, 2026-09-29).
 */

/**
 * A lift's own trajectory arrays — weightSeriesKg, and repsLifts'
 * bestSetRepsSeries — hold one point per session inside the window, not one
 * per MAX_HISTORY_SESSIONS row: a lift trained daily for the whole 56-day
 * default window can log more points than the session list keeps. This
 * leaves slack above that whole window, the same margin MAX_HISTORY_WEEKS
 * takes above its own calendar count.
 */
const MAX_LIFT_SERIES_POINTS = 60;
/** More reps-per-set entries than one exercise logs in one real session. */
const MAX_REPS_PER_SESSION = 20;
/** A name the reader typed or the device resolved: a lift, a session, a day. */
const MAX_NAME_CHARS = 120;
/** A short field: a scheme label, a planner note, a home-state key. */
const MAX_SHORT_TEXT_CHARS = 80;
/** The longest free text the endpoint would ever knowingly forward as a goal or a prompt. */
const MAX_LONG_TEXT_CHARS = 2000;
/** Matches the device builder: trackedProgress.slice(0, 3) — twice, for two different views of it. */
const MAX_TRACKED_LIFTS = 3;
const MAX_LATEST_TOP_SETS = 3;
/** Matches the device builder: workoutSessions...slice(0, 3). */
const MAX_RECENT_SESSIONS = 3;
/** Matches getRecentActivityStrip's own default window (completedSessions.ts). */
const MAX_RHYTHM_DAYS = 16;
/** No device-side cap on either list; generous but bounded is enough here. */
const MAX_GOALS = 20;
const MAX_PLATEAUS = 20;
/** A reader tracks a handful of measured sites, not hundreds. */
const MAX_BODY_MEASUREMENTS = 20;
/** Home-state and planner lists: a handful of keys or notes, not thousands. */
const MAX_LIST_ITEMS = 20;
/** One entry per weekday, at most. */
const MAX_SCHEDULE_TRAINING_DAYS = 7;
/** One entry per area setup offers. */
const CAUTION_AREA_KEYS: readonly AICoachCautionArea['area'][] = [
  'neck',
  'shoulders',
  'elbows',
  'wrists',
  'lower_back',
  'hips',
  'knees',
  'ankles',
];
const CAUTION_LEVEL_KEYS: readonly AICoachCautionArea['level'][] = ['info', 'careful', 'avoid'];

type AiCardioInput = Pick<CardioSession, 'id' | 'activityType' | 'performedAt' | 'durationSec' | 'distanceKm'>;

export interface BuildAiTrainingContextInput {
  unitPreference: UnitPreference;
  activeWorkoutSummary: {
    title: string;
    nextExercise: string | null;
    meta: string;
  } | null;
  /**
   * Only the three fields this actually reads. Demanding the whole
   * HomeStreakSummary forced every caller to build a full dashboard summary
   * just to ask the coach a question.
   */
  homeSummary: {
    streak: {
      sessionsThisWeek: number;
      sessionsLast30Days: number;
      activity: { days: HomeSummary['streak']['activity']['days'] };
    };
  };
  workoutSessions: WorkoutSession[];
  /**
   * Runs, rides and rows. `homeSummary`'s counts already include them, so
   * leaving them out here made the context disagree with itself.
   */
  cardioSessions?: AiCardioInput[];
  exerciseLogs: ExerciseLog[];
  trackedProgress: ExerciseProgressSummary[];
  readyProgramCount: number;
  recommendedProgramId: string | null;
  recommendedProgramTitle: string | null;
  customProgramTitle: string | null;
  /** The running programme's actual week — see buildAiCoachProgramme. */
  programme?: AICoachProgramme | null;
  plannerSetup?: {
    goal: string | null;
    daysPerWeek: number | null;
    experience: string | null;
    sessionMinutes: number | null;
    equipment: string | null;
    recovery: string | null;
    mustInclude: string[];
    avoid: string[];
    limitations: string[];
  } | null;
  /** Weekdays the plan schedules; empty means the plan has no fixed days. */
  trainingDays?: SetupWeekday[];
  /** The plan's real rhythm; wins over trainingDays when given. */
  schedule?: TrainingSchedule | null;
  historyWindowDays?: number;
  includeActiveSessionContext?: boolean;
  /** Body record + goals: without these a chest or nutrition question gets a training summary. */
  bodyweightEntries?: BodyweightEntry[];
  measurementEntries?: MeasurementEntry[];
  coachGoals?: CoachGoal[];
  /** Which of them leads; null falls back to the newest. */
  primaryGoalId?: string | null;
  /**
   * What the coach already told this reader, from
   * storage/coachAdviceMemoryStore. Passed through rather than derived: it is
   * the only part of the context the app itself did not observe.
   */
  coachMemory?: CoachAdviceMemoryEntry[];
  bodyweightGoalKg?: number | null;
  profile?: AICoachProfile | null;
  /** What Home already shows and what the coach must not offer right now. */
  homeState?: AICoachHomeState | null;
  /**
   * The set screen's opening targets for the last session's lifts, next time
   * (workoutState previewNextSession) — from the caller, which owns the
   * workout store. Empty when the last session is not a startable programme's.
   */
  nextSessionTargets?: readonly { exerciseName: string; sets: { loadKg: number | null; reps: number }[] }[];
  /**
   * The body areas the reader flagged in setup (preferences.setupCautionFlags).
   * The privacy policy says the coach's summary carries the reader's
   * limitations; until 2026-09-30 it only did behind a flag nothing set.
   */
  cautionFlags?: readonly SetupCautionFlag[];
  now?: Date;
}

/**
 * The history of someone who has not trained yet: no sessions, no lifts, no
 * weeks — and the schedule they just chose, which is the one thing that is
 * already true about them.
 */
export function emptyAiCoachHistory(trainingDays: SetupWeekday[] = []): AICoachHistory {
  return {
    windowDays: DEFAULT_HISTORY_WINDOW_DAYS,
    sessionCount: 0,
    totalVolumeKg: 0,
    sessions: [],
    lifts: [],
    weeks: [],
    schedule:
      trainingDays.length > 0
        ? {
            trainingDays,
            plannedPerWeek: trainingDays.length,
            plannedSessions: 0,
            completedSessions: 0,
          }
        : null,
    truncated: false,
    // Nothing logged is the clearest low there is.
    confidence: 'low',
  };
}

function weightChange(sorted: BodyweightEntry[], windowDays: number, now: Date): AICoachBodyChange | null {
  // Calendar stepping: a fixed windowDays * 24h puts the edge an hour off the
  // time of day it claims for the six months after every clock change, so a
  // weigh-in near the boundary is admitted or dropped against what the coach is
  // told the window covers.
  const cutoff = getRollingWindowStart(now, windowDays);
  // Bounded at both ends, like every sibling window. A weigh-in stamped in the
  // future — a wrong device clock keeps that timestamp forever — otherwise
  // becomes the reading the change is measured to, and a thirty-day window
  // reports a four-month span.
  const nowTimestamp = now.getTime();
  const inWindow = sorted.filter((entry) => {
    const recordedAt = new Date(entry.recordedAt).getTime();
    return recordedAt >= cutoff && recordedAt <= nowTimestamp;
  });
  if (inWindow.length < 2) {
    // One weigh-in is a fact, not a direction — report no change at all.
    return null;
  }
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const spanDays = calendarDaysBetween(first.recordedAt, last.recordedAt);
  return { deltaKg: Math.round((last.weight - first.weight) * 10) / 10, spanDays };
}

export function buildAiCoachBodyState(
  bodyweightEntries: BodyweightEntry[],
  measurementEntries: MeasurementEntry[],
  now: Date = new Date(),
): AICoachBody | null {
  const weights = [...bodyweightEntries].sort(
    (left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
  );
  // Bounded like the change windows below. Left open, a weigh-in stamped in
  // the future is reported as the reader's current weight while the change
  // beside it is measured to a different reading entirely — one payload
  // stating two weights.
  const nowTimestamp = now.getTime();
  const recordedWeights = weights.filter(
    (entry) => new Date(entry.recordedAt).getTime() <= nowTimestamp,
  );
  const latestWeight = recordedWeights[recordedWeights.length - 1] ?? null;

  const byKind = new Map<string, MeasurementEntry[]>();
  for (const entry of measurementEntries) {
    const list = byKind.get(entry.kind) ?? [];
    list.push(entry);
    byKind.set(entry.kind, list);
  }
  const measurements = [...byKind.entries()].map(([kind, entries]) => {
    const sorted = entries.sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2] ?? null;
    return {
      kind,
      unit: latest.unit,
      latestValue: latest.value,
      latestAt: localDateKey(latest.recordedAt),
      previousValue: previous?.value ?? null,
      previousAt: previous ? localDateKey(previous.recordedAt) : null,
    };
  });

  if (!latestWeight && measurements.length === 0) {
    return null;
  }
  return {
    weightKg: latestWeight?.weight ?? null,
    weightAt: latestWeight ? localDateKey(latestWeight.recordedAt) : null,
    weightChange30d: weightChange(weights, 30, now),
    weightChange90d: weightChange(weights, 90, now),
    measurements,
  };
}

/**
 * Dates the coach quotes are the reader's days, not UTC's.
 *
 * `recordedAt.slice(0, 10)` is the first ten characters of an ISO string,
 * which is the UTC date: a weigh-in at half past midnight in Helsinki is
 * stored as 21:30 the previous day, so the coach told the reader they last
 * weighed in yesterday — and dated the change it was reading from
 * (2026-09-16). localDateKey resolves the day on the phone, which is the only
 * place that knows the reader's timezone; the endpoint's own clock is UTC.
 */
export function buildAiCoachGoals(
  coachGoals: CoachGoal[],
  bodyweightGoalKg: number | null,
  body: AICoachBody | null,
  primaryGoalId: string | null = null,
): AICoachGoal[] {
  // Which goal leads. A stored id that no longer matches a goal must not leave
  // the list headless, so the newest stated goal takes over — the last thing
  // the reader said out loud is the best guess at what they care about now.
  const primaryId =
    coachGoals.find((goal) => goal.id === primaryGoalId)?.id ??
    coachGoals.reduce<CoachGoal | null>(
      (newest, goal) => (newest === null || goal.createdAt > newest.createdAt ? goal : newest),
      null,
    )?.id ??
    null;
  const currentFor = (kind: string | null): number | null => {
    if (kind === 'bodyweight') return body?.weightKg ?? null;
    if (!kind) return null;
    return body?.measurements.find((entry) => entry.kind === kind)?.latestValue ?? null;
  };
  const goals: AICoachGoal[] = coachGoals.map((goal) => ({
    text: goal.text,
    kind: goal.kind,
    targetValue: goal.targetValue,
    unit: goal.unit,
    startValue: goal.startValue,
    currentValue: currentFor(goal.kind),
    setAt: localDateKey(goal.createdAt),
    isPrimary: goal.id === primaryId,
  }));
  // The onboarding weight goal counts as a goal too — but the one the user
  // stated to the coach wins when both name bodyweight.
  if (bodyweightGoalKg !== null && !goals.some((goal) => goal.kind === 'bodyweight')) {
    goals.push({
      text: 'reach target bodyweight',
      kind: 'bodyweight',
      targetValue: bodyweightGoalKg,
      unit: 'kg',
      startValue: null,
      currentValue: body?.weightKg ?? null,
      setAt: null,
      // An onboarding answer leads only when nothing was ever said to the
      // coach: a goal the reader stated in their own words outranks a number
      // they tapped into a setup step months ago.
      isPrimary: goals.length === 0,
    });
  }
  return goals;
}

/**
 * How much record a reading rests on. Counted from the log, not asked of the
 * model: self-rated confidence turns into "it seems that" in front of every
 * sentence, and the hedge stops meaning anything.
 *
 * The thresholds continue the rule the prompt already had — three sessions is
 * where a trend starts — and the top step needs both a count and a stretch of
 * calendar, because twelve sessions crammed into a fortnight say less about a
 * direction than the same twelve spread across six weeks.
 */
export function resolveHistoryConfidence(sessionCount: number, spanDays: number): AICoachHistoryConfidence {
  if (sessionCount < 3) {
    return 'low';
  }
  return sessionCount >= 12 && spanDays >= 42 ? 'high' : 'medium';
}

function historySpanDays(sessions: { performedAt: string }[]): number {
  if (sessions.length < 2) {
    return 0;
  }
  const times = sessions.map((entry) => new Date(entry.performedAt).getTime()).filter((time) => Number.isFinite(time));
  if (times.length < 2) {
    return 0;
  }
  return Math.round((Math.max(...times) - Math.min(...times)) / (24 * 60 * 60 * 1000));
}

function buildHistoryBlock(
  workoutSessions: WorkoutSession[],
  exerciseLogs: ExerciseLog[],
  trainingDays: SetupWeekday[],
  windowDays: number,
  schedule: TrainingSchedule | null = null,
  now: Date = new Date(),
): AICoachHistory {
  const history = buildTrainingHistory({
    sessions: workoutSessions,
    logs: exerciseLogs,
    trainingDays,
    schedule,
    windowDays,
    now: now.getTime(),
  });

  const sessions = history.sessions.slice(-MAX_HISTORY_SESSIONS).map((entry) => ({
    sessionId: entry.sessionId,
    name: entry.name,
    performedAt: entry.performedAt,
    day: localDateKey(entry.performedAt),
    durationMinutes: entry.durationMinutes,
    volumeKg: entry.volumeKg === null ? null : Math.round(entry.volumeKg),
    setCount: entry.setCount,
    exerciseCount: entry.exerciseCount,
  }));

  return {
    windowDays: history.windowDays,
    sessionCount: history.sessionCount,
    totalVolumeKg: history.totalVolumeKg,
    sessions,
    lifts: history.lifts.slice(0, MAX_HISTORY_LIFTS).map((lift) => {
      // Per session, not per log: a lift logged twice in one workout is one
      // session, and its 60 then 70 is not ten kilos of progress.
      const points = sessionBestPoints(lift);
      const first = points[0] ?? lift.first;
      const latest = points[points.length - 1] ?? lift.latest;
      return {
        name: lift.name,
        sessions: points.length,
        firstWeightKg: first.topSetWeightKg,
        latestWeightKg: latest.topSetWeightKg,
        latestReps: latest.topSetReps,
        bestWeightKg: lift.bestWeightKg,
        changeKg: Math.round((latest.topSetWeightKg - first.topSetWeightKg) * 100) / 100,
        spanDays: Math.max(0, Math.round((latest.time - first.time) / 86400000)),
        stalledSessions: lift.stalledSessions,
        weightSeriesKg: points.map((point) => point.topSetWeightKg),
      };
    }),
    liftsNotShown: [
      ...history.lifts.slice(MAX_HISTORY_LIFTS),
      ...history.repsLifts.slice(MAX_HISTORY_LIFTS),
    ]
      .map((lift) => lift.name)
      .slice(0, MAX_LIFT_NAMES_NOT_SHOWN),
    repsLifts: history.repsLifts.slice(0, MAX_HISTORY_LIFTS).map((lift) => ({
      name: lift.name,
      sessions: lift.points.length,
      spanDays: lift.spanDays,
      firstReps: lift.first.reps,
      latestReps: lift.latest.reps,
      bestSetRepsSeries: lift.points.map((point) => point.bestSetReps),
      unchangedSessions: lift.unchangedSessions,
    })),
    weeks: history.weeks,
    schedule: history.adherence,
    truncated: history.sessionCount > sessions.length,
    confidence: resolveHistoryConfidence(history.sessionCount, historySpanDays(history.sessions)),
  };
}

/**
 * The cardio block: what the session counts include and the strength blocks
 * do not. Null when there is none to report, which is what an older client's
 * payload looks like too.
 *
 * Deduplicated by id and bounded at now, like every sibling window; the 7- and
 * 30-day counts use the same calendar-stepped edges as the Load lines they sit
 * beside, so "3 sessions, 3 of them cardio" is one count read two ways.
 */
export function buildAiCoachCardio(
  cardioSessions: AiCardioInput[],
  windowDays: number,
  now: Date = new Date(),
): AICoachCardio | null {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const dated = cardioSessions
    .filter((session) => {
      if (seen.has(session.id)) {
        return false;
      }
      seen.add(session.id);
      return true;
    })
    .map((session) => ({ session, at: new Date(session.performedAt).getTime() }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at <= nowMs)
    .sort((left, right) => left.at - right.at);
  const since = (days: number) => {
    const start = getRollingWindowStart(now, days);
    return dated.filter((entry) => entry.at >= start);
  };
  const inWindow = since(windowDays);
  const last30 = since(30);
  if (inWindow.length === 0 && last30.length === 0) {
    return null;
  }
  const shown = inWindow.slice(-MAX_CARDIO_SESSIONS);
  return {
    windowDays,
    sessionCount: inWindow.length,
    totalMinutes: getCardioMinutes(inWindow.map((entry) => entry.session)),
    sessionsLast7Days: since(7).length,
    sessionsLast30Days: last30.length,
    sessions: shown.map(({ session }) => ({
      day: localDateKey(session.performedAt),
      activity: session.activityType,
      minutes: getCardioMinutes([session]),
      distanceKm: typeof session.distanceKm === 'number' && session.distanceKm > 0 ? session.distanceKm : null,
    })),
    truncated: inWindow.length > shown.length,
  };
}

/**
 * A lift's next-session targets as the context carries them: one load (the
 * first set's — the screen opens there) and every set's reps. Null when the
 * app has nothing to open on.
 */
function nextFor(
  lift: { sets: { loadKg: number | null; reps: number }[] } | undefined,
): { loadKg: number | null; reps: number[] } | null {
  if (!lift || lift.sets.length === 0) {
    return null;
  }
  const reps = lift.sets.map((set) => set.reps).filter((count) => Number.isFinite(count) && count > 0);
  if (reps.length === 0) {
    return null;
  }
  const loadKg = lift.sets[0].loadKg;
  return { loadKg: typeof loadKg === 'number' && Number.isFinite(loadKg) && loadKg > 0 ? loadKg : null, reps };
}

/**
 * The newest session at or before now, with every exercise's completed sets —
 * see AICoachLastSession. Null when nothing is logged.
 */
export function buildAiCoachLastSession(
  workoutSessions: WorkoutSession[],
  exerciseLogs: ExerciseLog[],
  now: Date = new Date(),
  /**
   * What the set screen will open on next time for this session's lifts
   * (workoutState previewNextSession), built by the caller that owns the
   * workout store. Matched to a lift by name.
   */
  nextTargets: readonly { exerciseName: string; sets: { loadKg: number | null; reps: number }[] }[] = [],
): AICoachLastSession | null {
  const nextByLift = new Map(nextTargets.map((lift) => [normalizedName(lift.exerciseName), lift]));
  const nowMs = now.getTime();
  let newest: WorkoutSession | null = null;
  let newestAt = -Infinity;
  for (const session of workoutSessions) {
    const at = new Date(session.performedAt).getTime();
    if (Number.isFinite(at) && at <= nowMs && at > newestAt) {
      newest = session;
      newestAt = at;
    }
  }
  if (!newest) {
    return null;
  }
  const sessionId = newest.id;
  const setsOf = (log: ExerciseLog) =>
    getComparableLogSets(log)
      .filter((set) => set.reps > 0 && set.weight >= 0)
      .map((set) => ({ weightKg: set.weight, reps: set.reps }));

  // Every earlier session, newest first — "before" is by time, not by list order.
  const earlierAt = new Map<string, number>();
  for (const session of workoutSessions) {
    const at = sessionTime(session);
    if (session.id !== sessionId && at < newestAt) {
      earlierAt.set(session.id, at);
    }
  }
  const sessionById = new Map(workoutSessions.map((session) => [session.id, session]));
  const sameName = normalizedName(newest.workoutNameSnapshot);
  // Earlier logs of each lift, newest first — grouped once, not rescanned per lift.
  const earlierByLift = new Map<string, { log: ExerciseLog; sets: ReturnType<typeof setsOf> }[]>();
  for (const log of exerciseLogs) {
    if (!earlierAt.has(log.sessionId) || log.skipped) continue;
    const sets = setsOf(log);
    if (sets.length === 0) continue;
    const key = normalizedName(log.exerciseNameSnapshot);
    const list = earlierByLift.get(key) ?? [];
    list.push({ log, sets });
    earlierByLift.set(key, list);
  }
  for (const list of earlierByLift.values()) {
    list.sort((left, right) => (earlierAt.get(right.log.sessionId) ?? 0) - (earlierAt.get(left.log.sessionId) ?? 0));
  }

  const exercises = exerciseLogs
    .filter((log) => log.sessionId === sessionId && !log.skipped)
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((log) => {
      const sets = setsOf(log);
      const name = log.exerciseNameSnapshot.trim();
      const earlier = earlierByLift.get(normalizedName(name)) ?? [];
      const before = earlier[0];
      const beforeSession = before ? sessionById.get(before.log.sessionId) : undefined;
      // The streak is this day's: a lift programmed heavier on one day and
      // lighter on another would otherwise restart every session, and the
      // block would call a weight "first" that this day has used for weeks.
      const top = topSetOf(log)?.weight ?? null;
      let sessionsAtThisWeight = 1;
      for (const entry of earlier) {
        const entrySession = sessionById.get(entry.log.sessionId);
        if (!entrySession || normalizedName(entrySession.workoutNameSnapshot) !== sameName) continue;
        if (top === null || topSetOf(entry.log)?.weight !== top) break;
        sessionsAtThisWeight += 1;
      }
      return {
        name,
        sets,
        previous:
          before && beforeSession
            ? { day: localDateKey(beforeSession.performedAt), sets: before.sets.slice(0, MAX_LAST_SESSION_SETS) }
            : null,
        sessionsAtThisWeight,
        // By the name logged. A lift swapped in for the day is not the one the
        // programme prescribes next time, so it gets no "next time" rather
        // than the original lift's numbers under its name.
        next: nextFor(nextByLift.get(normalizedName(name))),
      };
    })
    .filter((exercise) => exercise.name.length > 0 && exercise.sets.length > 0);
  const shown = exercises
    .slice(0, MAX_LAST_SESSION_EXERCISES)
    .map((exercise) => ({ ...exercise, sets: exercise.sets.slice(0, MAX_LAST_SESSION_SETS) }));

  let previousSameName: WorkoutSession | null = null;
  for (const session of workoutSessions) {
    const at = earlierAt.get(session.id);
    if (
      at !== undefined &&
      normalizedName(session.workoutNameSnapshot) === sameName &&
      (!previousSameName || at > sessionTime(previousSameName))
    ) {
      previousSameName = session;
    }
  }
  const previousVolume = previousSameName ? sessionVolumeKg(previousSameName, exerciseLogs) : null;

  return {
    day: localDateKey(newest.performedAt),
    name: newest.workoutNameSnapshot.trim(),
    exercises: shown,
    truncated:
      exercises.length > shown.length || exercises.some((exercise) => exercise.sets.length > MAX_LAST_SESSION_SETS),
    previousSameName: previousSameName
      ? {
          day: localDateKey(previousSameName.performedAt),
          volumeKg: previousVolume === null ? null : Math.round(previousVolume),
        }
      : null,
  };
}

export function buildAiTrainingContext({
  unitPreference,
  activeWorkoutSummary,
  homeSummary,
  workoutSessions,
  cardioSessions = [],
  exerciseLogs,
  trackedProgress,
  readyProgramCount,
  recommendedProgramId,
  recommendedProgramTitle,
  customProgramTitle,
  programme = null,
  plannerSetup,
  trainingDays = [],
  schedule = null,
  historyWindowDays = DEFAULT_HISTORY_WINDOW_DAYS,
  includeActiveSessionContext = false,
  bodyweightEntries = [],
  measurementEntries = [],
  coachGoals = [],
  primaryGoalId = null,
  bodyweightGoalKg = null,
  coachMemory = [],
  profile = null,
  homeState = null,
  nextSessionTargets = [],
  cautionFlags = [],
  now = new Date(),
}: BuildAiTrainingContextInput): AICoachTrainingContext {
  const body = buildAiCoachBodyState(bodyweightEntries, measurementEntries, now);
  const recentCompletedSessions = [...workoutSessions]
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())
    .slice(0, 3)
    .map((session) => ({
      sessionId: session.id,
      title: session.workoutNameSnapshot.trim(),
      performedAt: session.performedAt,
      // Dated here, on the phone: see AICoachRecentCompletedSession.day.
      day: localDateKey(session.performedAt),
      durationMinutes: session.durationMinutes ?? null,
      setsCompleted: session.setsCompleted ?? null,
      swappedExercises: session.exercisesSwapped ?? 0,
      noteCount: session.noteCount ?? 0,
    }));

  const trackedLifts = trackedProgress.slice(0, 3).map((summary) => ({
    key: summary.key,
    name: summary.name,
    latestWeight: summary.latestWeight,
    bestWeight: summary.bestWeight,
    latestReps: summary.latestReps,
  }));

  const latestTopSets = trackedProgress.slice(0, 3).map((summary) => ({
    exerciseName: summary.name,
    weight: summary.latestWeight,
    reps: summary.latestReps,
    performedAt: summary.latestLog?.performedAt ?? null,
  }));

  // A lift the plan holds on purpose for a flagged area is not stuck, and the
  // coach must not be told it is (2026-10-02).
  const plateaus = detectPlateaus(trackedProgress)
    .filter((p) => p.isPlateau && cautionAreaLoadedBy(p.name, [...cautionFlags]) === null)
    .map((p) => ({
      exerciseKey: p.exerciseKey,
      name: p.name,
      stagnantSessions: p.stagnantSessions,
      topWeightKg: p.topWeightHistory[0] ?? null,
    }));

  // The same reference date every other block in this payload is built from.
  // Left to its own clock it reports a different week than the history beside it.
  const fatigueResult = buildFatigueModel({ workoutSessions, exerciseLogs }, now);
  const fatigue = {
    acwr: fatigueResult.acwr,
    recoveryScore: fatigueResult.recoveryScore,
    signal: fatigueResult.signal,
    confident: fatigueResult.confident,
    sessionCount7d: fatigueResult.sessionCount7d,
  };

  return fitAiCoachContextToCap({
    unitPreference,
    activeSession: includeActiveSessionContext && activeWorkoutSummary
      ? {
          title: activeWorkoutSummary.title,
          nextExercise: activeWorkoutSummary.nextExercise,
          meta: activeWorkoutSummary.meta,
        }
      : null,
    recentCompletedSessions,
    trackedLifts,
    latestTopSets,
    sessionsThisWeek: homeSummary.streak.sessionsThisWeek,
    sessionsLast30Days: homeSummary.streak.sessionsLast30Days,
    rhythm: homeSummary.streak.activity.days.map((day) => ({
      dayStart: day.dayStart,
      dayNumber: day.dayNumber,
      weekdayLabel: day.weekdayLabel,
      active: day.active,
      isToday: day.isToday,
    })),
    readyProgramCount,
    recommendedProgramId,
    recommendedProgramTitle,
    customProgramTitle,
    programme,
    plateaus,
    fatigue,
    history: buildHistoryBlock(workoutSessions, exerciseLogs, trainingDays, historyWindowDays, schedule, now),
    lastSession: buildAiCoachLastSession(workoutSessions, exerciseLogs, now, nextSessionTargets),
    cardio: buildAiCoachCardio(cardioSessions, historyWindowDays, now),
    ...(plannerSetup !== undefined ? { plannerSetup } : {}),
    // Area and level only: the free-text refinements stay on the phone.
    cautionAreas: normalizeCautionAreas(cautionFlags),
    body,
    goals: buildAiCoachGoals(coachGoals, bodyweightGoalKg, body, primaryGoalId),
    profile:
      profile
      && (profile.heightCm !== null
        || profile.age !== null
        || (profile.ageRange !== null && profile.ageRange !== undefined)
        || profile.gender !== null)
        ? profile
        : null,
    homeState,
    // Dates resolved on the device: buildAiCoachSystemContext runs on the
    // endpoint, where the timezone is the server's. Expiry runs here too — the
    // file was last written when the reader's last question was answered.
    coachMemory: buildCoachAdviceLines(coachMemory, now.toISOString()),
  });
}

/** A goal is a sentence; past this it is a paragraph pasted into the chat. */
const FIT_GOAL_TEXT_CHARS = 200;
/** The last resort's length for any one piece of text. */
const FIT_ANY_TEXT_CHARS = 60;

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Every string in a value, clipped — the last step, when names alone overflow. */
function clipAllText<T>(value: T, max: number): T {
  if (typeof value === 'string') {
    return clipText(value, max) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clipAllText(entry, max)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clipAllText(entry, max)])) as T;
  }
  return value;
}

/**
 * What goes when a context is too big to send, least needed first. Each step
 * keeps what the one before it kept and takes a little more; the history
 * blocks say "N of M shown" when they are trimmed, so nothing reads as a
 * shorter record than the reader has.
 */
/**
 * The history with at most `keep` lifts of each kind, and the names of the
 * ones cut added to `liftsNotShown`, so a shed row still reads as a lift the
 * reader logs rather than one they never did.
 */
function shedLifts(history: AICoachTrainingContext['history'], keep: number): AICoachTrainingContext['history'] {
  const repsLifts = history.repsLifts ?? [];
  const cut = [...history.lifts.slice(keep), ...repsLifts.slice(keep)].map((lift) => lift.name);
  const names = [...(history.liftsNotShown ?? []), ...cut].filter((name, index, all) => all.indexOf(name) === index);
  return {
    ...history,
    lifts: history.lifts.slice(0, keep),
    repsLifts: repsLifts.slice(0, keep),
    liftsNotShown: names.slice(0, MAX_LIFT_NAMES_NOT_SHOWN),
  };
}

const CONTEXT_SHEDDING: ReadonlyArray<(context: AICoachTrainingContext) => AICoachTrainingContext> = [
  (context) => ({
    ...context,
    goals: (context.goals ?? []).map((goal) => ({ ...goal, text: clipText(goal.text, FIT_GOAL_TEXT_CHARS) })),
  }),
  (context) => ({ ...context, coachMemory: [] }),
  (context) => ({ ...context, plateaus: context.plateaus.slice(0, 5) }),
  (context) => ({
    ...context,
    history: { ...context.history, sessions: context.history.sessions.slice(-12), truncated: true },
    cardio: context.cardio ? { ...context.cardio, sessions: context.cardio.sessions.slice(-6), truncated: true } : context.cardio,
  }),
  (context) => ({
    ...context,
    programme: context.programme
      ? {
          ...context.programme,
          days: context.programme.days.map((day) => ({ ...day, exercises: day.exercises.slice(0, 6) })),
          truncated: true,
        }
      : context.programme,
    history: {
      ...shedLifts(context.history, 5),
      lifts: context.history.lifts.slice(0, 5).map((lift) => ({ ...lift, weightSeriesKg: lift.weightSeriesKg.slice(-8) })),
      repsLifts: (context.history.repsLifts ?? [])
        .slice(0, 5)
        .map((lift) => ({ ...lift, bestSetRepsSeries: lift.bestSetRepsSeries.slice(-8) })),
    },
  }),
  // The reader can open their plan; the coach can do without its rows.
  (context) => ({ ...context, programme: null }),
  (context) => ({
    ...context,
    history: { ...shedLifts(context.history, 0), sessions: [], truncated: true },
    lastSession: context.lastSession
      ? {
          ...context.lastSession,
          exercises: context.lastSession.exercises.slice(0, 6),
          // Only when something was cut: the block says so to the model.
          truncated: context.lastSession.truncated || context.lastSession.exercises.length > 6,
        }
      : context.lastSession,
    cardio: context.cardio ? { ...context.cardio, sessions: [], truncated: true } : context.cardio,
    goals: (context.goals ?? []).filter((goal) => goal.isPrimary),
  }),
  (context) => clipAllText(context, FIT_ANY_TEXT_CHARS),
];

/**
 * The context, trimmed until the endpoint will take it.
 *
 * The endpoint refuses a context longer than its cap — measured on the text it
 * sends (buildAiCoachContextText) — and a refusal reaches the reader as the
 * offline badge on every question. The caps in this file keep an ordinary
 * reader well under it, but names and goals are the reader's own words with no
 * length, and a heavy reader crossed the cap once the endpoint's own rules
 * were counted in it (server audit, 2026-09-21). Measured exactly as the
 * endpoint measures, after the same repair; returned untouched when it fits.
 */
export function fitAiCoachContextToCap(
  context: AICoachTrainingContext,
  maxChars: number = DEFAULT_BUDGET_LIMITS.maxContextChars,
): AICoachTrainingContext {
  const fits = (candidate: AICoachTrainingContext) =>
    buildAiCoachContextText(normalizeAiCoachTrainingContext(candidate)).length <= maxChars;
  if (fits(context)) {
    return context;
  }
  let fitted = context;
  for (const shed of CONTEXT_SHEDDING) {
    fitted = shed(fitted);
    if (fits(fitted)) {
      break;
    }
  }
  return fitted;
}

/**
 * A context with every field present, whatever the client sent.
 *
 * The endpoint accepted any object as a context, and the preview builder
 * then read `context.trackedLifts[0]` — so a request with `context: {}`
 * (a smoke test, an older client, a hand-written call) crashed the function
 * instead of answering. Same rule as the database loader: missing fields get
 * defaults, never a throw. Only shape is repaired here; a present field is
 * trusted as the client sent it.
 */
/**
 * The history block, repaired rather than trusted. The renderer walks
 * `sessions`, `lifts` and `weeks` unconditionally, so a payload that carries a
 * history without one of them used to throw on the way to the model — an
 * error where the honest outcome is a thinner answer.
 */
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * One history row, as far as writing it needs. The context text reads these
 * without a guard of its own — `lift.weightSeriesKg.map`,
 * `entry.performedAt.slice`, `day.match` — so a row missing one of those threw
 * outside every fallback and the reader got no answer at all, not even the
 * preview (break round 2026-09-28). Such a row is dropped.
 *
 * Only what would throw is required. An older app sends sessions with fewer
 * fields than today's, and a missing count reads as a thinner line, not an
 * error; dropping those rows would have taken the reader's history with them.
 */
function isHistoryLift(value: unknown): value is AICoachHistoryLift {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const lift = value as Record<string, unknown>;
  return typeof lift.name === 'string' && Array.isArray(lift.weightSeriesKg) && lift.weightSeriesKg.every(isFiniteNumber);
}

/**
 * A lift row's own scalar fields, sanitised the same way its arrays already
 * are. `isHistoryLift` above requires only `name` and `weightSeriesKg` to be
 * well-shaped, so every other field this type promises — `latestReps`,
 * `stalledSessions`, `spanDays`, `sessions`, the weight fields — reached the
 * renderer as whatever the client posted. Three of them (`latestReps`,
 * `stalledSessions`, `spanDays`) are spliced straight into a trajectory line
 * in aiCoachSystemContext.ts with no guard of their own, so a giant string in
 * any one of them rendered a line the same size — the exact class of bug this
 * file's cap on `weightSeriesKg` closed, just on a scalar (recheck round,
 * 2026-09-29).
 */
function normalizeHistoryLiftRow(lift: AICoachHistoryLift): AICoachHistoryLift {
  const num = (value: unknown, fallback: number): number => (isFiniteNumber(value) ? value : fallback);
  return {
    name: clipText(lift.name, MAX_NAME_CHARS),
    sessions: num(lift.sessions, 0),
    firstWeightKg: num(lift.firstWeightKg, 0),
    latestWeightKg: num(lift.latestWeightKg, 0),
    latestReps: num(lift.latestReps, 0),
    bestWeightKg: num(lift.bestWeightKg, 0),
    changeKg: num(lift.changeKg, 0),
    spanDays: num(lift.spanDays, 0),
    stalledSessions: num(lift.stalledSessions, 0),
    weightSeriesKg: lift.weightSeriesKg.slice(-MAX_LIFT_SERIES_POINTS),
  };
}

/**
 * One history session row, repaired the same way a lift row above is.
 * `isHistorySession` used to require only `performedAt` to be a string, so
 * `name` — rendered through `singleLine`, which only collapses whitespace and
 * has no length cap of its own — and the numeric fields spliced straight into
 * the same line (`durationMinutes`, `setCount`, `exerciseCount`) reached the
 * renderer as whatever the client posted: the sibling of
 * `recentCompletedSessions`, which this file already caps and clips, left
 * uncapped (recheck round, 2026-09-29).
 */
function normalizeHistorySessionRow(value: unknown): AICoachHistorySession | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.performedAt !== 'string') {
    return null;
  }
  const num = (v: unknown, fallback: number): number => (isFiniteNumber(v) ? v : fallback);
  return {
    sessionId: typeof row.sessionId === 'string' ? row.sessionId.slice(0, MAX_NAME_CHARS) : '',
    name: typeof row.name === 'string' ? clipText(row.name, MAX_NAME_CHARS) : '',
    performedAt: row.performedAt.slice(0, MAX_SHORT_TEXT_CHARS),
    ...(typeof row.day === 'string' ? { day: row.day.slice(0, MAX_SHORT_TEXT_CHARS) } : {}),
    durationMinutes: isFiniteNumber(row.durationMinutes) ? row.durationMinutes : null,
    volumeKg: isFiniteNumber(row.volumeKg) ? row.volumeKg : null,
    setCount: num(row.setCount, 0),
    exerciseCount: num(row.exerciseCount, 0),
  };
}

function isHistoryWeek(value: unknown): value is AICoachHistoryWeek {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).weekStart === 'string';
}

/**
 * The schedule, repaired rather than dropped: the fields the context text
 * calls methods on (`trainingDays.join`, the next date's `match`) are made
 * safe, and the counts are left as sent. A schedule sent without its day list
 * threw like a lift without its series did (review of the break round,
 * 2026-09-28).
 */
function normalizeHistorySchedule(input: unknown): AICoachHistory['schedule'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const schedule = input as Record<string, unknown> & AICoachHistorySchedule;
  const cycle = schedule.cycle as unknown;
  const rawCycle = cycle && typeof cycle === 'object' && !Array.isArray(cycle) ? (cycle as Record<string, unknown>) : null;
  return {
    ...schedule,
    // One entry per weekday, at most — the render joins this with `.join`.
    trainingDays: Array.isArray(schedule.trainingDays)
      ? (schedule.trainingDays as unknown[])
          .filter((day): day is SetupWeekday => typeof day === 'string')
          .slice(0, MAX_SCHEDULE_TRAINING_DAYS)
      : [],
    // Its three fields are numbers spliced straight into a template literal
    // (`${s.cycle.onDays} days on...`) with no guard of their own — a string
    // posted in their place would print in full rather than a number.
    cycle: rawCycle
      ? {
          onDays: isFiniteNumber(rawCycle.onDays) ? rawCycle.onDays : 0,
          offDays: isFiniteNumber(rawCycle.offDays) ? rawCycle.offDays : 0,
          length: isFiniteNumber(rawCycle.length) ? rawCycle.length : 0,
        }
      : null,
    nextTrainingDate:
      typeof schedule.nextTrainingDate === 'string' ? schedule.nextTrainingDate.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    // Also spliced straight into a template literal, same as the cycle's own
    // fields above.
    plannedPerWeek: isFiniteNumber(schedule.plannedPerWeek) ? schedule.plannedPerWeek : 0,
    plannedSessions: isFiniteNumber(schedule.plannedSessions) ? schedule.plannedSessions : 0,
    completedSessions: isFiniteNumber(schedule.completedSessions) ? schedule.completedSessions : 0,
  };
}

/**
 * One reps-lift row, repaired rather than trusted. readRepsLifts
 * (aiCoachSystemContext.ts) shape-checks these again where they are
 * rendered, but that check has no length limit of its own — an array of a
 * million reps still passes its isRepList test — so the caps that matter run
 * here, before any of these lists are ever joined into text (recheck round,
 * 2026-09-29).
 */
function normalizeRepsLift(value: unknown): AICoachHistoryRepsLift | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const lift = value as Record<string, unknown>;
  const repList = (input: unknown, max: number): number[] =>
    Array.isArray(input) ? input.filter(isFiniteNumber).slice(0, max) : [];
  const firstReps = repList(lift.firstReps, MAX_REPS_PER_SESSION);
  const latestReps = repList(lift.latestReps, MAX_REPS_PER_SESSION);
  const bestSetRepsSeries = repList(lift.bestSetRepsSeries, MAX_LIFT_SERIES_POINTS);
  if (typeof lift.name !== 'string' || firstReps.length === 0 || latestReps.length === 0 || bestSetRepsSeries.length === 0) {
    return null;
  }
  return {
    name: clipText(lift.name, MAX_NAME_CHARS),
    sessions: isFiniteNumber(lift.sessions) ? lift.sessions : bestSetRepsSeries.length,
    spanDays: isFiniteNumber(lift.spanDays) ? lift.spanDays : 0,
    firstReps,
    latestReps,
    bestSetRepsSeries,
    unchangedSessions: isFiniteNumber(lift.unchangedSessions) ? lift.unchangedSessions : 1,
  };
}

function normalizeHistory(input: Partial<AICoachHistory> | null | undefined): AICoachHistory {
  if (!input || typeof input !== 'object') {
    return emptyAiCoachHistory();
  }
  const empty = emptyAiCoachHistory();
  const list = <T,>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? (value as T[]) : fallback);
  // Capped the same way buildHistoryBlock caps the device's own payload
  // (MAX_HISTORY_SESSIONS / MAX_HISTORY_LIFTS / MAX_HISTORY_WEEKS above): a
  // posted context is otherwise unbounded, and the size check that is meant
  // to catch that runs on the rendered text these arrays feed, so an
  // oversized array is still cheap here and expensive only after it is
  // written out (server audit, 2026-09-29).
  const sessions = list<unknown>(input.sessions, empty.sessions)
    .map(normalizeHistorySessionRow)
    .filter((session): session is AICoachHistorySession => session !== null)
    .slice(-MAX_HISTORY_SESSIONS);
  return {
    windowDays:
      typeof input.windowDays === 'number' && Number.isFinite(input.windowDays) ? input.windowDays : empty.windowDays,
    sessionCount:
      typeof input.sessionCount === 'number' && Number.isFinite(input.sessionCount)
        ? input.sessionCount
        : sessions.length,
    totalVolumeKg:
      typeof input.totalVolumeKg === 'number' && Number.isFinite(input.totalVolumeKg) ? input.totalVolumeKg : 0,
    sessions,
    // A lift's own weightSeriesKg is capped the same way, row by row: the
    // session-count cap above bounds how many rows there are, not how long
    // one row's own trajectory is — a lift trained daily for the window logs
    // more points than the session list keeps (recheck round, 2026-09-29).
    lifts: list<unknown>(input.lifts, empty.lifts)
      .filter(isHistoryLift)
      .slice(0, MAX_HISTORY_LIFTS)
      .map(normalizeHistoryLiftRow),
    // Shape-checked and capped row by row — see normalizeRepsLift above — an
    // older app sends none.
    repsLifts: list(input.repsLifts, [])
      .map(normalizeRepsLift)
      .filter((lift): lift is AICoachHistoryRepsLift => lift !== null)
      .slice(0, MAX_HISTORY_LIFTS),
    // Names only, each spliced into the prompt: strings, trimmed, bounded.
    liftsNotShown: list<unknown>(input.liftsNotShown, [])
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim().slice(0, 80))
      .filter((name) => name.length > 0)
      .slice(0, MAX_LIFT_NAMES_NOT_SHOWN),
    weeks: list<unknown>(input.weeks, empty.weeks).filter(isHistoryWeek).slice(-MAX_HISTORY_WEEKS),
    schedule: normalizeHistorySchedule(input.schedule),
    truncated: input.truncated === true,
    // An older app sends a history with no confidence in it. Falling back to
    // 'low' would tell a reader with a year of training that their record is
    // too short, so it is recounted from what the payload does carry.
    confidence:
      input.confidence ??
      resolveHistoryConfidence(
        typeof input.sessionCount === 'number' && Number.isFinite(input.sessionCount)
          ? input.sessionCount
          : sessions.length,
        historySpanDays(sessions),
      ),
  };
}

/**
 * The last session, rebuilt field by field: it is rendered as text in front of
 * the model, and on the endpoint it is whatever was posted. An exercise with a
 * name that is not plain text or a set that is not two sane numbers is dropped;
 * an older client sends none, which is null.
 */
function normalizeLastSession(input: unknown): AICoachLastSession | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const candidate = input as Partial<AICoachLastSession>;
  const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const day = isDay(candidate.day) ? candidate.day : null;
  const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 120) : '';
  if (!day || !name || !Array.isArray(candidate.exercises)) {
    return null;
  }
  const parseSets = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .slice(0, MAX_LAST_SESSION_SETS)
      .filter(
        (set): set is { weightKg: number; reps: number } =>
          !!set &&
          typeof set.weightKg === 'number' &&
          Number.isFinite(set.weightKg) &&
          set.weightKg >= 0 &&
          set.weightKg <= 1000 &&
          typeof set.reps === 'number' &&
          Number.isInteger(set.reps) &&
          set.reps > 0 &&
          set.reps <= 500,
      )
      .map((set) => ({ weightKg: set.weightKg, reps: set.reps }));
  const exercises = candidate.exercises
    .slice(0, MAX_LAST_SESSION_EXERCISES)
    .map((exercise) => {
      const exerciseName =
        exercise && typeof exercise === 'object' && typeof exercise.name === 'string'
          ? exercise.name.trim().slice(0, 80)
          : '';
      const sets = parseSets(exercise?.sets);
      const previousSets = parseSets(exercise?.previous?.sets);
      // Absent stays absent: an app from before this field sends none, and
      // null would tell the model every lift was a first.
      const previous =
        exercise?.previous && isDay(exercise.previous.day) && previousSets.length > 0
          ? { day: exercise.previous.day, sets: previousSets }
          : exercise?.previous === null
            ? null
            : undefined;
      const streak = exercise?.sessionsAtThisWeight;
      const rawNext = exercise?.next;
      const nextReps = Array.isArray(rawNext?.reps)
        ? rawNext.reps
            .slice(0, MAX_LAST_SESSION_SETS)
            .filter((count): count is number => typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= 500)
        : [];
      const nextLoad = rawNext?.loadKg;
      const next =
        nextReps.length > 0
          ? {
              loadKg: typeof nextLoad === 'number' && Number.isFinite(nextLoad) && nextLoad > 0 && nextLoad <= 1000 ? nextLoad : null,
              reps: nextReps,
            }
          : null;
      return {
        name: exerciseName,
        sets,
        ...(next ? { next } : {}),
        ...(previous !== undefined ? { previous } : {}),
        ...(typeof streak === 'number' && Number.isInteger(streak) && streak >= 1 && streak <= 1000
          ? { sessionsAtThisWeight: streak }
          : {}),
      };
    })
    .filter((exercise) => exercise.name.length > 0 && exercise.sets.length > 0);
  const before = candidate.previousSameName;
  const previousSameName =
    before && typeof before === 'object' && isDay(before.day)
      ? {
          day: before.day,
          volumeKg:
            typeof before.volumeKg === 'number' && Number.isFinite(before.volumeKg) && before.volumeKg >= 0
              ? before.volumeKg
              : null,
        }
      : null;
  return { day, name, exercises, truncated: candidate.truncated === true, previousSameName };
}

/**
 * The cardio block, rebuilt field by field. Rendered as text in front of the
 * model, so a line that is not a plain day, a known-shaped id and numbers is
 * dropped rather than passed on; an older client sends none, which is null.
 */
function normalizeCardio(input: unknown): AICoachCardio | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const raw = input as Partial<Record<keyof AICoachCardio, unknown>>;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .filter(
      (entry) =>
        typeof entry.day === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.day) &&
        typeof entry.activity === 'string' &&
        /^[a-z-]{1,20}$/.test(entry.activity),
    )
    .slice(-MAX_CARDIO_SESSIONS)
    .map((entry) => ({
      day: entry.day as string,
      activity: entry.activity as string,
      minutes: count(entry.minutes),
      distanceKm:
        typeof entry.distanceKm === 'number' && Number.isFinite(entry.distanceKm) && entry.distanceKm > 0
          ? entry.distanceKm
          : null,
    }));
  return {
    windowDays: count(raw.windowDays) || DEFAULT_HISTORY_WINDOW_DAYS,
    sessionCount: count(raw.sessionCount),
    totalMinutes: count(raw.totalMinutes),
    sessionsLast7Days: count(raw.sessionsLast7Days),
    sessionsLast30Days: count(raw.sessionsLast30Days),
    sessions,
    truncated: raw.truncated === true,
  };
}

function withPrimaryGoal(goals: AICoachGoal[]): AICoachGoal[] {
  if (goals.length === 0 || goals.some((goal) => goal.isPrimary === true)) {
    return goals;
  }
  return goals.map((goal, index) => ({ ...goal, isPrimary: index === goals.length - 1 }));
}

/**
 * The rest of a posted context, repaired field by field the same way the
 * history block above is: every array here goes into the '# Training
 * context' block through a template literal or a `.map`/`.join` with no cap
 * of its own, and several of the scalars beside them (a lift's `latestReps`,
 * a goal's `unit`, a plateau's `stagnantSessions`) are spliced straight in
 * too — so a client-typed field posted as a giant string, or a list posted
 * a hundred times its real length, rendered in full rather than erroring
 * (recheck round, 2026-09-29).
 *
 * A dropped row is dropped, never repaired into something that never
 * happened — a lift highlight with no name is not "unnamed exercise", it is
 * one row fewer.
 */
function normalizeActiveSession(value: unknown): AICoachActiveSessionSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.title !== 'string') {
    return null;
  }
  return {
    title: clipText(row.title, MAX_NAME_CHARS),
    nextExercise: typeof row.nextExercise === 'string' ? clipText(row.nextExercise, MAX_NAME_CHARS) : null,
    meta: typeof row.meta === 'string' ? clipText(row.meta, MAX_SHORT_TEXT_CHARS) : '',
  };
}

function normalizeRecentSession(value: unknown): AICoachRecentCompletedSession | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.sessionId !== 'string' || typeof row.title !== 'string' || typeof row.performedAt !== 'string') {
    return null;
  }
  const count = (v: unknown): number | null => (isFiniteNumber(v) ? v : null);
  return {
    sessionId: row.sessionId.slice(0, MAX_NAME_CHARS),
    title: clipText(row.title, MAX_NAME_CHARS),
    performedAt: row.performedAt.slice(0, MAX_SHORT_TEXT_CHARS),
    day: typeof row.day === 'string' ? row.day.slice(0, MAX_SHORT_TEXT_CHARS) : undefined,
    durationMinutes: count(row.durationMinutes),
    setsCompleted: count(row.setsCompleted),
    swappedExercises: isFiniteNumber(row.swappedExercises) ? row.swappedExercises : 0,
    noteCount: isFiniteNumber(row.noteCount) ? row.noteCount : 0,
  };
}

function normalizeLiftHighlight(value: unknown): AICoachLiftHighlight | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string') {
    return null;
  }
  return {
    key: typeof row.key === 'string' ? row.key.slice(0, MAX_NAME_CHARS) : '',
    name: clipText(row.name, MAX_NAME_CHARS),
    latestWeight: isFiniteNumber(row.latestWeight) ? row.latestWeight : null,
    bestWeight: isFiniteNumber(row.bestWeight) ? row.bestWeight : null,
    latestReps: typeof row.latestReps === 'string' ? clipText(row.latestReps, MAX_SHORT_TEXT_CHARS) : '',
  };
}

function normalizeLatestTopSet(value: unknown): AICoachLatestTopSet | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.exerciseName !== 'string') {
    return null;
  }
  return {
    exerciseName: clipText(row.exerciseName, MAX_NAME_CHARS),
    weight: isFiniteNumber(row.weight) ? row.weight : null,
    reps: typeof row.reps === 'string' ? clipText(row.reps, MAX_SHORT_TEXT_CHARS) : '',
    performedAt: typeof row.performedAt === 'string' ? row.performedAt.slice(0, MAX_SHORT_TEXT_CHARS) : null,
  };
}

function normalizeRhythmDay(value: unknown): AICoachRhythmDay | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    dayStart: isFiniteNumber(row.dayStart) ? row.dayStart : 0,
    dayNumber: isFiniteNumber(row.dayNumber) ? row.dayNumber : 0,
    weekdayLabel: typeof row.weekdayLabel === 'string' ? row.weekdayLabel.slice(0, MAX_SHORT_TEXT_CHARS) : '',
    active: row.active === true,
    isToday: row.isToday === true,
  };
}

function normalizePlateau(value: unknown): AICoachPlateauSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string') {
    return null;
  }
  return {
    exerciseKey: typeof row.exerciseKey === 'string' ? row.exerciseKey.slice(0, MAX_NAME_CHARS) : '',
    name: clipText(row.name, MAX_NAME_CHARS),
    stagnantSessions: isFiniteNumber(row.stagnantSessions) ? row.stagnantSessions : 0,
    topWeightKg: isFiniteNumber(row.topWeightKg) ? row.topWeightKg : null,
  };
}

function normalizeGoal(value: unknown): AICoachGoal | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.text !== 'string') {
    return null;
  }
  const num = (v: unknown): number | null => (isFiniteNumber(v) ? v : null);
  return {
    text: clipText(row.text, MAX_LONG_TEXT_CHARS),
    kind: typeof row.kind === 'string' ? row.kind.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    targetValue: num(row.targetValue),
    unit: typeof row.unit === 'string' ? row.unit.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    startValue: num(row.startValue),
    currentValue: num(row.currentValue),
    setAt: typeof row.setAt === 'string' ? row.setAt.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    isPrimary: row.isPrimary === true,
  };
}

/**
 * The running programme. renderAiCoachProgramme walks `days` and each day's
 * `exercises` with no cap of its own — that cap lives in the device-side
 * builder (aiCoachProgramme.ts), which a posted context does not go
 * through — so it is capped here to the same MAX_PROGRAMME_DAYS /
 * MAX_PROGRAMME_EXERCISES that builder holds itself to, imported from there
 * rather than restated, so the two cannot drift apart.
 */
function normalizeProgrammeDay(value: unknown): AICoachProgrammeDay | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string') {
    return null;
  }
  const exercises = (Array.isArray(row.exercises) ? row.exercises : [])
    .slice(0, MAX_PROGRAMME_EXERCISES)
    .filter((exercise): exercise is Record<string, unknown> => !!exercise && typeof exercise === 'object' && typeof exercise.name === 'string')
    .map((exercise) => ({
      name: clipText(exercise.name as string, MAX_NAME_CHARS),
      scheme: typeof exercise.scheme === 'string' ? clipText(exercise.scheme, MAX_SHORT_TEXT_CHARS) : '',
    }));
  return {
    name: clipText(row.name, MAX_NAME_CHARS),
    dayLabel: typeof row.dayLabel === 'string' ? row.dayLabel.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    estimatedMinutes: isFiniteNumber(row.estimatedMinutes) ? row.estimatedMinutes : null,
    exercises,
  };
}

function normalizeProgramme(value: unknown): AICoachProgramme | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.title !== 'string' || !Array.isArray(row.days)) {
    return null;
  }
  const daysInput = row.days;
  const days = daysInput
    .slice(0, MAX_PROGRAMME_DAYS)
    .map(normalizeProgrammeDay)
    .filter((day): day is AICoachProgrammeDay => day !== null);
  // A day or an exercise list that was cut says so, the same way the device
  // builder's own truncated flag does — a trimmed payload must not read as a
  // shorter week than the reader actually has.
  const truncated =
    row.truncated === true ||
    daysInput.length > MAX_PROGRAMME_DAYS ||
    daysInput.some((day) => {
      const exercises = day && typeof day === 'object' ? (day as Record<string, unknown>).exercises : undefined;
      return Array.isArray(exercises) && exercises.length > MAX_PROGRAMME_EXERCISES;
    });
  return {
    title: clipText(row.title, MAX_NAME_CHARS),
    source: row.source === 'ready' ? 'ready' : 'custom',
    daysPerWeek: isFiniteNumber(row.daysPerWeek) ? row.daysPerWeek : days.length,
    days,
    truncated,
  };
}

function normalizePlannerSetup(value: unknown): AICoachPlannerSetupSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_SHORT_TEXT_CHARS) : null);
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, MAX_LIST_ITEMS)
      .map((entry) => clipText(entry, MAX_SHORT_TEXT_CHARS));
  return {
    goal: str(row.goal),
    daysPerWeek: isFiniteNumber(row.daysPerWeek) ? row.daysPerWeek : null,
    experience: str(row.experience),
    sessionMinutes: isFiniteNumber(row.sessionMinutes) ? row.sessionMinutes : null,
    equipment: str(row.equipment),
    recovery: str(row.recovery),
    mustInclude: list(row.mustInclude),
    avoid: list(row.avoid),
    limitations: list(row.limitations),
  };
}

/**
 * Known areas and levels only, one entry per area. Runs on both ends: on the
 * phone to drop the refinements, on the endpoint because the payload is
 * whatever was posted.
 */
function normalizeCautionAreas(value: unknown): AICoachCautionArea[] {
  const out: AICoachCautionArea[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    // Full once every area has a row: bounded by the areas, not by where in
    // the posted list the good rows happen to sit.
    if (out.length === CAUTION_AREA_KEYS.length) break;
    if (!entry || typeof entry !== 'object') continue;
    const { area, level } = entry as { area?: unknown; level?: unknown };
    if (!CAUTION_AREA_KEYS.includes(area as AICoachCautionArea['area'])) continue;
    if (!CAUTION_LEVEL_KEYS.includes(level as AICoachCautionArea['level'])) continue;
    if (out.some((row) => row.area === area)) continue;
    out.push({ area: area as AICoachCautionArea['area'], level: level as AICoachCautionArea['level'] });
  }
  return out;
}

function normalizeHomeState(value: unknown): AICoachHomeState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((entry): entry is string => typeof entry === 'string')
      .slice(0, MAX_LIST_ITEMS)
      .map((entry) => clipText(entry, MAX_SHORT_TEXT_CHARS));
  return {
    pinnedStatCardKeys: list(row.pinnedStatCardKeys),
    weighInReminderEnabled: row.weighInReminderEnabled === true,
    silencedSuggestions: list(row.silencedSuggestions),
  };
}

function normalizeBodyMeasurement(value: unknown): AICoachBodyMeasurementTrend | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.kind !== 'string' || typeof row.unit !== 'string' || !isFiniteNumber(row.latestValue) || typeof row.latestAt !== 'string') {
    return null;
  }
  return {
    kind: row.kind.slice(0, MAX_SHORT_TEXT_CHARS),
    unit: row.unit.slice(0, MAX_SHORT_TEXT_CHARS),
    latestValue: row.latestValue,
    latestAt: row.latestAt.slice(0, MAX_SHORT_TEXT_CHARS),
    previousValue: isFiniteNumber(row.previousValue) ? row.previousValue : null,
    previousAt: typeof row.previousAt === 'string' ? row.previousAt.slice(0, MAX_SHORT_TEXT_CHARS) : null,
  };
}

function normalizeBodyChange(value: unknown): AICoachBodyChange | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  return isFiniteNumber(row.deltaKg) && isFiniteNumber(row.spanDays) ? { deltaKg: row.deltaKg, spanDays: row.spanDays } : null;
}

function normalizeBody(value: unknown): AICoachBody | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  const measurements = (Array.isArray(row.measurements) ? row.measurements : [])
    .slice(0, MAX_BODY_MEASUREMENTS)
    .map(normalizeBodyMeasurement)
    .filter((entry): entry is AICoachBodyMeasurementTrend => entry !== null);
  return {
    weightKg: isFiniteNumber(row.weightKg) ? row.weightKg : null,
    weightAt: typeof row.weightAt === 'string' ? row.weightAt.slice(0, MAX_SHORT_TEXT_CHARS) : null,
    weightChange30d: normalizeBodyChange(row.weightChange30d),
    weightChange90d: normalizeBodyChange(row.weightChange90d),
    measurements,
  };
}

function normalizeProfile(value: unknown): AICoachProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    heightCm: isFiniteNumber(row.heightCm) ? row.heightCm : null,
    age: isFiniteNumber(row.age) ? row.age : null,
    ageRange: typeof row.ageRange === 'string' ? row.ageRange.slice(0, MAX_SHORT_TEXT_CHARS) : row.ageRange === null ? null : undefined,
    gender: typeof row.gender === 'string' ? row.gender.slice(0, MAX_SHORT_TEXT_CHARS) : null,
  };
}

export function normalizeAiCoachTrainingContext(
  input: Partial<AICoachTrainingContext> | null | undefined,
): AICoachTrainingContext {
  const candidate = input && typeof input === 'object' ? input : {};
  // Repaired and capped row by row, then capped again by count — the same
  // two steps normalizeHistory already takes above, applied to every other
  // array this context carries. `max` matches what the device's own builder
  // in this file would ever send (see the MAX_* constants' own comments);
  // where the builder has no cap of its own, it is a small documented one
  // instead (recheck round, 2026-09-29).
  const boundedList = <T>(value: unknown, normalize: (row: unknown) => T | null, max: number, fromEnd = false): T[] => {
    const rows = Array.isArray(value) ? value : [];
    // Which end survives a cut matters for a list the client appends to: the
    // head is the oldest entry, not a row worth keeping over the newest.
    const sliced = fromEnd ? rows.slice(-max) : rows.slice(0, max);
    return sliced.map(normalize).filter((row): row is T => row !== null);
  };
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const fatigueRow = candidate.fatigue && typeof candidate.fatigue === 'object' ? (candidate.fatigue as unknown as Record<string, unknown>) : null;
  const knownFatigueSignal = new Set(['undertrained', 'optimal', 'elevated', 'high']);
  return {
    unitPreference: candidate.unitPreference === 'lb' ? 'lb' : 'kg',
    activeSession: normalizeActiveSession(candidate.activeSession),
    // Matches the device builder: workoutSessions...slice(0, 3).
    recentCompletedSessions: boundedList(candidate.recentCompletedSessions, normalizeRecentSession, MAX_RECENT_SESSIONS),
    // Matches the device builder: trackedProgress.slice(0, 3), twice over.
    trackedLifts: boundedList(candidate.trackedLifts, normalizeLiftHighlight, MAX_TRACKED_LIFTS),
    latestTopSets: boundedList(candidate.latestTopSets, normalizeLatestTopSet, MAX_LATEST_TOP_SETS),
    sessionsThisWeek: number(candidate.sessionsThisWeek),
    sessionsLast30Days: number(candidate.sessionsLast30Days),
    // Matches getRecentActivityStrip's own default window.
    rhythm: boundedList(candidate.rhythm, normalizeRhythmDay, MAX_RHYTHM_DAYS),
    readyProgramCount: number(candidate.readyProgramCount),
    recommendedProgramId: candidate.recommendedProgramId ?? null,
    recommendedProgramTitle: candidate.recommendedProgramTitle ?? null,
    customProgramTitle: candidate.customProgramTitle ?? null,
    programme: normalizeProgramme(candidate.programme),
    // No device-side cap on this list; a small documented one is enough here.
    plateaus: boundedList(candidate.plateaus, normalizePlateau, MAX_PLATEAUS),
    // acwr, recoveryScore and sessionCount7d are spliced straight into the
    // Load block's text with no guard of their own (loadInWords, `plural`).
    fatigue: fatigueRow
      ? {
          acwr: isFiniteNumber(fatigueRow.acwr) ? fatigueRow.acwr : 0,
          recoveryScore: isFiniteNumber(fatigueRow.recoveryScore) ? fatigueRow.recoveryScore : 0,
          signal:
            typeof fatigueRow.signal === 'string' && knownFatigueSignal.has(fatigueRow.signal)
              ? (fatigueRow.signal as AICoachTrainingContext['fatigue']['signal'])
              : 'optimal',
          sessionCount7d: isFiniteNumber(fatigueRow.sessionCount7d) ? fatigueRow.sessionCount7d : 0,
          confident: fatigueRow.confident === true,
        }
      : {
          acwr: 0,
          recoveryScore: 0,
          signal: 'optimal',
          sessionCount7d: 0,
          confident: false,
        },
    history: normalizeHistory(candidate.history),
    lastSession: normalizeLastSession(candidate.lastSession),
    cardio: normalizeCardio(candidate.cardio),
    plannerSetup: normalizePlannerSetup(candidate.plannerSetup),
    cautionAreas: normalizeCautionAreas(candidate.cautionAreas),
    body: normalizeBody(candidate.body),
    // No device-side cap on this list either; a small documented one is
    // enough here too. An installed app that predates the primary goal sends
    // goals without the flag, and it keeps sending them until the reader
    // updates. Rather than leaving the list headless, the newest goal — last
    // in the order the client appends them — takes the lead, which is what a
    // null stored choice resolves to anyway. That only holds if a cut over
    // the cap drops from the head: sliced from the front, a posted list
    // longer than MAX_GOALS kept the oldest goals and crowned goal number
    // MAX_GOALS primary, dropping the true newest one entirely (recheck
    // round, 2026-09-29).
    goals: withPrimaryGoal(boundedList(candidate.goals, normalizeGoal, MAX_GOALS, true)),
    profile: normalizeProfile(candidate.profile),
    homeState: normalizeHomeState(candidate.homeState),
    // Re-parsed rather than trusted. This runs on the endpoint, where the
    // payload is whatever was posted: the same bound the device applies has to
    // hold for a request the device did not write.
    coachMemory: parseCoachAdviceLines(candidate.coachMemory),
  };
}
