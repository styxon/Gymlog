const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState.js');
const { resolveGuidedSetTarget } = require('../../../.test-dist/lib/guidedPlayer.js');
const { doseAfterSwap } = require('../../../.test-dist/lib/swapDose.js');

/**
 * A set logged before a swap and taken back is done again as the lift the
 * slot holds now (re-hunt R3, 2026-10-07).
 *
 * The player's Back on the new lift's first set takes back the last set logged
 * before the swap. The set went back to pending with the old lift's plan: a
 * back squat swapped for a leg press reopened at the squat's 100 kg, one
 * swapped for a plank asked for an 8-second hold, and the swap's line stayed
 * where it was, so the set logged again as the leg press did not carry its
 * weight to the next set.
 */

const T0 = Date.parse('2026-10-07T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };

function historyEntry(slotId, exerciseName, loadKg, reps) {
  return {
    slotId,
    templateId: 'tpl_other',
    templateName: 'Other',
    exerciseName,
    substitutionGroup: 'g',
    performedAt: '2026-09-30T09:00:00.000Z',
    sessionId: `old_${slotId}`,
    skipped: false,
    sets: [0, 1, 2].map((setIndex) => ({ setIndex, loadKg, reps, completedAt: '2026-09-30T09:10:00.000Z' })),
  };
}

function start(history = {}) {
  const state = {
    ...FRESH,
    history: { sessions: [], slotHistory: history, lastSelectedTemplateId: null },
  };
  const template = {
    id: 't',
    name: 'T',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'd',
        name: 'D',
        orderIndex: 0,
        exercises: [
          {
            id: 'squat',
            slotId: 'squat',
            exerciseName: 'Back Squat',
            role: 'primary',
            progressionPriority: 'high',
            trackingMode: 'load_and_reps',
            sets: 3,
            repsMin: 8,
            repsMax: 8,
            restSecondsMin: 90,
            restSecondsMax: 90,
            substitutionGroup: 'g',
          },
        ],
      },
    ],
  };
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template, sessionOrderIndex: 1, unitPreference: 'kg' },
  });
}

const slotOf = (state) => state.activeSession.exercises[0].slotId;
const exerciseOf = (state) => state.activeSession.exercises[0];
const setOf = (state, setIndex) => exerciseOf(state).sets.find((set) => set.setIndex === setIndex);

function log(state, setIndex, loadText, repsText, step = 1) {
  const slotId = slotOf(state);
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText, repsText } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: T0 + step * 120000, unitPreference: 'kg' },
  });
}

function swap(state, exerciseName) {
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId: slotOf(state), exerciseName, substitutionGroup: 'g', unitPreference: 'kg' },
  });
}

function undo(state, setIndex) {
  return workoutReducer(state, {
    type: 'set/undo',
    payload: { slotId: slotOf(state), setIndex, unitPreference: 'kg' },
  });
}

/** What the player shows for one set, read as the screen reads it. */
function targetOf(state, setIndex) {
  const exercise = exerciseOf(state);
  return resolveGuidedSetTarget(exercise.sets, setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex);
}

const HISTORY = {
  old_squat: [historyEntry('old_squat', 'Back Squat', 100, 8)],
  old_press: [historyEntry('old_press', 'Leg Press', 150, 8)],
};

