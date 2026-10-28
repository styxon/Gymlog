const assert = require('node:assert/strict');
const { readGuidedPlayerSource } = require('../helpers/guidedPlayerSource.cjs');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * The guided player takes no input while Finish saves (bug hunt 2026-10-03, never-list N1).
 *
 * handleConfirmFinishWorkout adapts the session before its await. The exit sheet's "Finish & save"
 * closed the sheet and left the player on the set step, so a set ticked while the save was in
 * flight reached the reducer and the slot history, was not in the saved workout, and went with the
 * finished session when it was cleared. The free workout board already refuses edits during its
 * Finish (EmptyWorkoutScreen's finishingRef); the guided player gets the same rule as a layer over
 * the whole screen, which is released when the save fails so the save-failed panel and its retry
 * stay reachable.
 *
 * A source test: the lock is a render, and there is no React renderer in this suite. The reducer
 * itself takes any action it is sent, by design (the player is the only thing that sends them), so
 * the lock cannot live there without a `finishing` state the persisted bundle would then carry.
 */
module.exports = [
  {
    name: 'guided player: a layer over the whole screen takes every touch while Finish saves, drawn last so nothing sits above it',
    run() {
      const player = readGuidedPlayerSource();
      const overlay = '{isSavingWorkout ? <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} /> : null}';
      assert.equal(player.split(overlay).length - 1, 1, 'one touch-absorbing layer, keyed on isSavingWorkout');
      const at = player.indexOf(overlay);
      // The root's last child: the closing tags of the screen follow it directly.
      assert.match(player.slice(at + overlay.length, at + overlay.length + 40), /^\s*<\/View>\s*\);\s*\}/, 'nothing is rendered after the layer');
      // After the last sheet the screen renders, so no sheet's own touch target sits above it.
      assert.ok(at > player.indexOf('<RestAlertsSheet'), 'drawn after the sheets');
      assert.ok(at > player.indexOf('<AddExerciseSheet'), 'drawn after the add-exercise sheet');
    },
  },
  {
    name: 'guided player: the hardware back does nothing while Finish saves, rather than opening the exit sheet and its discard',
    run() {
      const player = readGuidedPlayerSource();
      assert.match(
        player,
        /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{(?:\s*\/\/[^\n]*)*\s*if \(isSavingWorkout\) \{\s*return true;\s*\}/,
        'the first thing the back handler asks',
      );
      assert.match(player, /\}, \[mode, onLeave, isSavingWorkout\]\);/, 'the listener is re-registered when the flag flips');
    },
  },
  {
    name: 'guided player: the lock is exactly the save: on before the await, off on every way out of it',
    run() {
      // The shell hands the player the finish machine's state.
      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(tab, /isSavingWorkout=\{finishSaveState\.status === 'saving'\}/);
      const saves = read('src', 'app', 'finishSaves.tsx');
      const fn = saves.slice(saves.indexOf('async function handleConfirmFinishWorkout()'), saves.indexOf('const finishLoggedWorkoutSave = async'));
      const saving = fn.indexOf("status: 'saving'");
      const awaited = fn.indexOf('await saveCompletedWorkoutSession(');
      assert.ok(saving > 0 && awaited > saving, 'the state is saving before the save is awaited');
      // Every way out of the await leaves the state: success (idle, then the summary), a failure after
      // the save (idle, back out), a failed save (error, which releases the lock and shows the panel).
      assert.equal((fn.match(/setFinishSaveState\(\{ status: 'idle', sessionId: null \}\)/g) ?? []).length >= 2, true, 'success and the after-save failure both go idle');
      assert.match(fn, /setFinishSaveState\(\{\s*status: 'error',/, 'a failed save goes to error, which is not saving');
    },
  },
];
