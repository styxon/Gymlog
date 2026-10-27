/**
 * Which session the plan offers next.
 *
 * Home offered `entries[0]` — always. Finish day 1 and Home offered day 1
 * again; the hero, the warm-up, the start button and the trimmed start all
 * described the wrong workout, and logging it wrote the wrong session against
 * the plan. lib/dashboard kept a second copy of the rotation that nothing
 * called and that had drifted (it offered entry 2 for ever on a plan whose
 * entries name no session); it was deleted (duplicate sweep 13, 2026-10-12).
 *
 * Pure and shared so the two cannot disagree again.
 */
import { startOfLocalDay } from './calendarDays';

export interface PlanRotationEntry {
  workoutTemplateId: string;
  /** Null on plans that point at a template rather than a named session. */
  workoutTemplateSessionId?: string | null;
}

export interface PlanRotationSession {
  workoutTemplateId: string;
  workoutTemplateSessionId?: string | null;
  /** ISO timestamp. */
  performedAt: string;
}

function entryMatchesSession(entry: PlanRotationEntry, session: PlanRotationSession): boolean {
  if (entry.workoutTemplateId !== session.workoutTemplateId) {
    return false;
  }
  // An entry with no session id stands for the whole template, so any logged
  // session of that template counts as this entry.
  return entry.workoutTemplateSessionId
    ? entry.workoutTemplateSessionId === session.workoutTemplateSessionId
    : true;
}

/**
 * The index of the entry to offer next: the one after the most recently
 * completed, wrapping.
 *
 * Returns 0 when nothing has been logged yet, and 0 for an empty plan so the
 * caller's `entries[index]` is undefined rather than a negative lookup.
 */
/**
 * Whether this plan was trained on the local day starting at `dayStart`, by
 * the same match the rotation counts with.
 *
 * The calendar forecast asked "was anything logged today", and the list it
 * was handed holds every programme's sessions: a workout of another
 * programme marked this one trained and pushed its labels a session along
 * (recheck of #224, 2026-09-28).
 */
export function planTrainedOnDay(
  entries: readonly PlanRotationEntry[],
  completed: readonly PlanRotationSession[],
  dayStart: number,
): boolean {
  return completed.some((session) => {
    const stamp = Date.parse(session.performedAt);
    if (!Number.isFinite(stamp)) {
      return false;
    }
    const start = startOfLocalDay(new Date(stamp));
    return start === dayStart && entries.some((entry) => entryMatchesSession(entry, session));
  });
}

export function resolveNextPlanEntryIndex(
  entries: readonly PlanRotationEntry[],
  completed: readonly PlanRotationSession[],
): number {
  if (entries.length === 0) {
    return 0;
  }

  // A plan whose entries name no session — an older record, or one built by a
  // path that labelled its days by position — cannot be matched: every entry
  // stands for the whole template, so `findIndex` finds the first one every
  // time and the plan offers entry 1 forever. That is the reported "after
  // Monday, Home still offers Monday". With nothing to match on, the honest
  // answer is the count: three logged sessions mean three days spent.
  if (!entries.some((entry) => Boolean(entry.workoutTemplateSessionId))) {
    const spent = completed.filter(
      (session) =>
        Number.isFinite(Date.parse(session.performedAt)) &&
        entries.some((entry) => entryMatchesSession(entry, session)),
    ).length;
    return spent % entries.length;
  }

  let latest: PlanRotationSession | null = null;
  let latestStamp = Number.NEGATIVE_INFINITY;
  for (const session of completed) {
    const stamp = Date.parse(session.performedAt);
    // A corrupt timestamp cannot be ordered against the others; treating it as
    // "most recent" would let one bad row decide the whole rotation.
    if (!Number.isFinite(stamp) || stamp <= latestStamp) {
      continue;
    }
    if (entries.some((entry) => entryMatchesSession(entry, session))) {
      latest = session;
      latestStamp = stamp;
    }
  }

  if (!latest) {
    return 0;
  }

  const latestIndex = entries.findIndex((entry) => entryMatchesSession(entry, latest as PlanRotationSession));
  if (latestIndex === -1) {
    return 0;
  }
  return (latestIndex + 1) % entries.length;
}
