const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workoutReducer } = require('../../../.test-dist/features/workout/workoutState');

/**
 * Live-session audit, 2026-09-15: what the guided player does between Start
 * and the summary has to keep what the reader did.
 */

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};
const AT = Date.parse('2026-09-15T17:00:00.000Z');
const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

function exercise(overrides) {
  return {
    id: 'e1',
    exerciseName: 'Bench Press',
    slotId: 'press',
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin: 6,
    repsMax: 8,
    restSecondsMin: 90,
    restSecondsMax: 120,
    substitutionGroup: 'press',
    ...overrides,
  };
}

function startWith(exercises) {
  return workoutReducer(EMPTY, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: { id: 'tpl', name: 'Day', defaultScheduleMode: 'weekly', sessions: [{ id: 'day', name: 'Day', orderIndex: 0, exercises }] },
      sessionOrderIndex: 0,
      unitPreference: 'kg',
    },
  });
}

function log(state, slotId, setIndex, loadText, repsText) {
  const drafted = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId, setIndex, patch: { loadText, repsText } } });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId, setIndex, nowMs: AT, unitPreference: 'kg' } });
}

const setOf = (state, index = 0) => state.activeSession.exercises[0].sets[index];

module.exports = [
  {
    name: 'guided: an interval work bout is logged with no load, as the timer logs it',
    run() {
      let state = startWith([
        exercise({ exerciseName: 'Treadmill HIIT (30s on / 30s off)', trackingMode: 'reps_first', sets: 8, repsMin: 30, repsMax: 30, restSecondsMin: 30, restSecondsMax: 30, substitutionGroup: 'cardio_intervals' }),
      ]);
      const slotId = state.activeSession.exercises[0].slotId;
      // Exactly what the player's expiry does: reps = the work seconds, load empty.
      state = log(state, slotId, 0, '', '30');
      assert.equal(setOf(state).status, 'completed');
      assert.equal(setOf(state).actualReps, 30);
      assert.equal(setOf(state).actualLoadKg, 0);
      // Its number is seconds, so a long bout is not held to the reps dial's 300.
      let long = startWith([
        exercise({ exerciseName: 'Bike intervals (400s hard / 60s easy)', trackingMode: 'reps_first', sets: 2, repsMin: 400, repsMax: 400, substitutionGroup: 'cardio_intervals' }),
      ]);
      long = log(long, long.activeSession.exercises[0].slotId, 0, '', '400');
      assert.equal(setOf(long).status, 'completed');

      // A loaded lift still needs its load.
      let bench = startWith([exercise({})]);
      bench = log(bench, bench.activeSession.exercises[0].slotId, 0, '', '8');
      assert.equal(setOf(bench).status, 'pending');
    },
  },
  {
    name: 'guided: a weight or rep count past the dials is refused, logged or corrected',
    run() {
      let state = startWith([exercise({})]);
      const slotId = state.activeSession.exercises[0].slotId;
      // "825" for 82,5 at logging.
      const typo = log(state, slotId, 0, '825', '6');
      assert.equal(setOf(typo).status, 'pending');
      const tooManyReps = log(state, slotId, 0, '80', '400');
      assert.equal(setOf(tooManyReps).status, 'pending');

      state = log(state, slotId, 0, '82.5', '6');
      assert.equal(setOf(state).status, 'completed');
      // And at correction.
      const edited = workoutReducer(state, { type: 'set/editLogged', payload: { slotId, setIndex: 0, reps: 6, loadKg: 825 } });
      assert.equal(setOf(edited).actualLoadKg, 82.5);
      const repsEdited = workoutReducer(state, { type: 'set/editLogged', payload: { slotId, setIndex: 0, reps: 66666, loadKg: 82.5 } });
      assert.equal(setOf(repsEdited).actualReps, 6);
      const fine = workoutReducer(state, { type: 'set/editLogged', payload: { slotId, setIndex: 0, reps: 7, loadKg: 85 } });
      assert.equal(setOf(fine).actualLoadKg, 85);

      // A hold counts seconds, so ten minutes is a hold and not a typo.
      let plank = startWith([exercise({ exerciseName: 'Plank', trackingMode: 'hold', repsMin: 30, repsMax: 60, substitutionGroup: 'core' })]);
      plank = log(plank, plank.activeSession.exercises[0].slotId, 0, '', '600');
      assert.equal(setOf(plank).status, 'completed');

      // A prescription past the reps dial is still the prescription: the
      // catalog's "Rowing Machine (500m intervals)" asks for 500 (PR #121 review).
      let rowing = startWith([exercise({ exerciseName: 'Rowing Machine (500m intervals)', repsMin: 500, repsMax: 500, sets: 6, substitutionGroup: 'row' })]);
      rowing = log(rowing, rowing.activeSession.exercises[0].slotId, 0, '0', '500');
      assert.equal(setOf(rowing).status, 'completed');
      assert.equal(setOf(rowing).actualReps, 500);
      const rowingEdited = workoutReducer(rowing, { type: 'set/editLogged', payload: { slotId: rowing.activeSession.exercises[0].slotId, setIndex: 0, reps: 480, loadKg: 0 } });
      assert.equal(setOf(rowingEdited).actualReps, 480);
    },
  },
  {
    name: 'guided: the free workout will not tick a set nobody could lift, or keep one ticked',
    run() {
      // The rule itself is covered in tests/lib/emptyWorkoutSession; this is the wiring.
      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      assert.match(screen, /if \(!set\.done && !isLoggableFreestyleSet\(set\)\) \{\s*void haptics\.error\(\);\s*return;/);
      // The weight and rep fields stay editable after the tick, so the same
      // rule has to hold on the way through the edit: 82,5 ticked and then
      // typed over as 825 stayed ticked at 825 kg (PR #121 review).
      assert.match(
        screen,
        // Blank reps mid-edit are judged as if filled, so clearing a number to
        // retype it keeps the tick; an unliftable weight still takes it off.
        /const checked = next\.reps\.trim\(\) \? next : \{ \.\.\.next, reps: '1' \};\s*return next\.done && !isLoggableFreestyleSet\(checked\) \? \{ \.\.\.next, done: false \} : next;/,
      );
    },
  },
  {
    name: 'guided: moving on resumes a paused session, a logged set is not logged again, and a failed save says so',
    run() {
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      const goTo = player.slice(player.indexOf('const goTo = useCallback('), player.indexOf('/** ±15s / +10s'));
      // Through `unpause`, and without asking first. This pinned
      // `if (workout.activeSession?.pausedAt) { workout.resumeWorkout(); }`,
      // and that line was the bug: the check and the resume both read the
      // session from the render the tap happened in, and the resume put that
      // session back over the set logged in the same tap (live-session audit,
      // 2026-09-20; tests/screens/liveWorkoutWiring holds the rest).
      assert.match(goTo, /\bunpause\(\);/);
      assert.doesNotMatch(goTo, /activeSession\?\.pausedAt/);
      const confirm = player.slice(player.indexOf('const confirmSet = ('), player.indexOf('expireRef.current = () =>'));
      assert.match(confirm, /if \(isSetCompleted\(slotId, setIndex\)\) \{\s*advance\(\);\s*return;\s*\}\s*const draft = \{/);
      // And a set the store would refuse is not cheered on and walked past:
      // the same rule the reducer applies is asked first, and the draft is
      // written, the set completed and "done" played only after it says yes
      // (break round 2026-09-28: a bar tap past 500 kg lost the set).
      assert.match(
        confirm,
        /!canCompleteSet\([\s\S]*?\)\s*\) \{\s*void haptics\.error\(\);\s*return;\s*\}\s*workout\.updateSetDraft\(slotId, setIndex, draft\);\s*workout\.completeSet\(slotId, setIndex, unitPreference\);\s*cue\('done'\);/,
      );
      assert.match(player, /goToRef\.current\(rollPastLoggedWork\(steps, Math\.min\(target, steps\.length - 1\), isSetCompletedRef\.current\)\);/);

      // The editor's Save follows the reducer's own ceiling, interval and
      // prescription included, so Save and the store cannot disagree.
      // And a field holding no number is not the old number (decimal audit,
      // 2026-09-21): an emptied or "82,,5" field saved the value from before.
      assert.match(
        player,
        /typedReps !== null &&\s*nextReps > 0 &&\s*nextReps <= repsCeiling &&\s*\(unloaded \|\| \(typedLoad !== null && isLiftableWeight\(nextLoad\)\)\)/,
      );
      // Asked of the lift the set was logged as, which is what the reducer
      // asks since a swap changes the exercise's mode (review of #170; this
      // pinned `repsCeilingFor(exercise, …)` until then — see guidedPlayerSwap).
      assert.match(player, /repsCeilingFor\(restEditLift, findSetByIndex\(exerciseBySlot\.get\(restEdit\.slotId\), restEdit\.setIndex\)\)/);
      // And the correction is written to the set the reader chose, which in a
      // superset is not always the one the rest step names (2026-09-16).
      assert.match(
        player,
        /workout\.editLoggedSet\(restEdit\.slotId, restEdit\.setIndex, reps, loadKg\);/,
      );
      // The superset landing rule lives in tests/lib/guidedPlayer; this is its wiring.

      // The finish step shows the failure and the save again.
      assert.match(player, /<FinishView\s*onFinish=\{onFinishSession\}\s*saveFailed=\{saveFailed && !isSavingWorkout\}/);
      assert.match(player, /if \(saveFailed\) \{[\s\S]{0,400}<BigBtn label=\{t\(language, 'guided\.finish\.saveFailed\.retry'\)\} onPress=\{onFinish\} \/>/);
      assert.match(read('src', 'app', 'renderWorkoutTab.tsx'), /saveFailed=\{finishSaveState\.status === 'error'\}/);
    },
  },
  {
    name: 'guided: leaving the coach mid-answer cancels it, charges nothing and takes the question back',
    run() {
      const chat = read('src', 'screens', 'AICoachChatScreen.tsx');
      // To the end of the effect, not a character count: the window was 1400
      // characters and the compose cleanup added beside it pushed the ask's
      // own lines out of it (audit 3, 2026-09-19).
      const start = chat.indexOf('const pendingAskRef = useRef');
      assert.notEqual(start, -1, 'the pending-ask ref moved');
      const end = chat.indexOf('\n    [],\n  );', start);
      assert.ok(end > start, 'the cleanup effect no longer ends where this guard thinks');
      const cleanup = chat.slice(start, end);
      assert.match(cleanup, /askToken\.current \+= 1;\s*pending\.controller\.abort\(\);/);
      assert.match(cleanup, /message\.id !== `me:\$\{pending\.token\}`/);
      assert.match(chat, /pendingAskRef\.current = \{ token, controller \};/);
      assert.match(chat, /\}, controller\.signal\);\s*if \(token !== askToken\.current\) \{\s*return;/);

      // And a compose that has not come back is cancelled on the way out, the
      // way the ask above it is: a composition is a billed call, and one left
      // running answers into a screen that is gone (audit 3, 2026-09-19).
      assert.match(cleanup, /for \(const controller of composeControllersRef\.current\.values\(\)\) \{\s*controller\.abort\(\);/);
      assert.match(chat, /composeControllersRef\.current\.set\(messageId, controller\);/);
      assert.match(chat, /await onComposeProgramme\(offer\.brief, controller\.signal\)/);

      // The building line never enters the thread at all. It used to replace
      // the offer message, and the thread is published upward on every
      // change, so leaving mid-build kept "Rakennan viikkoa…" in the
      // conversation with nothing that could ever resolve it and no offer
      // left to retry. Held beside the thread instead, so what is published
      // is never a state that only makes sense on a mounted screen.
      assert.match(chat, /const \[composingIds, setComposingIds\] = useState<readonly string\[\]>\(\[\]\);/);
      assert.match(chat, /composingIds\.includes\(message\.id\) \? \(/);
      assert.doesNotMatch(chat, /id: `\$\{messageId\}:building`/);
      // Cleared in a finally: a rejected compose must not leave the offer
      // under a spinner with no way out.
      assert.match(
        chat,
        /\} finally \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*setComposingIds\(\(current\) => current\.filter\(\(id\) => id !== messageId\)\);/,
      );
    },
  },
  {
    name: 'guided: taking a set away lands on the next lift’s walk-up, not past it',
    run() {
      // Removing the last set deletes it and the rest before it, so the list
      // shrinks under the index the reader is on and the same index becomes
      // the next lift's first set — its walk-up skipped (2026-09-16).
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      const remove = player.slice(player.indexOf('const removable = block.every('), player.indexOf('panels={setPanelSource}'));
      assert.match(remove, /resyncTargetRef\.current = blockStart >= 0 \? blockStart : stepIndex;/);
      assert.ok(
        remove.indexOf('resyncTargetRef.current =') < remove.indexOf('workout.removeSet(step.slotId);'),
        'the landing place is chosen before the steps are rebuilt',
      );
      // And ONLY when the step being removed is the one under the reader's
      // feet. The set that goes is the lift's last, so from any earlier set
      // nothing in front of them moves — and re-resolving would walk them
      // back to a walk-up they have already been through (PR #126 review).
      assert.match(
        remove,
        /const removedSetIndex = \(exercises\[index\]\?\.sets\.length \?\? 0\) - 1;\s*if \(step\.setIndex === removedSetIndex\) \{/,
      );

      // The rule it lands by is the one tests/lib/guidedPlayer covers.
      const { rollPastLoggedWork } = require('../../../.test-dist/lib/guidedPlayer.js');
      const steps = [
        { type: 'position', phase: 'work', slotId: 'a', exerciseName: 'A', seconds: 20, groupIndex: 0, exerciseIndex: 0, exerciseCount: 2 },
        { type: 'set', phase: 'work', slotId: 'a', setIndex: 0, exerciseName: 'A', groupIndex: 0 },
        { type: 'rest', phase: 'work', slotId: 'a', setIndex: 0, seconds: 90, groupIndex: 0 },
        { type: 'position', phase: 'work', slotId: 'b', exerciseName: 'B', seconds: 20, groupIndex: 0, exerciseIndex: 1, exerciseCount: 2 },
        { type: 'set', phase: 'work', slotId: 'b', setIndex: 0, exerciseName: 'B', groupIndex: 0 },
      ];
      // A's only remaining set is logged, so rolling from A's block start
      // stops at B's walk-up rather than at B's set.
      assert.equal(rollPastLoggedWork(steps, 0, (slotId) => slotId === 'a'), 3);
      // And with nothing logged it answers A's own walk-up — which is why
      // the resync must not run from a set the reader is still standing on:
      // it would send them backwards through a lead-in they have done.
      assert.equal(rollPastLoggedWork(steps, 0, () => false), 0);
    },
  },
  {
    name: 'guided: the walk-up is read in one glance',
    run() {
      // A two-line name pushed the walk-up into a scroll (device,
      // 2026-09-16). The name holds one line and the type gives way instead.
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      const walk = player.slice(player.indexOf("{t(language, 'guided.nextUp')}"), player.indexOf("t(language, 'guided.walk.today')"));
      assert.match(
        walk,
        // The full name for a screen reader may sit before the close (2026-09-27).
        /<Text\s*style=\{styles\.positionName\}\s*numberOfLines=\{1\}\s*adjustsFontSizeToFit\s*minimumFontScale=\{0\.5\}\s*(?:accessibilityLabel=\{[^}]*\}\s*)?>/,
      );
      assert.match(walk, /height=\{210\}/);
    },
  },
  {
    name: 'guided: the rest keeps counting while its contents sheet is open',
    run() {
      // The sheet held the clock from 2026-09-16 (a rest that ran out under it
      // moved the lift the reader was about to correct). Every lift with a
      // logged set has its own pencil now, and the reader found the rest
      // standing still whenever they looked ahead (#bugs 2026-10-06). The
      // sheet is a list to read; reading it is what a rest is for.
      const player = read('src', 'screens', 'GuidedPlayerScreen.tsx');
      const { guidedClockHeld } = require('../../../.test-dist/lib/guidedClockHold.js');
      const none = {
        paused: false, howToOpen: false, exitOpen: false, pauseSheetOpen: false, swapOpen: false,
        addExerciseOpen: false, restEditOpen: false, runSheetOpen: false, ownBlockActive: false,
        restAlertsAskOpen: false,
      };
      assert.equal(guidedClockHeld(none), false);
      assert.equal(guidedClockHeld({ ...none, runSheetOpen: true }), false, 'the contents sheet never holds the clock');
      // Every other overlay still does, alone.
      for (const key of Object.keys(none).filter((name) => name !== 'runSheetOpen')) {
        assert.equal(guidedClockHeld({ ...none, [key]: true }), true, `${key} holds the clock`);
        assert.equal(guidedClockHeld({ ...none, [key]: true, runSheetOpen: true }), true, `${key} still holds under the sheet`);
      }
      // The screen hands the real state to it, the sheet's flag included, and
      // nothing else in the screen folds the sheet back into the hold.
      const frozenCall = player.match(/const frozen = guidedClockHeld\(\{[^}]*\}\);/);
      assert.ok(frozenCall, 'frozen comes from guidedClockHeld');
      assert.match(frozenCall[0], /\brunSheetOpen,/);
      assert.doesNotMatch(player, /runSheetHolds/);
      // The clock honours `frozen` and nothing else: the step effect stops
      // (and withdraws the OS alert) only on it, so with the sheet open the
      // deadline stands, the 3-2-1 ticks and the end cue fire, and the OS
      // alert stays scheduled.
      assert.match(player, /if \(mode !== 'player' \|\| frozen\) \{\s*\/\/ Pausing freezes the leftover time/);
      assert.match(player, /\}, \[mode, frozen, stepIndex, step\.type, cue, steps, syncRestNotification\]\);/);
      // Opening and closing the sheet only flips its own flag.
      const opens = player.match(/setRunSheetOpen\((true|false)\)/g) ?? [];
      assert.ok(opens.length >= 4);
      assert.doesNotMatch(player, /setRunSheetOpen\(false\);\s*(?:unpause|setPaused)\(/);
      assert.doesNotMatch(player, /onClose=\{\(\) => \{\s*setRunSheetOpen\(false\);\s*setPaused/);

      // No "Olet tässä" line, in the sheet or the dictionaries.
      assert.doesNotMatch(player, /guided\.runSheet\.here/);
      assert.doesNotMatch(read('src', 'lib', 'i18n.ts'), /'guided\.runSheet\.here'/);
      // And the correction reads as a control: a pencil button on the right
      // of each lift's own line (#bugs 2026-09-30, "kynäikoni oikealle").
      assert.match(
        player,
        /style=\{\(\{ pressed \}\) => \[styles\.runEditBtn, pressed && \{ opacity: 0\.7 \}\]\}\s*>\s*<GPIcon name="edit"/,
      );
      // Orange in both themes: `highlight` is violet in light, and the chip
      // read as purple on the reader's phone (device, 2026-09-16).
      assert.match(player, /<GPIcon name="edit" size=\{17\} color=\{theme\.orange\} sw=\{2\.4\} \/>/);
      assert.match(player, /runEditBtn: \{[^}]*width: 36,\s*height: 36,[^}]*borderColor: theme\.orange,\s*backgroundColor: theme\.orangeSoft,/);
      assert.match(player, /runMember: \{ flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
      // A long session scrolls (#bugs 2026-10-06, nine lifts and the last
      // rows below the sheet): GPSheet scrolls the rows itself, bounded by
      // measured space — the scrim, the sheet's head, the bottom padding with
      // the safe-area inset read on the screen — not by a guess from the window.
      assert.doesNotMatch(player, /runSheetListMaxHeight/);
      assert.match(
        player,
        /<GPSheet\s*title=\{t\(language, 'guided\.runSheet\.title'\)\}[\s\S]*?bottomInset=\{screenInsets\.bottom\}\s*scrollable\s*>\s*\{buildGuidedRunSheet\(stepPlan, stepIndex\)/,
      );
      assert.match(player, /const bottomPadding = bottomInset \+ 30;/);
      assert.match(player, /const listMaxHeight = sheetScrollMaxHeight\(\{\s*areaHeight: areaHeight \?\? windowHeight,\s*capFraction: SHEET_CAP_FRACTION,\s*headHeight: headHeight \?\? 81,\s*bottomPadding,\s*\}\);/);
      assert.match(player, /style=\{styles\.sheetScrim\}\s*onPress=\{onClose\}\s*onLayout=\{\(event\) => setAreaHeight\(/);
      assert.match(player, /style=\{styles\.sheetGrab\}\s*onLayout=\{\(event\) => setHeadHeight\(/);
      assert.match(player, /<ScrollView\s*style=\{\[styles\.sheetScroll, \{ maxHeight: listMaxHeight \}\]\}/);
      assert.match(player, /  sheetScroll: \{ flexGrow: 0, flexShrink: 1 \},/);
      assert.match(player, /const SHEET_CAP_FRACTION = 0\.78;/);
      // And the sheet it sits in is still capped at the 78 % that bound uses —
      // on the wrapper the drag moves, whose parent is the full-screen scrim.
      // On the sheet itself, inside that content-sized wrapper, the
      // percentage would resolve against nothing and cap nothing (review,
      // 2026-09-30).
      assert.match(player, /  sheetFrame: \{ maxHeight: '78%' \},/);
      assert.match(
        player,
        /<Animated\.View\s*style=\{\[styles\.sheetFrame, tall \? styles\.sheetFrameTall : null, \{ transform: \[\{ translateY: dragY \}\] \}\]\}\s*>/,
      );
      assert.match(player, /  sheet: \{[^}]*flexShrink: 1,/);
      assert.doesNotMatch(player.match(/  sheet: \{[^}]*\}/)[0], /maxHeight/);
      const { sheetScrollMaxHeight } = require('../../../.test-dist/lib/sheetScrollBound.js');
      // A 640 dp phone with a 48 dp button bar: 0.78 × 640 − 81 − 78.
      assert.equal(sheetScrollMaxHeight({ areaHeight: 640, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }), 340);
      // The inset is taken off: the list ends above the button bar.
      assert.ok(
        sheetScrollMaxHeight({ areaHeight: 800, capFraction: 0.78, headHeight: 81, bottomPadding: 30 + 48 }) <
          sheetScrollMaxHeight({ areaHeight: 800, capFraction: 0.78, headHeight: 81, bottomPadding: 30 }),
      );
      // Unmeasured or absurd input cannot collapse the list.
      assert.equal(sheetScrollMaxHeight({ areaHeight: 0, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }), 120);
      assert.equal(sheetScrollMaxHeight({ areaHeight: Number.NaN, capFraction: 0.78, headHeight: 81, bottomPadding: 78 }), 120);
      const { lightTheme, darkTheme } = require('../../../.test-dist/theming.js');
      assert.equal(darkTheme.orange, darkTheme.highlight, 'dark keeps the one action orange');
      assert.notEqual(lightTheme.orange, lightTheme.highlight, 'light is orange, not the brand violet');
    },
  },
];
