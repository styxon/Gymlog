const assert = require('node:assert/strict');

const { workoutReducer } = require('../../../src/features/workout/workoutState');
const { resolveGuidedSetTarget } = require('../../../src/lib/guidedPlayer');

/**
 * A ramp end to end (user 2026-10-01, option A): 40×10, 50×8, 60×5 logged,
 * the next session of the same day opens each set on its own weight and its
 * own reps, the heaviest one more — 10, 8, 6 — and the dial keeps that order
 * even after the lighter set before it was logged at 10.
 */
const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};
const DONE_AT = '2026-09-27T09:00:00.000Z';
const NOW = Date.parse('2026-10-01T09:00:00.000Z');

function template() {
  return {
    id: 'tpl_ramp',
    name: 'Ramp day',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'day_a',
        name: 'Push',
        orderIndex: 0,
        exercises: [
          {
            id: 'e_bench',
            exerciseName: 'Bench Press',
            slotId: 'bench',
            role: 'primary',
            progressionPriority: 'high',
            trackingMode: 'load_and_reps',
            sets: 3,
            repsMin: 8,
            repsMax: 12,
            restSecondsMin: 120,
            restSecondsMax: 120,
            substitutionGroup: 'bench',
          },
        ],
      },
    ],
  };
}

function start(state, enabled) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: template(),
      sessionOrderIndex: 0,
      unitPreference: 'kg',
      progression: { automatedProgressionEnabled: enabled, setupLevel: 'beginner', nowMs: NOW },
    },
  });
}

function logSet(state, slotId, setIndex, loadText, repsText, atIso) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText, repsText } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: Date.parse(atIso), unitPreference: 'kg' },
  });
}

function afterRamp() {
  let state = start(EMPTY, true);
  const slotId = state.activeSession.exercises[0].slotId;
  [['40', '10'], ['50', '8'], ['60', '5']].forEach(([load, reps], index) => {
    state = logSet(state, slotId, index, load, reps, DONE_AT);
  });
  state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: DONE_AT } });
  return workoutReducer(state, { type: 'session/clearCompletedSession' });
}

module.exports = [
  {
    name: 'ramp: each set opens on its own weight and reps, the heaviest one more',
    run() {
      const next = start(afterRamp(), true);
      const instance = next.activeSession.exercises[0];
      assert.deepEqual(instance.sets.map((set) => set.plannedLoadKg), [40, 50, 60]);
      assert.deepEqual(instance.sets.map((set) => set.rampTargetReps), [10, 8, 6]);
      // No averaged "lowered" target on top of it.
      assert.deepEqual(instance.sets.map((set) => set.plannedTargetReps), [undefined, undefined, undefined]);

      const dial = (state, index) => {
        const live = state.activeSession.exercises[0];
        return resolveGuidedSetTarget(live.sets, index, live.trackingMode, live.swappedAfterSetIndex).reps;
      };
      assert.deepEqual([0, 1, 2].map((index) => dial(next, index)), [10, 8, 6]);
      // Set 1 logged at 10: set 2 still asks its own 8, not the 10 before it.
      const afterFirst = logSet(next, instance.slotId, 0, '40', '10', '2026-10-01T09:05:00.000Z');
      assert.equal(dial(afterFirst, 1), 8);
      assert.equal(dial(afterFirst, 2), 6);
      // Off the plan — warm-ups skipped, 60 kg from set 1 for 5 — set 2 is no
      // longer the 50 kg set its target was for: it follows the set before.
      const skippedWarmups = logSet(next, instance.slotId, 0, '60', '5', '2026-10-01T09:05:00.000Z');
      assert.equal(dial(skippedWarmups, 1), 5);
    },
  },
  {
    name: 'ramp: with progression off the sets carry no targets',
    run() {
      const off = start(afterRamp(), false).activeSession.exercises[0];
      assert.deepEqual(off.sets.map((set) => set.rampTargetReps), [undefined, undefined, undefined]);
    },
  },
];
