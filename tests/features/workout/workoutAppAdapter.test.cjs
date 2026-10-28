const assert = require('node:assert/strict');

const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../../src/features/workout/workoutAppAdapter');
const { createCompletedSession, createExercise, createSet } = require('../../helpers/workoutFixtures.cjs');
const {
  adaptLegacyWorkoutTemplateToRuntimeTemplate,
} = require('../../../src/features/workout/customWorkoutAdapter');

module.exports = [
  {
    name: 'adapter exposes a stable bridge contract with deterministic exercise and set ordering',
    run() {
      const session = createCompletedSession({
        exercises: [
          createExercise({
            templateExerciseId: 'upper_b_overhead_press',
            slotId: 'tpl_4_day_upper_lower_v1:upper_b:primary_press_1',
            exerciseName: 'Overhead Press',
            orderIndex: 2,
            sets: [
              createSet({ setIndex: 1, actualLoadKg: 50, actualReps: 6, completedAt: '2026-03-19T10:24:00.000Z' }),
              createSet({ setIndex: 0, actualLoadKg: 47.5, actualReps: 8, completedAt: '2026-03-19T10:20:00.000Z' }),
            ],
          }),
          createExercise({
            templateExerciseId: 'upper_a_bench_press',
            exerciseName: 'Bench Press',
            orderIndex: 0,
            sets: [
              createSet({ setIndex: 2, actualLoadKg: 102.5, actualReps: 6, completedAt: '2026-03-19T10:18:00.000Z' }),
              createSet({ setIndex: 0, actualLoadKg: 95, actualReps: 8, completedAt: '2026-03-19T10:10:00.000Z' }),
              createSet({ setIndex: 1, actualLoadKg: 100, actualReps: 7, completedAt: '2026-03-19T10:14:00.000Z' }),
            ],
          }),
        ],
      });

      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);

      assert.deepEqual(
        adapted.exercises.map((exercise) => [exercise.orderIndex, exercise.exerciseName]),
        [
          [0, 'Bench Press'],
          [2, 'Overhead Press'],
        ],
      );
      assert.deepEqual(
        adapted.logs.map((log) => [log.orderIndex, log.exerciseNameSnapshot]),
        [
          [0, 'Bench Press'],
          [2, 'Overhead Press'],
        ],
      );
      assert.deepEqual(adapted.logs[0].sets.map((set) => set.orderIndex), [0, 1, 2]);
      assert.equal(adapted.logs[0].sets[2].weight, 102.5);
      assert.equal(adapted.performedAt, '2026-03-19T10:35:00.000Z');
      assert.deepEqual(adapted.legacyShapeMismatches, ['template_exercise_id_not_mapped']);
    },
  },
  {
    name: 'adapter preserves inserted exercises, notes, swaps, and non-completed set semantics',
    run() {
      const session = createCompletedSession({
        exercises: [
          createExercise({
            templateExerciseId: 'session_inserted_machine_press',
            exerciseName: 'Machine Chest Press',
            orderIndex: 0,
            sessionInserted: true,
            status: 'active',
            notes: 'Controlled eccentric on every rep',
            sets: [
              createSet({ setIndex: 2, status: 'pending', actualLoadKg: undefined, actualReps: undefined, completedAt: undefined, draftLoadText: '', draftRepsText: '' }),
              createSet({ setIndex: 0, actualLoadKg: 60, actualReps: 10, effort: 'good', completedAt: '2026-03-19T10:11:00.000Z' }),
              createSet({ setIndex: 1, status: 'skipped', actualLoadKg: undefined, actualReps: undefined, completedAt: undefined, draftLoadText: '', draftRepsText: '' }),
            ],
          }),
          createExercise({
            templateExerciseId: 'accessory_core_cable_crunch',
            exerciseName: 'Cable Crunch',
            progressionPriority: 'low',
            orderIndex: 2,
            status: 'active',
            sets: [
              createSet({ setIndex: 0, status: 'pending', actualLoadKg: undefined, actualReps: undefined, completedAt: undefined, draftLoadText: '', draftRepsText: '' }),
            ],
          }),
        ],
      });

      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);

      assert.equal(adapted.exercises[0].sessionInserted, true);
      assert.deepEqual(adapted.exercises[0].sets.map((set) => set.status), ['completed', 'skipped', 'pending']);
      assert.equal(adapted.logs.length, 2);
      assert.equal(adapted.logs[0].exerciseNameSnapshot, 'Machine Chest Press');
      assert.equal(adapted.logs[0].sessionInserted, true);
      assert.equal(adapted.logs[0].notes, 'Controlled eccentric on every rep');
      assert.deepEqual(adapted.logs[0].sets.map((set) => set.status), ['completed', 'skipped', 'pending']);
      assert.equal(adapted.logs[0].sets[0].effort, 'good');
      assert.equal(adapted.exercises[0].sets[0].effort, 'good');
      assert.deepEqual(adapted.legacyShapeMismatches, ['template_exercise_id_not_mapped']);
    },
  },
  {
    name: 'adapter tolerates missing optional values and falls back to session updatedAt',
    run() {
      const session = createCompletedSession({
        updatedAt: '2026-03-19T10:12:00.000Z',
        completedAt: undefined,
        exercises: [
          createExercise({
            templateExerciseId: 'pull_up_bodyweight',
            exerciseName: 'Pull-Up',
            trackingMode: 'bodyweight',
            sets: [
              createSet({
                setIndex: 0,
                plannedLoadKg: undefined,
                draftLoadText: '',
                actualLoadKg: undefined,
                actualReps: 12,
                completedAt: undefined,
              }),
            ],
          }),
        ],
      });

      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);

      assert.equal(adapted.performedAt, '2026-03-19T10:12:00.000Z');
      assert.equal(adapted.logs[0].sets[0].weight, 0);
      assert.equal(adapted.exercises[0].sets[0].performedAt, null);
    },
  },
  {
    /**
     * The emphasis sheet writes new set counts back by exercise id, and the id
     * it holds came through the detail view model from this adapter. If that
     * id ever stopped being the stored ExerciseTemplate's id, the save would
     * match nothing and do nothing — silently, with a success toast.
     */
    name: 'a custom runtime exercise keeps the stored template id it was built from',
    run() {
      const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
        { id: 'tpl_1', name: 'Oma ohjelma', exerciseIds: [], sessions: [], createdAt: '', updatedAt: '', origin: 'authored' },
        [
          {
            id: 'sess_1',
            workoutTemplateId: 'tpl_1',
            name: 'Day 1',
            orderIndex: 0,
            exerciseIds: ['ex_1'],
            exercises: [
              {
                id: 'ex_1',
                workoutTemplateId: 'tpl_1',
                workoutTemplateSessionId: 'sess_1',
                name: 'Back Squat',
                targetSets: 4,
                repMin: 5,
                repMax: 8,
                restSeconds: 120,
                trackedDefault: true,
                orderIndex: 0,
                libraryItemId: null,
              },
            ],
          },
        ],
        [],
        90,
      );

      const exercise = runtime.sessions[0].exercises[0];
      assert.equal(exercise.id, 'ex_1');
      assert.equal(exercise.persistedExerciseTemplateId, 'ex_1');
      // And the sets the emphasis card counts are the stored ones, not a
      // default — a card computed from a fallback would describe no programme.
      assert.equal(exercise.sets, 4);
    },
  },
];

