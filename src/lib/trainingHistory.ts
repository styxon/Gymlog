import { getCalendarWeekStartAfter, getRollingWindowStart, localDateKey } from './completedSessions';
import { getComparableLogSets } from './exerciseLog';
import { isHoldLogEntry } from './holdExercises';
import { isMinutesLogEntry } from './minutesExercises';
import { getTotalVolume } from './progression';
import { ExerciseLog, SetupWeekday, WorkoutSession } from '../types/models';
import { TrainingSchedule, trainsOn } from './trainingSchedule';

/**
 * The numeric layer under everything the coach says.
 *
 * This file holds no words. It turns logged sessions and sets into figures —
 * per-session volume, per-lift trajectories, week-by-week planned versus
 * actual — and leaves the phrasing to its callers. The coach sheet and the
 * analysis screen render these numbers as localized sentences; the AI context
 * payload sends them raw, because the model should be given evidence and asked
 * to write, not handed a finished sentence to repeat.
 *
 * Keeping the arithmetic here is what stops the two surfaces from drifting
 * apart and quietly disagreeing about the same workout.
 *
 * Names stay as stored — English exercise and session snapshots are
 * identifiers here, not labels.
 */

const DAY_MS = 86400000;

/** Eight weeks: the span a reader should be able to reconstruct from this. */
export const DEFAULT_HISTORY_WINDOW_DAYS = 56;

const WEEKDAY_BY_INDEX: SetupWeekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface SessionSummary {
  sessionId: string;
  name: string;
  performedAt: string;
  time: number;
  durationMinutes: number | null;
  /** Null when the session has no weighted work to total. */
  volumeKg: number | null;
  setCount: number;
  exerciseCount: number;
}

export interface LiftPoint {
  sessionId: string;
  performedAt: string;
  time: number;
  topSetWeightKg: number;
  topSetReps: number;
  /**
   * Reps of the sets done AT the top-set weight, in set order — what
   * "{weight} × {reps}" can honestly claim. A ramp's lighter sets and a
   * back-off's are not reps at the top weight.
   */
  setReps: number[];
  setCount: number;
  totalReps: number;
  volumeKg: number;
}

export interface LiftHistory {
  key: string;
  name: string;
  /** Oldest first. */
  points: LiftPoint[];
  first: LiftPoint;
  latest: LiftPoint;
  bestWeightKg: number;
  /** Latest top-set weight minus the first one. */
  weightChangeKg: number;
  spanDays: number;
  /**
   * How many of the most recent sessions share the latest top-set weight
   * since the last one that set a new rep best at it. A session that adds a
   * rep at the same weight is progress, not a stall: 60 × 6,6,6 then
   * 60 × 6,6,7 is double progression working, and calling it a plateau was a
   * lie (#bugs 2026-10-01). Getting back to an earlier best after a bad day
   * is not a new one, and neither is an extra set at the same reps.
   */
  stalledSessions: number;
}

/**
 * One point per session, the heaviest top set. LiftHistory keeps a point per
 * LOG for the charts, so a lift logged twice in one workout (custom
 * programme, added, swapped) counted as two sessions: "Same top set across 3
 * sessions" with 2, and a lock offered on a lift trained once (bug hunt,
 * 2026-10-04). Oldest first, as `points` is.
 */
export function sessionBestPoints(lift: Pick<LiftHistory, 'points'>): LiftHistory['points'] {
  const bySession = new Map<string, LiftHistory['points'][number]>();
  for (const point of lift.points) {
    const kept = bySession.get(point.sessionId);
    if (!kept || point.topSetWeightKg > kept.topSetWeightKg) {
      bySession.set(point.sessionId, point);
    }
  }
  return [...bySession.values()];
}

export interface RepsLiftPoint {
  sessionId: string;
  time: number;
  /** Completed reps per set, in set order. */
  reps: number[];
  /** The most reps in one set this session. */
  bestSetReps: number;
}

/**
 * A lift logged with no added load — pull-ups, push-ups, dips. Its progress is
 * reps, and LiftHistory cannot carry it: a top set needs a weight above zero.
 */
