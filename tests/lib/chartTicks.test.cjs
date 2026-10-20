const assert = require('node:assert/strict');
const { niceTicks } = require('../../.test-dist/lib/chartTicks.js');

module.exports = [
  {
    name: 'niceTicks rounds the 68.88-77.38 kg range to 2.5 kg steps',
    run() {
      assert.deepEqual(niceTicks(68.88, 77.38, 5), [67.5, 70, 72.5, 75, 77.5]);
    },
  },
  {
    name: 'niceTicks covers the range and stays within the cap',
    run() {
      for (const [lo, hi] of [[0, 1], [3, 3.4], [60, 140], [0, 5000], [99.5, 101], [12, 48]]) {
        const ticks = niceTicks(lo, hi, 5);
        assert.ok(ticks.length >= 2 && ticks.length <= 5, `${lo}-${hi}: ${ticks}`);
        assert.ok(ticks[0] <= lo && ticks[ticks.length - 1] >= hi, `${lo}-${hi}: ${ticks}`);
        for (let i = 1; i < ticks.length; i += 1) assert.ok(ticks[i] > ticks[i - 1]);
      }
    },
  },
  {
    name: 'niceTicks handles a flat range and bad input',
    run() {
      assert.deepEqual(niceTicks(50, 50), [45, 50, 55]);
      assert.deepEqual(niceTicks(0, 0), [-1, 0, 1]);
      assert.deepEqual(niceTicks(NaN, 3), []);
    },
  },
];
