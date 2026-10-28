const assert = require('node:assert/strict');

const {
  getExerciseProgressSignal,
  getTrackedExerciseProgress,
} = require('../../src/lib/progression');

/**
 * The chip on the Kehitys list.
 *
 * It used to ask "is the latest session the best one?" against a best that
 * included the latest session — true of a record broken, and equally true of
 * a record merely repeated. On a lift that is never loaded, whose weight
 * reads 0 every session, it was true forever: a treadmill HIIT wore "Uusi
 * ennätys" permanently while a sumo deadlift that had just moved five tonnes
 * wore "Alkuvaihe" beside it (#bugs 2026-08-26).
 */
function createSummary(overrides = {}) {
  return {
    key: 'bench press',
    name: 'Bench Press',
    logs: [{ id: '1' }, { id: '2' }],
    latestWeight: 85,
    previousWeight: 82.5,
    latestReps: '8,7,6',
    bestWeight: 85,
    bestReps: 21,
    latestValue: 85,
    previousValue: 82.5,
    bestValueBefore: 82.5,
    ...overrides,
  };
}

/** One session of one lift, as the database stores it. */
function log(id, performedAt, sets) {
  return {
    id,
    sessionId: `s_${id}`,
    exerciseTemplateId: `t_${id}`,
    exerciseNameSnapshot: 'Push-up',
    tracked: true,
    skipped: false,
    orderIndex: 0,
    performedAt,
    sets: sets.map((set, index) => ({
      id: `${id}_${index}`,
      setIndex: index,
      orderIndex: index,
      weight: set.weight,
      reps: set.reps,
      status: 'completed',
      kind: 'working',
    })),
  };
}

function databaseWith(logs) {
  return {
    exerciseTemplates: [],
    exerciseLibrary: [],
    exerciseLogs: logs,
    workoutSessions: logs.map((item) => ({
      id: item.sessionId,
      performedAt: item.performedAt,
      startedAt: item.performedAt,
    })),
    preferences: { strengthGoals: [] },
  };
}

module.exports = [
  {
    name: 'a record has to be beaten, not matched',
    run() {
      // 85 today, 85 before: the same lift, not a new record. With three
      // sessions behind it that reads as building; the point is what it is
      // NOT, which is a record.
      assert.equal(
        getExerciseProgressSignal(
          createSummary({
            logs: [{ id: '1' }, { id: '2' }, { id: '3' }],
            bestValueBefore: 85,
            previousValue: 85,
          }),
        ).kind,
        'building',
      );
      // 85 today against 82.5 before: beaten.
      assert.equal(getExerciseProgressSignal(createSummary()).kind, 'new_best');
    },
  },
  {
    name: 'progress signal marks moving up when the latest beats the previous but not the best',
    run() {
      const signal = getExerciseProgressSignal(
        createSummary({ latestValue: 82.5, previousValue: 80, bestValueBefore: 85 }),
      );
      assert.equal(signal.kind, 'moving_up');
    },
  },
  {
    name: 'progress signal marks below last when the latest drops',
    run() {
      assert.equal(
        getExerciseProgressSignal(
          createSummary({ latestValue: 77.5, previousValue: 80, bestValueBefore: 85 }),
        ).kind,
        'below_last',
      );
    },
  },
  {
    name: 'progress signal falls back to building or starting when there is nothing to compare',
    run() {
      assert.equal(
        getExerciseProgressSignal(
          createSummary({
            logs: [{ id: '1' }, { id: '2' }, { id: '3' }],
            latestValue: null,
            previousValue: null,
            bestValueBefore: null,
          }),
        ).kind,
        'building',
      );

      assert.equal(
        getExerciseProgressSignal(
          createSummary({
            logs: [{ id: '1' }],
            latestValue: null,
            previousValue: null,
            bestValueBefore: null,
          }),
        ).kind,
        'starting',
      );
    },
  },
  {
    /**
     * The bug as the reader met it: two sessions of the same unloaded lift,
     * the same reps both times. Under the old rule that was a permanent
     * record, because 0 kg equals 0 kg.
     */
    name: 'an unloaded lift repeating itself is not a record',
    run() {
      const [summary] = getTrackedExerciseProgress(
        databaseWith([
          log('a', '2026-08-20T10:00:00.000Z', [{ weight: 0, reps: 30 }]),
          log('b', '2026-08-26T10:00:00.000Z', [{ weight: 0, reps: 30 }]),
        ]),
      );
      assert.equal(summary.bestWeight, 0);
      assert.equal(getExerciseProgressSignal(summary).kind, 'starting');
    },
  },
  {
    /**
     * And the other half: an unloaded lift that DID improve has to say so.
     * Reps are the only thing that moves on one, so reps are what it is
     * judged on.
     */
    name: 'an unloaded lift that adds reps is a record',
    run() {
      const [summary] = getTrackedExerciseProgress(
        databaseWith([
          log('a', '2026-08-20T10:00:00.000Z', [{ weight: 0, reps: 20 }]),
          log('b', '2026-08-26T10:00:00.000Z', [{ weight: 0, reps: 30 }]),
        ]),
      );
      assert.equal(summary.latestValue, 30);
      assert.equal(summary.bestValueBefore, 20);
      assert.equal(getExerciseProgressSignal(summary).kind, 'new_best');
    },
  },
  {
    /**
     * A lift with one session has nothing behind it, so it reads as a
     * baseline — whatever the numbers were. This was written against the
     * sumo deadlift's 5121,25 kg, and the reading was right: a first is not
     * an improvement. The weight had to change all the same, because the
     * loader now drops a set nobody could have lifted (#bugs 2026-09-05) and
     * the old fixture no longer reaches this function at all. A heavy but
     * possible pull makes the same point.
     */
    name: 'a lift with one session is a baseline however heavy it was',
    run() {
      const [summary] = getTrackedExerciseProgress(
        databaseWith([log('a', '2026-08-26T10:00:00.000Z', [{ weight: 280, reps: 8 }])]),
      );
      assert.equal(summary.latestValue, 280);
      assert.equal(summary.bestValueBefore, null);
      assert.equal(getExerciseProgressSignal(summary).kind, 'starting');
    },
  },
];
