const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * An unreadable database may be replaced, but not thrown away.
 *
 * `loadDatabase` has to hand the app something openable, so a blob that will not
 * parse gets an empty database written over it. That overwrite used to be the
 * end of the story: a truncated write cost the reader every workout they had
 * ever logged, and there was nothing left on the phone to answer a support mail
 * from. The bytes are set aside under their own key first.
 *
 * Source-level, like the seed guard beside it: loadDatabase talks to
 * AsyncStorage, which does not exist in the Node test environment. So this
 * pins the shape of the branch, not its behaviour on a phone.
 */

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

module.exports = [
  {
    name: 'an unparseable database is set aside before an empty one replaces it',
    run() {
      assert.match(code, /const CORRUPT_STORAGE_KEY = '@vinha\/database\/corrupt'/);

      // The catch that recovers from a failed parse, up to the point where it
      // writes: the quarantine has to happen inside it, before saveDatabase.
      const branch = code.slice(code.indexOf('normalizeDatabase(JSON.parse(raw)'));
      // Through the splitting writer: a corrupt blob can be as long as the
      // history it held, and a copy too big to read back is no copy.
      const quarantine = branch.indexOf('setAsideCorruptCopy(CORRUPT_STORAGE_KEY, raw)');
      const overwrite = branch.indexOf('await saveDatabase(empty)');

      assert.ok(quarantine > 0, 'the corrupt blob is not kept anywhere — the overwrite is final');
      assert.ok(overwrite > 0, 'the corrupt branch no longer writes an empty database');
      assert.ok(quarantine < overwrite, 'the copy is taken after the overwrite, which is no copy at all');
    },
  },
  {
    // The preferences live on their own key, and a corrupt blob is not a
    // corrupt preferences row. The first launch after one opened on
    // defaults, and the install-date stamp (App.tsx, straight after load)
    // then saved those defaults over the intact copy: theme, notification
    // choices, the trial's start and the coach's counters, gone
    // (persistence audit, 2026-09-20). Run, against the in-memory storage.
    name: 'a corrupt database opens with the preferences its own key still holds, and does not overwrite them',
    async run() {
      const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
      const fake = createFakeAsyncStorage();
      const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const { createEmptyDatabase } = require(path.join(__dirname, '..', '..', '.test-dist', 'data', 'seed.js'));

      const preferences = {
        ...createEmptyDatabase('en').preferences,
        appLanguage: 'fi',
        darkThemeEnabled: true,
        proTrialStartedAt: '2026-09-17T00:00:00.000Z',
        coachDemoMomentsUsed: ['day7'],
        firstLaunchAt: '2026-08-01T00:00:00.000Z',
        hasOpenedAppBefore: true,
        notificationPrefs: { ...createEmptyDatabase('en').preferences.notificationPrefs, pushEnabled: true, reminderTime: '06:05' },
        activePlanId: 'ready_plan_tpl_x',
        activePlanIds: ['ready_plan_tpl_x', 'custom_plan_mine'],
      };
      await database.savePreferences(preferences);
      const keyBefore = fake.rows.get('@vinha/preferences/v1');
      fake.rows.set('@vinha/database/v1', '{"workoutSessions":[{"id":');

      const loaded = await database.loadDatabase();
      assert.equal(fake.rows.has('@vinha/database/corrupt'), true, 'the blob is still set aside');
      assert.deepEqual(loaded.workoutSessions, [], 'the corrupt blob is not read');
      assert.equal(loaded.preferences.appLanguage, 'fi');
      assert.equal(loaded.preferences.darkThemeEnabled, true, 'the theme reset to the default');
      assert.equal(loaded.preferences.proTrialStartedAt, '2026-09-17T00:00:00.000Z', 'the trial marker was lost');
      assert.deepEqual(loaded.preferences.coachDemoMomentsUsed, ['day7']);
      assert.equal(loaded.preferences.firstLaunchAt, '2026-08-01T00:00:00.000Z', 'the install date would be stamped again');
      assert.equal(loaded.preferences.notificationPrefs.pushEnabled, true);
      assert.equal(loaded.preferences.notificationPrefs.reminderTime, '06:05');
      // The running set went with the programmes it named: kept, two ids
      // with no plan behind them filled the free cap of two.
      assert.equal(loaded.preferences.activePlanId, null);
      assert.deepEqual(loaded.preferences.activePlanIds, []);

      // Nothing the load wrote touched the intact copy, and the next launch
      // reads the same — the running set dropped again against no plans.
      assert.equal(fake.rows.get('@vinha/preferences/v1'), keyBefore, 'the load wrote over the intact copy');
      const again = await database.loadDatabase();
      assert.equal(again.preferences.darkThemeEnabled, true);
      assert.equal(again.preferences.firstLaunchAt, '2026-08-01T00:00:00.000Z');
      assert.deepEqual(again.preferences.activePlanIds, [], 'the next launch read the running set back from the key');
    },
  },
  {
    name: 'erasing the app erases the quarantined copy too',
    run() {
      // Somebody asking for their data to be deleted is not asking for a copy
      // of it to survive under another key.
      const reset = code.slice(code.indexOf('export async function resetDatabase'));
      assert.match(reset, /removeCorruptCopies\(CORRUPT_STORAGE_KEY\)/);
    },
  },
];
