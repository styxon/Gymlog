/**
 * "Do I already have my own version of this ready programme?"
 *
 * Two things in this app make a copy of a catalog programme. Editing a lift in
 * one forks it, and that fork records where it came from — `sourceTemplateId`,
 * see programLineage. Onboarding makes one too: the questionnaire fits the
 * recommended programme to the answers, and what the reader trains is that
 * fitted copy, saved as a programme of their own. That copy recorded nothing,
 * so nothing downstream could tell it apart from a programme typed in by hand
 * (audit round 4, 2026-09-20). The catalog page went on showing the composed
 * week while its buttons worked on the untouched original: the day editor could
 * not find the copy and made a second one, and "Take this programme" adopted the
 * catalog version beside the copy the reader was already training.
 *
 * The link is written now — onboarding's draft carries `sourceTemplateId` like
 * any other copy — and this module is the one place that asks the question, so
 * no screen has to know how copying works.
 *
 * Installs made before the link existed still have a copy with no field on it,
 * and they are the installs the bug was reported from. Those copies are
 * knowable anyway: composing renames every day, and the names it gives carry
 * the programme they were composed from — `onboarding_<programme id>_<n>`, see
 * programDayComposer. That is the fallback, and it reads a day id rather than
 * a programme name, so it does not care what language the copy was made in.
 */

/** Only the fields the question is asked of. The stored template carries more. */
export interface ProgrammeCopyTemplate {
  id: string;
  sourceTemplateId?: string | null;
  sessions?: readonly { id: string }[];
}

/**
 * The day ids a composed week of this programme carries.
 *
 * `onboarding_` alone would be ambiguous — every composed week starts that way
 * — so the programme id is part of the test. It is not the whole test: what
 * follows this prefix has to be the day's number, or a programme whose id
 * merely begins with another's would answer for it.
 */
export function onboardingSessionIdPrefix(readyTemplateId: string): string {
  return `onboarding_${readyTemplateId}_`;
}

/** Whether this stored template is the reader's own version of that programme. */
export function isCopyOfReadyProgramme(
  template: ProgrammeCopyTemplate,
  readyTemplateId: string,
): boolean {
  if (template.id === readyTemplateId) {
    return false;
  }
  if (template.sourceTemplateId === readyTemplateId) {
    return true;
  }
  const prefix = onboardingSessionIdPrefix(readyTemplateId);
  // The day number has to be a day number. A prefix test on its own read the
  // first day of a composed "tpl_strong_starter_v2" as a copy of
  // "tpl_strong_starter", which is a different programme with a shorter name.
  return (template.sessions ?? []).some(
    (session) => session.id.startsWith(prefix) && /^[0-9]+$/.test(session.id.slice(prefix.length)),
  );
}

/** Every template that is a copy of this programme, in stored order. */
function copyIdsOf(
  readyTemplateId: string,
  templates: readonly ProgrammeCopyTemplate[],
): string[] {
  return templates
    .filter((template) => isCopyOfReadyProgramme(template, readyTemplateId))
    .map((template) => template.id);
}

/**
 * The reader's own version of a ready programme, or null.
 *
 * A reader can hold two: a copy from onboarding and, on an install made
 * before the link existed, a fork of the same programme made later by
 * editing a lift. Stored order answers with the older one, which is not
 * necessarily the one being trained — and resuming the wrong one leaves two
 * copies of one programme running, which is the thing this module exists to
 * prevent. So the caller says which ids it would rather have, running ones
 * first, and stored order decides only what nothing else does.
 */
export function findReadyProgrammeCopyId(
  readyTemplateId: string,
  templates: readonly ProgrammeCopyTemplate[],
  preferredIds: readonly string[] = [],
): string | null {
  const copies = copyIdsOf(readyTemplateId, templates);
  // Walked the copies and asked whether each was preferred, which reads
  // `preferredIds` as a set: with a held copy stored before a running one,
  // the held copy won and adoption resumed a second copy beside the first
  // (CI review of #163). The order of the preference is the preference.
  return preferredIds.find((id) => copies.includes(id)) ?? copies[0] ?? null;
}

/**
 * The reader's own version of a ready programme that something points at.
 *
 * Forgetting a programme drops the plan and leaves the template standing, so
 * a reader can carry a copy nothing points at for good. That leftover is not
 * what they are training, and a page that asked its questions about it showed
 * the adopt button for a programme already running under its own catalog id,
 * with no switch and no way to put it down (CI review of #163). Null when
 * every copy is a leftover — the caller then means the catalog programme.
 *
 * Whether a copy EXISTS is a different question, and findReadyProgrammeCopyId
 * is the one that answers it: a leftover copy still means the composed week
 * belongs to the reader's own page rather than to the catalog's.
 */
export function findHeldReadyProgrammeCopyId(
  readyTemplateId: string,
  templates: readonly ProgrammeCopyTemplate[],
  heldTemplateIds: readonly string[],
): string | null {
  const copies = copyIdsOf(readyTemplateId, templates);
  return heldTemplateIds.find((id) => copies.includes(id)) ?? null;
}

/**
 * The catalog programme a stored template is a copy of, or null.
 *
 * The other direction, for the questions asked programme-first: is this thing
 * the reader is running the same programme as that card. Only ids the caller
 * offers count, so a link to a programme the catalog no longer has answers
 * null rather than naming a ghost.
 */
export function resolveSourceReadyProgrammeId(
  template: ProgrammeCopyTemplate,
  readyTemplateIds: readonly string[],
): string | null {
  if (template.sourceTemplateId && readyTemplateIds.includes(template.sourceTemplateId)) {
    return template.sourceTemplateId;
  }
  return readyTemplateIds.find((readyId) => isCopyOfReadyProgramme(template, readyId)) ?? null;
}

/**
 * Every programme the reader is running, named the way the catalog names it.
 *
 * "Sinulle" drops what you already run, by template id — and the id of a copy
 * is not the id of the programme it is a copy of, so the row went on
 * recommending the very programme the questionnaire had just handed over. The
 * ids come back with the copies' own ids kept: the caller is testing
 * membership, and both names of one programme are true.
 */
export function expandRunningIdsWithSources(
  runningTemplateIds: readonly string[],
  templates: readonly ProgrammeCopyTemplate[],
  readyTemplateIds: readonly string[],
): string[] {
  const byId = new Map(templates.map((template) => [template.id, template]));
  const ids = new Set<string>();
  for (const runningId of runningTemplateIds) {
    ids.add(runningId);
    const template = byId.get(runningId);
    const source = template ? resolveSourceReadyProgrammeId(template, readyTemplateIds) : null;
    if (source) {
      ids.add(source);
    }
  }
  return [...ids];
}
