/**
 * When a subscription term runs out.
 *
 * Only the arithmetic lives here, not the terms table — subscriptionView keeps
 * that, with its labels and CTAs. The split exists for one reason: the
 * entitlement has to know when a purchase ends, subscriptionView already
 * imports ProEntitlement, and proEntitlement importing a value back would be a
 * runtime cycle. Both import this instead.
 */
export type SubscriptionTermKey = 'monthly' | 'yearly' | 'lifetime';

/** Lifetime is bought once and never charged again; the other two renew. */
const TERM_RENEWS: Record<SubscriptionTermKey, boolean> = {
  monthly: true,
  yearly: true,
  lifetime: false,
};

export function isSubscriptionTermKey(value: unknown): value is SubscriptionTermKey {
  return value === 'monthly' || value === 'yearly' || value === 'lifetime';
}

/**
 * N periods on from a date, clamped ONCE.
 *
 * The day of month is taken from the ORIGINAL date every time. Chaining
 * single-period steps instead let a clamp compound: a 31 January purchase
 * stepped to 28 February (right), then to 28 March (wrong: March has a 31st),
 * and never recovered, so a subscriber who bought on the 31st lost up to three
 * days of every period for the life of the subscription.
 *
 * UTC arithmetic, not local: setMonth/setFullYear work in local time, so a
 * period crossing a daylight-saving boundary landed an hour off, which is a
 * whole day wrong once the purchase sits near midnight.
 */
export function addPeriods(term: SubscriptionTermKey, fromIso: string, count: number): string | null {
  if (!TERM_RENEWS[term]) {
    return null;
  }
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) {
    return null;
  }
  const next = new Date(from.getTime());
  const day = from.getUTCDate();
  if (term === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + count);
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + count);
  }
  // Month-end overflow: the 31st plus a month is the 3rd of the month after,
  // because JS rolls forward rather than clamping. A subscription bought on
  // the 31st renews on the last day of a short month, so clamp back into it.
  if (next.getUTCDate() !== day) {
    next.setUTCDate(0);
  }
  return next.toISOString();
}

/** One period on from a charge. Lifetime returns null: it does not renew. */
export function nextChargeAt(term: SubscriptionTermKey, lastChargedAtIso: string): string | null {
  return addPeriods(term, lastChargedAtIso, 1);
}

/** A subscription older than this many periods is not worth walking forward. */
const MAX_PERIODS = 400;

/**
 * The end of the period the reader is currently inside.
 *
 * A purchase from three months ago on a monthly term has renewed twice since,
 * so its period does not end one month after the purchase; it ends one month
 * after the last renewal. Every candidate is counted from the ORIGINAL
 * purchase date (see addPeriods), so the month-end clamp cannot compound.
 *
 * Null for lifetime (no period ends) and for a date that cannot be read.
 */
export function currentPeriodEndAt(
  term: SubscriptionTermKey,
  purchasedAtIso: string,
  now: Date = new Date(),
): string | null {
  if (!TERM_RENEWS[term]) {
    return null;
  }
  for (let period = 1; period <= MAX_PERIODS; period += 1) {
    const end = addPeriods(term, purchasedAtIso, period);
    if (end === null) {
      return null;
    }
    if (new Date(end).getTime() > now.getTime()) {
      return end;
    }
  }
  return null;
}

/**
 * The end of the current period of a subscription that is still renewing,
 * as the screens name it ("next charge", "paid until").
 *
 * The store's own end (`mockSubscriptionEndsAt`, RevenueCat's
 * `expirationDate`) when it is still ahead: the purchase date the store hands
 * back is the latest renewal, not the original day, so counting a term from it
 * let the month-end clamp compound after all — a subscription bought on 31
 * January, renewed on 28 February, read "next charge 28 March" while Play
 * charges on the 31st (bug hunt, 2026-10-29). A trial or grace period has its
 * own length that no term can count either. A stored end already passed says
 * nothing about the period now running (a renewal that landed while the app
 * was closed), so the counted end stands in.
 *
 * Display only: whether Pro is on stays with the entitlement, which ignores
 * this end for a renewing record.
 */
export function renewingPeriodEndAt(
  term: SubscriptionTermKey,
  purchasedAtIso: string,
  storedEndsAtIso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!TERM_RENEWS[term]) {
    return null;
  }
  const storedEnd = storedEndsAtIso ? new Date(storedEndsAtIso).getTime() : Number.NaN;
  if (Number.isFinite(storedEnd) && storedEnd > now.getTime()) {
    return storedEndsAtIso as string;
  }
  return currentPeriodEndAt(term, purchasedAtIso, now);
}
