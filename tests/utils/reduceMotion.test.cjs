const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const root = path.join(__dirname, '..', '..');

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8');
}

/**
 * The app once launched to a blank screen and stayed there.
 *
 * VinhaSplashScreen held `reduceMotion: boolean | null`, rendered an empty
 * field while it was null, and started the animation — the thing that
 * eventually calls onDone — only once it was not. App.tsx renders nothing but
 * that screen until onDone fires. So a single
 * `AccessibilityInfo.isReduceMotionEnabled()` that never settled, on a real
 * Galaxy A54, was an app that could not be started, with nothing in logcat
 * because nothing threw.
 *
 * These guard the shape of the fix rather than one call site: the query is
 * asked through a helper that cannot fail to answer, and no screen goes back
 * to asking the platform directly.
 */
module.exports = [
  {
    name: 'reduceMotion: the helper answers even when the platform does not',
    run() {
      const helper = read('src', 'utils', 'reduceMotion.ts');

      // Three ways to settle, and all of them must exist: the real answer, a
      // rejection, and a timeout for the case that is neither.
      assert.match(helper, /\.catch\(/, 'a rejected query must still answer');
      assert.match(helper, /setTimeout\(\(\) => finish\(false\)/, 'a silent query must still answer');
      assert.match(helper, /clearTimeout\(timer\)/, 'the timer must be cleared on a real answer');

      // False is the safe default in both fallbacks: guessing wrong costs a
      // reduce-motion user one animation, hanging costs everyone the app.
      assert.doesNotMatch(helper, /finish\(true\)/);

      // Settle-once, or a late platform answer would resolve a second time.
      assert.match(helper, /if \(settled\) \{/);
    },
  },
  {
    name: 'reduceMotion: nothing asks the platform directly any more',
    run() {
      const dirs = ['components', 'screens'];
      const offenders = [];

      for (const dir of dirs) {
        const base = path.join(root, 'src', dir);
        for (const entry of fs.readdirSync(base)) {
          if (!/\.tsx?$/.test(entry)) {
            continue;
          }
          const source = fs.readFileSync(path.join(base, entry), 'utf8');
          if (source.includes('AccessibilityInfo.isReduceMotionEnabled')) {
            offenders.push(`${dir}/${entry}`);
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `these ask the platform directly and can hang on null: ${offenders.join(', ')}`,
      );
    },
  },
  {
    name: 'reduceMotion: the splash cannot hold the app on a pending answer',
    run() {
      const splash = read('src', 'screens', 'VinhaSplashScreen.tsx');
      const app = readAppWiring();

      // The splash is the one screen where a third state is fatal, because
      // App renders nothing else until it reports done.
      assert.match(app, /if \(!brandSplashDone\) \{/);
      assert.match(splash, /queryReduceMotion\(\)/);
      assert.match(splash, /onDoneRef\.current\(\)/);
    },
  },
];
