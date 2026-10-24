/**
 * The purchase record as it comes off disk, with one migration.
 *
 * Pure so it can be tested: the loader that calls it imports AsyncStorage and
 * cannot be loaded by a plain Node test, which is how a migration would ship
 * untested.
 *
 * On the code before 2026-09-03 the ONLY writer of the purchase instant was
 * the free preview switch: the Pro page's CTA wrote both in one go, and
 * turning the switch back off cleared neither. Every install of that code
 * carries the switch's key (it was seeded false), so its presence marks a
 * store from before the purchase meant anything. A purchase found beside it
 * is not one and is dropped; otherwise every install that ever tried the
 * switch would wake up with permanent Pro, which is the hole that change
 * closes. The legacy boolean mockSubscriptionCancelled is folded into the
 * instant for the same reason: dropping it would revive a cancelled
 * subscription as never-ending.
 */
export interface PurchaseRecord {
  mockSubscriptionPurchasedAt: string | null;
  mockSubscriptionCancelledAt: string | null;
  mockSubscriptionEndsAt: string | null;
  mockSubscriptionBillingIssue: boolean;
}

export function normalizePurchaseRecord(
  stored: Record<string, unknown> | undefined,
  fallback: PurchaseRecord,
  now: Date = new Date(),
): PurchaseRecord {
  // `in` throws on null, and a stored `preferences: null` reached here as
  // null — which made the whole database unreadable and set it aside as
  // corrupt, history and all, over one field (loader probe, 2026-09-20).
  const legacyStore = stored != null && typeof stored === 'object' && 'adaptiveCoachPremiumUnlocked' in stored;
  const purchasedAt =
    !legacyStore && typeof stored?.mockSubscriptionPurchasedAt === 'string'
      ? stored.mockSubscriptionPurchasedAt
      : fallback.mockSubscriptionPurchasedAt;
  const cancelledAt =
    typeof stored?.mockSubscriptionCancelledAt === 'string'
      ? stored.mockSubscriptionCancelledAt
      : stored?.mockSubscriptionCancelled === true
        ? now.toISOString()
        : fallback.mockSubscriptionCancelledAt;
  // A stored end that is not a parseable date is no end (an install from
  // before the field existed has none at all): the entitlement then counts the
  // period from the cancellation stamp, as it always did.
  const storedEndsAt = stored?.mockSubscriptionEndsAt;
  const endsAt =
    typeof storedEndsAt === 'string' && Number.isFinite(new Date(storedEndsAt).getTime())
      ? storedEndsAt
      : fallback.mockSubscriptionEndsAt;
  return {
    // `true` or it is not (absent on every install from before the field).
    mockSubscriptionBillingIssue:
      purchasedAt !== null && cancelledAt !== null && stored?.mockSubscriptionBillingIssue === true,
    mockSubscriptionEndsAt: purchasedAt === null ? null : endsAt,
    mockSubscriptionPurchasedAt: purchasedAt,
    // A cancellation without a purchase is nothing to cancel.
    mockSubscriptionCancelledAt: purchasedAt === null ? null : cancelledAt,
  };
}
