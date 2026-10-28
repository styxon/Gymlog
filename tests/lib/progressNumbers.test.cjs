const assert = require('node:assert/strict');

const { resolvePreviousExercisePr } = require('../../src/lib/workoutCompletionSummary');
const { topSetOf } = require('../../src/lib/trainingHistory');

/**
 * Progress audit, 2026-09-15: numbers the reader reads about their own
 * training, where two readings of one log disagreed.
 */
module.exports = [
  {
    name: 'progress numbers: a record is measured against the best under either index',
    run() {
      // Bench 80 × 5 in a programme (library row), 100 × 5 in a free workout
      // (name only). A 90 × 5 set earned a "new record" card against 93.
      const set = (weight, reps) => ({ weight, reps });
      const lookup = { byLibraryItemId: { lib_bench: set(80, 5) }, byName: { 'bench press': set(100, 5) } };
      assert.deepEqual(resolvePreviousExercisePr({ libraryItemId: 'lib_bench', exerciseName: 'Bench Press', lookup }), set(100, 5));
      // And the other way round, and with only one side known.
      assert.deepEqual(
        resolvePreviousExercisePr({
          libraryItemId: 'lib_bench',
          exerciseName: 'Bench Press',
          lookup: { byLibraryItemId: { lib_bench: set(120, 3) }, byName: { 'bench press': set(100, 5) } },
        }),
        set(120, 3),
      );
      // At the same weight the index with more reps is the best (2026-09-26).
      assert.deepEqual(
        resolvePreviousExercisePr({
          libraryItemId: 'lib_bench',
          exerciseName: 'Bench Press',
          lookup: { byLibraryItemId: { lib_bench: set(100, 3) }, byName: { 'bench press': set(100, 6) } },
        }),
        set(100, 6),
      );
      assert.deepEqual(resolvePreviousExercisePr({ libraryItemId: null, exerciseName: 'Bench Press', lookup }), set(100, 5));
      assert.deepEqual(resolvePreviousExercisePr({ libraryItemId: 'lib_bench', exerciseName: 'Row', lookup }), set(80, 5));
      assert.equal(resolvePreviousExercisePr({ libraryItemId: 'nope', exerciseName: 'Row', lookup }), null);
    },
  },
  {
    name: 'progress numbers: the top set keeps its own reps',
    run() {
      // A ramp of 100 × 3 and a back-off of 70 × 12 read "100 kg × 12".
      const log = {
        skipped: false,
        weight: 100,
        repsPerSet: [3, 12],
        sets: [
          { orderIndex: 0, weight: 100, reps: 3, kind: 'working', outcome: 'completed', status: 'completed' },
          { orderIndex: 1, weight: 70, reps: 12, kind: 'working', outcome: 'completed', status: 'completed' },
        ],
      };
      assert.deepEqual(topSetOf(log), { weight: 100, reps: 3 });
      // At equal weight the better set, and an older log with only repsPerSet still reads.
      assert.deepEqual(topSetOf({ skipped: false, weight: 80, repsPerSet: [6, 8, 7] }), { weight: 80, reps: 8 });
      assert.equal(topSetOf({ skipped: true, weight: 80, repsPerSet: [6] }), null);
      assert.equal(topSetOf({ skipped: false, weight: 0, repsPerSet: [12] }), null);
    },
  },
];
