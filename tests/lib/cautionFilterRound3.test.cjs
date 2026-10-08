const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const { DEFAULT_FIRST_RUN_SELECTION } = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { exerciseHitsCautionArea } = require(dist + 'lib/cautionAreaMatching.js');
const { applyCautionFlagsToExercises } = require(dist + 'lib/cautionExerciseFilter.js');
const { applyEquipmentToExercises } = require(dist + 'lib/equipmentExerciseFilter.js');
const { movementFamilyOf } = require(dist + 'lib/movementFamily.js');
const { WORKOUT_TEMPLATES_V1 } = require(dist + 'features/workout/workoutCatalog.js');

/**
 * Persona hunt round 3 (2026-10-08), the caution filter:
 *
 * - a swap never adds a second lift of a movement family the day holds
 *   (Hip Thrust beside Glute Bridge, Leg Curl beside Lying Leg Curl);
 * - the lower-back avoid reaches the hinges under their other names
 *   (Single-Leg RDL, Pull-Through), the wrists avoid reaches the dip;
 * - a thin day is topped up from every movement area it was for, not from
 *   the first area with something safe, and the swing's dumbbell stand-in is
 *   a hinge.
 */

const exercise = (name, index = 0, trackingMode = 'reps') => ({
  id: `e${index}`,
  slotId: `s${index}`,
  exerciseName: name,
  trackingMode,
  sets: 3,
  repsMin: 10,
  repsMax: 10,
  restSecondsMin: 60,
  restSecondsMax: 60,
});

const careful = (area) => [{ area, level: 'careful' }];
const names = (exercises) => exercises.map((entry) => entry.exerciseName);

const GYM_FULL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines', 'Resistance bands'];

function setup({ equipmentItems, trainingEnvironment, avoid = [], careful: carefulAreas = [], ...rest }) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    equipment: trainingEnvironment === 'full_gym' ? 'gym' : 'home',
    trainingEnvironment,
    equipmentItems,
    gender: 'unspecified',
    focusAreas: [],
    availableDays: [],
    goals: [rest.goal],
    ...rest,
    cautionFlags: [
      ...avoid.map((area) => ({ area, level: 'avoid' })),
      ...carefulAreas.map((area) => ({ area, level: 'careful' })),
    ],
  };
}

const HOME_NONE = { trainingEnvironment: 'bodyweight_only', equipmentItems: [] };
const HOME_DUMBBELLS = { trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] };

// Season and focus-block templates are not recommendation programmes.
const COMPOSABLE_TEMPLATES = WORKOUT_TEMPLATES_V1.filter((template) => {
  try {
    return composeProgramWeekForSelection(setup({ ...HOME_NONE, goal: 'general', level: 'beginner', daysPerWeek: 3 }), template.id) !== null;
  } catch {
    return false;
  }
});

