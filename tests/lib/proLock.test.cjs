const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').split('\r\n').join('\n');

/** Every .ts/.tsx under src, plus App.tsx — the whole app surface. */
function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push({ rel: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({ rel: 'App.tsx', text: fs.readFileSync(path.join(root, 'App.tsx'), 'utf8') });
  return files;
}

/**
 * The free/Pro lock, swept at the source level (user 2026-09-03: "katso
 * samalla että mistään ei pysty kiertämään free/pro lukkoa").
 *
 * The unit tests in proEntitlement prove the RULE. These prove that no screen
 * has quietly grown its own — which is how the lock came loose in the first
 * place: the Pro page's CTA wrote a boolean that meant "Pro is on", and then
 * a button under it wrote the same boolean back to false.
 */
module.exports = [
  {
    name: 'proLock: the entitlement grants from exactly three things, and names them',
    run() {
      const entitlement = read('src', 'lib', 'proEntitlement.ts');
      // The fields it is allowed to read at all. `proTrialUntil` joined them
      // on 2026-09-09, when the 14-day trial was switched on and actually
      // granted — before that `resolveTrialProUntil` was imported into App.tsx
      // and called from nowhere, so the flag could be flipped and nobody got a
      // day of anything.
      for (const field of [
        "'promoProUntil'",
        "'proTrialUntil'",
        "'mockSubscriptionPurchasedAt'",
        "'mockSubscriptionTerm'",
        "'mockSubscriptionCancelledAt'",
      ]) {
        assert.match(entitlement, new RegExp(`\| ${field}`), `${field} is not in the pick`);
      }
      // Three sources, no fourth. The trial is its own source rather than a
      // promo wearing a different label: only one of them may trigger "your
      // trial ends soon".
      assert.match(entitlement, /source: 'promo' \| 'trial' \| 'purchase' \| null;/);
      assert.match(entitlement, /source: 'promo'/);
      assert.match(entitlement, /source: 'trial'/);
      assert.match(entitlement, /source: 'purchase' as const/);
    },
  },
  {
    name: 'proLock: the demo build\'s free Pro switch is gone from every file',
    run() {
      // A boolean preference that meant "Pro is on" and could be written from
      // a screen. Nothing may bring it back under any name.
      // Two files may NAME the key, only to recognise a store from before the
      // switch was removed and drop what it wrote. Neither may write it.
      const mayDetect = new Set(['src/storage/database.ts', 'src/lib/purchaseRecord.ts']);
      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        if (!/adaptiveCoachPremiumUnlocked/.test(text)) {
          continue;
        }
        if (!mayDetect.has(rel)) {
          offenders.push(`${rel} names the switch`);
          continue;
        }
        // Detection reads it; a write would be `key: value` or `.key =`.
        if (/adaptiveCoachPremiumUnlocked\s*:\s*(true|false|[a-zA-Z])/.test(text) || /\.adaptiveCoachPremiumUnlocked\s*=[^=]/.test(text)) {
          offenders.push(`${rel} writes the switch`);
        }
      }
      assert.deepEqual(offenders, [], 'the preview switch is back');
      // And its copy went with it.
      assert.equal(read('src', 'lib', 'i18n.ts').includes("'pro.previewOff'"), false);
    },
  },
  {
    name: 'proLock: nothing decides Pro from a preference of its own',
    run() {
      /**
       * The grant fields may be DISPLAYED — the subscription screen shows the
       * term and a lapsed promo's date. What no file outside the
       * entitlement may do is turn one into a yes/no about a feature.
       */
      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        if (rel === 'src/lib/proEntitlement.ts') {
          continue;
        }
        for (const [index, line] of text.split('\n').entries()) {
          const at = `${rel}:${index + 1}`;
          // "promoProUntil is in the future" is the entitlement's own job.
          if (/promoProUntil[^\n]*(>|<)[^\n]*(Date\.now|getTime)/.test(line)) {
            offenders.push(`${at} decides Pro from the promo date`);
          }
          // A tier string compared to 'pro' is a second entitlement.
          if (/selectedAccessTier\s*===\s*'pro'/.test(line)) {
            offenders.push(`${at} decides Pro from selectedAccessTier`);
          }
          // The purchase fields must not gate a feature outside the entitlement.
          if (/mockSubscription(PurchasedAt|CancelledAt)[^\n]*\?\s*true/.test(line)) {
            offenders.push(`${at} decides Pro from the purchase record`);
          }
        }
      }
      assert.deepEqual(offenders, [], `these bypass resolveProEntitlement:\n  ${offenders.join('\n  ')}`);
    },
  },
  {
    name: 'proLock: every proUnlocked handed to a screen comes from the entitlement',
    run() {
      const allowed = new Set([
        'coachProUnlocked',
        'proUnlocked',
        'proEntitlement.unlocked',
        'resolveProEntitlement(preferences).unlocked',
      ]);
      const offenders = [];
      for (const { rel, text } of sourceFiles()) {
        for (const [index, line] of text.split('\n').entries()) {
          const jsx = line.match(/proUnlocked=\{([^}]+)\}/);
          const prop = line.match(/^\s*proUnlocked:\s*([^,]+),/);
          const value = (jsx?.[1] ?? prop?.[1] ?? '').trim();
          if (!value || value === 'boolean' || allowed.has(value)) {
            continue;
          }
          offenders.push(`${rel}:${index + 1} -> ${value}`);
        }
      }
      assert.deepEqual(offenders, [], `a Pro flag from somewhere else:\n  ${offenders.join('\n  ')}`);
    },
  },
  {
    name: 'proLock: only the purchase and the trial write a grant, and nothing writes a promo',
    run() {
      // Writers, not readers: an updatePreferences that sets one of the grant
      // fields. One screen module may, and the sweep names any second.
      const allowedWriters = new Set(['src/app/renderProfileTab.tsx', 'src/data/seed.ts', 'src/state/AppProvider.tsx', 'src/storage/database.ts']);
      // The promo grant has no writer at all since the codes left the bundle
      // (2026-09-15) — not even the allowed module, and whatever the value is
      // spelled as. Only the declaration and the loader, which carries a grant
      // made before that through, may put anything but null after the key.
      const promoMayCarry = new Set(['src/types/models.ts', 'src/storage/database.ts']);
      const offenders = [];
      const promoWriters = [];
      for (const { rel, text } of sourceFiles()) {
        if (rel === 'src/lib/proEntitlement.ts') {
          continue;
        }
        for (const [index, line] of text.split('\n').entries()) {
          if (
            !promoMayCarry.has(rel) &&
            (/promoProUntil\s*:(?!\s*null\b)/.test(line) || /\.promoProUntil\s*=[^=]/.test(line) || /[{,]\s*promoProUntil\s*[,}]/.test(line))
          ) {
            promoWriters.push(`${rel}:${index + 1}`);
          }
          if (/(mockSubscriptionPurchasedAt|mockSubscriptionCancelledAt|mockSubscriptionTerm)\s*:/.test(line) && /updatePreferences|onPreferencesChange/.test(text)) {
            // Only flag an actual assignment inside a preferences write.
            if (/:\s*(new Date|'|"|`|null|true|false|proUntil|plan)/.test(line) && !allowedWriters.has(rel)) {
              offenders.push(`${rel}:${index + 1}`);
            }
          }
        }
      }
      assert.deepEqual(offenders, [], `a grant written outside the purchase and the trial:\n  ${offenders.join('\n  ')}`);
      assert.deepEqual(promoWriters, [], `a promo grant is written somewhere:\n  ${promoWriters.join('\n  ')}`);

      // The door itself is gone: no screen, no code list, no route. The row,
      // the wiring and the copy are pinned in proSurfaces.
      assert.equal(fs.existsSync(path.join(root, 'src', 'screens', 'PromoCodeScreen.tsx')), false);
      assert.equal(fs.existsSync(path.join(root, 'src', 'lib', 'promoCodes.ts')), false);
      assert.doesNotMatch(read('src', 'navigation', 'routes.ts'), /screen: 'promo'/);
    },
  },
  {
    name: 'proLock: the demo switch is tied to the one flag the release step clears',
    run() {
      // DEMO_BUILD is declared in src and again in app.json. Pinning them to
      // each other is what makes clearing extra.demoBuild a real release step
      // instead of a note someone has to remember: the moment they disagree,
      // this fails and names the other half.
      const { DEMO_BUILD } = require('../../.test-dist/lib/demoMode');
      const appJson = JSON.parse(read('app.json'));
      assert.equal(
        DEMO_BUILD,
        appJson.expo.extra.demoBuild === true,
        'src/lib/demoMode DEMO_BUILD and app.json extra.demoBuild disagree',
      );

      // The Settings demo section was removed by user decision (2026-08-22).
      assert.ok(!/isDemoBuild/.test(read('src', 'screens', 'SettingsScreen.tsx')), 'the Settings demo section must stay removed');

      // And the last preview-Pro switch went with it (user 2026-09-03). The
      // Pro page sold a subscription and offered a button underneath to hand
      // it back for free, which made Pro a light switch rather than a
      // purchase. The page sells; the subscription screen cancels.
      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      assert.doesNotMatch(premium, /previewOff|previewUnlocked|onTogglePreview/);
      // One callback, one direction. It may hand back the write it waits on
      // (2026-09-21: the unlock screen follows the write), which is still
      // not a way to switch Pro back off.
      assert.match(premium, /onPurchase: \(plan: PlanId\) => void \| Promise<void>;/);
    },
  },
  {
    name: 'proLock: a lapsed subscription cannot be resumed, and a plan change is a new purchase',
    run() {
      const { canResumePurchase } = require('../../.test-dist/lib/proEntitlement.js');
      const NOW = new Date('2026-09-03T12:00:00.000Z');
      const prefs = (overrides) => ({
        promoProUntil: null,
        mockSubscriptionPurchasedAt: null,
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: null,
        ...overrides,
      });

      // Cancelled two days ago on a monthly bought two days before that: the
      // period is still running, so resuming is a real thing to offer.
      assert.equal(
        canResumePurchase(
          prefs({
            mockSubscriptionPurchasedAt: '2026-09-01T00:00:00.000Z',
            mockSubscriptionCancelledAt: '2026-09-02T00:00:00.000Z',
          }),
          NOW,
        ),
        true,
      );

      // Cancelled in January: that period is long gone. Clearing the
      // cancellation would have handed out Pro permanently, so the screen has
      // to send this reader to the page that sells one instead.
      assert.equal(
        canResumePurchase(
          prefs({
            mockSubscriptionPurchasedAt: '2026-01-01T00:00:00.000Z',
            mockSubscriptionCancelledAt: '2026-01-02T00:00:00.000Z',
          }),
          NOW,
        ),
        false,
      );
      assert.equal(canResumePurchase(prefs({}), NOW), false);

      // And that is what the wiring does.
      const tab = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(tab, /if \(canResumePurchase\(preferences\)\) \{[\s\S]{0,140}mockSubscriptionCancelledAt: null/);
      assert.match(tab, /navigate\(\{ tab: 'profile', screen: 'premium' \}\);\s*\}\}/);

      // A plan change re-stamps the purchase, because the end date is counted
      // from the term: switching a cancelled monthly to yearly would otherwise
      // carry it eleven months forward for nothing.
      assert.match(
        tab,
        /mockSubscriptionTerm: term,\s*mockSubscriptionPurchasedAt: new Date\(\)\.toISOString\(\),\s*mockSubscriptionCancelledAt: null,/,
      );
    },
  },
  {
    name: 'proLock: a period end is counted from the original purchase, so the month-end clamp cannot compound',
    run() {
      const { addPeriods, currentPeriodEndAt, nextChargeAt } = require('../../.test-dist/lib/subscriptionTerm.js');
      // Bought on the 31st: February clamps to the 28th, and March must come
      // back to the 31st. Chaining single steps left it on the 28th for good
      // (review 2026-09-03), costing that subscriber days of every period.
      const bought = '2026-01-31T12:00:00.000Z';
      assert.equal(addPeriods('monthly', bought, 1), '2026-02-28T12:00:00.000Z');
      assert.equal(addPeriods('monthly', bought, 2), '2026-03-31T12:00:00.000Z');
      assert.equal(addPeriods('monthly', bought, 3), '2026-04-30T12:00:00.000Z');
      assert.equal(nextChargeAt('monthly', bought), '2026-02-28T12:00:00.000Z');
      // Mid-April, still subscribed: the current period ends on the 30th, not
      // the 28th the compounding walk produced.
      assert.equal(
        currentPeriodEndAt('monthly', bought, new Date('2026-04-15T00:00:00.000Z')),
        '2026-04-30T12:00:00.000Z',
      );
      // Yearly from a leap day lands on 28 Feb, and stays anchored to the 29th.
      assert.equal(addPeriods('yearly', '2028-02-29T09:00:00.000Z', 1), '2029-02-28T09:00:00.000Z');
      assert.equal(addPeriods('yearly', '2028-02-29T09:00:00.000Z', 4), '2032-02-29T09:00:00.000Z');
      assert.equal(addPeriods('lifetime', bought, 1), null);
    },
  },
  {
    name: 'proLock: the upgrade path does not hand permanent Pro to every install that tried the old switch',
    run() {
      // The loader imports AsyncStorage and cannot run under Node, so the
      // migration is a pure function it calls.
      const { normalizePurchaseRecord } = require('../../.test-dist/lib/purchaseRecord.js');
      const EMPTY = { mockSubscriptionPurchasedAt: null, mockSubscriptionCancelledAt: null };
      const normalizeDatabase = ({ preferences }) => ({ preferences: normalizePurchaseRecord(preferences, EMPTY) });
      const base = (preferences) => ({ preferences });

      // A store written by the old code: it carries the switch's key (seeded
      // false on every install) and a purchase instant that only the switch
      // ever wrote. That instant is not a purchase.
      const legacy = normalizeDatabase(
        base({
          adaptiveCoachPremiumUnlocked: false,
          mockSubscriptionPurchasedAt: '2026-08-15T10:00:00.000Z',
          mockSubscriptionTerm: 'yearly',
        }),
      );
      assert.equal(legacy.preferences.mockSubscriptionPurchasedAt, null, 'the old switch became a purchase');
      assert.equal(legacy.preferences.mockSubscriptionCancelledAt, null);

      // Same store, switch ON at the time — the exact case the review named.
      const legacyOn = normalizeDatabase(
        base({
          adaptiveCoachPremiumUnlocked: true,
          mockSubscriptionPurchasedAt: '2026-08-15T10:00:00.000Z',
          mockSubscriptionTerm: 'monthly',
        }),
      );
      assert.equal(legacyOn.preferences.mockSubscriptionPurchasedAt, null);

      // A store written by THIS code has no such key, and its purchase stands.
      const current = normalizeDatabase(
        base({
          mockSubscriptionPurchasedAt: '2026-09-03T10:00:00.000Z',
          mockSubscriptionTerm: 'yearly',
          mockSubscriptionCancelledAt: null,
        }),
      );
      assert.equal(current.preferences.mockSubscriptionPurchasedAt, '2026-09-03T10:00:00.000Z');
      assert.equal(current.preferences.mockSubscriptionCancelledAt, null);

      // The legacy boolean cancellation becomes an instant rather than being
      // dropped, so a cancelled subscription cannot come back as never-ending.
      const cancelledLegacy = normalizeDatabase(
        base({
          mockSubscriptionPurchasedAt: '2026-09-03T10:00:00.000Z',
          mockSubscriptionTerm: 'monthly',
          mockSubscriptionCancelled: true,
        }),
      );
      assert.equal(typeof cancelledLegacy.preferences.mockSubscriptionCancelledAt, 'string');
      assert.equal(Number.isFinite(Date.parse(cancelledLegacy.preferences.mockSubscriptionCancelledAt)), true);
    },
  },
  {
    name: 'proLock: the day a cancelled membership stops is the one the entitlement stops on',
    run() {
      // The End membership page and the subscription screen printed one period
      // after the ORIGINAL purchase — months in the past for anyone who had
      // renewed — while the entitlement rolled forward. Both read the current
      // period's end now.
      const tab = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(tab, /periodEndsAt=\{\s*proEntitlement\.purchaseEndsAt \?\?\s*currentPeriodEndAt\(/);
      const view = read('src', 'lib', 'subscriptionView.ts');
      assert.match(view, /const charge = currentPeriodEndAt\(mockTerm, chargedFrom, now\);/);
      assert.doesNotMatch(view, /const charge = nextChargeAt\(/);
    },
  },
  {
    name: 'proLock: the demo purchase is simulated end to end, and this build is a store build',
    run() {
      const tab = read('src', 'app', 'renderProfileTab.tsx');
      // It records an instant and a term — the shape billing slots into.
      assert.match(tab, /mockSubscriptionPurchasedAt: new Date\(\)\.toISOString\(\)/);
      assert.match(tab, /mockSubscriptionTerm: plan/);
      // Cancelling records WHEN, because a cancelled period must not roll on.
      assert.match(tab, /mockSubscriptionCancelledAt: new Date\(\)\.toISOString\(\)/);

      // The invented card and receipt stay behind the demo flag, so clearing
      // it for a store build takes them off the screen.
      const view = read('src', 'lib', 'subscriptionView.ts');
      assert.match(view, /export function showsMockBilling\(view: SubscriptionView, demoBuild: boolean\)/);
      // ...and only for a purchase: a promo and the trial are grants with no
      // card behind them, in any build.
      assert.match(view, /return demoBuild && view\.state === 'active' && view\.grant === null;/);
      // Cleared 2026-10-08 (user): this is a store build. The invented
      // purchase is the demo's alone, and a store build has a store to buy from.
      assert.equal(JSON.parse(read('app.json')).expo.extra.demoBuild, false);
      assert.ok(JSON.parse(read('package.json')).dependencies['react-native-purchases'], 'a store build with no billing library');
    },
  },
];
