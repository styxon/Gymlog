import { MINUTES_DIAL } from './weightDial';

/**
 * Which exercises are steady work done for a time, logged in minutes
 * (trackingMode 'duration_minutes').
 *
 * The same shape as holdExercises.ts, on purpose — it is the precedent. The
 * ready programmes mark their rows `trackingMode: 'duration_minutes'` slot by
 * slot, and that is what a programme runs on. A name list is still needed for
 * every place that has only a name: a custom programme saved without a mode, a
 * swap from the sheet, a supplemental day the composer builds, a CSV row. Two
 * lists would drift, so there is one, and tests/lib/minutesTracking.test.cjs
 * holds the catalogues to it both ways: every row they write in minutes is on
 * it, and every name on it they prescribe is written in minutes.
 *
 * Steady work only. An interval ("Bike HIIT (45s sprint / 15s rest)") is
 * seconds and runs on the interval clock; a sprint or a sled push is a
 * distance; a stride is counted. None of those are here.
 */
const PROGRAMME_MINUTES_NAMES = [
  // Dream Body Female, Quads & Cardio: 1 × 20 min.
  'Stairmaster (Moderate)',
  // Prenatal Fitness, Low-Impact Cardio & Stability: 1 × 15 min.
  'Stationary Bike (Easy Pace)',
  // Run & Mobility and the summer season: 4 × 5 min and 5 × 4 min, with a
  // walk between blocks. The catalog's own progression rule says so: "Run
  // blocks progress by adding one block, never by running the same block
  // harder".
  'Easy Run Blocks',
  'Tempo Run Blocks',
] as const;

/**
 * The exercise library's steady-state cardio rows (sourceCategory 'cardio').
 * Their own instructions are a machine's menu or a trail — work done for a
 * time. Two of the library's fourteen cardio rows are not here: "Prowler
 * Sprint" is a distance pushed, and "Rope Jumping" is as often counted in
 * skips as timed, so the library's word alone does not settle it.
 */
