/**
 * The plan entries Home can actually draw, each with the session it names.
 *
 * An entry can name a session the template no longer holds (a day removed or
 * renamed from another surface). Home dropped those from its session list but
 * kept counting them everywhere else: the rotation index and the calendar's
 * forecast ran over the full entry list while the list they index was the
 * filtered one, and a day's label was read from the entry at the same
 * POSITION in the unfiltered list. With entries [s0, dead, s2, s3], after s2
 * Home offered s0 and s3 was never offered, and the labels sat on the wrong
 * days (bug hunt, 2026-10-04).
 *
 * So everything that talks about "the plan's sessions" takes this one list.
 * The unresolvable entries are ignored in the computation and left in the
 * stored plan: the template may load later, and they are the reader's data.
 */
export interface ResolvablePlanEntry {
  workoutTemplateSessionId?: string | null;
  orderIndex: number;
}

export function resolvablePlanEntries<E extends ResolvablePlanEntry, S extends { id: string }>(
  sortedEntries: readonly E[],
  templateSessions: readonly S[],
): Array<{ entry: E; session: S }> {
  const resolved: Array<{ entry: E; session: S }> = [];
  for (const entry of sortedEntries) {
    const session = entry.workoutTemplateSessionId
      ? templateSessions.find((candidate) => candidate.id === entry.workoutTemplateSessionId)
      : templateSessions[entry.orderIndex];
    if (session) {
      resolved.push({ entry, session });
    }
  }
  return resolved;
}

/** What the week costs: the sum of its sessions, not the next one times the count. */
export function weeklyMinutesLabel(sessionMinutes: readonly number[]): string {
  return `~${sessionMinutes.reduce((sum, minutes) => sum + minutes, 0)} min`;
}
