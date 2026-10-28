import { accountBackupFingerprint } from '../../lib/accountBackup';
import { diffHistory, isHistoryDiffEmpty } from '../../lib/historyDiff';
import {
  hashHistoryCollection,
  historyContentHash,
  type CollectionHash,
} from '../../lib/historyContentHash';
import {
  guardAtLaunch,
  guardBeginOpen,
  guardMarkPurgePending,
  guardMarkStale,
  guardPurgeDone,
  guardOpenSucceeded,
  guardRebuildFailed,
  guardRebuildSucceeded,
} from '../../lib/historyMirrorGuard';
import { HISTORY_COLLECTIONS, type HistoryCollection } from '../../lib/historyRowCodec';
import { createSerialTaskQueue } from '../../lib/serialTaskQueue';
import type { WorkoutHistoryStore } from '../../features/workout/workoutTypes';
import type { AppDatabase } from '../../types/models';
import { setHistoryMirror, type HistoryMirror } from '../historyMirror';
import { readMirrorGuard, updateMirrorGuard, type GuardStore } from './guardStore';
import { SQLITE_MIRROR_ENABLED } from './mirrorConfig';
import { ensureMirrorSchema, readMirrorMeta, writeMirrorMeta } from './mirrorSchema';
import {
  applyHistoryDiff,
  bindRowKeys,
  deleteAllRows,
  emptyRowKeyMaps,
  hashStoredCollection,
  MirrorOutOfSyncError,
  pickHistory,
  readBackAndCompare,
  writeAllRows,
  type HistorySlice,
  type RowKeyMaps,
} from './historyRowStore';
import type { SqlDriver, SqlOpener } from './sqlDriver';

/**
 * The SQLite copy of the history, kept beside the blob that stays the truth.
 *
 * What this is for, and what it never does:
 * - It is told of a change only after the blob write resolved (the seam in
 *   storage/historyMirror), and nothing waits for it. A failure here is
 *   swallowed and marks the mirror stale; it can never fail a commit.
 * - It is rebuilt from the in-memory database, never from the raw blob, so the
 *   normalizer's work (split rows, preference overlay, dropped junk) is what
 *   lands in it, and a half-read blob is never copied as if it were whole.
 * - It reads nothing for the app. Memory is loaded from the blob exactly as
 *   before; this class only writes and checks.
 * - All of its work runs in one serial queue, so a rebuild and a commit's
 *   apply never interleave.
 *
 * Start (once per launch, after the app is usable): the crash guard, open,
 * compare the stored rows with memory, and rebuild when they differ. The
 * comparison reads the rows themselves, not a fingerprint kept beside them,
 * so an edit the diff missed (a row changed in place) shows up here.
 */
export type MirrorStartStatus = 'disabled' | 'unchanged' | 'rebuilt' | 'failed';

export interface MirrorStartResult {
  status: MirrorStartStatus;
  /** Why a rebuild ran (or failed): 'stale', 'state:absent', 'content', 'replaceAll', ... */
  reason: string | null;
  /** Rows per collection in the mirror after the start, or null when it is not usable. */
  counts: Record<HistoryCollection, number> | null;
  durationMs: number;
}

export interface SqliteHistoryMirrorDeps {
  opener: SqlOpener;
  guardStore: GuardStore;
  /** The newest in-memory database. Read inside the queue, so a rebuild never copies an older one. */
  getDatabase: () => AppDatabase;
  now?: () => number;
  /** Lets the UI breathe between collections and pages. Defaults to a zero timeout. */
  yieldToUi?: () => Promise<void>;
}

export interface SqliteHistoryMirror extends HistoryMirror {
  start(): Promise<MirrorStartResult>;
  /** Close the connection. The mirror does nothing afterwards. */
  close(): Promise<void>;
}

