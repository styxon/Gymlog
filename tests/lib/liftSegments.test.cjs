const assert = require('node:assert/strict');

const { splitExerciseByLift, liftBeforeSwap, liftOfSet } = require('../../src/lib/liftSegments');

/**
 * Which lift each set of a slot was (swap audit, 2026-09-21). The sets before
 * a swap belong to the lift they were logged as; the ones after, to the lift
 * that replaced it — the swap sheet's own promise: "your logged sets stay on
 * the exercise you did them on".
 */

function set(setIndex, overrides = {}) {
  return {
    setIndex,
    plannedRepsMin: 5,
    plannedRepsMax: 5,
    draftLoadText: '',
    draftRepsText: '',
    status: 'completed',
    actualLoadKg: 100,
    actualReps: 5,
    edited: true,
    ...overrides,
  };
}

const squat = { exerciseName: 'Back Squat', trackingMode: 'load_and_reps' };
const pullUp = { exerciseName: 'Pull-Up', trackingMode: 'bodyweight' };

function exercise(overrides) {
  return {
    exerciseName: 'Back Squat',
    trackingMode: 'load_and_reps',
    sourceExerciseName: undefined,
    swappedAfterSetIndex: undefined,
    sets: [set(0), set(1), set(2)],
    ...overrides,
  };
}

const summary = (segments) =>
  segments.map((segment) => ({
    name: segment.exerciseName,
    mode: segment.trackingMode,
    swappedFrom: segment.swappedFrom,
    current: segment.current,
    sets: segment.sets.map((item) => `${item.setIndex}:${item.actualLoadKg}x${item.actualReps}`),
  }));

