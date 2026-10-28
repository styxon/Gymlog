const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { functionBody, between } = require('../helpers/sourceSlices.cjs');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../..', ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * Wiring for the navigation and programme-lifecycle findings of hunt 10
 * (2026-10-09). The pure halves are in tests/lib/navLifecycleHunt10.test.cjs.
 */
module.exports = [
  {
    // #6: "Browse programs" on the programme-complete card opened the legacy
    // exercise list (ROOT_ROUTES.workout), not the Programs home.
    name: 'hunt 10 #6: Browse programs on the completion card lands on the workout tab root',
    run() {
      const dashboard = read('src', 'app', 'renderHomeDashboard.tsx');
      const browse = between(dashboard, 'onCompletionBrowse={', 'otherPrograms={');
      assert.match(browse, /navigate\(resolveTabRoute\('workout'\)\);/);
      assert.doesNotMatch(browse, /navigate\(ROOT_ROUTES\.workout\)/);
    },
  },
  {
    // #7: a tab press or the AI button unmounted the programme builder and its
    // draft without the question its Back asks.
    name: 'hunt 10 #7: the tab bar and the AI button ask the builder before dropping its draft',
    run() {
      const shell = read('src', 'app', 'renderAppShell.tsx');
      const bar = between(shell, '<BottomTabBar', '/>');
      assert.match(bar, /onTabPress=\{\(tab\) => leaveThroughScreenGuard\(\(\) => navigateToTab\(tab\)\)\}/);
      assert.match(bar, /onAiPress=\{\(\) => leaveThroughScreenGuard\(\(\) => navigate\(\{ tab: 'home', screen: 'ai_chat' \}\)\)\}/);
      assert.doesNotMatch(bar, /onTabPress=\{navigateToTab\}/);

      const app = readAppWiring();
      assert.match(
        functionBody(app, '  function leaveThroughScreenGuard('),
        /if \(templateLeaveGuardRef\.current\?\.\(leave\)\) \{\s*return;\s*\}\s*leave\(\);/,
      );
      assert.match(app, /leaveThroughScreenGuard,\n/);
      assert.match(read('src', 'app', 'renderWorkoutTab.tsx'), /<CreateTemplateScreen[\s\S]{0,600}leaveGuardRef=\{templateLeaveGuardRef\}/);

      const screen = read('src', 'screens', 'CreateTemplateScreen.tsx');
      // The guard asks with unsaved work, stands still mid-save, and lets go
      // of a clean draft.
      assert.match(
        screen,
        /const guard: TemplateLeaveGuard = createTemplateLeaveGuard\(\{\s*isSaving: \(\) => savingRef\.current,\s*hasUnsavedWork: \(\) => unsavedWorkRef\.current,[\s\S]*?ask: askToLeave,\s*\}\);\s*leaveGuardRef\.current = guard;/,
      );
      // Unregistered on the way out, so a later screen is not asked.
      assert.match(screen, /return \(\) => \{\s*if \(leaveGuardRef\.current === guard\) \{\s*leaveGuardRef\.current = null;\s*\}\s*\};/);
      // The same dialog Back opens: its confirm leaves the way that asked.
      assert.match(
        screen,
        /onConfirm=\{\(\) => \{\s*const leave = pendingLeaveRef\.current \?\? onBack;\s*pendingLeaveRef\.current = null;\s*setConfirmingLeave\(false\);\s*leave\(\);\s*\}\}/,
      );
    },
  },
  {
    // #20: the cap sheet and toast were handed the count without the finished
    // programme Start next replaces.
    name: 'hunt 10 #20: the doors that replace a finished programme report the count running now',
    run() {
      const app = readAppWiring();
      const starts = read('src', 'app', 'programmeStarts.tsx');
      for (const [source, signature] of [
        [app, '  async function handleAdoptReadyProgram('],
        [starts, '  async function resumeHeldProgramme('],
      ]) {
        const body = functionBody(source, signature);
        assert.match(body, /const refusal = runningCapRefusal\(preferences\.activePlanIds, decision\);/, signature);
        assert.match(body, /setRunningCapSheet\(\{ visible: true, \.\.\.refusal \}\)/, signature);
        assert.match(body, /showToast\(runningCapRefusalMessage\(preferences\.appLanguage, refusal\)\)/, signature);
      }
      const shell = read('src', 'app', 'renderAppShell.tsx');
      assert.match(shell, /kind="running"[\s\S]{0,200}replacingStop=\{runningCapSheet\.replacingStop\}/);
    },
  },
  {
    // #37: a refused programme delete, remove or switch was an unhandled
    // rejection behind a `void` press: the change sprang back with no word.
    name: 'hunt 10 #37: a refused programme delete, remove or switch says so',
    run() {
      const app = readAppWiring();
      assert.match(
        functionBody(app, '  async function handleDeleteCustomWorkout('),
        /try \{\s*await deleteWorkoutTemplate\(workoutTemplateId\);\s*\} catch \(error\) \{[\s\S]*?showToast\(t\(preferences\.appLanguage, 'toast\.programDeleteFailed'\)\);\s*return;\s*\}\s*void haptics\.success\(\);\s*leaveDeletedProgramme\(workoutTemplateId\);/,
      );
      const switches = read('src', 'app', 'programmeSwitches.tsx');
      assert.match(
        functionBody(switches, '  async function handleForgetHeldProgram('),
        /try \{\s*await forgetHeldProgramme\(workoutTemplateId\);\s*\} catch \(error\) \{[\s\S]*?showToast\(t\(preferences\.appLanguage, 'toast\.programDeleteFailed'\)\);\s*return;\s*\}\s*void haptics\.success\(\);/,
      );
      for (const signature of [
        '  async function handleStopProgram(',
        '  async function handleResumeProgram(',
        '  async function handleSwitchActiveProgram(',
      ]) {
        const body = functionBody(switches, signature);
        const writes = body.match(/await (?:updatePreferences|upsertWorkoutPlan)\(/g) ?? [];
        const guarded = body.match(/try \{\s*(?:if \(!toPlanId\) \{[\s\S]*?)?await (?:updatePreferences|upsertWorkoutPlan)\(/g) ?? [];
        assert.ok(writes.length > 0, `${signature} writes nothing`);
        assert.equal(guarded.length, writes.length, `${signature} has a write outside a try`);
        assert.match(body, /catch \(error\) \{\s*saveRefused\(error\);/, signature);
      }
      assert.match(
        functionBody(switches, '  function saveRefused('),
        /reportPlanSaveFailed\('[^']+', error, preferences\.appLanguage, showToast\);/,
      );

      const { t } = require('../../src/lib/i18n');
      assert.equal(t('en', 'toast.programDeleteFailed'), 'Could not delete the program — it is back in your list');
      assert.equal(t('fi', 'toast.programDeleteFailed'), 'Ohjelmaa ei voitu poistaa — se on taas listallasi');
    },
  },
];
