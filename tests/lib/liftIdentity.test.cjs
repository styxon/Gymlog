const assert = require('node:assert/strict');

const { isSameLiftByGroup, liftGroupOf, bestForLift } = require('../../.test-dist/lib/liftIdentity.js');
const { isSameLift, rankProgrammesForLift } = require('../../.test-dist/lib/goalProgramme.js');
const { resolveGoalProgress } = require('../../.test-dist/lib/strengthGoals.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { STRENGTH_GOAL_PRESETS } = require('../../.test-dist/lib/strengthGoalPresets.js');
const library = require('../../.test-dist/data/generatedExerciseLibrary.js');

const libraryNames = library[Object.keys(library).find((key) => Array.isArray(library[key]))].map(
  (entry) => entry.name,
);

module.exports = [
  {
    name: 'a lift is the same lift however the program spelled it',
    run() {
      // The catalog writes the deadlift six ways across its programs; a target
      // names one of them.
      for (const name of [
        'Deadlift',
        'Conventional Deadlift',
        'Competition Deadlift',
        'Sumo Deadlift',
        'Trap Bar Deadlift',
        'Deficit Deadlift',
      ]) {
        assert.equal(isSameLiftByGroup(name, 'Barbell Deadlift'), true, `${name} should be a deadlift`);
      }
      assert.equal(isSameLiftByGroup('Barbell Bench Press', 'Bench Press'), true);
      assert.equal(isSameLiftByGroup('Competition Back Squat', 'Back Squat'), true);
      assert.equal(isSameLiftByGroup('Standing Overhead Press', 'Overhead Press'), true);
      assert.equal(isSameLiftByGroup('Pendlay Row', 'Barbell Row'), true);
    },
  },
  {
    name: 'a movement that is merely nearby is not the lift',
    run() {
      // A Romanian deadlift is a hinge accessory. Filling a deadlift target
      // with it would be the same lie as measuring progress from an estimate.
      for (const name of ['Romanian Deadlift', 'Romanian Deadlift (Light)', 'Single-Leg Romanian Deadlift']) {
        assert.equal(isSameLiftByGroup(name, 'Barbell Deadlift'), false, `${name} is not a deadlift`);
        assert.equal(isSameLift(name, 'Barbell Deadlift', libraryNames), false, `${name} must not match via the library either`);
      }
      assert.equal(isSameLift('Incline Bench Press', 'Bench Press', libraryNames), false);
      assert.equal(isSameLift('Dumbbell Bench Press', 'Bench Press', libraryNames), false);
      assert.equal(isSameLift('Front Squat', 'Back Squat', libraryNames), false);
      assert.equal(isSameLift('Dumbbell Shoulder Press', 'Overhead Press', libraryNames), false);
      assert.equal(isSameLift('Seated Cable Row', 'Barbell Row', libraryNames), false);
    },
  },
  {
    name: 'a name outside every group still falls back to the library',
    run() {
      // The groups only speak for the five lifts a target can name; everything
      // else resolves the way it always did.
      assert.equal(liftGroupOf('Lateral Raise'), null);
      assert.equal(isSameLift('Bench Press', 'bench press'), true);
      assert.equal(isSameLift('Back Squat', 'Barbell Full Squat', libraryNames), true);
    },
  },
  {
    name: 'a target reads the best set logged under any spelling of its lift',
    run() {
      const goals = [{ exerciseName: 'Barbell Deadlift', targetKg: 100, createdAt: '' }];
      const bests = new Map([
        ['Conventional Deadlift', 92.5],
        ['Trap Bar Deadlift', 110],
        ['Romanian Deadlift', 140],
      ]);
      const matches = (logged, lift) => isSameLift(logged, lift, libraryNames);

      // What it used to do: nothing under that exact name, so the bar never moved.
      assert.equal(resolveGoalProgress(goals, bests)[0].currentKg, null);

      const [progress] = resolveGoalProgress(goals, bests, matches);
      // 110, not 140: the heaviest DEADLIFT, not the heaviest hinge.
      assert.equal(progress.currentKg, 110);
      assert.equal(progress.reached, true);

      assert.equal(bestForLift('Barbell Deadlift', new Map(), matches), null);
      assert.equal(
        bestForLift('Barbell Deadlift', new Map([['Romanian Deadlift', 200]]), matches),
        null,
        'a hinge accessory alone leaves the target unstarted',
      );
    },
  },
  {
    /**
     * No two target lifts may be the same lift.
     *
     * The list is short and hand-written, so a plausible-looking addition can
     * quietly duplicate one already on it. Sumo deadlift is the live example:
     * liftIdentity folds sumo and trap bar into the deadlift on purpose, so a
     * sumo row would carry the deadlift's best and the deadlift's rate — two
     * rows showing one number, and two targets that move together. It is off
     * the list for that reason and this is what keeps the reason enforced.
     */
    name: 'no two target lifts resolve to the same lift',
    run() {
      const folded = [];
      for (let left = 0; left < STRENGTH_GOAL_PRESETS.length; left += 1) {
        for (let right = left + 1; right < STRENGTH_GOAL_PRESETS.length; right += 1) {
          const a = STRENGTH_GOAL_PRESETS[left].exerciseName;
          const b = STRENGTH_GOAL_PRESETS[right].exerciseName;
          if (isSameLift(a, b, libraryNames)) {
            folded.push(`${a} == ${b}`);
          }
        }
      }
      assert.deepEqual(folded, [], `target lifts that are the same lift: ${folded.join(', ')}`);

      // And the one deliberately kept off, still folding — if this stops being
      // true, sumo can have its own row.
      assert.equal(
        isSameLift('Sumo Deadlift', 'Barbell Deadlift', libraryNames),
        true,
        'sumo no longer folds into the deadlift; it can be a target of its own now',
      );

      // Every name is one the library actually has, or the row opens nothing
      // and the log can never match it.
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const reachable = new Set(createSeedExerciseLibrary().map((item) => item.name));
      const invented = STRENGTH_GOAL_PRESETS.map((preset) => preset.exerciseName).filter(
        (name) => !reachable.has(name),
      );
      assert.deepEqual(invented, [], `target lifts the library does not have: ${invented.join(', ')}`);
    },
  },
  {
    name: 'every preset target is trained by a fair share of the catalog',
    run() {
      // The deadlift target saw three programs of fifty-seven while the others
      // saw twenty to thirty — the names, not the training, were the gap. That
      // is what this catches: a lift the catalog DOES train, hidden behind a
      // naming mismatch.
      //
      // Not the same thing as a lift the catalog genuinely trains in few
      // weeks. These three are thin because few weeks have them, not because a
      // name failed to resolve.
      //
      // A FLOOR, not the count. The regression worth catching is a drop toward
      // zero, which shows the reader an empty step 3; growth is the fix, and
      // an equality here would have turned red the day the upright row went
      // from 0 to 2. The numbers are today's, so a floor still fails loudly if
      // a rename takes one back to nothing.
      const GENUINELY_THIN = {
        // 8 until STRONG, a beginner week, traded its front squat for a
        // second back squat day (user, 2026-10-06).
        'Front Barbell Squat': 7,
        'Upright Barbell Row': 2,
        'Hack Squat': 5,
      };
      const thin = [];
      for (const preset of STRENGTH_GOAL_PRESETS) {
        const lift = preset.exerciseName;
        const count = rankProgrammesForLift(WORKOUT_TEMPLATES_V1, lift, { libraryNames }).length;
        if (lift in GENUINELY_THIN) {
          assert.ok(
            count >= GENUINELY_THIN[lift],
            `${lift} resolves to ${count} programmes now, down from ${GENUINELY_THIN[lift]} — a name stopped resolving`,
          );
          continue;
        }
        if (count < 10) {
          thin.push(`${lift}: ${count}`);
        }
      }
      assert.deepEqual(thin, [], `targets almost no program trains: ${thin.join(', ')}`);
    },
  },

  {
    /**
     * One lift, one row — and the row the tab draws has to agree with it.
     *
     * They disagreed on the phone once: the target row showed 70 kg of 200
     * while the picker behind it said "not logged yet" for the same lift,
     * because one resolved the lift and the other matched the name. The picker
     * is gone and the three-step flow replaced it, but the shape survives: the
     * flow merges logged lifts into the library list, and a log that says
     * "Barbell Bench Press" against a library that says "Barbell Bench Press -
     * Medium Grip" would put the lift in the list twice — once with a best and
     * once saying never logged.
     */
    name: 'the target flow and the target row read the log the same way',
    run() {
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // The flow finds each lift's log through the same matcher the progress
      // row uses, rather than by name. Matching on the name is how the row
      // once read 70 kg of 200 beside a picker saying "not logged yet".
      // Every spelling it matches, not the first: trap bar 150 and sumo 170
      // made the flow's best 150 while the row said 170 (2026-09-15).
      assert.match(
        app,
        /proLiftHistories\.filter\(\(entry\) =>\s*\n\s*isSameLift\(entry\.name, preset\.exerciseName, libraryNames\)/,
        'the flow matches the log by name again, or stops at the first spelling',
      );
      assert.match(app, /const bestKg = histories\.reduce\(\(best, entry\) => Math\.max\(best, entry\.bestWeightKg\), 0\);/);

      // And the resolution the row uses is the same function, so a lift that
      // matches in one place matches in the other.
      const bests = new Map([['Barbell Bench Press', 70], ['Conventional Deadlift', 120]]);
      const matches = (logged, lift) => isSameLift(logged, lift, libraryNames);
      const [progress] = resolveGoalProgress(
        [{ exerciseName: 'Barbell Deadlift', targetKg: 150, createdAt: '' }],
        bests,
        matches,
      );
      assert.equal(progress.currentKg, 120, 'the deadlift variant no longer resolves to the lift');
      assert.equal(progress.reached, false);
    },
  },
];
