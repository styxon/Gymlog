const assert = require('node:assert/strict');

const { createFakeAsyncStorage, loadAgainstFake } = require('../../storage/fakeAsyncStorage.cjs');
const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState.js');
const { getWorkoutTemplateById } = require('../../../.test-dist/features/workout/workoutCatalog.js');
const { buildReadySessionRuntimeTemplate } = require('../../../.test-dist/lib/programDetails.js');
const { applySessionAdaptation } = require('../../../.test-dist/lib/sessionAdaptation.js');
const { doseAfterSwap } = require('../../../.test-dist/lib/swapDose.js');

const persistence = loadAgainstFake(createFakeAsyncStorage(), (req) => req('features/workout/workoutPersistence.js'));

/**
 * The programme's own lift picked back in the player is the slot as the
 * programme wrote it (final hunt, 2026-10-08, #17).
 *
 * The swap converts the sets still ahead into the incoming lift's unit, and
 * the original numbers went with it: Back Squat 3×8 swapped to a plank (45 s)
 * and back opened at 7 reps, the programmes' median for a squat, and Leg Press
 * 3×10 came back at 12. Home never lost them — picking the programme's lift
 * back there drops the held swap (withSessionSwap). Every other swap keeps the
 * one rule (doseAfterSwap).
 */

const T0 = Date.parse('2026-10-08T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };
const SQUAT_SLOT = 'tpl_3_day_full_body_v1:full_body_a:primary_squat_1';

function readyDay(sessionIndex, adaptation) {
  const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
  const runtime = buildReadySessionRuntimeTemplate(template, template.sessions[sessionIndex].id);
  return adaptation ? applySessionAdaptation(runtime, adaptation) : runtime;
}

function start(runtime) {
  return workoutReducer(FRESH, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: runtime, sessionOrderIndex: 1, unitPreference: 'kg' },
  });
}

function log(state, slotId, setIndex, kg, reps) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText: String(kg), repsText: String(reps) } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: T0 + setIndex * 120000, unitPreference: 'kg' },
  });
}

function swap(state, slotId, exerciseName) {
  const exercise = slotOf(state, slotId);
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
  });
}

function slotOf(state, slotId) {
  return state.activeSession.exercises.find((item) => item.slotId === slotId);
}

/** The slot's mode and each set as status:min-max. */
function shape(state, slotId) {
  const exercise = slotOf(state, slotId);
  return [
    exercise.exerciseName,
    exercise.trackingMode,
    exercise.sets.map((set) => `${set.status}:${set.plannedRepsMin}-${set.plannedRepsMax}`).join(' | '),
  ];
}

function reload(state) {
  const bundle = persistence.normalizeWorkoutBundle(
    JSON.parse(JSON.stringify({ activeSession: state.activeSession, history: state.history })),
  );
  return { ...state, activeSession: bundle.activeSession };
}

