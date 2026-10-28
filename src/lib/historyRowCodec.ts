import type { AppDatabase } from '../types/models';

/**
 * How a history row is written to, and read back from, a row store.
 *
 * Pure: no SQL, no I/O. The five history collections are stored one row per
 * item. A row is the item's normalized JSON text plus a few derived columns
 * for lookups. The JSON is the truth; the columns are only ever read to find a
 * row, never to rebuild an item, so a bad or missing field costs a lookup and
 * nothing else (the same "a bad field degrades only that field" rule as
 * normalizeDatabase).
 *
 * The derived columns are nullable and carry no uniqueness: normalizeDatabase
 * does not prune duplicate ids, and an old install may hold some.
 */
export type HistoryCollection =
  | 'workoutSessions'
  | 'exerciseLogs'
  | 'bodyweightEntries'
  | 'measurementEntries'
  | 'cardioSessions';

type HistoryItem<C extends HistoryCollection> = AppDatabase[C][number];

export interface HistoryTableSpec {
  readonly table: string;
  /** Derived column names, in the order `values` come back from encodeHistoryRow. */
  readonly columns: readonly string[];
  /** The item field each derived column is read from, aligned with `columns`. */
  readonly sources: readonly string[];
}

/** The order is the order the collections are hashed, verified and written. */
export const HISTORY_COLLECTIONS: readonly HistoryCollection[] = [
  'workoutSessions',
  'exerciseLogs',
  'bodyweightEntries',
  'measurementEntries',
  'cardioSessions',
];

export const HISTORY_TABLES: Readonly<Record<HistoryCollection, HistoryTableSpec>> = {
  workoutSessions: { table: 'workout_sessions', columns: ['id', 'date'], sources: ['id', 'performedAt'] },
  exerciseLogs: { table: 'exercise_logs', columns: ['id', 'session_id'], sources: ['id', 'sessionId'] },
  bodyweightEntries: { table: 'bodyweight_entries', columns: ['id', 'recorded_at'], sources: ['id', 'recordedAt'] },
  measurementEntries: {
    table: 'measurement_entries',
    columns: ['id', 'kind', 'recorded_at'],
    sources: ['id', 'kind', 'recordedAt'],
  },
  cardioSessions: { table: 'cardio_sessions', columns: ['id', 'date'], sources: ['id', 'performedAt'] },
};

export interface EncodedHistoryRow {
  json: string;
  /** Derived column values, aligned with HISTORY_TABLES[collection].columns. */
  values: Array<string | null>;
}

export function encodeHistoryRow<C extends HistoryCollection>(collection: C, item: HistoryItem<C>): EncodedHistoryRow {
  const record = item as unknown as Record<string, unknown> | null;
  const values = HISTORY_TABLES[collection].sources.map((field) => {
    const value = record?.[field];
    return typeof value === 'string' ? value : null;
  });
  return { json: JSON.stringify(item), values };
}

/**
 * The item a row's JSON text holds, or null when the text is not one: not
 * JSON, or JSON that is not a plain object. Never throws. The caller counts
 * the nulls; a row that does not decode is a reason to rebuild the store from
 * memory, not to guess.
 */
export function decodeHistoryRow<C extends HistoryCollection>(_collection: C, json: unknown): HistoryItem<C> | null {
  if (typeof json !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as HistoryItem<C>;
}

/** Many rows at once: the items that decoded, in order, and how many did not. */
export function decodeHistoryRows<C extends HistoryCollection>(
  collection: C,
  jsons: readonly unknown[],
): { items: Array<HistoryItem<C>>; dropped: number } {
  const items: Array<HistoryItem<C>> = [];
  let dropped = 0;
  for (const json of jsons) {
    const item = decodeHistoryRow(collection, json);
    if (item === null) {
      dropped += 1;
    } else {
      items.push(item);
    }
  }
  return { items, dropped };
}
