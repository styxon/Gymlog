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

/**
 * The plan's entries that Home's rotation counts, in the order given.
 *
 * Home's card runs over `resolvablePlanEntries`; the week strip, the
 * reminders and the programme page's rhythm read the plan's raw entries, so an
 * entry naming a removed session lit a dot, fired a reminder and changed the
 * derived day count on days Home never offered (bug hunt, 2026-10-04). They
 * all call this instead. `sessionsFor` returns the sessions of the plan's
 * template.
 *
 * When the template yields no sessions at all there is nothing to judge an
 * entry against (a catalog programme that left the catalog, a template not
 * loaded yet), so every entry stays: dropping them all would erase weekdays
 * the reader named.
 */
export function livePlanEntries<E extends ResolvablePlanEntry & { workoutTemplateId?: string | null }, S extends { id: string }>(
  entries: readonly E[],
  sessionsFor: (workoutTemplateId: string) => readonly S[],
): E[] {
  const templateId = [...entries].sort((left, right) => left.orderIndex - right.orderIndex)[0]?.workoutTemplateId;
  const sessions = templateId ? sessionsFor(templateId) : [];
  if (sessions.length === 0) {
    return [...entries];
  }
  const live = new Set(resolvablePlanEntries(entries, sessions).map((resolved) => resolved.entry));
  return entries.filter((entry) => live.has(entry));
}
