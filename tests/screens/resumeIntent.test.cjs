const assert = require('node:assert/strict');

const appSource = require('../helpers/appWiringSource.cjs').readAppWiring();

/**
 * "Resume" is a claim about the button that was pressed, not about the state.
 *
 * `navigateToActiveWorkout` serves two intents that must not land the same
 * way. Home's hero and the lock-screen card ask to CONTINUE — they get the set
 * they left off on. But the same function is also the guard on "start a
 * session": ask for Day 2 while Day 1 is running and you are REDIRECTED, which
 * is the app telling you something. Dropping that reader straight into Day 1's
 * player, mid-set, says it silently — and they log into the wrong day.
 *
 * Caught by the PR review on #37, where the first version of this passed
 * `{ resume: true }` unconditionally.
 */
module.exports = [
  {
    name: 'resume intent: a start guard only resumes the session it was asked for',
    run() {
      // Both start paths compare before they claim.
      const readyStart = appSource.indexOf('function startReadyProgramSessionWithUnit(');
      assert.ok(readyStart > 0, 'startReadyProgramSessionWithUnit moved');
      assert.match(
        appSource.slice(readyStart, readyStart + 1400),
        /navigateToActiveWorkout\(\{ resume: isActiveSessionFor\(workoutTemplateId, sessionId\) \}\)/,
      );

      const customStart = appSource.indexOf('function handleStartCustomProgramSession(');
      assert.ok(customStart > 0, 'handleStartCustomProgramSession moved');
      assert.match(
        appSource.slice(customStart, customStart + 1600),
        /navigateToActiveWorkout\(\{ resume: isActiveSessionFor\(workoutTemplateId, sessionId\) \}\)/,
      );

      // And the comparison is on the day, not just the programme — a five-day
      // programme is one templateId, so templateId alone would call every day
      // of it "the same session".
      const compare = appSource.indexOf('function isActiveSessionFor(');
      assert.ok(compare > 0, 'isActiveSessionFor moved');
      const body = appSource.slice(compare, compare + 500);
      assert.match(body, /active\.templateId === workoutTemplateId/);
      assert.match(body, /active\.templateSessionId === sessionId/);
    },
  },
  {
    /**
     * The other half: the entry points whose own button says resume must keep
     * saying it, or the fix above quietly turns Home's hero back into a menu.
     */
    name: 'resume intent: the buttons that say resume still go straight to the set',
    run() {
      // Lock-screen card and the notification's finish action.
      assert.match(
        appSource,
        /navigateToActiveWorkoutRef\.current = \(\) => navigateToActiveWorkoutThroughGuard\(\{ resume: true \}\)/,
      );
      // The coach's resume_workout action used to be the third entry point.
      // It is gone with the screen that drew it: nothing could reach
      // AICoachScreen, so nothing could tap the action either (audit 3,
      // 2026-09-20). The chat that replaced it resumes through the same
      // navigateToActiveWorkout above.
      assert.doesNotMatch(appSource, /case 'resume_workout':/);

      // Nothing calls it bare any more: an unmarked call is an unstated
      // intent, and the default it would take is the wrong one for a guard.
      assert.doesNotMatch(appSource, /navigateToActiveWorkout\(\)/);
    },
  },
];
