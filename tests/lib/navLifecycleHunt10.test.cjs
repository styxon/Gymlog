const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');
const { reconcileCompletionDismissals, resolveCompletionCard } = require('../../.test-dist/lib/programCompletion.js');
const { preferencesForRestore } = require('../../.test-dist/lib/accountBackup.js');
const { createEmptyDatabase } = require('../../.test-dist/data/seed.js');
const { evaluateProgramAdoption } = require('../../.test-dist/lib/activeProgramSet.js');
const { runningSetWithout } = require('../../.test-dist/lib/runningProgrammes.js');
const {
  describeProgramCap,
  programLimitSheetCopy,
  runningCapRefusal,
  runningCapRefusalMessage,
} = require('../../.test-dist/lib/programCapNotice.js');
const { isSameRoute, popRoute, pushRoute } = require('../../.test-dist/navigation/routeHistory.js');
const { ROOT_ROUTES } = require('../../.test-dist/navigation/routes.js');
const { getBackRoute } = require('../../.test-dist/app/backRoute.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * Navigation and programme-lifecycle findings, hunt 10 (2026-10-09):
 *
 * - #19 / #26 A completion dismissal for a plan record that is gone survived
 *   every load and restore, so a ready programme removed on a build before
 *   PR #350 and adopted again never showed its second round's card.
 * - #20 Start next's cap refusal named the running count without the finished
 *   programme it replaces, and disagreed with the Programs tab.
 * - #36 A resume tap into the player Start had opened stacked a second copy
 *   of the player, and its first Back landed on itself.
 * - #39 With an empty history (a widget landing) the hardware key closed the
 *   app from Profile's pages while their own back arrow went to Profile.
 */

const plan = (id, templateId) => ({
  id,
  name: id,
  entries: [{ workoutTemplateId: templateId, label: 'Mon', sessionId: `${templateId}_s1` }],
});

module.exports = [
  {
    name: 'hunt 10 #19: a load drops completion dismissals whose plan record is gone, and keeps the rest',
    async run() {
      const fake = createFakeAsyncStorage();
      const db = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const empty = db.normalizeDatabase(undefined);
      const kept = plan('ready_plan_kept', 'kept');
      // The state an install from before PR #350 can hold: a programme removed
      // (its plan gone) with its answer left behind.
      const stale = {
        ...empty,
        workoutPlans: [kept],
        preferences: {
          ...empty.preferences,
          activePlanId: kept.id,
          activePlanIds: [kept.id],
          dismissedCompletionPlanIds: ['ready_plan_strong_elite', kept.id, 'ready_plan_gone'],
        },
      };
      await db.saveDatabase(stale, { withPreferences: true });
      const loaded = await db.loadDatabase();
      assert.deepEqual(loaded.preferences.dismissedCompletionPlanIds, [kept.id]);

      // The re-adopted programme gets its card for the second round.
      const card = resolveCompletionCard({
        planId: 'ready_plan_strong_elite',
        sessionsDone: 24,
        sessionsTotal: 24,
        activeTemplate: null,
        catalog: [],
        dismissedPlanIds: loaded.preferences.dismissedCompletionPlanIds,
      });
      assert.ok(card, 'the second round of a re-adopted programme shows its card');
    },
  },
  {
    // The preferences key wins over the blob's copy, and it is normalized with
    // no plans: the repair has to run after the overlay, against the blob's
    // plans, or it would either miss the key's copy or wipe every dismissal.
    name: 'hunt 10 #19: the repair reads the preferences key, after the overlay, against the stored plans',
    async run() {
      const fake = createFakeAsyncStorage();
      const db = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const empty = db.normalizeDatabase(undefined);
      const kept = plan('ready_plan_kept', 'kept');
      await db.saveDatabase({ ...empty, workoutPlans: [kept] });
      fake.rows.set(
        '@vinha/preferences/v1',
        JSON.stringify({ ...empty.preferences, dismissedCompletionPlanIds: [kept.id, 'ready_plan_gone'] }),
      );
      const keys = [...fake.rows.keys()];
      assert.ok(keys.includes('@vinha/preferences/v1'), `the preferences key is ${keys.join(', ')}`);
      const loaded = await db.loadDatabase();
      assert.deepEqual(loaded.preferences.dismissedCompletionPlanIds, [kept.id]);
    },
  },
  {
    name: 'hunt 10 #19: a restore drops dismissals for plans the backup does not hold',
    run() {
      const device = createEmptyDatabase('en').preferences;
      const kept = plan('ready_plan_kept', 'kept');
      const restored = {
        ...device,
        activePlanId: kept.id,
        activePlanIds: [kept.id],
        dismissedCompletionPlanIds: ['ready_plan_gone', kept.id],
      };
      assert.deepEqual(preferencesForRestore(restored, device, [kept]).dismissedCompletionPlanIds, [kept.id]);
    },
  },
  {
    name: 'hunt 10 #19: the dismissal repair returns the same object when nothing is stale',
    run() {
      const preferences = { dismissedCompletionPlanIds: ['a'] };
      assert.equal(reconcileCompletionDismissals(preferences, [{ id: 'a' }, { id: 'b' }]), preferences);
      assert.deepEqual(reconcileCompletionDismissals(preferences, [{ id: 'b' }]).dismissedCompletionPlanIds, []);
    },
  },
  {
    name: 'hunt 10 #20: a refused Start next names the count running now, and how many of the others to stop',
    run() {
      const plans = ['F', 'A', 'B', 'C', 'D'].map((x) => plan(`ready_plan_${x}`, x));
      const refusalFor = (running) => {
        const without = runningSetWithout({
          activePlanId: 'ready_plan_F',
          activePlanIds: running,
          plans,
          replacingPlanId: 'ready_plan_F',
        });
        const decision = evaluateProgramAdoption({
          activePlanIds: without.activePlanIds,
          targetPlanId: 'ready_plan_N',
          proUnlocked: false,
        });
        assert.equal(decision.kind, 'blocked');
        return runningCapRefusal(running, decision);
      };

      // A lapsed Pro running five: the Programs tab says 5/2, and so does the sheet.
      const five = plans.map((entry) => entry.id);
      const refusal = refusalFor(five);
      assert.deepEqual(refusal, { used: 5, cap: 2, replacingStop: 3 });
      assert.equal(describeProgramCap({ activePlanIds: five, proUnlocked: false }).used, refusal.used);
      const copy = programLimitSheetCopy('running', refusal.used, refusal.cap, refusal.replacingStop);
      assert.equal(t('en', copy.titleKey, copy.vars), 'Programme places over the limit · 5/2');
      assert.match(t('en', copy.bodyKey, copy.vars), /and 5 are running\. The next programme takes the place of the finished one; stop 3 more to start it/);
      assert.match(t('fi', copy.bodyKey, copy.vars), /sinulla on 5 käynnissä\. Seuraava ohjelma tulee juuri päättyneen tilalle; lopeta lisäksi 3 aloittaaksesi sen/);

      // Three running: it is not "full 2/2" while three run.
      const three = refusalFor(five.slice(0, 3));
      assert.deepEqual(three, { used: 3, cap: 2, replacingStop: 1 });
      const threeCopy = programLimitSheetCopy('running', three.used, three.cap, three.replacingStop);
      assert.equal(t('en', threeCopy.titleKey, threeCopy.vars), 'Programme places over the limit · 3/2');

      // The toast says the same.
      assert.equal(
        runningCapRefusalMessage('en', refusal),
        'You are running 5 programmes, and 2 fit. The next one takes the place of the finished one; drop 3 more to take it on.',
      );
      assert.match(runningCapRefusalMessage('fi', refusal), /^Sinulla on 5 ohjelmaa käynnissä, ja 2 mahtuu\. Seuraava tulee juuri päättyneen tilalle; poista lisäksi 3/);
    },
  },
  {
    name: 'hunt 10 #20: a refusal with nothing being replaced reads as it always did',
    run() {
      const running = ['a', 'b'];
      const decision = evaluateProgramAdoption({ activePlanIds: running, targetPlanId: 'c', proUnlocked: false });
      const refusal = runningCapRefusal(running, decision);
      assert.deepEqual(refusal, { used: 2, cap: 2, replacingStop: null });
      const copy = programLimitSheetCopy('running', refusal.used, refusal.cap, refusal.replacingStop);
      assert.equal(copy.bodyKey, 'programLimit.running.body');
      assert.equal(runningCapRefusalMessage('en', { used: 5, cap: 5, replacingStop: null }), 'You are running 5 programmes. Drop one to take on another.');
    },
  },
  {
    name: 'hunt 10 #36: a resume tap into the open player replaces it instead of stacking a copy',
    run() {
      const programme = { tab: 'workout', screen: 'program', programType: 'ready', workoutTemplateId: 'T' };
      const started = { tab: 'workout', screen: 'guided', workoutTemplateId: 'T' };
      const resumed = { tab: 'workout', screen: 'guided', workoutTemplateId: 'T', resume: true };
      assert.equal(isSameRoute(started, resumed), true);
      assert.equal(isSameRoute(started, { ...resumed, resume: false }), true);
      assert.equal(isSameRoute(started, { ...started, workoutTemplateId: 'U' }), false);
      // Other routes still compare whole.
      assert.equal(isSameRoute(programme, { ...programme, programType: 'custom' }), false);

      // Start pushes the programme page; the lock-screen tap then lands on the
      // same player, and Back leaves the player.
      let history = pushRoute([], programme, started);
      history = pushRoute(history, started, resumed);
      assert.equal(history.length, 1);
      const back = popRoute(history);
      assert.deepEqual(back.route, programme);
    },
  },
  {
    name: 'hunt 10 #39: hardware Back from a Profile page goes where its own back arrow goes',
    run() {
      const workoutHome = { tab: 'workout', screen: 'programs_home' };
      // Each page's on-screen fallback, read from renderProfileTab.
      const source = fs.readFileSync(path.join(__dirname, '../../src/app/renderProfileTab.tsx'), 'utf8');
      const blocks = source.split(/\n  if \(route\.screen === '/).slice(1);
      let compared = 0;
      for (const block of blocks) {
        const screen = block.slice(0, block.indexOf("'"));
        const arrow = block.match(/onBack=\{\(\) => navigateBack\((ROOT_ROUTES\.profile|\{ tab: 'profile', screen: '(\w+)' \})\)\}/);
        if (!arrow) {
          continue;
        }
        const expected = arrow[1] === 'ROOT_ROUTES.profile' ? ROOT_ROUTES.profile : { tab: 'profile', screen: arrow[2] };
        assert.deepEqual(getBackRoute({ tab: 'profile', screen }, workoutHome), expected, `profile/${screen}`);
        compared += 1;
      }
      assert.ok(compared >= 10, `only ${compared} Profile pages were compared — renderProfileTab changed shape`);
      // The widget's schedule tile lands here with no history.
      assert.deepEqual(getBackRoute({ tab: 'profile', screen: 'training_plan' }, workoutHome), ROOT_ROUTES.profile);
      // Profile's root still has no opinion: Back there leaves the app.
      assert.equal(getBackRoute(ROOT_ROUTES.profile, workoutHome), null);
    },
  },
];
