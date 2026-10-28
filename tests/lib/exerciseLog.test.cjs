const assert = require('node:assert/strict');

const { getComparableLogSets, logRecordedWork } = require('../../src/lib/exerciseLog');

const row = (weight, reps, status, orderIndex = 0) => ({ orderIndex, weight, reps, kind: 'working', outcome: null, status });

module.exports = [
  {
    /*
     * Audit round 4 (2026-09-20): a log whose rows were all pending — a lift
     * added mid-session and never performed, or a freestyle row typed and
     * never ticked — fell back to every row and counted as work. Sets and
     * kilos on the History row, the weekly volume, the milestone ladders and
     * a personal record nobody lifted, which then withheld every real record
     * below it.
     */
    name: 'comparable sets are the done ones; a log of pending rows is no work at all',
    run() {
      const pending = { weight: 100, repsPerSet: [8, 8], sets: [row(100, 8, 'pending', 0), row(100, 8, 'pending', 1)] };
      assert.deepEqual(getComparableLogSets(pending), []);
      assert.equal(logRecordedWork(pending), false);

      const mixed = { weight: 100, repsPerSet: [8, 8], sets: [row(100, 8, 'completed', 0), row(120, 8, 'pending', 1)] };
      assert.deepEqual(getComparableLogSets(mixed).map((set) => set.weight), [100], 'the pending 120 is a number typed, not lifted');

      const skipped = { weight: 60, repsPerSet: [10], sets: [row(60, 10, 'skipped', 0)] };
      assert.deepEqual(getComparableLogSets(skipped), []);

      // A legacy log with no statuses still counts every row: they are older
      // than the field, not pending.
      const legacy = { weight: 80, repsPerSet: [5, 5, 5] };
      assert.equal(getComparableLogSets(legacy).length, 3);
      assert.equal(logRecordedWork(legacy), true);
    },
  },
];
