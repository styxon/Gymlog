const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { statusCapInterpolation } = require('../../.test-dist/lib/statusCap.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

/**
 * Owner's #5, iOS hunt 2026-10-17: the workout summary scrolled its record
 * card and stats under the clock with nothing between. The status bar's
 * background colour was meant to cap it and does nothing on iOS (nor under
 * Android's edge-to-edge), so the two pages that run under the clock draw it.
 */
module.exports = [
  {
    name: 'statusCap: clear at rest, solid once the page has moved by the bar, never a flat range',
    run() {
      assert.deepEqual(statusCapInterpolation(47), { inputRange: [0, 47], outputRange: [0, 1], extrapolate: 'clamp' });
      assert.deepEqual(statusCapInterpolation(0).inputRange, [0, 1]);
      assert.deepEqual(statusCapInterpolation(Number.NaN).inputRange, [0, 1]);
      assert.deepEqual(statusCapInterpolation(-5).inputRange, [0, 1]);
    },
  },
  {
    name: 'statusCap: the summary and the saved workout scroll it in, above their scroll view',
    run() {
      const cap = read('src', 'components', 'StatusCap.tsx');
      // One interpolation per view, built once per inset.
      assert.match(cap, /const opacity = useMemo\(\(\) => scrollY\.interpolate\(statusCapInterpolation\(topInset\)\), \[scrollY, topInset\]\);/);
      assert.match(cap, /pointerEvents="none"/);
      for (const [file, color] of [
        [['src', 'screens', 'WorkoutCompletionScreen.tsx'], 'theme\\.bg'],
        [['src', 'screens', 'HistoryScreen.tsx'], 'HERO_STOPS\\[0\\]'],
      ]) {
        const screen = read(...file);
        const name = file[file.length - 1];
        assert.match(
          screen,
          /Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ y: \w+ScrollY|Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ y: scrollY/,
          name,
        );
        assert.match(screen, /\{ useNativeDriver: true \}/, name);
        assert.match(screen, /<Animated\.ScrollView\s+showsVerticalScrollIndicator=\{false\}\s+onScroll=\{on\w*Scroll\}\s+scrollEventThrottle=\{16\}/, name);
        const close = screen.indexOf('</Animated.ScrollView>');
        const capAt = screen.search(new RegExp(`<StatusCap scrollY=\\{\\w+\\} topInset=\\{insets\\.top\\} color=\\{${color}\\} />`));
        assert.ok(close > 0 && capAt > close, `${name}: no cap after the scroll view`);
      }
      // History outlives its detail: one value per workout opened, or the
      // next workout inherits the last one's offset and opens with the cap
      // solid over its hero.
      const history = read('src', 'screens', 'HistoryScreen.tsx');
      assert.match(history, /const detailScrollY = useMemo\(\(\) => new Animated\.Value\(0\), \[selectedSessionId\]\);/);
      assert.doesNotMatch(history, /useRef\(new Animated\.Value/);
      // The shell no longer claims the status bar colour does it.
      assert.match(read('src', 'app', 'renderAppShell.tsx'), /Android-only, and a no-op under edge-to-edge/);
    },
  },
];
