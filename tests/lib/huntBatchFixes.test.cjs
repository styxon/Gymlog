const assert = require('node:assert/strict');

const {
  workoutReducer,
  workoutInitialState,
} = require('../../.test-dist/features/workout/workoutState.js');
const {
  buildCompletionCardsFromAdaptedSession,
  buildSessionMovement,
} = require('../../.test-dist/app/workoutCompletionState.js');
const { withSupersetPartners } = require('../../.test-dist/lib/setCountChanges.js');
const { buildProgramWorkoutPlan, carryPlanLabels } = require('../../.test-dist/lib/programAdoption.js');
const { startKeepAwake } = require('../../.test-dist/lib/keepAwakeLifecycle.js');
const { tidySessionTitle } = require('../../.test-dist/lib/recoverySheet.js');
const { createCompletedSession } = require('../helpers/workoutFixtures.cjs');

function adapted(exerciseName, trackingMode, weightKg, reps) {
  return {
    slotId: `slot_${exerciseName}`,
    exerciseName,
    persistedExerciseTemplateId: null,
    tracked: true,
    trackingMode,
    notes: null,
    sets: [{ orderIndex: 0, status: 'completed', weightKg, reps }],
  };
}

const { buildExercisePrLookup } = require('../../.test-dist/lib/workoutCompletionSummary.js');

const NO_PR_LOOKUP = buildExercisePrLookup({ exerciseLogs: [], workoutSessions: [], exerciseTemplates: [] });

