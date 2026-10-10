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
      const reps = between(player, 'label={t(language, minutesMode ?', 'onDraftCleared={() => setTypedTextInvalid(false)}');
      assert.match(reps, /setTypedTextInvalid\(!isLoggableTypedReps\(text, repsBounds\)\)/);
      assert.match(reps, /invalid=\{logBlocked\}/);
      assert.match(player, /const logBlocked = dial !== null && typedTextInvalid;/);
      assert.match(player, /const repsBounds = inWarmup \? WARMUP_REPS_DIAL/);
      // Both the warm-up and the working log buttons wait on it.
      assert.equal(player.match(/disabled=\{logBlocked/g)?.length, 2);
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