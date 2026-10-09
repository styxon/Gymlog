const assert = require('node:assert/strict');

const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');
const {
  persistCompletedWorkoutSessionToDatabase,
  persistCompletedWorkoutSessionsToDatabase,
} = require('../../.test-dist/state/completedWorkoutPersistence.js');
const { exerciseLogRepository } = require('../../.test-dist/storage/repositories.js');

function createLog(overrides = {}) {
  return {
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Bench Press',
    sets: [
      { orderIndex: 1, weight: 102.5, reps: 6, kind: 'working', outcome: 'completed' },
      { orderIndex: 0, weight: 100, reps: 8, kind: 'working', outcome: 'completed' },
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
    name: 'completed workout persistence is idempotent and keeps log ordering stable',
    run() {
      let idCounter = 0;
      const createIdFn = (prefix) => `${prefix}_${++idCounter}`;
      const input = {
        sessionId: 'feature_session_1',
        workoutTemplateId: 'tpl_4_day_upper_lower_v1',
        workoutNameSnapshot: '4-Day Upper/Lower',
        startedAt: '2026-03-19T10:00:00.000Z',
        performedAt: '2026-03-19T10:35:00.000Z',
        logs: [
          createLog({ exerciseNameSnapshot: 'Overhead Press', orderIndex: 2 }),
          createLog({ exerciseNameSnapshot: 'Bench Press', orderIndex: 0 }),
          createLog({
            exerciseNameSnapshot: 'Calf Raise',
            orderIndex: 5,
            tracked: false,
            skipped: true,
            sets: [],
          }),
        ],
      };

      const first = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase(), input, createIdFn);
      assert.equal(first.didPersist, true);
      assert.equal(first.database.workoutSessions.length, 1);

      const persistedLogs = exerciseLogRepository.listBySessionId(first.database, input.sessionId);
      assert.deepEqual(
        persistedLogs.map((log) => [log.orderIndex, log.exerciseNameSnapshot]),
        [
          [0, 'Bench Press'],
          [2, 'Overhead Press'],
          [5, 'Calf Raise'],
        ],
      );
      assert.deepEqual(persistedLogs[0].sets.map((set) => set.orderIndex), [0, 1]);
      assert.equal(first.database.workoutSessions[0].durationMinutes, 35);
      assert.equal(first.database.workoutSessions[0].setsCompleted, 4);
      assert.equal(first.summary.entriesSaved, 3);
      assert.equal(first.summary.sessionId, 'feature_session_1');

      const second = persistCompletedWorkoutSessionToDatabase(first.database, input, createIdFn);
      assert.equal(second.didPersist, false);
      assert.equal(second.database.workoutSessions.length, 1);
      assert.equal(second.database.exerciseLogs.length, 3);
      assert.deepEqual(second.summary, first.summary);
    },
  },
  {
    name: 'completed workout summary counts skipped exercises the same way as finish review',
    run() {
      const input = {
        sessionId: 'feature_session_skipped_only',
        workoutTemplateId: 'tpl_4_day_upper_lower_v1',
        workoutNameSnapshot: '4-Day Upper/Lower',
        startedAt: '2026-03-19T10:00:00.000Z',
        performedAt: '2026-03-19T10:09:00.000Z',
        logs: [
          createLog({
            exerciseNameSnapshot: 'Lat Pulldown',
            tracked: false,
            skipped: true,
            sets: [],
          }),
        ],
      };

      const result = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase(), input);
      assert.equal(result.didPersist, true);
      assert.equal(result.summary.entriesSaved, 1);
      assert.equal(result.summary.exercisesLogged, 1);
      assert.equal(result.summary.trackedExercisesUpdated, 0);
      assert.equal(result.summary.setsCompleted, 0);
    },
  },
  {
    name: 'completed workout persistence keeps notes, swaps, and set status fidelity',
    run() {
      const result = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase(), {
        sessionId: 'feature_session_fidelity',
        workoutTemplateId: 'tpl_4_day_upper_lower_v1',
        workoutNameSnapshot: '4-Day Upper/Lower',
        startedAt: '2026-03-19T10:00:00.000Z',
        performedAt: '2026-03-19T10:20:00.000Z',
        legacyShapeMismatches: [],
        logs: [
          createLog({
            exerciseNameSnapshot: 'Machine Chest Press',
            sessionInserted: true,
            status: 'swapped',
            notes: 'Controlled eccentric on every rep',
            swappedFrom: 'Bench Press',
            sets: [
              { orderIndex: 0, weight: 60, reps: 10, kind: 'working', outcome: 'completed', status: 'completed', completedAt: '2026-03-19T10:11:00.000Z' },
              { orderIndex: 1, weight: 0, reps: 0, kind: 'working', outcome: 'skipped', status: 'skipped', skippedReason: 'Shoulder tweak' },
              { orderIndex: 2, weight: 0, reps: 0, kind: 'working', outcome: null, status: 'pending', completedAt: null },
            ],
          }),
        ],
      });

      assert.equal(result.didPersist, true);
      const session = result.database.workoutSessions[0];
      const log = result.database.exerciseLogs[0];

      assert.equal(session.noteCount, 1);
      assert.equal(session.exercisesSwapped, 1);
      assert.equal(session.sessionInsertedCount, 1);
      assert.equal(log.notes, 'Controlled eccentric on every rep');
      assert.equal(log.swappedFrom, 'Bench Press');
      assert.equal(log.status, 'swapped');
      assert.deepEqual(log.sets.map((set) => set.status), ['completed', 'skipped', 'pending']);
      assert.equal(log.sets[0].completedAt, '2026-03-19T10:11:00.000Z');
      assert.equal(log.sets[1].skippedReason, 'Shoulder tweak');
      assert.equal(result.summary.notesSaved, 1);
      assert.equal(result.summary.exercisesSwapped, 1);
      assert.equal(result.summary.sessionInsertedExercises, 1);
    },
  },
  {
    name: 'completed workout persistence preserves workout template session id',
    run() {
      const result = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase(), {
        sessionId: 'feature_session_day_b',
        workoutTemplateId: 'custom_full_body',
        workoutTemplateSessionId: 'day_b',
        workoutNameSnapshot: 'Full Body B',
        startedAt: '2026-05-25T10:00:00.000Z',
        performedAt: '2026-05-25T10:30:00.000Z',
        logs: [createLog({ exerciseNameSnapshot: 'Incline Push-Up' })],
      });

      assert.equal(result.didPersist, true);
      assert.equal(result.database.workoutSessions[0].workoutTemplateSessionId, 'day_b');
    },
  },
  {
    // A multi-year Hevy history import called persistCompletedWorkoutSessionToDatabase
    // once per workout, each time handing the just-grown database to the next
    // call: every call re-copied the growing session/log arrays and
    // linear-scanned them for a duplicate — quadratic, and it froze the app
    // on a real export (#bugs). persistCompletedWorkoutSessionsToDatabase
    // replaces the per-workout loop with one pass and one write; this proves
    // it agrees with the old loop on a small, mixed batch.
    name: 'batch import: one pass over many workouts agrees with the old per-workout loop',
    run() {
      const buildInput = (sessionId, name, overrides = {}) => ({
        sessionId,
        workoutTemplateId: 'hevy_import',
        workoutTemplateSessionId: null,
        workoutNameSnapshot: name,
        startedAt: `2026-0${sessionId.slice(-1)}-01T08:00:00.000Z`,
        performedAt: `2026-0${sessionId.slice(-1)}-01T08:45:00.000Z`,
        logs: [createLog({ exerciseNameSnapshot: name })],
        ...overrides,
      });

      // A mix the single-workout path already has to get right: two distinct
      // workouts, the same workout appearing twice in one file, and a row
      // with nothing loggable (which persists nothing, as the single-workout
      // path does, and is counted as skipped, not as a duplicate).
      const inputs = [
        buildInput('hevy_1', 'Push Day'),
        buildInput('hevy_2', 'Leg Day'),
        buildInput('hevy_1', 'Push Day'), // re-listed within the same import
        buildInput('hevy_3', 'Rest Notes', { logs: [] }), // nothing to persist
        buildInput('hevy_4', 'Pull Day'),
      ];

      // The old path: fold each input through the single-workout function,
      // threading the growing database from one call to the next.
      let oldDatabase = createEmptyDatabase();
      let oldImported = 0;
      let oldDuplicates = 0;
      for (const input of inputs) {
        const result = persistCompletedWorkoutSessionToDatabase(oldDatabase, input);
        if (result.didPersist) {
          oldImported += 1;
          oldDatabase = result.database;
        } else {
          oldDuplicates += 1;
        }
      }

      const batch = persistCompletedWorkoutSessionsToDatabase(createEmptyDatabase(), inputs);

      // The old path has one "did not persist"; the batch says which of the
      // two it was (a workout already there, or one with nothing to log).
      assert.deepEqual(
        { imported: batch.imported, notPersisted: batch.duplicates + batch.skipped },
        { imported: oldImported, notPersisted: oldDuplicates },
      );
      assert.equal(batch.duplicates, 1, 'the workout listed twice');
      assert.equal(batch.skipped, 1, 'the one with nothing loggable is not "already there"');
      assert.equal(oldImported, 3);
      assert.equal(oldDuplicates, 2);

      // Session rows are compared in full: their id is the input's own
      // sessionId, not anything createIdFn touches, so this also proves the
      // two paths picked the same workouts.
      const sortById = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(sortById(batch.database.workoutSessions), sortById(oldDatabase.workoutSessions));

      // Logs get a fresh id per call in both paths; compare everything else,
      // grouped the way a caller actually reads them back.
      const logsWithoutId = (database) =>
        [...database.exerciseLogs]
          .map(({ id, ...rest }) => rest)
          .sort((a, b) => `${a.sessionId}:${a.orderIndex}`.localeCompare(`${b.sessionId}:${b.orderIndex}`));
      assert.deepEqual(logsWithoutId(batch.database), logsWithoutId(oldDatabase));
    },
  },
  {
    // 1500 is roughly a real multi-year Hevy history, and the fixed, linear
    // path clears it in well under a tenth of a second on ordinary hardware —
    // but the old per-workout loop is only mildly slow there too (tens of
    // milliseconds), so a 1-second budget would not actually catch a
    // regression back to it. 9000 keeps the same shape of import (a few
    // exercises per workout) while pushing the old O(n²) loop past 1.5
    // seconds on this machine, so this stays a real regression guard rather
    // than a number that merely sounds large.
    name: 'batch import: 9000 workouts persist in one pass, well under a second',
    run() {
      const workoutCount = 9000;
      const inputs = [];
      for (let i = 0; i < workoutCount; i += 1) {
        const iso = new Date(2020, 0, 1 + i).toISOString();
        inputs.push({
          sessionId: `hevy_${i}`,
          workoutTemplateId: 'hevy_import',
          workoutTemplateSessionId: null,
          workoutNameSnapshot: `Workout ${i}`,
          startedAt: iso,
          performedAt: iso,
          logs: [
            createLog({ exerciseNameSnapshot: 'Bench Press', orderIndex: 0 }),
            createLog({ exerciseNameSnapshot: 'Barbell Row', orderIndex: 1 }),
            createLog({ exerciseNameSnapshot: 'Back Squat', orderIndex: 2 }),
          ],
        });
      }
      // A handful of re-listed workouts, the way a re-exported file would
      // repeat a session — exercised so the duplicate path is not free to be
      // slow either.
      inputs.push({ ...inputs[0] });
      inputs.push({ ...inputs[1] });

      const startedAt = Date.now();
      const result = persistCompletedWorkoutSessionsToDatabase(createEmptyDatabase(), inputs);
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.imported, workoutCount);
      assert.equal(result.duplicates, 2);
      assert.equal(result.database.workoutSessions.length, workoutCount);
      assert.equal(result.database.exerciseLogs.length, workoutCount * 3);
      assert.ok(elapsedMs < 1000, `expected well under a second, took ${elapsedMs}ms`);
    },
  },
];