export interface RepsLiftHistory {
  key: string;
  name: string;
  /** Oldest first. */
  points: RepsLiftPoint[];
  first: RepsLiftPoint;
  latest: RepsLiftPoint;
  spanDays: number;
  /** How many of the most recent sessions share the latest best-set reps. */
  unchangedSessions: number;
}

export interface WeekSummary {
  /** Monday of the week, as a local YYYY-MM-DD date. */
  weekStart: string;
  sessions: number;
  volumeKg: number;
  /**
   * Sessions the schedule called for. Null without a fixed schedule; in the
   * running week it counts only the planned days that have already come round.
   */
  plannedSessions: number | null;
}

export interface ScheduleAdherence {
  trainingDays: SetupWeekday[];
  /** A rolling rhythm the weekday list cannot express; null for weekday plans. */
  cycle?: { onDays: number; offDays: number; length: number } | null;
  /** ISO date of the next training day on or after today. */
  nextTrainingDate?: string | null;
  plannedPerWeek: number;
  plannedSessions: number;
  completedSessions: number;
}

export interface TrainingHistory {
  windowDays: number;
  /** Oldest first, inside the window. */
  sessions: SessionSummary[];
  /** Most-trained lift first. */
  lifts: LiftHistory[];
  /** Lifts logged with no added load, most-trained first. */
  repsLifts: RepsLiftHistory[];
  /** Oldest first, including weeks with no training. */
  weeks: WeekSummary[];
  /** Null when the plan places the week itself, so nothing was promised. */
  adherence: ScheduleAdherence | null;
  totalVolumeKg: number;
  sessionCount: number;
}

export interface TrainingHistoryInput {
  sessions: WorkoutSession[];
  logs: ExerciseLog[];
  /** Weekdays the plan schedules; empty means the plan has no fixed days. */
  trainingDays?: SetupWeekday[];
  /**
   * The plan's real rhythm when known. Wins over `trainingDays`: a cycle
   * cannot be written as weekdays, and availability is not a plan.
   */
  schedule?: TrainingSchedule | null;
  windowDays?: number;
  now?: number;
}

export function normalizedName(value: string) {
  return value.trim().toLowerCase();
}

