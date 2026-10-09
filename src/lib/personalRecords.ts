import { groupByMonth } from './monthGroups';
import { getComparableLogSets } from './exerciseLog';
import { isHoldLogEntry } from './holdExercises';
import { isMinutesLogEntry } from './minutesExercises';
import type { ExerciseLog } from '../types/models';

/**
 * Your bests, and when you set them.
 *
 * The app has counted records for a season badge and flashed one on the
 * post-workout screen, but there has never been a place to see them. That is
 * the first thing anyone asks a training log for, and every number is already
 * in it — this reads them out rather than deriving anything new.
 *
 * Three kinds, because "best" means three different things and a single list
 * would have to pick one: the heaviest set, the most reps in a set, and the
 * hardest single session for that lift. A bodyweight program produces no
 * weight records at all, which is why the reps kind exists.
 *
 * Every record carries the record BEFORE it, so the screen can say what
 * changed. That is walked chronologically rather than taken as "the
 * second-best value ever": a lift that went 80 → 85 → 82.5 has a previous
 * record of 80, not 82.5.
 *
 * A record matched on the number by a better set moves to that set: 6 × 60
 * beaten by 8 × 60 is still a 60 kg record, but the record set — and the
 * day it stands on — is the 8 × 60. Before this, the badge sat on the 6 × 60
 * for good and the best-weight card named it (#bugs 2026-09-20). `previous`
 * is untouched by such a move: the record before 60 was 55, whichever set
 * holds 60 now.
 */

export type RecordKind = 'weight' | 'reps' | 'volume';

export interface RecordSet {
  weight: number;
  reps: number;
}

export interface RecordEntry {
  /** ISO timestamp of the session this set belongs to. */
  performedAt: string;
  sets: RecordSet[];
}

export interface RecordSource {
  /** Stable identity — the tracked lift's key. */
  key: string;
  name: string;
  /** From the exercise library when the name matches; null when it does not. */
  bodyPart?: string | null;
  entries: RecordEntry[];
}

export interface PersonalRecord {
  key: string;
  name: string;
  bodyPart: string | null;
  kind: RecordKind;
  /** The record: kg for weight, reps for reps, kg of volume for volume. */
  value: number;
  /** Reps at the record set (weight kind), or the weight used (reps kind). */
  companion: number | null;
  /** ISO date the record was set. */
  performedAt: string;
  /**
   * ISO date the lift first held a record of this kind — its first logged
   * set, since the first figure is a record by definition. Unlike
   * `performedAt` it never moves when the record is beaten, which is what a
   * "reached on" date needs.
   */
  firstAt: string;
  /** The record that stood before this one, or null if this is the first. */
  previous: number | null;
  /** Set within the freshness window — drives the "UUSI" badge. */
  fresh: boolean;
}

/**
 * The sets a log offers the records: its comparable sets, as a record reads
 * them — and none at all for minutes, nor for a hold (seconds held, not reps).
 *
 * Twenty minutes on a bike is a dose, not a repetition count, and its weight
 * is zero: read as a set it was a "20 reps" record that a longer ride would
 * "beat" (2026-10-06). The log's own unit says so for anything saved since;
 * the name says so for a log saved before the unit existed, so a record the
 * old reading made does not survive it.
 */
export function recordSetsOfLog(
  log: Pick<ExerciseLog, 'sets' | 'weight' | 'repsPerSet' | 'skipped'> &
    Pick<Partial<ExerciseLog>, 'repsUnit' | 'exerciseNameSnapshot'>,
): RecordSet[] {
  if (isMinutesLogEntry(log) || isHoldLogEntry(log)) {
    return [];
  }
  return getComparableLogSets(log).map((set) => ({ weight: set.weight, reps: set.reps }));
}

/** How recent a record has to be to read as new. */
export const FRESH_RECORD_DAYS = 30;

export interface WeightedSet {
  weight: number;
  reps: number;
}

/**
 * The heaviest of a set of candidate sets, weight first and reps to break a
 * tie — one lift, one rule, so a weight record and a "new PR" declaration can
 * never point at different sets. Before this rule was shared, the completion
 * screen picked its record by an estimated one-rep max (Epley) while this
 * screen picked it by the weight actually on the bar, and 80 kg × 10 could be
 * a "new record" on one screen and not the other (2026-09-26).
 *
 * Ignores anything with no weight: a bodyweight lift has no weight record,
 * here or anywhere else this is used.
 */
export function heaviestOfSets<T extends WeightedSet>(sets: readonly T[]): T | null {
  let best: T | null = null;
  for (const set of sets) {
    if (!(set.weight > 0)) {
      continue;
    }
    if (beatsBest(set, best)) {
      best = set;
    }
  }
  return best;
}

/**
 * Whether a set is a new weight record over `best`: heavier, or the same
 * weight for more reps. The second half is the rule the Records tab has kept
 * since PR #154 (the record moves to the better set); the completion screen
 * and the morning notification asked for a heavier bar only, so 100 kg × 5
 * after 100 kg × 3 was new on one screen and nothing on the other (user,
 * 2026-09-26: "ennätys kaikkialla"). Equal on both counts is matched, not
 * beaten.
 */
