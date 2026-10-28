const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

module.exports = [
  {
    name: 'About you continues on gender and age alone; weight is optional',
    run() {
      const assert = require('node:assert/strict');
      const { canContinueAboutYou } = require('../../src/lib/aboutYouRules');
      assert.equal(canContinueAboutYou({ gender: 'male', ageRange: '19_25' }), true);
      assert.equal(canContinueAboutYou({ gender: null, ageRange: '19_25' }), false);
      assert.equal(canContinueAboutYou({ gender: 'female', ageRange: null }), false);
      // Skip in the gender sheet is an answer.
      assert.equal(canContinueAboutYou({ gender: 'unspecified', ageRange: '41_plus' }), true);
      const { firstMissingAboutYou } = require('../../src/lib/aboutYouRules');
      assert.equal(firstMissingAboutYou({ gender: null, ageRange: null }), 'gender');
      assert.equal(firstMissingAboutYou({ gender: 'unspecified', ageRange: null }), 'age');
      assert.equal(firstMissingAboutYou({ gender: null, ageRange: '19_25' }), 'gender');
      assert.equal(firstMissingAboutYou({ gender: 'male', ageRange: '19_25' }), null);
    },
  },
  {
    name: 'a skipped weight goes on as null and no default weight is stored',
    run() {
      const assert = require('node:assert/strict');
      const screen = read('src', 'screens', 'AboutYouScreen.tsx');
      assert.match(screen, /weightKg: weightSkipped \? null : weightKg/);
      assert.match(screen, /weightKg: number \| null;/);
      assert.match(screen, /setWeightSkipped\(false\)/);
      const finishes = read('src', 'app', 'onboardingFinishes.tsx');
      assert.match(finishes, /setupCurrentWeightKg: aboutYouValues\?\.weightKg \?\? null/);
    },
  },
  {
    name: 'typed ruler values accept comma and dot, clamp, and land on a mark',
    run() {
      const assert = require('node:assert/strict');
      const { parseTypedRulerValue } = require('../../src/lib/rulerValue');
      const kg = { min: 35, max: 220, step: 0.1 };
      assert.equal(parseTypedRulerValue('72,5', kg), 72.5);
      assert.equal(parseTypedRulerValue('72.5', kg), 72.5);
      assert.equal(parseTypedRulerValue(' 71.26 ', kg), 71.3);
      assert.equal(parseTypedRulerValue('500', kg), 220);
      assert.equal(parseTypedRulerValue('3', kg), 35);
      assert.equal(parseTypedRulerValue('', kg), null);
      assert.equal(parseTypedRulerValue('abc', kg), null);
      assert.equal(parseTypedRulerValue('7,2,1', kg), null);
      assert.equal(parseTypedRulerValue('-5', kg), null);
      assert.equal(parseTypedRulerValue('80.3', { min: 20, max: 200, step: 0.5 }), 80.5);
    },
  },
  {
    name: 'copy: the lowest age band reads 18 (the terms ask for 18), start-path and bodyweight texts are the agreed ones',
    run() {
      const assert = require('node:assert/strict');
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal((i18n.match(/'myData\.age\.under19': '18'/g) || []).length, 2);
      assert.ok(i18n.includes("'startPath.build.body': 'Vain 6 vaihetta'"));
      assert.ok(i18n.includes("'startPath.ready.body': 'Yli 50 valmista ohjelmaa'"));
      assert.ok(i18n.includes("'startPath.ready.body': '50+ programs to pick'"));
      assert.ok(i18n.includes("'startPath.empty.body': 'Go straight to home screen'"));
      assert.ok(i18n.includes("'onb.location.bodyweight_only.subtitle': 'Ei tarvita välineitä'"));
    },
  },
];
