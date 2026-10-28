const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../../src/features/workout/workoutState');
const { getWorkoutTemplateById } = require('../../../src/features/workout/workoutCatalog');
const { buildReadySessionRuntimeTemplate } = require('../../../src/lib/programDetails');

/**
 * "Repeat last set" must not reach across a swap for its source (2026-09-26).
 *
 * A slot swapped mid-exercise keeps the sets logged before it — they belong to
 * the lift that was actually lifted (see lib/liftSegments, swap audit
 * 2026-09-21) — but they are not a "last set" of the lift the slot holds now.
 * Copying one anyway handed a freshly swapped-in lift the OLD lift's weight:
 * three sets of back squat at 100 kg, a swap to a banded squat, and "repeat
 * last set" on its first set copied 100 kg into a lift nobody had loaded yet.
 */

const T0 = Date.parse('2026-09-21T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };

function start(runtime, state = FRESH, orderIndex = 1) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: runtime, sessionOrderIndex: orderIndex, unitPreference: 'kg' },
  });
}

function readyDay(templateId, sessionIndex) {
  const template = getWorkoutTemplateById(templateId);
  return buildReadySessionRuntimeTemplate(template, template.sessions[sessionIndex].id);
}

function log(state, slotId, setIndex, kg, reps, atMs = T0 + setIndex * 120000) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText: kg === null ? '' : String(kg), repsText: String(reps) } },
  });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId, setIndex, nowMs: atMs, unitPreference: 'kg' } });
}

function swap(state, slotId, exerciseName) {
  const exercise = state.activeSession.exercises.find((item) => item.slotId === slotId);
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
  });
}

function repeatLast(state, slotId, setIndex, nowMs) {
  return workoutReducer(state, { type: 'set/repeatLast', payload: { slotId, setIndex, nowMs, unitPreference: 'kg' } });
}

module.exports = [
  {
    name: 'repeat last set refuses to copy a set logged before the swap',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];

      state = log(state, squat.slotId, 0, 100, 5);
      state = swap(state, squat.slotId, 'Squats - With Bands');

      state = repeatLast(state, squat.slotId, 1, T0 + 500000);
      const exercise = state.activeSession.exercises.find((item) => item.slotId === squat.slotId);
      const target = exercise.sets.find((item) => item.setIndex === 1);

      // No completed set of the CURRENT lift exists yet, so the action is a
      // no-op — same as "repeat last" on a lift's very first set. It must
      // never borrow the old lift's 100 kg.
      assert.equal(target.status, 'pending');
      assert.equal(target.actualLoadKg, undefined);
    },
  },
  {
    name: 'repeat last set still copies a set logged after the swap',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];

      state = log(state, squat.slotId, 0, 100, 5);
      state = swap(state, squat.slotId, 'Squats - With Bands');
      state = log(state, squat.slotId, 1, 40, 10);

      state = repeatLast(state, squat.slotId, 2, T0 + 700000);
      const exercise = state.activeSession.exercises.find((item) => item.slotId === squat.slotId);
      const target = exercise.sets.find((item) => item.setIndex === 2);

      assert.equal(target.status, 'completed');
      assert.equal(target.actualLoadKg, 40);
      assert.equal(target.actualReps, 10);
    },
  },
  {
    name: 'repeat last set still works ordinarily with no swap involved',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];

      state = log(state, squat.slotId, 0, 100, 5);
      state = repeatLast(state, squat.slotId, 1, T0 + 500000);
      const exercise = state.activeSession.exercises.find((item) => item.slotId === squat.slotId);
      const target = exercise.sets.find((item) => item.setIndex === 1);

      assert.equal(target.status, 'completed');
      assert.equal(target.actualLoadKg, 100);
      assert.equal(target.actualReps, 5);
    },
  },
];
