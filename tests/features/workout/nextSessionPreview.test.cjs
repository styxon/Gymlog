const assert = require('node:assert/strict');

const { workoutReducer, previewNextSession } = require('../../../src/features/workout/workoutState');
const { resolveGuidedSetTarget } = require('../../../src/lib/guidedPlayer');

/**
 * The coach's "Kehitysesimerkki" quotes what the set screen will open on next
 * time (user, 2026-09-27): if it said "7/7/7" and the dial opened on 12, the
 * reader would have two coaches. previewNextSession must therefore be the
 * real start, read through the real resolver — checked here against an actual
 * start of the same day.
 */

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};

const DONE_AT = '2026-09-24T09:00:00.000Z';

function template(trackingMode = 'load_and_reps') {
  return {
    id: 'tpl_preview',
    name: 'Preview programme',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'day_upper',
        name: 'Upper',
        orderIndex: 0,
        exercises: [
          {
            id: 'e_ohp',
            exerciseName: 'Standing Military Press',
            slotId: 'ohp',
            role: 'primary',
            progressionPriority: 'high',
            trackingMode,
            sets: 3,
            repsMin: 8,
            repsMax: 8,
            restSecondsMin: 120,
            restSecondsMax: 180,
            substitutionGroup: 'vertical_press',
          },
        ],
      },
    ],
  };
}

function start(state, orderIndex, options = {}) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: template(), sessionOrderIndex: orderIndex, unitPreference: 'kg', ...options },
  });
}

function logged(sets) {
  let state = start(EMPTY, 0);
  const slotId = state.activeSession.exercises[0].slotId;
  sets.forEach(([load, reps], index) => {
    state = workoutReducer(state, {
      type: 'set/updateDraft',
      payload: { slotId, setIndex: index, patch: { loadText: String(load), repsText: String(reps) } },
    });
    state = workoutReducer(state, {
      type: 'set/complete',
      payload: { slotId, setIndex: index, nowMs: Date.parse(DONE_AT), unitPreference: 'kg' },
    });
  });
  state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: DONE_AT } });
  return workoutReducer(state, { type: 'session/clearCompletedSession' });
}

module.exports = [
  {
    name: 'the coach\'s next-time numbers are what a real start of the same day opens on',
    run() {
      const after = logged([
        [52.5, 8],
        [52.5, 8],
        [52.5, 7],
      ]);
      const preview = previewNextSession(template(), { unitPreference: 'kg', history: after.history, sessionOrderIndex: 1 });
      assert.equal(preview.length, 1);
      assert.equal(preview[0].exerciseName, 'Standing Military Press');

      const real = start(after, 1);
      const instance = real.activeSession.exercises[0];
      const opened = instance.sets.map((_, index) => {
        const target = resolveGuidedSetTarget(instance.sets, index, instance.trackingMode);
        return { loadKg: target.loadKg, reps: target.reps };
      });
      assert.deepEqual(preview[0].sets, opened);
      // And it is the weight just lifted, not a guess.
      assert.equal(preview[0].sets[0].loadKg, 52.5);
    },
  },
  {
    name: 'previewing changes nothing: the history and the next real start are untouched',
    run() {
      const after = logged([
        [40, 8],
        [40, 8],
        [40, 8],
      ]);
      const before = JSON.stringify(after.history);
      previewNextSession(template(), { unitPreference: 'kg', history: after.history, sessionOrderIndex: 1 });
      assert.equal(JSON.stringify(after.history), before);
      assert.equal(after.activeSession, null);
    },
  },
];
