const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The bug lists from the App.tsx split (#bugs 2026-10-01): small wiring
 * faults in src/app hooks, pinned where they were fixed. No React renderer
 * lives in this suite, so each is checked against the source, the way the
 * other src/app tests here are.
 */
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');

module.exports = [
  {
    name: 'recovery: rest-day writes read the stored list, so two quick taps keep both',
    run() {
      const source = read('src', 'app', 'useRecoverySheet.ts');
      assert.match(source, /updatePreferences\(\(current\) => \(\{\s*restDayStarts: withRestDay\(current\.restDayStarts,/);
      assert.match(source, /\(current\) => \(\{ restDayStarts: withoutRestDay\(current\.restDayStarts,/);
      // No write from the render's snapshot is left.
      assert.doesNotMatch(source, /withRestDay\(preferences\.restDayStarts|withoutRestDay\(preferences\.restDayStarts/);
    },
  },
  {
    name: 'coach: the training context is rebuilt when only the age band changes',
    run() {
      const source = read('src', 'app', 'useCoachContext.ts');
      assert.match(source, /ageRange: preferences\.setupAgeRange,/);
      assert.match(source, /preferences\.setupAge,\s*(\/\/[^\n]*\n\s*)*preferences\.setupAgeRange,/);
    },
  },
  {
    name: 'idle nudge: a renamed workout reaches the reminder without waiting for a set',
    run() {
      const source = read('src', 'app', 'useSessionNotifications.ts');
      assert.match(source, /activityTick,\s*(\/\/[^\n]*\n\s*)*workout\.activeSession\?\.templateName,/);
    },
  },
  {
    // React #520 on finish: GuidedPlayer returned early before ~20 hooks and
    // rendered once with no session while the route moved to the summary.
    name: 'guided player: no session is decided before the player and its hooks mount',
    run() {
      const source = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      const outer = source.slice(
        source.indexOf('export function GuidedPlayerScreen('),
        source.indexOf('function GuidedPlayer({'),
      );
      assert.match(outer, /const \{ activeSession \} = useWorkoutContext\(\);/);
      const gate = outer.indexOf('if (!activeSession) {');
      assert.ok(gate > 0 && gate < outer.indexOf('<GuidedPlayer {...props} />'), 'the player mounts before the session check');
      // Every hook of the outer component sits above its return.
      assert.ok(outer.lastIndexOf('use') < gate || !/\buse[A-Z]\w*\(/.test(outer.slice(gate)), 'a hook after the early return');
    },
  },
  {
    // "Warm up your own way" read as disabled on web: its splash wrapper was a
    // disabled Pressable, which marks its children aria-disabled.
    name: 'guided splash: a choice splash is inert by having no onPress, not by being disabled',
    run() {
      const source = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      assert.match(source, /onPress=\{splashCarriesChoice\(step\) \? undefined : advance\}/);
      // Disabled on native only: web marks a disabled wrapper's buttons aria-disabled.
      assert.match(source, /disabled=\{Platform\.OS === 'web' \? undefined : splashCarriesChoice\(step\)\}/);
      assert.match(source, /focusable=\{!splashCarriesChoice\(step\)\}/);
    },
  },
  {
    // Web: the font patch put an array style on a DOM <span> and crashed, and
    // a merged object there lost the weights that sit in class names.
    name: 'font patch: native only, so web neither crashes nor drops its weights',
    run() {
      const source = read('src', 'globalFont.ts');
      assert.match(source, /if \(Platform\.OS !== 'web'\) \{\s*applyBaseFont\(Text as unknown as RenderableComponent\);\s*applyBaseFont\(TextInput as unknown as RenderableComponent\);\s*\}/);
      // Native keeps the appended array, so the static family wins there.
      assert.match(source, /style: \[element\.props\.style, \{ fontFamily: family, fontWeight: 'normal' as const \}\]/);
    },
  },
  {
    // A rename must re-word the nudge without moving it; a resume or the
    // switch turned back on must arm a fresh one (review of the sweep).
    name: 'idle nudge: timed from the last activity, and a resume or switch-on is activity',
    run() {
      const source = read('src', 'app', 'useSessionNotifications.ts');
      assert.match(source, /lastActivityAtRef\.current = Date\.now\(\);\s*\}, \[activeSessionId, activeSessionStatus, completedSetCount, activityTick, preferences\.notificationPrefs\.idleNudge\]\);/);
      // A running bout of minutes can only push it later (#bugs 2026-10-06,
      // tests/features/workout/minutesClockKept.test.cjs).
      assert.match(source, /const atMs = idleNudgeAtMs\(Math\.max\(lastActivityAtRef\.current, boutDueMs \?\? 0\)\);/);
      // The activity effect is declared before the nudge's, so it has run.
      assert.ok(source.indexOf('lastActivityAtRef.current = Date.now();') < source.indexOf('const atMs = idleNudgeAtMs('));
    },
  },
];
