/**
 * Whether the session the reader chose for today still stands.
 *
 * The rotation knows what comes next in the programme and cannot know that
 * today is legs, so a pick overrides it — for the day it was given, which is
 * why the pick is dated rather than sticky.
 *
 * Once the picked session has been trained the question has changed, and a
 * pick left standing offered the finished workout again. But "already trained
 * today" is not the same as "stale": picking a session you have just finished
 * is the one way to say "that one again", and the app has no other — the day
 * page is a reading page by decision (2026-08-18) and the programme's own
 * button starts whatever the rotation says. Discarding by date alone made a
 * repeat impossible from anywhere (user 2026-08-26).
 *
 * So the pick's own instant decides: a session finished BEFORE the pick was
 * made cannot have answered it.
 */
export interface TodaySessionPick {
  dayStart: number;
  sessionId: string;
  pickedAt: number;
  /**
   * The programme the pick was made in. Session ids repeat across catalog
   * programmes, so the id alone does not say which programme's day was meant.
   * Null on a pick stored before this existed: its programme is unknowable, so
   * it keeps the old behaviour and applies to whichever programme leads.
   */
  workoutTemplateId?: string | null;
}

export interface CompletedPlanSession {
  workoutTemplateId?: string | null;
  workoutTemplateSessionId?: string | null;
  performedAt: string;
}

export function resolveTodaySessionPick<T extends { id: string }>(input: {
  pick: TodaySessionPick | null;
  sessions: readonly T[];
  todayDayStart: number;
  completed: readonly CompletedPlanSession[];
  /** Start-of-day for a completion, so callers keep one date implementation. */
  toDayStart: (performedAt: string) => number;
  /**
   * The programme now leading (all the template ids it runs under). A pick
   * made in a programme outside it is not this programme's, and only sessions
   * of these templates can have answered the pick. Omitted: no programme check.
   */
  templateIds?: ReadonlySet<string>;
}): T | null {
  const { pick, sessions, todayDayStart, completed, toDayStart, templateIds } = input;
  if (!pick || pick.dayStart !== todayDayStart) {
    return null;
  }
  if (templateIds && pick.workoutTemplateId && !templateIds.has(pick.workoutTemplateId)) {
    return null;
  }

  const picked = sessions.find((session) => session.id === pick.sessionId) ?? null;
  if (!picked) {
    return null;
  }

  const answeredByATrainedSession = completed.some((entry) => {
    if (entry.workoutTemplateSessionId !== picked.id) {
      return false;
    }
    // A same-id day of some other programme did not answer this pick.
    if (templateIds && entry.workoutTemplateId && !templateIds.has(entry.workoutTemplateId)) {
      return false;
    }
    if (toDayStart(entry.performedAt) !== todayDayStart) {
      return false;
    }
    const performedAt = Date.parse(entry.performedAt);
    // An unreadable timestamp cannot be shown to be older than the pick, and
    // the conservative answer is the one that was true before: it counts.
    return !Number.isFinite(performedAt) || performedAt >= pick.pickedAt;
  });

  return answeredByATrainedSession ? null : picked;
}

/**
 * The pick, followed onto the copy of its programme. A ready programme's first
 * edit copies it under new programme and day ids; a pick keyed by the old ones
 * resolved to nothing, and Home went back to the rotation's day. A pick made in
 * another programme is left alone.
 */
export function movePickToCopy(
  pick: TodaySessionPick | null,
  fromTemplateId: string,
  toTemplateId: string,
  sessionIds: Readonly<Record<string, string>>,
): TodaySessionPick | null {
  if (!pick || pick.workoutTemplateId !== fromTemplateId) {
    return pick;
  }
  const sessionId = sessionIds[pick.sessionId];
  return sessionId ? { ...pick, sessionId, workoutTemplateId: toTemplateId } : pick;
}
