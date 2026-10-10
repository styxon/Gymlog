const assert = require('node:assert/strict');

const { accountNameStep } = require('../../.test-dist/lib/accountNameAdoption.js');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

/**
 * The account's name is taken once, ever — not whenever the profile has no
 * name, which is also what the reader has the moment they clear theirs
 * (2026-09-16).
 */

const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

module.exports = [
  {
    name: 'account name: taken once, and a cleared name stays cleared',
    run() {
      // A signed-in reader with no name gets the account's, trimmed and capped.
      assert.deepEqual(
        accountNameStep({ accountName: '  Tatu Ylönen  ', profileName: null, adopted: false }),
        { kind: 'adopt', name: 'Tatu Ylönen' },
      );
      assert.deepEqual(
        accountNameStep({ accountName: 'A'.repeat(40), profileName: '', adopted: false }),
        { kind: 'adopt', name: 'A'.repeat(32) },
      );

      // The bug: the reader cleared the name the account gave them. The
      // account has had its turn, so nothing is written back.
      assert.deepEqual(
        accountNameStep({ accountName: 'Tatu Ylönen', profileName: null, adopted: true }),
        { kind: 'none' },
      );
      assert.deepEqual(
        accountNameStep({ accountName: 'Tatu Ylönen', profileName: '   ', adopted: true }),
        { kind: 'none' },
      );

      // A name the reader typed outranks the account's, and closes its turn.
      assert.deepEqual(
        accountNameStep({ accountName: 'Tatu Ylönen', profileName: 'Tatu', adopted: false }),
        { kind: 'markAdopted' },
      );
      assert.deepEqual(
        accountNameStep({ accountName: null, profileName: 'Tatu', adopted: false }),
        { kind: 'markAdopted' },
      );

      // No account name: nothing to take, and the chance is kept for a later
      // sign-in.
      assert.deepEqual(accountNameStep({ accountName: null, profileName: null, adopted: false }), { kind: 'none' });
      assert.deepEqual(accountNameStep({ accountName: '  ', profileName: null, adopted: false }), { kind: 'none' });
    },
  },
  {
    name: 'account name: an install from before the flag is loaded by its name',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));

      // A fresh install has not had an account name.
      assert.equal(normalizeDatabase({ preferences: {} }).preferences.accountNameAdopted, false);
      // One with a name has had its say, from the account or the reader.
      assert.equal(normalizeDatabase({ preferences: { profileName: 'Tatu' } }).preferences.accountNameAdopted, true);
      // One without a name may never have signed in: it keeps its chance.
      assert.equal(normalizeDatabase({ preferences: { profileName: null } }).preferences.accountNameAdopted, false);
      assert.equal(normalizeDatabase({ preferences: { profileName: '  ' } }).preferences.accountNameAdopted, false);
      // A stored flag is read back as written, whatever the name.
      assert.equal(
        normalizeDatabase({ preferences: { profileName: null, accountNameAdopted: true } }).preferences.accountNameAdopted,
        true,
      );
      assert.equal(
        normalizeDatabase({ preferences: { profileName: 'Tatu', accountNameAdopted: false } }).preferences
          .accountNameAdopted,
        false,
      );
      assert.equal(
        normalizeDatabase({ preferences: { accountNameAdopted: 'yes' } }).preferences.accountNameAdopted,
        false,
        'a malformed value is not a yes',
      );
    },
  },
  {
    // Redo onboarding runs the questionnaire with no seed, so its name is
    // empty — and writing that empty name over the stored one left a
    // signed-in reader nameless for good, the account having had its turn
    // (review, 2026-09-16).
    name: 'account name: re-running the questionnaire leaves the stored name alone',
    run() {
      const { buildSetupPreferencePatch } = require('../../.test-dist/app/onboardingHandoff.js');
      const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
      for (const profileName of [null, undefined, '', '   ']) {
        const patch = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, profileName }, null);
        assert.equal('profileName' in patch, false, `an empty name (${JSON.stringify(profileName)}) is not written`);
        // The rest of the patch is still there.
        assert.equal(patch.onboardingCompleted, true);
      }
      const named = buildSetupPreferencePatch({ ...DEFAULT_FIRST_RUN_SELECTION, profileName: '  Tatu  ' }, null);
      assert.equal(named.profileName, 'Tatu');
    },
  },
  {
    name: 'account name: the effect asks the flag, and writes the name with it',
    run() {
      const wiring = strip(readAppWiring());
      assert.match(wiring, /adopted: preferences\.accountNameAdopted,/);
      assert.match(
        wiring,
        /tryOnce\(`accountName:adopt:\$\{name\}`, \(\) => updatePreferences\(\{ profileName: name, accountNameAdopted: true \}\)\);/,
      );
      // The old rule, which filled a cleared name straight back in.
      assert.doesNotMatch(wiring, /if \(!googleName \|\| preferences\.profileName\?\.trim\(\)\) \{/);
    },
  },
];
