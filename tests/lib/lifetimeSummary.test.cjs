const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { getLifetimeTrainingSummary, getLifetimeWorkoutCount } = require('../../.test-dist/lib/lifetimeSummary.js');

// Completed log with a single comparable working set so the session counts as
// "completed" under getCanonicalCompletedSessions.
function createLog(sessionId, weight = 100) {
  return {
    id: `log_${sessionId}`,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Barbell Squat',
    weight,
    repsPerSet: [5],
    sets: [{ orderIndex: 0, weight, reps: 5, kind: 'working', outcome: 'completed' }],
    tracked: true,
    orderIndex: 0,
    skipped: false,
    sessionInserted: false,
  };
}

function createSession(id, performedAt, totalVolumeKg) {
  return {
    id,
    workoutTemplateId: 'tpl_1',
    workoutTemplateSessionId: null,
    workoutNameSnapshot: 'Leg Day',
    performedAt,
    totalVolumeKg,
  };
}

function buildDatabase(sessions) {
  return {
    workoutSessions: sessions,
    exerciseLogs: sessions.map((session) => createLog(session.id)),
  };
}

module.exports = [
  {
    name: 'the best streak counts through a clock change',
    run() {
      withHelsinkiClocks(() => {
        // Adjacent local Monday midnights are 167 or 169 hours apart when the
        // span crosses a clock change, never the 168 the equality test expects,
        // so an unbroken run is cut at every change — twice a year, for life.
        const database = buildDatabase([
          createSession('s1', '2026-03-17T12:00:00', 1000),
          createSession('s2', '2026-03-24T12:00:00', 1000),
          createSession('s3', '2026-03-31T12:00:00', 1000),
        ]);

        const summary = getLifetimeTrainingSummary(database, new Date(2026, 3, 1, 12, 0, 0));

        assert.equal(summary.weeksActive, 3);
        assert.equal(summary.bestWeekStreak, 3);
      });
    },
  },
  {
    name: 'lifetime summary aggregates sessions, volume, and distinct active weeks',
    run() {
      // 2026-06-01 is a Monday. Two sessions in the week of Jun 1, one in Jun 8.
      const database = buildDatabase([
        createSession('s1', '2026-06-02T12:00:00', 1000),
        createSession('s2', '2026-06-04T12:00:00', 1500),
        createSession('s3', '2026-06-09T12:00:00', 2000),
      ]);

      const summary = getLifetimeTrainingSummary(database, new Date('2026-06-09T12:00:00'));

      assert.equal(summary.sessionCount, 3);
      assert.equal(summary.totalVolumeKg, 4500);
      assert.equal(summary.weeksActive, 2);
      assert.equal(summary.weeksSinceStart, 2);
      assert.equal(summary.bestWeekStreak, 2);
      assert.equal(summary.firstSessionAt, '2026-06-02T12:00:00');
    },
  },
  {
    name: 'lifetime summary returns a zeroed result when no sessions are completed',
    run() {
      const summary = getLifetimeTrainingSummary({ workoutSessions: [], exerciseLogs: [] }, new Date('2026-06-09T12:00:00'));

      assert.equal(summary.sessionCount, 0);
      assert.equal(summary.totalVolumeKg, 0);
      assert.equal(summary.weeksActive, 0);
      assert.equal(summary.weeksSinceStart, 0);
      assert.equal(summary.bestWeekStreak, 0);
      assert.equal(summary.firstSessionAt, null);
    },
  },
  {
    name: 'lifetime summary best streak counts the longest consecutive run, not total active weeks',
    run() {
      // Active weeks: Jun 1, Jun 8 (run of 2), gap on Jun 15, then Jun 22, Jun 29, Jul 6 (run of 3).
      const database = buildDatabase([
        createSession('s1', '2026-06-01T12:00:00', 500),
        createSession('s2', '2026-06-08T12:00:00', 500),
        createSession('s3', '2026-06-22T12:00:00', 500),
        createSession('s4', '2026-06-29T12:00:00', 500),
        createSession('s5', '2026-07-06T12:00:00', 500),
      ]);

      const summary = getLifetimeTrainingSummary(database, new Date('2026-07-06T12:00:00'));

      assert.equal(summary.weeksActive, 5);
      assert.equal(summary.bestWeekStreak, 3);
      // Jun 1 week through Jul 6 week inclusive spans 6 calendar weeks (one gap week included).
      assert.equal(summary.weeksSinceStart, 6);
    },
  },
  {
    // Bug hunt, 2026-10-04: the widget showed Workouts 12 (month, lifting + cardio) beside Total 0.
    name: 'the lifetime workout count includes cardio, like the month total',
    run() {
      const cardioSessions = [
        { id: 'c1', performedAt: '2026-06-02T10:00:00.000Z', durationSec: 1800 },
        { id: 'c1', performedAt: '2026-06-02T10:00:00.000Z', durationSec: 1800 },
        { id: 'c2', performedAt: '2026-06-03T10:00:00.000Z', durationSec: 1800 },
      ];
      const database = { ...buildDatabase([createSession('s1', '2026-06-01T10:00:00.000Z', 500)]), cardioSessions };
      assert.equal(getLifetimeWorkoutCount(database), 3, 'one lift + two distinct runs');
      assert.equal(getLifetimeWorkoutCount({ ...buildDatabase([]), cardioSessions }), 2, 'a runner with no lifts is not zero');
      assert.equal(getLifetimeWorkoutCount(buildDatabase([])), 0);
    },
  },
];
