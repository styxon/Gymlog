const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const count = (text, needle) => text.split(needle).length - 1;

/**
 * The wiring half of the live-session audit (2026-09-20). The rules are held
 * in tests/features/workout/liveWorkoutKept, tests/lib/sessionClockWindow and
 * tests/lib/programmeDeletion; this holds the provider, the player and the
 * app to them.
 */
module.exports = [
  {
    name: 'live workout wiring: the provider resumes without a session in hand, and a step carries its time',
    run() {
      const provider = read('src', 'features', 'workout', 'WorkoutProvider.tsx');
      const resume = provider.slice(provider.indexOf('      resumeWorkout() {'), provider.indexOf('      finishWorkout(performedAt) {'));
      assert.ok(resume.length > 0, 'resumeWorkout must be found');
      // The value is built from one render's state; a session read from it is
      // the one from before the tap that logged, swapped or skipped.
      assert.doesNotMatch(resume, /state\.activeSession/, 'resume must not read the render\'s session');
      assert.match(resume, /dispatch\(\{ type: 'session\/resume', payload: \{ nowMs: Date\.now\(\) \} \}\);/);
      assert.match(
        provider,
        /dispatch\(\{ type: 'session\/setGuidedStep', payload: \{ stepIndex, anchor, nowMs: Date\.now\(\) \} \}\);/,
        'a step moved on is time in the workout, and the reducer needs its time',
      );
    },
  },
  {
    name: 'live workout wiring: every way out of the player\'s pause resumes the session clock too',
    run() {
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      assert.match(
        player,
        /const unpause = useCallback\(\(\) => \{\s*setPaused\(false\);\s*workout\.resumeWorkout\(\);\s*\}, \[workout\]\);/,
        'one way out of the pause, for the screen and the clock together',
      );
      // Nothing clears the screen's pause on its own: that is how closing the
      // actions sheet left the screen saying "Pause" with the clock stopped.
      assert.equal(count(player, 'setPaused(false)'), 1, 'setPaused(false) only inside unpause');
      assert.equal(count(player, 'workout.resumeWorkout()'), 1, 'the session resumes only through unpause');
      // And nothing asks the last render whether the session is paused.
      assert.doesNotMatch(player, /activeSession\?\.pausedAt/);

      const goTo = player.slice(player.indexOf('const goTo = useCallback('), player.indexOf('/** ±15s / +10s'));
      assert.match(goTo, /\bunpause\(\);/, 'moving on resumes');
      assert.match(
        player,
        /\{pauseSheetOpen && \(\s*<GPSheet\s*title=\{[^}]*\}\s*language=\{language\}\s*onClose=\{\(\) => \{\s*setPauseSheetOpen\(false\);\s*unpause\(\);/,
        'closing the actions sheet resumes',
      );
      // Updated 2026-09-29 (#bugs, swap sheet v2): the close handler now also
      // resets the sheet's browse-all state (setSwapBrowseOpen/setSwapBodyPartFilter)
      // between the query reset and unpause — still one path out, unpause still last.
      assert.match(
        player,
        /<ExercisePickerSheet\s*visible=\{swapOpen && Boolean\(actionExercise\)\}[\s\S]*?onClose=\{\(\) => \{\s*setSwapOpen\(false\);\s*setSwapQuery\(''\);\s*setSwapBodyPartFilter\(null\);\s*setSwapCategory\('all'\);\s*setSwapEquipment\('all'\);\s*unpause\(\);/,
        'closing the swap sheet resumes',
      );
      const applySwap = player.slice(player.indexOf('const applySwap = ('), player.indexOf('const resyncTargetRef'));
      assert.match(applySwap, /workout\.swapExercise\([\s\S]*unpause\(\);\s*\};/);
      const skip = player.slice(player.indexOf('const handleSkipExercise = () => {'), player.indexOf('const handleAddSet = () => {'));
      assert.match(skip, /workout\.skipExercise\(actionSlotId\);\s*setPauseSheetOpen\(false\);\s*unpause\(\);/);
    },
  },
  {
    name: 'live workout wiring: back on the guided route is the player\'s, from the first frame',
    run() {
      // The whole shell, and the end searched from the start, not from the top
      // of the file: the handler left App.tsx for a src/app hook in the
      // phase-C split (2026-10-01).
      const effect = between(
        readAppWiring().replace(/\r\n/g, '\n'),
        '   * The route-level back.',
        "const subscription = BackHandler.addEventListener('hardwareBackPress'",
      );
      assert.ok(effect.length > 0, 'the route-level back handler must be found');
      assert.match(
        effect,
        /if \(route\.tab === 'workout' && route\.screen === 'guided'\) \{\s*return undefined;\s*\}/,
        'the app must stand down for the guided player',
      );
      // Standing down is safe only because the player answers back in both
      // of its modes, and always says it did.
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      assert.match(
        player,
        // The one new first line is the save lock: while Finish saves the player answers back and does nothing.
        /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{(?:\s*\/\/[^\n]*)*\s*if \(isSavingWorkout\) \{\s*return true;\s*\}\s*if \(mode === 'player'\) \{\s*setExitOpen\(true\);\s*return true;\s*\}\s*onLeave\(\);\s*return true;\s*\}\);/,
      );
    },
  },
  {
    name: 'live workout wiring: a programme with a workout of it running is not deleted, and the reader is told why',
    run() {
      const app = read('App.tsx');
      const handler = app.slice(
        app.indexOf('  async function handleDeleteCustomWorkout(workoutTemplateId: string) {'),
        app.indexOf('  function leaveDeletedProgramme('),
      );
      assert.ok(handler.length > 0, 'handleDeleteCustomWorkout must be found');
      assert.match(
        handler,
        /if \(liveSessionBlocksProgrammeDelete\(workout\.activeSession, workoutTemplateId\)\) \{[\s\S]*?showToast\(t\(preferences\.appLanguage, 'toast\.programDeleteWorkoutRunning'\)\);\s*return;\s*\}\s*await deleteWorkoutTemplate\(workoutTemplateId\);/,
        'the refusal must come before the delete',
      );
      const { t } = require('../../.test-dist/lib/i18n.js');
      for (const language of ['en', 'fi']) {
        const text = t(language, 'toast.programDeleteWorkoutRunning');
        assert.ok(text && text !== 'toast.programDeleteWorkoutRunning', `${language} copy`);
      }
      assert.notEqual(t('en', 'toast.programDeleteWorkoutRunning'), t('fi', 'toast.programDeleteWorkoutRunning'));
    },
  },
];
