const assert = require('node:assert/strict');

const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
setNumberLanguage('en');

const {
  SHEET_HISTORY_SESSIONS,
  buildExerciseSheetHistory,
} = require('../../.test-dist/lib/exerciseSheetHistory.js');

const session = (performedAt, sets) => ({
  performedAt,
  sets: sets.map(([loadKg, reps]) => ({ loadKg, reps })),
});

module.exports = [
  {
    name: 'the chart is the last eight sessions, oldest first, today last',
    run() {
      const past = Array.from({ length: 12 }).map((_, index) =>
        session(`2026-06-${`${index + 1}`.padStart(2, '0')}T18:00:00.000Z`, [[50 + index, 8]]),
      );
      const view = buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[70, 8]]), 'en');
      assert.equal(view.bars.length, SHEET_HISTORY_SESSIONS);
      // Today is the last bar and the only one marked as today.
      assert.equal(view.bars[view.bars.length - 1].isToday, true);
      assert.equal(view.bars.filter((bar) => bar.isToday).length, 1);
      // Tallest bar is full height; every bar has enough height to be seen.
      assert.equal(view.bars[view.bars.length - 1].ratio, 1);
      assert.ok(view.bars.every((bar) => bar.ratio >= 0.08));
      // The count is every session, not just the window.
      assert.equal(view.sessionCount, 13);
    },
  },
  {
    name: 'unsorted history still reads oldest to newest',
    run() {
      const view = buildExerciseSheetHistory(
        [
          session('2026-08-27T18:00:00.000Z', [[60, 8]]),
          session('2026-08-13T18:00:00.000Z', [[50, 8]]),
          session('2026-08-20T18:00:00.000Z', [[55, 8]]),
        ],
        null,
        'en',
      );
      assert.deepEqual(view.bars.map((bar) => bar.value), [50, 55, 60]);
      // Rows read the other way: newest at the top, where a reader starts.
      assert.equal(view.rows[0].loadLabel, '60 kg');
      assert.equal(view.rows[2].loadLabel, '50 kg');
    },
  },
  {
    name: 'today is a PR only once it actually beats every session before it',
    run() {
      const past = [session('2026-08-27T18:00:00.000Z', [[60, 8]])];
      // The same weight for more reps is (user, 2026-09-26: the records rule,
      // everywhere); the same weight for the same or fewer reps is not.
      assert.equal(buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[60, 9]]), 'en').rows[0].isPr, true);
      assert.equal(buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[60, 8]]), 'en').rows[0].isPr, false);
      assert.equal(buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[60, 7]]), 'en').rows[0].isPr, false);
      // Heavier is.
      const pr = buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[62.5, 6]]), 'en');
      assert.equal(pr.rows[0].isPr, true);
      assert.equal(pr.rows[0].isToday, true);
      // A first-ever session is not a PR — there is nothing to have beaten.
      const first = buildExerciseSheetHistory([], session('2026-09-04T18:00:00.000Z', [[40, 10]]), 'en');
      assert.equal(first.rows[0].isPr, false);
      // And a past session never carries the badge.
      assert.ok(pr.rows.slice(1).every((row) => row.isPr === false));
    },
  },
  {
    name: 'today grows set by set rather than appearing whole',
    run() {
      const past = [session('2026-08-27T18:00:00.000Z', [[60, 8], [60, 7]])];
      // Nothing logged yet: today is not in the series at all, and one past
      // session is not a chart — the row is the honest way to show it.
      const before = buildExerciseSheetHistory(past, { performedAt: '2026-09-04T18:00:00.000Z', sets: [] }, 'en');
      assert.deepEqual(before.bars, []);
      assert.equal(before.rows.length, 1);
      // One set in: today is there, with one pill.
      const after = buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[62.5, 7]]), 'en');
      assert.deepEqual(after.rows[0].pills, ['7']);
      assert.equal(after.rows[0].dateLabel, 'Today');
      assert.equal(buildExerciseSheetHistory(past, session('2026-09-04T18:00:00.000Z', [[62.5, 7]]), 'fi').rows[0].dateLabel, 'Tänään');
    },
  },
  {
    name: 'the stats read the whole history, and an empty one claims nothing',
    run() {
      const view = buildExerciseSheetHistory(
        [session('2026-08-20T18:00:00.000Z', [[60, 8], [60, 6]]), session('2026-08-27T18:00:00.000Z', [[55, 12]])],
        null,
        'en',
      );
      assert.equal(view.bestSetLabel, '60 kg × 8');
      assert.ok(view.estimatedOneRepMaxKg > 60);
      // A lift with one session draws no chart, and one with two does.
      assert.deepEqual(
        buildExerciseSheetHistory([session('2026-08-20T18:00:00.000Z', [[60, 8]])], null, 'en').bars,
        [],
      );
      assert.equal(
        buildExerciseSheetHistory(
          [session('2026-08-20T18:00:00.000Z', [[60, 8]]), session('2026-08-27T18:00:00.000Z', [[62.5, 8]])],
          null,
          'en',
        ).bars.length,
        2,
      );
      const empty = buildExerciseSheetHistory([], null, 'en');
      assert.equal(empty.bestSetLabel, null);
      assert.equal(empty.estimatedOneRepMaxKg, null);
      assert.equal(empty.sessionCount, 0);
      assert.deepEqual(empty.bars, []);
      assert.deepEqual(empty.rows, []);
    },
  },
  {
    name: 'an unloaded lift charts its reps rather than a row of zeroes',
    run() {
      const view = buildExerciseSheetHistory(
        [session('2026-08-20T18:00:00.000Z', [[0, 10]]), session('2026-08-27T18:00:00.000Z', [[0, 14]])],
        null,
        'en',
        'bodyweight',
      );
      assert.deepEqual(view.bars.map((bar) => bar.value), [10, 14]);
      // And says so without inventing a weight.
      assert.equal(view.rows[0].loadLabel, null);
      assert.equal(view.bestSetLabel, '14 reps');
    },
  },
  {
    // Hunt 2026-10-09: bars mixed kilos and reps in one series, so 15 plain
    // dips stood taller than the 10 kg dip after them, and +20 kg was a record
    // only because 20 is more than 15.
    name: 'a lift done both plain and loaded measures every bar in kilos, and the first load is no record',
    run() {
      const past = [
        session('2026-09-01T10:00:00.000Z', [[0, 12]]),
        session('2026-09-08T10:00:00.000Z', [[0, 14]]),
        session('2026-09-15T10:00:00.000Z', [[0, 15]]),
      ];
      const first = buildExerciseSheetHistory(past, session('today', [[10, 8]]), 'en');
      assert.deepEqual(first.bars.map((bar) => bar.value), [0, 0, 0, 10], 'the weighted session is the tallest');
      assert.equal(first.rows[0].isPr, false, 'nothing loaded before it to beat');
      assert.equal(buildExerciseSheetHistory(past, session('today', [[20, 8]]), 'en').rows[0].isPr, false);

      const loaded = [...past, session('2026-09-22T10:00:00.000Z', [[10, 8]])];
      assert.equal(buildExerciseSheetHistory(loaded, session('today', [[12.5, 8]]), 'en').rows[0].isPr, true, 'heavier than the last load');
      assert.equal(buildExerciseSheetHistory(loaded, session('today', [[0, 20]]), 'en').rows[0].isPr, false, 'a plain set beats no load');
    },
  },
];
