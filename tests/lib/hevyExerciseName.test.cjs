const assert = require('node:assert/strict');

const { resolveImportedExerciseName } = require('../../.test-dist/lib/hevyExerciseName');
const { isSameLift, isSameLiftAsLibraryRow } = require('../../.test-dist/lib/goalProgramme');
const { resolveGoalProgress } = require('../../.test-dist/lib/strengthGoals');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed');
const { STRENGTH_GOAL_PRESETS } = require('../../.test-dist/lib/strengthGoalPresets');

/**
 * Hevy titles a lift with its implement in brackets, and the app's names do
 * not. An import kept "Squat (Barbell)" verbatim: the squat target read "not
 * logged yet" over years of squats, while the library's bracket strip filed
 * "Bench Press (Dumbbell)" and "Deadlift (Smith Machine)" under the barbell
 * targets (hunt, 2026-10-09).
 */

const LIBRARY_NAMES = createSeedExerciseLibrary().map((item) => item.name);

module.exports = [
  {
    name: 'hevy names: the barbell is the bare lift, another implement is written in front, anything else is left alone',
    run() {
      const cases = [
        ['Bench Press (Barbell)', 'Bench Press'],
        ['Squat (Barbell)', 'Back Squat'],
        ['Deadlift (Barbell)', 'Deadlift'],
        ['Overhead Press (Barbell)', 'Overhead Press'],
        ['Bent Over Row (Barbell)', 'Barbell Row'],
        ['Incline Bench Press (Barbell)', 'Incline Bench Press'],
        ['Bench Press (Dumbbell)', 'Dumbbell Bench Press'],
        ['Bench Press (Smith Machine)', 'Smith Machine Bench Press'],
        ['Deadlift (Trap bar)', 'Trap Bar Deadlift'],
        ['Incline Bench Press (Dumbbell)', 'Incline Dumbbell Press'],
        ['Lat Pulldown (Cable)', 'Lat Pulldown'],
        ['Leg Press (Machine)', 'Leg Press'],
        // Not an implement: Hevy's own variants, and the catalogue's cues.
        ['Pull Up (Assisted)', 'Pull Up (Assisted)'],
        ['Seated Cable Row (Wide)', 'Seated Cable Row (Wide)'],
        ['Hip Thrust (Bodyweight)', 'Hip Thrust (Bodyweight)'],
        ['  Plank  ', 'Plank'],
        ['', ''],
      ];
      for (const [title, expected] of cases) {
        assert.equal(resolveImportedExerciseName(title), expected, title);
      }
    },
  },
  {
    name: 'hevy names: a spelling the reader taught the app answers first',
    run() {
      const book = [
        {
          alias: 'squat barbell',
          wrote: 'Squat (Barbell)',
          exerciseName: 'Barbell Full Squat',
          libraryItemId: 'lib_squat',
          learnedAt: '2026-10-01T00:00:00.000Z',
        },
      ];
      assert.equal(resolveImportedExerciseName('Squat (Barbell)', book), 'Barbell Full Squat');
      assert.equal(resolveImportedExerciseName('Bench Press (Barbell)', book), 'Bench Press');
    },
  },
  {
    name: 'hevy names: barbell lifts fill their targets, and a dumbbell, Smith or cable variant fills none of the barbell ones',
    run() {
      const same = (logged, target) => isSameLift(logged, target, LIBRARY_NAMES);
      // Every preset's lift, from Hevy's barbell title.
      assert.equal(same('Squat (Barbell)', 'Barbell Squat'), true);
      assert.equal(same('Bent Over Row (Barbell)', 'Bent Over Barbell Row'), true);
      assert.equal(same('Bench Press (Barbell)', 'Barbell Bench Press - Medium Grip'), true);
      assert.equal(same('Deadlift (Barbell)', 'Barbell Deadlift'), true);
      assert.equal(same('Overhead Press (Barbell)', 'Standing Military Press'), true);
      // Trap bar is the deadlift by the owner's rule.
      assert.equal(same('Deadlift (Trap bar)', 'Barbell Deadlift'), true);

      // A dumbbell bench is not the bench (project-strength-goal-lifts).
      for (const variant of ['Dumbbell', 'Smith Machine', 'Cable']) {
        assert.equal(same(`Bench Press (${variant})`, 'Barbell Bench Press - Medium Grip'), false, `bench (${variant})`);
        assert.equal(same(`Bench Press (${variant})`, 'Bench Press'), false, `bench (${variant}) vs the catalogue's bench`);
      }
      for (const variant of ['Dumbbell', 'Smith Machine']) {
        assert.equal(same(`Deadlift (${variant})`, 'Barbell Deadlift'), false, `deadlift (${variant})`);
        assert.equal(same(`Squat (${variant})`, 'Barbell Squat'), false, `squat (${variant})`);
      }
      assert.equal(same('Incline Bench Press (Dumbbell)', 'Barbell Incline Bench Press - Medium Grip'), false);
      // Still its own lift under its own name.
      assert.equal(same('Bench Press (Dumbbell)', 'Dumbbell Bench Press'), true);

      // The library page of the barbell bench lists none of it either.
      assert.equal(isSameLiftAsLibraryRow('Bench Press (Dumbbell)', 'Barbell Bench Press - Medium Grip', LIBRARY_NAMES), false);
      assert.equal(isSameLiftAsLibraryRow('Bench Press (Barbell)', 'Barbell Bench Press - Medium Grip', LIBRARY_NAMES), true);
    },
  },
  {
    name: 'hevy names: the goal rows read an imported Hevy history the way the targets name it',
    run() {
      const goal = (exerciseName, targetKg) => ({ exerciseName, targetKg, createdAt: '2026-10-01T00:00:00.000Z' });
      const bests = new Map([
        ['Squat (Barbell)', 150],
        ['Bench Press (Dumbbell)', 32],
        ['Deadlift (Smith Machine)', 200],
        ['Bent Over Row (Barbell)', 80],
      ]);
      const progress = resolveGoalProgress(
        [goal('Barbell Squat', 160), goal('Barbell Bench Press - Medium Grip', 100), goal('Barbell Deadlift', 220), goal('Bent Over Barbell Row', 100)],
        bests,
        (logged, lift) => isSameLift(logged, lift, LIBRARY_NAMES),
      );
      assert.deepEqual(
        progress.map((row) => [row.goal.exerciseName, row.currentKg]),
        [
          ['Barbell Squat', 150],
          ['Barbell Bench Press - Medium Grip', null],
          ['Barbell Deadlift', null],
          ['Bent Over Barbell Row', 80],
        ],
      );
      // Every lift the goal sheet offers, from Hevy's barbell (or machine)
      // title: it fills that target and no other.
      const hevyTitles = {
        'Barbell Squat': 'Squat (Barbell)',
        'Barbell Bench Press - Medium Grip': 'Bench Press (Barbell)',
        'Barbell Deadlift': 'Deadlift (Barbell)',
        'Front Barbell Squat': 'Front Squat (Barbell)',
        'Hack Squat': 'Hack Squat (Machine)',
        'Barbell Hip Thrust': 'Hip Thrust (Barbell)',
        'Romanian Deadlift': 'Romanian Deadlift (Barbell)',
        'Upright Barbell Row': 'Upright Row (Barbell)',
        'Bent Over Barbell Row': 'Bent Over Row (Barbell)',
        'Barbell Incline Bench Press - Medium Grip': 'Incline Bench Press (Barbell)',
      };
      const presets = STRENGTH_GOAL_PRESETS.map((preset) => preset.exerciseName);
      for (const preset of presets) {
        const title = hevyTitles[preset];
        assert.ok(title, `a Hevy title for the preset ${preset}`);
        assert.deepEqual(
          presets.filter((lift) => isSameLift(title, lift, LIBRARY_NAMES)),
          [preset],
          title,
        );
      }
    },
  },
];
