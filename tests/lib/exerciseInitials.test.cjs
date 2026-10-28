const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { exerciseInitials } = require('../../src/lib/exerciseInitials');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
const strip = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Owner's #10, iOS hunt 2026-10-17: "Lantionnosto laitteessa" has no picture
 * and the set card drew "LA" in its place, the walk-up "MH" and the picker
 * "L". One rule now, from the name the reader reads.
 */
module.exports = [
  {
    name: 'exerciseInitials: the first letters of the first two words, Finnish letters included',
    run() {
      assert.equal(exerciseInitials('Lantionnosto laitteessa'), 'LL');
      assert.equal(exerciseInitials('Bench Press'), 'BP');
      assert.equal(exerciseInitials('Deep Squat Rotations'), 'DS');
      assert.equal(exerciseInitials('Ääniharjoitus nosto'), 'ÄN');
      assert.equal(exerciseInitials('örkki ässä'), 'ÖÄ');
      assert.equal(exerciseInitials('Burpee'), 'B');
      assert.equal(exerciseInitials('  Kahvakuula   heilautus '), 'KH');
      assert.equal(exerciseInitials(''), '');
      // A word that starts with no letter is skipped, as before.
      assert.equal(exerciseInitials('3/4 Sit-up'), 'S');
    },
  },
  {
    name: 'exerciseInitials: every screen that draws a missing picture asks it, with the shown name',
    run() {
      const player = strip(read('src', 'screens', 'GuidedPlayerScreen.tsx'));
      assert.match(player, /const initials = exerciseInitials\(exerciseNameLabel\(language, name\)\);/);
      assert.match(player, /initials: exerciseInitials\(exerciseNameLabel\(language, name\)\),/);
      assert.doesNotMatch(player, /\.slice\(0, 2\)\.toUpperCase\(\)/);
      const picker = strip(read('src', 'components', 'AddExerciseSheet.tsx'));
      assert.match(picker, /\{exerciseInitials\(exerciseNameLabel\(language, name\)\)\}/);
      assert.doesNotMatch(picker, /name\.charAt\(0\)/);
      // The old English-only helper is gone, not left beside the new one.
      assert.doesNotMatch(read('src', 'lib', 'guidedPlayer.ts'), /getGuidedInitials/);
      assert.doesNotMatch(player, /getGuidedInitials/);
    },
  },
];
