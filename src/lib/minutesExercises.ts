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
  // What a run block becomes for a reader who avoids their knees or ankles
  // (cautionExerciseFilter, RUN_STAND_INS): the same blocks, the same minutes.
  'Brisk Walk Blocks',
  'Incline Walk Blocks',
  'Stationary Bike Blocks',
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

const byProgrammeName = new Set<string>(PROGRAMME_MINUTES_NAMES.map(normalize));

/** Whether this exercise is logged in minutes rather than repetitions. */
export function isMinutesExerciseName(name: string | null | undefined): boolean {
  return typeof name === 'string' && byName.has(normalize(name));
}

/**
 * The longest single bout a number written without a unit is believed to be
 * minutes for. Two hours on a rower or an elliptical is already rare; "500"
 * or "2000" on one is metres, and "250" on a bike is calories or watts.
 */
export const LEGACY_MINUTES_PLAUSIBLE_MAX = 120;

/**
 * Activities done outdoors for hours: a long ride or a hike runs well past two
 * hours, and nothing on them shows metres to type in. Their line is the dial's
 * own ceiling (review, 2026-10-07).
 */
const LONG_BOUT_NAMES = new Set<string>(['Bicycling', 'Trail Running/Walking', 'Skating'].map(normalize));

/** The most a number written with no unit on this name is believed to be in minutes. */
function legacyMinutesMaxFor(name: string): number {
  return LONG_BOUT_NAMES.has(normalize(name)) ? MINUTES_DIAL.max : LEGACY_MINUTES_PLAUSIBLE_MAX;
}

/**
 * Whether numbers written with no unit, on an exercise with this name, read
 * as minutes.
 *
 * The ready programmes' own rows (Stairmaster (Moderate), the run blocks)
 * always do: the catalogue prescribed them in minutes before the unit
 * existed. The library's cardio machines were logged as repetitions until
 * 2026-10-06, so a reader typed whatever the machine showed — minutes, but
 * also metres or calories. Read by the name alone, a rower logged at 500
 * showed "500 min", and a programme row of 3 × 500 asked for 500 minutes
 * (#bugs 2026-10-07, the #330 trade-off). Those read as minutes only when
 * every number is one a bout of minutes could be; otherwise they stay the
 * plain count they were saved as.
 */
export function readsAsMinutesByName(
  name: string | null | undefined,
  counts: readonly number[],
): boolean {
  if (!isMinutesExerciseName(name)) {
    return false;
  }
  if (byProgrammeName.has(normalize(name as string))) {
    return true;
  }
  const max = legacyMinutesMaxFor(name as string);
  return counts.every((count) => !Number.isFinite(count) || count <= max);
}

/** The numbers a stored log wrote per set: its sets' when it has them, else repsPerSet. */
function loggedCounts(log: { sets?: unknown; repsPerSet?: unknown }): number[] {
  const fromSets = Array.isArray(log.sets)
    ? log.sets.map((set) => (set && typeof set === 'object' ? (set as { reps?: unknown }).reps : undefined))
    : [];
  const source = fromSets.length > 0 ? fromSets : Array.isArray(log.repsPerSet) ? log.repsPerSet : [];
  return source.filter((count): count is number => typeof count === 'number' && Number.isFinite(count));
}

/**
 * Whether a stored log's numbers are minutes.
 *
 * The log's own unit says so for anything saved since 2026-10-06; the name
 * says so for a log saved before the unit existed ("20" on a Stairmaster was
 * twenty minutes then too, it just carried no unit) — when its numbers could
 * be minutes at all (readsAsMinutesByName: "500" on a rower is metres).
 * Asking only one of the two let an old log read as twenty reps in one place
 * and twenty minutes in another, so every reader that has a log asks this. It
 * lives here, not in exerciseLog, because the name list is here and
 * exerciseLog sits below this module's imports (weightDial -> format ->
 * exerciseLog).
 */
