const assert = require('node:assert/strict');

const {
  STORE_PRO_ENTITLEMENT,
  purchaseRecordFromStore,
  samePurchaseRecord,
} = require('../../.test-dist/lib/storePurchase.js');
const { resolveProEntitlement } = require('../../.test-dist/lib/proEntitlement.js');
const { resolveMembershipEndView } = require('../../.test-dist/lib/membershipEndView.js');
const { resolveSubscriptionView } = require('../../.test-dist/lib/subscriptionView.js');
const { normalizePurchaseRecord } = require('../../.test-dist/lib/purchaseRecord.js');

/**
 * A card the store could not charge leaves the entitlement active with
 * willRenew false and billingIssueDetectedAt set (RevenueCat), and no
 * unsubscribe date. That is not the reader cancelling: the end screen said
 * "Already cancelled" and the subscription row "Membership is cancelled".
 * Pro must still end exactly where the store says.
 */

const EMPTY = {
  mockSubscriptionPurchasedAt: null,
  mockSubscriptionTerm: 'monthly',
  mockSubscriptionCancelledAt: null,
  mockSubscriptionEndsAt: null,
  mockSubscriptionBillingIssue: false,
};

function snap(overrides) {
  return {
    entitlements: {
      active: {
        [STORE_PRO_ENTITLEMENT]: {
          isActive: true,
          willRenew: false,
          latestPurchaseDate: '2026-10-01T00:00:00Z',
          expirationDate: '2026-10-28T00:00:00Z',
          productIdentifier: 'vinha_pro',
          productPlanIdentifier: 'monthly',
          unsubscribeDetectedAt: null,
          billingIssueDetectedAt: null,
          ...overrides,
        },
      },
    },
  };
}

const NOW = new Date('2026-10-23T00:00:00Z');

module.exports = [
  {
    name: 'billing retry: a billing issue without an unsubscribe is flagged, and Pro still ends at the store end',
    run() {
      const rec = purchaseRecordFromStore(snap({ billingIssueDetectedAt: '2026-10-22T00:00:00Z' }), EMPTY, NOW);
      assert.equal(rec.mockSubscriptionBillingIssue, true);
      // the stamp (and so the entitlement) is unchanged by the flag
      assert.notEqual(rec.mockSubscriptionCancelledAt, null);
      assert.equal(rec.mockSubscriptionEndsAt, '2026-10-28T00:00:00Z');
      const ent = resolveProEntitlement({ ...rec, promoProUntil: null, proTrialUntil: null }, NOW);
      assert.equal(ent.unlocked, true);
      assert.equal(ent.purchaseEndsAt, '2026-10-28T00:00:00Z');
    },
  },
  {
    name: 'billing retry: a real cancellation (or a healthy renewal) is not flagged',
    run() {
      const cancelled = purchaseRecordFromStore(
        snap({ unsubscribeDetectedAt: '2026-10-05T00:00:00Z', billingIssueDetectedAt: '2026-10-22T00:00:00Z' }),
        EMPTY,
        NOW,
      );
      assert.equal(cancelled.mockSubscriptionBillingIssue, false);
      assert.notEqual(cancelled.mockSubscriptionCancelledAt, null);
      const plainCancel = purchaseRecordFromStore(snap({}), EMPTY, NOW);
      assert.equal(plainCancel.mockSubscriptionBillingIssue, false);
      const renewing = purchaseRecordFromStore(snap({ willRenew: true }), EMPTY, NOW);
      assert.equal(renewing.mockSubscriptionBillingIssue, false);
      assert.equal(renewing.mockSubscriptionCancelledAt, null);
      assert.equal(purchaseRecordFromStore({ entitlements: { active: {} } }, EMPTY, NOW).mockSubscriptionBillingIssue, false);
    },
  },
  {
    name: 'billing retry: the flag is part of the record comparison, so the sync writes it',
    run() {
      const a = purchaseRecordFromStore(snap({ billingIssueDetectedAt: '2026-10-22T00:00:00Z' }), EMPTY, NOW);
      assert.equal(samePurchaseRecord(a, { ...a, mockSubscriptionBillingIssue: false }), false);
      assert.equal(samePurchaseRecord(a, { ...a }), true);
    },
  },
  {
    name: 'billing retry: the end screen does not say "already cancelled" for a failed payment',
    run() {
      const retry = resolveMembershipEndView({ canEndNow: true, cancelled: true, billingIssue: true });
      assert.equal(retry.alreadyCancelled, false);
      assert.equal(retry.billingIssue, true);
      assert.equal(retry.mode, 'back');
      const real = resolveMembershipEndView({ canEndNow: true, cancelled: true });
      assert.equal(real.alreadyCancelled, true);
      assert.equal(real.billingIssue, false);
      // a stale flag on a non-purchase says nothing
      assert.equal(resolveMembershipEndView({ canEndNow: false, cancelled: false, billingIssue: true }).billingIssue, false);
    },
  },
  {
    name: 'billing retry: the subscription view marks a cancelled-by-failure record, keeping its end date',
    run() {
      const entitlement = { unlocked: true, source: 'purchase', promoUntil: null, purchaseEndsAt: '2026-10-28T00:00:00Z' };
      const view = resolveSubscriptionView({ entitlement, mockTerm: 'monthly', mockCancelled: true, mockBillingIssue: true, purchasedAt: '2026-10-01T00:00:00Z', now: NOW });
      assert.equal(view.cancelled, true);
      assert.equal(view.billingIssue, true);
      assert.equal(view.endsAt, '2026-10-28T00:00:00Z');
      const plain = resolveSubscriptionView({ entitlement, mockTerm: 'monthly', mockCancelled: true, purchasedAt: '2026-10-01T00:00:00Z', now: NOW });
      assert.equal(plain.billingIssue, false);
      const renewing = resolveSubscriptionView({ entitlement, mockTerm: 'monthly', mockCancelled: false, mockBillingIssue: true, purchasedAt: '2026-10-01T00:00:00Z', now: NOW });
      assert.equal(renewing.billingIssue, false);
    },
  },
  {
    name: 'billing retry: loading an old install (no field) or garbage gives false; a real flag survives',
    run() {
      const fb = { mockSubscriptionPurchasedAt: null, mockSubscriptionCancelledAt: null, mockSubscriptionEndsAt: null, mockSubscriptionBillingIssue: false };
      const base = { mockSubscriptionPurchasedAt: '2026-10-01T00:00:00Z', mockSubscriptionCancelledAt: '2026-10-22T00:00:00Z' };
      assert.equal(normalizePurchaseRecord(base, fb).mockSubscriptionBillingIssue, false);
      assert.equal(normalizePurchaseRecord({ ...base, mockSubscriptionBillingIssue: 'yes' }, fb).mockSubscriptionBillingIssue, false);
      assert.equal(normalizePurchaseRecord({ ...base, mockSubscriptionBillingIssue: true }, fb).mockSubscriptionBillingIssue, true);
      // no purchase or no cancellation stamp: nothing to flag
      assert.equal(normalizePurchaseRecord({ mockSubscriptionBillingIssue: true }, fb).mockSubscriptionBillingIssue, false);
      assert.equal(
        normalizePurchaseRecord({ mockSubscriptionPurchasedAt: base.mockSubscriptionPurchasedAt, mockSubscriptionBillingIssue: true }, fb).mockSubscriptionBillingIssue,
        false,
      );
    },
  },
];
