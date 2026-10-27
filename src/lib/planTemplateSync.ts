import { WorkoutPlanEntry } from '../types/models';

/**
 * The plan's week, brought back into step with the template's days.
 *
 * A custom programme is two records: the template holds the days and their
 * lifts, and the plan holds which weekday each day sits on and which one comes
 * next. Every writer that changes the days has had to move both — adoption
 * builds them together, a rename repoints the plan's name, a drag re-deals its
 * sessions. The template editor changed only the template.
 *
 * So adding a day to a running programme left the plan with the old count: the
 * new day was never offered on Home, never on the week strip, never the next
 * session. Removing one left an entry pointing at a session that no longer
 * existed — Home filtered it out of the list it renders and went on quoting
 * `entries.length` for "3 day plan" and for the weekly minutes, and because
 * the surviving rows were then read by their position in the FILTERED list
 * against the UNFILTERED entries, every day after the gap wore the previous
 * day's weekday (audit 3, 2026-09-19).
 *
 * `repointPlanEntrySessions` deliberately refuses this case — it skips on a
 * count mismatch, because a drag must never invent or drop a training day.
 * Here the count is exactly what changed, so it is the thing to follow.
 */
interface PlanTemplateSyncInput {
  /** The plan's entries as stored. */
  entries: readonly WorkoutPlanEntry[];
  /** The template's session ids, in the order the template stores them. */
  sessionIds: readonly string[];
  planId: string;
  workoutTemplateId: string;
  /**
   * The week a NEW day is placed on — the reader's own training days, as
   * `planLabelsForProgramme` lays them out for the new count. Only days the
   * survivors have not already taken are used, so a rhythm the reader dragged
   * into place survives a day being added beside it.
   */
  dayLabels: readonly string[];
}

/**
 * The entries the plan should hold, or null when it already holds them.
 *
 * Null rather than an equal array so the caller can skip the write: a plan
 * rewritten on every template save would stamp `updatedAt` for nothing and
 * re-enter the queue behind it.
 */
export function syncPlanEntriesToTemplate(input: PlanTemplateSyncInput): WorkoutPlanEntry[] | null {
  const ordered = [...input.entries].sort((left, right) => left.orderIndex - right.orderIndex);
  const current = ordered.map((entry) => entry.workoutTemplateSessionId ?? null);
  const next = [...input.sessionIds];

  if (current.length === next.length && current.every((id, index) => id === next[index])) {
    return null;
  }

  const bySession = new Map<string, WorkoutPlanEntry>();
  for (const entry of ordered) {
    if (entry.workoutTemplateSessionId) {
      bySession.set(entry.workoutTemplateSessionId, entry);
    }
  }

  // The labels the survivors keep. A day that is still in the programme stays
  // on the weekday the reader put it on.
  const taken = new Set(next.map((id) => bySession.get(id)?.label).filter((label): label is string => Boolean(label)));
  const spare = input.dayLabels.filter((label) => !taken.has(label));
  let spareIndex = 0;

  /*
   * A new entry's id, and it cannot be a survivor's.
   *
   * `${planId}_entry_${index + 1}` is what adoption names a slot, and taking
   * it from the REBUILT position collides the moment survivors and new days
   * are mixed: remove day 1 and add a fourth, and the new day lands at index 2
   * — `p_entry_3`, which the surviving third day is already called (CI review
   * of #146). The lowest number nothing holds keeps the adoption shape without
   * that.
   */
  const usedIds = new Set(next.map((id) => bySession.get(id)?.id).filter((id): id is string => Boolean(id)));
  let nextNumber = 1;
  const mintId = () => {
    let candidate = `${input.planId}_entry_${nextNumber}`;
    while (usedIds.has(candidate)) {
      nextNumber += 1;
      candidate = `${input.planId}_entry_${nextNumber}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  return next.map((sessionId, index) => {
    const kept = bySession.get(sessionId);
    const label =
      kept?.label ??
      // A day the reader has just added: the first of their training days that
      // nothing else sits on, and only then a repeat.
      (spareIndex < spare.length
        ? spare[spareIndex++]
        : input.dayLabels.length > 0
          ? input.dayLabels[index % input.dayLabels.length]
          : `Day ${index + 1}`);
    return {
      id: kept?.id ?? mintId(),
      workoutTemplateId: input.workoutTemplateId,
      workoutTemplateSessionId: sessionId,
      label,
      orderIndex: index,
    };
  });
}
