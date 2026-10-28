const assert = require('node:assert/strict');

const {
  adjustEmphasis,
  EMPHASIS_STEP,
  MIN_SETS_PER_EXERCISE,
  MAX_SETS_PER_EXERCISE,
} = require('../../src/lib/programEmphasisAdjust');

const WEEK = [
  { area: 'glutesLegs', role: 'primary', sets: 4 },
  { area: 'glutesLegs', role: 'secondary', sets: 3 },
  { area: 'glutesLegs', role: 'accessory', sets: 3 },
  { area: 'shouldersBack', role: 'primary', sets: 4 },
  { area: 'shouldersBack', role: 'secondary', sets: 3 },
  { area: 'chestArms', role: 'accessory', sets: 3 },
  { area: 'core', role: 'accessory', sets: 3 },
];

const total = (sets) => sets.reduce((sum, value) => sum + value, 0);
const areaSets = (exercises, sets, area) =>
  exercises.reduce((sum, exercise, index) => (exercise.area === area ? sum + sets[index] : sum), 0);

module.exports = [
  {
    // The whole reason the controls are linked. A sheet that could grow the
    // week from 77 sets to 96 would be selling more training as a preference.
    name: 'the week total survives every move, in both directions',
    run() {
      const before = total(WEEK.map((exercise) => exercise.sets));
      for (const area of ['glutesLegs', 'shouldersBack', 'chestArms', 'core']) {
        for (const delta of [EMPHASIS_STEP, -EMPHASIS_STEP, 12, -12, 1, -1]) {
          const result = adjustEmphasis(WEEK, area, delta);
          assert.equal(total(result.sets), before, `${area} ${delta} changed the total`);
        }
      }
    },
  },
  {
    name: 'a step moves sets into the area and out of the rest',
    run() {
      const result = adjustEmphasis(WEEK, 'glutesLegs', EMPHASIS_STEP);
      assert.equal(result.moved, EMPHASIS_STEP);
      assert.equal(
        areaSets(WEEK, result.sets, 'glutesLegs'),
        areaSets(WEEK, WEEK.map((e) => e.sets), 'glutesLegs') + EMPHASIS_STEP,
      );
    },
  },
  {
    // The anchor is the lift the programme measures progress by. Quietly
    // halving its sets because a stepper was pressed would change what the
    // programme IS, so volume comes off the accessories first.
    name: 'volume leaves the accessories before the anchor',
    run() {
      const result = adjustEmphasis(WEEK, 'core', EMPHASIS_STEP);
      // glutesLegs accessory (index 2) and chestArms accessory (index 5) give
      // before the two primaries at indexes 0 and 3.
      assert.ok(result.sets[2] < WEEK[2].sets || result.sets[5] < WEEK[5].sets);
      assert.equal(result.sets[0], WEEK[0].sets, 'the glute anchor lost sets first');
      assert.equal(result.sets[3], WEEK[3].sets, 'the shoulder anchor lost sets first');
    },
  },
  {
    name: 'no exercise leaves its floor or ceiling',
    run() {
      for (const delta of [40, -40]) {
        const result = adjustEmphasis(WEEK, 'core', delta);
        for (const value of result.sets) {
          assert.ok(value >= MIN_SETS_PER_EXERCISE, `${value} is below the floor`);
          assert.ok(value <= MAX_SETS_PER_EXERCISE, `${value} is above the ceiling`);
        }
      }
    },
  },
  {
    // A control that reports a change it did not make is worse than one that
    // refuses: `moved` is what the sheet shows, not what was asked for.
    name: 'a move that cannot fit reports what it actually moved',
    run() {
      const capped = [
        { area: 'core', role: 'accessory', sets: MAX_SETS_PER_EXERCISE },
        { area: 'glutesLegs', role: 'accessory', sets: 4 },
      ];
      const result = adjustEmphasis(capped, 'core', EMPHASIS_STEP);
      assert.equal(result.moved, 0);
      assert.deepEqual(result.sets, [MAX_SETS_PER_EXERCISE, 4]);

      const floored = [
        { area: 'core', role: 'accessory', sets: 2 },
        { area: 'glutesLegs', role: 'accessory', sets: MIN_SETS_PER_EXERCISE },
      ];
      const partial = adjustEmphasis(floored, 'core', EMPHASIS_STEP);
      assert.equal(partial.moved, 0, 'nothing was free to give');
    },
  },
  {
    name: 'moving an area that does not exist changes nothing',
    run() {
      const result = adjustEmphasis(WEEK, 'other', EMPHASIS_STEP);
      assert.equal(result.moved, 0);
      assert.deepEqual(result.sets, WEEK.map((exercise) => exercise.sets));
    },
  },
  {
    name: 'a zero move and an empty week are both no-ops',
    run() {
      assert.deepEqual(adjustEmphasis(WEEK, 'core', 0).sets, WEEK.map((e) => e.sets));
      assert.deepEqual(adjustEmphasis([], 'core', EMPHASIS_STEP), { sets: [], moved: 0 });
    },
  },
];