module.exports = [
  {
    name: 'round 3: movement families name the drills that are one movement',
    run() {
      for (const name of ['Hip Thrust', 'Barbell Hip Thrust', 'Glute Bridge', 'Butt Lift (Bridge)', 'Glute Bridge (Banded)', 'Banded Glute Bridge', 'Glute Kickback', 'One-Legged Cable Kickback']) {
        assert.equal(movementFamilyOf(name), 'glute-bridge', name);
      }
      for (const name of ['Leg Curl', 'Lying Leg Curl', 'Seated Leg Curl', 'Nordic Hamstring Curl']) {
        assert.equal(movementFamilyOf(name), 'leg-curl', name);
      }
      for (const name of ['Triceps Kickback', 'Tricep Dumbbell Kickback', 'Back Squat', 'Bench Press', 'Hammer Curl', 'Leg Extension']) {
        assert.equal(movementFamilyOf(name), null, name);
      }
    },
  },
  {
    name: 'round 3: a careful-knees swap does not add a second bridge or curl to a day that holds one',
    run() {
      // Leg Press -> Hip Thrust, then Walking Lunge -> Glute Bridge: two
      // bridges on one day. The lunge keeps its bodyweight version instead.
      const day = [exercise('Leg Press', 0), exercise('Walking Lunge', 1), exercise('Leg Curl', 2)];
      const result = applyCautionFlagsToExercises(day, careful('knees'), [], null);
      const bridges = names(result.exercises).filter((name) => movementFamilyOf(name) === 'glute-bridge');
      assert.equal(bridges.length, 1, names(result.exercises).join(', '));
      assert.ok(names(result.exercises).includes('Hip Thrust'));
      assert.ok(names(result.exercises).includes('Bodyweight Walking Lunge'));

      // A template's own pair is never judged: no swap, no change.
      const native = [exercise('Hip Thrust', 0), exercise('Glute Bridge (Banded)', 1), exercise('Back Squat', 2)];
      const kept = applyCautionFlagsToExercises(native, careful('knees'), [], null);
      assert.deepEqual(names(kept.exercises).slice(0, 2), ['Hip Thrust', 'Glute Bridge (Banded)']);

      // An original Leg Curl on the day blocks a second one as a swap target:
      // Leg Extension has no curl to become, and keeps its place.
      const curls = applyCautionFlagsToExercises([exercise('Lying Leg Curl', 0), exercise('Leg Extension', 1)], careful('knees'), [], null);
      assert.deepEqual(names(curls.exercises), ['Lying Leg Curl', 'Leg Extension']);
    },
  },
  {
    name: 'round 3: under a careful-knees flag no ready session ends with more of a family than it began with',
    run() {
      let swappedSessions = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const gear of [null, ['Dumbbells'], []]) {
            const result = applyCautionFlagsToExercises(session.exercises, careful('knees'), [], gear);
            if (result.swapped.length === 0) {
              continue;
            }
            swappedSessions += 1;
            for (const family of ['glute-bridge', 'leg-curl']) {
              const count = (list) => list.filter((entry) => movementFamilyOf(entry.exerciseName) === family).length;
              assert.ok(
                count(result.exercises) <= Math.max(count(session.exercises), 1),
                `${template.id} / ${session.name} (${gear}): ${family} -> ${names(result.exercises).join(', ')}`,
              );
            }
          }
        }
      }
      assert.ok(swappedSessions > 50, `only ${swappedSessions} sessions swapped; the sweep is not looking`);
    },
  },
  {
    name: 'round 3: the lower-back avoid reaches the hinges under their other names',
    run() {
      for (const name of ['Single-Leg RDL', 'RDL', 'Cable Pull-Through', 'Pull Through', 'Wide Stance Stiff Legs', 'Stiff-Legged Dumbbell Deadlift', 'Hyperextensions With No Hyperextension Bench', 'Weighted Ball Hyperextension', 'Romanian Deadlift', 'Single-Leg Romanian Deadlift']) {
        assert.equal(exerciseHitsCautionArea(name, 'lower_back'), true, name);
      }
      for (const name of ['Hip Thrust', 'Glute Bridge', 'Butt Lift (Bridge)', 'Reverse Hyperextension', 'Plank', 'Chest-Supported Row', 'Floor Glute-Ham Raise']) {
        assert.equal(exerciseHitsCautionArea(name, 'lower_back'), false, name);
      }

      // Avoid removes it; careful swaps the abbreviation like the long name.
      const day = [exercise('Single-Leg RDL', 0), exercise('Plank', 1)];
      const removed = applyCautionFlagsToExercises(day, [{ area: 'lower_back', level: 'avoid' }], [], null);
      assert.deepEqual(names(removed.exercises), ['Plank']);
      const swapped = applyCautionFlagsToExercises(day, careful('lower_back'), [], null);
      assert.ok(!names(swapped.exercises).includes('Single-Leg RDL'), names(swapped.exercises).join(', '));
      const bodyweight = applyCautionFlagsToExercises(day, careful('lower_back'), [], []);
      assert.ok(!names(bodyweight.exercises).includes('Single-Leg RDL'), names(bodyweight.exercises).join(', '));
    },
  },
  {
    name: 'round 3: no ready-programme hinge survives a lower-back avoid, in any composed week',
    run() {
      const hinge = /\brdl\b|romanian|pull[- ]through|stiff[- ]leg|good morning|deadlift/i;
      for (const template of COMPOSABLE_TEMPLATES) {
        const week = composeProgramWeekForSelection(
          setup({ ...HOME_DUMBBELLS, goal: 'general', level: 'beginner', daysPerWeek: 3, avoid: ['lower_back'] }),
          template.id,
        );
        for (const session of week?.sessions ?? []) {
          for (const entry of session.exercises) {
            assert.ok(!hinge.test(entry.exerciseName), `${template.id} / ${session.name}: ${entry.exerciseName}`);
          }
        }
      }
    },
  },
  {
    name: 'round 3: a wrists avoid takes the dip out of the week as well as the push-ups',
    run() {
      for (const name of ['Bench Dips', 'Triceps Dip (Chair)', 'Dips', 'Penkkidippi']) {
        assert.equal(exerciseHitsCautionArea(name, 'wrists'), true, name);
      }
      assert.equal(exerciseHitsCautionArea('Dipstick Row', 'wrists'), false);

      const week = composeProgramWeekForSelection(
        setup({ ...HOME_NONE, goal: 'strength', level: 'beginner', daysPerWeek: 3, avoid: ['wrists'] }),
        'tpl_gainer_at_home_beginner_v1',
      );
      for (const session of week.sessions) {
        for (const entry of session.exercises) {
          assert.ok(!/\bdips?\b/i.test(entry.exerciseName), `${session.name}: ${entry.exerciseName}`);
          assert.ok(!/push-up/i.test(entry.exerciseName), `${session.name}: ${entry.exerciseName}`);
        }
      }
    },
  },
  {
    name: 'round 3: the kettlebell swing becomes a dumbbell hinge for a reader with dumbbells, a bridge for one without',
    run() {
      const day = [exercise('Kettlebell Swing', 0)];
      assert.deepEqual(names(applyEquipmentToExercises(day, ['Dumbbells']).exercises), ['Stiff-Legged Dumbbell Deadlift']);
      assert.deepEqual(names(applyEquipmentToExercises(day, []).exercises), ['Butt Lift (Bridge)']);
      assert.deepEqual(names(applyEquipmentToExercises(day, GYM_FULL).exercises), ['Kettlebell Swing']);
    },
  },
  {
    name: 'round 3: a Fat Burn HIIT lower day with the knees avoided is not three bridges, and a dumbbell owner keeps a hinge',
    run() {
      for (const gear of [HOME_NONE, HOME_DUMBBELLS]) {
        const week = composeProgramWeekForSelection(
          setup({ ...gear, goal: 'general', level: 'beginner', daysPerWeek: 3, avoid: ['knees'] }),
          'tpl_gainer_fat_burn_hiit_v1',
        );
        const lower = week.sessions.find((session) => session.name === 'Lower Body HIIT');
        assert.ok(lower, week.sessions.map((session) => session.name).join(', '));
        const lowerNames = names(lower.exercises);
        const bridges = lowerNames.filter((name) => movementFamilyOf(name) === 'glute-bridge');
        assert.ok(bridges.length <= 1, `${gear.equipmentItems}: ${lowerNames.join(', ')}`);
        assert.ok(lowerNames.length >= 3, lowerNames.join(', '));
        // A hinge or a calf lift is safe and was never reached.
        assert.ok(
          lowerNames.some((name) => /glute-ham|calf|deadlift|good morning/i.test(name)),
          `${gear.equipmentItems}: ${lowerNames.join(', ')}`,
        );
      }

      // The week as a whole: no day holds two lifts of one family it was topped up with.
      const week = composeProgramWeekForSelection(
        setup({ ...HOME_DUMBBELLS, goal: 'general', level: 'beginner', daysPerWeek: 3, avoid: ['knees'] }),
        'tpl_gainer_fat_burn_hiit_v1',
      );
      for (const session of week.sessions) {
        const family = names(session.exercises).filter((name) => movementFamilyOf(name) === 'glute-bridge');
        assert.ok(family.length <= 1, `${session.name}: ${names(session.exercises).join(', ')}`);
      }
      assert.ok(
        week.sessions.some((session) => names(session.exercises).includes('Stiff-Legged Dumbbell Deadlift')),
        'the swing keeps a loaded hinge for a dumbbell owner',
      );
    },
  },
  {
    name: 'round 3: a knees-avoid week never holds more of a bridge or curl family on a day than the same week without the flag',
    run() {
      let days = 0;
      let toppedUp = 0;
      for (const template of COMPOSABLE_TEMPLATES) {
        for (const gear of [HOME_NONE, HOME_DUMBBELLS]) {
          const base = setup({ ...gear, goal: 'general', level: 'beginner', daysPerWeek: 3 });
          const week = composeProgramWeekForSelection({ ...base, cautionFlags: [{ area: 'knees', level: 'avoid' }] }, template.id);
          // The gear alone can pair a bridge with a hip thrust (a leg curl
          // becomes a bridge without a bar): what the flag adds is judged
          // against the same week without it.
          const free = composeProgramWeekForSelection({ ...base, cautionFlags: [] }, template.id);
          for (const session of week.sessions) {
            days += 1;
            const original = free.sessions.find((entry) => entry.id === session.id);
            for (const family of ['glute-bridge', 'leg-curl']) {
              const count = (list) => list.filter((entry) => movementFamilyOf(entry.exerciseName) === family).length;
              const before = original ? count(original.exercises) : 0;
              if (original && session.exercises.some((entry) => !original.exercises.some((own) => own.exerciseName === entry.exerciseName))) {
                toppedUp += 1;
              }
              assert.ok(
                count(session.exercises) <= Math.max(before, 1),
                `${template.id} / ${session.name} (${gear.equipmentItems}): ${names(session.exercises).join(', ')}`,
              );
            }
          }
        }
      }
      assert.ok(days > 200 && toppedUp > 0, `${days} days, ${toppedUp} changed: the sweep is not looking`);
    },
  },
  {
    name: 'round 3: Banded Glute Bridge opens a floor bridge in the player, with its history filed where it was',
    run() {
      const { findFiledLibraryIndex, findGuidedLibraryIndex } = require(dist + 'lib/guidedPlayer.js');
      const { createSeedExerciseLibrary } = require(dist + 'data/seed.js');
      const library = createSeedExerciseLibrary();
      const libraryNames = library.map((item) => item.name);
      const demo = library[findGuidedLibraryIndex('Banded Glute Bridge', libraryNames)];
      assert.equal(demo.name, 'Butt Lift (Bridge)');
      assert.equal(demo.equipment, 'bodyweight');
      assert.ok(!/barbell|\btanko\b|loaded bar/i.test((demo.instructions ?? []).join(' ')), 'no bar in the steps');
      const filed = findFiledLibraryIndex('Banded Glute Bridge', libraryNames);
      assert.equal(filed === null ? null : libraryNames[filed], 'Barbell Glute Bridge');
    },
  },
];
