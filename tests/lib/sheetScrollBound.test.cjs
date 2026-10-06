const assert = require('node:assert/strict');

const { sheetScrollMaxHeight } = require('../../.test-dist/lib/sheetScrollBound.js');

module.exports = [
  {
    name: 'sheet scroll bound: the list ends above the sheet head, the padding and the button bar',
    run() {
      // 320 × 640 dp phone, three-button bar (48): 0.78 × 640 − 81 − (30 + 48).
      assert.equal(sheetScrollMaxHeight({ areaHeight: 640, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }), 340);
      const withBar = sheetScrollMaxHeight({ areaHeight: 800, capFraction: 0.78, headHeight: 81, bottomPadding: 78 });
      const gesture = sheetScrollMaxHeight({ areaHeight: 800, capFraction: 0.78, headHeight: 81, bottomPadding: 30 });
      assert.equal(gesture - withBar, 48, 'the inset comes off the list, not off its last row');
      // A taller head (large font scale) takes its room from the list too.
      assert.equal(
        sheetScrollMaxHeight({ areaHeight: 800, capFraction: 0.78, headHeight: 120, bottomPadding: 78 }),
        Math.floor(800 * 0.78 - 120 - 78),
      );
    },
  },
  {
    name: 'sheet scroll bound: unmeasured or broken input never collapses the list',
    run() {
      assert.equal(sheetScrollMaxHeight({ areaHeight: 0, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }), 120);
      assert.equal(
        sheetScrollMaxHeight({ areaHeight: Number.NaN, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }),
        120,
      );
      assert.equal(
        sheetScrollMaxHeight({ areaHeight: 300, capFraction: 2, headHeight: -5, bottomPadding: 0, minHeight: 0 }),
        300,
      );
    },
  },
];
