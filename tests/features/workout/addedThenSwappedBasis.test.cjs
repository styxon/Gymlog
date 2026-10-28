const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../../src/features/workout/workoutState');
const { getWorkoutTemplateById } = require('../../../src/features/workout/workoutCatalog');
const { buildReadySessionRuntimeTemplate } = require('../../../src/lib/programDetails');
const { buildLoggedSetPlan } = require('../../../src/lib/loggedSetPlan');

/**
 * A set the reader added and then swapped away is not "their own number"
 * (#247 follow-up, 2026-10-02).
 *
 * loggedSetPlan reads `addedMidSession` first, so the set saved as `added`
 * even after a swap had re-resolved it from the new lift's own history — a
 * weight the APP put there, recorded as the reader's. The file header says a
 * swap re-resolves the set to `borrowed`, or `none`. A set added after the
 * swap, and an added set no swap touched, are still the reader's.
 */

const T0 = Date.parse('2026-09-21T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };

function start(runtime, state = FRESH) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: runtime, sessionOrderIndex: 1, unitPreference: 'kg' },
  });
}

function readyDay(templateId, sessionIndex) {
  const template = getWorkoutTemplateById(templateId);
  return buildReadySessionRuntimeTemplate(template, template.sessions[sessionIndex].id);
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

function addSet(state, slotId) {
  return workoutReducer(state, { type: 'exercise/addSet', payload: { slotId } });
}

function swap(state, slotId, exerciseName) {
  const exercise = state.activeSession.exercises.find((item) => item.slotId === slotId);
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
  });
}

function withHistory(state, exerciseName, loadKg) {
  return {
    ...state,
    history: {
      ...state.history,
      slotHistory: {
        ...state.history.slotHistory,
        history_slot: [
          {
            slotId: 'history_slot',
            templateId: 'tpl_other',
            templateName: 'Other',
            exerciseName,
            substitutionGroup: 'g',
            performedAt: '2026-09-10T09:00:00.000Z',
            sessionId: 'old_session',
            skipped: false,
            sets: [0, 1, 2, 3, 4, 5].map((setIndex) => ({
              setIndex,
              loadKg,
              reps: 8,
              completedAt: '2026-09-10T09:10:00.000Z',
            })),
          },
        ],
      },
    },
  };
}

function lastSet(state, slotId) {
  const exercise = state.activeSession.exercises.find((item) => item.slotId === slotId);
  return exercise.sets[exercise.sets.length - 1];
}

module.exports = [
  {
    name: 'an added set that a swap re-resolves from the new lift\'s history is saved as borrowed, not added',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      state = log(state, slotId, 0, 60, 8);
      state = addSet(state, slotId);
      assert.equal(buildLoggedSetPlan(lastSet(state, slotId)).basis, 'added', 'untouched by a swap it is the reader\'s');

      state = swap(withHistory(state, 'Leg Press', 50), slotId, 'Leg Press');
      const set = lastSet(state, slotId);
      assert.equal(set.status, 'pending');
      assert.equal(set.plannedLoadKg, 50, 'the app opened it at the new lift\'s own weight');
      assert.equal(buildLoggedSetPlan(set).basis, 'borrowed');
    },
  },
  {
    name: 'an added set that a swap leaves with no history is saved as none, not added',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      state = log(state, slotId, 0, 60, 8);
      state = addSet(state, slotId);
      state = swap(state, slotId, 'Leg Press');
      const set = lastSet(state, slotId);
      assert.equal(set.plannedLoadKg, undefined);
      assert.equal(buildLoggedSetPlan(set).basis, 'none');
    },
  },
  {
    name: 'a set added after the swap is still the reader\'s own (added)',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      state = swap(state, slotId, 'Leg Press');
      state = addSet(state, slotId);
      assert.equal(buildLoggedSetPlan(lastSet(state, slotId)).basis, 'added');
    },
  },
];