const NO_WORKOUT_HISTORY: WorkoutHistoryStore = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createSqliteHistoryMirror(deps: SqliteHistoryMirrorDeps): SqliteHistoryMirror {
  const { opener, guardStore, getDatabase } = deps;
  const now = deps.now ?? (() => Date.now());
  const yieldToUi = deps.yieldToUi ?? defaultYield;
  const runExclusive = createSerialTaskQueue();

  let driver: SqlDriver | null = null;
  /** The store holds exactly `mirrored`, and rows can be found for its items. */
  let ready = false;
  let switchedOff = false;
  /** A reset could not remove the file: the next start, switched off or not, removes it first. */
  let purgePending = false;
  let closed = false;
  let mirrored: HistorySlice | null = null;
  let rowKeys: RowKeyMaps = emptyRowKeyMaps();

  async function markStale(): Promise<void> {
    ready = false;
    try {
      await updateMirrorGuard(guardStore, guardMarkStale);
    } catch {
      // The guard cannot be written either; the next start compares the rows and finds out.
    }
  }

  async function discardDriver(): Promise<void> {
    const old = driver;
    driver = null;
    ready = false;
    if (old) {
      try {
        await old.close();
      } catch {
        // Closing a broken connection may fail; it is gone either way.
      }
    }
  }

  /**
   * Fold the log into the file and truncate it, so rows that were deleted are
   * not left recoverable in the -wal file. False when it failed or came back
   * busy (the result row says so without throwing); the caller decides if that matters.
   */
  async function checkpoint(connection: SqlDriver): Promise<boolean> {
    try {
      const rows = await connection.all<{ busy?: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
      return !rows.some((row) => Number(row.busy) !== 0);
    } catch {
      return false;
    }
  }

  /** Remove the history file after a reset that could not. True when nothing is left to remove. */
  async function purgeFile(): Promise<boolean> {
    if (!opener.destroy) {
      return true;
    }
    try {
      await opener.destroy();
    } catch {
      return false;
    }
    return true;
  }

  async function retryPurge(): Promise<void> {
    if (!purgePending || !(await purgeFile())) {
      return;
    }
    purgePending = false;
    try {
      await updateMirrorGuard(guardStore, guardPurgeDone);
    } catch {
      // The flag left behind only costs one more removal of a file that is already gone.
    }
  }

  /** Open, set up the schema, read the meta rows: the first query. One retry on a fresh file. */
  async function openPrepared(): Promise<{ connection: SqlDriver; meta: Record<string, string> }> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let connection: SqlDriver | null = null;
      try {
        connection = await opener.open();
        await ensureMirrorSchema(connection);
        const meta = await readMirrorMeta(connection);
        return { connection, meta };
      } catch (error) {
        lastError = error;
        if (connection) {
          try {
            await connection.close();
          } catch {
            // Gone either way.
          }
        }
        if (attempt === 0 && opener.destroy) {
          // A file that is not a database, or half made: removed and made again, never kept aside.
          try {
            await opener.destroy();
          } catch {
            // Falls through to the second attempt, which then fails with its own error.
          }
        } else {
          break;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('history mirror: open failed');
  }

  async function memoryHashes(snapshot: HistorySlice): Promise<Record<HistoryCollection, CollectionHash>> {
    const parts = {} as Record<HistoryCollection, CollectionHash>;
    for (const collection of HISTORY_COLLECTIONS) {
      parts[collection] = hashHistoryCollection(snapshot[collection] ?? []);
      await yieldToUi();
    }
    return parts;
  }

  /** Does the store hold exactly this snapshot? Reads the rows, not a fingerprint kept beside them. */
  async function storeMatches(connection: SqlDriver, snapshot: HistorySlice): Promise<boolean> {
    const memory = await memoryHashes(snapshot);
    for (const collection of HISTORY_COLLECTIONS) {
      const stored = await hashStoredCollection(connection, collection, yieldToUi);
      if (stored.count !== memory[collection].count || stored.hash !== memory[collection].hash) {
        return false;
      }
    }
    return true;
  }

  /**
   * Make the store hold `snapshot` and prove it. The marker 'writing' is
   * committed before the rows and 'verified' only after a second connection
   * has read everything back, so a kill anywhere leaves a store that says so.
   */
  async function rebuild(snapshot: HistorySlice, full: AppDatabase, reason: string): Promise<void> {
    const connection = driver;
    if (!connection) {
      throw new Error('history mirror: no connection');
    }
    ready = false;
    const before = await readMirrorMeta(connection);
    const rebuildCount = Math.min((Number.parseInt(before.rebuild_count ?? '0', 10) || 0) + 1, 1_000_000);
    await connection.transaction((tx) =>
      writeMirrorMeta(tx, {
        state: 'writing',
        rebuild_count: String(rebuildCount),
        last_rebuild_reason: reason,
      }),
    );

    await connection.transaction(async (tx) => {
      await writeAllRows(tx, snapshot, yieldToUi);
    });

    const verifier = await opener.open();
    try {
      const items = await readBackAndCompare(verifier, snapshot, yieldToUi);
      const memoryFingerprint = accountBackupFingerprint(full, NO_WORKOUT_HISTORY);
      const storeFingerprint = accountBackupFingerprint({ ...full, ...items }, NO_WORKOUT_HISTORY);
      if (memoryFingerprint !== storeFingerprint) {
        throw new MirrorOutOfSyncError('backup fingerprint differs between memory and the store');
      }
      // The rows were compared text for text above, so the content hash of the store is the memory's by construction.
      const memoryHash = historyContentHash(snapshot);
      await connection.transaction((tx) =>
        writeMirrorMeta(tx, {
          state: 'verified',
          content_hash: memoryHash.combined,
          counts: JSON.stringify(memoryHash.counts),
          migrated_at: new Date(now()).toISOString(),
        }),
      );
    } finally {
      try {
        await verifier.close();
      } catch {
        // The verifying connection was only read from.
      }
    }

    // Rows the rebuild replaced must not stay readable in the log. A busy checkpoint fails the
    // rebuild, so the guard stays stale and the next start tries again.
    if (!(await checkpoint(connection))) {
      throw new Error('history mirror: checkpoint after rebuild did not finish');
    }

    await bindRowKeys(connection, snapshot, (rowKeys = emptyRowKeyMaps()));
    mirrored = pickHistory(snapshot);
    ready = true;
  }

  /** A rebuild with its bookkeeping: the guard learns of the outcome. */
  async function rebuildAndRecord(full: AppDatabase, reason: string): Promise<MirrorStartResult> {
    const startedAt = now();
    const snapshot = pickHistory(full);
    try {
      await rebuild(snapshot, full, reason);
      try {
        await updateMirrorGuard(guardStore, guardRebuildSucceeded);
      } catch {
        // A stale flag left behind only costs one extra check at the next start.
      }
      const counts = {} as Record<HistoryCollection, number>;
      for (const collection of HISTORY_COLLECTIONS) {
        counts[collection] = snapshot[collection].length;
      }
      return { status: 'rebuilt', reason, counts, durationMs: now() - startedAt };
    } catch {
      ready = false;
      let guard = null;
      try {
        guard = await updateMirrorGuard(guardStore, guardRebuildFailed);
      } catch {
        // See markStale.
      }
      if (guard?.disabled) {
        switchedOff = true;
        await discardDriver();
      }
      return { status: 'failed', reason, counts: null, durationMs: now() - startedAt };
    }
  }

  async function startInQueue(): Promise<MirrorStartResult> {
    const startedAt = now();
    if (closed || switchedOff) {
      if (!closed) {
        await retryPurge();
      }
      return { status: 'disabled', reason: 'switched-off', counts: null, durationMs: 0 };
    }
    if (driver && ready) {
      return { status: 'unchanged', reason: null, counts: null, durationMs: 0 };
    }
    // A connection left from a failed run is not reused: the start opens afresh.
    await discardDriver();

    // The crash guard: count a launch that died inside the open, then write the attempt BEFORE opening.
    let guard;
    try {
      guard = await readMirrorGuard(guardStore);
    } catch {
      return { status: 'failed', reason: 'guard-unreadable', counts: null, durationMs: now() - startedAt };
    }
    const afterLaunch = guardAtLaunch(guard);
    guard = afterLaunch;
    if (guard.purgePending) {
      purgePending = true;
    }
    if (guard.disabled) {
      switchedOff = true;
      try {
        await updateMirrorGuard(guardStore, () => afterLaunch);
      } catch {
        // Off for this launch regardless.
      }
      await retryPurge();
      return { status: 'disabled', reason: 'crash-guard', counts: null, durationMs: now() - startedAt };
    }
    try {
      guard = await updateMirrorGuard(guardStore, () => guardBeginOpen(afterLaunch));
    } catch {
      // Without the attempt on disk a crash would not be counted: do not open.
      return { status: 'failed', reason: 'guard-unwritable', counts: null, durationMs: now() - startedAt };
    }

    let prepared: { connection: SqlDriver; meta: Record<string, string> };
    try {
      prepared = await openPrepared();
    } catch {
      let failed = null;
      try {
        failed = await updateMirrorGuard(guardStore, guardRebuildFailed);
      } catch {
        // See markStale.
      }
      if (failed?.disabled) {
        switchedOff = true;
      }
      return { status: 'failed', reason: 'open', counts: null, durationMs: now() - startedAt };
    }
    driver = prepared.connection;
    try {
      guard = await updateMirrorGuard(guardStore, guardOpenSucceeded);
    } catch {
      // Cleared at the end of the next successful rebuild at the latest.
    }

    const full = getDatabase();
    const snapshot = pickHistory(full);
    let reason: string | null = null;
    if (guard.stale) {
      reason = 'stale';
    } else if (prepared.meta.state !== 'verified') {
      reason = `state:${prepared.meta.state ?? 'absent'}`;
    } else {
      try {
        if (!(await storeMatches(prepared.connection, snapshot))) {
          reason = 'content';
        }
      } catch {
        reason = 'unreadable';
      }
    }
    if (reason === null) {
      try {
        await bindRowKeys(prepared.connection, snapshot, (rowKeys = emptyRowKeyMaps()));
        mirrored = snapshot;
        ready = true;
        const counts = {} as Record<HistoryCollection, number>;
        for (const collection of HISTORY_COLLECTIONS) {
          counts[collection] = snapshot[collection].length;
        }
        return { status: 'unchanged', reason: null, counts, durationMs: now() - startedAt };
      } catch {
        reason = 'unreadable';
      }
    }
    return rebuildAndRecord(full, reason);
  }

  async function applyInQueue(next: AppDatabase): Promise<void> {
    const connection = driver;
    if (!connection || !ready || !mirrored || switchedOff || closed) {
      // Not started, or behind: the start's comparison covers whatever this would have written.
      return;
    }
    try {
      const target = pickHistory(next);
      const diff = diffHistory(mirrored, target);
      if (isHistoryDiffEmpty(diff)) {
        mirrored = target;
        return;
      }
      let outcome: { deleted: boolean; commit: () => void } | null = null;
      await connection.transaction(async (tx) => {
        outcome = await applyHistoryDiff(tx, diff, target, rowKeys, yieldToUi);
      });
      const applied = outcome as { deleted: boolean; commit: () => void } | null;
      applied?.commit();
      mirrored = target;
      if (applied?.deleted) {
        await checkpoint(connection);
      }
    } catch {
      await markStale();
    }
  }

  async function replaceAllInQueue(next: AppDatabase): Promise<void> {
    if (!driver || switchedOff || closed) {
      // Not started, or off: a rebuild here would fail on "no connection" and count toward the kill switch.
      return;
    }
    // A failed rebuild leaves the guard stale (rebuildAndRecord), so the next start tries again.
    await rebuildAndRecord(next, 'replaceAll');
  }

  async function clearInQueue(): Promise<void> {
    if (closed) {
      return;
    }
    const connection = driver;
    if (!connection || switchedOff) {
      // Nothing open (or not allowed to open): the file itself goes, so no row of a reset database survives.
      if (!(await purgeFile())) {
        // Remembered in the guard, because a switched-off start never reads the rows: it retries the removal.
        purgePending = true;
        try {
          await updateMirrorGuard(guardStore, guardMarkPurgePending);
        } catch {
          // The in-memory flag still covers this launch; the next start compares the rows if it opens at all.
        }
      }
      return;
    }
    try {
      const empty = pickHistory({
        workoutSessions: [],
        exerciseLogs: [],
        bodyweightEntries: [],
        measurementEntries: [],
        cardioSessions: [],
      });
      const hash = historyContentHash(empty);
      await connection.transaction(async (tx) => {
        await deleteAllRows(tx);
        await writeMirrorMeta(tx, {
          state: 'verified',
          content_hash: hash.combined,
          counts: JSON.stringify(hash.counts),
          migrated_at: new Date(now()).toISOString(),
        });
      });
      if (!(await checkpoint(connection))) {
        throw new Error('history mirror: checkpoint after clear did not finish');
      }
      rowKeys = emptyRowKeyMaps();
      mirrored = empty;
      ready = true;
    } catch (error) {
      await markStale();
      throw error;
    }
  }

  return {
    start: () => runExclusive(startInQueue),
    async apply(_previous, next) {
      // `previous` is not trusted: the mirror diffs against what it last wrote, so a commit it
      // missed or saw twice cannot shift the rows.
      await runExclusive(() => applyInQueue(next));
    },
    replaceAll: (next) => runExclusive(() => replaceAllInQueue(next)),
    clear: () => runExclusive(clearInQueue),
    close: () =>
      runExclusive(async () => {
        closed = true;
        await discardDriver();
      }),
  };
}

/**
 * Install the SQLite mirror as the app's history mirror, when it is switched
 * on. Returns null, and leaves the no-op mirror in place, while
 * SQLITE_MIRROR_ENABLED is false. Does not start it: the caller starts it once
 * the app is usable (the first render and the hydration are done), never at
 * module load.
 */
export function installSqliteHistoryMirror(
  deps: SqliteHistoryMirrorDeps & { enabled?: boolean },
): SqliteHistoryMirror | null {
  if (!(deps.enabled ?? SQLITE_MIRROR_ENABLED)) {
    return null;
  }
  const mirror = createSqliteHistoryMirror(deps);
  setHistoryMirror(mirror);
  return mirror;
}
