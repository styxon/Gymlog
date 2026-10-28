const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

/**
 * Back on the workout summary leaves the way Done does (#bugs 2026-10-02).
 *
 * Done clears the summary and moves the route in ONE transition and resets the
 * history. Hardware Back cleared the summary urgently and popped the history in
 * a transition: a frame showed the summary route with its data gone, the pop
 * landed on whatever the history held (the finished workout's own player), and
 * useFinishRouteGuard raced it to Home keeping that history. The shell's
 * pieces need React Native, so this guards the source the way the neighbouring
 * screen suites do.
 */
module.exports = [
  {
    name: 'summary Back takes the Done exit: one transition, history reset, no urgent clear',
    run() {
      const back = read('src/app/useRouteBack.ts');
      const branch = back.slice(back.indexOf("route.screen === 'summary') {"));
      const body = branch.slice(0, branch.indexOf('return true;'));
      assert.match(body, /leaveFinishedScreen\(exitRoute\)/);
      assert.match(body, /summaryExitRouteRef\.current \?\? workoutHomeRoute/);
      assert.match(body, /clearCompletedWorkout\(\)/);
      // The urgent half of the old split is gone from this branch.
      assert.doesNotMatch(body, /setCompletionSummary|setFinishSaveState|navigateBack/);

      const exits = read('src/app/finishExits.ts');
      // The one core: all three updates inside one startTransition, history [].
      assert.match(
        exits,
        /function leaveFinishedScreen\(nextRoute: AppRoute\) \{\s*startTransition\(\(\) => \{\s*setCompletionSummary\(null\);\s*setFinishSaveState\([^)]*\);\s*setNavigationState\(\{ route: nextRoute, history: \[\] \}\);\s*\}\);\s*\}/,
      );
      // Done is that core plus the rating ask — the two cannot drift apart.
      assert.match(
        exits,
        /function leaveFinishedWorkout\(nextRoute: AppRoute\) \{\s*leaveFinishedScreen\(nextRoute\);\s*maybeAskForRating\(\);\s*\}/,
      );

      const app = readAppWiring();
      assert.match(app, /const \{ leaveFinishedWorkout, leaveFinishedScreen \} = createFinishExits\(/);
      assert.match(app, /useRouteBack\(\{[\s\S]*?leaveFinishedScreen,[\s\S]*?\}\);/);
    },
  },
  {
    name: 'summary Back leaves the exit route in place, so a second Back before the transition lands still goes Home',
    run() {
      const back = read('src/app/useRouteBack.ts');
      const branch = back.slice(back.indexOf("route.screen === 'summary') {"));
      const body = branch.slice(0, branch.indexOf('return true;'));
      assert.doesNotMatch(body, /summaryExitRouteRef\.current = /);
      // Both ways into the summary set the exit just before routing there, so
      // leaving it in place cannot leak into a later summary.
      const saves = read('src/app/finishSaves.tsx');
      const sets =
        saves.match(
          /summaryExitRouteRef\.current = ROOT_ROUTES\.home;\s*(?:workout\.clearCompletedWorkout\(\);\s*)?replaceRoute\(\{ tab: 'workout', screen: 'summary' \}\);/g,
        ) ?? [];
      assert.equal(sets.length, 2);
    },
  },
];
