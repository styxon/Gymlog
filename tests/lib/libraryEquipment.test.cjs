const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { isUnloadedTrackingMode } = require('../../.test-dist/features/workout/workoutTypes.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
const {
  FOCUS_ACCESSORY_POOL,
  SUPPLEMENTAL_DAY_POOL,
  getCatalogTrackingMode,
} = require('../../.test-dist/lib/catalogExercisePools.js');

const root = path.join(__dirname, '..', '..');
const { overrides } = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'exercise-equipment-overrides.json'), 'utf8'),
);

/**
 * A loaded lift is not bodyweight (2026-09-21).
 *
 * The library generator turned every equipment value it did not know into
 * "bodyweight", and the source files trap bars, farmer's walks, sleds and
 * plates under "other". Bodyweight is what decides the weight dial in the
 * reader's own programme, the Bodyweight filter chip and a no-equipment coach
 * plan, so a trap bar deadlift in your own programme saved 0 kg. Two ready
 * programme rows had the same mistake by hand: weighted pull-ups and dips.
 */
module.exports = [
  {
    name: 'library equipment: every loaded lift the source calls "other" is filed where its load is',
    run() {
      const byName = new Map(GENERATED_EXERCISE_LIBRARY.map((item) => [item.name, item]));
      const wrong = Object.entries(overrides)
        .filter(([name, bucket]) => byName.get(name)?.equipment !== bucket)
        .map(([name, bucket]) => `${name}: ${byName.get(name)?.equipment ?? 'missing'} (want ${bucket})`);
      assert.deepEqual(wrong, [], 'the generated library and scripts/exercise-equipment-overrides.json disagree');

      // And the next sync keeps them: the generator reads the same file.
      const generator = fs.readFileSync(path.join(root, 'scripts', 'generate_free_exercise_library.mjs'), 'utf8');
      assert.match(generator, /scripts\/exercise-equipment-overrides\.json/);
      assert.match(generator, /equipment: EQUIPMENT_OVERRIDES\[name\] \?\? mapEquipment\(entry\.equipment\)/);
    },
  },
  {
    name: 'library equipment: a trap bar deadlift or a farmer\'s walk in your own programme asks for the weight',
    run() {
      const exercise = (id, name, orderIndex) => ({
        id,
        workoutTemplateId: 'wt_mine',
        workoutTemplateSessionId: 'wts_day1',
        name,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        trackedDefault: true,
        orderIndex,
        libraryItemId: null,
      });
      const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
        { id: 'wt_mine', name: 'Mine', exerciseIds: [], sessions: [], createdAt: '', updatedAt: '' },
        [
          {
            id: 'wts_day1',
            workoutTemplateId: 'wt_mine',
            name: 'Day 1',
            orderIndex: 0,
            exercises: [
              exercise('ex_trap', 'Trap Bar Deadlift', 0),
              exercise('ex_farmer', "Farmer's Walk", 1),
              exercise('ex_sled', 'Sled Push', 2),
              exercise('ex_pushup', 'Pushups', 3),
            ],
          },
        ],
        GENERATED_EXERCISE_LIBRARY,
        90,
      );
      const modes = Object.fromEntries(
        runtime.sessions[0].exercises.map((item) => [item.exerciseName, item.trackingMode]),
      );
      assert.equal(modes['Trap Bar Deadlift'], 'load_and_reps');
      assert.equal(modes["Farmer's Walk"], 'load_and_reps');
      assert.equal(modes['Sled Push'], 'load_and_reps');
      // Bodyweight work stays bodyweight: the fix names lifts, it does not
      // flip the fallback.
      assert.equal(modes.Pushups, 'bodyweight');

      assert.equal(getCatalogTrackingMode('Trap Bar Deadlift'), 'load_and_reps');
      assert.equal(getCatalogTrackingMode("Farmer's Walk"), 'load_and_reps');
    },
  },
  {
    name: 'library equipment: the ready programmes log a weighted pull-up and a weighted dip with the weight',
    run() {
      const unloaded = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            if (/^weighted\b/i.test(exercise.exerciseName) && isUnloadedTrackingMode(exercise.trackingMode)) {
              unloaded.push(`${template.id} / ${exercise.id}: ${exercise.exerciseName} (${exercise.trackingMode})`);
            }
          }
        }
      }
      assert.deepEqual(unloaded, [], 'a weighted lift with no weight dial saves 0 kg');
    },
  },
  {
    name: 'library equipment: a plan for someone with no equipment asks for no weight',
    run() {
      // The composer's bodyweight pools are what a reader with no equipment is
      // given. The recovery day's farmer's walk got in because the library
      // called it bodyweight.
      const loaded = [];
      for (const [label, pools] of [
        ['focus', FOCUS_ACCESSORY_POOL],
        ['supplemental', SUPPLEMENTAL_DAY_POOL],
      ]) {
        for (const [kind, pool] of Object.entries(pools)) {
          for (const name of pool.bodyweight) {
            if (getCatalogTrackingMode(name) === 'load_and_reps') {
              loaded.push(`${label}.${kind}: ${name}`);
            }
          }
        }
      }
      assert.deepEqual(loaded, []);
    },
  },
  {
    /**
     * The farmer's walk became a dumbbell lift and had no equipment rule, so
     * the recovery day's loaded variant — chosen for any reader with any chip
     * at all — handed it to someone whose only gear is a pull-up bar (CI
     * review of #172).
     */
    name: 'library equipment: a pull-up bar and a mat are not asked for a weight either',
    run() {
      const {
        DEFAULT_FIRST_RUN_SELECTION,
        resolveFirstRunRecommendationWithTailoring,
      } = require('../../.test-dist/lib/firstRunSetup.js');
      const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');
      const loaded = new Set();
      for (const goal of ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness']) {
        for (const level of ['beginner', 'advanced', 'pro']) {
          for (const daysPerWeek of [2, 3, 4, 5, 6]) {
            const selection = {
              ...DEFAULT_FIRST_RUN_SELECTION,
              goal,
              goals: [goal],
              level,
              daysPerWeek,
              trainingEnvironment: 'bodyweight_only',
              equipment: 'home',
              equipmentItems: ['Pull-up bar', 'Yoga mat'],
            };
            const recommendation = resolveFirstRunRecommendationWithTailoring(selection, null);
            const week = composeProgramWeekForSelection(selection, recommendation.featuredProgramId);
            for (const session of week?.sessions ?? []) {
              for (const exercise of session.exercises) {
                if (exercise.trackingMode === 'load_and_reps') {
                  loaded.add(exercise.exerciseName);
                }
              }
            }
          }
        }
      }
      // The runners' programme prescribes these three with an optional weight
      // (a dial left at zero records bodyweight work truthfully). It reaches a
      // bar-and-mat reader now that "Nordic Hamstring Curl (Assisted)" and
      // "Lower Back Curl" are no longer refused for want of a barbell.
      const optionallyLoaded = new Set(['Bulgarian Split Squat', 'Single-Leg Romanian Deadlift', 'Step-Up']);
      assert.deepEqual([...loaded].filter((name) => !optionallyLoaded.has(name)), []);
    },
  },
  {
    /**
     * The swap keeps the prescription's numbers, and a carry's are seconds or
     * metres: the bridge it fell back to first became "3 × 40" bridges (CI
     * review of #172). A hold reads those numbers as what they were.
     */
    name: 'library equipment: a farmer\'s walk with nothing to carry becomes a hold, not 40 reps',
    run() {
      const { applyEquipmentToExercises } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
      const carry = {
        id: 'carry',
        exerciseName: "Farmer's Walk",
        slotId: 'carry_1',
        role: 'secondary',
        progressionPriority: 'medium',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 40,
        repsMax: 40,
        restSecondsMin: 60,
        restSecondsMax: 90,
        substitutionGroup: 'conditioning_circuit',
      };
      const barOnly = applyEquipmentToExercises([carry], ['Pull-up bar', 'Yoga mat']).exercises[0];
      assert.equal(barOnly.exerciseName, 'Plank');
      assert.equal(barOnly.trackingMode, 'hold');
      assert.equal(barOnly.repsMin, 40);
      // With something to carry, it stays the carry.
      assert.equal(applyEquipmentToExercises([carry], ['Dumbbells']).exercises[0].exerciseName, "Farmer's Walk");

      // And a plate lift needs a plate: a dumbbell curl for a bands-only
      // reader fell back to reverse plate curls, now filed as loaded (CI
      // review of #172). The band curl is the honest one now (2026-09-26),
      // logged without a weight.
      const curl = { ...carry, id: 'curl', exerciseName: 'Dumbbell Curl', repsMin: 12, repsMax: 12 };
      const banded = applyEquipmentToExercises([curl], ['Resistance bands']);
      assert.deepEqual(banded.exercises.map((exercise) => [exercise.exerciseName, exercise.trackingMode]), [
        ['Band Curl', 'bodyweight'],
      ]);
      assert.deepEqual(banded.removed, []);
      assert.equal(
        applyEquipmentToExercises([curl], ['Barbell & plates']).exercises[0].exerciseName,
        'Reverse Plate Curls',
      );
    },
  },
  {
    /**
     * The override list is a list, and a list misses names: four of the same
     * class were found after it was written (CI review of #172). A library
     * name that names an implement and is still filed as bodyweight fails
     * here unless it is below, with the reason it carries no load.
     */
    name: 'library equipment: no name that carries an implement is filed as bodyweight',
    run() {
      const IMPLEMENT =
        /weighted|sled|chain|plate|sandbag|barbell|dumbbell|kettlebell|trap bar|farmer|yoke|keg|atlas|log lift|axle|tire flip|sledgehammer|heavy bag|rickshaw|prowler|wrist roller/i;
      const NO_LOAD = new Set([
        // The dumbbell is a handle to push up from; the load is the body.
        'Close-Grip Push-Up off of a Dumbbell',
      ]);
      const misfiled = GENERATED_EXERCISE_LIBRARY.filter(
        (item) => item.equipment === 'bodyweight' && IMPLEMENT.test(item.name) && !NO_LOAD.has(item.name),
      ).map((item) => item.name);
      assert.deepEqual(misfiled, [], 'add them to scripts/exercise-equipment-overrides.json');
    },
  },
];
