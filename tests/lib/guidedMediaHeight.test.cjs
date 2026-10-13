const assert = require('node:assert/strict');

const {
  DRILL_MEDIA_MAX_DP,
  DRILL_MEDIA_MIN_DP,
  WALK_MEDIA_MAX_DP,
  WALK_MEDIA_MIN_DP,
  guidedDrillMediaHeight,
  guidedWalkMediaHeight,
} = require('../../.test-dist/lib/guidedMediaHeight.js');

module.exports = [
  {
    name: 'guided drill picture: a tall phone keeps 270, a short one gives the countdown room',
    run() {
      // The owner's 1080x2340 phone is about 891 dp: unchanged.
      assert.equal(guidedDrillMediaHeight(891), DRILL_MEDIA_MAX_DP);
      // 720x1280 at 320 dpi is 640 dp: the picture shrinks so the clock fits.
      const small = guidedDrillMediaHeight(640);
      assert.ok(small < DRILL_MEDIA_MAX_DP && small >= DRILL_MEDIA_MIN_DP, `got ${small}`);
      // A larger font leaves less for the picture, never more.
      assert.ok(guidedDrillMediaHeight(640, 1.3) <= small);
      assert.ok(guidedDrillMediaHeight(891, 1.3) <= DRILL_MEDIA_MAX_DP);
      // Never below the floor, whatever the window says.
      assert.equal(guidedDrillMediaHeight(300, 2), DRILL_MEDIA_MIN_DP);
      // A font scale under 1 does not hand the picture more than its maximum.
      assert.equal(guidedDrillMediaHeight(2000, 0.85), DRILL_MEDIA_MAX_DP);
      // A broken measurement falls back to the old fixed height.
      assert.equal(guidedDrillMediaHeight(Number.NaN), DRILL_MEDIA_MAX_DP);
    },
  },
  {
    name: 'guided walk-up picture: 210 on a tall phone, smaller so the stat cards clear the buttons on a short one',
    run() {
      assert.equal(guidedWalkMediaHeight(891), WALK_MEDIA_MAX_DP);
      const small = guidedWalkMediaHeight(640, 1.3);
      assert.ok(small < WALK_MEDIA_MAX_DP && small >= WALK_MEDIA_MIN_DP, `got ${small}`);
      assert.ok(guidedWalkMediaHeight(640, 1.3) <= guidedWalkMediaHeight(640, 1));
      assert.equal(guidedWalkMediaHeight(200, 2), WALK_MEDIA_MIN_DP);
      assert.equal(guidedWalkMediaHeight(Number.NaN), WALK_MEDIA_MAX_DP);
    },
  },
];
