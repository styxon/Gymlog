const assert = require('node:assert/strict');

require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const { setNumberLanguage } = require('../../../.test-dist/lib/format.js');
setNumberLanguage('en');

const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState');
const { buildExerciseLogDraftsFromWorkoutSession } = require('../../../.test-dist/features/workout/workoutAppAdapter');
const { normalizeExerciseLog } = require('../../../.test-dist/lib/exerciseLog');
const { buildPreviousTopSets, resolveMovement, buildWhatMoved } = require('../../../.test-dist/lib/sessionMovement');

/**
 * A warm-up is never last time's top set (bug hunt W4, 2026-10-05, after #321).
 *
 * A lift skipped after its warm-ups saved a log whose only done rows were the
 * warm-ups. "What moved" read the heaviest done row of the last session as
 * that session's top set, kind unread, so the next session's 80 kg said
 * "+60 kg" over a 20 kg warm-up and went up the WHAT MOVED card.
 */

const SLOT = 'primary_bench_1';
const LIVE = 'tpl:push_a:primary_bench_1';

function benchSession() {
  return workoutReducer(
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
                  slotId: SLOT,
                  role: 'primary',
                  progressionPriority: 'high',
                  trackingMode: 'load_and_reps',
                  sets: 3,
                  repsMin: 8,
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
        progression: { automatedProgressionEnabled: true, setupLevel: 'beginner' },
      },
    },
  );
}

/** The saved logs of a session where the bench was warmed up at 20 kg and then skipped. */
function warmedUpThenSkippedLogs(sessionId) {
  let state = benchSession();
  state = workoutReducer(state, {
    type: 'exercise/logWarmup',
    payload: { slotId: LIVE, loadKg: 20, reps: 10, completedAt: '2026-10-05T10:00:00.000Z' },
  });
  state = workoutReducer(state, { type: 'exercise/skip', payload: { slotId: LIVE } });
  const drafts = buildExerciseLogDraftsFromWorkoutSession(state.activeSession);
  assert.equal(drafts.length, 1, 'the skipped lift is saved');
  assert.ok(
    drafts[0].sets.some((set) => set.kind === 'warmup' && set.weight === 20),
    'with the warm-up it did',
  );
  return drafts.map((draft, index) =>
    normalizeExerciseLog({ id: `${sessionId}_${index}`, sessionId, tracked: true, ...draft }),
  );
}

const benchLog = (sessionId, weight) => ({
  sessionId,
  exerciseNameSnapshot: 'Bench Press',
  weight,
  repsPerSet: [8, 8, 8],
  skipped: false,
  sets: [0, 1, 2].map((orderIndex) => ({ orderIndex, weight, reps: 8, kind: 'working', status: 'completed' })),
});

const PERFORMED = {
  older: '2026-09-28T18:00:00.000Z',
  skippedDay: '2026-10-01T18:00:00.000Z',
  today: '2026-10-05T18:00:00.000Z',
};

module.exports = [
  {
    name: 'W4: a lift skipped after its warm-ups is not last time — the next 82.5 reads +2.5 against the 80 before, not +62.5',
    run() {
      const logs = [benchLog('older', 80), ...warmedUpThenSkippedLogs('skippedDay'), benchLog('today', 82.5)];
      const tops = buildPreviousTopSets({ logs, performedAtBySessionId: PERFORMED, excludeSessionId: 'today' });
      assert.equal(tops['bench press'], 80);

      const movement = resolveMovement(
        { exerciseName: 'Bench Press', todayTopKg: 82.5, todayTopReps: 8, previousTopKg: tops['bench press'] ?? null },
        'en',
      );
      assert.equal(movement.kind, 'up');
      assert.equal(movement.deltaKg, 2.5);

      // With nothing before it, the lift is new — not "+62.5 kg" on WHAT MOVED.
      const alone = buildPreviousTopSets({
        logs: warmedUpThenSkippedLogs('skippedDay'),
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      assert.equal(alone['bench press'], undefined);
      const moved = buildWhatMoved(
        [{ exerciseName: 'Bench Press', todayTopKg: 82.5, todayTopReps: 8, previousTopKg: alone['bench press'] ?? null }],
        'en',
      );
      assert.deepEqual(moved, []);
    },
  },
  {
    name: 'W4: a log whose only done rows are warm-ups has no top set, skipped or not',
    run() {
      const onlyWarmups = {
        sessionId: 'skippedDay',
        exerciseNameSnapshot: 'Squat',
        weight: 0,
        repsPerSet: [],
        sets: [
          { weight: 40, reps: 10, kind: 'warmup', status: 'completed' },
          { weight: 60, reps: 5, kind: 'warmup', status: 'completed' },
          { weight: 100, reps: 5, kind: 'working', status: 'pending' },
        ],
      };
      const tops = buildPreviousTopSets({
        logs: [onlyWarmups],
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      assert.deepEqual(tops, {});
    },
  },
  {
    name: 'W4 invariant: adding warm-up rows to any log never changes last time\'s top set',
    run() {
      let seed = 7;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const statuses = ['completed', 'pending', 'skipped', undefined];
      const sessions = Object.keys(PERFORMED);
      for (let trial = 0; trial < 300; trial += 1) {
        const logs = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => {
          const skipped = rand() < 0.2;
          const sets = Array.from({ length: Math.floor(rand() * 4) }, (_, orderIndex) => ({
            orderIndex,
            weight: Math.round(rand() * 80) * 2.5,
            reps: 1 + Math.floor(rand() * 12),
            kind: rand() < 0.2 ? 'drop' : 'working',
            status: statuses[Math.floor(rand() * statuses.length)],
          }));
          return {
            sessionId: sessions[Math.floor(rand() * sessions.length)],
            exerciseNameSnapshot: rand() < 0.5 ? 'Bench Press' : 'Squat',
            // As the loader derives it: the done work's heaviest, nothing when skipped.
            weight: skipped ? 0 : Math.max(0, ...sets.filter((set) => set.status === 'completed').map((set) => set.weight)),
            repsPerSet: [],
            skipped,
            sets,
          };
        });
        const input = { performedAtBySessionId: PERFORMED, excludeSessionId: 'today' };
        const before = buildPreviousTopSets({ ...input, logs });
        const warmed = logs.map((log) => ({
          ...log,
          sets: [
            ...Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, index) => ({
              orderIndex: -1 - index,
              // Heavier than anything else, so a leak cannot hide.
              weight: 400 + Math.round(rand() * 40) * 2.5,
              reps: 5,
              kind: 'warmup',
              status: 'completed',
            })),
            ...log.sets,
          ],
        }));
        assert.deepEqual(buildPreviousTopSets({ ...input, logs: warmed }), before, `trial ${trial}`);
      }
    },
  },
];
