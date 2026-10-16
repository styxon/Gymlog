const assert = require('node:assert/strict');

const lib = () => require('../../.test-dist/lib/weightWheel.js');
const B = { min: 35, max: 220 };

module.exports = [
  {
    name: 'weight wheel rows: wholes around the value, blank past a limit',
    run() {
      const { wholeRows } = lib();
      assert.deepEqual(wholeRows(75.3, B), [73, 74, 75, 76, 77]);
      assert.deepEqual(wholeRows(35, B), [null, null, 35, 36, 37]);
      assert.deepEqual(wholeRows(220, B), [218, 219, 220, null, null]);
    },
  },
  {
    name: 'weight wheel rows: tenths wrap 9 to 0 both ways',
    run() {
      const { tenthRows } = lib();
      assert.deepEqual(tenthRows(75.3, B), [1, 2, 3, 4, 5]);
      assert.deepEqual(tenthRows(75.9, B), [7, 8, 9, 0, 1]);
      assert.deepEqual(tenthRows(75.0, B), [8, 9, 0, 1, 2]);
    },
  },
  {
    name: 'weight wheel steps: tenths carry into the whole, no float drift',
    run() {
      const { stepWeight } = lib();
      assert.equal(stepWeight(75.9, 'tenth', 1, B), 76);
      assert.equal(stepWeight(76, 'tenth', -1, B), 75.9);
      assert.equal(stepWeight(75.3, 'whole', 1, B), 76.3);
      assert.equal(stepWeight(75.3, 'whole', -2, B), 73.3);
      let v = 70;
      for (let i = 0; i < 300; i++) v = stepWeight(v, 'tenth', 1, B);
      assert.equal(v, 100);
    },
  },
  {
    name: 'weight wheel never leaves its limits',
    run() {
      const { stepWeight, clampWeight } = lib();
      assert.equal(stepWeight(220, 'tenth', 1, B), 220);
      assert.equal(stepWeight(219.5, 'whole', 1, B), 220);
      assert.equal(stepWeight(35, 'tenth', -1, B), 35);
      assert.equal(stepWeight(35.4, 'whole', -2, B), 35);
      assert.equal(clampWeight(500, B), 220);
      assert.equal(clampWeight(3, B), 35);
      assert.equal(clampWeight(NaN, B), 35);
      assert.equal(clampWeight(71.26, B), 71.3);
    },
  },
  {
    name: 'weight wheel drag: one step per 50 px, up is larger',
    run() {
      const { dragSteps } = lib();
      assert.equal(dragSteps(0), 0);
      assert.equal(dragSteps(-49), 0);
      assert.equal(dragSteps(-50), 1);
      assert.equal(dragSteps(-120), 2);
      assert.equal(dragSteps(50), -1);
      assert.equal(dragSteps(30), 0);
    },
  },
];
