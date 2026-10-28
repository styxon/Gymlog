import type { AppDatabase } from '../types/models';
import { createHash } from './accountBackup';
import { HISTORY_COLLECTIONS, type HistoryCollection } from './historyRowCodec';

/**
 * A fingerprint of what the history collections hold, down to every field.
 *
 * accountBackupFingerprint is not enough for this: it hashes a log by
 * id|setCount|volume, so an edit to a session's name, note or feel is invisible
 * to it. This one hashes each item's JSON text, which is exactly the text a
 * row store keeps, so the two sides can be compared from either end: memory
 * (JSON.stringify of the item) or the store (the json column as read).
 *
 * One collection at a time, so a caller on a slow runtime can yield between
 * them. Pure and synchronous per collection.
 */
export interface HistoryContentHash {
  counts: Record<HistoryCollection, number>;
  hashes: Record<HistoryCollection, string>;
  /** One digest over the counts and the per-collection hashes. */
  combined: string;
}

type CollectionHash = { count: number; hash: string };

/** The digest of one collection's row texts, in order. */
export function hashHistoryRowTexts(texts: Iterable<string>): CollectionHash {
  const hash = createHash();
  let count = 0;
  for (const text of texts) {
    hash.add(text);
    count += 1;
  }
  return { count, hash: hash.digest() };
}

export function hashHistoryCollection(items: readonly object[]): CollectionHash {
  const hash = createHash();
  for (const item of items) {
    hash.add(JSON.stringify(item));
  }
  return { count: items.length, hash: hash.digest() };
}

export function combineHistoryHashes(parts: Record<HistoryCollection, CollectionHash>): HistoryContentHash {
  const counts = {} as Record<HistoryCollection, number>;
  const hashes = {} as Record<HistoryCollection, string>;
  const combined = createHash();
  for (const collection of HISTORY_COLLECTIONS) {
    const part = parts[collection];
    counts[collection] = part.count;
    hashes[collection] = part.hash;
    combined.add(`${collection}|${part.count}|${part.hash}`);
  }
  return { counts, hashes, combined: combined.digest() };
}

export function historyContentHash(database: Pick<AppDatabase, HistoryCollection>): HistoryContentHash {
  const parts = {} as Record<HistoryCollection, CollectionHash>;
  for (const collection of HISTORY_COLLECTIONS) {
    parts[collection] = hashHistoryCollection(database[collection] ?? []);
  }
  return combineHistoryHashes(parts);
}
