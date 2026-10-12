const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
  'utf8',
);

/**
 * database.ts imports AsyncStorage, so it cannot be required in Node and the
 * loader has to be read rather than run.
 *
 * That is exactly why this file no longer holds the RULE. Its first version
 * asserted the shape of an inlined ternary — including `defaultRestSeconds > 0`,
 * the very comparison that was in the wrong place — and went green over the
 * hole the PR reviewer later found. A source guard can only check that the
 * loader delegates; what the rule decides is tested for real in
 * tests/lib/restPreference.test.cjs, against a function Node can call.
 *
 * CLAUDE.md: "Loaders that trust stored data. src/storage/database.ts
 * normalizes on load; a new field that skips it is a crash on someone's old
 * install."
 */
module.exports = [
  {
    name: 'the loader delegates the stored rest instead of judging it inline',
    run() {
      const branch = source.slice(
        source.indexOf('defaultRestSeconds:'),
        source.indexOf('autoFocusNextInput:'),
      );
      assert.ok(branch.length > 0, 'defaultRestSeconds branch not found');

      // The exercise rows' own rest rule rides in the same import (D6-4).
      assert.match(source, /import \{ normalizeDefaultRestSeconds(, normalizeStoredRestSeconds)? \} from '\.\.\/lib\/restPreference';/);
      assert.match(branch, /normalizeDefaultRestSeconds\(/);
      assert.match(branch, /input\?\.preferences\?\.defaultRestSeconds/);
      // The fallback is still the way out, so an unusable value loses to the
      // default rather than to zero.
      assert.match(branch, /fallback\.preferences\.defaultRestSeconds/);

      // No second opinion left behind in the loader. A comparison here would
      // be a rule the lib test cannot see, which is how the first hole opened.
      assert.doesNotMatch(branch, /Math\.(min|round)\(/);
      assert.doesNotMatch(branch, /Number\.isFinite/);
      assert.doesNotMatch(branch, /[<>]=?\s*0/);
    },
  },
];