export function beatsBest(set: WeightedSet, best: WeightedSet | null): boolean {
  return best === null || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps);
}

interface Candidate {
  value: number;
  companion: number | null;
  performedAt: string;
  stamp: number;
}

/** One candidate per entry, by kind. Null when the entry cannot produce one. */
function candidateFor(entry: RecordEntry, kind: RecordKind): Candidate | null {
  const stamp = Date.parse(entry.performedAt);
  if (!Number.isFinite(stamp)) {
    return null;
  }
  const sets = entry.sets.filter((set) => Number.isFinite(set.weight) && Number.isFinite(set.reps));
  if (sets.length === 0) {
    return null;
  }

  if (kind === 'volume') {
    // The whole session's work on this lift, which is what makes a session
    // "hard" in a way a single set cannot show.
    const volume = sets.reduce((total, set) => total + Math.max(0, set.weight) * Math.max(0, set.reps), 0);
    return volume > 0 ? { value: volume, companion: sets.length, performedAt: entry.performedAt, stamp } : null;
  }

  if (kind === 'weight') {
    const best = heaviestOfSets(sets);
    return best ? { value: best.weight, companion: best.reps, performedAt: entry.performedAt, stamp } : null;
  }

  // Same reps, heavier bar: the better set, within a session as across them.
  const best = sets.reduce((top, set) =>
    set.reps > top.reps || (set.reps === top.reps && set.weight > top.weight) ? set : top,
  );
  return best.reps > 0
    ? { value: best.reps, companion: best.weight > 0 ? best.weight : null, performedAt: entry.performedAt, stamp }
    : null;
}

/**
 * Same record number, better set: more reps at that weight, or more weight at
 * those reps. Volume has no such tie — the companion there is a set count,
 * and more sets for the same work is not a better session.
 */
function betterCompanion(kind: RecordKind, candidate: Candidate, best: Candidate): boolean {
  if (kind === 'volume') {
    return false;
  }
  return (candidate.companion ?? 0) > (best.companion ?? 0);
}

/**
 * The record for one lift, or null when it has none of that kind.
 *
 * Walked in date order so `previous` is the record that actually stood before
 * this one — not the runner-up in the final sorted list.
 */
export function resolveRecord(
  source: RecordSource,
  kind: RecordKind,
  now: Date = new Date(),
): PersonalRecord | null {
  const candidates = source.entries
    .map((entry) => candidateFor(entry, kind))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((left, right) => left.stamp - right.stamp);

  if (candidates.length === 0) {
    return null;
  }

  let best: Candidate | null = null;
  let previous: number | null = null;

  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.value > best.value) {
      previous = best.value;
      best = candidate;
    } else if (candidate.value === best.value && betterCompanion(kind, candidate, best)) {
      // Same number, better set: the record moves, the record before it does not.
      best = candidate;
    }
  }

  if (best === null) {
    return null;
  }

  return {
    key: source.key,
    name: source.name,
    bodyPart: source.bodyPart ?? null,
    kind,
    value: best.value,
    companion: best.companion,
    performedAt: best.performedAt,
    firstAt: candidates[0].performedAt,
    previous,
    fresh: now.getTime() - best.stamp <= FRESH_RECORD_DAYS * 86_400_000,
  };
}

/**
 * Every lift's record of one kind, best first.
 *
 * Sorted by how recently the record was set rather than by size: a list
 * ordered by kilos is a list of which lifts are heaviest, which the reader
 * already knows. Ordered by date it answers "what have I done lately", and
 * the new ones land at the top where the badge is.
 */
export function resolveRecords(
  sources: readonly RecordSource[],
  kind: RecordKind,
  now: Date = new Date(),
): PersonalRecord[] {
  return sources
    .map((source) => resolveRecord(source, kind, now))
    .filter((record): record is PersonalRecord => record !== null)
    .sort((left, right) => Date.parse(right.performedAt) - Date.parse(left.performedAt));
}

/**
 * The day each lift first held a record of any kind — one date per lift, the
 * earliest `firstAt` across its kinds. The lifts are the ones the Records tab
 * counts; the dates are fixed, so a milestone reached on one of them stays
 * where it fell when the record is later beaten.
 */
export function firstRecordDates(records: Record<RecordKind, readonly PersonalRecord[]>): string[] {
  const firstByLift = new Map<string, string>();
  for (const record of [...records.weight, ...records.reps, ...records.volume]) {
    const known = firstByLift.get(record.key);
    if (known === undefined || Date.parse(record.firstAt) < Date.parse(known)) {
      firstByLift.set(record.key, record.firstAt);
    }
  }
  return [...firstByLift.values()];
}

/** Records grouped by the month they were set, newest month first. */
export function groupRecordsByMonth(
  records: readonly PersonalRecord[],
): Array<{ year: number; month: number; records: PersonalRecord[] }> {
  // Delegates, so Records and History cannot disagree about which month a
  // midnight entry belongs to. The shape stays `records` for its callers.
  return groupByMonth(records, (record) => record.performedAt).map((group) => ({
    year: group.year,
    month: group.month,
    records: group.items,
  }));
}
