const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  STORE_PRO_ENTITLEMENT,
  purchaseRecordFromStore,
  samePurchaseRecord,
} = require('../../.test-dist/lib/storePurchase.js');
const { resolveProEntitlement } = require('../../.test-dist/lib/proEntitlement.js');
const { normalizePurchaseRecord } = require('../../.test-dist/lib/purchaseRecord.js');
const { shouldRefreshStoreOnForeground } = require('../../.test-dist/lib/storeRefreshPolicy.js');

/**
 * Where Pro ends is the store's word (`expirationDate`), kept in
 * mockSubscriptionEndsAt. Before, the end was faked through the cancellation
 * stamp, so it was always purchase + one term: Pro locked too early inside a
 * grace period the store had extended, and a cancelled trial ran a whole term.
 */

const EMPTY = {
  mockSubscriptionPurchasedAt: null,
  mockSubscriptionTerm: 'yearly',
  mockSubscriptionCancelledAt: null,
  mockSubscriptionEndsAt: null,
};

const customer = (e) => ({ entitlements: { active: e ? { [STORE_PRO_ENTITLEMENT]: e } : {} } });
const entitlement = (overrides) => ({
  isActive: true,
  willRenew: true,
  latestPurchaseDate: '2026-10-01T10:00:00.000Z',
  expirationDate: '2026-11-01T10:00:00.000Z',
  productIdentifier: 'vinha_pro:monthly',
  unsubscribeDetectedAt: null,
  ...overrides,
});
const prefs = (record) => ({ promoProUntil: null, proTrialUntil: null, ...record });
const at = (iso) => new Date(iso);

