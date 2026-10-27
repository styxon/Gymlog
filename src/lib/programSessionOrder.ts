/**
 * Moving a whole day inside a programme.
 *
 * The exercises inside a day have been draggable since the frame-05 round;
 * the days themselves were fixed in the order they were created (user
 * 2026-08-31: "voi järjestystä vaihtaa miten haluaa — tee identtinen systeemi
 * kun siellä missä treenejä voi vaihtaa"). Same contract as that one: the drop
 * is ONE write, the destination is clamped rather than refused, and a move
 * that changes nothing is not a write at all.
 *
 * This matters more than reordering lifts does. The rotation reads the session
 * list positionally — slot 0 is the first session — so moving a day changes
 * which day of the week each session lands on. That is the point, but it is
 * also why a no-op must not be saved: rewriting the template would re-stamp
 * every orderIndex for a list that looks exactly as it did.
 */

/** Only the fields the move reads. Stored sessions carry more. */
interface OrderableSession {
  id: string;
  orderIndex: number;
}

type ProgramSessionOrderOutcome<T> =
  | { kind: 'skip'; reason: 'sessionMissing' | 'alreadyThere' }
  | { kind: 'reordered'; sessions: T[] };

export function reorderProgramSessions<T extends OrderableSession>(
  sessions: ReadonlyArray<T>,
  sessionId: string,
  toIndex: number,
): ProgramSessionOrderOutcome<T> {
  // Position in the array is the answer, so read it from the array — not from
  // whatever orderIndex happens to say. The two disagree exactly once: between
  // this splice and the re-stamp below.
  const ordered = [...sessions].sort((left, right) => left.orderIndex - right.orderIndex);
  const from = ordered.findIndex((session) => session.id === sessionId);
  if (from === -1) {
    return { kind: 'skip', reason: 'sessionMissing' };
  }

  // A finger that overshoots the list still means "last".
  const to = Math.max(0, Math.min(ordered.length - 1, Math.round(toIndex)));
  if (to === from) {
    return { kind: 'skip', reason: 'alreadyThere' };
  }

  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  // Re-numbered from where the rows now sit: the position in this array is
  // what the reader sees, and orderIndex is what is stored.
  return { kind: 'reordered', sessions: next.map((session, orderIndex) => ({ ...session, orderIndex })) };
}
