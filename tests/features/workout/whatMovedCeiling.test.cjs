const assert = require('node:assert/strict');

require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const { setNumberLanguage } = require('../../../.test-dist/lib/format.js');
setNumberLanguage('en');

const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState');
const { buildAdaptedCompletedWorkoutExercises } = require('../../../.test-dist/features/workout/workoutAppAdapter');
const { buildSessionMovement } = require('../../../.test-dist/app/workoutCompletionState');
const { buildWhatMoved } = require('../../../.test-dist/lib/sessionMovement');

/**
 * WHAT MOVED asks for one rep more only below the programme's ceiling (bug
 * hunt, 2026-10-09). 62,5 × 8 on a 3 × 8 said "next time aim for 9" while the
 * next session opened at 65 × 8, and a single at 140 kg asked for two.
 */

const LIVE = 'tpl:push_a:primary_bench_1';

function benchSessionDone(reps) {
  let state = workoutReducer(
    { ...workoutInitialState, history: { sessions: [], lastSelectedTemplateId: null, slotHistory: {} } },
    {
      type: 'session/startFromRuntimeTemplate',
      payload: {
        template: {
          id: 'tpl',
          name: 'Push',
          defaultScheduleMode: 'weekday',
          sessions: [
            {
              id: 'push_a',
              name: 'Push A',
              orderIndex: 1,
              exercises: [
                {
                  id: 'ex_bench',
                  exerciseName: 'Bench Press',
                  slotId: 'primary_bench_1',
                  role: 'primary',
                  progressionPriority: 'high',
                  trackingMode: 'load_and_reps',
                  sets: 3,
                  repsMin: 6,
                  repsMax: 8,
                  restSecondsMin: 120,
                  restSecondsMax: 150,
                  substitutionGroup: 'horizontal_press',
                },
              ],
            },
          ],
        },
        sessionOrderIndex: 1,
        unitPreference: 'kg',
      },
    },
  );
  [0, 1, 2].forEach((setIndex) => {
    state = workoutReducer(state, {
      type: 'set/updateDraft',
      payload: { slotId: LIVE, setIndex, patch: { loadText: '62.5', repsText: String(reps) } },
    });
    state = workoutReducer(state, {
      type: 'set/complete',
      payload: { slotId: LIVE, setIndex, nowMs: Date.parse('2026-10-09T10:00:00.000Z') + setIndex * 60_000, unitPreference: 'kg' },
    });
  });
  return state.activeSession;
}

function nudgeAfter(reps) {
  const session = benchSessionDone(reps);
  const exercises = buildAdaptedCompletedWorkoutExercises(session);
  const done = exercises[0].sets.filter((set) => set.status === 'completed');
  assert.equal(done.length, 3, 'the three sets were logged');
  const { whatMoved } = buildSessionMovement({
    exercises,
    exerciseLogs: [
      {
        sessionId: 'last',
        exerciseNameSnapshot: 'Bench Press',
        weight: 60,
        repsPerSet: [8, 8, 8],
        sets: [0, 1, 2].map((orderIndex) => ({ orderIndex, weight: 60, reps: 8, kind: 'working', status: 'completed' })),
      },
    ],
    workoutSessions: [{ id: 'last', performedAt: '2026-10-02T10:00:00.000Z' }],
    sessionId: session.sessionId,
    language: 'en',
    unitPreference: 'kg',
  });
  assert.equal(whatMoved.length, 1);
  return whatMoved[0].nudge;
}

module.exports = [
  {
    name: 'what moved: below the rep ceiling the nudge asks one more rep',
    run() {
      assert.equal(nudgeAfter(7), '62.5 × 7 — next time aim for 8.');
    },
  },
  {
    name: 'what moved: at the programme ceiling the nudge asks for no rep the programme does not want',
    run() {
      // The finish screen's rows carry the ceiling the sets were planned at.
      assert.equal(buildAdaptedCompletedWorkoutExercises(benchSessionDone(8))[0].repsMax, 8);
      assert.equal(nudgeAfter(8), '62.5 × 8 — top of the rep range.');
      assert.equal(nudgeAfter(9), '62.5 × 9 — top of the rep range.');

      const fi = buildWhatMoved(
        [{ exerciseName: 'Deadlift', todayTopKg: 140, todayTopReps: 1, previousTopKg: 135, repsMax: 1 }],
        'fi',
      );
      assert.equal(fi[0].nudge, '140 × 1 — toistohaarukan yläpäässä.');
      // No ceiling known (an older caller): the old line.
      assert.equal(
        buildWhatMoved([{ exerciseName: 'Deadlift', todayTopKg: 140, todayTopReps: 1, previousTopKg: 135 }], 'en')[0].nudge,
        '140 × 1 — next time aim for 2.',
      );
    },
  },
];
