const assert = require('node:assert/strict');

const {
  applyEquipmentToExercises,
  isExerciseAllowedWithEquipment,
  resolveAvailableEquipment,
} = require('../../.test-dist/lib/equipmentExerciseFilter');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog');

function exercise(name) {
  return {
    id: `ex_${name.replace(/\W+/g, '_').toLowerCase()}`,
    exerciseName: name,
    slotId: 'slot',
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    restSecondsMin: 60,
    restSecondsMax: 120,
    substitutionGroup: 'none',
  };
}

/**
 * Catalog names that need gear without saying "barbell", "dumbbell" or any
 * other word an older rule keyed on. Every one of them passed a plan for a
 * reader with nothing (bug hunt, 2026-10-04), and the deadlift fallbacks never
 * ran because the deadlift itself was never refused.
 */
const NEEDS_GEAR = [
  'Deadlift',
  'Conventional Deadlift',
  'Competition Deadlift',
  'Deficit Deadlift',
  'Sumo Deadlift',
  'Trap Bar Deadlift',
  'Romanian Deadlift',
  'Romanian Deadlift (Light)',
  'Good Morning',
  'Power Clean',
  'Push Press',
  'Pendlay Row',
  'Bent-Over Row',
  'Pause Squat',
  'T-Bar Row',
  'Chest-Supported T-Bar Row',
  'Chest-Supported Row',
  'Arnold Press',
  'Renegade Row',
  'Overhead Triceps Extension',
  'Triceps Kickback',
  'Face Pull',
  'Reverse Pec Deck',
  'Reverse Hyperextension',
  'Muscle-Up Progression (Negative)',
  'Front Lever Tuck Hold',
  'Toes-to-Bar',
  'Rows (Bar or Rings)',
  'Battle Rope Slam',
  'Battle Rope Wave',
  'Battling Ropes',
  'Sled Push',
  'Medicine Ball Slam',
  'Box Jump',
  'Step-Up (High Box)',
  'Step-Up (Low Box)',
];

