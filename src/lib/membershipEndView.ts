/**
 * What the end-membership screen offers, decided before it draws.
 *
 * The screen is for a moment: Pro is running and renewing, and the reader may
 * end it. Only then does it carry a decision (keep / end). Every other state
 * has nothing to decide, so it gets the page and one way out:
 *
 *   - 'decide' — a purchase that still renews. Keep (primary) and End.
 *   - 'back'   — a cancellation is a moment, not a flag: once it has been made
 *                (here, or in the store and read back by the sync) the screen
 *                must not offer to end it again or ask to be kept. Promo,
 *                trial and review accounts have nothing to cancel either.
 */
export type MembershipEndMode = 'decide' | 'back';

export interface MembershipEndViewInput {
  /** The plan says the app can end it now (a purchase). */
  canEndNow: boolean;
  /** A cancellation is on record for the current purchase. */
  cancelled: boolean;
  /**
   * The store could not collect the renewal and is retrying (grace period):
   * the subscription is not renewing right now, but the reader did not end it.
   */
  billingIssue?: boolean;
}

export interface MembershipEndView {
  mode: MembershipEndMode;
  /** Say that it is already cancelled, instead of "nothing to cancel". */
  alreadyCancelled: boolean;
  /** Say that the payment failed and the store is retrying - not "cancelled". */
  billingIssue: boolean;
}

export function resolveMembershipEndView({
  canEndNow,
  cancelled,
  billingIssue = false,
}: MembershipEndViewInput): MembershipEndView {
  // A failed payment is not a cancellation: nothing to end, nothing to call
  // cancelled. The way out is fixing the payment method in the store.
  if (cancelled && canEndNow && billingIssue) {
    return { mode: 'back', alreadyCancelled: false, billingIssue: true };
  }
  // "Already cancelled" is a fact about a purchase. A promo, trial or review
  // grant with a stale stamp left by an earlier purchase has nothing cancelled.
  if (cancelled && canEndNow) {
    return { mode: 'back', alreadyCancelled: true, billingIssue: false };
  }
  return { mode: canEndNow ? 'decide' : 'back', alreadyCancelled: false, billingIssue: false };
}

/**
 * The `cancelled` the screen is handed: true only when Pro is running as a
 * purchase and its cancellation stamp is set. The stamp survives a purchase
 * that ended, so reading it alone told a promo, trial or review user "already
 * cancelled" for a subscription they no longer have.
 */
export function membershipEndCancelled(
  entitlementSource: string | null,
  cancelledAt: string | null,
): boolean {
  return entitlementSource === 'purchase' && cancelledAt !== null;
}
