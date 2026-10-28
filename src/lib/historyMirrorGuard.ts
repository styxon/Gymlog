/**
 * The crash guard of the history mirror, as pure state transitions.
 *
 * A native module that dies while it opens a database takes the process with
 * it, and no try/catch sees that. So the attempt is written down BEFORE the
 * first open and taken off again once the first query came back. A launch that
 * finds the attempt still written knows the one before it died there. Two such
 * launches and the mirror is switched off for good: the app runs on the blob
 * alone, which is where the truth is anyway.
 *
 * The state lives in AsyncStorage (not in the database it guards, which may be
 * the broken thing) and holds nothing of the user's, so Reset leaves it be.
 * Whatever is read back is untrusted: a value that does not parse is the empty
 * state, never a throw.
 */
export interface MirrorGuardState {
  /** An open is in flight (or died in flight). 0 when none. */
  attempt: number;
  /** Launches that died with an attempt written. */
  crashes: number;
  /** Rebuilds that failed in a row. */
  rebuildFailures: number;
  /** The mirror is off for this install. */
  disabled: boolean;
  /** The mirror is behind the blob and must be rebuilt at the next start. */
  stale: boolean;
  /** A reset or account delete could not remove the history file; remove it before anything else. */
  purgePending: boolean;
}

export const MIRROR_GUARD_STORAGE_KEY = '@vinha/sqlite/guard/v1';
export const MIRROR_MAX_CRASHES = 2;
export const MIRROR_MAX_REBUILD_FAILURES = 3;

const COUNTER_CAP = 1000;

export function emptyMirrorGuard(): MirrorGuardState {
  return { attempt: 0, crashes: 0, rebuildFailures: 0, disabled: false, stale: false, purgePending: false };
}

function counter(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, COUNTER_CAP) : 0;
}

/** The state a stored value holds; the empty state for anything that is not one. */
export function parseMirrorGuard(raw: unknown): MirrorGuardState {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyMirrorGuard();
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return emptyMirrorGuard();
  }
  const record = value as Record<string, unknown>;
  return {
    attempt: counter(record.attempt),
    crashes: counter(record.crashes),
    rebuildFailures: counter(record.rebuildFailures),
    disabled: record.disabled === true,
    stale: record.stale === true,
    purgePending: record.purgePending === true,
  };
}

export function serializeMirrorGuard(state: MirrorGuardState): string {
  return JSON.stringify(state);
}

/**
 * A launch begins: an attempt still standing means the last launch died inside
 * the open. Counts it, and switches the mirror off at the limit.
 */
export function guardAtLaunch(state: MirrorGuardState): MirrorGuardState {
  if (state.attempt === 0) {
    return state;
  }
  const crashes = Math.min(state.crashes + 1, COUNTER_CAP);
  return { ...state, attempt: 0, crashes, disabled: state.disabled || crashes >= MIRROR_MAX_CRASHES };
}

/** Written before the first open. */
export function guardBeginOpen(state: MirrorGuardState): MirrorGuardState {
  return { ...state, attempt: 1 };
}

/** The open and the first query came back: nothing died. */
export function guardOpenSucceeded(state: MirrorGuardState): MirrorGuardState {
  return state.attempt === 0 ? state : { ...state, attempt: 0 };
}

/** The mirror fell behind the blob (or cannot be trusted); rebuild at the next start. */
export function guardMarkStale(state: MirrorGuardState): MirrorGuardState {
  return state.stale ? state : { ...state, stale: true };
}

/** A rebuild verified: caught up, and the failures in a row start again. */
export function guardRebuildSucceeded(state: MirrorGuardState): MirrorGuardState {
  return { ...state, attempt: 0, stale: false, rebuildFailures: 0, purgePending: false };
}

/** A rebuild (or the open before it) failed. The third in a row switches the mirror off. */
export function guardRebuildFailed(state: MirrorGuardState): MirrorGuardState {
  const rebuildFailures = Math.min(state.rebuildFailures + 1, COUNTER_CAP);
  return {
    ...state,
    attempt: 0,
    stale: true,
    rebuildFailures,
    disabled: state.disabled || rebuildFailures >= MIRROR_MAX_REBUILD_FAILURES,
  };
}

/** The file could not be removed on a reset; the next start (even a switched-off one) removes it. */
export function guardMarkPurgePending(state: MirrorGuardState): MirrorGuardState {
  return state.purgePending ? state : { ...state, purgePending: true };
}

/** The file is gone. */
export function guardPurgeDone(state: MirrorGuardState): MirrorGuardState {
  return state.purgePending ? { ...state, purgePending: false } : state;
}
