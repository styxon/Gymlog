const assert = require('node:assert/strict');

const { getLiftHistoryByName } = require('../../src/lib/progression');

function at(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

const set = (weight, reps, orderIndex = 0) => ({ orderIndex, weight, reps, kind: 'working', outcome: 'completed' });

module.exports = [
  {
    /*
     * CI review of #154: the player's History tab was built from the tracked
     * summaries, and "tracked" is a mark a programme puts on a slot, not a
     * property of the lift — Leg Curl is tracked in one programme and an
     * accessory in another. A history under the lift's name is every session
     * of it.
     */
    name: 'lift history by name counts every session, tracked or not',
    run() {
      const database = {
        exerciseTemplates: [{ id: 't1', name: 'Leg Curl', libraryItemId: null }],
        workoutSessions: [
          { id: 's1', performedAt: at(2026, 9, 1), workoutNameSnapshot: 'Lower A' },
          { id: 's2', performedAt: at(2026, 9, 8), workoutNameSnapshot: 'Full Body C' },
          { id: 's3', performedAt: at(2026, 9, 15), workoutNameSnapshot: 'Lower A' },
        ],
        exerciseLogs: [
          // Untracked accessory in Lower A.
          { id: 'l1', sessionId: 's1', exerciseTemplateId: null, exerciseNameSnapshot: 'Leg Curl', weight: 40, repsPerSet: [12, 12], sets: [set(40, 12, 0), set(40, 12, 1)], tracked: false, orderIndex: 3 },
          // Tracked in Full Body C, under the template's canonical name.
          { id: 'l2', sessionId: 's2', exerciseTemplateId: 't1', exerciseNameSnapshot: 'leg curl', weight: 45, repsPerSet: [10], sets: [set(45, 10)], tracked: true, orderIndex: 2 },
          // Skipped: not a session of the lift.
          { id: 'l3', sessionId: 's3', exerciseTemplateId: null, exerciseNameSnapshot: 'Leg Curl', weight: 45, repsPerSet: [], sets: [], tracked: false, orderIndex: 3, skipped: true },
          // A log with no session behind it is orphaned data, not history.
          { id: 'l4', sessionId: 'gone', exerciseTemplateId: null, exerciseNameSnapshot: 'Leg Curl', weight: 50, repsPerSet: [8], sets: [set(50, 8)], tracked: true, orderIndex: 0 },
        ],
      };
      const byName = getLiftHistoryByName(database);
      const legCurl = byName.get('leg curl');
      assert.ok(legCurl, 'keyed by the lowercased canonical name');
      assert.deepEqual(
        legCurl.map((entry) => [entry.performedAt.slice(0, 10), entry.sets.map((s) => `${s.reps}x${s.weight}`).join(' ')]),
        [
          ['2026-09-01', '12x40 12x40'],
          ['2026-09-08', '10x45'],
        ],
        'both programmes count, the skipped log and the orphan do not',
      );
      assert.equal(byName.size, 1);
    },
  },
];