module.exports = [
  // 17
  {
    name: 'a lift inserted mid-workout opens at the weight it was last done at',
    run() {
      const activeSession = createCompletedSession({ status: 'active', completedAt: undefined, exercises: [] });
      const history = {
        sessions: [],
        lastSelectedTemplateId: null,
        slotHistory: {
          'tpl_other:day_2:legs_1': [
            {
              slotId: 'tpl_other:day_2:legs_1',
              templateId: 'tpl_other',
              templateName: 'Other plan',
              exerciseName: 'Front Squat',
              substitutionGroup: 'squat_pattern',
              performedAt: '2026-07-12T09:00:00.000Z',
              sessionId: 'session_x',
              sets: [{ setIndex: 0, loadKg: 65, reps: 8, completedAt: '2026-07-12T09:05:00.000Z' }],
              skipped: false,
            },
          ],
        },
      };
      const next = workoutReducer(
        { ...workoutInitialState, history, activeSession },
        {
          type: 'exercise/insertAfter',
          payload: {
            afterSlotId: null,
            unitPreference: 'kg',
            exercise: {
              exerciseName: 'Front Squat',
              trackingMode: 'load_and_reps',
              sets: 2,
              repsMin: 6,
              repsMax: 10,
              restSecondsMin: 60,
              restSecondsMax: 90,
              substitutionGroup: 'squat_pattern',
            },
          },
        },
      );
      const inserted = next.activeSession.exercises[0];
      assert.equal(inserted.sets[0].draftLoadText, '65');
      assert.equal(inserted.sets[0].plannedLoadKg, 65);
      assert.equal(inserted.sets[0].prefilledFromPerformedAt, '2026-07-12T09:00:00.000Z');
      assert.equal(inserted.sessionInserted, true);
    },
  },
  {
    name: 'a lift inserted mid-workout with no history still opens empty',
    run() {
      const activeSession = createCompletedSession({ status: 'active', completedAt: undefined, exercises: [] });
      const next = workoutReducer(
        { ...workoutInitialState, activeSession },
        {
          type: 'exercise/insertAfter',
          payload: {
            afterSlotId: null,
            exercise: {
              exerciseName: 'Front Squat',
              trackingMode: 'load_and_reps',
              sets: 1,
              repsMin: 6,
              repsMax: 10,
              restSecondsMin: 60,
              restSecondsMax: 90,
              substitutionGroup: 'squat_pattern',
            },
          },
        },
      );
      assert.equal(next.activeSession.exercises[0].sets[0].draftLoadText, '');
    },
  },

  // 18
  {
    name: 'a weighted hold and a minutes lift get no PR card and no movement row',
    run() {
      const exercises = [adapted('Plank', 'hold', 10, 60), adapted('Stairmaster', 'duration_minutes', 0, 20)];
      const { prCards } = buildCompletionCardsFromAdaptedSession({
        exercises,
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: NO_PR_LOOKUP,
        language: 'en',
      });
      assert.equal(prCards.length, 0);
      const movement = buildSessionMovement({
        exercises,
        exerciseLogs: [],
        workoutSessions: [],
        sessionId: 's',
        language: 'en',
        unitPreference: 'kg',
      });
      assert.deepEqual(movement.movementById, {});
      assert.equal(movement.whatMoved.length, 0);
    },
  },
  {
    name: 'a loaded lift still earns its PR card',
    run() {
      const { prCards } = buildCompletionCardsFromAdaptedSession({
        exercises: [adapted('Bench Press', 'load_and_reps', 100, 5)],
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: NO_PR_LOOKUP,
        language: 'en',
      });
      assert.equal(prCards.length, 1);
    },
  },

  // 19
  {
    name: 'an emphasis save keeps a superset pair at one set count',
    run() {
      const sessions = [
        {
          exercises: [
            { id: 'a', name: 'A', targetSets: 3, supersetGroup: 'g' },
            { id: 'b', name: 'B', targetSets: 3, supersetGroup: 'g' },
            { id: 'c', name: 'C', targetSets: 3, supersetGroup: null },
          ],
        },
      ];
      const counts = withSupersetPartners(sessions, new Map([['a', 4]]));
      assert.equal(counts.get('a'), 4);
      assert.equal(counts.get('b'), 4);
      assert.equal(counts.has('c'), false);
      // Only the second half named: it decides, the first follows.
      const fromSecond = withSupersetPartners(sessions, new Map([['b', 5]]));
      assert.equal(fromSecond.get('a'), 5);
      assert.equal(fromSecond.get('b'), 5);
    },
  },

  // 27
  {
    name: 'keep-awake released before activation settles still deactivates',
    async run() {
      let resolveActivate;
      let deactivated = 0;
      const handle = startKeepAwake(
        () => new Promise((resolve) => (resolveActivate = resolve)),
        () => {
          deactivated += 1;
        },
      );
      handle.release();
      assert.equal(deactivated, 0);
      resolveActivate();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(deactivated, 1);
      handle.release();
      assert.equal(deactivated, 1);
    },
  },
  {
    name: 'keep-awake released after activation deactivates once, and a failed activation never throws',
    async run() {
      let deactivated = 0;
      const handle = startKeepAwake(
        () => Promise.resolve(),
        () => {
          deactivated += 1;
        },
      );
      await new Promise((resolve) => setImmediate(resolve));
      handle.release();
      assert.equal(deactivated, 1);
      const failing = startKeepAwake(
        () => Promise.reject(new Error('no native module')),
        () => {
          deactivated += 1;
        },
      );
      await new Promise((resolve) => setImmediate(resolve));
      failing.release();
      assert.equal(deactivated, 1);
    },
  },

  // 28
  {
    name: 'a copy of a held programme keeps the original plan weekday labels',
    run() {
      const original = buildProgramWorkoutPlan({
        planId: 'ready_plan',
        workoutTemplateId: 't1',
        programName: 'P',
        sessionIds: ['s1', 's2', 's3'],
        dayLabels: ['tue', 'thu', 'sat'],
        now: '2026-10-01T00:00:00.000Z',
      });
      const copy = buildProgramWorkoutPlan({
        planId: 'custom_plan_t2',
        workoutTemplateId: 't2',
        programName: 'P',
        sessionIds: ['n1', 'n2', 'n3'],
        dayLabels: ['mon', 'wed', 'fri'],
        now: '2026-10-01T00:00:00.000Z',
      });
      const carried = carryPlanLabels(copy, original);
      assert.deepEqual(
        carried.entries.map((entry) => entry.label),
        ['tue', 'thu', 'sat'],
      );
      assert.deepEqual(
        carried.entries.map((entry) => entry.workoutTemplateSessionId),
        ['n1', 'n2', 'n3'],
      );
      assert.equal(carryPlanLabels(copy, null), copy);
      const shorter = buildProgramWorkoutPlan({
        planId: 'p3',
        workoutTemplateId: 't3',
        programName: 'P',
        sessionIds: ['x1', 'x2'],
        dayLabels: ['mon', 'wed'],
        now: '2026-10-01T00:00:00.000Z',
      });
      assert.equal(carryPlanLabels(shorter, original), shorter);
    },
  },

  // 35
  {
    name: 'tidySessionTitle sets a glued day number apart and leaves other titles alone',
    run() {
      assert.equal(tidySessionTitle('Legs1', 'en'), 'Legs 1');
      assert.equal(tidySessionTitle('Jalat1', 'fi'), 'Jalat 1');
      assert.equal(tidySessionTitle('Squat 5x5', 'en'), 'Squat 5x5');
      assert.equal(tidySessionTitle('HIIT 20', 'en'), 'HIIT 20');
      assert.equal(tidySessionTitle('5x5', 'en'), '5x5');
      assert.equal(tidySessionTitle('  ', 'en'), null);
    },
  },
];
