const assert = require('node:assert/strict');

const { STORE_PRO_ENTITLEMENT, purchaseRecordFromStore } = require('../../src/lib/storePurchase');
const { resolveProEntitlement } = require('../../src/lib/proEntitlement');
const { resolveSubscriptionView } = require('../../src/lib/subscriptionView');
const { renewingPeriodEndAt } = require('../../src/lib/subscriptionTerm');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * A renewing subscription's next charge is the store's end of the period, not
 * the latest renewal plus a term. RevenueCat hands back `latestPurchaseDate`
 * (the last renewal) as the purchase date, so a monthly bought on 31 January
 * and renewed on 28 February read "next charge 28 March" while Play charges on
 * the 31st (bug hunt, 2026-10-29).
 */

const NOW = new Date('2026-03-10T12:00:00Z');

function renewedOnTheTwentyEighth() {
  return purchaseRecordFromStore(
    {
      entitlements: {
        active: {
          [STORE_PRO_ENTITLEMENT]: {
            isActive: true,
            willRenew: true,
            latestPurchaseDate: '2026-02-28T09:00:00Z',
            expirationDate: '2026-03-31T09:00:00Z',
            productIdentifier: 'vinha_pro',
            productPlanIdentifier: 'monthly',
            unsubscribeDetectedAt: null,
          },
        },
      },
    },
    {
      mockSubscriptionPurchasedAt: null,
      mockSubscriptionTerm: 'yearly',
      mockSubscriptionCancelledAt: null,
      mockSubscriptionEndsAt: null,
      mockSubscriptionBillingIssue: false,
    },
    NOW,
  );
}

module.exports = [
  {
    name: 'renewing period end: the subscription page names the store end as the next charge',
    run() {
      const record = renewedOnTheTwentyEighth();
      const entitlement = resolveProEntitlement(record, NOW);
      const view = resolveSubscriptionView({
        entitlement,
        mockTerm: record.mockSubscriptionTerm,
        mockCancelled: record.mockSubscriptionCancelledAt !== null,
        purchasedAt: record.mockSubscriptionPurchasedAt,
        storedEndsAt: record.mockSubscriptionEndsAt,
        now: NOW,
      });
      assert.equal(view.nextChargeAt, '2026-03-31T09:00:00Z');
      assert.equal(view.endsAt, '2026-03-31T09:00:00Z');
    },
  },
  {
    name: 'renewing period end: a stored end already passed falls back to the counted period',
    run() {
      // A renewal that landed while the app was closed: the stored end is the
      // old period's, so the count from the purchase date stands in.
      const after = new Date('2026-04-02T12:00:00Z');
      assert.equal(
        renewingPeriodEndAt('monthly', '2026-02-28T09:00:00Z', '2026-03-31T09:00:00Z', after),
        '2026-04-28T09:00:00.000Z',
      );
      assert.equal(renewingPeriodEndAt('monthly', '2026-02-28T09:00:00Z', null, NOW), '2026-03-28T09:00:00.000Z');
      assert.equal(renewingPeriodEndAt('monthly', '2026-02-28T09:00:00Z', 'not a date', NOW), '2026-03-28T09:00:00.000Z');
      assert.equal(renewingPeriodEndAt('lifetime', '2026-02-28T09:00:00Z', '2026-03-31T09:00:00Z', NOW), null);
    },
  },
  {
    name: 'renewing period end: both screens are handed the stored end',
    run() {
      const source = readAppWiring();
      assert.match(source, /storedEndsAt=\{preferences\.mockSubscriptionEndsAt\}/);
      assert.match(
        source,
        /periodEndsAt=\{\s*proEntitlement\.purchaseEndsAt \?\?\s*renewingPeriodEndAt\([\s\S]*?preferences\.mockSubscriptionEndsAt,?\s*\)/,
      );
    },
  },
];
