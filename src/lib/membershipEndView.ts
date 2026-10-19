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
}

export interface MembershipEndView {
  mode: MembershipEndMode;
  /** Say that it is already cancelled, instead of "nothing to cancel". */
  alreadyCancelled: boolean;
}

export function resolveMembershipEndView({ canEndNow, cancelled }: MembershipEndViewInput): MembershipEndView {
  if (cancelled) {
    return { mode: 'back', alreadyCancelled: true };
  }
  return { mode: canEndNow ? 'decide' : 'back', alreadyCancelled: false };
}
