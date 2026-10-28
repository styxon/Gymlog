import type { CollectionDiff, HistoryDiff } from '../../lib/historyDiff';
import {
  createHistoryRowHasher,
  type CollectionHash,
} from '../../lib/historyContentHash';
import {
  decodeHistoryRows,
  encodeHistoryRow,
  HISTORY_COLLECTIONS,
  HISTORY_TABLES,
  type HistoryCollection,
} from '../../lib/historyRowCodec';
import type { AppDatabase } from '../../types/models';
import type { SqlExecutor } from './sqlDriver';

/**
 * Reading and writing the history rows. SQL only; when to do what is the
 * mirror's business (sqliteHistoryMirror.ts).
 */
export type HistorySlice = Pick<AppDatabase, HistoryCollection>;

/** The row each item of the mirror's last snapshot lives in, found by object identity. */
export type RowKeyMaps = Record<HistoryCollection, WeakMap<object, number>>;

/** Rows per INSERT statement: 100 x 5 values stays under SQLite's old limit of 999 variables. */
export const INSERT_ROWS_PER_STATEMENT = 100;
/** Rows read per page when a table is hashed or verified. */
export const READ_PAGE_ROWS = 500;

export class MirrorOutOfSyncError extends Error {
  constructor(detail: string) {
    super(`history mirror out of sync: ${detail}`);
    this.name = 'MirrorOutOfSyncError';
  }
}

export function emptyRowKeyMaps(): RowKeyMaps {
  return {
    workoutSessions: new WeakMap(),
    exerciseLogs: new WeakMap(),
    bodyweightEntries: new WeakMap(),
    measurementEntries: new WeakMap(),
    cardioSessions: new WeakMap(),
  };
}

export function pickHistory(database: HistorySlice): HistorySlice {
  return {
    workoutSessions: database.workoutSessions ?? [],
    exerciseLogs: database.exerciseLogs ?? [],
    bodyweightEntries: database.bodyweightEntries ?? [],
    measurementEntries: database.measurementEntries ?? [],
    cardioSessions: database.cardioSessions ?? [],
  };
}

function insertSql(collection: HistoryCollection, rowCount: number): string {
  const spec = HISTORY_TABLES[collection];
  const columns = ['ord', ...spec.columns, 'json'];
  const one = `(${columns.map(() => '?').join(', ')})`;
  return `INSERT INTO ${spec.table}(${columns.join(', ')}) VALUES ${Array.from({ length: rowCount }, () => one).join(', ')}`;
}

/** Every item of a collection as a new row, `ord` = its index. */
async function insertAllRows(
  tx: SqlExecutor,
  collection: HistoryCollection,
  items: readonly object[],
  yieldToUi: () => Promise<void>,
): Promise<void> {
  for (let start = 0; start < items.length; start += INSERT_ROWS_PER_STATEMENT) {
    const chunk = items.slice(start, start + INSERT_ROWS_PER_STATEMENT);
    const params: Array<string | number | null> = [];
    chunk.forEach((item, offset) => {
      const encoded = encodeHistoryRow(collection, item as never);
      params.push(start + offset, ...encoded.values, encoded.json);
    });
    await tx.run(insertSql(collection, chunk.length), params);
    if ((start / INSERT_ROWS_PER_STATEMENT) % 5 === 4) {
      await yieldToUi();
    }
  }
}

/** Empty all five tables and write `snapshot` into them. The caller holds the transaction. */
export async function writeAllRows(
  tx: SqlExecutor,
  snapshot: HistorySlice,
  yieldToUi: () => Promise<void>,
): Promise<void> {
  for (const collection of HISTORY_COLLECTIONS) {
    await tx.run(`DELETE FROM ${HISTORY_TABLES[collection].table}`);
    await insertAllRows(tx, collection, snapshot[collection] ?? [], yieldToUi);
  }
}

export async function deleteAllRows(tx: SqlExecutor): Promise<void> {
  for (const collection of HISTORY_COLLECTIONS) {
    await tx.run(`DELETE FROM ${HISTORY_TABLES[collection].table}`);
  }
}

/** The row keys of a table in memory order. */
export async function readRowKeys(executor: SqlExecutor, collection: HistoryCollection): Promise<number[]> {
  const rows = await executor.all<{ row_key: number }>(
    `SELECT row_key FROM ${HISTORY_TABLES[collection].table} ORDER BY ord, row_key`,
  );
  return rows.map((row) => Number(row.row_key));
}

