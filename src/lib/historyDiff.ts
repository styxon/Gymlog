import type { AppDatabase } from '../types/models';
import { HISTORY_COLLECTIONS, type HistoryCollection } from './historyRowCodec';

/**
 * What changed in one history collection between two database snapshots, by
 * object identity.
 *
 * The collections hold immutable objects: a repository never edits an item in
 * place, it builds a new one. So "same object" means "same row", and a row
 * that was edited is a removed object plus an added one. Comparing references
 * is O(n) and does not look at ids at all, which is also why duplicate ids
 * (kept as they are) cannot confuse it.
 *
 * Order is part of the data (the backup fingerprint hashes in iteration
 * order, and a saved workout is prepended), so the diff also says where the
 * new items go:
 * - `edges`: every new item lies before the first kept item or after the last,
 *   and the kept items keep their relative order. The store can number new
 *   head items below its smallest `ord` and tail items above its largest, and
 *   no other row moves.
 * - `renumber`: a new item lands between kept ones, the kept items changed
 *   order (a sort, a restore), or nothing is kept. The store writes `ord` for
 *   the whole table from `next`.
 * - `replace`: the same object appears twice in a snapshot, so identity says
 *   nothing. The store rebuilds the table from `next`.
 */
export type CollectionDiff<T> =
  | { kind: 'same' }
  | { kind: 'edges'; removed: T[]; head: T[]; tail: T[] }
  | { kind: 'renumber'; removed: T[]; added: T[] }
  | { kind: 'replace' };

export type HistoryDiff = Record<HistoryCollection, CollectionDiff<object>>;

export function diffCollection<T extends object>(previous: readonly T[], next: readonly T[]): CollectionDiff<T> {
  if (previous === next) {
    return { kind: 'same' };
  }
  const previousSet = new Set<T>(previous);
  const nextSet = new Set<T>(next);
  if (previousSet.size !== previous.length || nextSet.size !== next.length) {
    return { kind: 'replace' };
  }

  const removed = previous.filter((item) => !nextSet.has(item));
  const keptInPrevious = previous.filter((item) => nextSet.has(item));

  let firstKept = -1;
  let lastKept = -1;
  let keptCursor = 0;
  let keptOrderHolds = true;
  for (let index = 0; index < next.length; index += 1) {
    if (previousSet.has(next[index])) {
      if (firstKept === -1) {
        firstKept = index;
      }
      lastKept = index;
      if (keptInPrevious[keptCursor] !== next[index]) {
        keptOrderHolds = false;
      }
      keptCursor += 1;
    }
  }

  const added = next.filter((item) => !previousSet.has(item));
  if (removed.length === 0 && added.length === 0 && keptOrderHolds) {
    return { kind: 'same' };
  }
  if (!keptOrderHolds || (added.length > 0 && firstKept === -1)) {
    return { kind: 'renumber', removed, added };
  }

  const head: T[] = [];
  const tail: T[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const item = next[index];
    if (previousSet.has(item)) {
      continue;
    }
    if (index < firstKept) {
      head.push(item);
    } else if (index > lastKept) {
      tail.push(item);
    } else {
      return { kind: 'renumber', removed, added };
    }
  }
  return { kind: 'edges', removed, head, tail };
}

export function diffHistory(
  previous: Pick<AppDatabase, HistoryCollection>,
  next: Pick<AppDatabase, HistoryCollection>,
): HistoryDiff {
  const result = {} as HistoryDiff;
  for (const collection of HISTORY_COLLECTIONS) {
    result[collection] = diffCollection<object>(previous[collection] ?? [], next[collection] ?? []);
  }
  return result;
}

export function isHistoryDiffEmpty(diff: HistoryDiff): boolean {
  return HISTORY_COLLECTIONS.every((collection) => diff[collection].kind === 'same');
}