export function isMinutesLogEntry(
  log:
    | { repsUnit?: unknown; exerciseNameSnapshot?: unknown; sets?: unknown; repsPerSet?: unknown }
    | null
    | undefined,
): boolean {
  if (!log) {
    return false;
  }
  if (log.repsUnit === 'minutes') {
    return true;
  }
  return (
    typeof log.exerciseNameSnapshot === 'string' && readsAsMinutesByName(log.exerciseNameSnapshot, loggedCounts(log))
  );
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
 * A bout's stopwatch as the session keeps it, with the set it belongs to.
 *
 * The clock used to live in the set screen's state alone, so anything that
 * mounted the screen again — Android killing the app twenty minutes into a
 * ride with the screen off, the player leaving and coming back — started it
 * from nothing, and the dial logged the prescription instead of the minutes
 * ridden (#bugs 2026-10-06). Kept on the session, it comes back with the
 * session, and the wall-clock start keeps it right across the gap.
 *
 * The set is named three ways: slot, set index and the exercise under the
 * slot, because a swap keeps the slot and the index and puts a different bout
 * there, whose clock is not this one.
 */
export interface SessionMinutesClock extends MinutesStopwatch {
  slotId: string;
  setIndex: number;
  exerciseName: string;
  /** The bout's prescription, so the idle nudge can wait for it (minutesBoutDueMs). */
  plannedMinutes: number;
}

/** A stored clock made safe to read; anything unusable is no clock. */
export function normalizeSessionMinutesClock(input: unknown): SessionMinutesClock | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const value = input as Record<string, unknown>;
  const finite = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate);
  if (
    typeof value.slotId !== 'string' ||
    typeof value.exerciseName !== 'string' ||
    !finite(value.setIndex) ||
    value.setIndex < 0 ||
    !finite(value.accumulatedMs) ||
    (value.runningSinceMs !== null && !finite(value.runningSinceMs))
  ) {
    return null;
  }
  return {
    slotId: value.slotId,
    setIndex: Math.floor(value.setIndex),
    exerciseName: value.exerciseName,
    accumulatedMs: Math.max(0, value.accumulatedMs),
    runningSinceMs: value.runningSinceMs as number | null,
    plannedMinutes: finite(value.plannedMinutes) && value.plannedMinutes > 0 ? value.plannedMinutes : 0,
  };
}

/** The session's clock if it is this set's, else a stopped one: a new set starts at zero. */
export function stopwatchForSet(
  clock: SessionMinutesClock | null | undefined,
  set: { slotId: string; setIndex: number; exerciseName: string },
): MinutesStopwatch {
  if (
    !clock ||
    clock.slotId !== set.slotId ||
    clock.setIndex !== set.setIndex ||
    clock.exerciseName !== set.exerciseName
  ) {
    return STOPPED_STOPWATCH;
  }
  return { accumulatedMs: clock.accumulatedMs, runningSinceMs: clock.runningSinceMs };
}

/**
 * The session's clock once the reader stands on `shown` — the set step on
 * screen, or null for any other step.
 *
 * Leaving a bout's step without logging it pauses the bout. Kept running, a
 * reader who started the bike, stepped on to look at the next lift and came
 * back an hour later logged sixty minutes with one tap (review, 2026-10-07).
 * Leaving is "I am doing something else"; coming back shows the minutes
 * ridden, paused, and the clock's button carries on from there. The app going
 * to the background or being reloaded is not leaving: the reader is still on
 * the step, and the clock keeps counting (#bugs 2026-10-06).
 *
 * The same clock back when nothing changes, so a caller can compare.
 */
export function minutesClockOnStep(
  clock: SessionMinutesClock | null | undefined,
  shown: { slotId: string; setIndex: number; exerciseName: string } | null,
  nowMs: number,
): SessionMinutesClock | null {
  if (!clock || clock.runningSinceMs === null) {
    return clock ?? null;
  }
  if (
    shown &&
    shown.slotId === clock.slotId &&
    shown.setIndex === clock.setIndex &&
    shown.exerciseName === clock.exerciseName
  ) {
    return clock;
  }
  return { ...clock, ...pauseStopwatch(clock, nowMs) };
}

/**
 * When a running bout's prescription runs out — the moment the reader is due
 * back at the phone. Null while the clock is stopped, or when there is none.
 *
 * The idle nudge ("still training?") is timed from the reader's last sign of
 * life, and a running clock is one that lasts: a 40-minute ride logs nothing
 * for 40 minutes, so the nudge fired 25 minutes into it (#bugs 2026-10-06).
 * Timed from this instead, it waits for the bout to be over.
 */
export function minutesBoutDueMs(clock: SessionMinutesClock | null | undefined): number | null {
  if (!clock || clock.runningSinceMs === null) {
    return null;
  }
  return clock.runningSinceMs + Math.max(0, clock.plannedMinutes * 60000 - clock.accumulatedMs);
}

/**
 * Until when a running bout counts as the reader training. Null while the
 * clock is stopped, or when there is none.
 *
 * A bout dispatches nothing while it runs, so to the session clock a two-hour
 * ride looked like the phone put away, and was taken off (lib/sessionClock
 * SESSION_IDLE_MS). It counts as far past its start as the minutes dial
 * reaches: further than that the dial cannot log, and the clock was left
 * running and forgotten (owner's call, 2026-10-07).
 */
export function minutesClockCountsUntilMs(clock: SessionMinutesClock | null | undefined): number | null {
  if (!clock || typeof clock.runningSinceMs !== 'number' || !Number.isFinite(clock.runningSinceMs)) {
    return null;
  }
  return clock.runningSinceMs + MINUTES_DIAL.max * 60000;
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
