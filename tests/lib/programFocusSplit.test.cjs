const assert = require('node:assert/strict');

const {
  buildProgramFocusSplit,
  estimateFocusExerciseSeconds,
  PROGRAM_FOCUS_COLORS,
} = require('../../.test-dist/lib/programFocusSplit');

function session(name, exercises) {
  return {
    id: name,
    name,
    orderIndex: 0,
    exercises: exercises.map(([exerciseName, sets], index) => ({
      id: `${name}-${index}`,
      exerciseName,
      slotId: `slot-${index}`,
      role: 'primary',
      progressionPriority: 'high',
      trackingMode: 'load_and_reps',
      sets,
      repsMin: 8,
      repsMax: 12,
      restSecondsMin: 60,
      restSecondsMax: 120,
      substitutionGroup: 'none',
    })),
  };
}

module.exports = [
  {
    name: 'programFocusSplit: percentages come from time-weighted composition and sum to 100',
    run() {
      const split = buildProgramFocusSplit([
        session('Day 1', [
          ['Barbell Bench Press', 3],
          ['Back Squat', 3],
          ['Rowing Intervals', 4],
          ['Hip Flexor Stretch', 2],
        ]),
      ]);

      // The lifts are written at 8-12 reps: muscle work, not heavy strength.
      assert.deepEqual(
        split.map((segment) => segment.quality),
        ['Muscle', 'Conditioning', 'Mobility'],
      );
      assert.equal(split.reduce((sum, segment) => sum + segment.pct, 0), 100);
      // Every row here has the same reps and rest, so time is in proportion to
      // sets: 6 / 4 / 2 of 12 = 50 / 33.3 / 16.7
      assert.equal(split[0].pct, 50);
      assert.equal(split[1].pct, 33);
      assert.equal(split[2].pct, 17);
    },
  },
  {
    name: 'programFocusSplit: lifting-only program omits missing qualities',
    run() {
      const split = buildProgramFocusSplit([
        session('Day 1', [
          ['Deadlift', 3],
          ['Overhead Press', 3],
        ]),
      ]);

      assert.deepEqual(split, [{ quality: 'Muscle', pct: 100 }]);
    },
  },
  {
    name: 'programFocusSplit: walking lunge is lifting, farmer carry and jumps are conditioning',
    run() {
      const split = buildProgramFocusSplit([
        session('Day 1', [
          ['Walking Lunge', 5],
          ["Farmer's Carry", 3],
          ['Box Jump', 2],
        ]),
      ]);

      assert.deepEqual(
        split.map((segment) => segment.quality),
        ['Muscle', 'Conditioning'],
      );
      // By time (2026-10-12), not by sets: the carry's 12 is seconds, not
      // reps (prescriptionUnitFromName). Lunge 5 x (12 x 3.5 + 20 + 60) = 610,
      // carry 3 x (12 + 60) = 216, jump 2 x 122 = 244: 610 / 1070 = 57 %.
      // Weighed by set count this was 5 / 10 = 50 / 50.
      assert.equal(split[0].pct, 57);
      assert.equal(split[1].pct, 43);
    },
  },
  {
    name: 'programFocusSplit: a block of minutes weighs its minutes, an interval its seconds, a lift its reps and rest',
    run() {
      const lift = { exerciseName: 'Bench Press', trackingMode: 'load_and_reps', sets: 3, repsMax: 10, restSecondsMin: 120, restSecondsMax: 180 };
      const steady = { exerciseName: 'Stationary Bike (Easy Pace)', trackingMode: 'duration_minutes', sets: 1, repsMax: 20, restSecondsMin: 0, restSecondsMax: 0 };
      const intervals = { exerciseName: 'Treadmill HIIT (30s on / 30s off)', trackingMode: 'reps_first', sets: 8, repsMax: 30, restSecondsMin: 30, restSecondsMax: 30 };
      // 3 sets of bench: 3 x (10 x 3.5 + 20 + 120 low-end rest) = 525 s.
      assert.equal(estimateFocusExerciseSeconds(lift), 525);
      // 20 minutes on a bike is 1200 s, not one set.
      assert.equal(estimateFocusExerciseSeconds(steady), 1200);
      // 8 rounds of 30 s on and 30 s off is 480 s, not 8 x 30 reps.
      assert.equal(estimateFocusExerciseSeconds(intervals), 480);

      // One set of a 20-minute ride beside nine sets of lifting: by set count
      // that was 10 %; by time it is 1200 / (1200 + 3 x 525) = 43 %.
      const split = buildProgramFocusSplit([{ exercises: [lift, lift, lift, steady] }]);
      assert.deepEqual(split, [
        { quality: 'Muscle', pct: 57 },
        { quality: 'Conditioning', pct: 43 },
      ]);
      // A run of minutes written without a rest has none; a lift without one
      // still rests, and nothing comes out as NaN.
      const noRest = buildProgramFocusSplit([{ exercises: [
        { exerciseName: 'Easy Run Blocks', trackingMode: 'duration_minutes', sets: 2, repsMax: 5 },
        { exerciseName: 'Goblet Squat', sets: 2 },
      ] }]);
      assert.equal(noRest.reduce((sum, segment) => sum + segment.pct, 0), 100);
      assert.ok(noRest.every((segment) => Number.isFinite(segment.pct)));
    },
  },
  {
    name: 'programFocusSplit: empty program falls back to full lifting, colors are fixed',
    run() {
      assert.deepEqual(buildProgramFocusSplit([]), [{ quality: 'Muscle', pct: 100 }]);
      assert.equal(PROGRAM_FOCUS_COLORS.Strength, '#F59E0B');
      assert.equal(PROGRAM_FOCUS_COLORS.Muscle, '#FB7185');
      assert.equal(PROGRAM_FOCUS_COLORS.Conditioning, '#38BDF8');
      assert.equal(PROGRAM_FOCUS_COLORS.Mobility, '#34D399');
    },
  },
];
