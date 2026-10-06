const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'),
  'utf8',
);
const i18nSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'), 'utf8');
const sheetSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'AddExerciseSheet.tsx'),
  'utf8',
);

/**
 * "Pitää olla myös helppo lisätä liikkeitä kesken treenin jos haluaa tehdä
 * enemmän, nyt jouduin palautumiseen ilman että halusin" (user 2026-09-29).
 *
 * There was no mid-workout add-exercise UI anywhere in the guided/programmed
 * flow before this: `exercise/insertAfter` existed in the reducer and
 * `insertExerciseAfter` on WorkoutProvider, but nothing dispatched either —
 * dead scaffolding. This wires it, for the first time, from a third and
 * quieter action on the cooldown intro, reusing the existing reducer action,
 * the existing library-item defaults policy (getExerciseTemplateDefaults,
 * the same one the day editor's own picker uses) and the existing catalog
 * tracking-mode lookup (getCatalogTrackingMode) — nothing invented.
 *
 * Two bugs survived that first wiring (recheck round 2026-09-29):
 *
 *  - `AddExerciseSheet` is a shared, general component: its single-select
 *    guard checks `selectedIds`, which every OTHER caller passes and this
 *    one does not — there is nothing to preselect, since the lift a
 *    mid-workout add inserts is not "in" the sheet's own list. A fast double
 *    tap fired `onSelectItem` twice before the close reached a render, and
 *    inserted the same lift twice. The fix belongs to this caller, not to
 *    the sheet: a ref that locks on the first selection of an open and only
 *    unlocks the next time the sheet opens.
 *  - `addMidWorkoutExercise` anchored on the session's last exercise, so a
 *    cooldown-only session (`exercises = []`, no main block) had no anchor
 *    and the function returned having dispatched nothing — the link did
 *    nothing when tapped. `insertExerciseAfter` now takes a null anchor,
 *    which the reducer takes as "insert at the front" (see
 *    tests/features/workout/workoutState.test.cjs for the reducer side of
 *    this).
 *
 * No React renderer lives in this test suite (see guidedPlayerSwap.test.cjs,
 * exerciseSheet.test.cjs for the same approach), so both fixes are checked
 * the way this file always checks screen-only closures: read the source,
 * and pin the shape that makes them work.
 */
