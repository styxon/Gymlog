const assert = require('node:assert/strict');

const {
  getTopSetLabel,
  buildMuscleFocus,
  getVolumeDeltaVsPrevious,
} = require('../../.test-dist/lib/workoutCompleteView.js');
const { bodyPartForExerciseName } = require('../../.test-dist/lib/catalogExercisePools.js');

const done = (weightKg, reps) => ({ status: 'completed', weightKg, reps });

module.exports = [
  {
    name: 'top set label picks the heaviest completed set, reps break ties',
    run() {
      // The unit rides along: the finish screen prints this under "heaviest
      // set", where a bare number says nothing (#bugs 2026-08-26).
      assert.equal(getTopSetLabel([done(60, 8), done(62.5, 6), done(60, 10)]), '62.5 kg × 6');
      assert.equal(getTopSetLabel([done(60, 8), done(60, 10)]), '60 kg × 10');
      // Bodyweight-only sets read as reps.
      assert.equal(getTopSetLabel([done(0, 12), done(null, 14)]), '14 reps');
      // Pending/skipped sets are ignored; nothing completed -> null.
      assert.equal(getTopSetLabel([{ status: 'pending', weightKg: 100, reps: 5 }]), null);
      assert.equal(getTopSetLabel([]), null);
    },
  },
  {
    name: 'body part by name covers the common lift names and stays honest otherwise',
    run() {
      assert.equal(bodyPartForExerciseName('Back Squat'), 'legs');
      // The library files the RDL under legs (exact row); the name's words
      // said glutes and used to win for every name that was not a row.
      assert.equal(bodyPartForExerciseName('Romanian Deadlift'), 'legs');
      assert.equal(bodyPartForExerciseName('Bench Press'), 'chest');
      assert.equal(bodyPartForExerciseName('Chest-Supported Row'), 'back');
      assert.equal(bodyPartForExerciseName('Overhead Press'), 'shoulders');
      assert.equal(bodyPartForExerciseName('Hammer Curl'), 'biceps');
      assert.equal(bodyPartForExerciseName('Rope Pushdown'), 'triceps');
      assert.equal(bodyPartForExerciseName('Plank'), 'core');
      // Names nothing in the library places fall to the words, then "other".
      assert.equal(bodyPartForExerciseName('Single-Leg Calf Raise Hold Variant'), 'legs');
      assert.equal(bodyPartForExerciseName('Mystery Move'), 'other');
    },
  },
  {
    name: 'muscle focus aggregates sets and volume per group with a set share',
    run() {
      const library = [{ name: 'Cable Crunch', bodyPart: 'core' }];
      const rows = buildMuscleFocus(
        [
          { exerciseName: 'Bench Press', sets: [done(60, 8), done(60, 8)] },
          { exerciseName: 'Incline DB Press', sets: [done(24, 10)] },
          { exerciseName: 'Overhead Press', sets: [done(40, 8)] },
          { exerciseName: 'Cable Crunch', sets: [done(20, 15)] },
          { exerciseName: 'Skipped Move', sets: [{ status: 'skipped', weightKg: 100, reps: 5 }] },
        ],
        library,
      );

      assert.deepEqual(rows, [
        { name: 'Chest', sets: 3, volumeKg: 1200, sharePercent: 60 },
        { name: 'Shoulders', sets: 1, volumeKg: 320, sharePercent: 20 },
        { name: 'Core', sets: 1, volumeKg: 300, sharePercent: 20 },
      ]);
    },
  },
  {
    name: 'a bodyweight session still gets a share to show, even with no volume',
    run() {
      const rows = buildMuscleFocus(
        [
          { exerciseName: 'Bodyweight Squat', sets: [done(0, 15), done(0, 12)] },
          { exerciseName: 'Plank', sets: [done(0, 40)] },
        ],
        [],
      );

      assert.deepEqual(rows, [
        { name: 'Legs', sets: 2, volumeKg: 0, sharePercent: 67 },
        { name: 'Core', sets: 1, volumeKg: 0, sharePercent: 33 },
      ]);
    },
  },
  {
    name: 'volume delta compares against the latest earlier session of the same workout',
    run() {
      const current = {
        sessionId: 's3',
        workoutName: 'Push A',
        performedAt: '2026-07-12T18:00:00.000Z',
        totalVolumeKg: 5100,
      };
      const sessions = [
        { id: 's1', name: 'Push A', performedAt: '2026-07-01T18:00:00.000Z', totalVolume: 4600 },
        { id: 's2', name: 'Push A', performedAt: '2026-07-08T18:00:00.000Z', totalVolume: 4780 },
        { id: 'sx', name: 'Pull A', performedAt: '2026-07-10T18:00:00.000Z', totalVolume: 9999 },
        { id: 's3', name: 'Push A', performedAt: '2026-07-12T18:00:00.000Z', totalVolume: 5100 },
      ];

      assert.equal(getVolumeDeltaVsPrevious(current, sessions), 320);
      // No earlier same-name session -> null (hide the delta).
      assert.equal(
        getVolumeDeltaVsPrevious({ ...current, workoutName: 'Legs A' }, sessions),
        null,
      );
    },
  },
];