module.exports = [
  {
    name: 'swap back: Back Squat 3x8 swapped to a plank and back opens its pending sets at 8, as a loaded lift',
    run() {
      let state = start(readyDay(0));
      state = log(state, SQUAT_SLOT, 0, 60, 8);
      state = swap(state, SQUAT_SLOT, 'Plank');
      assert.deepEqual(shape(state, SQUAT_SLOT), ['Plank', 'hold', 'completed:8-8 | pending:45-45 | pending:45-45']);
      state = swap(state, SQUAT_SLOT, 'Back Squat');
      assert.deepEqual(shape(state, SQUAT_SLOT), [
        'Back Squat',
        'load_and_reps',
        'completed:8-8 | pending:8-8 | pending:8-8',
      ]);
    },
  },
  {
    name: 'swap back: Leg Press 3x10 through a bike bout and back is 10 again, with nothing logged',
    run() {
      const slot = 'tpl_3_day_full_body_v1:full_body_b:primary_squat_1';
      let state = start(readyDay(1));
      state = swap(state, slot, 'Stationary Bike (Easy Pace)');
      assert.equal(slotOf(state, slot).trackingMode, 'duration_minutes');
      state = swap(state, slot, 'Leg Press');
      assert.deepEqual(shape(state, slot), ['Leg Press', 'load_and_reps', 'pending:10-10 | pending:10-10 | pending:10-10']);
    },
  },
  {
    name: 'swap back: the programme lift is found however it is cased, and across a chain of swaps',
    run() {
      let state = start(readyDay(0));
      state = swap(state, SQUAT_SLOT, 'Goblet Squat');
      state = swap(state, SQUAT_SLOT, 'Plank');
      state = swap(state, SQUAT_SLOT, ' back squat ');
      assert.deepEqual(shape(state, SQUAT_SLOT).slice(1), ['load_and_reps', 'pending:8-8 | pending:8-8 | pending:8-8']);
    },
  },
  {
    name: 'swap back: any other lift still takes the one swap rule (doseAfterSwap), not the programme numbers',
    run() {
      let state = start(readyDay(0));
      state = swap(state, SQUAT_SLOT, 'Plank');
      state = swap(state, SQUAT_SLOT, 'Leg Press');
      const expected = doseAfterSwap({ trackingMode: 'hold', sets: 3, repsMin: 45, repsMax: 45 }, 'Leg Press');
      assert.deepEqual(shape(state, SQUAT_SLOT).slice(1), [
        expected.trackingMode,
        Array(3).fill(`pending:${expected.repsMin}-${expected.repsMax}`).join(' | '),
      ]);
      // And the guard is not vacuous: the median for Leg Press is not the squat's 8.
      assert.notEqual(expected.repsMin, 8);
    },
  },
  {
    name: "swap back: a session started on Home's held swap returns to the programme's dose when its lift is picked back",
    run() {
      let state = start(readyDay(0, { swaps: { primary_squat_1: 'Plank' }, drops: [] }));
      assert.deepEqual(shape(state, SQUAT_SLOT).slice(0, 2), ['Plank', 'hold']);
      state = swap(state, SQUAT_SLOT, 'Back Squat');
      assert.deepEqual(shape(state, SQUAT_SLOT), [
        'Back Squat',
        'load_and_reps',
        'pending:8-8 | pending:8-8 | pending:8-8',
      ]);
    },
  },
  {
    name: 'swap back: the programme dose survives a reload, and a malformed stored one is dropped, not trusted',
    run() {
      let state = start(readyDay(0));
      state = swap(state, SQUAT_SLOT, 'Plank');
      state = reload(state);
      state = swap(state, SQUAT_SLOT, 'Back Squat');
      assert.deepEqual(shape(state, SQUAT_SLOT).slice(1), ['load_and_reps', 'pending:8-8 | pending:8-8 | pending:8-8']);

      for (const broken of [
        { trackingMode: 'jumping', repsMin: 8, repsMax: 8 },
        { trackingMode: 'load_and_reps', repsMin: '8', repsMax: 8 },
        { trackingMode: 'load_and_reps', repsMin: 9, repsMax: 8 },
        { trackingMode: 'load_and_reps', repsMin: -1, repsMax: 8 },
        'eight',
        null,
      ]) {
        let stored = swap(start(readyDay(0)), SQUAT_SLOT, 'Plank');
        stored = {
          ...stored,
          activeSession: {
            ...stored.activeSession,
            exercises: stored.activeSession.exercises.map((exercise) =>
              exercise.slotId === SQUAT_SLOT ? { ...exercise, programmedDose: broken } : exercise,
            ),
          },
        };
        const loaded = reload(stored);
        assert.equal(slotOf(loaded, SQUAT_SLOT).programmedDose, undefined, JSON.stringify(broken));
        // Without it the swap back still works, on the one rule.
        const back = swap(loaded, SQUAT_SLOT, 'Back Squat');
        assert.equal(slotOf(back, SQUAT_SLOT).trackingMode, 'load_and_reps');
      }
    },
  },
];
