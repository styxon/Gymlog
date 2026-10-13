const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

module.exports = [
  {
    name: 'About you continues on gender and age alone; weight is optional',
    run() {
      const assert = require('node:assert/strict');
      const { canContinueAboutYou } = require('../../.test-dist/lib/aboutYouRules.js');
      assert.equal(canContinueAboutYou({ gender: 'male', ageRange: '19_25' }), true);
      assert.equal(canContinueAboutYou({ gender: null, ageRange: '19_25' }), false);
      assert.equal(canContinueAboutYou({ gender: 'female', ageRange: null }), false);
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
      const { parseTypedRulerValue } = require('../../.test-dist/lib/rulerValue.js');
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
    name: 'copy: 16–18 uses an en dash, start-path and bodyweight texts are the agreed ones',
    run() {
      const assert = require('node:assert/strict');
      const i18n = read('src', 'lib', 'i18n.ts');
      assert.equal((i18n.match(/'myData\.age\.under19': '16–18'/g) || []).length, 2);
      assert.ok(i18n.includes("'startPath.ready.body': 'Selaa valmiita ohjelmia ja valitse itsellesi sopiva.'"));
      assert.ok(i18n.includes("'startPath.ready.body': 'Browse the ready programs and pick one that suits you.'"));
      assert.ok(i18n.includes("'startPath.empty.body': 'Find programs later in the Programs tab, or build your own from scratch.'"));
      assert.ok(i18n.includes('Ei välineitä. Treenaa kotona, ulkona tai missä vain.'));
    },
  },
];