module.exports = [
  {
    name: 'lift segments: a slot that was never swapped is one lift, its sets as they were',
    run() {
      const plain = exercise({ sets: [set(1, { loggedAs: squat }), set(0, { loggedAs: squat }), set(2, { status: 'pending' })] });
      const segments = splitExerciseByLift(plain);
      assert.equal(segments.length, 1);
      assert.equal(segments[0].exerciseName, 'Back Squat');
      assert.equal(segments[0].swappedFrom, null);
      assert.equal(segments[0].current, true);
      // Ordered, and the very same set objects: nothing is renumbered when
      // nothing was split.
      assert.deepEqual(segments[0].sets.map((item) => item.setIndex), [0, 1, 2]);
      assert.equal(segments[0].sets[0], plain.sets[1]);
    },
  },
  {
    name: 'lift segments: a swap before the first set is one lift, with the swap on record',
    run() {
      const segments = splitExerciseByLift(
        exercise({ exerciseName: 'Leg Press', sourceExerciseName: 'Back Squat', sets: [set(0, { loggedAs: { exerciseName: 'Leg Press', trackingMode: 'load_and_reps' } })] }),
      );
      assert.deepEqual(summary(segments), [
        { name: 'Leg Press', mode: 'load_and_reps', swappedFrom: 'Back Squat', current: true, sets: ['0:100x5'] },
      ]);
    },
  },
  {
    name: 'lift segments: a swap mid-exercise gives each lift its own sets, numbered from its first',
    run() {
      const segments = splitExerciseByLift(
        exercise({
          exerciseName: 'Goblet Squat',
          sourceExerciseName: 'Back Squat',
          swappedAfterSetIndex: 1,
          sets: [
            set(0, { loggedAs: squat }),
            set(1, { loggedAs: squat }),
            set(2, { actualLoadKg: 30, actualReps: 10, loggedAs: { exerciseName: 'Goblet Squat', trackingMode: 'load_and_reps' } }),
            set(3, { status: 'pending', actualLoadKg: undefined, actualReps: undefined }),
          ],
        }),
      );
      assert.deepEqual(summary(segments), [
        { name: 'Back Squat', mode: 'load_and_reps', swappedFrom: null, current: false, sets: ['0:100x5', '1:100x5'] },
        {
          name: 'Goblet Squat',
          mode: 'load_and_reps',
          swappedFrom: 'Back Squat',
          current: true,
          // The goblet squat's first set is its set 1, and the pending set
          // still ahead belongs to it.
          sets: ['0:30x10', '1:undefinedxundefined'],
        },
      ]);
    },
  },
  {
    name: 'lift segments: each lift keeps the mode it was logged in',
    run() {
      // A pull-up logged as bodyweight, then a lat pulldown: the pull-up row
      // still reads as repetitions after the slot took on the pulldown's mode.
      const segments = splitExerciseByLift({
        exerciseName: 'Lat Pulldown',
        trackingMode: 'load_and_reps',
        sourceExerciseName: 'Pull-Up',
        swappedAfterSetIndex: 0,
        sets: [
          set(0, { actualLoadKg: 0, actualReps: 8, loggedAs: pullUp }),
          set(1, { actualLoadKg: 50, actualReps: 12, loggedAs: { exerciseName: 'Lat Pulldown', trackingMode: 'load_and_reps' } }),
        ],
      });
      assert.deepEqual(
        segments.map((segment) => [segment.exerciseName, segment.trackingMode]),
        [
          ['Pull-Up', 'bodyweight'],
          ['Lat Pulldown', 'load_and_reps'],
        ],
      );
    },
  },
  {
    name: 'lift segments: two swaps in one slot are three lifts, not two',
    run() {
      // The swap line only remembers the latest swap; a single line would have
      // filed the front squat set under the back squat.
      const front = { exerciseName: 'Front Squat', trackingMode: 'load_and_reps' };
      const segments = splitExerciseByLift(
        exercise({
          exerciseName: 'Leg Press',
          sourceExerciseName: 'Back Squat',
          swappedAfterSetIndex: 2,
          sets: [
            set(0, { loggedAs: squat }),
            set(1, { loggedAs: squat }),
            set(2, { actualLoadKg: 60, loggedAs: front }),
            set(3, { actualLoadKg: 200, actualReps: 10 }),
          ],
        }),
      );
      assert.deepEqual(summary(segments), [
        { name: 'Back Squat', mode: 'load_and_reps', swappedFrom: null, current: false, sets: ['0:100x5', '1:100x5'] },
        { name: 'Front Squat', mode: 'load_and_reps', swappedFrom: 'Back Squat', current: false, sets: ['0:60x5'] },
        { name: 'Leg Press', mode: 'load_and_reps', swappedFrom: 'Back Squat', current: true, sets: ['0:200x10'] },
      ]);
    },
  },
  {
    name: 'lift segments: swapped away and back, the programmed lift is one lift again',
    run() {
      const segments = splitExerciseByLift(
        exercise({
          exerciseName: 'Back Squat',
          sourceExerciseName: 'Back Squat',
          swappedAfterSetIndex: 1,
          sets: [
            set(0, { loggedAs: squat }),
            set(1, { actualLoadKg: 180, actualReps: 10, loggedAs: { exerciseName: 'Leg Press', trackingMode: 'load_and_reps' } }),
            set(2, { loggedAs: squat }),
          ],
        }),
      );
      assert.deepEqual(summary(segments), [
        { name: 'Back Squat', mode: 'load_and_reps', swappedFrom: null, current: true, sets: ['0:100x5', '1:100x5'] },
        { name: 'Leg Press', mode: 'load_and_reps', swappedFrom: 'Back Squat', current: false, sets: ['0:180x10'] },
      ]);
    },
  },
  {
    name: 'lift segments: a session from before the stamp is read by its swap line',
    run() {
      // Running when this build arrived: no stamps, only the line — and back
      // then a swap left the mode alone, so the old lift's mode is the
      // exercise's own.
      const legacy = exercise({
        exerciseName: 'Leg Press',
        sourceExerciseName: 'Back Squat',
        swappedAfterSetIndex: 1,
        sets: [set(0), set(1), set(2, { actualLoadKg: 200, actualReps: 10 })],
      });
      assert.deepEqual(summary(splitExerciseByLift(legacy)), [
        { name: 'Back Squat', mode: 'load_and_reps', swappedFrom: null, current: false, sets: ['0:100x5', '1:100x5'] },
        { name: 'Leg Press', mode: 'load_and_reps', swappedFrom: 'Back Squat', current: true, sets: ['0:200x10'] },
      ]);
      assert.deepEqual(liftBeforeSwap(legacy, legacy.sets[0]), { exerciseName: 'Back Squat', trackingMode: 'load_and_reps' });
      assert.equal(liftBeforeSwap(legacy, legacy.sets[2]), null);
    },
  },
  {
    name: 'lift segments: a stamp read back from storage is checked, not trusted',
    run() {
      const stamped = (loggedAs) =>
        splitExerciseByLift(exercise({ sets: [set(0, { loggedAs }), set(1, { loggedAs: squat })] })).map(
          (segment) => segment.exerciseName,
        );
      // Not a lift: the set is the exercise's own.
      assert.deepEqual(stamped('Front Squat'), ['Back Squat']);
      assert.deepEqual(stamped({ exerciseName: '   ' }), ['Back Squat']);
      assert.deepEqual(stamped(null), ['Back Squat']);
      // A named lift with a mode nobody knows is still that lift, logged with
      // a weight — the dial that loses nothing.
      const odd = splitExerciseByLift(
        exercise({
          sets: [set(0, { loggedAs: { exerciseName: 'Front Squat', trackingMode: 'nonsense' } }), set(1, { loggedAs: squat })],
        }),
      );
      assert.deepEqual(odd.map((segment) => [segment.exerciseName, segment.trackingMode]), [
        ['Front Squat', 'load_and_reps'],
        ['Back Squat', 'load_and_reps'],
      ]);
    },
  },
  {
    name: 'lift segments: a logged set is judged as the lift it was logged as, whatever the slot holds now',
    run() {
      // The correction sheet and the reducer both ask this (review of #170).
      const slot = {
        exerciseName: 'Pull-Up',
        trackingMode: 'bodyweight',
        sourceExerciseName: 'Back Squat',
        swappedAfterSetIndex: 0,
        sets: [set(0, { loggedAs: squat }), set(1, { actualLoadKg: 0, actualReps: 8, loggedAs: pullUp }), set(2, { status: 'pending' })],
      };
      assert.deepEqual(liftOfSet(slot, slot.sets[0]), squat);
      assert.deepEqual(liftOfSet(slot, slot.sets[1]), pullUp);
      assert.deepEqual(liftOfSet(slot, slot.sets[2]), pullUp);
    },
  },
  {
    name: 'lift segments: swapped after the last set, the slot is the lift that was done',
    run() {
      // Nothing was planned or done as the goblet squat: no set is its, and a
      // row for it would be an empty card and the slot counted twice.
      const segments = splitExerciseByLift(
        exercise({
          exerciseName: 'Goblet Squat',
          sourceExerciseName: 'Back Squat',
          swappedAfterSetIndex: 2,
          sets: [set(0, { loggedAs: squat }), set(1, { loggedAs: squat }), set(2, { loggedAs: squat })],
        }),
      );
      assert.deepEqual(summary(segments), [
        { name: 'Back Squat', mode: 'load_and_reps', swappedFrom: null, current: false, sets: ['0:100x5', '1:100x5', '2:100x5'] },
      ]);
      // An exercise with no sets at all is still its own lift.
      assert.deepEqual(
        splitExerciseByLift(exercise({ sets: [] })).map((segment) => [segment.exerciseName, segment.current]),
        [['Back Squat', true]],
      );
    },
  },
];