module.exports = [
  {
    name: 'equipmentExerciseFilter: lifts that need gear without naming it are refused to a reader with none',
    run() {
      const allowedBare = NEEDS_GEAR.filter((name) => isExerciseAllowedWithEquipment(name, []));
      assert.deepEqual(allowedBare, []);
      // And each one lands somewhere: a swap or an honest removal, never the
      // original lift left in place.
      const adjusted = applyEquipmentToExercises(NEEDS_GEAR.map(exercise), []);
      for (const item of adjusted.exercises) {
        assert.equal(isExerciseAllowedWithEquipment(item.exerciseName, []), true, item.exerciseName);
      }
    },
  },
  {
    name: 'equipmentExerciseFilter: an exact rule leaves the bodyweight version of the same words alone',
    run() {
      for (const name of ['Single-Leg Romanian Deadlift', 'Single-Leg RDL', 'Step-Up', 'Bodyweight Squat', 'Glute Bridge']) {
        assert.equal(isExerciseAllowedWithEquipment(name, []), true, name);
      }
      assert.equal(isExerciseAllowedWithEquipment('Deadlift', ['Barbells']), true);
      assert.equal(isExerciseAllowedWithEquipment('Romanian Deadlift (Light)', ['Dumbbells']), true);
      assert.equal(isExerciseAllowedWithEquipment('Romanian Deadlift', ['Dumbbells']), false);
    },
  },
  {
    name: 'equipmentExerciseFilter: a dumbbells-only home plan carries no bar, rope, sled or box work',
    run() {
      // Every ready programme, composed for the reader the hunt found it on:
      // a home setup with nothing but dumbbells.
      const available = ['Dumbbells'];
      let composedCount = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        let week;
        try {
          week = composeProgramWeekForSelection(
            {
              ...DEFAULT_FIRST_RUN_SELECTION,
              daysPerWeek: template.daysPerWeek,
              availableDays: [],
              scheduleMode: 'app_managed',
              trainingEnvironment: 'home_gym',
              equipmentItems: available,
            },
            template.id,
          );
        } catch (error) {
          // Seasons are dated events, not something onboarding recommends.
          if (/Unknown recommendation programme/.test(String(error))) continue;
          throw error;
        }
        if (!week) continue;
        composedCount += 1;
        for (const session of week.sessions) {
          for (const item of session.exercises) {
            assert.equal(
              isExerciseAllowedWithEquipment(item.exerciseName, available),
              true,
              `${template.id} ${session.name}: ${item.exerciseName}`,
            );
          }
        }
      }
      assert.ok(composedCount > 30, `only ${composedCount} programmes composed`);
    },
  },
  {
    name: 'equipmentExerciseFilter: chips are the truth, bodyweight setup means no equipment',
    run() {
      assert.deepEqual(resolveAvailableEquipment({ equipmentItems: ['Dumbbells'] }), ['Dumbbells']);
      assert.deepEqual(resolveAvailableEquipment({ trainingEnvironment: 'bodyweight_only', equipmentItems: [] }), []);
      assert.equal(resolveAvailableEquipment({ trainingEnvironment: 'full_gym', equipmentItems: [] }), null);
    },
  },
  {
    name: 'equipmentExerciseFilter: requirement groups gate exercises correctly',
    run() {
      assert.equal(isExerciseAllowedWithEquipment('Barbell Bench Press', null), true);
      assert.equal(isExerciseAllowedWithEquipment('Dumbbell Curl', ['Dumbbells']), true);
      assert.equal(isExerciseAllowedWithEquipment('Barbell Curl', ['Dumbbells']), false);
      // Bench press needs a bench AND a barbell.
      assert.equal(isExerciseAllowedWithEquipment('Bench Press', ['Bench']), false);
      assert.equal(isExerciseAllowedWithEquipment('Bench Press', ['Bench', 'Barbells']), true);
      assert.equal(isExerciseAllowedWithEquipment('Back Squat', ['Barbells']), false);
      assert.equal(isExerciseAllowedWithEquipment('Back Squat', ['Barbells', 'Squat rack']), true);
      assert.equal(isExerciseAllowedWithEquipment('Push-Up Wide', []), true);
    },
  },
  {
    name: 'equipmentExerciseFilter: unmet gear swaps to the best allowed fallback',
    run() {
      const dumbbellsOnly = applyEquipmentToExercises(
        [exercise('Barbell Bench Press'), exercise('Back Squat'), exercise('Lat Pulldown')],
        ['Dumbbells', 'Bench'],
      );
      assert.deepEqual(
        dumbbellsOnly.exercises.map((entry) => entry.exerciseName),
        ['Dumbbell Floor Press', 'Goblet Squat', 'Inverted Row'],
      );

      const nothing = applyEquipmentToExercises([exercise('Barbell Bench Press')], []);
      assert.deepEqual(
        nothing.exercises.map((entry) => entry.exerciseName),
        ['Push-Up Wide'],
      );
      assert.equal(nothing.exercises[0].trackingMode, 'bodyweight');
    },
  },
  {
    name: 'equipmentExerciseFilter: a hammer curl needs an actual dumbbell, not a band',
    run() {
      // "Hammer" names a neutral-grip hold on a dumbbell — the library files
      // "Alternate Hammer Curl" under Dumbbell equipment. The generic 'curl'
      // rule treats Resistance bands as sufficient for any curl, which let it
      // through for a bands-only reader with a kg dial and no dumbbell in
      // their setup (#bugs, 2026-09-26).
      assert.equal(isExerciseAllowedWithEquipment('Alternate Hammer Curl', ['Resistance bands']), false);
      assert.equal(isExerciseAllowedWithEquipment('Alternate Hammer Curl', ['Dumbbells']), true);

      const bandsOnly = applyEquipmentToExercises([exercise('Alternate Hammer Curl')], ['Resistance bands']);
      // The band curl (2026-09-26) is its honest substitute: reps only, no
      // weight dial a band cannot serve. Before it existed the lift was
      // removed.
      assert.deepEqual(
        bandsOnly.exercises.map((entry) => [entry.exerciseName, entry.trackingMode]),
        [['Band Curl', 'bodyweight']],
      );
      assert.deepEqual(bandsOnly.removed, []);
      // And the band curl needs the band: dumbbells alone do not stand in.
      assert.equal(isExerciseAllowedWithEquipment('Band Curl', ['Dumbbells']), false);
      assert.equal(isExerciseAllowedWithEquipment('Band Curl', ['Resistance bands']), true);
    },
  },
  {
    name: 'equipmentExerciseFilter: a bands-only composed week never asks for a hammer curl',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) => entry.daysPerWeek >= 3);
      assert.ok(template);

      const week = composeProgramWeekForSelection(
        {
          ...DEFAULT_FIRST_RUN_SELECTION,
          daysPerWeek: template.daysPerWeek,
          availableDays: [],
          scheduleMode: 'app_managed',
          equipmentItems: ['Resistance bands'],
          focusAreas: ['arms'],
        },
        template.id,
      );

      assert.ok(week);
      const names = week.sessions.flatMap((sessionEntry) => sessionEntry.exercises.map((item) => item.exerciseName));
      assert.equal(names.includes('Alternate Hammer Curl'), false);
    },
  },
  {
    name: 'equipmentExerciseFilter: composed week never demands missing gear',
    run() {
      const template = WORKOUT_TEMPLATES_V1.find((entry) =>
        entry.sessions.some((sessionEntry) =>
          sessionEntry.exercises.some((item) => item.exerciseName.toLowerCase().includes('barbell')),
        ),
      );
      assert.ok(template, 'catalog should contain barbell work');

      const available = ['Dumbbells', 'Bench', 'Resistance bands'];
      const week = composeProgramWeekForSelection(
        {
          ...DEFAULT_FIRST_RUN_SELECTION,
          // At home: a gym reads in the pull-up bar and bands every gym has
          // (2026-10-05), and this asks what these three chips alone allow.
          trainingEnvironment: 'home_gym',
          daysPerWeek: template.daysPerWeek,
          availableDays: [],
          scheduleMode: 'app_managed',
          equipmentItems: available,
        },
        template.id,
      );

      assert.ok(week);
      assert.ok(week.equipmentSwapped.length + week.equipmentRemoved.length > 0);
      for (const sessionEntry of week.sessions) {
        for (const item of sessionEntry.exercises) {
          assert.equal(
            isExerciseAllowedWithEquipment(item.exerciseName, available),
            true,
            `${item.exerciseName} should be doable with ${available.join(', ')}`,
          );
        }
      }
    },
  },
  {
    name: 'equipment filter: substring rules do not refuse bodyweight work with a gear word in its name',
    run() {
      const { resolveProgramEquipment } = require('../../.test-dist/lib/programEquipment');
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary');
      const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary');
      const falseRefusals = [
        'IT Band and Glute Stretch',
        'Nordic Hamstring Curl (Assisted)',
        'Lower Back Curl',
        'Hip Thrust (Bodyweight)',
        'Hip Thrust (Bodyweight or Light Bar)',
      ];
      for (const name of falseRefusals) {
        assert.equal(isExerciseAllowedWithEquipment(name, []), true, name);
        // The programme page reads the same table forwards and must agree.
        assert.deepEqual(resolveProgramEquipment([name]), [], name);
      }
      // Real loaded and banded lifts stay refused.
      for (const name of ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Wrist Curl', 'Leg Curl', 'Band Pull Apart', 'Banded Glute Bridge', 'Hip Thrust', 'Single-Leg Hip Thrust', 'Banded Hip Thrust', 'Band Curl']) {
        assert.equal(isExerciseAllowedWithEquipment(name, []), false, name);
      }
      // Sweep: no catalog or library name that says bodyweight or stretch, or
      // is one of the unloaded curls, is refused when the reader owns nothing.
      const names = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) for (const item of session.exercises) names.add(item.exerciseName);
      }
      for (const item of [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]) names.add(item.name);
      const wrong = [...names].filter(
        (name) =>
          /bodyweight|stretch|nordic|lower back curl|\bit band\b/i.test(name) && !isExerciseAllowedWithEquipment(name, []),
      );
      assert.deepEqual(wrong, []);
    },
  },
  {
    name: 'equipment filter: the stair machine needs a cardio machine and falls back to walking',
    run() {
      for (const name of ['Stairmaster (Moderate)', 'Stairmaster', 'Stair Climber']) {
        assert.equal(isExerciseAllowedWithEquipment(name, []), false, name);
        assert.equal(isExerciseAllowedWithEquipment(name, ['Dumbbells']), false, name);
        assert.equal(isExerciseAllowedWithEquipment(name, ['Cardio machines']), true, name);
        assert.equal(isExerciseAllowedWithEquipment(name, ['Machines']), true, name);
      }
      const adjusted = applyEquipmentToExercises([exercise('Stairmaster (Moderate)')], []);
      assert.deepEqual(adjusted.removed, []);
      assert.equal(adjusted.exercises[0].exerciseName, 'Trail Running/Walking');
    },
  },
];