module.exports = [
  {
    name: 'a squat set taken back after a swap to the leg press reopens on the leg press\'s weight, not the squat\'s',
    run() {
      let state = start(HISTORY);
      assert.equal(setOf(state, 0).plannedLoadKg, 100, 'precondition: the squat opens on its own last time');
      state = log(state, 0, '100', '8');
      state = swap(state, 'Leg Press');
      assert.equal(setOf(state, 1).plannedLoadKg, 150, 'precondition: the sets ahead re-resolved for the leg press');

      state = undo(state, 0);
      const set = setOf(state, 0);
      assert.equal(set.status, 'pending');
      assert.equal(set.plannedLoadKg, 150);
      assert.equal(set.draftLoadText, '150');
      assert.equal(set.autoProgressedFromKg, undefined);
      assert.equal(set.loggedAs, undefined);
      assert.deepEqual([set.plannedRepsMin, set.plannedRepsMax], [8, 8]);
      assert.equal(targetOf(state, 0).loadKg, 150);
      assert.equal(targetOf(state, 0).reps, 8);
    },
  },
  {
    name: 'a squat set taken back after a swap to a plank asks for the plank\'s seconds, the same as the sets ahead',
    run() {
      let state = start(HISTORY);
      state = log(state, 0, '100', '8');
      state = swap(state, 'Plank');
      assert.equal(exerciseOf(state).trackingMode, 'hold');
      const ahead = setOf(state, 1);

      state = undo(state, 0);
      const set = setOf(state, 0);
      assert.deepEqual([set.plannedRepsMin, set.plannedRepsMax], [ahead.plannedRepsMin, ahead.plannedRepsMax]);
      assert.notEqual(set.plannedRepsMax, 8, 'not the squat\'s 8 read as seconds');
      assert.equal(set.plannedLoadKg, undefined, 'a hold opens on no weight');
      assert.equal(set.draftLoadText, '');
      assert.equal(set.draftRepsText, '', 'the squat\'s 8 is not a draft in seconds');
      assert.deepEqual(targetOf(state, 0), targetOf(state, 1));
    },
  },
  {
    name: 'a plank set taken back after the slot returned to the squat asks for repetitions, not 45 of them',
    run() {
      let state = start(HISTORY);
      state = log(state, 0, '100', '8', 1);
      state = swap(state, 'Plank');
      state = log(state, 1, '', '45', 2);
      state = swap(state, 'Bicycling, Stationary');
      state = swap(state, 'Back Squat');
      assert.equal(exerciseOf(state).trackingMode, 'load_and_reps');

      state = undo(state, 1);
      const set = setOf(state, 1);
      const expected = doseAfterSwap(
        { trackingMode: 'hold', sets: 1, repsMin: 45, repsMax: 45 },
        'Back Squat',
      );
      assert.equal(expected.trackingMode, 'load_and_reps');
      assert.deepEqual([set.plannedRepsMin, set.plannedRepsMax], [expected.repsMin, expected.repsMax]);
      assert.notEqual(set.plannedRepsMax, 45);
      // Set 0 was the squat too: no line is left between the two, and set 1
      // carries the 100 kg just lifted.
      assert.equal(exerciseOf(state).swappedAfterSetIndex, undefined);
      assert.equal(targetOf(state, 1).loadKg, 100);
    },
  },
  {
    name: 'the set logged again as the new lift carries its weight to the next set',
    run() {
      let state = start(HISTORY);
      state = log(state, 0, '100', '8', 1);
      state = swap(state, 'Leg Press');
      assert.equal(exerciseOf(state).swappedAfterSetIndex, 0);

      state = undo(state, 0);
      assert.equal(exerciseOf(state).swappedAfterSetIndex, undefined, 'no set is left that was the squat');
      state = log(state, 0, '160', '10', 2);
      const next = targetOf(state, 1);
      assert.equal(next.loadKg, 160);
      assert.equal(next.reps, 10);
    },
  },
  {
    name: 'taking back the later of two pre-swap sets keeps the line under the one still logged as the old lift',
    run() {
      let state = start(HISTORY);
      state = log(state, 0, '100', '8', 1);
      state = log(state, 1, '100', '8', 2);
      state = swap(state, 'Leg Press');
      assert.equal(exerciseOf(state).swappedAfterSetIndex, 1);

      state = undo(state, 1);
      assert.equal(exerciseOf(state).swappedAfterSetIndex, 0);
      assert.equal(setOf(state, 0).loggedAs.exerciseName, 'Back Squat', 'set 0 is still the squat');
      // Not the squat's 100 kg carried over the line: the leg press's own.
      assert.equal(targetOf(state, 1).loadKg, 150);

      state = log(state, 1, '170', '8', 3);
      assert.equal(targetOf(state, 2).loadKg, 170);
    },
  },
  {
    name: 'a set logged after the swap and taken back is left as it was planned',
    run() {
      let state = start(HISTORY);
      state = log(state, 0, '100', '8', 1);
      state = swap(state, 'Leg Press');
      state = log(state, 1, '155', '8', 2);
      const before = { ...setOf(state, 1) };

      state = undo(state, 1);
      const set = setOf(state, 1);
      assert.equal(exerciseOf(state).swappedAfterSetIndex, 0);
      assert.equal(set.plannedLoadKg, before.plannedLoadKg);
      assert.equal(set.draftLoadText, '155', 'the reader\'s own entry stays to correct');
      assert.deepEqual([set.plannedRepsMin, set.plannedRepsMax], [before.plannedRepsMin, before.plannedRepsMax]);
    },
  },
];
