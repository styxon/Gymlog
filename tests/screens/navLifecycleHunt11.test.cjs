const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { between, functionBody } = require('../helpers/sourceSlices.cjs');

const { isReadyProgrammeRunning } = require('../../.test-dist/lib/programmeCopyLink.js');
const { stopProgramme, listRunningProgrammes } = require('../../.test-dist/lib/runningProgrammes.js');
const { addSeasonEnrolment } = require('../../.test-dist/lib/seasonEnrolment.js');
const { createTemplateLeaveGuard, releaseHeldLeave } = require('../../.test-dist/lib/templateLeaveGuard.js');
const { pushRoute, popRoute, withoutTrailingRoute } = require('../../.test-dist/navigation/routeHistory.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../..', ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * Navigation and programme-lifecycle findings of hunt 11 (2026-10-10).
 */
module.exports = [
  {
    // 1: widget, notification and lock-screen taps unmounted an unsaved
    // builder without the question its Back asks.
    name: 'hunt 11 #1: widget, notification and lock-screen taps ask the builder before dropping its draft',
    run() {
      const app = read('App.tsx');
      assert.match(
        functionBody(app, '  function resetToRouteThroughGuard('),
        /leaveThroughScreenGuard\(\(\) => resetToRoute\(nextRoute\)\);/,
      );
      assert.match(
        functionBody(app, '  function navigateToActiveWorkoutThroughGuard('),
        /leaveThroughScreenGuard\(\(\) => \{\s*navigateToActiveWorkout\(options\);\s*\}\);/,
      );
      const widget = between(app, 'useWidgetTaps({', '});');
      assert.match(widget, /resetToRoute: resetToRouteThroughGuard,/);
      assert.match(widget, /navigateToActiveWorkout: navigateToActiveWorkoutThroughGuard,/);
      assert.match(app, /useNotificationRoute\(\{ appHydrated, resetToRoute: resetToRouteThroughGuard \}\);/);
      assert.match(
        app,
        /navigateToActiveWorkoutRef\.current = \(\) => navigateToActiveWorkoutThroughGuard\(\{ resume: true \}\);/,
      );
      assert.match(
        between(app, 'finishFromNotificationRef.current = () => {', '};'),
        /navigateToActiveWorkoutThroughGuard\(\{ resume: true \}\);/,
      );
      // The tab bar's own exit is the one the guard is built on: it must not
      // go through the guarded reset, which would ask a second time.
      assert.match(
        functionBody(app, '  function navigateToTab('),
        /resetToRoute\(resolveTabRoute\(tab\)\);/,
      );
    },
  },
  {
    // 2: the sign-up outlives a stop; the pill and the CTA follow the plans.
    name: 'hunt 11 #2: a season programme that was stopped is not "running", sign-up or not',
    run() {
      const seasonProgramId = 'season_winter_program';
      const plans = [
        { id: `ready_plan_${seasonProgramId}`, name: 'Winter', entries: [{ workoutTemplateId: seasonProgramId }] },
      ];
      let prefs = { activePlanId: plans[0].id, activePlanIds: [plans[0].id], seasonEnrolments: [] };
      prefs.seasonEnrolments = addSeasonEnrolment(prefs.seasonEnrolments, {
        season: 'winter',
        year: 2026,
        joinedAt: '2026-10-01T10:00:00.000Z',
      });
      const runningIds = () => listRunningProgrammes({ ...prefs, plans }).map((row) => row.templateId);
      assert.equal(isReadyProgrammeRunning(seasonProgramId, runningIds(), []), true);

      prefs = { ...prefs, ...stopProgramme({ ...prefs, plans, templateId: seasonProgramId }) };
      assert.equal(prefs.seasonEnrolments.length, 1, 'the sign-up stays');
      assert.equal(isReadyProgrammeRunning(seasonProgramId, runningIds(), []), false);

      // The reader's own copy of it counts while that copy is what runs.
      const copy = { id: 'custom_copy', sourceTemplateId: seasonProgramId, sessions: [{ id: 's1' }] };
      assert.equal(isReadyProgrammeRunning(seasonProgramId, ['custom_copy'], [copy]), true);
      // A copy nothing runs is a leftover.
      assert.equal(isReadyProgrammeRunning(seasonProgramId, [], [copy]), false);

      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      assert.match(
        tab,
        /running=\{isReadyProgrammeRunning\(seasonProgramId, activeProgramTemplateIds, database\.workoutTemplates\)\}/,
      );
      assert.doesNotMatch(tab, /isEnrolled\(/);
    },
  },
  {
    // 3: a refused write on these answers said nothing.
    name: 'hunt 11 #3: the completion card, Home remove and the programme page adopt answer a refused write',
    run() {
      const edits = read('src', 'app', 'programmePlanEdits.tsx');
      assert.match(
        functionBody(edits, '  function saveRefused('),
        /reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);/,
      );
      for (const signature of [
        '  async function dismissCompletionCard(',
        '  async function handleCompletionStartNext(',
        '  async function handleCompletionRestart(',
      ]) {
        const body = functionBody(edits, signature);
        assert.match(body, /catch \(error\) \{\s*saveRefused\(error\);/, signature);
      }
      // Start next: the adoption's rejection is answered, and the card is
      // kept (nothing is dismissed after it).
      assert.match(
        functionBody(edits, '  async function handleCompletionStartNext('),
        /try \{\s*adopted = await handleAdoptReadyProgram\([^)]*\);\s*\} catch \(error\) \{\s*saveRefused\(error\);\s*return;\s*\}/,
      );

      const switches = read('src', 'app', 'programmeSwitches.tsx');
      assert.match(
        functionBody(switches, '  async function handleRemoveActiveProgram('),
        /try \{\s*await updatePreferences\([\s\S]*\} catch \(error\) \{\s*saveRefused\(error\);\s*\}/,
      );

      const tab = read('src', 'app', 'renderWorkoutTab.tsx');
      for (const adopt of ['handleAdoptReadyProgram(route.workoutTemplateId', 'handleAdoptCustomProgram(route.workoutTemplateId']) {
        const chain = between(tab, `void ${adopt}`, 'toast.planSaveFailed');
        assert.match(chain, /\.catch\(\(error\) => \{/, adopt);
      }
    },
  },
  {
    // 4: a replace onto the page already under it left the page twice.
    name: 'hunt 11 #4: Back after saving the builder does not land on the page the reader is on',
    run() {
      const home = { tab: 'home', screen: 'dashboard' };
      const prog = { tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId: 'wt1' };
      const builder = { tab: 'workout', screen: 'template', workoutTemplateId: 'wt1' };
      const history = pushRoute(pushRoute([], home, prog), prog, builder);
      assert.deepEqual(history, [home, prog]);
      // What replaceRoute now stores.
      const after = withoutTrailingRoute(history, prog);
      assert.deepEqual(after, [home]);
      assert.deepEqual(popRoute(after).route, home);
      // A replace onto a route that is not on top keeps the history whole.
      const other = { tab: 'workout', screen: 'summary' };
      assert.deepEqual(withoutTrailingRoute(history, other), history);

      const app = read('App.tsx');
      assert.match(
        functionBody(app, '  function replaceRoute('),
        /history: withoutTrailingRoute\(current\.history, nextRoute\),/,
      );
    },
  },
  {
    // Review follow-up: the sibling writes wired as `void` answered nothing too.
    name: 'hunt 11 #3b: programme rename, day reorder, training days, Home pick and Home edits answer a refused write',
    run() {
      const days = read('src', 'app', 'programmeDayEdits.tsx');
      for (const signature of [
        '  async function handleRenameCustomProgram(',
        '  async function handleReorderProgramSession(',
      ]) {
        assert.match(
          functionBody(days, signature),
          /catch \(error\) \{[\s\S]*reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);/,
          signature,
        );
      }
      const edits = read('src', 'app', 'programmePlanEdits.tsx');
      assert.match(
        functionBody(edits, '  async function handleChangeTrainingDays('),
        /await writeTrainingDays\(days\);\s*\} catch \(error\) \{\s*saveRefused\(error\);/,
      );
      assert.match(
        functionBody(read('App.tsx'), '  async function handlePickTodaySession('),
        /catch \(error\) \{[\s\S]*reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);/,
      );
      assert.match(
        read('src', 'app', 'useProgramExerciseEdit.tsx'),
        /return next\.catch\(\(error\) => \{[\s\S]*?reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);\s*return false;/,
      );
    },
  },
  {
    // The main action succeeded; its follow-up bookkeeping failing is not a
    // failed programme.
    name: 'hunt 11 #3c: a refused follow-up dismissal after a successful start or restart is not told as a failure',
    run() {
      const edits = read('src', 'app', 'programmePlanEdits.tsx');
      const startNext = functionBody(edits, '  async function handleCompletionStartNext(');
      assert.match(startNext, /await writeCompletionDismissal\(planId\);\s*\} catch \(error\) \{\s*console\.error\(/);
      assert.doesNotMatch(startNext.slice(startNext.indexOf('if (adopted)')), /saveRefused/);
      const restart = functionBody(edits, '  async function handleCompletionRestart(');
      const tail = restart.slice(restart.indexOf('dismissedCompletionPlanIds.includes(planId)'));
      assert.match(tail, /catch \(error\) \{\s*\/\/[^\n]*\n\s*console\.error\(/);
      assert.doesNotMatch(tail, /saveRefused/);
      // The card's own Dismiss is the main action, and still answers.
      assert.match(
        functionBody(edits, '  async function dismissCompletionCard('),
        /catch \(error\) \{\s*saveRefused\(error\);/,
      );
    },
  },
  {
    name: 'hunt 11 #5: an exit that arrives while the builder saves is held, then runs once the save landed',
    run() {
      let saving = false;
      let unsaved = true;
      let held = null;
      let asked = null;
      const guard = createTemplateLeaveGuard({
        isSaving: () => saving,
        hasUnsavedWork: () => unsaved,
        hold: (leave) => { held = leave; },
        ask: (leave) => { asked = leave; },
      });
      const ran = [];
      const leave = (name) => () => ran.push(name);

      // Clean draft: let go at once.
      unsaved = false;
      assert.equal(guard(leave('clean')), false);
      assert.deepEqual(ran, []);

      // Unsaved work: the question is asked, nothing runs yet.
      unsaved = true;
      assert.equal(guard(leave('asked')), true);
      assert.ok(asked);
      assert.deepEqual(ran, []);

      // Mid-save: held, not dropped, and not asked.
      asked = null;
      saving = true;
      assert.equal(guard(leave('held')), true);
      assert.equal(asked, null);
      assert.ok(held);
      assert.deepEqual(ran, []);

      // The save landed: the held exit goes on.
      releaseHeldLeave(held, true, (next) => { asked = next; });
      assert.deepEqual(ran, ['held']);
      assert.equal(asked, null);

      // The save was refused: the draft is still unsaved, so it asks instead.
      const refused = leave('refused');
      releaseHeldLeave(refused, false, (next) => { asked = next; });
      assert.deepEqual(ran, ['held']);
      assert.equal(asked, refused);

      const screen = read('src', 'screens', 'CreateTemplateScreen.tsx');
      assert.match(screen, /hold: \(leave\) => \{\s*heldLeaveRef\.current = leave;/);
      assert.match(screen, /releaseHeldLeave\(held, saved, askToLeave\);/);
      assert.match(
        between(read('src', 'app', 'renderWorkoutTab.tsx'), '<CreateTemplateScreen', 'onBack={() => navigateBack(workoutHomeRoute)}'),
        /leaveGuardRef=\{templateLeaveGuardRef\}/,
      );
    },
  },
];
