const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getExerciseTemplateDefaults, restSecondsForAddedLift } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');

/**
 * A lift added mid-session rests between its sets (re-hunt R4, 2026-10-07).
 *
 * The player's "Lisää liike" gave the new lift the rest of the exercise it was
 * added after. Dream Body Female's Quads & Cardio ends on a Stairmaster bout
 * that rests 0, and a 3 × 6–8 bench press added after it rested 0 too — the
 * player's 15 s floor between heavy sets.
 */

const LIBRARY = createEmptyDatabase('en').exerciseLibrary;
const BENCH = LIBRARY.find((item) => item.name === 'Barbell Bench Press - Medium Grip');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

module.exports = [
  {
    name: 'a lift added after a zero-rest row takes the reader\'s default rest, not 0 s',
    run() {
      assert.ok(BENCH, 'the bench press is in the library');
      const template = getWorkoutTemplateById('tpl_gainer_dream_body_female_v1');
      const day = template && template.sessions.find((session) => session.exercises.length > 0
        && session.exercises[session.exercises.length - 1].restSecondsMin === 0);
      assert.ok(day, 'a Dream Body day ends on a row that rests 0');
      const anchorRest = day.exercises[day.exercises.length - 1].restSecondsMin;

      assert.equal(restSecondsForAddedLift(anchorRest, 120), 120);
      assert.equal(getExerciseTemplateDefaults(BENCH, restSecondsForAddedLift(anchorRest, 120)).restSeconds, 120);
      assert.equal(restSecondsForAddedLift(0, 150), 150, 'the reader\'s own default, not a fixed number');
    },
  },
  {
    name: 'a lift added after one that rests keeps the session\'s rhythm',
    run() {
      assert.equal(restSecondsForAddedLift(90, 120), 90);
      assert.equal(getExerciseTemplateDefaults(BENCH, restSecondsForAddedLift(90, 120)).restSeconds, 90);
    },
  },
  {
    name: 'no lift to add after, or a rest that cannot be counted, takes the default',
    run() {
      assert.equal(restSecondsForAddedLift(null, 120), 120);
      assert.equal(restSecondsForAddedLift(undefined, 100), 100);
      assert.equal(restSecondsForAddedLift(Number.NaN, 120), 120);
      assert.equal(restSecondsForAddedLift(-30, 120), 120);
    },
  },
  {
    name: 'the player\'s mid-session add asks restSecondsForAddedLift for the rest, with the reader\'s default',
    run() {
      const source = stripComments(
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8'),
      );
      const start = source.indexOf('const addMidWorkoutExercise = ');
      assert.ok(start >= 0);
      const end = source.indexOf('const backOne = ', start);
      const body = source.slice(start, end);
      assert.match(body, /getExerciseTemplateDefaults\(\s*item,\s*restSecondsForAddedLift\(anchor\?\.restSecondsMin,\s*defaultRestSeconds\)\s*\)/);
      assert.doesNotMatch(body, /anchor\.restSecondsMin\s*:/);

      const tab = stripComments(
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'), 'utf8'),
      );
      const player = tab.slice(tab.indexOf('<GuidedPlayerScreen'));
      assert.match(player.slice(0, player.indexOf('/>')), /defaultRestSeconds=\{preferences\.defaultRestSeconds\}/);
    },
  },
];
