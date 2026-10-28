const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveLanguageFromLocale } = require('../../src/lib/deviceLanguage');

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

module.exports = [
  {
    // Android reports fi_FI, iOS and the web fi-FI, and some devices append a
    // charset or a calendar extension. All of them are Finnish.
    name: 'every shape of a Finnish locale tag resolves to Finnish',
    run() {
      for (const tag of ['fi', 'fi-FI', 'fi_FI', 'FI', 'fi-FI.UTF-8', 'fi-FI@calendar=gregory', '  fi_FI  ']) {
        assert.equal(resolveLanguageFromLocale(tag), 'fi', tag);
      }
    },
  },
  {
    // Swedish is an official language of Finland and not one this app speaks.
    // Falling back to English is honest; guessing at a third is not.
    name: 'everything else is English, including a missing tag',
    run() {
      for (const tag of ['en', 'en-GB', 'sv-FI', 'sv', 'de-DE', 'fin', 'finnish', '', null, undefined, 42]) {
        assert.equal(resolveLanguageFromLocale(tag), 'en', String(tag));
      }
    },
  },
  {
    /**
     * The rule stays importable in Node.
     *
     * The first attempt put the platform read in this module, so `seed.ts`
     * imported react-native and the ENTIRE test suite stopped loading — Node
     * cannot parse `import typeof` in react-native's entry point. The reader
     * lives in storage/, which nothing under test imports.
     */
    name: 'the rule is pure; only storage touches the platform',
    run() {
      assert.doesNotMatch(read('src', 'lib', 'deviceLanguage.ts'), /from 'react-native'/);
      assert.match(read('src', 'storage', 'deviceLocale.ts'), /from 'react-native'/);
    },
  },
  {
    /**
     * A stored choice always wins.
     *
     * The device decides the language only when there is nothing in storage —
     * which is exactly once, on the first launch. Resolving it on every load
     * would overwrite the reader's own choice every time they changed their
     * phone's language.
     */
    name: 'the device decides only when nothing is stored',
    run() {
      const database = read('src', 'storage', 'database.ts');
      const firstRun = database.slice(database.indexOf('if (!raw) {'), database.indexOf('try {', database.indexOf('if (!raw) {')));
      assert.match(firstRun, /createEmptyDatabase\(resolveDeviceLanguage\(\)\)/);

      // The normalizer still prefers the stored value over any fallback.
      assert.match(
        database,
        /appLanguage:\s*\n?\s*input\?\.preferences\?\.appLanguage === 'fi' \|\| input\?\.preferences\?\.appLanguage === 'en'/,
      );

      // And the seed's own constant stays 'en', so fixtures do not move under
      // whatever language the machine running the tests happens to be in.
      assert.match(read('src', 'data', 'seed.ts'), /appLanguage: 'en' as const/);
    },
  },
  {
    /**
     * The argument is actually used.
     *
     * First attempt: createEmptyDatabase took `appLanguage` and then spread
     * DEFAULT_PREFERENCES over the preferences object, putting 'en' straight
     * back. The device read worked, the parse worked, the value was passed —
     * and the app still opened in English. Same failure this codebase has
     * logged nine times: written, passed, never wired.
     */
    name: 'createEmptyDatabase spends the language it was given',
    run() {
      const { createEmptyDatabase } = require('../../src/data/seed');
      assert.equal(createEmptyDatabase('fi').preferences.appLanguage, 'fi');
      assert.equal(createEmptyDatabase('en').preferences.appLanguage, 'en');
      // No argument is the structural fallback fixtures rely on.
      assert.equal(createEmptyDatabase().preferences.appLanguage, 'en');
      // The spread has to come BEFORE the override, or the constant wins.
      const seed = read('src', 'data', 'seed.ts');
      const body = seed.slice(seed.indexOf('export function createEmptyDatabase'));
      assert.ok(
        body.indexOf('...DEFAULT_PREFERENCES') < body.indexOf('appLanguage,'),
        'DEFAULT_PREFERENCES is spread after the override and puts en back',
      );
    },
  },
];
