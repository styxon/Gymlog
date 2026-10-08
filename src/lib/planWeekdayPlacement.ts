/**
 * Weekdays written onto a plan's entries: the one rule for the two places a
 * reader moves their week — the programme page's rhythm strip and Profile's
 * weekday picker.
 *
 * Only the entries Home's rotation counts are placed (`livePlanEntries`). An
 * entry naming a session the template lost is left as it is stored. The rhythm
 * strip learned this first; Profile's picker still counted the stored
 * entries, so for a two-session programme with one dead entry two chosen days
 * wrote nothing at all, and three gave one of them to the dead entry and
 * showed a chosen day as rest (re-hunt, 2026-10-07).
 *
 * The session that comes next takes the first training day not yet gone, as
 * adoption does (rotateLabelsForNextSession).
 */

import { livePlanEntries, ResolvablePlanEntry } from './planResolvableEntries';
import { planTrainedOnDay, PlanRotationEntry, PlanRotationSession, resolveNextPlanEntryIndex } from './planRotation';
import { rotateLabelsForNextSession } from './trainingWeekSync';
import { SetupWeekday } from '../types/models';

export interface PlacedPlanEntry extends ResolvablePlanEntry, PlanRotationEntry {
  id: string;
  label: string;
}

/**
 * The plan's entries in order, the live ones relabelled.
 *
 * `labelsFor` is handed the number of live entries and answers with that many
 * weekdays, or null when the chosen days cannot place them. `completedFor`
 * answers with the logged sessions of the plan's template. Returns null when
 * nothing should be written.
 */
export function placeWeekdaysOnPlan<E extends PlacedPlanEntry>(
  entries: readonly E[],
  sessionsFor: (workoutTemplateId: string) => readonly { id: string }[],
  labelsFor: (liveCount: number) => readonly SetupWeekday[] | null,
  completedFor: (workoutTemplateId: string | undefined) => readonly PlanRotationSession[],
  now: Date,
): E[] | null {
  const allOrdered = [...entries].sort((left, right) => left.orderIndex - right.orderIndex);
  const ordered = livePlanEntries(allOrdered, sessionsFor);
  const labels = labelsFor(ordered.length);
  if (!labels || labels.length !== ordered.length) {
    return null;
  }
  const completed = completedFor(ordered[0]?.workoutTemplateId);
  const placed = rotateLabelsForNextSession(
    labels,
    resolveNextPlanEntryIndex(ordered, completed),
    now,
    planTrainedOnDay(ordered, completed, new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()),
  );
  const labelByEntryId = new Map(ordered.map((entry, index) => [entry.id, placed[index]] as const));
  return allOrdered.map((entry) => {
    const label = labelByEntryId.get(entry.id);
    return label === undefined ? entry : { ...entry, label };
  });
}