/** Point every item of `snapshot` at its row. Throws when the table does not hold exactly that many. */
export async function bindRowKeys(
  executor: SqlExecutor,
  snapshot: HistorySlice,
  maps: RowKeyMaps,
): Promise<void> {
  for (const collection of HISTORY_COLLECTIONS) {
    const items = snapshot[collection] ?? [];
    const keys = await readRowKeys(executor, collection);
    if (keys.length !== items.length) {
      throw new MirrorOutOfSyncError(`${collection} holds ${keys.length} rows, memory ${items.length}`);
    }
    maps[collection] = new WeakMap();
    items.forEach((item, index) => maps[collection].set(item, keys[index]));
  }
}

export async function countRows(executor: SqlExecutor, collection: HistoryCollection): Promise<number> {
  const rows = await executor.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${HISTORY_TABLES[collection].table}`);
  return Number(rows[0]?.n ?? 0);
}

/** A table's row texts in memory order, one page at a time. */
export async function forEachRowPage(
  executor: SqlExecutor,
  collection: HistoryCollection,
  count: number,
  onPage: (texts: unknown[], offset: number) => void,
  yieldToUi: () => Promise<void>,
): Promise<void> {
  const table = HISTORY_TABLES[collection].table;
  for (let offset = 0; offset < count; offset += READ_PAGE_ROWS) {
    const rows = await executor.all<{ json: unknown }>(
      `SELECT json FROM ${table} ORDER BY ord, row_key LIMIT ? OFFSET ?`,
      [READ_PAGE_ROWS, offset],
    );
    onPage(
      rows.map((row) => row.json),
      offset,
    );
    await yieldToUi();
  }
}

/** The digest of a table's stored row texts: the store side of the content check. */
export async function hashStoredCollection(
  executor: SqlExecutor,
  collection: HistoryCollection,
  yieldToUi: () => Promise<void>,
): Promise<CollectionHash> {
  const hasher = createHistoryRowHasher();
  const count = await countRows(executor, collection);
  await forEachRowPage(
    executor,
    collection,
    count,
    (texts) => {
      for (const text of texts) {
        // A cell that is not text can never equal a memory row; it hashes as something no row text is.
        hasher.add(typeof text === 'string' ? text : `\u0000not-text:${typeof text}`);
      }
    },
    yieldToUi,
  );
  return hasher.finish();
}

/**
 * Read the whole store back and compare it with `snapshot` row for row: the
 * counts and the exact text of every row, in order. That text comparison is
 * the verification; a digest of the same texts would say nothing more, so none
 * is kept here. Returns the rows as decoded items, for the caller's fingerprint
 * check, which is what can still differ when the texts are equal (a NaN that
 * JSON turns into null; a row whose text is not an object and so does not
 * decode, which leaves it out of the items). Throws on the first difference.
 */
export async function readBackAndCompare(
  executor: SqlExecutor,
  snapshot: HistorySlice,
  yieldToUi: () => Promise<void>,
): Promise<HistorySlice> {
  const items = {} as Record<HistoryCollection, unknown[]>;
  for (const collection of HISTORY_COLLECTIONS) {
    const memory = snapshot[collection] ?? [];
    const count = await countRows(executor, collection);
    if (count !== memory.length) {
      throw new MirrorOutOfSyncError(`${collection} holds ${count} rows, memory ${memory.length}`);
    }
    const decoded: unknown[] = [];
    await forEachRowPage(
      executor,
      collection,
      count,
      (texts, offset) => {
        texts.forEach((text, index) => {
          if (typeof text !== 'string' || text !== JSON.stringify(memory[offset + index])) {
            throw new MirrorOutOfSyncError(`${collection} row ${offset + index} differs from memory`);
          }
        });
        decoded.push(...decodeHistoryRows(collection, texts).items);
      },
      yieldToUi,
    );
    items[collection] = decoded;
  }
  return items as unknown as HistorySlice;
}

/**
 * Apply a diff of the mirror's last snapshot against `next`, in the caller's
 * transaction. Returns whether rows were deleted (the caller then checkpoints,
 * so a removed workout does not linger in the log) and the changes to the row
 * map, to be made only once the transaction has committed.
 */
export async function applyHistoryDiff(
  tx: SqlExecutor,
  diff: HistoryDiff,
  next: HistorySlice,
  maps: RowKeyMaps,
  yieldToUi: () => Promise<void>,
): Promise<{ deleted: boolean; commit: () => void }> {
  const afterCommit: Array<() => void> = [];
  let deleted = false;
  for (const collection of HISTORY_COLLECTIONS) {
    const removedSome = await applyCollection(tx, collection, diff[collection], next[collection] ?? [], maps, afterCommit, yieldToUi);
    deleted = deleted || removedSome;
  }
  return {
    deleted,
    commit: () => {
      for (const change of afterCommit) {
        change();
      }
    },
  };
}

async function deleteRemoved(
  tx: SqlExecutor,
  collection: HistoryCollection,
  removed: readonly object[],
  maps: RowKeyMaps,
  afterCommit: Array<() => void>,
): Promise<void> {
  const table = HISTORY_TABLES[collection].table;
  for (const item of removed) {
    const key = maps[collection].get(item);
    if (key === undefined) {
      throw new MirrorOutOfSyncError(`${collection} item to remove has no row`);
    }
    await tx.run(`DELETE FROM ${table} WHERE row_key = ?`, [key]);
    afterCommit.push(() => maps[collection].delete(item));
  }
}

async function insertOne(tx: SqlExecutor, collection: HistoryCollection, item: object, ord: number): Promise<number> {
  const encoded = encodeHistoryRow(collection, item as never);
  const result = await tx.run(insertSql(collection, 1), [ord, ...encoded.values, encoded.json]);
  return result.lastInsertRowId;
}

async function applyCollection(
  tx: SqlExecutor,
  collection: HistoryCollection,
  diff: CollectionDiff<object>,
  nextItems: readonly object[],
  maps: RowKeyMaps,
  afterCommit: Array<() => void>,
  yieldToUi: () => Promise<void>,
): Promise<boolean> {
  const table = HISTORY_TABLES[collection].table;
  if (diff.kind === 'same') {
    return false;
  }

  if (diff.kind === 'replace') {
    // The same object twice in a snapshot: identity says nothing, so the table is made again.
    await tx.run(`DELETE FROM ${table}`);
    await insertAllRows(tx, collection, nextItems, yieldToUi);
    const keys = await readRowKeys(tx, collection);
    if (keys.length !== nextItems.length) {
      throw new MirrorOutOfSyncError(`${collection} holds ${keys.length} rows after replace, memory ${nextItems.length}`);
    }
    afterCommit.push(() => {
      maps[collection] = new WeakMap();
      nextItems.forEach((item, index) => maps[collection].set(item, keys[index]));
    });
    return true;
  }

  await deleteRemoved(tx, collection, diff.removed, maps, afterCommit);
  const deleted = diff.removed.length > 0;

  if (diff.kind === 'edges') {
    if (diff.head.length === 0 && diff.tail.length === 0) {
      return deleted;
    }
    const bounds = await tx.all<{ lo: number | null; hi: number | null }>(
      `SELECT MIN(ord) AS lo, MAX(ord) AS hi FROM ${table}`,
    );
    const lo = bounds[0]?.lo === null || bounds[0]?.lo === undefined ? 0 : Number(bounds[0].lo);
    const hi = bounds[0]?.hi === null || bounds[0]?.hi === undefined ? -1 : Number(bounds[0].hi);
    // Head items end up in `next` order, all below the smallest ord; tail items above the largest.
    for (let index = 0; index < diff.head.length; index += 1) {
      const key = await insertOne(tx, collection, diff.head[index], lo - diff.head.length + index);
      afterCommit.push(() => maps[collection].set(diff.head[index], key));
    }
    for (let index = 0; index < diff.tail.length; index += 1) {
      const key = await insertOne(tx, collection, diff.tail[index], hi + 1 + index);
      afterCommit.push(() => maps[collection].set(diff.tail[index], key));
    }
    return deleted;
  }

  // renumber: new items among kept ones, or the kept ones changed order. `ord` of the whole table follows `next`.
  const added = new Set<object>(diff.added);
  for (let index = 0; index < nextItems.length; index += 1) {
    const item = nextItems[index];
    if (added.has(item)) {
      const key = await insertOne(tx, collection, item, index);
      afterCommit.push(() => maps[collection].set(item, key));
      continue;
    }
    const key = maps[collection].get(item);
    if (key === undefined) {
      throw new MirrorOutOfSyncError(`${collection} kept item has no row`);
    }
    await tx.run(`UPDATE ${table} SET ord = ? WHERE row_key = ?`, [index, key]);
    if (index % 500 === 499) {
      await yieldToUi();
    }
  }
  return deleted;
}

