/**
 * Keeping the plan's day→session assignment in step with the programme.
 *
 * Reordering a programme's days rewrites the template, and the template alone
 * is what the programme page prints. The plan is a second record: each of its
 * entries pins a weekday to a session BY ID (`workoutTemplateSessionId`), and
 * Home, the calendar and the rotation all read the assignment from there.
 *
 * So a reorder that touches only the template moves the list on one screen and
 * changes nothing about what actually gets trained — the programme page and
 * Home end up disagreeing about which session is which day. That is the same
 * failure this app has now fixed three times, and the first two taught the
 * rule: whoever owns the order has to hand it to everyone who reads it.
 *
 * A reorder permutes; it never adds or removes. So the ids the plan already
 * uses are re-dealt to its entries in the programme's new order, and the
 * weekday labels stay exactly where the reader put them: moving a day changes
 * WHICH session lands on Tuesday, not whether Tuesday is a training day.
 */

import { SetupWeekday } from '../types/models';
import { PlanRotationEntry, PlanRotationSession, planTrainedOnDay, resolveNextPlanEntryIndex } from './planRotation';
import { WEEKDAY_KEYS } from './programTrainingDays';
import { rotateLabelsForNextSession } from './trainingWeekSync';

export interface PlanEntrySessionRef {
  workoutTemplateSessionId?: string | null;
  orderIndex: number;
}

export type PlanSessionOrderOutcome<T> =
  | { kind: 'skip'; reason: 'noSessionIds' | 'countMismatch' | 'unchanged' }
  | { kind: 'repointed'; entries: T[] };

/**
 * Re-deal the plan's session ids to follow `orderedSessionIds`.
 *
 * Refuses rather than guesses when the two records do not describe the same
 * set: an entry with no session id stands for the whole template (see
 * planRotation), and a plan whose ids are not exactly the programme's ordered
 * ids is a plan this function has no opinion about. Scrambling one would be
 * worse than leaving the reorder cosmetic.
 */
export function repointPlanEntrySessions<T extends PlanEntrySessionRef>(
  entries: ReadonlyArray<T>,
  orderedSessionIds: ReadonlyArray<string>,
): PlanSessionOrderOutcome<T> {
  const ordered = [...entries].sort((left, right) => left.orderIndex - right.orderIndex);
  const current = ordered.map((entry) => entry.workoutTemplateSessionId ?? null);
  if (current.some((id) => id === null)) {
    return { kind: 'skip', reason: 'noSessionIds' };
  }

  // Only the ids this plan actually runs: a session with no exercises never
  // reached the plan at adoption, and inventing an entry for it here would
  // hand the reader a training day they never asked for.
  const used = new Set(current as string[]);
  const next = orderedSessionIds.filter((id) => used.has(id));
  if (next.length !== ordered.length || new Set(next).size !== used.size) {
    return { kind: 'skip', reason: 'countMismatch' };
  }

  if (next.every((id, index) => id === current[index])) {
    return { kind: 'skip', reason: 'unchanged' };
  }

  return {
    kind: 'repointed',
    // Labels and orderIndex untouched: the weekdays are the reader's rhythm,
    // and only the session sitting on each of them moves.
    entries: ordered.map((entry, index) => ({ ...entry, workoutTemplateSessionId: next[index] })),
  };
}

/**
 * The reorder as the plan stores it: the sessions re-dealt, then the week
 * turned so the session that comes next sits on the first training day that
 * has not gone.
 *
 * Re-dealing alone was not enough. Home offers the entry after the last one
 * logged, and the calendar reads each weekday's own entry, so after a drag the
 * two named different days: A logged on Monday, C dragged to the top on
 * Tuesday, and Home offered B while Wednesday's calendar cell said A. Every
 * other writer of plan labels — adoption, the rhythm strip, the training-days
 * editor — already turns the week this way (backfill review of #33,
 * 2026-09-16).
 *
 * Labels that are not weekday keys, such as the demo's "Day 1", name no day to
 * turn and are left as they are.
 */
export function reorderPlanWeek<T extends PlanEntrySessionRef & PlanRotationEntry & { label: string }>(
  entries: ReadonlyArray<T>,
  orderedSessionIds: ReadonlyArray<string>,
  completed: readonly PlanRotationSession[],
  now: Date,
): PlanSessionOrderOutcome<T> {
  const repointed = repointPlanEntrySessions(entries, orderedSessionIds);
  if (repointed.kind === 'skip') {
    return repointed;
  }
  const labels = repointed.entries.map((entry) => entry.label);
  if (!labels.every(isWeekdayKey)) {
    return repointed;
  }
  const turned = rotateLabelsForNextSession(
    labels,
    resolveNextPlanEntryIndex(repointed.entries, completed),
    now,
    planTrainedOnDay(
      repointed.entries,
      completed,
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    ),
  );
  return {
    kind: 'repointed',
    entries: repointed.entries.map((entry, index) => ({ ...entry, label: turned[index] })),
  };
}

function isWeekdayKey(label: string): label is SetupWeekday {
  return (WEEKDAY_KEYS as readonly string[]).includes(label);
}
