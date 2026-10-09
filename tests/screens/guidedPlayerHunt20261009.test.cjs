const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
const alertHook = read('src', 'hooks', 'useRestEndAlert.ts');

/** The text between two markers, so a guard looks at one function and not the whole screen. */
function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing end: ${to}`);
  return source.slice(start, end);
}

/**
 * Guided player findings from the 2026-10-09 hunt (run 9). The logic that can
 * run in Node is in tests/lib/guidedHunt20261009 and guidedClockHold; these
 * pin the wiring in the screen that nothing else executes.
 */
module.exports = [
  {
    name: 'guided pause: every Pause stops the session clock too, from the set, rest, drill and interval screens',
    run() {
      // One way into the pause, and it takes the session clock with it.
      assert.equal(player.match(/setPaused\(true\)/g)?.length, 1);
      assert.doesNotMatch(player, /setPaused\(\(value\) => !value\)/);
      const pauseFn = between(player, 'const pause = useCallback(', '[workout]');
      assert.match(pauseFn, /setPaused\(true\)/);
      assert.match(pauseFn, /workout\.pauseWorkout\(\)/);
      // Rest and interval buttons share the toggle; the drill and set call pause().
      assert.equal(player.match(/onPress=\{paused \? unpause : pause\}/g)?.length, 2);
      assert.match(between(player, "if (paused) {\n                        unpause();", 'setPauseSheetOpen(true)'), /pause\(\);/);
      assert.match(between(player, 'onPause={() => {', 'onOpenActions'), /pause\(\);/);
    },
  },
  {
    name: 'guided rest: +30 s / +15 s extend from the deadline, not from the last tick',
    run() {
      const body = between(player, 'const adjustRemaining = (deltaMs', 'setRemainingMs(next);');
      assert.match(body, /endsAtRef\.current - Date\.now\(\)/);
      assert.doesNotMatch(body, /remainingRef\.current \+ deltaMs/);
    },
  },
  {
    name: 'guided clock: the end and skip-exercise confirmations hold the step clock',
    run() {
      const call = between(player, 'const frozen = guidedClockHeld({', '});');
      assert.match(call, /\bconfirmingEnd\b/);
      assert.match(call, /\bconfirmingSkipExercise\b/);
    },
  },
  {
    name: 'guided interval recovery: the lock screen cannot stretch or skip it, and its card offers no buttons for it',
    run() {
      const listener = between(player, 'subscribeRestActions((action) => {', 'session?.sessionId');
      assert.match(listener, /recoveryKind/);
      // Every arming of the OS rest alert says whether it is a recovery.
      const calls = player.match(/void syncRestNotification\(\n[\s\S]*?\);/g) ?? [];
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.match(call, /recoveryKind !== undefined/);
      }
      // And the hook turns that into the session card, which has no +30 s / skip.
      const sync = between(alertHook, 'async (endsAtMs: number | null', 'await scheduleRestLadder');
      assert.match(sync, /recovery/);
      assert.match(sync, /kind: 'session'/);
    },
  },
  {
    name: 'guided walk-up card: the rest it quotes is the ring the player runs',
    run() {
      assert.doesNotMatch(player, /rest: instance\.restSecondsMin/);
      assert.equal(player.match(/rest: guidedRestSeconds\(instance\.restSecondsMin\)/g)?.length, 3);
    },
  },
  {
    name: 'guided rest reopen: the deadline is written when a rest arms, moves or pauses, and read when the screen opens',
    run() {
      assert.match(player, /guidedRestOpeningMs\(session\?\.ui\.guidedResumeAnchor/);
      const adjust = between(player, 'const adjustRemaining = (deltaMs', 'setRemainingMs(next);');
      assert.match(adjust, /persistRestDeadline\(endsAtRef\.current\)/);
      const effect = between(player, 'if (mode !== \'player\' || frozen) {', 'const settle = () => {');
      assert.match(effect, /persistRestDeadline\(null\)/);
      assert.match(effect, /persistRestDeadline\(endsAtRef\.current\)/);
    },
  },
];
