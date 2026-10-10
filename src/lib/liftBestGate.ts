/**
 * Whether the best figure on a lift's own page is behind the record lock.
 *
 * The Records list locks a record older than the free window: the lift and the
 * date stay readable, the figure sits behind Pro (`isRecordLocked`). The
 * exercise page printed the same all-time best — the heaviest weight ever
 * logged — from the lift's whole log with no tier in sight, so the figure a
 * Free reader was told was locked on one tab was one tap away on another
 * (hunt, 2026-10-09).
 *
 * A record is dated by the session that FIRST reached it, the way the Records
 * list does (`beatsBest` is strict): matching a best a year later does not
 * make it a record of this month. That date is what the lock reads. For the
 * weight, the best is the heaviest set with the most reps at that weight, as
 * on the Records list and the exercise sheet: 100 x 6 after a 100 x 5 moves
 * the record to the newer session.
 */
import { getComparableLogSets } from './exerciseLog';
import { isRecordLocked } from './historyWindow';
import { heaviestOfSets } from './personalRecords';
import type { ExerciseLog } from '../types/models';

/** The three figures the page's personal-best card can print. */
export type LiftBestKind = 'weight' | 'reps' | 'minutes';

type BestLog = Pick<ExerciseLog, 'weight' | 'repsPerSet' | 'sets' | 'skipped'> & { performedAt: string };

/** What the card compares sessions by, for the kind it prints. */
function figureOf(log: BestLog, kind: LiftBestKind): number {
  const sets = getComparableLogSets(log);
  if (kind === 'weight') {
    return sets.reduce((best, set) => Math.max(best, set.weight), 0);
  }
  if (kind === 'minutes') {
    return sets.reduce((best, set) => Math.max(best, set.reps ?? 0), 0);
  }
  return sets.reduce((sum, set) => sum + (set.reps ?? 0), 0);
}

/** The reps that break a tie on the figure: the Records list's companion. */
function companionOf(log: BestLog, kind: LiftBestKind): number {
  if (kind !== 'weight') {
    return 0;
  }
  const top = heaviestOfSets(getComparableLogSets(log).map((set) => ({ weight: set.weight, reps: set.reps ?? 0 })));
  return top ? top.reps : 0;
}

/** When the best figure was first reached, or null when there is none. */
export function liftBestPerformedAt(logs: readonly BestLog[], kind: LiftBestKind): string | null {
  let bestValue = 0;
  let bestCompanion = 0;
  let bestAt: string | null = null;
  let bestStamp = Infinity;
  logs.forEach((log) => {
    const value = figureOf(log, kind);
    const stamp = Date.parse(log.performedAt);
    if (value <= 0 || !Number.isFinite(stamp)) {
      return;
    }
    const companion = companionOf(log, kind);
    if (
      value > bestValue ||
      (value === bestValue && (companion > bestCompanion || (companion === bestCompanion && stamp < bestStamp)))
    ) {
      bestValue = value;
      bestCompanion = companion;
      bestAt = log.performedAt;
      bestStamp = stamp;
    }
  });
  return bestAt;
}

/** True when a Free reader should see the lock where the best figure goes. */
export function isLiftBestLocked(
  logs: readonly BestLog[],
  kind: LiftBestKind,
  proUnlocked: boolean,
  now: Date = new Date(),
): boolean {
  if (proUnlocked) {
    return false;
  }
  const performedAt = liftBestPerformedAt(logs, kind);
  return performedAt !== null && isRecordLocked(performedAt, proUnlocked, now);
}
