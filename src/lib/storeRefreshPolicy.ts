import type { AppPreferences } from '../types/models';

/**
 * Whether coming back to the front is worth asking the store again.
 *
 * The store pushes its changes while the app runs; one that happened while it
 * was closed (a billing-retry payer whose card finally went through) is only
 * known at the next read. Until then a record that has reached its stored end
 * locks Pro on a subscription that was in fact renewed. So the app asks once
 * per return to the front, and only when the record is in the state where the
 * answer could differ: a cancelled or failing subscription (its last period),
 * or any subscription whose stored end has passed. A plain renewing record
 * inside its period, lifetime and "no purchase" never ask.
 *
 * The store is RevenueCat's SDK, not our server, and the caller bounds the
 * ask further: one in flight at a time.
 */
export function shouldRefreshStoreOnForeground(
  record: Pick<
    AppPreferences,
    'mockSubscriptionPurchasedAt' | 'mockSubscriptionTerm' | 'mockSubscriptionCancelledAt' | 'mockSubscriptionEndsAt'
  >,
  now: Date = new Date(),
): boolean {
  if (record.mockSubscriptionPurchasedAt === null || record.mockSubscriptionTerm === 'lifetime') {
    return false;
  }
  if (record.mockSubscriptionCancelledAt !== null) {
    return true;
  }
  const endsAt = record.mockSubscriptionEndsAt;
  const endsTime = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  return Number.isFinite(endsTime) && endsTime <= now.getTime();
}
