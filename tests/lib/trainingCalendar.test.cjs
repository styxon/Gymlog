const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');
const { weeklyTrainingStreak } = require('../../src/lib/trainingCalendar');

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

module.exports = [
  {
    name: 'the Progress streak counts through a clock change',
    run() {
      withHelsinkiClocks(() => {
        // This is the number the Progress screen draws above the activity grid.
        // Stepping the cursor back by a flat 7 * DAY lands at Sunday 23:00 after
        // the March change, and trainedWeeks holds only local Monday midnights,
        // so an unbroken run collapsed to 1 on the Monday after the clocks moved.
        const sessions = [
          createSession('s1', '2026-03-17T10:00:00'),
          createSession('s2', '2026-03-24T10:00:00'),
          createSession('s3', '2026-03-31T10:00:00'),
        ];

        assert.equal(weeklyTrainingStreak(sessions, [], new Date(2026, 3, 1, 12, 0, 0)), 3);

        // Autumn, where the cursor drifts to 01:00 instead.
        const autumn = [
          createSession('a1', '2026-10-13T10:00:00'),
          createSession('a2', '2026-10-20T10:00:00'),
          createSession('a3', '2026-10-27T10:00:00'),
        ];

        assert.equal(weeklyTrainingStreak(autumn, [], new Date(2026, 9, 28, 12, 0, 0)), 3);
      });
    },
  },
  {
    name: 'an empty current week does not break the streak',
    run() {
      withHelsinkiClocks(() => {
        // The current week is not over, so it only counts once it has a session.
        // Guards the branch that starts the cursor a week back.
        const sessions = [
          createSession('s1', '2026-03-17T10:00:00'),
          createSession('s2', '2026-03-24T10:00:00'),
        ];

        assert.equal(weeklyTrainingStreak(sessions, [], new Date(2026, 3, 1, 12, 0, 0)), 2);
      });
    },
  },
];
