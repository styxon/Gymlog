const {
  ONBOARDING_PLAN_PREFIX,
  activateOnboardingPlan,
  includeLeadInRunningSet,
  FREE_ACTIVE_PROGRAM_CAP,
  PRO_ACTIVE_PROGRAM_CAP,
  addActiveProgram,
  evaluateProgramAdoption,
  removeActiveProgram,
  resolveActiveProgramCap,
} = require('../../src/lib/activeProgramSet');

module.exports = [
  {
    name: 'the cap is two free and five on Pro',
    run() {
      const assert = require('node:assert/strict');
      assert.equal(FREE_ACTIVE_PROGRAM_CAP, 2);
      assert.equal(PRO_ACTIVE_PROGRAM_CAP, 5);
      assert.equal(resolveActiveProgramCap(false), 2);
      assert.equal(resolveActiveProgramCap(true), 5);
    },
  },
  {
    name: 'an empty set has room, and adopting reports what it used',
    run() {
      const assert = require('node:assert/strict');
      const decision = evaluateProgramAdoption({
        activePlanIds: [],
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.deepEqual(decision, { kind: 'adopt', used: 0, cap: 2 });
    },
  },
  {
    name: 'one programme still leaves room for a second',
    run() {
      const assert = require('node:assert/strict');
      const decision = evaluateProgramAdoption({
        activePlanIds: ['onboarding_plan_back'],
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.equal(decision.kind, 'adopt');
    },
  },
  {
    name: 'the third programme is blocked for free and offers the upgrade',
    run() {
      const assert = require('node:assert/strict');
      const decision = evaluateProgramAdoption({
        activePlanIds: ['plan_a', 'plan_b'],
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.deepEqual(decision, { kind: 'blocked', used: 2, cap: 2, canUpgrade: true });
    },
  },
  {
    name: 'Pro gets past two but is blocked at six without being sold Pro again',
    run() {
      const assert = require('node:assert/strict');
      const atThree = evaluateProgramAdoption({
        activePlanIds: ['a', 'b'],
        targetPlanId: 'c',
        proUnlocked: true,
      });
      assert.equal(atThree.kind, 'adopt');

      const full = evaluateProgramAdoption({
        activePlanIds: ['a', 'b', 'c', 'd', 'e'],
        targetPlanId: 'f',
        proUnlocked: true,
      });
      assert.deepEqual(full, { kind: 'blocked', used: 5, cap: 5, canUpgrade: false });
    },
  },
  {
    name: 'a programme already running is never blocked by the cap',
    run() {
      const assert = require('node:assert/strict');
      const decision = evaluateProgramAdoption({
        activePlanIds: ['plan_a', 'ready_plan_run'],
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.deepEqual(decision, { kind: 'already_active' });
    },
  },
  {
    name: 'duplicates in stored data cannot eat the cap',
    run() {
      const assert = require('node:assert/strict');
      const decision = evaluateProgramAdoption({
        activePlanIds: ['plan_a', 'plan_a'],
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.deepEqual(decision, { kind: 'adopt', used: 1, cap: 2 });
    },
  },
  {
    name: 'adding keeps order and never duplicates on a double tap',
    run() {
      const assert = require('node:assert/strict');
      assert.deepEqual(addActiveProgram(['a'], 'b'), ['a', 'b']);
      assert.deepEqual(addActiveProgram(['a', 'b'], 'b'), ['a', 'b']);
      assert.deepEqual(addActiveProgram([], 'a'), ['a']);
    },
  },
  {
    name: 'removing frees the cap again so two is not a dead end',
    run() {
      const assert = require('node:assert/strict');
      assert.deepEqual(removeActiveProgram(['a', 'b'], 'a'), ['b']);

      const afterRemoval = evaluateProgramAdoption({
        activePlanIds: removeActiveProgram(['a', 'b'], 'a'),
        targetPlanId: 'ready_plan_run',
        proUnlocked: false,
      });
      assert.equal(afterRemoval.kind, 'adopt');
    },
  },
  {
    name: 'removing something absent leaves the set alone',
    run() {
      const assert = require('node:assert/strict');
      assert.deepEqual(removeActiveProgram(['a', 'b'], 'zzz'), ['a', 'b']);
    },
  },
  {
    // Guided onboarding used to set the lead only, outside the set the cap
    // counts: a free reader then adopted two ready programmes and ran three.
    name: 'the programme onboarding hands over counts against the cap',
    run() {
      const assert = require('node:assert/strict');
      const plan = `${ONBOARDING_PLAN_PREFIX}workout_abc`;
      const afterOnboarding = activateOnboardingPlan({ activePlanId: null, activePlanIds: [] }, plan, FREE_ACTIVE_PROGRAM_CAP);
      assert.deepEqual(afterOnboarding, { activePlanId: plan, activePlanIds: [plan] });

      const withOneReady = addActiveProgram(afterOnboarding.activePlanIds, 'ready_plan_run');
      assert.equal(
        evaluateProgramAdoption({ activePlanIds: withOneReady, targetPlanId: 'ready_plan_strong', proUnlocked: false }).kind,
        'blocked',
        'a free reader can run a third programme on top of the one onboarding gave them',
      );
    },
  },
  {
    name: 'answering onboarding again replaces its programme and keeps the ones adopted by hand',
    run() {
      const assert = require('node:assert/strict');
      const old = `${ONBOARDING_PLAN_PREFIX}workout_old`;
      const next = `${ONBOARDING_PLAN_PREFIX}workout_new`;
      const result = activateOnboardingPlan(
        { activePlanId: old, activePlanIds: [old, 'season_plan_summer', 'ready_plan_run'] },
        next,
        PRO_ACTIVE_PROGRAM_CAP,
      );

      assert.equal(result.activePlanId, next);
      assert.deepEqual(result.activePlanIds, ['season_plan_summer', 'ready_plan_run', next]);
      // Saved twice in a row, the same plan is not counted twice.
      assert.deepEqual(activateOnboardingPlan(result, next, PRO_ACTIVE_PROGRAM_CAP).activePlanIds, result.activePlanIds);
    },
  },
  {
    // PR review: setup can be run again from Profile at any time, and a free
    // reader already running two programmes they adopted themselves came out
    // of it with three.
    name: 'answering onboarding again at the cap puts the new programme in the lead\'s place, not a third slot',
    run() {
      const assert = require('node:assert/strict');
      const next = `${ONBOARDING_PLAN_PREFIX}workout_new`;
      const atCap = activateOnboardingPlan(
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run', 'season_plan_summer'] },
        next,
        FREE_ACTIVE_PROGRAM_CAP,
      );
      assert.deepEqual(atCap, { activePlanId: next, activePlanIds: ['season_plan_summer', next] });

      // Room left: nothing is dropped.
      const withRoom = activateOnboardingPlan(
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'] },
        next,
        FREE_ACTIVE_PROGRAM_CAP,
      );
      assert.deepEqual(withRoom.activePlanIds, ['ready_plan_run', next]);

      // Pro has room for it.
      const pro = activateOnboardingPlan(
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run', 'season_plan_summer'] },
        next,
        PRO_ACTIVE_PROGRAM_CAP,
      );
      assert.deepEqual(pro.activePlanIds, ['ready_plan_run', 'season_plan_summer', next]);

      // An earlier onboarding plan in the lead is replaced by the usual rule, so
      // nothing adopted by hand is dropped to make room.
      const old = `${ONBOARDING_PLAN_PREFIX}workout_old`;
      const replacingOld = activateOnboardingPlan(
        { activePlanId: old, activePlanIds: [old, 'season_plan_summer'] },
        next,
        FREE_ACTIVE_PROGRAM_CAP,
      );
      assert.deepEqual(replacingOld.activePlanIds, ['season_plan_summer', next]);

      // Saving the same plan twice never evicts the lead it already is.
      assert.deepEqual(activateOnboardingPlan(atCap, next, FREE_ACTIVE_PROGRAM_CAP).activePlanIds, atCap.activePlanIds);
    },
  },
  {
    // Installs that onboarded before the fix: the lead is stored outside the
    // set, and nothing but the loader will ever put it back.
    name: 'a stored lead missing from the running set is counted again on load',
    run() {
      const assert = require('node:assert/strict');
      const plans = [
        { id: 'onboarding_plan_x', entries: [{}] },
        { id: 'ready_plan_run', entries: [{}] },
        { id: 'custom_plan_deleted', entries: [] },
      ];

      const repaired = includeLeadInRunningSet(
        { activePlanId: 'onboarding_plan_x', activePlanIds: ['ready_plan_run'], appLanguage: 'fi' },
        plans,
      );
      assert.deepEqual(repaired.activePlanIds, ['ready_plan_run', 'onboarding_plan_x']);
      assert.equal(repaired.appLanguage, 'fi', 'the rest of the preferences did not survive');
      assert.equal(
        evaluateProgramAdoption({ activePlanIds: repaired.activePlanIds, targetPlanId: 'ready_plan_b', proUnlocked: false }).kind,
        'blocked',
      );

      // Nothing to repair, or nothing real to count.
      const already = { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'] };
      assert.equal(includeLeadInRunningSet(already, plans), already);
      assert.deepEqual(includeLeadInRunningSet({ activePlanId: null, activePlanIds: [] }, plans).activePlanIds, []);
      assert.deepEqual(
        includeLeadInRunningSet({ activePlanId: 'plan_gone', activePlanIds: [] }, plans).activePlanIds,
        [],
        'a lead whose plan no longer exists takes a slot',
      );
      assert.deepEqual(
        includeLeadInRunningSet({ activePlanId: 'custom_plan_deleted', activePlanIds: [] }, plans).activePlanIds,
        [],
        'a lead whose programme was deleted takes a slot',
      );
    },
  },
  {
    // Every new install carried the demo seed's `plan_push_pull_legs` in the
    // running set with no plan behind it, and the cap counts the set as
    // stored: one of a free reader's two slots was gone before they chose
    // anything (2026-09-21). The load and the restore apply this.
    name: 'the running set keeps only programmes whose plans can run, and the lead follows',
    run() {
      const assert = require('node:assert/strict');
      const { reconcileRunningSet, planCanRun } = require('../../src/lib/activeProgramSet');
      const plans = [
        { id: 'onboarding_plan_x', entries: [{}] },
        { id: 'ready_plan_run', entries: [{}] },
        { id: 'custom_plan_deleted', entries: [] },
      ];
      assert.equal(planCanRun(plans, 'ready_plan_run'), true);
      assert.equal(planCanRun(plans, 'custom_plan_deleted'), false, 'a plan its template deletion emptied');
      assert.equal(planCanRun(plans, 'plan_push_pull_legs'), false);
      assert.equal(planCanRun(plans, null), false);

      // The phantom goes; the programme that is really there stays, and leads.
      const healed = reconcileRunningSet(
        { activePlanId: 'onboarding_plan_x', activePlanIds: ['plan_push_pull_legs', 'onboarding_plan_x'], appLanguage: 'fi' },
        plans,
      );
      assert.deepEqual(healed.activePlanIds, ['onboarding_plan_x']);
      assert.equal(healed.activePlanId, 'onboarding_plan_x');
      assert.equal(healed.appLanguage, 'fi', 'the rest of the preferences did not survive');
      assert.equal(
        evaluateProgramAdoption({ activePlanIds: healed.activePlanIds, targetPlanId: 'ready_plan_b', proUnlocked: false }).kind,
        'adopt',
        'the phantom still takes a slot',
      );

      // A lead with nothing behind it gives way to the first programme still
      // running, as stopping the lead does; with none running, nothing leads.
      assert.deepEqual(
        reconcileRunningSet({ activePlanId: 'plan_gone', activePlanIds: ['custom_plan_deleted', 'ready_plan_run'] }, plans),
        { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run'] },
      );
      assert.deepEqual(
        reconcileRunningSet({ activePlanId: 'plan_push_pull_legs', activePlanIds: ['plan_push_pull_legs'] }, []),
        { activePlanId: null, activePlanIds: [] },
      );
      // The lead is still counted in the set, as it was.
      assert.deepEqual(
        reconcileRunningSet({ activePlanId: 'onboarding_plan_x', activePlanIds: ['ready_plan_run'] }, plans).activePlanIds,
        ['ready_plan_run', 'onboarding_plan_x'],
      );
      // Nothing to repair: the same object back, and duplicates are one.
      const clean = { activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run', 'onboarding_plan_x'] };
      assert.equal(reconcileRunningSet(clean, plans), clean);
      assert.deepEqual(
        reconcileRunningSet({ activePlanId: 'ready_plan_run', activePlanIds: ['ready_plan_run', 'ready_plan_run'] }, plans).activePlanIds,
        ['ready_plan_run'],
      );
    },
  },
];