export function sessionTime(session: Pick<WorkoutSession, 'performedAt'>) {
  const time = new Date(session.performedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Heaviest completed set in a log, with its own reps, or null when nothing
 * usable was logged.
 *
 * It paired the log's heaviest weight with the most reps of ANY set: a ramp
 * of 100 × 3 and a back-off of 70 × 12 came out as "100 kg × 12", which went
 * into the plateau card and the coach's context as a set nobody did. The
 * heaviest set now keeps its own reps; at equal weight, the one with more.
 */
export function topSetOf(log: ExerciseLog): { weight: number; reps: number } | null {
  if (log.skipped) {
    return null;
  }

  let top: { weight: number; reps: number } | null = null;
  for (const set of getComparableLogSets(log)) {
    if (!(set.weight > 0) || !(set.reps > 0)) {
      continue;
    }
    if (!top || set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps)) {
      top = { weight: set.weight, reps: set.reps };
    }
  }
  return top;
}

export function completedReps(log: ExerciseLog) {
  return (log.repsPerSet ?? []).filter((count) => count > 0);
}

/**
 * Total lifted in a session. Prefers the stored total and recomputes for older
 * saves that predate it, so history does not thin out the further back it goes.
 */
export function sessionVolumeKg(session: WorkoutSession, logs: ExerciseLog[]) {
  if (typeof session.totalVolumeKg === 'number' && session.totalVolumeKg > 0) {
    return session.totalVolumeKg;
  }

  const own = logs.filter((log) => log.sessionId === session.id);
  const volume = own.reduce((sum, log) => sum + getTotalVolume(log), 0);
  return volume > 0 ? volume : null;
}

/**
 * Every session sharing a name with this one, up to and including it, oldest
 * first. "Compared with your last Push" only means something against Push.
 */
export function comparableSessions(session: WorkoutSession, sessions: WorkoutSession[]) {
  const key = normalizedName(session.workoutNameSnapshot);
  const until = sessionTime(session);
  return sessions
    .filter((entry) => normalizedName(entry.workoutNameSnapshot) === key)
    .filter((entry) => entry.id === session.id || sessionTime(entry) <= until)
    .sort((left, right) => sessionTime(left) - sessionTime(right));
}

/** The most recent session of the same name before this one, or null. */
export function previousComparableSession(session: WorkoutSession, sessions: WorkoutSession[]) {
  const earlier = comparableSessions(session, sessions).filter((entry) => entry.id !== session.id);
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

function startOfWeek(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  // Monday-first, matching the week strip the rest of the app draws.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function isoDate(time: number) {
  return localDateKey(time);
}

function summarizeSession(
  session: WorkoutSession,
  logsBySession: Map<string, ExerciseLog[]>,
  logs: ExerciseLog[],
): SessionSummary {
  const own = (logsBySession.get(session.id) ?? []).filter((log) => !log.skipped);
  const setCount = own.reduce((sum, log) => sum + completedReps(log).length, 0);

  return {
    sessionId: session.id,
    name: session.workoutNameSnapshot.trim(),
    performedAt: session.performedAt,
    time: sessionTime(session),
    durationMinutes:
      typeof session.durationMinutes === 'number' && session.durationMinutes > 0
        ? session.durationMinutes
        : null,
    volumeKg: sessionVolumeKg(session, logs),
    setCount,
    exerciseCount: own.length,
  };
}

function averageReps(point: LiftPoint): number {
  return point.setReps.length > 0
    ? point.setReps.reduce((sum, count) => sum + count, 0) / point.setReps.length
    : point.topSetReps;
}

/**
 * Within a run at one weight, oldest first: how many sessions since the last
 * one that beat every earlier session of the run — more reps on the top set,
 * or more per set at the top weight. Per set, not in total, so an extra set
 * at the same reps is not a gain.
 */
function sessionsSinceRepBest(run: LiftPoint[]): number {
  let bestTop = -1;
  let bestAverage = -1;
  let count = 0;
  for (const point of run) {
    const average = averageReps(point);
    if (point.topSetReps > bestTop || average > bestAverage + 1e-9) {
      count = 1;
    } else {
      count += 1;
    }
    bestTop = Math.max(bestTop, point.topSetReps);
    bestAverage = Math.max(bestAverage, average);
  }
  return Math.max(1, count);
}

/**
 * One point per session, oldest first. A lift logged twice in one workout is
 * merged the way `sessionsSinceRepBest` judges a gain — on top-set reps OR on
 * reps per set — so the merged point has the most top-set reps of any of the
 * session's logs and the per-set reps of the log with the best average. Keeping
 * one whole entry could drop the one that was the rep best.
 */
function collapseBySession(run: LiftPoint[]): LiftPoint[] {
  const bySession = new Map<string, LiftPoint>();
  for (const point of run) {
    const kept = bySession.get(point.sessionId);
    if (!kept) {
      bySession.set(point.sessionId, point);
      continue;
    }
    const best = averageReps(point) > averageReps(kept) ? point : kept;
    bySession.set(point.sessionId, {
      ...kept,
      topSetReps: Math.max(kept.topSetReps, point.topSetReps),
      setReps: best.setReps,
      setCount: best.setCount,
      totalReps: best.totalReps,
      volumeKg: best.volumeKg,
    });
  }
  return [...bySession.values()];
}

/**
 * The points behind `stalledSessions`, oldest first, one per session.
 * `stalledSessions` counts sessions while `points` has one entry per log, so
 * slicing `points` by the count would miss entries when a lift was logged twice
 * in a workout, and counting the logs would weight a duplicated session twice.
 * Every log of a session shares its date, so the first point still carries the
 * first stalled session's own date.
 */
export function stalledRunPoints(lift: Pick<LiftHistory, 'points' | 'stalledSessions'>): LiftPoint[] {
  const seen = new Set<string>();
  let start = lift.points.length;
  for (let index = lift.points.length - 1; index >= 0; index -= 1) {
    const id = lift.points[index].sessionId;
    if (!seen.has(id)) {
      if (seen.size >= lift.stalledSessions) {
        break;
      }
      seen.add(id);
    }
    start = index;
  }
  // The walk goes by session, so a lighter log of the first stalled session (a
  // lift logged at a lighter weight earlier in the same workout) sits inside the
  // slice. The run is the points at the run's weight, as `buildLiftHistories`
  // counts it.
  const latest = lift.points[lift.points.length - 1];
  const atRunWeight = latest
    ? lift.points.slice(start).filter((point) => Math.abs(point.topSetWeightKg - latest.topSetWeightKg) < 0.001)
    : [];
  return collapseBySession(atRunWeight);
}

/**
 * Per-lift trajectories across the given sessions, oldest point first.
 *
 * A lift only produces a point for a session where it was genuinely logged, so
 * the gaps in a series are real gaps rather than zeros.
 */
export function buildLiftHistories(
  sessions: WorkoutSession[],
  logs: ExerciseLog[],
): LiftHistory[] {
  const timeById = new Map(sessions.map((session) => [session.id, sessionTime(session)] as const));
  const buckets = new Map<string, { name: string; nameTime: number; points: LiftPoint[] }>();

  for (const log of logs) {
    const top = topSetOf(log);
    const time = timeById.get(log.sessionId);
    if (!top || time === undefined) {
      continue;
    }

    const reps = completedReps(log);
    const key = normalizedName(log.exerciseNameSnapshot);
    const bucket = buckets.get(key) ?? { name: '', nameTime: -1, points: [] };
    if (time >= bucket.nameTime) {
      // A renamed lift should read the way it does today.
      bucket.name = log.exerciseNameSnapshot.trim();
      bucket.nameTime = time;
    }
    bucket.points.push({
      sessionId: log.sessionId,
      performedAt: new Date(time).toISOString(),
      time,
      topSetWeightKg: top.weight,
      topSetReps: top.reps,
      setReps: getComparableLogSets(log)
        .filter((set) => set.reps > 0 && Math.abs(set.weight - top.weight) < 0.001)
        .map((set) => set.reps),
      setCount: reps.length,
      totalReps: reps.reduce((sum, count) => sum + count, 0),
      volumeKg: getTotalVolume(log),
    });
    buckets.set(key, bucket);
  }

  const histories: LiftHistory[] = [];

  for (const [key, bucket] of buckets) {
    const points = [...bucket.points].sort((left, right) => left.time - right.time);
    const first = points[0];
    const latest = points[points.length - 1];

    // The run at the latest weight, counted in SESSIONS: the same lift logged
    // twice in one workout is one session, not two (a plateau after two
    // workouts otherwise). `points` keeps one entry per log for the charts.
    let runStart = points.length - 1;
    while (
      runStart > 0 &&
      Math.abs(points[runStart - 1].topSetWeightKg - latest.topSetWeightKg) < 0.001
    ) {
      runStart -= 1;
    }
    const stalledSessions = sessionsSinceRepBest(collapseBySession(points.slice(runStart)));

    histories.push({
      key,
      name: bucket.name,
      points,
      first,
      latest,
      bestWeightKg: points.reduce((max, point) => Math.max(max, point.topSetWeightKg), 0),
      weightChangeKg: Math.round((latest.topSetWeightKg - first.topSetWeightKg) * 100) / 100,
      spanDays: Math.max(0, Math.round((latest.time - first.time) / DAY_MS)),
      stalledSessions,
    });
  }

  return histories.sort(
    (left, right) => right.points.length - left.points.length || right.latest.time - left.latest.time,
  );
}

/**
 * Per-lift rep trajectories for the lifts buildLiftHistories cannot see: every
 * set logged with no added load. A log with any weighted set belongs to the
 * weighted history instead, so no lift is counted in both.
 */
export function buildRepsLiftHistories(
  sessions: WorkoutSession[],
  logs: ExerciseLog[],
): RepsLiftHistory[] {
  const timeById = new Map(sessions.map((session) => [session.id, sessionTime(session)] as const));
  const buckets = new Map<string, { name: string; nameTime: number; points: RepsLiftPoint[] }>();

  // Decided per lift, not per log: pull-ups done bodyweight some days and
  // with a belt on others would otherwise get two lines under one name, each
  // from half the sessions, one "flat" and one "+3 reps" (review, #213). The
  // weighted history keeps a lift that has ever carried load.
  const weightedKeys = new Set(
    logs
      .filter((log) => timeById.has(log.sessionId) && topSetOf(log) !== null)
      .map((log) => normalizedName(log.exerciseNameSnapshot)),
  );

  for (const log of logs) {
    const time = timeById.get(log.sessionId);
    if (log.skipped || time === undefined || weightedKeys.has(normalizedName(log.exerciseNameSnapshot))) {
      continue;
    }
    // Minutes are not a rep trajectory: a bike ridden 15 then 20 minutes is
    // not "+5 reps" to the coach (2026-10-06). Nor is a plank held 45 then 60
    // seconds "+15 reps".
    if (isMinutesLogEntry(log) || isHoldLogEntry(log)) {
      continue;
    }
    const sets = getComparableLogSets(log).filter((set) => set.reps > 0);
    if (sets.length === 0 || sets.some((set) => set.weight > 0)) {
      continue;
    }

    const reps = sets.map((set) => set.reps);
    const key = normalizedName(log.exerciseNameSnapshot);
    const bucket = buckets.get(key) ?? { name: '', nameTime: -1, points: [] };
    if (time >= bucket.nameTime) {
      bucket.name = log.exerciseNameSnapshot.trim();
      bucket.nameTime = time;
    }
    bucket.points.push({ sessionId: log.sessionId, time, reps, bestSetReps: Math.max(...reps) });
    buckets.set(key, bucket);
  }

  const histories: RepsLiftHistory[] = [];
  for (const [key, bucket] of buckets) {
    const points = [...bucket.points].sort((left, right) => left.time - right.time);
    const first = points[0];
    const latest = points[points.length - 1];

    let unchangedSessions = 1;
    for (let index = points.length - 2; index >= 0; index -= 1) {
      if (points[index].bestSetReps !== latest.bestSetReps) {
        break;
      }
      unchangedSessions += 1;
    }

    histories.push({
      key,
      name: bucket.name,
      points,
      first,
      latest,
      spanDays: Math.max(0, Math.round((latest.time - first.time) / DAY_MS)),
      unchangedSessions,
    });
  }

  return histories.sort(
    (left, right) => right.points.length - left.points.length || right.latest.time - left.latest.time,
  );
}

function buildWeeks(
  sessions: SessionSummary[],
  trainingDays: SetupWeekday[],
  now: number,
  schedule: TrainingSchedule | null = null,
): WeekSummary[] {
  const isTrainingDay = (date: Date) =>
    schedule ? trainsOn(schedule, date) : trainingDays.includes(WEEKDAY_BY_INDEX[date.getDay()]);
  const hasPlan = schedule ? true : trainingDays.length > 0;
  if (sessions.length === 0) {
    return [];
  }

  const firstWeek = startOfWeek(sessions[0].time);
  const currentWeek = startOfWeek(now);
  const weeks: WeekSummary[] = [];
  const todayStart = new Date(now).setHours(0, 0, 0, 0);

  // Calendar stepping, not 7 * DAY_MS. A week containing a clock change is 167
  // or 169 hours long, so a fixed step drifts an hour off local Monday midnight
  // and then compounds: past a spring change the cursor overshoots currentWeek
  // and the loop exits before emitting the running week at all, and past an
  // autumn one every weekStart lands on the previous Sunday at 23:00, which
  // isoDate then names as the week and the planned-session cap reads as a week
  // already over.
  let weekStart = firstWeek;
  while (weekStart <= currentWeek) {
    // One value, used as this week's upper bound and as the next cursor, so the
    // two cannot drift apart if either is ever changed.
    const weekEnd = getCalendarWeekStartAfter(weekStart);
    const inWeek = sessions.filter((entry) => entry.time >= weekStart && entry.time < weekEnd);

    let plannedSessions: number | null = null;
    if (hasPlan) {
      // Count the week's days through the schedule, so a cycle's planned
      // count is the days it actually lands on, not a weekday tally. The
      // running week only promises up to today.
      let planned = 0;
      for (let offset = 0; offset < 7; offset += 1) {
        const dayStart = new Date(weekStart);
        dayStart.setDate(dayStart.getDate() + offset);
        if (weekStart >= currentWeek && dayStart.getTime() > todayStart) {
          break;
        }
        if (isTrainingDay(dayStart)) {
          planned += 1;
        }
      }
      plannedSessions = planned;
    }

    weeks.push({
      weekStart: isoDate(weekStart),
      sessions: inWeek.length,
      volumeKg: Math.round(inWeek.reduce((sum, entry) => sum + (entry.volumeKg ?? 0), 0)),
      plannedSessions,
    });

    weekStart = weekEnd;
  }

  return weeks;
}

export function buildTrainingHistory({
  sessions,
  logs,
  trainingDays = [],
  schedule = null,
  windowDays = DEFAULT_HISTORY_WINDOW_DAYS,
  now = Date.now(),
}: TrainingHistoryInput): TrainingHistory {
  // Calendar stepping, like the week rows above: a fixed windowDays * DAY_MS
  // puts the cutoff an hour off the time of day it claims for the six months
  // after every clock change, admitting a session from the far side of the
  // window or dropping one inside it.
  const cutoff = getRollingWindowStart(now, windowDays);
  const inWindow = sessions
    .filter((session) => sessionTime(session) >= cutoff)
    .sort((left, right) => sessionTime(left) - sessionTime(right));

  const logsBySession = new Map<string, ExerciseLog[]>();
  for (const log of logs) {
    const bucket = logsBySession.get(log.sessionId) ?? [];
    bucket.push(log);
    logsBySession.set(log.sessionId, bucket);
  }

  const summaries = inWindow.map((session) => summarizeSession(session, logsBySession, logs));
  const windowIds = new Set(inWindow.map((session) => session.id));
  const windowLogs = logs.filter((log) => windowIds.has(log.sessionId) && !log.skipped);
  const weeks = buildWeeks(summaries, trainingDays, now, schedule);

  const adherence: ScheduleAdherence | null = describeSchedule(schedule, trainingDays, weeks, summaries.length, now);

  return {
    windowDays,
    sessions: summaries,
    lifts: buildLiftHistories(inWindow, windowLogs),
    repsLifts: buildRepsLiftHistories(inWindow, windowLogs),
    weeks,
    adherence,
    totalVolumeKg: Math.round(summaries.reduce((sum, entry) => sum + (entry.volumeKg ?? 0), 0)),
    sessionCount: summaries.length,
  };
}

/** The next day on or after today the schedule trains on, as an ISO date. */
function nextTrainingDate(schedule: TrainingSchedule, now: number): string | null {
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (trainsOn(schedule, day)) {
      return isoDate(day.getTime());
    }
  }
  return null;
}

function describeSchedule(
  schedule: TrainingSchedule | null,
  trainingDays: SetupWeekday[],
  weeks: WeekSummary[],
  completedSessions: number,
  now: number,
): ScheduleAdherence | null {
  const plannedSessions = weeks.reduce((sum, week) => sum + (week.plannedSessions ?? 0), 0);
  if (schedule?.kind === 'cycle') {
    const onDays = schedule.pattern.filter(Boolean).length;
    const length = schedule.pattern.length;
    return {
      trainingDays: [],
      cycle: { onDays, offDays: length - onDays, length },
      nextTrainingDate: nextTrainingDate(schedule, now),
      plannedPerWeek: Math.round((7 * onDays) / length * 10) / 10,
      plannedSessions,
      completedSessions,
    };
  }
  if (schedule?.kind === 'weekdays') {
    // Monday first, and the sort is load-bearing rather than tidiness. The
    // schedule's own array is in PLAN ORDER — which session owns which day —
    // because that is what decides "is today session one" further up
    // (programTrainingDays.planWeekdayIndexes). This list is not that
    // question: it is the week read aloud, and it ends up in the coach's
    // system prompt as "3x/week on …". Left in plan order a programme adopted
    // on a Sunday described itself as "Sun, Wed, Fri", so two readers with the
    // same week got different sentences depending only on the day they
    // happened to start.
    const days = [...schedule.weekdayIndexes]
      .sort((left, right) => left - right)
      .map((index) => WEEKDAY_BY_INDEX[(index + 1) % 7]);
    if (days.length === 0) {
      return null;
    }
    return {
      trainingDays: days,
      cycle: null,
      nextTrainingDate: nextTrainingDate(schedule, now),
      plannedPerWeek: days.length,
      plannedSessions,
      completedSessions,
    };
  }
  if (trainingDays.length > 0) {
    return { trainingDays, plannedPerWeek: trainingDays.length, plannedSessions, completedSessions };
  }
  return null;
}
