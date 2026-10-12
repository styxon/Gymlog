const assert = require('node:assert/strict');

const {
  formatRecordWhenLabel,
} = require('../../.test-dist/lib/profileOverview.js');

// A tracked-lift log as progression.ts hands it over: real sets plus the
// session timestamp merged in.
function createLog(performedAt, sets) {
  return {
    id: `log_${performedAt}`,
    sessionId: `session_${performedAt}`,
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Barbell Squat',
    weight: sets[0].weight,
    repsPerSet: sets.map((set) => set.reps),
    sets: sets.map((set, index) => ({
      orderIndex: index,
      weight: set.weight,
      reps: set.reps,
      kind: 'working',
      outcome: 'completed',
    })),
    tracked: true,
    orderIndex: 0,
    skipped: false,
    performedAt,
    workoutNameSnapshot: 'Leg Day',
  };
}

function createSummary(key, name, logs) {
  return { key, name, logs, latestWeight: null, previousWeight: null, latestReps: '-', bestWeight: null, bestReps: 0 };
}

module.exports = [
  {
    name: 'formatRecordWhenLabel: calendar-day wording, not elapsed hours',
    run() {
      // Local-time literals (no trailing Z) so the assertion holds in any
      // timezone — the label is about calendar days on the user's device.
      const now = new Date('2026-07-21T08:00:00');

      assert.equal(formatRecordWhenLabel('2026-07-21T07:00:00', now), 'Today');
      assert.equal(formatRecordWhenLabel('2026-07-20T23:50:00', now), 'Yesterday');
      assert.equal(formatRecordWhenLabel('2026-07-18T10:00:00', now), '3 days ago');
      // The date as formatShortDate writes it, as the Home cards and the
      // exercise page do (dup sweep 13, D2-3): "Jul 1", not a third form.
      assert.equal(formatRecordWhenLabel('2026-07-01T10:00:00', now), 'Jul 1');
      assert.equal(formatRecordWhenLabel('not-a-date', now), '');
    },
  },
];
