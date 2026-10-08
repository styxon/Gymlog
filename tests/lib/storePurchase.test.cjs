const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  STORE_PRO_ENTITLEMENT,
  purchaseRecordFromStore,
  samePurchaseRecord,
  storePackageForPlan,
  termForStoreProduct,
} = require('../../.test-dist/lib/storePurchase.js');
const { resolveProEntitlement } = require('../../.test-dist/lib/proEntitlement.js');

/**
 * The store writes the purchase record in a release build (2026-10-08, demo
 * flag cleared, RevenueCat chosen). These pin what its answers mean, and that
 * the wiring around it keeps the rules every other Pro path keeps: nothing on
 * the first frame, a success only after the write, and no "ended" splash over
 * a subscription that is still renewing.
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) =>
  fs
    .readFileSync(path.join(root, ...parts), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const EMPTY = {
  mockSubscriptionPurchasedAt: null,
  mockSubscriptionTerm: 'yearly',
  mockSubscriptionCancelledAt: null,
};

function customer(entitlement) {
  return { entitlements: { active: entitlement ? { [STORE_PRO_ENTITLEMENT]: entitlement } : {} } };
}

function entitlement(overrides) {
  return {
    isActive: true,
    willRenew: true,
    latestPurchaseDate: '2026-10-01T10:00:00.000Z',
    expirationDate: '2026-11-01T10:00:00.000Z',
    productIdentifier: 'vinha_pro:monthly',
    unsubscribeDetectedAt: null,
    ...overrides,
  };
}

function prefs(record) {
  return { promoProUntil: null, proTrialUntil: null, ...record };
}

module.exports = [
  {
    name: 'store purchase: product ids name their term, and each plan has its package',
    run() {
      assert.equal(termForStoreProduct('vinha_pro:monthly'), 'monthly');
      assert.equal(termForStoreProduct('vinha_pro:yearly'), 'yearly');
      assert.equal(termForStoreProduct('vinha_pro_annual'), 'yearly');
      assert.equal(termForStoreProduct('vinha_pro_lifetime'), 'lifetime');
      assert.equal(termForStoreProduct('vinha_pro'), null);
      assert.equal(storePackageForPlan('monthly'), 'monthly');
      assert.equal(storePackageForPlan('yearly'), 'annual');
      assert.equal(storePackageForPlan('lifetime'), 'lifetime');
    },
  },
  {
    name: 'store purchase: a renewing subscription is Pro with no end, from the store period start',
    run() {
      const now = new Date('2026-10-08T12:00:00.000Z');
      const record = purchaseRecordFromStore(customer(entitlement({})), EMPTY, now);
      assert.deepEqual(record, {
        mockSubscriptionPurchasedAt: '2026-10-01T10:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: null,
      });
      const pro = resolveProEntitlement(prefs(record), now);
      assert.equal(pro.unlocked, true);
      assert.equal(pro.source, 'purchase');
      assert.equal(pro.purchaseEndsAt, null);
    },
  },
  {
    name: 'store purchase: a subscription cancelled in Play runs to its period end, then stops',
    run() {
      const now = new Date('2026-10-08T12:00:00.000Z');
      const record = purchaseRecordFromStore(
        customer(entitlement({ willRenew: false, unsubscribeDetectedAt: '2026-10-05T08:00:00.000Z' })),
        EMPTY,
        now,
      );
      assert.equal(record.mockSubscriptionCancelledAt, '2026-10-05T08:00:00.000Z');
      const pro = resolveProEntitlement(prefs(record), now);
      assert.equal(pro.unlocked, true);
      // The end the entitlement names is the store's own period end.
      assert.equal(new Date(pro.purchaseEndsAt).getUTCDate(), 1);
      assert.equal(new Date(pro.purchaseEndsAt).getUTCMonth(), 10);
      assert.equal(resolveProEntitlement(prefs(record), new Date('2026-11-02T00:00:00.000Z')).unlocked, false);
    },
  },
  {
    name: 'store purchase: a cancellation with no date is stamped once, and a later sync of the same answer writes nothing',
    run() {
      const answer = customer(entitlement({ willRenew: false }));
      const first = purchaseRecordFromStore(answer, EMPTY, new Date('2026-10-06T00:00:00.000Z'));
      assert.equal(first.mockSubscriptionCancelledAt, '2026-10-06T00:00:00.000Z');
      const again = purchaseRecordFromStore(answer, first, new Date('2026-10-07T00:00:00.000Z'));
      assert.equal(again.mockSubscriptionCancelledAt, '2026-10-06T00:00:00.000Z');
      assert.equal(samePurchaseRecord(first, again), true);
      // A new period is a new purchase, and an old stamp does not carry over.
      const renewed = purchaseRecordFromStore(
        customer(entitlement({ willRenew: false, latestPurchaseDate: '2026-11-01T10:00:00.000Z' })),
        first,
        new Date('2026-11-03T00:00:00.000Z'),
      );
      assert.equal(renewed.mockSubscriptionCancelledAt, '2026-11-03T00:00:00.000Z');
    },
  },
  {
    name: 'store purchase: no Pro in the store clears the record — the demo build\'s invented purchase included',
    run() {
      const invented = {
        mockSubscriptionPurchasedAt: '2026-08-15T00:00:00.000Z',
        mockSubscriptionTerm: 'lifetime',
        mockSubscriptionCancelledAt: null,
      };
      const now = new Date('2026-10-08T12:00:00.000Z');
      assert.equal(resolveProEntitlement(prefs(invented), now).unlocked, true);
      for (const answer of [customer(null), customer(entitlement({ isActive: false }))]) {
        const record = purchaseRecordFromStore(answer, invented, now);
        assert.equal(record.mockSubscriptionPurchasedAt, null);
        assert.equal(record.mockSubscriptionCancelledAt, null);
        assert.equal(resolveProEntitlement(prefs(record), now).unlocked, false);
      }
    },
  },
  {
    name: 'store purchase: lifetime is never read as cancelled, and an id with no term keeps the one on record',
    run() {
      const now = new Date('2026-10-08T12:00:00.000Z');
      const lifetime = purchaseRecordFromStore(
        customer(entitlement({ productIdentifier: 'vinha_pro_lifetime', willRenew: false, expirationDate: null })),
        EMPTY,
        now,
      );
      assert.equal(lifetime.mockSubscriptionTerm, 'lifetime');
      assert.equal(lifetime.mockSubscriptionCancelledAt, null);
      assert.equal(resolveProEntitlement(prefs(lifetime), new Date('2030-01-01T00:00:00.000Z')).unlocked, true);

      const unnamed = purchaseRecordFromStore(customer(entitlement({ productIdentifier: 'pro' })), EMPTY, now);
      assert.equal(unnamed.mockSubscriptionTerm, 'yearly');
      assert.equal(unnamed.mockSubscriptionPurchasedAt, '2026-10-01T10:00:00.000Z');
    },
  },
  {
    name: 'store billing wiring: the SDK loads on first use, the sync skips the demo and the first frame',
    run() {
      const service = read('src', 'features', 'billing', 'storeBilling.ts');
      // Types only at the top: a value import would evaluate the SDK and its
      // native bridge before the first frame.
      assert.doesNotMatch(service, /^import (?!type )[^\n]*'react-native-purchases'/m);
      assert.match(service, /^import type \{[^}]*\} from 'react-native-purchases';/m);
      assert.match(service, /require\('react-native-purchases'\)/);
      assert.match(service, /EXPO_PUBLIC_REVENUECAT_ANDROID_KEY/);

      const sync = read('src', 'app', 'useStoreBillingSync.ts');
      assert.match(sync, /if \(!hydrated \|\| isDemoBuild\(\)\) \{\s*return;\s*\}/);
      const timer = sync.indexOf('setTimeout(');
      assert.ok(timer > -1, 'the store is asked on its own turn');
      assert.ok(sync.indexOf('onStoreCustomerChange(apply)') > timer, 'subscribing loads the SDK, so it waits too');
      assert.ok(sync.indexOf('readStoreCustomer()') > timer);
      // A sync that agrees writes nothing: every write is the whole database.
      assert.match(sync, /if \(samePurchaseRecord\(preferencesRef\.current, next\)\) \{\s*return;\s*\}/);
      assert.match(read('App.tsx'), /useStoreBillingSync\(\{ hydrated, preferences, updatePreferences \}\);/);
    },
  },
  {
    name: 'store billing wiring: ending, resuming and restoring a store subscription go through the store',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      // End membership opens the store instead of the "ended" splash, for a
      // store purchase in a release build only.
      assert.match(profile, /onEndInStore=\{\s*!isDemoBuild\(\) && proEntitlement\.source === 'purchase'/);
      const end = read('src', 'screens', 'MembershipEndScreen.tsx');
      assert.match(end, /onPress=\{onEndInStore \?\? \(\(\) => setStep\('splash'\)\)\}/);

      // Resume and plan change cannot be made by the app in a store build.
      const cancelled = profile.slice(profile.indexOf('onChangeMockCancelled={(cancelled) => {'));
      assert.match(cancelled, /^onChangeMockCancelled=\{\(cancelled\) => \{\s*if \(releaseBuild\) \{\s*openStoreSubscriptions\(\);\s*return;\s*\}/);
      const term = profile.slice(profile.indexOf('onChangeMockTerm={(term) => {'));
      assert.match(term, /^onChangeMockTerm=\{\(term\) => \{\s*if \(releaseBuild\) \{\s*openStoreSubscriptions\(\);\s*return;\s*\}/);

      // Restore: the toast follows the saved answer.
      const restoreAt = profile.indexOf('onRestorePurchases={');
      assert.ok(restoreAt > -1, 'the restore handler moved');
      const restore = profile.slice(restoreAt, profile.indexOf('onBack=', restoreAt));
      const saved = restore.indexOf('await updatePreferences(record);');
      const said = restore.indexOf("'subs.restore.done'");
      assert.ok(saved > -1 && said > saved, 'the restore is announced before it is stored');
      assert.match(read('src', 'screens', 'SubscriptionScreen.tsx'), /onRestorePurchases \?\? \(\(\) => void Linking\.openURL\(manageSubscriptionsUrl\(STORE\)\)\)/);

      const i18n = read('src', 'lib', 'i18n.ts');
      for (const key of ['premium.purchasePending', 'premium.purchaseFailed', 'subs.restore.done', 'subs.restore.none', 'subs.restore.failed']) {
        assert.equal(i18n.split(`'${key}':`).length - 1, 2, `${key} in both languages`);
      }
    },
  },
];
