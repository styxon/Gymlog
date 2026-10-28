const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { getTrainingRhythm } = require('../../src/lib/trainingRhythm');

// Completed log with one comparable working set so the session counts as
// completed under getCanonicalCompletedSessions.
function createLog(sessionId) {
  return {
    id: `log_${sessionId}`,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Barbell Squat',
    weight: 100,
    repsPerSet: [5],
    sets: [{ orderIndex: 0, weight: 100, reps: 5, kind: 'working', outcome: 'completed' }],
    tracked: true,
    orderIndex: 0,
    skipped: false,
    sessionInserted: false,
  };
}

function createSession(id, performedAt) {
  return {
    id,
    workoutTemplateId: 'tpl_1',
    workoutTemplateSessionId: null,
    workoutNameSnapshot: 'Leg Day',
    performedAt,
    totalVolumeKg: 500,
  };
}

function buildDatabase(performedAts) {
  const sessions = performedAts.map((performedAt, index) => createSession(`s${index}`, performedAt));
  return {
    workoutSessions: sessions,
    exerciseLogs: sessions.map((session) => createLog(session.id)),
  };
}

module.exports = [
  {
    name: 'weekly bars before a clock change are not silently empty',
    run() {
      withHelsinkiClocks(() => {
        // Finland moves its clocks on Sunday 29 March 2026. Keying the bars by
        // currentWeekStart - index * WEEK_MS puts every week older than the
        // change an hour off the local Monday midnights the counts are stored
        // under, so a reader who trained every week sees empty bars.
        const database = buildDatabase([
          '2026-03-17T10:00:00',
          '2026-03-24T10:00:00',
          '2026-03-31T10:00:00',
        ]);

        const rhythm = getTrainingRhythm(database, { weeks: 3, now: new Date(2026, 3, 1, 12, 0, 0) });

        assert.deepEqual(rhythm.sessionsPerWeek, [1, 1, 1]);
      });
    },
  },
  {
    name: 'training rhythm counts sessions per calendar week oldest to current',
    run() {
      // 2026-06-01 is a Monday. Weeks: Jun 1 (2 sessions), Jun 8 (0), Jun 15 (1 = current).
      const database = buildDatabase([
        '2026-06-01T10:00:00',
        '2026-06-03T10:00:00',
        '2026-06-16T10:00:00',
      ]);

      const rhythm = getTrainingRhythm(database, { weeks: 3, now: new Date('2026-06-17T12:00:00') });

      assert.deepEqual(rhythm.sessionsPerWeek, [2, 0, 1]);
      assert.equal(rhythm.currentWeekSessions, 1);
      // Jun 8 week is empty, so the consecutive run is just the current week.
      assert.equal(rhythm.weeksInRow, 1);
    },
  },
  {
    name: 'training rhythm reports the consecutive-week run across the window',
    run() {
      // Sessions in three consecutive weeks: Jun 1, Jun 8, Jun 15 (current).
      const database = buildDatabase([
        '2026-06-02T10:00:00',
        '2026-06-09T10:00:00',
        '2026-06-15T10:00:00',
      ]);

      const rhythm = getTrainingRhythm(database, { weeks: 4, now: new Date('2026-06-17T12:00:00') });

      assert.deepEqual(rhythm.sessionsPerWeek, [0, 1, 1, 1]);
      assert.equal(rhythm.weeksInRow, 3);
    },
  },
  {
    name: 'training rhythm is all zeros for a fresh database',
    run() {
      const rhythm = getTrainingRhythm(
        { workoutSessions: [], exerciseLogs: [] },
        { weeks: 5, now: new Date('2026-06-17T12:00:00') },
      );

      assert.deepEqual(rhythm.sessionsPerWeek, [0, 0, 0, 0, 0]);
      assert.equal(rhythm.currentWeekSessions, 0);
      assert.equal(rhythm.weeksInRow, 0);
    },
  },
];
