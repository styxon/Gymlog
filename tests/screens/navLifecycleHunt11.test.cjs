const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { between, functionBody } = require('../helpers/sourceSlices.cjs');

const { isReadyProgrammeRunning } = require('../../.test-dist/lib/programmeCopyLink.js');
const { stopProgramme, listRunningProgrammes } = require('../../.test-dist/lib/runningProgrammes.js');
const { addSeasonEnrolment } = require('../../.test-dist/lib/seasonEnrolment.js');
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
        /showToast\(t\(preferences\.appLanguage, 'toast\.planSaveFailed'\)\);/,
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
];
