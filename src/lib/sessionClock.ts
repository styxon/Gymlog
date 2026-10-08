import type { WorkoutRestTimerState, WorkoutSessionRuntime } from '../features/workout/workoutTypes';
import { minutesClockCountsUntilMs } from './minutesExercises';

/**
 * A running session's clock, read at a given moment.
 *
 * These lived in the workout reducer's module, so anything that only needed to
 * know how long a workout ran — the adapter that saves it — loaded the reducer
 * and the whole catalog with it. They read a session and a time and nothing
 * else.
 */

/**
 * The longest stretch with nothing done in it that still counts as training.
 *
 * Nothing in a guided session waits this long by itself: a rest is minutes, a
 * drill is seconds, a hold tops out at the hold dial's thirty minutes, and a
 * bout on the minutes clock counts while it runs (sessionLastActiveMs). A
 * stretch past it is the phone put away — the app closed between
 * two sets and opened the next morning — and counting it saved a workout of
 * two evening sets and a morning's worth more as 921 minutes (live-session
 * audit, 2026-09-20).
 *
 * Two hours and not one, because a warm-up or cool-down done the reader's own
 * way tells the store nothing until it ends, and an hour on the bike as a
 * cool-down is a cool-down (PR review). The same two hours the finish allows
 * after the last set (workoutAppAdapter's STALE_FINISH_MS).
 */
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * Wall time since the start, less every pause — including one still open —
 * and less a stretch still running with nothing done in it for longer than
 * SESSION_IDLE_MS. That stretch is taken off for good at the next thing done
 * (settleSessionClock); left in until then, the clock on a phone picked up the
 * next morning read fifteen hours, and dropped back at the first tap.
 */
export function elapsedSecondsOf(session: WorkoutSessionRuntime, nowMs: number): number {
  const open = session.pausedAt ? Math.max(0, nowMs - new Date(session.pausedAt).getTime()) : 0;
  const wall = nowMs - new Date(session.startedAt).getTime();
  return Math.max(0, Math.floor((wall - (session.pausedMs ?? 0) - open - openIdleMs(session, nowMs)) / 1000));
}

/** The idle stretch running at `nowMs`, when it is long enough not to count. */
function openIdleMs(session: WorkoutSessionRuntime, nowMs: number): number {
  // An open pause already stops the clock; taking the same time off twice
  // would run it backwards.
  if (session.pausedAt) {
    return 0;
  }
  const lastActiveMs = sessionLastActiveMs(session, nowMs);
  if (!Number.isFinite(lastActiveMs)) {
    return 0;
  }
  const idleMs = nowMs - lastActiveMs;
  return idleMs > SESSION_IDLE_MS ? idleMs : 0;
}

export function latestCompletedSetMs(session: WorkoutSessionRuntime): number {
  let latest = -Infinity;
  session.exercises.forEach((exercise) => {
    exercise.sets.forEach((set) => {
      const time = set.status === 'completed' && set.completedAt ? Date.parse(set.completedAt) : Number.NaN;
      if (Number.isFinite(time) && time > latest) {
        latest = time;
      }
    });
  });
  return latest;
}

/**
 * How long the workout ran up to `endMs`, pauses off.
 *
 * When the end is the last logged set rather than the finish (a session left
 * open and reopened days later), only the pauses that had run by that set come
 * off — `pausedMs` by then also holds the days it sat paused, and subtracting
 * all of it saved a 48-minute workout as one minute (PR #120 review).
 */
export function workoutSecondsUntil(session: WorkoutSessionRuntime, endMs: number): number {
  const lastSetMs = latestCompletedSetMs(session);
  if (Number.isFinite(lastSetMs) && endMs <= lastSetMs) {
    const wall = endMs - new Date(session.startedAt).getTime();
    const stamped = session.pausedMsAtLastSet;
    if (typeof stamped === 'number' && Number.isFinite(stamped) && stamped >= 0) {
      return Math.max(0, Math.floor((wall - stamped) / 1000));
    }
    // A session from before the stamp was kept. Its pauses are right unless
    // they swallow the whole window — sets were logged in it, so time was
    // spent unpaused — and then they ran past it, and the wall clock is the
    // better answer.
    const counted = elapsedSecondsOf(session, endMs);
    return counted > 0 ? counted : Math.max(0, Math.floor(wall / 1000));
  }
  return elapsedSecondsOf(session, endMs);
}

/** Whether a rest the clock is counting has run out by `nowMs`. */
export function restTimerHasEnded(timer: WorkoutRestTimerState, nowMs: number): boolean {
  return timer.status === 'running' && typeof timer.endsAtMs === 'number' && nowMs >= timer.endsAtMs;
}

/** Whole seconds left on a running rest, at `nowMs`. */
export function restSecondsLeft(timer: WorkoutRestTimerState, nowMs: number): number {
  if (timer.status !== 'running' || typeof timer.endsAtMs !== 'number') {
    return 0;
  }
  return Math.max(0, Math.ceil((timer.endsAtMs - nowMs) / 1000));
}

