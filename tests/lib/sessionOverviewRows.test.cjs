const assert = require('node:assert/strict');

/**
 * These assert English copy, so they assert its decimal point with it.
 * `removeTrailingZeros` reads a module-level decimal mark that defaults to
 * Finnish, so a suite that wants "62.5 kg" has to say so — otherwise it
 * passes or fails on whichever suite ran before it.
 */
const { setNumberLanguage } = require('../../src/lib/format');
setNumberLanguage('en');

const {
  buildOverviewScheme,
  buildOverviewColumns,
  buildProgressionPill,
} = require('../../src/lib/sessionOverviewRows');

const move = (loadKg, fromKg, reps = 8, fromReps = null) => ({
  loadKg,
  autoProgressedFromKg: fromKg,
  reps,
  autoProgressedFromReps: fromReps,
});

module.exports = [
  {
    name: 'overview scheme carries the weight, and never invents one',
    run() {
      const base = { exerciseName: 'Barbell Squat', setCount: 4, repsLabel: '7', timed: false };
      assert.equal(buildOverviewScheme({ ...base, loadKg: 62.5 }, 'en'), '4 × 7 · 62.5 kg');
      // A rep range keeps its dash.
      assert.equal(buildOverviewScheme({ ...base, repsLabel: '6–8', loadKg: 60 }, 'en'), '4 × 6–8 · 60 kg');
      // Bodyweight and unlogged loads say the plan and stop there — "0 kg"
      // would be the row claiming a weight nobody is lifting.
      assert.equal(buildOverviewScheme({ ...base, loadKg: null }, 'en'), '4 × 7');
      assert.equal(buildOverviewScheme({ ...base, loadKg: 0 }, 'en'), '4 × 7');
      // A hold counts seconds and carries no weight even when one is stored.
      assert.equal(buildOverviewScheme({ ...base, timed: true, repsLabel: '45', loadKg: 20 }, 'en'), '4 × 45 s');
    },
  },
  {
    name: 'overview columns put sets, reps and kg or time in the same place on every row',
    run() {
      const base = { exerciseName: 'Bench Press', setCount: 4, repsLabel: '7', timed: false, loadKg: 62.5 };
      const loaded = buildOverviewColumns(base);
      assert.equal(loaded.sets, '4');
      assert.equal(loaded.reps, '7');
      assert.match(loaded.load, /^62[.,]5 kg$/);
      // Nothing to lift: the cell is blank, not a dash and not "0 kg".
      assert.deepEqual(buildOverviewColumns({ ...base, loadKg: null }), { sets: '4', reps: '7', load: '' });
      assert.deepEqual(buildOverviewColumns({ ...base, loadKg: 0 }), { sets: '4', reps: '7', load: '' });
      // A hold: its seconds are the time column, and it has no reps.
      assert.deepEqual(
        buildOverviewColumns({ ...base, timed: true, repsLabel: '45', loadKg: 20 }),
        { sets: '4', reps: '', load: '45 s' },
      );
    },
  },
  {
    name: 'the progression pill claims a move only when the gate made one',
    run() {
      // One lift moved: the delta, alone.
      assert.equal(buildProgressionPill([move(62.5, 60), move(50, null)], 'en'), '+2.5 kg today');
      // Several moved: the biggest step, and how many lifts it was one of.
      assert.equal(
        buildProgressionPill([move(62.5, 60), move(55, 50)], 'en'),
        '+5 kg today · 2 lifts',
      );
      // Nothing moved.
      assert.equal(buildProgressionPill([move(60, null), move(50, null)], 'en'), null);
      assert.equal(buildProgressionPill([], 'en'), null);
      // A weight the user pulled DOWN is not a progression, even though the
      // gate's "from" value is still attached.
      assert.equal(buildProgressionPill([move(57.5, 60)], 'en'), null);
      // Bodyweight lifts progress by reps, and only when no load moved. One
      // rep is singular in both languages — "+1 toistoa" is what a plural
      // template would have printed.
      assert.equal(buildProgressionPill([move(null, null, 9, 8)], 'en'), '+1 rep today');
      assert.equal(buildProgressionPill([move(null, null, 9, 8)], 'fi'), '+1 toisto tänään');
      assert.equal(buildProgressionPill([move(null, null, 10, 8)], 'en'), '+2 reps today');
      assert.equal(buildProgressionPill([move(62.5, 60), move(null, null, 9, 8)], 'en'), '+2.5 kg today');
      // Finnish.
      assert.equal(buildProgressionPill([move(62.5, 60)], 'fi'), '+2.5 kg tänään');
    },
  },
];