module.exports = [
  {
    name: 'grace end: a failed renewal keeps Pro to the date the store extended it to, and not a day longer',
    run() {
      // Renewal due Nov 1 failed; the store gives a week of grace.
      const answer = customer(
        entitlement({ willRenew: false, expirationDate: '2026-11-08T10:00:00.000Z', unsubscribeDetectedAt: null }),
      );
      const record = purchaseRecordFromStore(answer, EMPTY, at('2026-11-02T09:00:00.000Z'));
      assert.equal(record.mockSubscriptionEndsAt, '2026-11-08T10:00:00.000Z');
      // Past Oct 1 + one month, where the old stamp trick locked.
      const inGrace = resolveProEntitlement(prefs(record), at('2026-11-05T00:00:00.000Z'));
      assert.equal(inGrace.unlocked, true);
      assert.equal(inGrace.purchaseEndsAt, '2026-11-08T10:00:00.000Z');
      assert.equal(resolveProEntitlement(prefs(record), at('2026-11-08T10:00:01.000Z')).unlocked, false);
    },
  },
  {
    name: 'grace end: a cancelled trial ends with the trial, not a whole term later',
    run() {
      const answer = customer(
        entitlement({
          productIdentifier: 'vinha_pro:yearly',
          willRenew: false,
          unsubscribeDetectedAt: '2026-10-03T08:00:00.000Z',
          expirationDate: '2026-10-08T10:00:00.000Z',
        }),
      );
      const record = purchaseRecordFromStore(answer, EMPTY, at('2026-10-04T00:00:00.000Z'));
      assert.equal(record.mockSubscriptionTerm, 'yearly');
      assert.equal(record.mockSubscriptionCancelledAt, '2026-10-03T08:00:00.000Z');
      assert.equal(resolveProEntitlement(prefs(record), at('2026-10-06T00:00:00.000Z')).unlocked, true);
      assert.equal(resolveProEntitlement(prefs(record), at('2026-10-09T00:00:00.000Z')).unlocked, false);
      // Without the stored end, the same stamp ran a year (the bug this fixes).
      const old = { ...record, mockSubscriptionEndsAt: null };
      assert.equal(resolveProEntitlement(prefs(old), at('2026-10-09T00:00:00.000Z')).unlocked, true);
    },
  },
  {
    name: 'grace end: an old install\'s stamp made at "now" cannot outlive the store\'s end',
    run() {
      // Older code stamped the first sync that saw the failed renewal: Nov 3.
      // Counted from the stamp, that read as Pro to Dec 1.
      const old = {
        mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: '2026-11-03T09:00:00.000Z',
        mockSubscriptionEndsAt: null,
      };
      assert.equal(resolveProEntitlement(prefs(old), at('2026-11-20T00:00:00.000Z')).unlocked, true, 'the old rule, until a sync');
      const answer = customer(entitlement({ willRenew: false, expirationDate: '2026-11-04T10:00:00.000Z' }));
      const next = purchaseRecordFromStore(answer, old, at('2026-11-03T12:00:00.000Z'));
      // The stamp is kept (a moment), the end now bounds it.
      assert.equal(next.mockSubscriptionCancelledAt, '2026-11-03T09:00:00.000Z');
      assert.equal(next.mockSubscriptionEndsAt, '2026-11-04T10:00:00.000Z');
      assert.equal(samePurchaseRecord(old, next), false, 'the end is new, so the sync writes it');
      assert.equal(resolveProEntitlement(prefs(next), at('2026-11-20T00:00:00.000Z')).unlocked, false);
      assert.equal(samePurchaseRecord(next, purchaseRecordFromStore(answer, next, at('2026-11-03T13:00:00.000Z'))), true);
    },
  },
  {
    name: 'grace end: a billing-retry payer who recovers (willRenew true) clears the stamp and has no end to name',
    run() {
      const failing = purchaseRecordFromStore(
        customer(entitlement({ willRenew: false, expirationDate: '2026-11-08T10:00:00.000Z' })),
        EMPTY,
        at('2026-11-02T00:00:00.000Z'),
      );
      assert.notEqual(failing.mockSubscriptionCancelledAt, null);
      const recovered = purchaseRecordFromStore(
        customer(
          entitlement({
            willRenew: true,
            latestPurchaseDate: '2026-11-06T10:00:00.000Z',
            expirationDate: '2026-12-06T10:00:00.000Z',
          }),
        ),
        failing,
        at('2026-11-06T11:00:00.000Z'),
      );
      assert.equal(recovered.mockSubscriptionCancelledAt, null);
      assert.equal(recovered.mockSubscriptionEndsAt, '2026-12-06T10:00:00.000Z');
      const pro = resolveProEntitlement(prefs(recovered), at('2026-11-20T00:00:00.000Z'));
      assert.equal(pro.unlocked, true);
      assert.equal(pro.purchaseEndsAt, null);
      // A renewing record whose stored end has passed (renewed while the app
      // was closed) is not locked on that stale date.
      assert.equal(resolveProEntitlement(prefs(recovered), at('2026-12-20T00:00:00.000Z')).unlocked, true);
    },
  },
  {
    name: 'grace end: a genuine mid-period cancel is a moment, and the payer keeps the period they paid for',
    run() {
      const answer = customer(
        entitlement({ willRenew: false, unsubscribeDetectedAt: '2026-10-05T08:00:00.000Z' }),
      );
      const record = purchaseRecordFromStore(answer, EMPTY, at('2026-10-06T00:00:00.000Z'));
      assert.equal(record.mockSubscriptionCancelledAt, '2026-10-05T08:00:00.000Z');
      assert.equal(record.mockSubscriptionEndsAt, '2026-11-01T10:00:00.000Z');
      const mid = resolveProEntitlement(prefs(record), at('2026-10-25T00:00:00.000Z'));
      assert.equal(mid.unlocked, true);
      assert.equal(mid.purchaseEndsAt, '2026-11-01T10:00:00.000Z');
      assert.equal(resolveProEntitlement(prefs(record), at('2026-11-01T10:00:00.000Z')).unlocked, false);
    },
  },
  {
    name: 'grace end: lifetime stores no end, and no Pro in the store clears it',
    run() {
      const lifetime = purchaseRecordFromStore(
        customer(entitlement({ productIdentifier: 'vinha_pro_lifetime', willRenew: false, expirationDate: '2099-01-01T00:00:00.000Z' })),
        EMPTY,
        at('2026-10-08T00:00:00.000Z'),
      );
      assert.equal(lifetime.mockSubscriptionEndsAt, null);
      const withEnd = { ...lifetime, mockSubscriptionTerm: 'monthly', mockSubscriptionEndsAt: '2026-11-01T10:00:00.000Z' };
      assert.equal(purchaseRecordFromStore(customer(null), withEnd, at('2026-10-08T00:00:00.000Z')).mockSubscriptionEndsAt, null);
    },
  },
  {
    name: 'grace end: the loader gives an install from before the field a null end, and drops one that is not a date',
    run() {
      const fallback = { mockSubscriptionPurchasedAt: null, mockSubscriptionCancelledAt: null, mockSubscriptionEndsAt: null };
      const old = normalizePurchaseRecord(
        { mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z', mockSubscriptionCancelledAt: '2026-10-20T00:00:00.000Z' },
        fallback,
      );
      assert.equal(old.mockSubscriptionEndsAt, null);
      assert.equal(old.mockSubscriptionCancelledAt, '2026-10-20T00:00:00.000Z');
      for (const bad of ['soon', 7, {}, '']) {
        assert.equal(
          normalizePurchaseRecord({ mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z', mockSubscriptionEndsAt: bad }, fallback)
            .mockSubscriptionEndsAt,
          null,
        );
      }
      const kept = normalizePurchaseRecord(
        { mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z', mockSubscriptionEndsAt: '2026-11-01T10:00:00.000Z' },
        fallback,
      );
      assert.equal(kept.mockSubscriptionEndsAt, '2026-11-01T10:00:00.000Z');
      // No purchase, no end.
      assert.equal(
        normalizePurchaseRecord({ mockSubscriptionEndsAt: '2026-11-01T10:00:00.000Z' }, fallback).mockSubscriptionEndsAt,
        null,
      );
    },
  },
  {
    name: 'foreground refresh: only a record whose answer could differ asks the store again',
    run() {
      const now = at('2026-11-10T00:00:00.000Z');
      const base = {
        mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: null,
        mockSubscriptionEndsAt: '2026-12-01T10:00:00.000Z',
      };
      assert.equal(shouldRefreshStoreOnForeground(base, now), false, 'renewing, inside its period');
      assert.equal(shouldRefreshStoreOnForeground({ ...base, mockSubscriptionCancelledAt: '2026-11-02T00:00:00.000Z' }, now), true, 'failing or cancelled');
      assert.equal(shouldRefreshStoreOnForeground({ ...base, mockSubscriptionEndsAt: '2026-11-09T00:00:00.000Z' }, now), true, 'past the stored end');
      assert.equal(shouldRefreshStoreOnForeground({ ...base, mockSubscriptionEndsAt: null }, now), false, 'no end to pass');
      assert.equal(shouldRefreshStoreOnForeground({ ...base, mockSubscriptionTerm: 'lifetime', mockSubscriptionCancelledAt: 'x' }, now), false);
      assert.equal(shouldRefreshStoreOnForeground({ ...base, mockSubscriptionPurchasedAt: null, mockSubscriptionCancelledAt: 'x' }, now), false);
    },
  },
  {
    name: 'foreground refresh wiring: once per return to the front, one read at a time, gated by the policy',
    run() {
      const src = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useStoreBillingSync.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(src, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active' && shouldRefreshStoreOnForeground\(preferencesRef\.current\)\) \{\s*read\(\);/);
      assert.match(src, /const read = \(\) => \{\s*if \(reading\) \{\s*return;\s*\}\s*reading = true;/);
      assert.match(src, /appStateSubscription\?\.remove\(\)/);
    },
  },
];
