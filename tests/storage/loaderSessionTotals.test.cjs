const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', 'src');
const dist = (relative) => require(path.join(DIST, relative));

function loadNormalize() {
  const fake = createFakeAsyncStorage();
  return loadAgainstFake(fake, () => require(path.join(DIST, 'storage', 'database.js'))).normalizeDatabase;
}

const done = (orderIndex, weight, reps) => ({
  orderIndex,
  weight,
  reps,
  kind: 'working',
  outcome: 'completed',
  status: 'completed',
  completedAt: '2026-09-15T14:00:00.000Z',
});
const typed = (orderIndex, weight, reps) => ({
  orderIndex,
  weight,
  reps,
  kind: 'working',
  outcome: null,
  status: 'pending',
  completedAt: null,
});

/**
 * A free workout saved by a build before #159: bench ticked twice, squat typed
 * and never ticked. That build's set helper fell back to every row when none
 * was completed, so it wrote 4 sets and 1 960 kg into the row. Today's helper
 * reads the same logs as 2 sets and 960 kg.
 */
function storedBeforeTheFix() {
  return {
    workoutSessions: [
      {
        id: 'old_1',
        workoutTemplateId: 'tpl_free',
        workoutNameSnapshot: 'Free workout',
        performedAt: '2026-09-15T14:00:00.000Z',
        startedAt: '2026-09-15T13:20:00.000Z',
        durationMinutes: 40,
        setsCompleted: 4,
        exercisesCompleted: 1,
        totalVolumeKg: 1960,
      },
    ],
    exerciseLogs: [
      {
        id: 'log_b',
        sessionId: 'old_1',
        exerciseTemplateId: null,
        exerciseNameSnapshot: 'Bench Press',
        weight: 60,
        repsPerSet: [8, 8],
        sets: [done(0, 60, 8), done(1, 60, 8)],
        tracked: true,
        orderIndex: 0,
        skipped: false,
        status: 'completed',
      },
      {
        id: 'log_s',
        sessionId: 'old_1',
        exerciseTemplateId: null,
        exerciseNameSnapshot: 'Squat',
        weight: 100,
        repsPerSet: [5, 5],
        sets: [typed(0, 100, 5), typed(1, 100, 5)],
        tracked: true,
        orderIndex: 1,
        skipped: false,
        status: 'active',
      },
    ],
  };
}

/**
 * One count of what was done (audit, 2026-09-20), from the loader's side: a
 * total an older build wrote into a session row is not carried forward.
 */
module.exports = [
  {
    name: 'loader: a session total written by an older build is read again from its logs',
    run() {
      const normalizeDatabase = loadNormalize();
      const database = normalizeDatabase(storedBeforeTheFix());
      const session = database.workoutSessions[0];

      assert.equal(session.setsCompleted, 2, 'Progress\'s recent row read the stored 4');
      assert.equal(session.totalVolumeKg, 960, 'and 1 960 kg');
      assert.equal(session.exercisesCompleted, 1);
    },
  },
  {
    name: 'loader: every surface that reads the row agrees with History about an old session',
    run() {
      const normalizeDatabase = loadNormalize();
      const database = normalizeDatabase(storedBeforeTheFix());
      const now = new Date('2026-09-17T12:00:00+03:00');
      const session = database.workoutSessions[0];

      const { buildHistorySessionViewModel } = dist('lib/historyView.js');
      const history = buildHistorySessionViewModel(session, database.exerciseLogs);
      assert.equal(history.totalVolume, 960);
      assert.equal(history.setsCompleted, 2);

      const { getLifetimeTrainingSummary } = dist('lib/lifetimeSummary.js');
      const { getMonthTrainingTotals } = dist('lib/dashboard.js');
      const { getVolumeThisWeekKg } = dist('lib/completedSessions.js');
      const { getMilestoneFacts } = dist('lib/milestoneFacts.js');
      const facts = getMilestoneFacts(database, { currentWeekStreak: 1 }, []);

      assert.deepEqual(
        {
          progressRecentRow: [session.setsCompleted, session.totalVolumeKg],
          profileTotal: getLifetimeTrainingSummary(database, now).totalVolumeKg,
          widgetMonth: getMonthTrainingTotals(database, now).volumeKg,
          weeklyNotification: getVolumeThisWeekKg(database, now),
          milestones: [facts.current.sets, facts.current.volume],
        },
        {
          progressRecentRow: [history.setsCompleted, history.totalVolume],
          profileTotal: history.totalVolume,
          widgetMonth: history.totalVolume,
          weeklyNotification: history.totalVolume,
          milestones: [history.setsCompleted, history.totalVolume],
        },
      );
    },
  },
  {
    name: 'loader: the row written at save is the row read back at load, a swapped lift done counted as done',
    run() {
      const normalizeDatabase = loadNormalize();
      const { persistCompletedWorkoutSessionToDatabase } = dist('state/completedWorkoutPersistence.js');
      const [bench, squat] = storedBeforeTheFix().exerciseLogs.map(({ id, sessionId, ...draft }) => draft);
      // Swapped at a busy gym and then done: the log keeps "swapped", which
      // the save used to read as not completed.
      const row = {
        ...bench,
        exerciseNameSnapshot: 'Machine Row',
        swappedFrom: 'Barbell Row',
        status: 'swapped',
        orderIndex: 2,
        sets: [done(0, 50, 10), done(1, 50, 10)],
      };
      let n = 0;
      const saved = persistCompletedWorkoutSessionToDatabase(
        normalizeDatabase({}),
        {
          sessionId: 'new_1',
          workoutTemplateId: 'tpl_a',
          workoutNameSnapshot: 'Upper A',
          logs: [bench, squat, row],
          startedAt: '2026-09-16T13:20:00.000Z',
          performedAt: '2026-09-16T14:00:00.000Z',
        },
        (prefix) => `${prefix}_${++n}`,
      );
      const written = saved.database.workoutSessions[0];
      assert.deepEqual(
        { sets: written.setsCompleted, volume: written.totalVolumeKg, exercises: written.exercisesCompleted },
        { sets: 4, volume: 1960, exercises: 2 },
        'bench and the swapped row were done; the squat was typed',
      );
      const reloaded = normalizeDatabase(JSON.parse(JSON.stringify(saved.database))).workoutSessions[0];
      for (const field of ['setsCompleted', 'totalVolumeKg', 'exercisesCompleted']) {
        assert.equal(reloaded[field], written[field], `${field} changed between save and load`);
      }
    },
  },
];
