const assert = require('node:assert/strict');

const {
  orderExercisesBySelection,
} = require('../../src/lib/exerciseSelectionOrder');

// Stands in for the library array whose order used to decide this. Deliberately
// NOT sorted — the point is that whatever order this happens to be in must not
// reach the caller, so Back Squat sits last where sorting would put it first.
const LIBRARY = [
  { id: 'ex_side_bend', name: 'Barbell Side Bend' },
  { id: 'ex_bench', name: 'Bench Press' },
  { id: 'ex_crunch', name: 'Cable Crunch' },
  { id: 'ex_squat', name: 'Back Squat' },
];

module.exports = [
  {
    name: 'exercises come back in the order they were tapped',
    run() {
      // The report: "valitsin vatsarutistuksen eka silti kyljet tuli
      // ensimmäiseksi" (#bugs 2026-08-28). Cable Crunch was tapped first and
      // Barbell Side Bend second, but the side bend sits earlier in the
      // library, so `items.filter(...)` handed it back first.
      const tapped = ['ex_crunch', 'ex_side_bend'];
      assert.deepEqual(
        orderExercisesBySelection(LIBRARY, tapped).map((item) => item.id),
        ['ex_crunch', 'ex_side_bend'],
      );

      // Proof the old expression really did the opposite, so this test would
      // have failed against it rather than passing either way.
      assert.deepEqual(
        LIBRARY.filter((item) => tapped.includes(item.id)).map((item) => item.id),
        ['ex_side_bend', 'ex_crunch'],
      );
    },
  },
  {
    name: 'the order survives any number of picks and matches the taps exactly',
    run() {
      const tapped = ['ex_squat', 'ex_bench', 'ex_crunch', 'ex_side_bend'];
      assert.deepEqual(
        orderExercisesBySelection(LIBRARY, tapped).map((item) => item.id),
        tapped,
      );
      assert.deepEqual(orderExercisesBySelection(LIBRARY, []), []);
      assert.deepEqual(
        orderExercisesBySelection(LIBRARY, ['ex_bench']).map((item) => item.id),
        ['ex_bench'],
      );
    },
  },
  {
    name: 'a stale id is dropped, and a repeat does not add the lift twice',
    run() {
      // The sheet stays open while the library can be regenerated on load, so
      // an id can outlive its item. Half an exercise is worse than none.
      assert.deepEqual(
        orderExercisesBySelection(LIBRARY, ['ex_bench', 'ex_gone', 'ex_squat']).map((item) => item.id),
        ['ex_bench', 'ex_squat'],
      );
      assert.deepEqual(
        orderExercisesBySelection(LIBRARY, ['ex_bench', 'ex_bench']).map((item) => item.id),
        ['ex_bench'],
      );
    },
  },
];
