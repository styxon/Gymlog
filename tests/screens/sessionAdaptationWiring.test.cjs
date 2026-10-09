const assert = require('node:assert/strict');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const wiring = readAppWiring().replace(/\r\n/g, '\n');

/**
 * "Just today" swaps and left-out rows are read and written for the session
 * they were made on (swap audit, 2026-09-21).
 *
 * They used to be one slot-keyed pair in App state: Home and a programme's day
 * page wrote into it, both start paths applied all of it, and only a start
 * cleared it — not a different session picked for today, not midnight, not
 * "Reset all data". Slot ids repeat across a programme's days, so day A's
 * goblet-squat swap turned day B's leg press into goblet squats. The rule is
 * lib/sessionAdaptation; this holds the screens to it. Source-level: all of it
 * is wiring.
 */
const between = (from, to) => {
  const start = wiring.indexOf(from);
  assert.ok(start >= 0, `${from} is gone`);
  const end = wiring.indexOf(to, start);
  assert.ok(end > start, `${to} no longer follows ${from}`);
  return wiring.slice(start, end);
};

module.exports = [
  {
    name: 'session adaptations: read and written through the dated store, never a slot-keyed map',
    run() {
      // Read for today's date, which moves at midnight with the app left open.
      assert.match(wiring, /heldAdaptationFor\(heldSessionAdaptations, ref, todayStartMs\)/);
      assert.match(wiring, /updateHeldAdaptation\(held, ref, todayStartMs, change\)/);
      // The old pair is gone, so nothing can write around the scope.
      assert.doesNotMatch(wiring, /useState<Record<string, string>>\(\{\}\)/);
      assert.doesNotMatch(wiring, /\bsetSessionSwaps\b|\bsetSessionDrops\b/);
    },
  },
  {
    name: "session adaptations: Home's rows are held for the session its card offers, which is the one it starts",
    run() {
      const ref = between('const homeSessionRef', 'const homeSessionAdaptation');
      assert.match(ref, /programId: homeActivePlanCard\.programId, sessionId: homeActivePlanCard\.nextSession\.id/);
      const home = between('sessionSwaps={homeSessionAdaptation.swaps}', 'onRemoveSessionExercise=');
      // With the row's own lift, so picking it back undoes the swap (swap
      // hunt, 2026-10-07); none while that session is the running workout
      // (tests/screens/homeRunningSessionEdits).
      assert.match(
        home,
        /onSwapSessionExercise=\{\s*todayIsRunning \? undefined : \(slotId, exerciseName\) =>\s*adaptHomeSession\(\(current\) =>\s*withSessionSwap\(\s*current,\s*slotId,\s*exerciseName,\s*homeActivePlanCard\?\.nextSession\?\.exercises\.find\(\(exercise\) => exercise\.slotId === slotId\)\?\.name,\s*\),/,
      );
      assert.match(home, /sessionDrops=\{homeSessionAdaptation\.drops\}/);
      assert.match(
        home,
        /onDropSessionExercise=\{\s*todayIsRunning \? undefined : \(slotId\) => adaptHomeSession\(\(current\) => withSessionDrop\(current, slotId\)\)\s*\}/,
      );
      assert.match(
        home,
        /onRestoreSessionExercise=\{\s*todayIsRunning \? undefined : \(slotId\) => adaptHomeSession\(\(current\) => withoutSessionDrop\(current, slotId\)\)\s*\}/,
      );
      // The card starts the same programme it holds the rows for.
      const start = between('onStartActivePlanSession={(sessionId) => {', 'onCreateWorkoutFromExercises=');
      assert.match(start, /handleStartCustomProgramSession\(homeActivePlanCard\.programId, sessionId\)/);
      assert.match(start, /handleStartReadyProgramSession\(homeActivePlanCard\.programId, sessionId\)/);
    },
  },
  {
    name: "session adaptations: a programme's day page swaps for that day only",
    run() {
      const day = between("if (route.screen === 'programDay') {", 'exerciseLibrary={exerciseBrowserItems}');
      assert.match(day, /const daySessionRef: AdaptedSessionRef = \{ programId: route\.workoutTemplateId, sessionId: route\.sessionId \};/);
      assert.match(day, /sessionSwaps=\{sessionAdaptationFor\(daySessionRef\)\.swaps\}/);
      assert.match(
        day,
        /adaptSession\(daySessionRef, \(current\) =>\s*withSessionSwap\(\s*current,\s*slotId,\s*exerciseName,\s*daySession\.exercises\.find\(\(exercise\) => exercise\.slotId === slotId\)\?\.name,\s*\),/,
      );
    },
  },
  {
    name: 'session adaptations: a kept swap is spent on its own day, and "Reset all data" lets all of them go',
    run() {
      const kept = wiring.match(/adaptSession\(\{ programId, sessionId \}, \(current\) => withoutSessionSwapsTo\(current, edit\.exerciseName\)\);/g) ?? [];
      // In the custom-programme branch; where a ready programme is copied to
      // take the edit the swap is spent on the COPY's day (hunt 9 #13), the
      // catalogue's ref being left behind with everything else held for it.
      assert.equal(kept.length, 1);
      assert.match(
        wiring,
        /adaptSession\(\{ programId: workoutTemplateId, sessionId: copiedSessions\[dayIndex\]\.id \}, \(current\) =>\s*withoutSessionSwapsTo\(current, edit\.exerciseName\),/,
      );
      const reset = between('const handleResetAllData = useCallback(async () => {', '}, [resetAllData]);');
      assert.match(reset, /setHeldSessionAdaptations\(NO_HELD_SESSION_ADAPTATIONS\);/);
    },
  },
];
