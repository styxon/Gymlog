const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');

/** The text between two markers, so a guard looks at one function and not the whole screen. */
function between(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing end: ${to}`);
  return source.slice(start, end);
}

/** Guided player findings from the 2026-10-10 hunt (run 11): the wiring nothing else executes. */
module.exports = [
  {
    name: 'hunt 11: the card, its weight and the sheet read only the sets of the lift in the slot',
    run() {
      assert.match(player, /resolveGuidedSetPlan\(liftSets,/);
      assert.match(player, /sets: liftSets,\s*currentSetIndex/);
      assert.match(player, /\(instance \? setsOfCurrentLift\(instance\) : \[\]\)/);
      assert.doesNotMatch(player, /\(instance\?\.sets \?\? \[\]\)\s*\.filter\(\(set\) => set\.status === 'completed'\)/);
    },
  },
  {
    name: 'hunt 11: typed reps / seconds / minutes block Log like a typed weight, and a warm-up is held to 100',
    run() {
      const reps = between(player, 'label={t(language, minutesMode ?', 'onDraftCleared');
      assert.match(reps, /setTypedTextInvalid\(!isLoggableTypedReps\(text, repsBounds\)\)/);
      assert.match(reps, /invalid=\{typedErrorShown\}/);
      // A text that can still become loggable ("3" on the way to 30 s) is not flagged yet; Log still waits.
      assert.match(reps, /setTypedTextPending\(!isLoggableTypedReps\(text, repsBounds\) && isTypedRepsPossiblyValid\(text, repsBounds\)\)/);
      assert.match(player, /const typedErrorShown = logBlocked && !typedTextPending;/);
      assert.match(player, /const logBlocked = dial !== null && typedTextInvalid;/);
      assert.match(player, /const repsBounds = inWarmup \? WARMUP_REPS_DIAL/);
      // Both the warm-up and the working log buttons wait on it.
      assert.equal(player.match(/disabled=\{logDisabled/g)?.length, 2);
      assert.doesNotMatch(player, /disabled=\{logBlocked/);
      // Log is dead only once the field is flagged. A pending text ("3" on the
      // way to 30 s) keeps the button live: a press shows the message and logs
      // nothing, rather than doing nothing silently.
      assert.match(player, /const logDisabled = logBlocked && !typedTextPending;/);
      const waits = between(player, 'const logWaitsOnTypedText = () => {', '\n  };');
      assert.match(waits, /if \(!logBlocked\) \{\s*return false;\s*\}\s*setTypedTextPending\(false\);\s*return true;/);
      assert.equal(player.match(/if \(logWaitsOnTypedText\(\)\) \{\s*return;\s*\}/g)?.length, 2);
      assert.match(player, /'guided\.repsInvalid'/);
    },
  },
  {
    name: 'hunt 11: the actions menu pauses while open and gives back the pause it found',
    run() {
      const open = between(player, 'const openActionsMenu = () => {', '};');
      assert.match(open, /menuHeldPauseRef\.current = found;/);
      assert.match(open, /if \(!found\) \{\s*pause\(\);/);
      const close = between(player, 'const closeActionsMenu = () => {', '\n  };');
      assert.match(close, /if \(!menuHeldPauseRef\.current\) \{\s*unpause\(\);/);
      assert.match(player, /onOpenActions=\{openActionsMenu\}/);
      assert.match(between(player, "title={t(language, 'guided.pauseSheet.title')}", 'bottomInset'), /closeActionsMenu\(\);/);
      // Cancelling the swap opened from the menu does not resume a chosen pause either.
      assert.match(between(player, "setSwapEquipment('all');\n          closeActionsMenu", '}}'), /closeActionsMenu/);
    },
  },
  {
    name: 'hunt 11: the menu gives a bout its clock back only when the menu stopped it',
    run() {
      const open = between(player, 'const openActions = () => {', '};');
      assert.match(open, /menuStoppedWatchRef\.current = minutesMode && !paused && watch\.runningSinceMs !== null;/);
      const effect = between(player, 'if (paused && watch.runningSinceMs !== null) {', '[paused]');
      assert.match(effect, /else if \(!paused && menuStoppedWatchRef\.current\) \{\s*[^]*menuStoppedWatchRef\.current = false;[^]*startStopwatch\(watch, now\)/);
      assert.match(player, /onPress=\{openActions\}/);
    },
  },
  {
    name: 'hunt 11: both card lines follow the set within the lift, and the menu exits that move on clear the held pause',
    run() {
      assert.match(player, /guidedWindow\(panels\?\.history\?\.sets\.length \?\? 0, liftPosition,/);
      assert.match(player, /guidedWindow\(todayPlan\.length, liftPosition,/);
      const moveOn = between(player, 'const moveOnFromMenu = () => {', '};');
      assert.match(moveOn, /menuHeldPauseRef\.current = false;\s*unpause\(\);/);
      assert.equal(player.match(/moveOnFromMenu\(\);/g)?.length, 4);
    },
  },
  {
    name: 'hunt 11: a change to a frozen rest is stored as the time left',
    run() {
      const body = between(player, 'const adjustRemaining = (deltaMs', 'setRemainingMs(next);');
      assert.match(body, /\} else if \(mode === 'player'\) \{[\s\S]*persistRestLeft\(next\);/);
    },
  },
  {
    name: 'hunt 11: resuming from a pause puts the lock-screen session card back, once and not over a rest',
    run() {
      const effect = between(player, 'const lastSessionStatusRef = useRef(sessionStatus);', '[sessionStatus]');
      assert.match(effect, /was === 'paused' && sessionStatus === 'active'/);
      assert.match(effect, /step\.type !== 'rest'/);
      assert.match(effect, /syncRestNotification\(null, null\)/);
    },
  },
  {
    name: 'hunt 11: the OS rest card names the next lift through the table once',
    run() {
      assert.doesNotMatch(player, /exerciseNameLabel\(language, getGuidedNextName\(/);
      assert.equal(player.match(/getGuidedNextName\(steps, stepIndex, language\)/g)?.length, 3);
    },
  },
];