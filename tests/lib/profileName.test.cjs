const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { clampProfileName, clipToCodePoints, codePointLength, MAX_PROFILE_NAME_LENGTH, profileInitials, storedProfileName } = require(path.join(DIST, 'lib', 'profileName.js'));
const { accountNameStep } = require(path.join(DIST, 'lib', 'accountNameAdoption.js'));
const { normalizeDatabase } = require(path.join(DIST, 'storage', 'database.js'));
const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const wellFormed = (text) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

/**
 * Bug hunt 10 (2026-10-09): the profile name was cut with String.slice on UTF-16
 * units, so a Google name whose 32nd unit fell inside an emoji was adopted with a
 * lone surrogate (a replacement glyph on Profile, kept through the backup round
 * trip); the avatar took charAt(0), half an emoji for a name that opens with one;
 * and adoption (32) and Edit profile (30) disagreed on the limit.
 */
module.exports = [
  {
    name: 'profile name: cut on characters, never inside an emoji',
    run() {
      const name = `${'A'.repeat(MAX_PROFILE_NAME_LENGTH - 1)}\u{1F600}tail`;
      const clipped = clampProfileName(name);
      assert.ok(wellFormed(clipped), 'cut through the middle of an emoji');
      assert.equal(codePointLength(clipped), MAX_PROFILE_NAME_LENGTH);
      assert.ok(clipped.endsWith('\u{1F600}'));
      assert.equal(clipToCodePoints('abc', 5), 'abc');
      // The cut can land after a space; the stored name is the same when stored again.
      const spaced = `${'A'.repeat(MAX_PROFILE_NAME_LENGTH - 1)} B`;
      assert.equal(storedProfileName(spaced), 'A'.repeat(MAX_PROFILE_NAME_LENGTH - 1));
      assert.equal(storedProfileName(storedProfileName(spaced)), storedProfileName(spaced));
      assert.equal(clipToCodePoints('\u{1F600}\u{1F600}\u{1F600}', 2), '\u{1F600}\u{1F600}');
    },
  },
  {
    name: 'profile name: the account\'s name is adopted whole characters, and the stored one is normalised the same way',
    run() {
      const accountName = `${'A'.repeat(MAX_PROFILE_NAME_LENGTH - 1)}\u{1F600}`;
      const step = accountNameStep({ accountName, profileName: null, adopted: false });
      assert.equal(step.kind, 'adopt');
      assert.ok(wellFormed(step.name), 'adopted a lone surrogate');
      assert.equal(step.name, accountName);

      // A name from before the fix, or a backup that carries one: loaded, it is cut on characters.
      const base = createEmptyDatabase('en');
      const loaded = normalizeDatabase({ ...base, preferences: { ...base.preferences, profileName: `${accountName}${'B'.repeat(10)}` } });
      assert.ok(wellFormed(loaded.preferences.profileName), 'the loader kept a lone surrogate');
      assert.equal(codePointLength(loaded.preferences.profileName), MAX_PROFILE_NAME_LENGTH);
    },
  },
  {
    name: 'profile name: Edit profile uses the same limit as adoption, so an adopted name does not read 32/30',
    run() {
      const source = read('src/screens/EditProfileScreen.tsx');
      assert.ok(!/MAX_NAME_LENGTH\s*=/.test(source), 'Edit profile defines its own limit');
      assert.match(source, /MAX_PROFILE_NAME_LENGTH/);
      assert.match(source, /clampProfileName\(/);
      assert.match(source, /storedProfileName\(/);
      assert.ok(!/\.slice\(0, MAX/.test(source), 'Edit profile cuts on UTF-16 units');
      assert.equal(MAX_PROFILE_NAME_LENGTH, 32);
    },
  },
  {
    name: 'profile initials: an emoji is one character, and the three avatars share the helper',
    run() {
      assert.equal(profileInitials('\u{1F600} Mika'), '\u{1F600}M');
      assert.ok(wellFormed(profileInitials('\u{1F600}')));
      assert.equal(profileInitials('tatu ylönen'), 'TY');
      assert.equal(profileInitials('  '), 'V');
      assert.equal(profileInitials(null), 'V');
      for (const file of ['src/screens/ProfileScreen.tsx', 'src/screens/SettingsScreen.tsx', 'src/screens/EditProfileScreen.tsx']) {
        const source = read(file);
        assert.match(source, /profileInitials\(/, `${file} does not use profileInitials`);
        assert.ok(!/charAt\(0\)/.test(source), `${file} takes charAt(0) of the name`);
      }
    },
  },
];
