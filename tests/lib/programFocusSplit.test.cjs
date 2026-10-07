const assert = require('node:assert/strict');

const {
  buildProgramFocusSplit,
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
    name: 'programFocusSplit: percentages come from set-weighted composition and sum to 100',
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
      // 6 / 4 / 2 of 12 sets = 50 / 33.3 / 16.7
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
      assert.equal(split[0].pct, 50);
      assert.equal(split[1].pct, 50);
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
