const assert = require('node:assert/strict');

const {
  buildHistorySessionViewModel,
  filterHistorySessionViewModels,
} = require('../../src/lib/historyView');

function createLog(overrides = {}) {
  return {
    id: 'log_1',
    sessionId: 'session_1',
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Bench Press',
    weight: 85,
    repsPerSet: [8, 7, 6],
    sets: [
      { orderIndex: 0, weight: 85, reps: 8, kind: 'working', outcome: 'completed' },
      { orderIndex: 1, weight: 85, reps: 7, kind: 'working', outcome: 'completed' },
      { orderIndex: 2, weight: 85, reps: 6, kind: 'working', outcome: 'completed' },
    ],
    tracked: true,
    orderIndex: 0,
    skipped: false,
    sessionInserted: false,
    ...overrides,
  };
}

module.exports = [
  {
    name: 'history session view model summarizes sets, volume, skips, and top lift',
    run() {
      const summary = buildHistorySessionViewModel(
        {
          id: 'session_1',
          workoutTemplateId: 'tpl_1',
          workoutNameSnapshot: 'Upper Day',
          performedAt: '2026-03-31T10:00:00.000Z',
        },
        [
          createLog(),
          createLog({
            id: 'log_2',
            exerciseNameSnapshot: 'Pull-Up',
            weight: 0,
            repsPerSet: [],
            sets: [],
            skipped: true,
            tracked: false,
            orderIndex: 1,
          }),
          createLog({
            id: 'log_3',
            exerciseNameSnapshot: 'Machine Chest Press',
            orderIndex: 2,
            status: 'swapped',
            notes: 'Felt good today',
            swappedFrom: 'Chest Press',
            sessionInserted: true,
          }),
        ],
      );

      // The lifts done, as the completion screen counts them: three logs,
      // one skipped, is two exercises and one skip — not three and one
      // (audit round 4, 2026-09-20).
      assert.equal(summary.exerciseCount, 2);
      assert.equal(summary.skippedExercises, 1);
      assert.equal(summary.trackedExercises, 2);
      assert.equal(summary.setsCompleted, 6);
      assert.equal(summary.totalVolume, 3570);
      assert.equal(summary.topLiftName, 'Bench Press');
      assert.equal(summary.topLiftWeightKg, 85);
      assert.equal(summary.swappedExercises, 1);
      assert.equal(summary.noteCount, 1);
      assert.equal(summary.sessionInsertedExercises, 1);
    },
  },
  {
    name: 'history session filters support needs review and tracked views',
    run() {
      const sessions = [
        {
          sessionId: '1',
          workoutName: 'Upper',
          performedAt: '2026-03-31T10:00:00.000Z',
          exerciseCount: 2,
          skippedExercises: 1,
          trackedExercises: 1,
          setsCompleted: 3,
          totalVolume: 1000,
          topLiftName: 'Bench Press',
          topLiftWeightKg: 85,
        },
        {
          sessionId: '2',
          workoutName: 'Reset',
          performedAt: '2026-03-30T10:00:00.000Z',
          exerciseCount: 1,
          skippedExercises: 0,
          trackedExercises: 0,
          setsCompleted: 0,
          totalVolume: 0,
          topLiftName: null,
          topLiftWeightKg: null,
        },
      ];

      assert.equal(
        filterHistorySessionViewModels(sessions, { query: '', filter: 'needs_review' }).length,
        1,
      );
      assert.equal(filterHistorySessionViewModels(sessions, { query: 'bench', filter: 'tracked' }).length, 1);
      assert.equal(filterHistorySessionViewModels(sessions, { query: 'reset', filter: 'tracked' }).length, 0);
    },
  },
];
