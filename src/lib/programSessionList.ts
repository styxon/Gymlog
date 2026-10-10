import { t } from './i18n';
import { AppLanguage } from '../types/models';

/**
 * Adding and removing whole days of a custom programme.
 *
 * The page offered two things to do with a programme: change a day, or delete
 * the whole programme. "Yhtä päivää ei voi lisätä eikä poistaa" — the reader
 * wanted a three-way split out of a five-day programme and had no way to get
 * there short of starting over (#bugs 2026-09-24).
 *
 * A new day is named first and saved empty, then filled on its own page
 * (user, 2026-09-26: "tähän tulee ensiksi nimeä päivä … se menee tyhjänä").
 * The first build picked the lifts first and wrote them with the day, to keep
 * the rule that a programme never holds an empty day; the reader found that
 * backwards. The rule moves to where an empty day could hurt: it is never
 * offered as the next session and cannot be started (`nextStartableSession
 * Index`, and the start handler's own refusal).
 *
 * A programme has at least one day. Removing the last one would be deleting
 * the programme, which has its own button and its own question.
 */

/** Only the fields these read. Stored sessions carry more. */
export interface ListedSession {
  id: string;
  orderIndex: number;
}

export type RemoveProgramSessionOutcome<T> =
  | { kind: 'skip'; reason: 'sessionMissing' | 'lastSession' }
  | { kind: 'removed'; sessions: T[] };

export function removeProgramSession<T extends ListedSession>(
  sessions: ReadonlyArray<T>,
  sessionId: string,
): RemoveProgramSessionOutcome<T> {
  // Position is read from orderIndex, the same way the reorder reads it.
  const ordered = [...sessions].sort((left, right) => left.orderIndex - right.orderIndex);
  if (!ordered.some((session) => session.id === sessionId)) {
    return { kind: 'skip', reason: 'sessionMissing' };
  }
  if (ordered.length <= 1) {
    return { kind: 'skip', reason: 'lastSession' };
  }
  return {
    kind: 'removed',
    // Re-numbered from where the rows now sit, so the stored order has no gap.
    sessions: ordered
      .filter((session) => session.id !== sessionId)
      .map((session, orderIndex) => ({ ...session, orderIndex })),
  };
}

/**
 * Whether a programme has days but not one with anything in it — the state
 * Home names instead of looking like no programme at all (audit 8,
 * 2026-09-26: add an empty day, remove the only filled one, and the hero,
 * the week and the counters all vanished).
 */
export function hasOnlyEmptyDays(exerciseCounts: ReadonlyArray<number>): boolean {
  return exerciseCounts.length > 0 && nextStartableSessionIndex(exerciseCounts, 0) === null;
}

/**
 * The session the rotation should offer, skipping days with nothing in them.
 *
 * `from` is where the rotation points; the search walks forward from there
 * and wraps, so an empty day in the middle of a programme hands its turn to
 * the next day that can actually be trained. Null when no day can — a
 * programme whose days are all still empty has nothing to offer yet.
 */
export function nextStartableSessionIndex(exerciseCounts: ReadonlyArray<number>, from: number): number | null {
  const count = exerciseCounts.length;
  if (count === 0) {
    return null;
  }
  const start = Number.isFinite(from) ? ((Math.floor(from) % count) + count) % count : 0;
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if ((exerciseCounts[index] ?? 0) > 0) {
      return index;
    }
  }
  return null;
}

/**
 * The day a programme's own "start" button runs.
 *
 * A programme Home is leading with starts what Home offers (`leadingNextId`):
 * the rotation's next day, or the day the reader picked for today. The button
 * said "Start next workout" and ran the first day with lifts in it, whatever
 * the rotation had reached (bug hunt 11, home). A programme that is not
 * leading has no rotation to read, so it starts its first day with lifts.
 * Null when no day has anything in it.
 */
export function programmeStartSessionId(
  sessions: ReadonlyArray<{ id: string; exerciseCount: number }>,
  programId: string,
  card: { programId: string; nextSession?: { id: string } | null } | null | undefined,
): string | null {
  const leadingNextId = card?.programId === programId ? card.nextSession?.id : null;
  const offered = leadingNextId ? sessions.find((session) => session.id === leadingNextId) : null;
  if (offered && offered.exerciseCount > 0) {
    return offered.id;
  }
  return sessions.find((session) => session.exerciseCount > 0)?.id ?? null;
}

/**
 * A new day's stored name: the placeholder the template editor writes, "Päivä
 * N" in the reader's language. The day list prints a placeholder as "Treeni N"
 * by position, and Home names it from its lifts — both already know this
 * shape, so a new day reads like any other unnamed one until it is renamed.
 */
export function newProgramSessionName(existingCount: number, language: AppLanguage): string {
  return t(language, 'tpl.day', { index: Math.max(0, Math.floor(existingCount)) + 1 });
}
