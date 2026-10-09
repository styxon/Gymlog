/**
 * How often the app may call its own server, as a pure function of when it
 * last did.
 *
 * Every request the phone sends costs money on the server's side (Vercel Pro
 * bills by use, not by cap). The calls are individually bounded - a tap, a
 * launch, a quiet pause after an edit - but a bug elsewhere can still make one
 * of those triggers fire again and again: a state update that changes the
 * data it is watching, an event raised from an effect. This is the ceiling
 * under all of them: a minimum gap, a budget per window, and a growing wait
 * after consecutive failures. A caller that is held back does not lose its
 * work; it asks again when `pacingWaitMs` says the wait is over.
 *
 * The clock is a parameter. Nothing here reads time or keeps state, so the
 * callers hold the `PacingState` (in a ref or a module variable) and the tests
 * can run a day of attempts in a loop.
 */

export interface PacingPolicy {
  /** Least time between the starts of two requests. */
  minGapMs: number;
  /** Requests allowed to start within any `windowMs`. */
  maxPerWindow: number;
  windowMs: number;
  /** Wait after the first of a run of failures; doubles with each further one. 0 = no failure backoff. */
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export interface PacingState {
  /** Start times of the most recent requests, oldest first; never more than the policy's budget. */
  sentAt: readonly number[];
  /** Failures since the last success. */
  failures: number;
  lastFailureAt: number | null;
}

export const EMPTY_PACING: PacingState = { sentAt: [], failures: 0, lastFailureAt: null };

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Usage events (features/analytics). Events are batched behind a 5 s wait, so
 * a healthy phone sends a handful of batches an hour; thirty is the ceiling a
 * runaway event loop meets. What does not go out stays in the queue (capped on
 * the device) and goes in the next batch. A failed batch waits a minute, then
 * two, up to a quarter of an hour.
 */
export const ANALYTICS_FLUSH_PACING: PacingPolicy = {
  minGapMs: 5_000,
  maxPerWindow: 30,
  windowMs: HOUR_MS,
  backoffBaseMs: MINUTE_MS,
  backoffMaxMs: 15 * MINUTE_MS,
};

/**
 * The automatic cloud backup (features/account/useAccountBackup). One backup
 * per quiet pause after an edit is the design; sixty an hour is a backup a
 * minute, which no reader editing by hand reaches. There is no failure backoff
 * here: a failed backup is retried by the next edit or return to the app,
 * never on its own, and the budget bounds even that.
 */
export const AUTO_BACKUP_PACING: PacingPolicy = {
  minGapMs: 0,
  maxPerWindow: 60,
  windowMs: HOUR_MS,
  backoffBaseMs: 0,
  backoffMaxMs: 0,
};

/**
 * The foreground retry of owed coach-log deletes (hooks/usePendingAiLogDeletions).
 * A server that keeps refusing is asked again on a return to the app, but not
 * on every one of them: half a minute after the first failure, doubling to a
 * quarter of an hour.
 */
export const AI_LOG_RETRY_PACING: PacingPolicy = {
  minGapMs: 0,
  maxPerWindow: 20,
  windowMs: HOUR_MS,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * MINUTE_MS,
};

/** The wait after `failures` failures in a row: 0 for none, then base, 2x base, 4x base... up to the cap. */
export function failureBackoffMs(failures: number, policy: Pick<PacingPolicy, 'backoffBaseMs' | 'backoffMaxMs'>): number {
  if (failures <= 0 || policy.backoffBaseMs <= 0) {
    return 0;
  }
  // 2^30 times any base is far past every cap; the clamp keeps the power finite.
  const doublings = Math.min(failures - 1, 30);
  return Math.min(policy.backoffMaxMs, policy.backoffBaseMs * 2 ** doublings);
}

/**
 * Milliseconds until a request may start: 0 when it may start now. The
 * largest of the minimum gap, the budget's next free slot and the failure
 * backoff. A start time in the future (the clock was set back) is forgotten:
 * it cannot be placed against the new clock, and clamping it to now on every
 * call re-anchored it each time, so the wait never counted down until the old
 * time had passed.
 */
export function pacingWaitMs(state: PacingState, policy: PacingPolicy, now: number): number {
  let waitUntil = now;

  const recent = state.sentAt.filter((at) => at <= now);
  const last = recent[recent.length - 1];
  if (last !== undefined) {
    waitUntil = Math.max(waitUntil, last + policy.minGapMs);
  }

  const inWindow = recent.filter((at) => at > now - policy.windowMs);
  if (inWindow.length >= policy.maxPerWindow) {
    // The oldest requests that still count leave the window first; the slot
    // opens when enough of them have left to get under the budget.
    const blocking = inWindow[inWindow.length - policy.maxPerWindow];
    waitUntil = Math.max(waitUntil, blocking + policy.windowMs);
  }

  if (state.failures > 0 && state.lastFailureAt !== null) {
    // A failure stamped after now is from before a set-back: its backoff has
    // no start to count from, so it is spent.
    if (state.lastFailureAt <= now) {
      waitUntil = Math.max(waitUntil, state.lastFailureAt + failureBackoffMs(state.failures, policy));
    }
  }

  return Math.max(0, Math.ceil(waitUntil - now));
}

/** The state after a request started at `now`. Keeps only as many starts as the budget can look back on. */
export function notePacingSent(state: PacingState, policy: PacingPolicy, now: number): PacingState {
  const kept = state.sentAt.filter((at) => at <= now && at > now - policy.windowMs);
  const sentAt = [...kept, now].slice(-Math.max(1, policy.maxPerWindow));
  return { ...state, sentAt };
}

/** The state after a request ended: a success clears the failure run, a failure extends it. */
export function notePacingOutcome(state: PacingState, succeeded: boolean, now: number): PacingState {
  if (succeeded) {
    return state.failures === 0 && state.lastFailureAt === null ? state : { ...state, failures: 0, lastFailureAt: null };
  }
  return { ...state, failures: state.failures + 1, lastFailureAt: now };
}