module.exports = [
  {
    name: 'guided cooldown intro: a third, quieter action adds an exercise and returns to the work block',
    run() {
      // Cooldown only — the warm-up splash has nothing to add to.
      assert.match(playerSource, /step\.phase === 'cooldown' \? \(\s*\n\s*<Pressable/);
      // Opened as the cooldown's: no slot to follow, so it appends and goes.
      assert.match(playerSource, /setAddExerciseAfterSlot\(null\);\s*setAddExerciseOpen\(true\);/);
      assert.match(playerSource, /\{t\(language, 'guided\.own\.addExercise'\)\}/);
      // The sheet is the existing one the day editor uses, not a new picker.
      assert.match(playerSource, /<AddExerciseSheet\s/);
      assert.match(playerSource, /onSelectItem=\{addMidWorkoutExercise\}/);
    },
  },
  {
    name: 'guided add-exercise: the insert reuses the existing reducer action and existing defaults, invents nothing new',
    run() {
      // The reducer/provider method already existed; this is its first caller.
      assert.match(playerSource, /workout\.insertExerciseAfter\(anchor \? anchor\.slotId : null, \{/);
      assert.match(playerSource, /trackingMode: getCatalogTrackingMode\(item\.name\),/);
      assert.match(
        playerSource,
        /getExerciseTemplateDefaults\(\s*\n\s*item,\s*\n\s*anchor \? anchor\.restSecondsMin : NO_ANCHOR_DEFAULT_REST_SECONDS,\s*\n\s*\)/,
      );
      // No new tracking-mode or rep-default policy invented for this screen.
      assert.doesNotMatch(playerSource, /function resolveInsertTrackingMode|function getInsertDefaults/);
    },
  },
  {
    name: 'guided add-exercise: lands on the new lift once the rebuilt steps carry it, not on a guessed index',
    run() {
      assert.match(playerSource, /const pendingInsertKnownSlotsRef = useRef<Set<string> \| null>\(null\);/);
      assert.match(
        playerSource,
        /const insertedSlotId = exercises\.map\(\(exercise\) => exercise\.slotId\)\.find\(\(slotId\) => !known\.has\(slotId\)\);/,
      );
      assert.match(playerSource, /goToRef\.current\(target\);/);
    },
  },
  {
    name: 'guided add-exercise: the sheet freezes the step like every other overlay',
    run() {
      // The list moved to lib/guidedClockHold (2026-10-06); the screen hands
      // it every overlay, this one included.
      assert.match(playerSource, /const frozen = guidedClockHeld\(\{[^}]*\baddExerciseOpen,[^}]*\}\);/);
      const { guidedClockHeld } = require('../../.test-dist/lib/guidedClockHold.js');
      const none = {
        paused: false, howToOpen: false, exitOpen: false, pauseSheetOpen: false, swapOpen: false,
        addExerciseOpen: false, restEditOpen: false, runSheetOpen: false, ownBlockActive: false,
        restAlertsAskOpen: false,
      };
      assert.equal(guidedClockHeld({ ...none, addExerciseOpen: true }), true);
    },
  },
  {
    name: 'guided add-exercise: the new string reads in both languages',
    run() {
      const occurrences = i18nSource.split("'guided.own.addExercise':").length - 1;
      assert.equal(occurrences, 2, 'guided.own.addExercise is missing one of its two languages');
      assert.match(i18nSource, /'guided\.own\.addExercise': 'Add an exercise'/);
      assert.match(i18nSource, /'guided\.own\.addExercise': 'Lisää liike'/);
    },
  },
  {
    name: 'mid-workout add: a ref locks the sheet to one insert per open',
    run() {
      // The lock and its reset live beside the sheet's own open state, not
      // inside the handler — so the reset cannot be skipped by whichever
      // branch of the handler returns first.
      assert.match(
        playerSource,
        /const \[addExerciseOpen, setAddExerciseOpen\] = useState\(false\);/,
      );
      assert.match(playerSource, /const addExerciseInFlightRef = useRef\(false\);/);
      // It unlocks only when the sheet is opened again — not on every
      // render, and not merely on close (a double tap fires while the sheet
      // is still visible, before `addExerciseOpen` has gone back to false).
      assert.match(
        playerSource,
        /useEffect\(\(\) => \{\s*\n\s*if \(addExerciseOpen\) \{\s*\n\s*addExerciseInFlightRef\.current = false;\s*\n\s*\}\s*\n\s*\}, \[addExerciseOpen\]\);/,
      );
    },
  },
  {
    name: 'mid-workout add: the guard runs before anything is dispatched, and closes the sheet before the insert lands',
    run() {
      const fnMatch = playerSource.match(
        /const addMidWorkoutExercise = \(item: ExerciseLibraryItem\) => \{[\s\S]*?\n {2}\};/,
      );
      assert.ok(fnMatch, 'addMidWorkoutExercise was not found');
      const body = fnMatch[0];

      // First statement in the function: bail if a selection from this same
      // open already landed. Nothing above this line may call the sheet or
      // the reducer, or a double tap racing the close would slip through it.
      assert.match(
        body,
        /^const addMidWorkoutExercise = \(item: ExerciseLibraryItem\) => \{\s*\n\s*if \(addExerciseInFlightRef\.current\) \{\s*\n\s*return;\s*\n\s*\}/,
      );

      const guardIndex = body.indexOf('if (addExerciseInFlightRef.current)');
      const armIndex = body.indexOf('addExerciseInFlightRef.current = true;');
      const closeIndex = body.indexOf('setAddExerciseOpen(false);');
      const dispatchIndex = body.indexOf('workout.insertExerciseAfter(');
      assert.ok(guardIndex >= 0 && armIndex > guardIndex, 'the lock must be set right after the guard');
      assert.ok(armIndex < closeIndex, 'the lock must be set before the sheet closes');
      assert.ok(closeIndex < dispatchIndex, 'the sheet must close before the insert dispatches');
    },
  },
  {
    name: 'mid-workout add: a session with no main-block exercise still has somewhere to insert',
    run() {
      // exercises = [] (a cooldown-only session) used to mean `anchor` was
      // undefined and the function returned having dispatched nothing — the
      // link did nothing when tapped. It now falls back to a null anchor,
      // which the reducer takes as "insert at the front".
      assert.doesNotMatch(
        playerSource,
        /const anchor = exercises\[exercises\.length - 1\];\s*\n\s*if \(!anchor\) \{\s*\n\s*return;\s*\n\s*\}/,
      );
      assert.match(playerSource, /const anchor = afterCurrent \?\? exercises\[exercises\.length - 1\] \?\? null;/);
      // The link itself is not additionally hidden for an empty session —
      // the append path is what makes tapping it on a stretch-only cooldown
      // do something, rather than the link disappearing.
      assert.match(
        playerSource,
        /step\.phase === 'cooldown' \? \(\s*\n\s*<Pressable[\s\S]{0,300}setAddExerciseOpen\(true\);/,
      );
    },
  },
  {
    name: 'the exercise intro adds a lift right after this one, and stays on it (#bugs 2026-10-01)',
    run() {
      // "Saa + liikkeen ilman että vaihdan tätä liikettä": a button beside
      // the swap, anchored on the lift on screen.
      assert.match(
        playerSource,
        /label=\{t\(language, 'guided\.walk\.add'\)\}\s*onPress=\{\(\) => \{[\s\S]{0,700}setAddExerciseAfterSlot\(\{\s*anchor:\s*resolveWalkAddAnchor\(\s*guidedBlockLastSlotId\([^)]*\),\s*step\.slotId,\s*walkAdded\[step\.slotId\],/,
      );
      // After that lift, not at the end; and no jump — the pending-insert
      // ref, which drives the jump, is set only on the cooldown path.
      assert.match(
        playerSource,
        /if \(afterCurrent && addExerciseAfterSlot\) \{\s*\/\/[^\n]*\n\s*const introSlotId = addExerciseAfterSlot\.intro;\s*walkInsertRef\.current = \{ introSlotId, known: new Set\([^\n]*\n\s*setWalkAdded\([\s\S]{0,400}\} else \{\s*pendingInsertKnownSlotsRef\.current = new Set/,
      );
      // And it says where the lift went, under the buttons of that lift only.
      // Every lift added from it, joined — not only the last one's name.
      assert.match(playerSource, /walkAdded\[step\.slotId\]\?\.names\.length \?/);
      assert.match(playerSource, /name: walkAdded\[step\.slotId\]\.names\.join\(', '\)/);
    },
  },
  {
    name: 'the walk-up add records the slot it created, and the next anchor reads the real slot order',
    run() {
      // The effect that finds the one new slot appends it through the tested
      // helper; without it slotIds stays empty and every add anchors on the
      // block again, landing before the previous one.
      assert.match(
        playerSource,
        /const pending = walkInsertRef\.current;[\s\S]{0,500}walkInsertRef\.current = null;\s*setWalkAdded\(\(current\) => recordWalkAddedSlot\(current, pending\.introSlotId, insertedSlotId\)\);/,
      );
      assert.match(playerSource, /^\s*recordWalkAddedSlot,$/m);
      // The anchor is resolved against the live slot order, not an empty list.
      assert.match(
        playerSource,
        /const slotOrder = exercises\.map\(\(exercise\) => exercise\.slotId\);\s*setAddExerciseAfterSlot\(\{\s*anchor: resolveWalkAddAnchor\(\s*guidedBlockLastSlotId\(steps, step\.groupIndex, slotOrder\),\s*step\.slotId,\s*walkAdded\[step\.slotId\],\s*slotOrder,\s*\),/,
      );
    },
  },
  {
    name: "the sheet's own single-select guard is unchanged — the fix is the caller's, not a shared component's",
    run() {
      // Other callers of AddExerciseSheet DO pass selectedIds and rely on
      // this exact guard; the mid-workout add's fix must not weaken it for
      // everyone else.
      assert.match(
        sheetSource,
        /if \(!multiSelect\) \{\s*\n\s*if \(selectedIds\.includes\(item\.id\)\) \{\s*\n\s*return;\s*\n\s*\}\s*\n\s*onSelectItem\(item\);\s*\n\s*return;\s*\n\s*\}/,
      );
    },
  },
];
