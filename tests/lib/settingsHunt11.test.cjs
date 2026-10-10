const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dist = path.join(root, '.test-dist');
const { createHookRuntime, requireWithStubs } = require('../helpers/hookHarness.cjs');
const { attemptOnce } = require(path.join(dist, 'lib', 'attemptOnce.js'));
const { characterCount, clampProfileName, profileInitials, splitCharacters, storedProfileName } = require(path.join(dist, 'lib', 'profileName.js'));
const { buildSetupPreferencePatch } = require(path.join(dist, 'app', 'onboardingHandoff.js'));
const { DEFAULT_FIRST_RUN_SELECTION } = require(path.join(dist, 'lib', 'firstRunSetup.js'));

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
const FLAG = '\u{1F1EB}\u{1F1EE}';
const LIFTER = '\u{1F3CB}\uFE0F\u200D\u2642\uFE0F';
const THUMB = '\u{1F44D}\u{1F3FD}';
const wellFormed = (text) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

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
    // buildSetupPreferencePatch cut the name with slice(0, 32): UTF-16 units, so 20 emoji came back as 16,
    // and a name ending in an emoji at the limit came back with a lone surrogate.
    name: 'questionnaire re-run: a name Edit profile accepted is written back unchanged',
    run() {
      const names = [
        '\u{1F4AA}'.repeat(20),
        `${'a'.repeat(31)}\u{1F600}`,
        `Matti Matti Matti ${LIFTER}${'\u{1F525}'.repeat(7)}`,
        FAMILY.repeat(3),
        'x'.repeat(32),
      ];
      for (const name of names) {
        const stored = storedProfileName(name);
        const patch = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, profileName: stored }, null);
        assert.equal(patch.profileName, stored, `re-run changed ${JSON.stringify(stored)}`);
        assert.ok(wellFormed(patch.profileName));
      }
      // A name over the limit is cut like every other writer cuts it.
      const long = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, profileName: `  ${'b'.repeat(40)}  ` }, null);
      assert.equal(long.profileName, 'b'.repeat(32));
      // No name in the questionnaire: the stored one is not overwritten.
      assert.equal('profileName' in buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, profileName: '  ' }, null), false);
    },
  },
  {
    name: 'profile name: a flag, a family, a skin tone and an accent are one character each',
    run() {
      assert.deepEqual(splitCharacters(`a${FLAG}${FAMILY}${LIFTER}${THUMB}e\u0301`), ['a', FLAG, FAMILY, LIFTER, THUMB, 'e\u0301']);
      assert.deepEqual(splitCharacters(`${FLAG}${FLAG}\u{1F1E6}`), [FLAG, FLAG, '\u{1F1E6}']);
      assert.deepEqual(splitCharacters('a\r\nb'), ['a', '\r\n', 'b']);
      // A joiner before a letter is not a bond.
      assert.deepEqual(splitCharacters('a\u200Db'), ['a\u200D', 'b']);
      // One character cannot be a way round the limit.
      assert.ok(splitCharacters(`a${'\u0301'.repeat(100)}`).length > 1);
      assert.equal(splitCharacters('').length, 0);
    },
  },
  {
    // clipToCodePoints cut a 37-code-point family to 32 and left "...\u{1F468}\u200D" dangling, and
    // the flag cut left half a country.
    name: 'profile name: the cut never splits a flag, a joined emoji, a skin tone or an accent',
    run() {
      for (const unit of [FAMILY, FLAG, LIFTER, THUMB, 'e\u0301']) {
        for (let pad = 28; pad <= 32; pad += 1) {
          const name = `${'a'.repeat(pad)}${unit}${unit}`;
          const stored = storedProfileName(name);
          assert.ok(characterCount(stored) <= 32, 'over the limit');
          assert.ok(wellFormed(stored));
          const tail = stored.slice(pad);
          assert.ok(tail === '' || tail === unit || tail === unit + unit, `${JSON.stringify(unit)} cut to ${JSON.stringify(tail)} at ${pad}`);
          // Stored again, the same.
          assert.equal(storedProfileName(stored), stored);
        }
      }
      assert.equal(characterCount(clampProfileName(FAMILY.repeat(40))), 32);
      assert.equal(clampProfileName(FAMILY.repeat(32)), FAMILY.repeat(32), 'a valid name lost a character');
    },
  },
  {
    name: 'profile initials: whole characters, at most two, a letter that upper-cases to two gives one',
    run() {
      assert.equal(profileInitials(`${FLAG} Matti`), `${FLAG}M`);
      assert.equal(profileInitials(`${FAMILY} Virtanen`), `${FAMILY}V`);
      assert.equal(profileInitials('E\u0301mile Zola'), 'E\u0301Z');
      assert.equal(profileInitials('\u00DFeta \u00C4rling'), 'S\u00C4');
      assert.equal(profileInitials('\uFB01na \uFB02ow'), 'FF');
      assert.equal(profileInitials('\u00DFeta'), 'S');
      assert.equal(profileInitials('tatu yl\u00F6nen'), 'TY');
      assert.equal(profileInitials('  '), 'V');
      for (const name of [`${THUMB} ${LIFTER}`, 'a b c d', '\u00DF \u00DF', FLAG]) {
        assert.ok(splitCharacters(profileInitials(name)).length <= 2, `${JSON.stringify(name)} gave ${JSON.stringify(profileInitials(name))}`);
      }
    },
  },
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
      const useAttemptOnce = requireWithStubs(path.join(dist, 'app', 'useAttemptOnce.js'), {
        react: runtime.react,
        'react-native': { AppState: { addEventListener: () => ({ remove: () => undefined }) } },
      }).useAttemptOnce;
      const { useInstallStamps } = requireWithStubs(path.join(dist, 'app', 'useInstallStamps.js'), {
        react: runtime.react,
        './useAttemptOnce': { useAttemptOnce },
      });
      const realWarn = console.warn;
      console.warn = () => undefined;
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
      console.warn = realWarn;
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
  {
    name: 'reset dialog: the no-copy text says nothing can be restored, in both languages, and the other texts keep their promise',
    run() {
      const { t } = require(path.join(dist, 'lib', 'i18n.js'));
      assert.equal(
        t('en', 'settings.resetDialog.message.signedInNoCopy'),
        'Everything on this phone is deleted and you are signed out. There is no cloud backup of this data, so it cannot be restored.',
      );
      assert.equal(
        t('fi', 'settings.resetDialog.message.signedInNoCopy'),
        'Kaikki tässä puhelimessa poistetaan ja sinut kirjataan ulos. Tästä datasta ei ole pilvivarmuuskopiota, joten sitä ei voi palauttaa.',
      );
      for (const language of ['en', 'fi']) {
        assert.doesNotMatch(t(language, 'settings.resetDialog.message.signedInNoCopy'), /stays|säilyy/i);
      }
      const { resetDialogMessageKey } = require(path.join(dist, 'lib', 'accountBackup.js'));
      assert.equal(resetDialogMessageKey(false, 'none'), 'settings.resetDialog.message');
      assert.equal(resetDialogMessageKey(true, 'none'), 'settings.resetDialog.message.signedInNoCopy');
      assert.equal(resetDialogMessageKey(true, 'behind'), 'settings.resetDialog.message.signedInBehind');
      assert.equal(resetDialogMessageKey(true, 'current'), 'settings.resetDialog.message.signedIn');
    },
  },
  {
    name: 'cloudCopyState: held backups with no backup time are none, a held account with a time is current, otherwise the fingerprint decides',
    run() {
      const { cloudCopyState } = require(path.join(dist, 'lib', 'accountBackup.js'));
      const never = () => {
        throw new Error('walked the history for a held account');
      };
      assert.equal(cloudCopyState({ autoBackupPaused: true, lastBackupAt: null, lastBackupFingerprint: null }, never), 'none');
      assert.equal(cloudCopyState({ autoBackupPaused: true, lastBackupAt: '2026-10-01T00:00:00.000Z', lastBackupFingerprint: 'a' }, never), 'current');
      assert.equal(cloudCopyState({ autoBackupPaused: false, lastBackupAt: 'x', lastBackupFingerprint: 'a' }, () => 'b'), 'behind');
      assert.equal(cloudCopyState({ autoBackupPaused: false, lastBackupAt: 'x', lastBackupFingerprint: 'a' }, () => 'a'), 'current');
    },
  },
  {
    // A transient refusal got no second chance for the whole session, and said nothing.
    name: 'lead plan repair: a refused write is not looped and is logged; the app returning to the front tries once more, and a changed lead is repaired at once',
    async run() {
      const runtime = createHookRuntime();
      const listeners = new Set();
      const AppState = {
        addEventListener(_type, listener) {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      };
      const { useAttemptOnce } = requireWithStubs(path.join(dist, 'app', 'useAttemptOnce.js'), {
        react: runtime.react,
        'react-native': { AppState },
      });
      const { useLeadPlanRepair } = requireWithStubs(path.join(dist, 'app', 'useLeadPlanRepair.js'), {
        react: runtime.react,
        './useAttemptOnce': { useAttemptOnce },
      });
      const plan = (id) => ({ id, name: id, entries: [{ workoutTemplateId: `tpl_${id}` }] });
      const writes = [];
      let refuse = true;
      const updatePreferences = (patch) => {
        writes.push(patch.activePlanId);
        return refuse ? Promise.reject(new Error('storage: refused')) : Promise.resolve();
      };
      const props = (activePlanId, ids, plans) => ({
        appHydrated: true,
        preferences: { activePlanId, activePlanIds: ids },
        database: { workoutPlans: plans },
        updatePreferences,
      });
      const warned = [];
      const realWarn = console.warn;
      console.warn = (...args) => warned.push(args.join(' '));
      try {
        // Lead missing, plan p1 held: the repair names p1. Refused, the lead reads missing again on every render.
        for (let render = 0; render < 5; render += 1) {
          runtime.render(useLeadPlanRepair, props(null, ['p1'], [plan('p1')]));
          await flush();
        }
        assert.deepEqual(writes, ['p1'], 'a refused repair was written again');
        assert.equal(warned.length, 1, 'the refusal was not logged once');
        assert.match(warned[0], /lead:p1/, 'the log does not name the key');
        // Back to the front: one more try, and only one.
        refuse = false;
        for (const listener of [...listeners]) {
          listener('background');
        }
        runtime.render(useLeadPlanRepair, props(null, ['p1'], [plan('p1')]));
        await flush();
        assert.deepEqual(writes, ['p1'], 'a background change released the key');
        for (const listener of [...listeners]) {
          listener('active');
        }
        runtime.render(useLeadPlanRepair, props(null, ['p1'], [plan('p1')]));
        await flush();
        // The write landed: the lead is p1 now, and nothing more is owed.
        for (let render = 0; render < 3; render += 1) {
          runtime.render(useLeadPlanRepair, props('p1', ['p1'], [plan('p1')]));
          await flush();
        }
        assert.deepEqual(writes, ['p1', 'p1'], 'returning to the front did not retry exactly once');
        // A different lead is a different repair, tried at once.
        runtime.render(useLeadPlanRepair, props(null, ['p2'], [plan('p2')]));
        await flush();
        assert.deepEqual(writes, ['p1', 'p1', 'p2']);
        // And a foreground with nothing refused changes nothing.
        for (const listener of [...listeners]) {
          listener('active');
        }
        runtime.render(useLeadPlanRepair, props('p2', ['p2'], [plan('p2')]));
        await flush();
        assert.deepEqual(writes, ['p1', 'p1', 'p2']);
      } finally {
        console.warn = realWarn;
        runtime.unmount();
      }
    },
  },
  {
    name: 'attemptOnce: releaseRefused hands back only the refused keys, once',
    async run() {
      const { releaseRefused } = require(path.join(dist, 'lib', 'attemptOnce.js'));
      const tried = new Set(['a', 'b']);
      const refused = new Set(['a']);
      assert.equal(releaseRefused(tried, refused), true);
      assert.deepEqual([...tried], ['b']);
      assert.equal(releaseRefused(tried, refused), false);
      const seen = [];
      const set = new Set();
      attemptOnce(set, 'k', () => Promise.reject(new Error('no')), (error) => seen.push(error.message));
      await flush();
      assert.deepEqual(seen, ['no']);
      attemptOnce(set, 'k', () => Promise.reject(new Error('again')), (error) => seen.push(error.message));
      assert.deepEqual(seen, ['no'], 'a held key was tried again');
    },
  },
];
