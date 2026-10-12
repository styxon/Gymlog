/**
 * The same programme, before and after the reader changed a lift in it.
 *
 * Editing a ready programme makes the reader their own copy of it — that is
 * what "the catalog original stays untouched" costs — and the copy carries a
 * new template id. Everything that counts a programme's work counts it by
 * template id, so the moment the copy exists the programme reads as brand
 * new: the Home hero drops from week 3 to week 1, the block's session total
 * starts from nothing (2026-09-15 audit).
 *
 * Nothing about the reader's training changed. `sourceTemplateId` already
 * records which catalog programme a copy came from, so the ids that mean "this
 * programme" are knowable — this is the one place that resolves them, so no
 * counter has to know how copying works.
 */

/** Only the fields lineage reads. The stored template carries more. */
export interface ProgrammeLineageTemplate {
  id: string;
  sourceTemplateId?: string | null;
}

/**
 * The programme a template stands for: the catalog programme it was copied
 * from, or itself when it is no copy.
 *
 * Whatever a programme IS rather than holds — its block length, the page it
 * was taken from — belongs to the origin. The copy exists only because the
 * catalog original may not be edited; asking the copy for those answers
 * found nothing and fell back to a generic default.
 */
export function programmeOriginId(templateId: string, templates: readonly ProgrammeLineageTemplate[]): string {
  const own = templates.find((template) => template.id === templateId) ?? null;
  return own?.sourceTemplateId ?? templateId;
}

/** A logged session, as lineage reads it. */
export interface LineageSession {
  workoutTemplateId?: string | null;
  workoutTemplateSessionId?: string | null;
}

/**
 * Yesterday's sessions, wearing the ids the copy's plan knows them by.
 *
 * The rotation asks "which day comes next" by matching a plan entry against a
 * logged session, template id and day id both. A copy's days carry new ids,
 * so the day after the copy was made the rotation found no match at all and
 * offered day 1 — to a reader who trained day 3 yesterday.
 *
 * A day is found by its name first. The copy takes the original's day names,
 * and a name follows its day wherever the reader drags it — matching by
 * position alone sent yesterday's day 1 to whatever the reader had moved into
 * first place (review, 2026-09-16). A day is found by position only where its
 * name says nothing: it matches no day of the copy, the lists are the same
 * length, and the copy's day in that place carries no name the original
 * knows — a day renamed where it stood. Anything else is not translated, and
 * the rotation starts over rather than guessing at a day.
 */
export function alignHistoryToCopiedDays<T extends LineageSession>(
  sessions: readonly T[],
  mapping: {
    fromTemplateIds: readonly string[];
    fromSessionIds: readonly string[];
    /**
     * Every name each original day can carry in a copy — its own, and as it
     * reads translated — index for index with `fromSessionIds`.
     */
    fromSessionNames?: ReadonlyArray<readonly string[]>;
    toTemplateId: string;
    toSessionIds: readonly string[];
    /** The copy's day names, index for index with `toSessionIds`. */
    toSessionNames?: readonly string[];
  },
): T[] {
  const { fromTemplateIds, fromSessionIds, toTemplateId, toSessionIds } = mapping;
  if (fromSessionIds.length === 0 || toSessionIds.length === 0) {
    return [...sessions];
  }

  const from = new Set(fromTemplateIds.filter((id) => id !== toTemplateId));
  if (from.size === 0) {
    return [...sessions];
  }

  const days = copiedDayMap(mapping);
  return sessions.map((session) => {
    if (!session.workoutTemplateId || !from.has(session.workoutTemplateId)) {
      return session;
    }
    const day = session.workoutTemplateSessionId ? days.get(session.workoutTemplateSessionId) : undefined;
    if (!day) {
      return session;
    }
    return {
      ...session,
      workoutTemplateId: toTemplateId,
      workoutTemplateSessionId: day,
    };
  });
}

/** Original day id → the copy's day id, for the days that can be told. */
function copiedDayMap(mapping: {
  fromSessionIds: readonly string[];
  fromSessionNames?: ReadonlyArray<readonly string[]>;
  toSessionIds: readonly string[];
  toSessionNames?: readonly string[];
}): Map<string, string> {
  const { fromSessionIds, toSessionIds } = mapping;
  const normalize = (name: string) => name.trim().toLowerCase();
  const toNames =
    mapping.toSessionNames?.length === toSessionIds.length ? mapping.toSessionNames.map(normalize) : [];
  const fromNames = fromSessionIds.map(
    (_, index) => new Set((mapping.fromSessionNames?.[index] ?? []).map(normalize).filter(Boolean)),
  );
  const sameLength = fromSessionIds.length === toSessionIds.length;
  const days = new Map<string, string>();

  fromSessionIds.forEach((fromId, index) => {
    const matches = toNames.flatMap((name, toIndex) => (fromNames[index].has(name) ? [toIndex] : []));
    if (matches.length === 1) {
      days.set(fromId, toSessionIds[matches[0]]);
      return;
    }
    if (matches.length > 1) {
      // Two days by one name: the one still in the same place, or neither.
      if (sameLength && matches.includes(index)) {
        days.set(fromId, toSessionIds[index]);
      }
      return;
    }
    const inPlace = toNames[index];
    const inPlaceIsKnown = inPlace !== undefined && fromNames.some((names) => names.has(inPlace));
    if (sameLength && !inPlaceIsKnown) {
      days.set(fromId, toSessionIds[index]);
    }
  });
  return days;
}

/**
 * The ids whose logged work belongs to THIS programme's block: the template
 * itself and the one it was copied from.
 *
 * Deliberately not the siblings. A copy inherits the history of the
 * programme it was made from — that is the whole point — but work logged in
 * somebody's OTHER copy of the same original belongs to that copy's own
 * block, and counting it here would inflate a week counter with sessions the
 * reader trained under a different plan (review of this change, 2026-09-16).
 */
export function programmeHistoryIds(
  templateId: string,
  templates: readonly ProgrammeLineageTemplate[],
  /**
   * Programmes another plan is running right now.
   *
   * A reader who edited a ready programme and later took the original up
   * again has both: the copy, and the original under its own plan. Work
   * logged against the original from then on belongs to THAT plan's block —
   * counting it here would inflate the copy's week and skew which day its
   * rotation offers next (PR #125 review). History logged before the original
   * was taken up again is the same programme's; this cannot separate the two
   * by date, so it takes the safer side and leaves the whole of it to the
   * plan that is actually running it.
   */
  claimedElsewhere: readonly string[] = [],
): string[] {
  const own = templates.find((template) => template.id === templateId) ?? null;
  const source = own?.sourceTemplateId ?? null;
  return source && source !== templateId && !claimedElsewhere.includes(source)
    ? [templateId, source]
    : [templateId];
}
