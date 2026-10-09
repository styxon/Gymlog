const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isWorkoutInProgress } = require('../../.test-dist/lib/activeWorkout.js');
const { resolveHomeWidgetSessionTap } = require('../../.test-dist/lib/widgetPayload.js');
const { selectHomeCustomProgram } = require('../../.test-dist/lib/homeProgramSelection.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * One rule for "there is a workout to go back to" (bug hunt 2026-10-03).
 *
 * navigateToActiveWorkout refuses a session left as 'completed' (an install from before the finish
 * cleared it at once can hold one for good), while the widget tap and the cardio screen's resume
 * sheet asked only whether a session was held. Their resume path then called the refusing door and
 * did nothing: the widget tile and "resume" were dead, where they should have fallen through to
 * the no-active-session path (open the plan's day, or start the run).
 */
module.exports = [
  {
    name: 'a held session is a workout in progress unless it is finished: running and paused count, completed and none do not',
    run() {
      assert.equal(isWorkoutInProgress(null), false);
      assert.equal(isWorkoutInProgress(undefined), false);
      assert.equal(isWorkoutInProgress({ status: 'active' }), true);
      assert.equal(isWorkoutInProgress({ status: 'paused' }), true, 'a paused session is still one the button resumes');
      assert.equal(isWorkoutInProgress({ status: 'completed' }), false);
    },
  },
  {
    name: 'a finished session held in memory does not send the widget tap or Home into the resume path',
    run() {
      const finished = { status: 'completed' };
      const tap = resolveHomeWidgetSessionTap({
        hasActiveSession: isWorkoutInProgress(finished),
        hasActivePlan: false,
        nowMs: Date.UTC(2026, 9, 3, 10),
        schedule: { mode: 'weekly', days: [] },
        sessions: [],
      });
      assert.notEqual(tap.kind, 'resume', 'the tile must not resume what the door refuses to open');
      assert.equal(
        resolveHomeWidgetSessionTap({ hasActiveSession: isWorkoutInProgress({ status: 'paused' }), hasActivePlan: false, nowMs: 0, schedule: { mode: 'weekly', days: [] }, sessions: [] }).kind,
        'resume',
      );
      const custom = selectHomeCustomProgram({
        customWorkouts: [{ id: 'w1', name: 'Mine', exerciseCount: 3, updatedAt: '2026-10-01T00:00:00.000Z' }],
        activeSessionTemplateId: null,
        hasActiveSession: isWorkoutInProgress(finished),
        lastSelectedTemplateId: null,
        recentCompletedCustomTemplateId: null,
      });
      assert.notEqual(custom.mode, 'resume_active');
    },
  },
  {
    name: 'every caller that picks the resume path asks the same rule as the door: widget tap, cardio resume sheet, custom programme card, the door itself',
    run() {
      const widget = read('src', 'app', 'useWidgetTaps.ts');
      assert.match(widget, /hasActiveSession: isWorkoutInProgress\(workout\.activeSession\)/);
      assert.doesNotMatch(widget, /hasActiveSession: workout\.activeSession !== null/);

      const home = read('src', 'app', 'renderHomeScreens.tsx');
      assert.match(home, /hasActiveStrengthSession=\{isWorkoutInProgress\(workout\.activeSession\)(?: \|\| hasFreestyleBoard)?\}/);
      assert.doesNotMatch(home, /hasActiveStrengthSession=\{Boolean\(workout\.activeSession\)\}/);

      const views = read('src', 'app', 'useCustomProgramViews.ts');
      assert.match(views, /hasActiveSession: isWorkoutInProgress\(workout\.activeSession\)/);
      assert.doesNotMatch(views, /hasActiveSession: Boolean\(workout\.activeSession\)/);

      // Home's hero and the update gate already asked the rule inline; one rule now, so they cannot drift from the door.
      const dashboard = read('src', 'app', 'renderHomeDashboard.tsx');
      assert.match(dashboard, /hasActiveSession=\{isWorkoutInProgress\(workout\.activeSession\)\}/);
      assert.doesNotMatch(dashboard, /workout\.activeSession !== null/);
      const overlays = read('src', 'app', 'useSetupHandoffOverlays.tsx');
      assert.match(overlays, /isWorkoutInProgress\(workout\.activeSession\);/);
      assert.doesNotMatch(overlays, /workout\.activeSession !== null/);

      const app = read('App.tsx');
      const door = app.slice(app.indexOf('function navigateToActiveWorkout('), app.indexOf('/** Whether the running session is the very one'));
      assert.match(door, /!isWorkoutInProgress\(workout\.activeSession\)/, 'the door and its callers cannot disagree');
      assert.doesNotMatch(door, /status === 'completed'/);
      assert.match(app, /import \{ isWorkoutInProgress \} from '\.\/src\/lib\/activeWorkout';/);
    },
  },
];
