const assert = require('node:assert/strict');

const { getExerciseProgressForName } = require('../../src/lib/progression');

function workingSet(weight, reps) {
  return { orderIndex: 0, weight, reps, kind: 'working', status: 'completed', completedAt: '2026-01-01T00:00:00.000Z' };
}

function buildDatabase() {
  return {
    exerciseTemplates: [],
    workoutSessions: [
      { id: 's1', performedAt: '2026-03-01T10:00:00.000Z', workoutNameSnapshot: 'Push A' },
      { id: 's2', performedAt: '2026-05-01T10:00:00.000Z', workoutNameSnapshot: 'Push B' },
    ],
    exerciseLogs: [
      { id: 'l1', sessionId: 's1', exerciseNameSnapshot: 'Bench Press', skipped: false, sets: [workingSet(60, 8)] },
      { id: 'l2', sessionId: 's2', exerciseNameSnapshot: 'Bench Press', skipped: false, sets: [workingSet(70, 6)] },
      // skipped log for the same lift must be ignored
      { id: 'l3', sessionId: 's2', exerciseNameSnapshot: 'Bench Press', skipped: true, sets: [workingSet(100, 1)] },
      // a different lift must not leak in
      { id: 'l4', sessionId: 's1', exerciseNameSnapshot: 'Back Squat', skipped: false, sets: [workingSet(90, 5)] },
    ],
  };
}

module.exports = [
  {
    name: 'getExerciseProgressForName aggregates a single lift across sessions, newest first',
    run() {
      const summary = getExerciseProgressForName(buildDatabase(), 'Bench Press');

      assert.equal(summary.key, 'bench press');
      assert.equal(summary.name, 'Bench Press');
      assert.equal(summary.logs.length, 2);
      // newest session (May) leads
      assert.equal(summary.latestLog.workoutNameSnapshot, 'Push B');
      assert.equal(summary.latestWeight, 70);
      assert.equal(summary.previousWeight, 60);
      assert.equal(summary.bestWeight, 70);
    },
  },
  {
    name: 'getExerciseProgressForName matches by name case-insensitively',
    run() {
      const summary = getExerciseProgressForName(buildDatabase(), '  bench press  ');
      assert.equal(summary.logs.length, 2);
      assert.equal(summary.bestWeight, 70);
    },
  },
  {
    name: 'getExerciseProgressForName returns an empty summary for a never-logged lift',
    run() {
      const summary = getExerciseProgressForName(buildDatabase(), 'Overhead Press');

      assert.equal(summary.logs.length, 0);
      assert.equal(summary.latestWeight, null);
      assert.equal(summary.previousWeight, null);
      assert.equal(summary.bestWeight, null);
      assert.equal(summary.latestReps, '-');
      assert.equal(summary.latestLog, undefined);
    },
  },
];
