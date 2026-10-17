const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DUOTONE_RAMPS, duotoneMatrix, srgbToLinear } = require('../../.test-dist/lib/duotone.js');

/**
 * Owner's #11, iOS hunt 2026-10-17: the guided player's photos looked washed
 * out on iPhone. The duotone's feColorMatrix was written for sRGB values,
 * which is what Android filters; iOS filters through Core Image in linear
 * light and encodes the result back. Both pipelines are simulated here.
 */
const encode = (value) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
const clamp = (value) => Math.min(1, Math.max(0, value));
const parse = (matrix) => matrix.split(' ').map(Number);
const apply = (m, rgb) => [0, 1, 2].map((c) => m[c * 5] * rgb[0] + m[c * 5 + 1] * rgb[1] + m[c * 5 + 2] * rgb[2] + m[c * 5 + 4]);
/** Android: the matrix on the bitmap's sRGB values. */
const android = (matrix, grey) => apply(parse(matrix), [grey, grey, grey]).map(clamp);
/** iOS: linearise, apply, encode. */
const ios = (matrix, grey) => apply(parse(matrix), [grey, grey, grey].map(srgbToLinear)).map(clamp).map(encode);
const near = (actual, expected, label) =>
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 1 / 255, `${label}: ${actual} vs ${expected}`));

module.exports = [
  {
    name: 'duotone: on iOS black and white land on the ramp\'s two colours, as they do on Android',
    run() {
      for (const [theme, ramp] of Object.entries(DUOTONE_RAMPS)) {
        const linear = duotoneMatrix(ramp.shadow, ramp.light, 'linear');
        near(ios(linear, 0), ramp.shadow, `${theme} iOS black`);
        near(ios(linear, 1), ramp.light, `${theme} iOS white`);
        const srgb = duotoneMatrix(ramp.shadow, ramp.light, 'srgb');
        near(android(srgb, 0), ramp.shadow, `${theme} Android black`);
        near(android(srgb, 1), ramp.light, `${theme} Android white`);
      }
      // The bug, measured: the sRGB matrix through iOS's pipeline lifts the
      // light theme's black from #4c3a7a to about #9483b8.
      const ramp = DUOTONE_RAMPS.light;
      const washed = ios(duotoneMatrix(ramp.shadow, ramp.light, 'srgb'), 0);
      assert.ok(washed[0] - ramp.shadow[0] > 0.2, `${washed}`);
    },
  },
  {
    name: 'duotone: the iOS tones rise with the photo\'s and are never lighter than Android\'s',
    run() {
      for (const [theme, ramp] of Object.entries(DUOTONE_RAMPS)) {
        const linear = duotoneMatrix(ramp.shadow, ramp.light, 'linear');
        const srgb = duotoneMatrix(ramp.shadow, ramp.light, 'srgb');
        let previous = ios(linear, 0);
        for (let step = 1; step <= 20; step += 1) {
          const grey = step / 20;
          const now = ios(linear, grey);
          now.forEach((value, index) => assert.ok(value >= previous[index] - 1e-9, `${theme} at ${grey}`));
          previous = now;
          // The washed-out look was tones lighter than designed: none here.
          const designed = android(srgb, grey);
          now.forEach((value, index) => assert.ok(value <= designed[index] + 0.04, `${theme} at ${grey}: ${value} over ${designed[index]}`));
        }
      }
    },
  },
  {
    name: 'duotone: the player asks for linear light on iOS and leaves Android\'s verified matrix alone',
    run() {
      const player = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8');
      assert.match(player, /const ramp = DUOTONE_RAMPS\[themeName\];/);
      assert.match(player, /values=\{duotoneMatrix\(ramp\.shadow, ramp\.light, Platform\.OS === 'ios' \? 'linear' : 'srgb'\)\}/);
      assert.doesNotMatch(player, /function duotoneMatrix|const LUMA/);
      // The sRGB matrix is the one the old screen built, digit for digit
      // (verified on device; the screen's own copy, as it was).
      const LUMA = [0.299, 0.587, 0.114];
      const before = (shadow, light) => {
        const row = (index) => {
          const span = light[index] - shadow[index];
          return [LUMA[0] * span, LUMA[1] * span, LUMA[2] * span, 0, shadow[index]];
        };
        return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0].map((value) => value.toFixed(4)).join(' ');
      };
      for (const ramp of Object.values(DUOTONE_RAMPS)) {
        assert.equal(duotoneMatrix(ramp.shadow, ramp.light, 'srgb'), before(ramp.shadow, ramp.light));
      }
      assert.deepEqual(DUOTONE_RAMPS, {
        light: { shadow: [0.298, 0.227, 0.478], light: [1, 1, 1] },
        dark: { shadow: [0.09, 0.063, 0.169], light: [0.851, 0.8, 0.961] },
      });
    },
  },
];
