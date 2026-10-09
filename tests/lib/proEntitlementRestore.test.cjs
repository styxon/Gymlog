const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEVICE_ONLY_PREFERENCE_FIELDS,
  canStartProTrial,
  keepDeviceEntitlement,
  resolveProEntitlement,
} = require('../../.test-dist/lib/proEntitlement.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

/**
 * Pro cannot be restored from a backup, and the trial starts once.
 *
 * The backup endpoint stores whatever a signed-in caller uploads, so a payload
 * with `promoProUntil: 9999-…` restored in-app was permanent Pro; and the
 * trial CTA minted fourteen fresh days on every press (security review,
 * 2026-09-14).
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) =>
  fs
    .readFileSync(path.join(root, ...parts), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const FAR = '9999-01-01T00:00:00.000Z';

function preferences(overrides) {
  return { ...createEmptyDatabase('fi').preferences, ...overrides };
}

module.exports = [
  {
    name: 'pro restore: a backup carrying Pro restores everything but the Pro',
    run() {
      const device = preferences({
        appLanguage: 'fi',
        aiCoachProQuota: { monthStart: '2026-09-01', used: 7 },
        coachDemoMomentsUsed: ['day7', 'day30', 'day90'],
        firstLaunchAt: '2026-06-01T00:00:00.000Z',
      });
      const restored = preferences({
        appLanguage: 'en',
        profileName: 'Sanna',
        promoProUntil: FAR,
        proTrialUntil: FAR,
        proTrialStartedAt: '2026-01-01T00:00:00.000Z',
        mockSubscriptionPurchasedAt: '2026-01-01T00:00:00.000Z',
        mockSubscriptionTerm: 'lifetime',
        mockSubscriptionCancelledAt: null,
        aiCoachProQuota: { monthStart: '2026-09-01', used: 0 },
        coachDemoMomentsUsed: [],
        firstLaunchAt: '2026-09-14T00:00:00.000Z',
      });
      assert.equal(resolveProEntitlement(restored).unlocked, true, 'the crafted backup is not one this test would catch');

      const kept = keepDeviceEntitlement(restored, device);
      assert.equal(resolveProEntitlement(kept).unlocked, false, 'the backup bought Pro');
      for (const field of DEVICE_ONLY_PREFERENCE_FIELDS) {
        assert.deepEqual(kept[field], device[field], `${field} came from the backup`);
      }
      // The meters are per install, not history: a backup from the start of
      // the month must not hand the questions back, and an empty list of free
      // coach moments must not hand out three more model calls.
      assert.deepEqual(kept.aiCoachProQuota, { monthStart: '2026-09-01', used: 7 });
      assert.deepEqual(kept.coachDemoMomentsUsed, ['day7', 'day30', 'day90']);
      assert.equal(kept.firstLaunchAt, '2026-06-01T00:00:00.000Z');
      // Everything that is not entitlement is the backup's.
      assert.equal(kept.appLanguage, 'en');
      assert.equal(kept.profileName, 'Sanna');
      assert.equal(restored.promoProUntil, FAR, 'the input was mutated');
    },
  },
  {
    name: 'pro restore: the device keeps a Pro it actually has when restoring a free backup',
    run() {
      const device = preferences({ mockSubscriptionPurchasedAt: '2026-08-01T00:00:00.000Z', mockSubscriptionTerm: 'lifetime' });
      const kept = keepDeviceEntitlement(preferences({}), device);
      assert.equal(resolveProEntitlement(kept).unlocked, true, 'restoring a backup took the purchase away');
    },
  },
  {
    name: 'pro restore: the restore path goes through keepDeviceEntitlement with the device preferences',
    run() {
      const provider = read('src', 'state', 'AppProvider.tsx');
      const restore = provider.slice(provider.indexOf('function restoreDatabaseFromBackup'), provider.indexOf('const value = useMemo<AppContextValue>'));
      // preferencesForRestore = keepDeviceEntitlement, the privacy answers and
      // the loader's lead-in step (tests/lib/accountBackup runs it).
      assert.match(restore, /preferences: preferencesForRestore\(restored\.preferences, databaseRef\.current\.preferences, restored\.workoutPlans\)/);
      assert.doesNotMatch(restore, /await commit\(restored\)/, 'the backup is committed as it came');
      const lib = read('src', 'lib', 'accountBackup.ts');
      // The loader's running-set step is reconcileRunningSet since it also
      // drops ids with no plan behind them (2026-09-21), and a restore takes
      // the same one: a backup of an install carrying the phantom is healed.
      // Since 2026-09-26 the terms acceptance rides between the two: the later
      // of this phone's and the backup's (lib/legalAcceptance).
      // Wrapped in the completion dismissals' repair since hunt 10 (#19).
      assert.match(lib, /const kept = keepDevicePrivacyChoices\(keepDeviceEntitlement\(restored, device\), device\);[\s\S]{0,200}?return reconcileCompletionDismissals\(\s*reconcileRunningSet\(\s*\{ \.\.\.kept, legalAcceptance: laterLegalAcceptance\(device\.legalAcceptance, restored\.legalAcceptance\) \},\s*plans,\s*\),\s*plans,\s*\);/);
    },
  },
  {
    name: 'pro trial: it starts once per install, and the loader keeps the mark',
    run() {
      assert.equal(canStartProTrial(preferences({})), true);
      assert.equal(canStartProTrial(preferences({ proTrialStartedAt: '2026-09-01T00:00:00.000Z' })), false);

      const profile = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(profile, /const trialUntil = canStartProTrial\(preferences\) && plan !== 'lifetime' \? resolveTrialProUntil\(\) : null;/);
      // Written through turnProOn since 2026-09-21: the same patch, now awaited
      // before the unlock screen opens (see screens/oneCount).
      assert.match(profile, /turnProOn\(\{ proTrialUntil: trialUntil, proTrialStartedAt: new Date\(\)\.toISOString\(\) \}\)/);
      assert.doesNotMatch(profile, /PRO_TRIAL_ENABLED && plan !== 'lifetime'/, 'the CTA still mints a trial on every press');

      // Once the trial is spent the same button is a purchase, so the screen
      // has to be told and say so — and the invented purchase stays in the
      // demo build: reachable after the trial, it would otherwise be a free
      // Pro that never expires in any build shipped without billing.
      assert.match(profile, /trialAvailable=\{canStartProTrial\(preferences\)\}/);
      // The handler is async since it waits on its write. Asserted found: a
      // -1 here slices from the end of the file and the checks below would
      // read nothing.
      const purchaseStart = profile.indexOf('onPurchase={async (plan) => {');
      assert.ok(purchaseStart > -1, 'the purchase handler moved');
      const purchase = profile.slice(purchaseStart, profile.indexOf("onOpenLegal={(document) => navigate({ tab: 'profile', screen: 'legal', document })}"));
      const guard = purchase.indexOf('if (!isDemoBuild()) {');
      const write = purchase.indexOf('mockSubscriptionPurchasedAt: new Date().toISOString()');
      assert.ok(guard > 0 && guard < write, 'the invented purchase is written outside the demo build');
      // Outside the demo the branch buys from the store and returns before
      // the invented write in every case: the record it writes is the
      // store's answer, and a store with no Pro to give says so.
      const release = purchase.slice(guard, write);
      assert.match(release, /const outcome = await purchaseStorePlan\(plan\);/);
      assert.match(release, /const record = purchaseRecordFromStore\(outcome\.customer, preferences\);/);
      assert.match(release, /'premium\.purchaseUnavailable'/);
      assert.match(release, /if \(await turnProOn\(record\)\) \{[\s\S]*?\}\s*return;\s*\}\s*const purchased = await turnProOn\(\{\s*$/);

      const premium = read('src', 'screens', 'PremiumScreen.tsx');
      assert.match(premium, /const trialOffered = PRO_TRIAL_ENABLED && trialAvailable;/);
      assert.match(premium, /resolveTierCtaKey\(tier, trialOffered\)/);
      assert.match(premium, /resolveTierFineKey\(tier, activePlan\.id, trialOffered\)/);
      assert.doesNotMatch(premium, /resolveTierCtaKey\(tier, PRO_TRIAL_ENABLED\)/, 'the button promises a trial it will not start');

      // Stored, read back, and absent on an older install (which gets its one).
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const stored = normalizeDatabase({ preferences: { proTrialStartedAt: '2026-09-01T00:00:00.000Z' } });
      assert.equal(stored.preferences.proTrialStartedAt, '2026-09-01T00:00:00.000Z');
      assert.equal(normalizeDatabase({ preferences: {} }).preferences.proTrialStartedAt, null);
      assert.equal(normalizeDatabase({ preferences: { proTrialStartedAt: 12 } }).preferences.proTrialStartedAt, null);
    },
  },
];
