const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const { functionBody } = require('../helpers/sourceSlices.cjs');

/**
 * The two places the running set used to drift from what was running.
 *
 * Source-level because both live in React: App.tsx's onboarding finishes and
 * AppProvider's template delete. The rules themselves are tested in
 * activeProgramSet and runningProgrammes; this pins that they are called.
 */

const root = path.join(__dirname, '..', '..');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
// App.tsx plus the src/app modules (phase-B split, 2026-09-30): the old
// activation must not come back anywhere in the shell, a hook included.
const shell = strip(readAppWiring());
const provider = strip(fs.readFileSync(path.join(root, 'src', 'state', 'AppProvider.tsx'), 'utf8'));
const database = strip(fs.readFileSync(path.join(root, 'src', 'storage', 'database.ts'), 'utf8'));

/** From `signature` to the next function declared at the same indent. */
function body(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is gone`);
  const ends = ['\n  function ', '\n  async function ']
    .map((marker) => source.indexOf(marker, start + signature.length))
    .filter((index) => index > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

module.exports = [
  {
    name: 'program cap wiring: both guided onboarding finishes put their plan in the running set',
    run() {
      // Each finish exactly, to its own closing brace: body() ran on to the
      // next declaration, which is not the finish's code and moves when
      // VinhaApp's blocks leave for src/app.
      for (const signature of ['async function handleOnboardingCompleteToTraining', 'async function handleSetupCompleteToTraining']) {
        assert.match(
          functionBody(shell, signature),
          // A block since the analytics audit (2026-09-21): the activation is
          // also read for plan_adopted, and what it returns is still the rule.
          /activate: \(planId, current\) => \{\s*const next = activateOnboardingPlan\(current, planId, resolveActiveProgramCap\(resolveProEntitlement\(current\)\.unlocked\)\);[\s\S]{0,300}?return next;\s*\}/,
          `${signature} leads with its plan without counting it against the cap`,
        );
      }
      assert.doesNotMatch(shell, /activate: \(planId\) => \(\{ activePlanId: planId \}\)/);
    },
  },
  {
    name: 'program cap wiring: the catalogue onboarding finish follows the same rule',
    run() {
      // Over the shell, to its own closing brace: the pick moves to src/app in
      // phase C (2026-10-01), and body() ran on to the next declaration.
      const pick = functionBody(shell, 'async function handleOnboardingPickReadyProgram(');
      assert.match(pick, /activateOnboardingPlan\(\s*preferences,\s*adoptedPlanId,\s*resolveActiveProgramCap\(resolveProEntitlement\(preferences\)\.unlocked\),?\s*\)/);
      assert.doesNotMatch(pick, /activePlanIds: adoptedPlanId \? \[adoptedPlanId\] : \[\]/, 're-running onboarding stops a season');
    },
  },
  {
    name: 'program cap wiring: the loader repairs the lead after the preferences overlay, not before',
    run() {
      const load = database.slice(database.indexOf('export async function loadDatabase'));
      const overlay = load.indexOf('await loadStoredPreferences(database.preferences)');
      // reconcileRunningSet since it also drops running ids with no plan
      // behind them (2026-09-21); counting the lead is one step of it. Through
      // reconcileWithPlans, which repairs the completion dismissals in the
      // same step (hunt 10, #19).
      const repair = load.indexOf('reconcileWithPlans(preferences, database.workoutPlans)');
      assert.match(database, /function reconcileWithPlans\([^)]*\)[^{]*\{\s*return reconcileCompletionDismissals\(reconcileRunningSet\(preferences, plans\), plans\);/);
      assert.ok(overlay > 0, 'the preferences overlay moved');
      assert.ok(repair > overlay, 'the repair runs on a copy the overlay then replaces');
    },
  },
  {
    // Setup can be answered again from Profile, and each run writes a new
    // programme of the reader's own. At the free limit the provider refuses it
    // with ProgramLimitReachedError — which nothing caught, so the button came
    // back and nothing happened.
    name: 'program cap wiring: a refused onboarding save shows the limit sheet and goes nowhere',
    run() {
      // Over the shell, each to its own closing brace: the onboarding finishes
      // move to src/app in phase C (2026-10-01).
      const helper = functionBody(shell, 'async function saveOnboardingOrExplain(');
      assert.match(helper, /catch \(error\) \{\s*if \(error instanceof ProgramLimitReachedError\) \{\s*setProgramLimitVisible\(true\);\s*return false;/);
      assert.match(helper, /showToast\(t\(preferences\.appLanguage, 'toast\.planSaveFailed'\)\)/);

      for (const signature of ['async function handleOnboardingCompleteToTraining', 'async function handleSetupCompleteToTraining']) {
        // The finish exactly, to its own closing brace. body() ran on to the
        // next declaration: past the setup finish that is the recovery
        // handlers, and when they leave App.tsx it becomes some 1,600 lines of
        // other code, where an unrelated resetToRoute stands in for its own.
        const finish = functionBody(shell, signature);
        const guard = finish.search(/if \(!saved\) \{\s*return;/);
        assert.ok(guard > 0, `${signature} carries on after a refused save`);
        assert.doesNotMatch(finish, /await saveOnboardingResult\(/, `${signature} saves around the explanation`);
        // The weigh-in that stood first here is gone from both finishes: the
        // flagged seeding effect logs the setup weight, once (2026-09-17).
        for (const after of ['haptics.success()', 'resetToRoute(ROOT_ROUTES.home)']) {
          assert.ok(finish.indexOf(after) > guard, `${signature}: ${after} can run before the save is known to have landed`);
        }
      }

      // The review button no longer buzzes success before the save starts.
      const onboarding = strip(fs.readFileSync(path.join(root, 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8'));
      const cta = onboarding.slice(onboarding.indexOf("ctaLabel={t(language, 'onb.cta.startTraining')}"));
      const onContinue = cta.slice(cta.indexOf('onContinue='), cta.indexOf('onTopToneChange='));
      assert.doesNotMatch(onContinue, /haptics\.success/);
    },
  },
  {
    name: 'program cap wiring: onboarding activation reads the preferences inside the lock',
    run() {
      assert.match(body(provider, 'function saveOnboardingResult'), /input\.activate\(plan\.id, withPlan\.preferences\)/);
    },
  },
  {
    name: 'program cap wiring: deleting a programme stops it before its plans are emptied',
    run() {
      const remove = body(provider, 'function deleteWorkoutTemplate');
      const stop = remove.indexOf('stopProgramme(');
      const removal = remove.indexOf('workoutTemplateRepository.remove(');
      assert.ok(stop > 0, 'a deleted programme keeps its slot in the running set');
      assert.ok(removal > stop, 'the plans are emptied before stopProgramme can find them');
      assert.match(
        remove,
        /\.\.\.nextDatabase\.preferences,\s*\.\.\.stopped,/,
        'stopProgramme is asked, and its answer is never written',
      );
    },
  },
];
