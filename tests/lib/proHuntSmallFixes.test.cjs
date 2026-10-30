const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_TIMER_DELAY_MS,
  entitlementRecheckDelayMs,
  proEntitlementEndsAtMs,
  resolveProEntitlement,
} = require('../../src/lib/proEntitlement');
const { membershipEndCancelled } = require('../../src/lib/membershipEndView');
const { normalizePurchaseRecord } = require('../../src/lib/purchaseRecord');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const base = {
  promoProUntil: null,
  proTrialUntil: null,
  mockSubscriptionPurchasedAt: null,
  mockSubscriptionTerm: 'monthly',
  mockSubscriptionCancelledAt: null,
  mockSubscriptionEndsAt: null,
  reviewProAccount: false,
};

/** Pro membership bug hunt, 2026-10-29: the small fixes. */
module.exports = [
  {
    name: 'pro clock: a trial, promo or cancelled purchase names when it ends; renewing and review do not',
    run() {
      const trial = resolveProEntitlement({ ...base, proTrialUntil: '2026-11-05T12:00:00.000Z' }, NOW);
      assert.equal(proEntitlementEndsAtMs(trial), Date.parse('2026-11-05T12:00:00.000Z'));

      const cancelled = resolveProEntitlement(
        {
          ...base,
          mockSubscriptionPurchasedAt: '2026-10-10T12:00:00.000Z',
          mockSubscriptionCancelledAt: '2026-10-20T12:00:00.000Z',
          mockSubscriptionEndsAt: '2026-11-10T12:00:00.000Z',
        },
        NOW,
      );
      assert.equal(proEntitlementEndsAtMs(cancelled), Date.parse('2026-11-10T12:00:00.000Z'));

      const renewing = resolveProEntitlement({ ...base, mockSubscriptionPurchasedAt: '2026-10-10T12:00:00.000Z' }, NOW);
      assert.equal(renewing.unlocked, true);
      assert.equal(proEntitlementEndsAtMs(renewing), null);
      assert.equal(proEntitlementEndsAtMs(resolveProEntitlement({ ...base, reviewProAccount: true }, NOW)), null);
      assert.equal(proEntitlementEndsAtMs(resolveProEntitlement(base, NOW)), null);
    },
  },
  {
    name: 'pro clock: the recheck lands a second past the end, never under a second, never past the timer ceiling',
    run() {
      const now = NOW.getTime();
      assert.equal(entitlementRecheckDelayMs(null, now), null);
      assert.equal(entitlementRecheckDelayMs(now + 60_000, now), 61_000);
      assert.equal(entitlementRecheckDelayMs(now - 60_000, now), 1000, 'an end already past re-reads at once');
      // A year-long trial must not overflow setTimeout into an immediate fire.
      assert.equal(entitlementRecheckDelayMs(now + 365 * 86_400_000, now), MAX_TIMER_DELAY_MS);
      assert.equal(MAX_TIMER_DELAY_MS, 2 ** 31 - 1);
    },
  },
  {
    name: 'pro clock wiring: App reads Pro through the hook, the cap line takes it, the build re-checks at the tap',
    run() {
      const app = read('App.tsx');
      assert.match(app, /const \{ proEntitlement \} = useProEntitlement\(preferences\);/);
      assert.doesNotMatch(app, /resolveProEntitlement\(preferences\)/);
      assert.match(app, /useProgramCapLine\(\{\s*preferences,\s*proUnlocked: proEntitlement\.unlocked,\s*\}\)/);

      const hook = read('src', 'app', 'useProEntitlement.ts');
      assert.match(hook, /entitlementRecheckDelayMs\(proEntitlementEndsAtMs\(proEntitlement\), Date\.now\(\)\)/);
      assert.match(hook, /AppState\.addEventListener\('change'/);
      assert.match(hook, /clearTimeout\(timer\)/);

      const cap = read('src', 'app', 'useProgramCapLine.ts');
      assert.doesNotMatch(cap, /resolveProEntitlement/);
      assert.match(cap, /\}, \[preferences, proUnlocked\]\);/);

      const home = read('src', 'app', 'renderHomeScreens.tsx');
      assert.match(home, /if \(!resolveProEntitlement\(preferences\)\.unlocked\) \{\s*return \{ refused: 'not_pro' \};\s*\}\s*if \(!coachQuotaLedger\.reserve\(/);
    },
  },
  {
    name: 'membership end: a lifetime purchase with a stamp is not "already cancelled"',
    run() {
      const stamp = '2026-09-01T00:00:00.000Z';
      assert.equal(membershipEndCancelled('purchase', stamp, 'lifetime'), false);
      assert.equal(membershipEndCancelled('purchase', stamp, 'monthly'), true);
      assert.equal(membershipEndCancelled('purchase', stamp), true);
      // The entitlement agrees: lifetime ignores the stamp.
      const lifetime = resolveProEntitlement(
        { ...base, mockSubscriptionTerm: 'lifetime', mockSubscriptionPurchasedAt: '2026-09-01T00:00:00.000Z', mockSubscriptionCancelledAt: stamp },
        NOW,
      );
      assert.deepEqual([lifetime.unlocked, lifetime.purchaseEndsAt], [true, null]);
    },
  },
  {
    name: 'loader: an unparseable cancellation stamp is a cancellation at the purchase instant, and the entitlement agrees with the page',
    run() {
      const fallback = {
        mockSubscriptionPurchasedAt: null,
        mockSubscriptionCancelledAt: null,
        mockSubscriptionEndsAt: null,
        mockSubscriptionBillingIssue: false,
      };
      const record = normalizePurchaseRecord(
        { mockSubscriptionPurchasedAt: '2026-10-10T12:00:00.000Z', mockSubscriptionCancelledAt: 'not a date' },
        fallback,
        NOW,
      );
      // Stable across loads: the same answer a week later, not a moving "now".
      assert.equal(record.mockSubscriptionCancelledAt, '2026-10-10T12:00:00.000Z');
      const later = normalizePurchaseRecord(
        { mockSubscriptionPurchasedAt: '2026-10-10T12:00:00.000Z', mockSubscriptionCancelledAt: 'not a date' },
        fallback,
        new Date('2026-11-05T12:00:00.000Z'),
      );
      assert.equal(later.mockSubscriptionCancelledAt, record.mockSubscriptionCancelledAt);
      const entitlement = resolveProEntitlement({ ...base, ...record }, NOW);
      // Cancelled, so it names an end - not "renewing" beside a page that says cancelled.
      assert.equal(entitlement.unlocked, true);
      assert.notEqual(entitlement.purchaseEndsAt, null);
      assert.equal(membershipEndCancelled(entitlement.source, record.mockSubscriptionCancelledAt, 'monthly'), true);

      const valid = normalizePurchaseRecord(
        { mockSubscriptionPurchasedAt: '2026-10-10T12:00:00.000Z', mockSubscriptionCancelledAt: '2026-10-20T12:00:00.000Z' },
        fallback,
        NOW,
      );
      assert.equal(valid.mockSubscriptionCancelledAt, '2026-10-20T12:00:00.000Z');
    },
  },
  {
    name: 'subscription page: every store link swallows a failed open',
    run() {
      const screen = read('src', 'screens', 'SubscriptionScreen.tsx');
      const opens = screen.match(/Linking\.openURL\([^\n]*/g) ?? [];
      assert.ok(opens.length >= 4);
      for (const line of opens) {
        assert.match(line, /\)\.catch\(\(\) => undefined\)/, line);
      }
    },
  },
];