/**
 * The last moment the session was in use, as of `nowMs`.
 *
 * `updatedAt` moves with every action. A rest is time in the workout too, and
 * the shared clock used to move `updatedAt` every second while one ran — which
 * re-rendered the whole app once a second to keep a timestamp current. The
 * rest is read here instead: an active session resting counts as in use up to
 * now, or up to the rest's end if that has passed.
 *
 * A bout on the minutes clock is the same: nothing is dispatched while it
 * runs, so a ride past SESSION_IDLE_MS was taken off as time away and the
 * workout saved as one minute (hunt, 2026-10-07). It counts up to now, or up
 * to the furthest its dial can log (minutesClockCountsUntilMs), so a clock
 * left running and forgotten does not count for ever.
 */
export function sessionLastActiveMs(session: WorkoutSessionRuntime, nowMs: number): number {
  const updatedMs = Date.parse(session.updatedAt);
  const base = Number.isFinite(updatedMs) ? updatedMs : -Infinity;
  if (session.status !== 'active') {
    return base;
  }
  let lastActiveMs = base;
  // Read on the finish path, which must not throw on a session built without a timer.
  const timer: WorkoutRestTimerState | null | undefined = session.restTimer;
  if (timer?.status === 'running' && typeof timer.endsAtMs === 'number') {
    lastActiveMs = Math.max(lastActiveMs, Math.min(nowMs, timer.endsAtMs));
  }
  const boutUntilMs = minutesClockCountsUntilMs(session.minutesClock);
  if (boutUntilMs !== null) {
    lastActiveMs = Math.max(lastActiveMs, Math.min(nowMs, boutUntilMs));
  }
  return lastActiveMs;
}

/**
 * Whether the reader has started the session: stepped into the player, or
 * settled a set.
 *
 * "Start" on a programme day builds the session and opens its overview, and
 * the overview is reading, not training. Read defensively: a stored session
 * is only as whole as the build that wrote it.
 */
export function sessionHasBegun(session: WorkoutSessionRuntime): boolean {
  if (typeof session.ui?.guidedStepIndex === 'number') {
    return true;
  }
  return (session.exercises ?? []).some((exercise) =>
    (exercise.sets ?? []).some((set) => set.status !== 'pending'),
  );
}

/**
 * The session clock after one change to the session, `before` to `after`.
 *
 * Every change that is the reader doing something — a set logged, a step
 * moved on, a swap — moves `updatedAt` to when it happened, and the clock is
 * settled against that. Two rules, both about time that is not the workout:
 *
 * - It starts at the first step. The clock used to start when "Start" built
 *   the session, while the reader was still on the overview; one read in the
 *   morning, closed with X and resumed at six in the evening saved 35 minutes
 *   of training as 633 (live-session audit, 2026-09-20). The first step into
 *   the player, or the first set settled, is when the workout began, so
 *   `startedAt` moves there and nothing before it counts.
 * - A stretch longer than SESSION_IDLE_MS with nothing done in it is time
 *   away, and comes off like a pause at the first thing done after it. A rest
 *   still running counts as in use up to its end (sessionLastActiveMs); a
 *   stretch spent paused is already off, so it is not taken off again.
 *
 * Kept in the pause total rather than a field of its own, so the clock on
 * screen, the summary and the saved duration — all of which read
 * `pausedMs` — take it off without being told about it.
 */
export function settleSessionClock(
  before: WorkoutSessionRuntime | null,
  after: WorkoutSessionRuntime | null,
): WorkoutSessionRuntime | null {
  if (!before || !after || before === after || before.sessionId !== after.sessionId || after.status === 'completed') {
    return after;
  }
  const atMs = Date.parse(after.updatedAt);
  if (!Number.isFinite(atMs)) {
    return after;
  }

  if (!sessionHasBegun(before)) {
    if (!sessionHasBegun(after) || !(atMs > Date.parse(before.startedAt))) {
      return after;
    }
    const at = new Date(atMs).toISOString();
    return {
      ...after,
      startedAt: at,
      pausedMs: 0,
      pausedAt: after.pausedAt ? at : null,
      ...(typeof after.pausedMsAtLastSet === 'number' ? { pausedMsAtLastSet: 0 } : {}),
    };
  }

  if (before.pausedAt) {
    return after;
  }
  const lastActiveMs = sessionLastActiveMs(before, atMs);
  const idleMs = Number.isFinite(lastActiveMs) ? atMs - lastActiveMs : 0;
  if (idleMs <= SESSION_IDLE_MS) {
    return after;
  }
  // A set logged by this very change came after the gap, so the pause total
  // stamped on it (workoutSecondsUntil) has to hold the gap as well.
  const loggedNow = latestCompletedSetMs(after) > latestCompletedSetMs(before);
  return {
    ...after,
    pausedMs: (after.pausedMs ?? 0) + idleMs,
    ...(loggedNow && typeof after.pausedMsAtLastSet === 'number'
      ? { pausedMsAtLastSet: after.pausedMsAtLastSet + idleMs }
      : {}),
  };
}
