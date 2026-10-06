/**
 * The reader's acceptance of the terms of service and the privacy policy.
 *
 * Until 2026-09-26 the app asked for nothing: the last page of onboarding said
 * "Jatkamalla hyväksyt käyttöehdot ja tietosuojaselosteen", and the page could
 * be skipped altogether, so some readers never saw even that. And the two
 * documents promised to show a change in the app before it took effect, with
 * no code behind the promise (legal review, 2026-09-16).
 *
 * Now it is a tick box with a Continue that waits for it (#bugs 2026-09-22,
 * the user's own pick of the pattern), and what was accepted is stored with
 * the version it was accepted at. The version is `LEGAL_VERSION`: when the
 * documents change, it moves, the stored acceptance no longer matches, and the
 * question is asked again — which is the promise kept.
 */

export interface LegalAcceptance {
  /** The `LEGAL_VERSION` the reader accepted: "YYYY-MM-DD", or with a ".n" suffix. */
  version: string;
  /** ISO timestamp of the tap. */
  acceptedAt: string;
}

/**
 * Whether the question is owed, and which one.
 *
 * 'first' — never accepted: the plain question.
 * 'changed' — accepted an earlier version: the question says the documents
 *   changed, because a reader asked again without being told why reads it as
 *   the app forgetting.
 * null — accepted this version, or a later one. "Later" is a phone restoring
 *   a backup made by a newer build; asking again would not be about anything.
 */
export function legalAcceptanceDue(
  acceptance: LegalAcceptance | null | undefined,
  currentVersion: string,
): 'first' | 'changed' | null {
  if (!acceptance) {
    return 'first';
  }
  return compareLegalVersions(acceptance.version, currentVersion) >= 0 ? null : 'changed';
}

const LEGAL_VERSION_SHAPE = /^(\d{4}-\d{2}-\d{2})(?:\.(\d{1,6}))?$/;

/**
 * Orders two `LEGAL_VERSION`s: the date first, then the suffix as a number —
 * a plain string compare puts '2026-10-06.10' before '2026-10-06.9', and a
 * bare date before the same date with a suffix only by luck of length.
 *
 * A value of an unknown shape never throws: it falls back to a string
 * compare, and equal strings are always equal, so a phone that stored the
 * current version is never asked again whatever the shape.
 */
export function compareLegalVersions(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const a = LEGAL_VERSION_SHAPE.exec(left);
  const b = LEGAL_VERSION_SHAPE.exec(right);
  if (!a || !b) {
    return left < right ? -1 : 1;
  }
  if (a[1] !== b[1]) {
    return a[1] < b[1] ? -1 : 1;
  }
  return Math.sign(Number(a[2] ?? 0) - Number(b[2] ?? 0));
}

/**
 * Which of two acceptances stands after a restore: the later version, and of
 * one version the earlier tap (the first time it was given).
 *
 * A restore takes the backup's preferences, and a backup from before this
 * question existed has none — so a reader who ticked the box on the last page
 * of onboarding, signed in, and had an older backup restored was asked again
 * the moment the app opened. An acceptance is a fact about the person, and
 * neither phone's copy of it is wrong; the one that covers more wins.
 */
export function laterLegalAcceptance(
  left: LegalAcceptance | null | undefined,
  right: LegalAcceptance | null | undefined,
): LegalAcceptance | null {
  if (!left || !right) {
    return left ?? right ?? null;
  }
  const order = compareLegalVersions(left.version, right.version);
  if (order !== 0) {
    return order > 0 ? left : right;
  }
  return left.acceptedAt <= right.acceptedAt ? left : right;
}

export function acceptLegal(currentVersion: string, now: Date): LegalAcceptance {
  return { version: currentVersion, acceptedAt: now.toISOString() };
}

/**
 * The stored value, trusted only if it has both parts in the right shape.
 *
 * Anything else is null, which asks again. That is the safe direction to be
 * wrong in: a malformed record that read as accepted would be an acceptance
 * nobody gave.
 */
export function normalizeLegalAcceptance(raw: unknown): LegalAcceptance | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const { version, acceptedAt } = raw as Record<string, unknown>;
  if (typeof version !== 'string' || !LEGAL_VERSION_SHAPE.test(version)) {
    return null;
  }
  if (typeof acceptedAt !== 'string' || Number.isNaN(Date.parse(acceptedAt))) {
    return null;
  }
  return { version, acceptedAt };
}
