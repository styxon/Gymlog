import type { AppPreferences } from '../types/models';
import type { SubscriptionTermKey } from './subscriptionTerm';

/**
 * What the store says about Pro, turned into the purchase record the rest of
 * the app already reads.
 *
 * The record is the three `mockSubscription*` fields. They were written by the
 * demo's invented purchase; in a release build the store writes them instead,
 * through this function, and nothing else does. The names stayed because the
 * entitlement, the subscription screen, the unlock screen and the stored data
 * of every install already agree on them — what changed is who is allowed to
 * write. Pure: the billing service hands in a plain snapshot of RevenueCat's
 * CustomerInfo, so this runs in Node.
 *
 * Store setup this expects (RevenueCat dashboard, once the Play account exists):
 *   - one entitlement, `STORE_PRO_ENTITLEMENT`;
 *   - a current offering whose Monthly, Annual and Lifetime packages are the
 *     three plans the Pro page sells (`storePackageForPlan`);
 *   - product ids that name their term (`termForStoreProduct`).
 */

export const STORE_PRO_ENTITLEMENT = 'pro';

/** The fields of RevenueCat's PurchasesEntitlementInfo this reads. */
export interface StoreEntitlementSnapshot {
  isActive: boolean;
  willRenew: boolean;
  /** ISO. The start of the current period for a subscription. */
  latestPurchaseDate: string;
  /** ISO, null for a one-time purchase. */
  expirationDate: string | null;
  productIdentifier: string;
  /** ISO. When the store saw the reader turn renewal off. */
  unsubscribeDetectedAt: string | null;
}

/** The fields of RevenueCat's CustomerInfo this reads. */
export interface StoreCustomerSnapshot {
  entitlements: { active: Record<string, StoreEntitlementSnapshot | undefined> };
}

export type PurchaseRecord = Pick<
  AppPreferences,
  'mockSubscriptionPurchasedAt' | 'mockSubscriptionTerm' | 'mockSubscriptionCancelledAt'
>;

/** RevenueCat's package slot for each plan the Pro page sells. */
export function storePackageForPlan(plan: SubscriptionTermKey): 'monthly' | 'annual' | 'lifetime' {
  return plan === 'yearly' ? 'annual' : plan;
}

/**
 * Which term a store product is.
 *
 * Read from the id, so the ids have to say it: `vinha_pro_lifetime`, and
 * subscriptions whose id or base plan names the period (Play reports
 * `vinha_pro:yearly`, App Store `vinha_pro_yearly`). Null for an id that names
 * none of them — the reader still has Pro, the screen just keeps the term it
 * had.
 */
export function termForStoreProduct(productId: string): SubscriptionTermKey | null {
  const id = productId.toLowerCase();
  if (id.includes('lifetime')) {
    return 'lifetime';
  }
  if (id.includes('year') || id.includes('annual')) {
    return 'yearly';
  }
  if (id.includes('month')) {
    return 'monthly';
  }
  return null;
}

function isoOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}

/**
 * The purchase record the store's answer stands for.
 *
 * No active entitlement clears the record: the store is the authority, so a
 * refund, a lapsed renewal or a purchase the store never knew about (the
 * demo's invented one) all end here. `current` supplies the term to keep when
 * the store names none, and a cancellation stamp already made for this period.
 *
 * A cancelled subscription keeps Pro to the end of the period it was cancelled
 * in. The record says that the way the entitlement counts it — period start
 * plus a cancellation inside the period — so `resolveProEntitlement` names the
 * same end the store will.
 */
export function purchaseRecordFromStore(
  customer: StoreCustomerSnapshot,
  current: PurchaseRecord,
  now: Date = new Date(),
): PurchaseRecord {
  const entitlement = customer.entitlements.active[STORE_PRO_ENTITLEMENT];
  const purchasedAt = entitlement?.isActive ? isoOrNull(entitlement.latestPurchaseDate) : null;
  if (!entitlement || purchasedAt === null) {
    return {
      mockSubscriptionPurchasedAt: null,
      mockSubscriptionTerm: current.mockSubscriptionTerm,
      mockSubscriptionCancelledAt: null,
    };
  }

  const term = termForStoreProduct(entitlement.productIdentifier) ?? current.mockSubscriptionTerm;
  // Lifetime has no renewal to turn off; the store reports willRenew false
  // for it all the same, and the entitlement ignores a stamp on it anyway.
  const cancelled = term !== 'lifetime' && !entitlement.willRenew;
  // With no date from the store, the first sync that saw the cancellation
  // stamps it and later syncs of the same period keep that stamp, so an
  // unchanged answer writes nothing.
  const keptStamp =
    current.mockSubscriptionPurchasedAt === purchasedAt ? current.mockSubscriptionCancelledAt : null;
  return {
    mockSubscriptionPurchasedAt: purchasedAt,
    mockSubscriptionTerm: term,
    mockSubscriptionCancelledAt: cancelled
      ? isoOrNull(entitlement.unsubscribeDetectedAt) ?? keptStamp ?? now.toISOString()
      : null,
  };
}

/** True when writing `next` would change nothing — a sync that agrees writes nothing. */
export function samePurchaseRecord(current: PurchaseRecord, next: PurchaseRecord): boolean {
  return (
    current.mockSubscriptionPurchasedAt === next.mockSubscriptionPurchasedAt &&
    current.mockSubscriptionTerm === next.mockSubscriptionTerm &&
    current.mockSubscriptionCancelledAt === next.mockSubscriptionCancelledAt
  );
}