const LIBRARY_MINUTES_NAMES = [
  'Bicycling',
  'Bicycling, Stationary',
  'Elliptical Trainer',
  'Jogging, Treadmill',
  'Recumbent Bike',
  'Rowing, Stationary',
  'Running, Treadmill',
  'Skating',
  'Stairmaster',
  'Step Mill',
  'Trail Running/Walking',
  'Walking, Treadmill',
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

const byName = new Set<string>([...PROGRAMME_MINUTES_NAMES, ...LIBRARY_MINUTES_NAMES].map(normalize));

/** Whether this exercise is logged in minutes rather than repetitions. */
export function isMinutesExerciseName(name: string | null | undefined): boolean {
  return typeof name === 'string' && byName.has(normalize(name));
}

/**
 * Whether a stored log's numbers are minutes.
 *
 * The log's own unit says so for anything saved since 2026-10-06; the name
 * says so for a log saved before the unit existed ("20" on a Stairmaster was
 * twenty minutes then too, it just carried no unit). Asking only one of the
 * two let an old log read as twenty reps in one place and twenty minutes in
 * another, so every reader that has a log asks this. It lives here, not in
 * exerciseLog, because the name list is here and exerciseLog sits below this
 * module's imports (weightDial -> format -> exerciseLog).
 */
export function isMinutesLogEntry(
  log: { repsUnit?: unknown; exerciseNameSnapshot?: unknown } | null | undefined,
): boolean {
  if (!log) {
    return false;
  }
  if (log.repsUnit === 'minutes') {
    return true;
  }
  return typeof log.exerciseNameSnapshot === 'string' && isMinutesExerciseName(log.exerciseNameSnapshot);
}

/** The names this module claims, exposed so a test can check the catalogues agree. */
export const MINUTES_EXERCISE_NAME_LIST: readonly string[] = [...PROGRAMME_MINUTES_NAMES, ...LIBRARY_MINUTES_NAMES];

/**
 * What a minutes exercise is prescribed at when nothing else says: one bout of
 * twenty minutes. Used where a slot is built from a name alone (the composer's
 * supplemental days) — a reps default there read "3 × 12" for a trail run.
 */
export const DEFAULT_MINUTES_PRESCRIPTION = { sets: 1, minutes: 20 } as const;


/**
 * The minutes to log for a bout the reader timed.
 *
 * - Untimed (the clock never ran): the prescription, as a reps set logs its
 *   target when the dial is left alone.
 * - Timed: the minutes on the clock, to the nearest whole one and never under
 *   one — a bout stopped at 14:40 is 15 minutes, and stopped at 0:20 it is
 *   still a minute of work rather than a set of nothing.
 * - Chosen: the reader's own number on the dial wins over both.
 */
export function minutesToLog(input: {
  plannedMinutes: number;
  elapsedMs: number;
  chosenMinutes?: number | null;
}): number {
  const clamp = (value: number) => Math.min(MINUTES_DIAL.max, Math.max(MINUTES_DIAL.min, Math.round(value)));
  if (typeof input.chosenMinutes === 'number' && Number.isFinite(input.chosenMinutes)) {
    return clamp(input.chosenMinutes);
  }
  if (Number.isFinite(input.elapsedMs) && input.elapsedMs > 0) {
    return clamp(input.elapsedMs / 60000);
  }
  return clamp(Number.isFinite(input.plannedMinutes) && input.plannedMinutes > 0 ? input.plannedMinutes : 1);
}

/**
 * A pausable stopwatch read off the wall clock, like the cardio timer
 * (lib/cardio ActiveCardioSession): the running stretch is a start time, not
 * accumulated ticks, so a bout keeps counting while Android has the screen
 * off and is right the moment the reader looks again.
 */
export interface MinutesStopwatch {
  accumulatedMs: number;
  /** When the current running stretch began; null while stopped. */
  runningSinceMs: number | null;
}

export const STOPPED_STOPWATCH: MinutesStopwatch = { accumulatedMs: 0, runningSinceMs: null };

export function stopwatchElapsedMs(watch: MinutesStopwatch, nowMs: number): number {
  const running = watch.runningSinceMs === null ? 0 : Math.max(0, nowMs - watch.runningSinceMs);
  return Math.max(0, watch.accumulatedMs + running);
}

export function startStopwatch(watch: MinutesStopwatch, nowMs: number): MinutesStopwatch {
  return watch.runningSinceMs === null ? { ...watch, runningSinceMs: nowMs } : watch;
}

export function pauseStopwatch(watch: MinutesStopwatch, nowMs: number): MinutesStopwatch {
  return watch.runningSinceMs === null
    ? watch
    : { accumulatedMs: stopwatchElapsedMs(watch, nowMs), runningSinceMs: null };
}

/**
 * How long until the stopwatch next changes something a reader can read
 * besides its own seconds: the whole minutes minutesToLog would log (it
 * switches at the half minute) or the planned minutes being reached. Null
 * while the watch is stopped — nothing moves.
 *
 * The guided player's screen needs those two and no more, so it sleeps until
 * this moment instead of re-rendering the whole set step on a ticking clock;
 * the seconds are drawn by a child that owns its own interval.
 */
export function msUntilNextMinutesChange(
  watch: MinutesStopwatch,
  nowMs: number,
  plannedMinutes: number,
): number | null {
  if (watch.runningSinceMs === null) {
    return null;
  }
  const elapsedMs = stopwatchElapsedMs(watch, nowMs);
  // Untimed reads as the prescription, so the first moment of time is a
  // change. From there the dial is never under one minute, so the next change
  // is the 1:30 mark, and after that each half minute past a whole one.
  const nextHalfMinute = Math.max(1.5, Math.floor(elapsedMs / 60000 - 0.5) + 1.5);
  let untilMs = elapsedMs <= 0 ? 1 : nextHalfMinute * 60000 - elapsedMs;
  if (Number.isFinite(plannedMinutes) && plannedMinutes > 0 && elapsedMs < plannedMinutes * 60000) {
    untilMs = Math.min(untilMs, plannedMinutes * 60000 - elapsedMs);
  }
  return Math.max(1, Math.ceil(untilMs));
}
