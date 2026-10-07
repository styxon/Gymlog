const assert = require('node:assert/strict');

const {
  getPopularExerciseLibraryItems,
  getPopularExerciseLibraryOrder,
} = require('../../.test-dist/lib/exerciseSuggestions.js');

const library = [
  { id: 'axle_deadlift', name: 'Axle Deadlift', category: 'compound', bodyPart: 'back', equipment: 'barbell' },
  { id: 'bench', name: 'Barbell Bench Press - Medium Grip', category: 'compound', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'squat', name: 'Barbell Squat', category: 'compound', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'deadlift', name: 'Barbell Deadlift', category: 'compound', bodyPart: 'back', equipment: 'barbell' },
  { id: 'pulldown', name: 'Wide-Grip Lat Pulldown', category: 'compound', bodyPart: 'back', equipment: 'cable' },
  { id: 'hip_thrust', name: 'Barbell Hip Thrust', category: 'compound', bodyPart: 'glutes', equipment: 'barbell' },
  { id: 'curl', name: 'Dumbbell Bicep Curl', category: 'isolation', bodyPart: 'biceps', equipment: 'dumbbell' },
  { id: 'press', name: 'Shoulder Press', category: 'compound', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'rdl', name: 'Romanian Deadlift', category: 'compound', bodyPart: 'legs', equipment: 'barbell' },
];

module.exports = [
  {
    name: 'popular exercise list balances beginner-friendly and core strength picks',
    run() {
      const popular = getPopularExerciseLibraryItems(library).map((item) => item.id);

      assert.deepEqual(popular, [
        'bench',
        'squat',
        'deadlift',
        'pulldown',
        'hip_thrust',
        'curl',
        'press',
        'rdl',
      ]);
    },
  },
  {
    name: 'popular exercise order ranks exact preferred variants before generic matches',
    run() {
      const order = getPopularExerciseLibraryOrder(library);

      assert.equal(order.get('deadlift'), 2);
      assert.equal(order.has('axle_deadlift'), false);
    },
  },
  {
    name: 'a popular seed resolves to the lift it names, not the first row that contains the words',
    run() {
      // Against the real library. "Lat Pulldown" used to pick Close-Grip
      // Front Lat Pulldown (Kapea ylätalja) and "Overhead Press" picked
      // Alternating Cable Shoulder Press, because a keyword match takes the
      // library's alphabet. The plain English label names the lift.
      const real = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];
      const names = getPopularExerciseLibraryItems(real).map((item) => item.name);
      assert.ok(names.includes('Wide-Grip Lat Pulldown'), names.join(', '));
      assert.ok(names.includes('Standing Military Press'), names.join(', '));
      assert.ok(!names.includes('Close-Grip Front Lat Pulldown'));
      assert.ok(!names.includes('Alternating Cable Shoulder Press'));
      assert.equal(names.length, 8);
    },
  },
  {
    name: 'a hold picked from the library opens in seconds a hold is held for, not a rep range (device walk 2026-10-05)',
    run() {
      const { getExerciseTemplateDefaults } = require('../../.test-dist/lib/exerciseSuggestions.js');
      const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');

      const plank = GENERATED_EXERCISE_LIBRARY.find((item) => item.name === 'Plank');
      assert.ok(plank, 'the library has a Plank');
      assert.equal(plank.category, 'core');

      const defaults = getExerciseTemplateDefaults(plank, 120);
      assert.equal(defaults.repMin, 30);
      assert.equal(defaults.repMax, 45);

      // The way "Build it yourself" stores it: trackingMode null, the
      // defaults as they came. The player reads the range as seconds.
      const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
        { id: 't', name: 'T', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' },
        [
          {
            id: 's',
            workoutTemplateId: 't',
            name: 'Day 1',
            orderIndex: 0,
            exercises: [
              {
                id: 'e',
                workoutTemplateSessionId: 's',
                libraryItemId: plank.id,
                name: plank.name,
                orderIndex: 0,
                trackingMode: null,
                ...defaults,
              },
            ],
          },
        ],
        GENERATED_EXERCISE_LIBRARY,
        120,
      );
      const exercise = runtime.sessions[0].exercises[0];
      assert.equal(exercise.trackingMode, 'hold');
      assert.ok(exercise.repsMin >= 20, `a plank held for ${exercise.repsMin} s`);

      // A crunch is core too, and stays a rep range.
      const crunch = GENERATED_EXERCISE_LIBRARY.find((item) => item.category === 'core' && /crunch/i.test(item.name));
      assert.equal(getExerciseTemplateDefaults(crunch, 120).repMax, 15);
    },
  },
  {
    name: 'a cardio machine picked from the library opens at one 20-minute bout, not 1 × 8-12 (bug hunt 2026-10-07)',
    run() {
      const { getExerciseTemplateDefaults } = require('../../.test-dist/lib/exerciseSuggestions.js');
      const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { isMinutesExerciseName, DEFAULT_MINUTES_PRESCRIPTION } = require('../../.test-dist/lib/minutesExercises.js');

      // Every library row the minutes list claims: Stairmaster, the rower, the
      // treadmills. Their defaults were the cardio category's 1 × 8-12, which
      // the player ran as 8-12 minutes; every other surface writes 1 × 20.
      const machines = GENERATED_EXERCISE_LIBRARY.filter((item) => isMinutesExerciseName(item.name));
      assert.equal(machines.length, 12, 'the library minutes rows');
      for (const item of machines) {
        const defaults = getExerciseTemplateDefaults(item, 120);
        assert.deepEqual(
          [defaults.targetSets, defaults.repMin, defaults.repMax, defaults.restSeconds],
          [DEFAULT_MINUTES_PRESCRIPTION.sets, DEFAULT_MINUTES_PRESCRIPTION.minutes, DEFAULT_MINUTES_PRESCRIPTION.minutes, 0],
          item.name,
        );
        const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
          { id: 't', name: 'T', createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' },
          [
            {
              id: 's',
              workoutTemplateId: 't',
              name: 'Day 1',
              orderIndex: 0,
              exercises: [
                {
                  id: 'e',
                  workoutTemplateSessionId: 's',
                  libraryItemId: item.id,
                  name: item.name,
                  orderIndex: 0,
                  trackingMode: null,
                  ...defaults,
                },
              ],
            },
          ],
          GENERATED_EXERCISE_LIBRARY,
          120,
        );
        const exercise = runtime.sessions[0].exercises[0];
        assert.equal(exercise.trackingMode, 'duration_minutes', item.name);
        assert.deepEqual([exercise.sets, exercise.repsMin, exercise.repsMax], [1, 20, 20], item.name);
      }

      // A cardio row that is not a bout of minutes keeps the category's numbers.
      const prowler = GENERATED_EXERCISE_LIBRARY.find((item) => item.name === 'Prowler Sprint');
      assert.ok(prowler && prowler.category === 'cardio');
      const sprint = getExerciseTemplateDefaults(prowler, 120);
      assert.deepEqual([sprint.targetSets, sprint.repMin, sprint.repMax], [1, 8, 12]);
    },
  },
];
