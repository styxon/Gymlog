import type { AppDatabase } from '../types/models';

/**
 * The seam for a second copy of the history (workout sessions, exercise logs,
 * bodyweight, measurements, cardio) in a row store.
 *
 * The blob stays the truth. A mirror is told about a change only AFTER the
 * blob write for it has resolved, never before and never in place of it, and
 * nothing waits for the mirror: a mirror that is slow, broken or absent
 * changes nothing the reader sees or what lands in AsyncStorage.
 *
 * The default is no mirror. Everything here does nothing until a mirror is
 * installed with setHistoryMirror, so the app behaves as it did before the
 * seam existed.
 *
 * Contract for an implementation: it owns its own failure handling (it marks
 * itself stale and rebuilds on the next launch). The seam swallows what is
 * thrown, because a rejection here must never reach a caller of commit.
 * Ordering is guaranteed by the seam: calls reach the mirror one at a time, in
 * the order they were made, so an implementation needs no queue of its own and
 * is never called while an earlier call is still running.
 */
export interface HistoryMirror {
  /** A committed change from `previous` to `next`. */
  apply(previous: AppDatabase, next: AppDatabase): Promise<void>;
  /** The whole database was replaced (a backup restore, or its rollback). */
  replaceAll(next: AppDatabase): Promise<void>;
  /** Reset: forget everything. Awaited, so it is done before the reset write. */
  clear(): Promise<void>;
}

export const noopHistoryMirror: HistoryMirror = {
  async apply() {},
  async replaceAll() {},
  async clear() {},
};

let installed: HistoryMirror = noopHistoryMirror;

export function getHistoryMirror(): HistoryMirror {
  return installed;
}

/** Install a mirror; null puts the no-op back. */
export function setHistoryMirror(mirror: HistoryMirror | null) {
  installed = mirror ?? noopHistoryMirror;
}

/**
 * Every call to a mirror goes through one chain, so calls reach it one at a
 * time in the order they were made: a slow apply cannot be overtaken by a
 * later one, and a clear runs only after the notifications before it. An idle
 * chain starts the call at once (synchronously); a busy one starts it when the
 * call before it has settled. Each link swallows its own failure, so the chain
 * never rejects and one broken call does not stop the next.
 */
let tail: Promise<void> = Promise.resolve();
let pending = 0;

function enqueue(send: () => Promise<void>): Promise<void> {
  const run = (): Promise<void> => {
    try {
      return Promise.resolve(send()).catch(() => {});
    } catch {
      // A synchronous throw from the mirror is as harmless as a rejection.
      return Promise.resolve();
    }
  };
  const link = pending === 0 ? run() : tail.then(run);
  pending += 1;
  tail = link.then(() => {
    pending -= 1;
  });
  return tail;
}

/**
 * Tell the mirror about a committed change, without waiting for it. Returns at
 * once; a throw or a rejection is dropped. With no mirror installed it does
 * nothing at all.
 */
export function notifyHistoryMirror(send: (mirror: HistoryMirror) => Promise<void>): void {
  const mirror = installed;
  if (mirror === noopHistoryMirror) {
    return;
  }
  void enqueue(() => send(mirror));
}

/**
 * Empty the mirror for a reset. Returns null with nothing to wait for, so the
 * caller adds no await when no mirror is installed. The clear runs after every
 * notification made before it. A failure is dropped: the blob is the truth,
 * and a mirror that kept rows past a reset is found by its content hash on the
 * next launch and rebuilt from the (empty) blob.
 */
export function clearHistoryMirror(): Promise<void> | null {
  const mirror = installed;
  if (mirror === noopHistoryMirror) {
    return null;
  }
  return enqueue(() => mirror.clear());
}
