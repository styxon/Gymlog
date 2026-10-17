const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bar = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'BottomTabBar.tsx'), 'utf8').replace(/\r\n/g, '\n');

/**
 * Owner's #1, iOS hunt 2026-10-17: under the floating pill the page ended in a
 * hard line, 8 pt below it, where every scroll view stops at the safe area's
 * edge, with the bare home-indicator band of the page under it. The page now
 * fades into the shell's own background before that line.
 */
module.exports = [
  {
    name: 'tab bar: a fade under the pill ends in the page colour at the safe area\'s edge, and takes no touches',
    run() {
      const fadeAt = bar.indexOf('<View pointerEvents="none" style={styles.edgeFade}>');
      const pillAt = bar.indexOf('<CutSurface size="lg"');
      assert.ok(fadeAt > 0, 'no fade');
      assert.ok(pillAt > fadeAt, 'the fade is drawn over the pill');
      const fade = bar.slice(fadeAt, pillAt);
      assert.match(fade, /<Stop offset="0" stopColor=\{theme\.bg\} stopOpacity=\{0\} \/>/);
      assert.match(fade, /<Stop offset="1" stopColor=\{theme\.bg\} stopOpacity=\{1\} \/>/);
      assert.match(fade, /fill="url\(#vinhaTabEdgeFade\)"/);
      assert.match(bar, /edgeFade: \{\s*position: 'absolute',\s*left: 0,\s*right: 0,\s*bottom: 0,\s*height: EDGE_FADE,\s*\}/);
      // Taller than the shell's own 8 under the pill, so it reaches up behind it.
      assert.match(bar, /\{ paddingBottom: 8 \}/);
      const height = Number(/const EDGE_FADE = (\d+);/.exec(bar)?.[1]);
      assert.ok(height > 8 + 12, `fade of ${height}`);
    },
  },
];
