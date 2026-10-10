const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const { functionBody } = require('../helpers/sourceSlices.cjs');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * A freestyle session survives the process, and leaves no half-written trace.
 *
 * Audit round 4 (2026-09-20): the session lived in the screen's React state
 * alone — Android reclaiming the app forty minutes in meant reopening to an
 * empty board — while the guided player persisted every set. The draft is
 * the workout provider's state now (CLAUDE.md: no component-local
 * persistence), persisted with the bundle, read once on mount and mirrored
 * back debounced; leaving on purpose discards it, finishing clears it. And
 * three smaller things from the same audit: the rest cleared when the last
 * lift goes, +15 s on an overrun rest counted from now, and the session
 * save that fails leaves no orphan template behind.
 */
module.exports = [
  {
    name: 'freestyle: the draft flows through the provider, and the screen reads it once and mirrors it back',
    run() {
      const provider = read('src', 'features', 'workout', 'WorkoutProvider.tsx');
      assert.match(provider, /freestyleDraft: state\.freestyleDraft,\n\s+\};\n\s+saveWorkoutBundle\(bundle\)/, 'the draft must be in the persisted bundle');
      assert.match(provider, /\[state\.activeSession, state\.activeCardio, state\.freestyleDraft, state\.hydrated, state\.history\]/, 'the persist effect must run when the draft changes');
      const persistence = read('src', 'features', 'workout', 'workoutPersistence.ts');
      assert.match(persistence, /freestyleDraft: normalizeFreestyleDraftSnapshot\(input\.freestyleDraft\)/, 'a stored draft must go through the normalizer');

      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(tab, /<EmptyWorkoutScreen[\s\S]{0,200}freestyleDraft=\{freestyleDraft\}\s+onSaveDraft=\{saveFreestyleDraft\}\s+onClearDraft=\{clearFreestyleDraft\}/);
      const app = read('App.tsx');
      // The board the screen gets is the provider's draft less a saved workout's leftover, read once for the screen
      // and the restore question alike.
      assert.match(app, /const freestyleDraft = discardSavedFreestyleDraft\(workout\.freestyleDraft, database\);/);
      assert.match(app, /\s+freestyleDraft,\s+saveFreestyleDraft: workout\.saveFreestyleDraft,\s+clearFreestyleDraft: workout\.clearFreestyleDraft,/);

      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      assert.match(screen, /useState<FreestyleExerciseState\[\]>\(\(\) => freestyleDraft\?\.exercises \?\? \[\]\)/, 'the lifts must start from the draft');
      assert.match(screen, /freestyleDraft\?\.rest && freestyleDraft\.rest\.endsAtMs > Date\.now\(\) \? freestyleDraft\.rest : null/, 'a rest that ended while the app was gone must not come back');
      // CI review of #162: the clock came back however old the draft was.
      assert.match(screen, /useState<number \| null>\(\(\) =>\s*resolveFreestyleDraftStart\(freestyleDraft, Date\.now\(\)\),/, 'the session clock must go through the staleness rule');
      // CI review of #162: hardware back registered no listener when there
      // was nothing to lose, so it left without discarding what the chevron
      // discarded in the same state.
      assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{[\s\S]{0,700}guard\.discardDraft\(\);\s*guard\.onBack\(\);\s*return true;[\s\S]{0,60}\}, \[\]\);/, 'one hardware-back listener, registered always, leaving the way the chevron leaves');
      assert.match(screen, /const timer = setTimeout\(\(\) => \{\s*draftTimerRef\.current = null;\s*sink\.onSaveDraft\?\.\(\{ exercises, startedAtMs, rest, sessionId, savedAtMs: Date\.now\(\) \}\);\s*\}, 400\);/, 'the draft must be written back, debounced');
      // And a discard takes the pending write with it: the clear is urgent,
      // the route change behind it is a transition, and an edit made inside
      // the last 400 ms fired in that gap and wrote the board back (CI
      // review of #162).
      assert.match(screen, /const discardDraft = \(\) => \{\s*if \(draftTimerRef\.current !== null\) \{\s*clearTimeout\(draftTimerRef\.current\);/, 'a discard cancels the write that has not happened yet');
      assert.equal(
        (screen.match(/draftSinkRef\.current\.onClearDraft\?\.\(\)/g) ?? []).length,
        1,
        'every discard goes through discardDraft, which is the one place that clears',
      );
      assert.match(screen, /await onSave\(draft, summary, adoptSessionId\);\s*\/\/[^\n]*\n\s*discardDraft\(\);/, 'finishing must clear the draft, after the save');
      assert.match(screen, /setConfirmingLeave\(false\);\s*discardDraft\(\);\s*leaveGuardRef\.current\.onBack\(\);/, 'a confirmed leave must discard the draft');
      // And the app stands down for this route, so the screen's listener is
      // the one that answers. This listener registers once on mount, and
      // App's re-subscribes on every route change after its children — so
      // without the stand-down back walked Home past both the question and
      // the discard (CI review of #162). The whole shell: the listener left
      // App.tsx for a src/app hook in the phase-C split (2026-10-01).
      assert.match(readAppWiring(), /if \(route\.tab === .workout. && route\.screen === .empty.\) \{\s*return undefined;/, "the app must stand down for the free workout");
    },
  },
  {
    name: 'freestyle: the last lift takes its rest with it, an overrun rest extends from now, a failed save leaves no template',
    run() {
      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      assert.match(screen, /const removeExercise = \(exerciseKey: string\) => \{[\s\S]{0,500}if \(exercises\.length <= 1\) \{\s*setRest\(null\);/);
      // The rule is in the lib now, where both numbers of the rest move
      // together and a unit test can hold them to it: rebasing only the end
      // left the bar drawing a fifteen-second rest one fifth full (CI review
      // of #162). See tests/lib/restSchedule.test.cjs.
      assert.match(screen, /setRest\(\(current\) => \(current \? extendRest\(current, deltaSeconds, Date\.now\(\)\) : current\)\)/);
      // The save on its own, wherever the shell keeps it (it leaves VinhaApp
      // in the phase-C split, 2026-10-01), up to the slot-history write.
      const save = functionBody(readAppWiring().replace(/\r\n/g, '\n'), 'const finishLoggedWorkoutSave = async');
      const recordAt = save.indexOf('workout.recordLoggedWorkout({');
      assert.ok(recordAt > 0, 'the save still writes the slot history');
      const finish = save.slice(0, recordAt);
      assert.match(finish, /\} catch \(error\) \{[\s\S]{0,400}await deleteWorkoutTemplate\(workoutTemplateId\)\.catch\(\(\) => undefined\);\s*throw error;/, 'a session save that fails must take its template with it');
      // Through the one per-session rule both finishes share (#bugs 2026-10-01).
      assert.ok(finish.indexOf('countWorkoutCompleted(landedAs)') > finish.indexOf('await saveCompletedWorkoutSession('), 'the event must fire after the save, not before');
    },
  },
  {
    // Break round, 2026-09-28: a notification or widget tap routed off the
    // board inside the 400 ms debounce, and the last edit went with the timer.
    name: 'freestyle: leaving without a discard writes the pending edit, except while Finish is saving',
    run() {
      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      const flushAt = screen.indexOf('const pending = pendingDraftRef.current;');
      const debounceAt = screen.indexOf('pendingDraftRef.current = { exercises, startedAtMs, rest, sessionId };');
      assert.ok(flushAt > 0 && debounceAt > 0, 'the flush or the pending copy is gone');
      // Its cleanup must run before the debounce's cancels the timer: React
      // runs a component's effect cleanups in the order they were declared.
      assert.ok(flushAt < debounceAt, 'the flush is declared after the debounce, so the timer is already gone');
      assert.match(
        screen,
        /if \(draftTimerRef\.current === null \|\| pending === null \|\| finishingRef\.current\) \{\s*return;\s*\}\s*clearTimeout\(draftTimerRef\.current\);\s*draftTimerRef\.current = null;\s*draftSinkRef\.current\.onSaveDraft\?\.\(\{ \.\.\.pending, savedAtMs: Date\.now\(\) \}\);/,
      );
      // A discard still takes the timer first, so there is nothing to flush.
      assert.match(screen, /const discardDraft = \(\) => \{\s*if \(draftTimerRef\.current !== null\) \{\s*clearTimeout\(draftTimerRef\.current\);\s*draftTimerRef\.current = null;/);
    },
  },
  {
    // Review of the free workout save, 2026-10-03: a set ticked while Finish was saving was in neither the save
    // nor the board (cleared the moment the save landed), and silently lost.
    name: 'freestyle: the board is locked while Finish is saving, and the save can hand the board a new session id',
    run() {
      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      for (const name of ['addExercises', 'removeExercise', 'patchSet', 'addSet', 'toggleSetDone', 'toggleSupersetLink']) {
        const at = screen.indexOf(`const ${name} = `);
        assert.ok(at > 0, `${name} is gone`);
        const head = screen.slice(at, at + 700);
        assert.match(head, /if \(finishingRef\.current\) \{\s*return;\s*\}/, `${name} must refuse edits while Finish is saving`);
      }
      assert.match(screen, /await onSave\(draft, summary, adoptSessionId\);/, 'the save is handed the way to give the board its new id');
      assert.match(screen, /const adoptSessionId = \(id: string\) => \{\s*sessionIdRef\.current = id;/, 'the board keeps the id the save filed under');
    },
  },
  {
    name: 'freestyle: emptying the board resets the clock, so the next first lift starts it fresh',
    run() {
      const screen = read('src', 'screens', 'EmptyWorkoutScreen.tsx');
      const removal = functionBody(screen, 'const removeExercise = (exerciseKey: string) =>');
      assert.match(removal, /if \(exercises\.length <= 1\) \{[^}]*setStartedAtMs\(null\);/, 'the last lift going takes the start with it');
      const add = functionBody(screen, 'const addExercises = (items: ExerciseLibraryItem[]) =>');
      assert.match(add, /setStartedAtMs\(\(current\) => current \?\? Date\.now\(\)\)/, 'the first lift on an empty board starts the clock');
    },
  },
];
