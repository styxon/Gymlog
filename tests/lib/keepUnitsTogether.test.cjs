module.exports = [
  {
    name: 'keepUnitsTogether binds a figure to its unit and nothing else',
    run() {
      const assert = require('node:assert/strict');
      const { keepUnitsTogether } = require('../../src/lib/format');
      assert.equal(keepUnitsTogether('3 harjoitusta · 47 min'), '3 harjoitusta · 47 min');
      assert.equal(keepUnitsTogether('107,5 kg × 8'), '107,5 kg × 8');
      assert.equal(keepUnitsTogether('1 h 5 min'), '1 h 5 min');
      assert.equal(keepUnitsTogether('2 minuuttia'), '2 minuuttia');
      assert.equal(keepUnitsTogether('ma 12.10.'), 'ma 12.10.');
    },
  },
];
