const assert = require('node:assert/strict');

const {
  getOverviewDurationTicks,
  getOverviewVolumeTicks,
} = require('../../src/lib/progressChartTicks');

/**
 * The Progress tab's y-axes.
 *
 * They lived inside ProgressScreen, which imports React Native and cannot be
 * loaded here — which is how the duration ladder shipped capping at 90 minutes
 * with nothing to notice. This file is the reason they moved.
 */

module.exports = [
  {
    /**
     * An axis has to reach the tallest point on it.
     *
     * The old staircase ended at 90: every max above an hour got the same
     * ceiling, so a session left running overnight drew its line through the
     * top of the card. Photographed on the device — "33 h 52 min" over an axis
     * whose highest label was "1h 30m".
     */
    name: 'duration ticks: the axis always reaches the tallest point',
    run() {
      // The case from the device, and the one the old ladder clipped.
      for (const max of [0, 1, 12, 45, 58, 61, 95, 200, 2032, 5000, 100000]) {
        const ticks = getOverviewDurationTicks(max);
        assert.ok(ticks.length >= 2, `${max}: an axis needs at least two labels`);
        assert.equal(ticks[0], 0, `${max}: the axis does not start at zero`);
        assert.ok(
          ticks[ticks.length - 1] >= max,
          `${max}: the axis tops out at ${ticks[ticks.length - 1]} — the point is off the chart`,
        );
        // Evenly spaced, or the gridlines lie about the distance between them.
        const step = ticks[1] - ticks[0];
        for (let i = 1; i < ticks.length; i += 1) {
          assert.ok(
            Math.abs(ticks[i] - ticks[i - 1] - step) < 0.001,
            `${max}: the steps are uneven`,
          );
        }
      }

      // The everyday shapes keep the axis they had — this was not a redesign.
      assert.deepEqual(getOverviewDurationTicks(45), [0, 15, 30, 45]);
      assert.deepEqual(getOverviewDurationTicks(58), [0, 15, 30, 45, 60]);
      // And the one that used to clip.
      assert.deepEqual(getOverviewDurationTicks(95), [0, 30, 60, 90, 120]);
      // An hour and a bit is an ordinary session, and its axis read
      // 0 / 22.5 / 45 / 67.5 / 90 until thirds took over from quarters.
      for (const max of [61, 75, 90]) {
        assert.deepEqual(getOverviewDurationTicks(max), [0, 30, 60, 90], `${max} min`);
      }
    },
  },
  {
    name: 'duration ticks: every label is a whole number of minutes',
    run() {
      for (let max = 0; max <= 3000; max += 1) {
        for (const tick of getOverviewDurationTicks(max)) {
          assert.ok(Number.isInteger(tick), `${max}: a tick at ${tick} minutes prints as a fraction`);
        }
      }
    },
  },
  {
    /**
     * Volume already had an open ladder. Pinned so the move did not change it.
     */
    name: 'volume ticks: round numbers, and the axis still reaches the top',
    run() {
      assert.deepEqual(getOverviewVolumeTicks(0), [0, 250, 500]);
      for (const max of [120, 994, 2200, 48200]) {
        const ticks = getOverviewVolumeTicks(max);
        assert.equal(ticks[0], 0);
        assert.ok(ticks[ticks.length - 1] >= max, `${max}: the volume axis clips`);
      }
    },
  },
];
