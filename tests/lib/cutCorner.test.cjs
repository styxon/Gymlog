const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CUT_BY_SIZE, cutCornerPath } = require('../../src/lib/cutCorner');

module.exports = [
  {
    name: 'the cut scales so the smallest chip is the same shape as the largest button',
    run() {
      // 50 / 40 / 30 / 26 px tall → 14 / 11 / 8 / 7 px cut (design A3).
      assert.deepEqual(CUT_BY_SIZE, { lg: 14, md: 11, sm: 8, chip: 7 });
    },
  },
  {
    name: 'the path starts at the cut and never doubles back on itself',
    run() {
      const d = cutCornerPath(200, 50, 14);
      // Begins inset along the top edge: that gap IS the cut.
      assert.match(d, /^M 14 0/);
      assert.ok(d.trim().endsWith('Z'), 'closed, or the fill leaks');

      // A box smaller than twice the cut would otherwise produce a path whose
      // corners overlap and render as a bow tie.
      const tiny = cutCornerPath(10, 8, 14);
      assert.ok(!tiny.includes('-'), `no negative coordinates: ${tiny}`);
    },
  },
  {
    name: 'the shape is drawn, not faked with a square corner',
    run() {
      // React Native has no clip-path. The design offers plain border-radius as
      // a fallback, but a square top-left corner reads as a bug rather than a
      // cut — so the outline is an SVG path and this pins that choice.
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'components', 'CutSurface.tsx'),
        'utf8',
      );
      assert.match(source, /<Path\s/);
      assert.doesNotMatch(source, /borderTopLeftRadius/);

      // The sheen and the speed line are drawn inside the same clip. As
      // overlay Views they escaped: Android lets a transformed child out of
      // `overflow: hidden`, so both reappeared outside the shape.
      assert.match(source, /clipPath="url\(#cutClip\)"/);
      assert.match(source, /skewAboutCentre/);
    },
  },
];
