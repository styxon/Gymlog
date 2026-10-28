const assert = require('node:assert/strict');

const { parseNumberInput } = require('../../src/lib/format');

module.exports = [
  {
    name: 'load input parsing accepts 5, 10, 100, and 12.5 without coercing to a single digit',
    run() {
      assert.equal(parseNumberInput('5'), 5);
      assert.equal(parseNumberInput('10'), 10);
      assert.equal(parseNumberInput('100'), 100);
      assert.equal(parseNumberInput('12.5'), 12.5);
      assert.equal(parseNumberInput('12,5'), 12.5);
    },
  },
];
