const assert = require('node:assert/strict');

const { createSeedDatabase } = require('../../src/data/seed');
const { getHomeSummary } = require('../../src/lib/dashboard');
const { getSessionSummary, getTrackedExerciseProgress } = require('../../src/lib/progression');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../src/features/workout/workoutAppAdapter');
const { persistCompletedWorkoutSessionToDatabase } = require('../../src/state/completedWorkoutPersistence');
const { createCompletedSession, createExercise, createSet } = require('../helpers/workoutFixtures.cjs');

module.exports = [
  {
    name: 'smoke pass: a saved live workout becomes visible in Home, History, and Progress through the legacy database',
    run() {
      let idCounter = 0;
      const createIdFn = (prefix) => `${prefix}_${++idCounter}`;

      const session = createCompletedSession({
        sessionId: 'feature_session_smoke',
        startedAt: '2026-03-19T18:00:00.000Z',
        updatedAt: '2026-03-19T18:42:00.000Z',
        completedAt: '2026-03-19T18:42:00.000Z',
        exercises: [
          createExercise({
            templateExerciseId: 'upper_a_bench_press',
            exerciseName: 'Bench Press',
            orderIndex: 0,
            sets: [
              createSet({ setIndex: 0, actualLoadKg: 100, actualReps: 8, completedAt: '2026-03-19T18:10:00.000Z' }),
              createSet({ setIndex: 1, actualLoadKg: 102.5, actualReps: 6, completedAt: '2026-03-19T18:14:00.000Z' }),
            ],
          }),
          createExercise({
            templateExerciseId: 'session_inserted_machine_press',
            exerciseName: 'Machine Chest Press',
            orderIndex: 1,
            sessionInserted: true,
            sourceExerciseName: 'Incline Press',
            notes: 'Elbows tucked on every rep',
            status: 'swapped',
            progressionPriority: 'medium',
            sets: [
              createSet({ setIndex: 0, actualLoadKg: 60, actualReps: 10, completedAt: '2026-03-19T18:20:00.000Z' }),
            ],
          }),
        ],
      });

      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);
      const persisted = persistCompletedWorkoutSessionToDatabase(createSeedDatabase(), adapted, createIdFn);

      assert.equal(persisted.didPersist, true);

      const homeSummary = getHomeSummary(persisted.database);
      assert.equal(homeSummary.lastSession?.session.id, 'feature_session_smoke');
      assert.equal(homeSummary.lastSession?.session.workoutNameSnapshot, '4-Day Upper/Lower');
      assert.equal(homeSummary.lastSession?.session.performedAt, '2026-03-19T18:42:00.000Z');

      const historySession = getSessionSummary(persisted.database, 'feature_session_smoke');
      assert.ok(historySession);
      assert.equal(historySession.session.workoutNameSnapshot, '4-Day Upper/Lower');
      assert.equal(historySession.session.noteCount, 1);
      assert.equal(historySession.session.exercisesSwapped, 1);
      assert.equal(historySession.logs[0].exerciseNameSnapshot, 'Bench Press');
      assert.equal(historySession.logs[1].sessionInserted, true);
      assert.equal(historySession.logs[1].swappedFrom, 'Incline Press');
      assert.equal(historySession.logs[1].notes, 'Elbows tucked on every rep');
      assert.deepEqual(historySession.logs[0].sets.map((set) => [set.weight, set.reps]), [
        [100, 8],
        [102.5, 6],
      ]);

      const progress = getTrackedExerciseProgress(persisted.database);
      const benchProgress = progress.find((entry) => entry.key === 'bench press');
      assert.ok(benchProgress);
      assert.equal(benchProgress.latestLog.sessionId, 'feature_session_smoke');
      assert.equal(benchProgress.latestWeight, 102.5);
    },
  },
];

