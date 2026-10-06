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
