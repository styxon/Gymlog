const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dist = path.join(root, '.test-dist');
const { createHookRuntime, requireWithStubs } = require('../helpers/hookHarness.cjs');
const { attemptOnce } = require(path.join(dist, 'lib', 'attemptOnce.js'));

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Bug hunt 11 (2026-10-10), settings and account.
 */
module.exports = [
  {
    // updatePreferences rolls a refused write back and rethrows; the value an effect watches
    // flips back and the effect ran again, for as long as the app stayed open.
    name: 'attemptOnce: a refused write is tried once, a landed one may be owed again, and neither throws',
    async run() {
      const tried = new Set();
      let calls = 0;
      attemptOnce(tried, 'k', async () => {
        calls += 1;
        throw new Error('storage: refused');
      });
      await flush();
      attemptOnce(tried, 'k', async () => {
        calls += 1;
      });
      assert.equal(calls, 1, 'a refused write was tried again');
      attemptOnce(tried, 'other', async () => {
        calls += 1;
      });
      assert.equal(calls, 2, 'a different key was held back');
      await flush();
      attemptOnce(tried, 'other', async () => {
        calls += 1;
      });
      assert.equal(calls, 3, 'a write that landed could not be owed again');
      // A throw before the promise exists is a refusal too.
      attemptOnce(tried, 'sync', () => {
        calls += 1;
        throw new Error('sync');
      });
      attemptOnce(tried, 'sync', async () => {
        calls += 1;
      });
      assert.equal(calls, 4);
    },
  },
  {
    name: 'install stamps: a preference write the disk refuses is not re-issued on every render',
    async run() {
      const runtime = createHookRuntime();
      const useAttemptOnce = requireWithStubs(path.join(dist, 'app', 'useAttemptOnce.js'), { react: runtime.react }).useAttemptOnce;
      const { useInstallStamps } = requireWithStubs(path.join(dist, 'app', 'useInstallStamps.js'), {
        react: runtime.react,
        './useAttemptOnce': { useAttemptOnce },
      });
      const writes = [];
      const updatePreferences = (patch) => {
        writes.push(Object.keys(patch).join());
        // Rolled back and rethrown, as AppProvider.updatePreferences does.
        return Promise.reject(new Error('storage: refused'));
      };
      const preferences = { hasOpenedAppBefore: false, firstLaunchAt: null };
      for (let render = 0; render < 6; render += 1) {
        // The optimistic write flips the stamps on, the rollback flips them off again.
        runtime.render(useInstallStamps, { appHydrated: true, preferences: { ...preferences, hasOpenedAppBefore: render % 2 === 1 }, updatePreferences });
        runtime.render(useInstallStamps, { appHydrated: true, preferences: { ...preferences }, updatePreferences });
        await flush();
      }
      assert.deepEqual(writes.sort(), ['firstLaunchAt', 'hasOpenedAppBefore'], 'a refused stamp was written again');
      runtime.unmount();
    },
  },
  {
    name: 'every effect that stamps or repairs a preference goes through tryOnce, not a bare void write',
    run() {
      const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const read = (file) => strip(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
      const app = read('App.tsx');
      const adoption = app.slice(app.indexOf('accountNameStep({'), app.indexOf('useAccountOutcome({'));
      assert.match(adoption, /tryOnce\('accountName:mark'/);
      assert.match(adoption, /tryOnce\(`accountName:adopt:/);
      assert.doesNotMatch(adoption, /void updatePreferences/, 'the account-name effect writes without a guard');
      for (const file of ['useInstallStamps.ts', 'useLeadPlanRepair.ts', 'useSetupWeightSeed.ts']) {
        const source = read(`src/app/${file}`);
        assert.match(source, /tryOnce\(/, `${file} does not guard its write`);
        assert.doesNotMatch(source, /void updatePreferences/, `${file} has an unguarded write inside an effect`);
      }
      const overlays = read('src/app/useSetupHandoffOverlays.tsx');
      assert.match(overlays, /tryOnce\('setupHandoffCompleted'/);
      assert.doesNotMatch(overlays, /void updatePreferences\(\{ setupHandoffCompleted/);
    },
  },
];
