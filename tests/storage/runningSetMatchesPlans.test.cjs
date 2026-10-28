const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', 'src');

/**
 * Only programmes that are there are running.
 *
 * `createEmptyDatabase` spread the demo seed's preferences and cleared only
 * the lead, so every new install stored `activePlanIds: ['plan_push_pull_legs']`
 * with no plans at all. The loader kept any non-empty string, and the cap
 * counts the set as stored: a free reader finished onboarding running "2 of 2"
 * with one real programme, and the first ready programme they tried to take
 * met the running-cap sheet (2026-09-21). These run the real first launch,
 * save and load against the in-memory AsyncStorage.
 */

function loadStorage() {
  const fake = createFakeAsyncStorage();
  const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
  return { fake, database };
}

const lib = () => require(path.join(DIST, 'lib', 'activeProgramSet.js'));

function plan(id, workoutTemplateId, extra = {}) {
  return {
    id,
    name: id,
    mode: 'rotation',
    entries: [{ id: `${id}_entry_1`, workoutTemplateId, workoutTemplateSessionId: null, label: 'Mon', orderIndex: 0 }],
    isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  };
}

module.exports = [
  {
    name: 'running set: a fresh install takes two programmes without meeting the cap sheet',
    async run() {
      const { evaluateProgramAdoption, addActiveProgram, activateOnboardingPlan, resolveActiveProgramCap, ONBOARDING_PLAN_PREFIX } = lib();
      const { database } = loadStorage();
      const fresh = await database.loadDatabase();
      assert.deepEqual(fresh.preferences.activePlanIds, [], 'a new install runs a programme it does not have');
      assert.equal(fresh.preferences.activePlanId, null);

      // Two ready programmes, one after the other.
      const first = evaluateProgramAdoption({ activePlanIds: fresh.preferences.activePlanIds, targetPlanId: 'ready_plan_a', proUnlocked: false });
      assert.deepEqual(first, { kind: 'adopt', used: 0, cap: 2 });
      const second = evaluateProgramAdoption({
        activePlanIds: addActiveProgram(fresh.preferences.activePlanIds, 'ready_plan_a'),
        targetPlanId: 'ready_plan_b',
        proUnlocked: false,
      });
      assert.equal(second.kind, 'adopt', 'the second programme met the cap sheet with one running');

      // Guided onboarding, then the first ready programme.
      const onboarded = activateOnboardingPlan(fresh.preferences, `${ONBOARDING_PLAN_PREFIX}workout_mine`, resolveActiveProgramCap(false));
      assert.deepEqual(onboarded.activePlanIds, [`${ONBOARDING_PLAN_PREFIX}workout_mine`]);
      const afterOnboarding = evaluateProgramAdoption({ activePlanIds: onboarded.activePlanIds, targetPlanId: 'ready_plan_a', proUnlocked: false });
      assert.deepEqual(afterOnboarding, { kind: 'adopt', used: 1, cap: 2 }, 'onboarding left the reader at 2 of 2 with one programme');
    },
  },
  {
    name: 'running set: an install that stored the phantom loads with it gone, and what really runs survives',
    async run() {
      const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));
      const { evaluateProgramAdoption } = lib();
      const mine = plan('onboarding_plan_workout_mine', 'workout_mine');
      const ready = plan('ready_plan_tpl_x', 'tpl_x');
      const emptied = { ...plan('custom_plan_deleted', 'workout_deleted'), entries: [] };
      const base = { ...createEmptyDatabase('fi'), exerciseLibrary: [], workoutPlans: [mine, ready, emptied] };

      // As an install onboarded before this: blob and preferences key both carry it.
      {
        const { database } = loadStorage();
        const preferences = { ...base.preferences, activePlanId: mine.id, activePlanIds: ['plan_push_pull_legs', mine.id, ready.id] };
        await database.saveDatabase({ ...base, preferences });
        await database.savePreferences(preferences);
        const loaded = await database.loadDatabase();
        assert.deepEqual(loaded.preferences.activePlanIds, [mine.id, ready.id], 'the phantom survived the load');
        assert.equal(loaded.preferences.activePlanId, mine.id, 'the lead that is really there moved');
        assert.equal(loaded.preferences.appLanguage, 'fi');
        assert.equal(
          evaluateProgramAdoption({ activePlanIds: loaded.preferences.activePlanIds, targetPlanId: 'ready_plan_b', proUnlocked: true }).used,
          2,
        );
      }

      // An older install with no preferences key: the blob's own copy heals the same way.
      {
        const { database } = loadStorage();
        await database.saveDatabase({ ...base, preferences: { ...base.preferences, activePlanId: null, activePlanIds: ['plan_push_pull_legs', ready.id] } });
        const loaded = await database.loadDatabase();
        assert.deepEqual(loaded.preferences.activePlanIds, [ready.id]);
        assert.equal(loaded.preferences.activePlanId, ready.id, 'a running programme with no lead is not led');
      }

      // A lead whose plan is gone, and one its template's deletion emptied, give way to what runs.
      {
        const { database } = loadStorage();
        const preferences = { ...base.preferences, activePlanId: 'custom_plan_deleted', activePlanIds: ['custom_plan_deleted', 'ready_plan_gone', ready.id] };
        await database.saveDatabase({ ...base, preferences });
        await database.savePreferences(preferences);
        const loaded = await database.loadDatabase();
        assert.deepEqual(loaded.preferences.activePlanIds, [ready.id]);
        assert.equal(loaded.preferences.activePlanId, ready.id);
        assert.deepEqual(
          loaded.workoutPlans.map((entry) => entry.id),
          [mine.id, ready.id, emptied.id],
          'the plans themselves are held, not deleted',
        );
      }

      // Nothing to heal: the running set comes back exactly as stored.
      {
        const { database } = loadStorage();
        const preferences = { ...base.preferences, activePlanId: ready.id, activePlanIds: [mine.id, ready.id] };
        await database.saveDatabase({ ...base, preferences });
        await database.savePreferences(preferences);
        const loaded = await database.loadDatabase();
        assert.deepEqual(loaded.preferences.activePlanIds, [mine.id, ready.id]);
        assert.equal(loaded.preferences.activePlanId, ready.id);
      }
    },
  },
  {
    name: 'running set: a backup carrying the phantom restores without it',
    run() {
      const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));
      const { preferencesForRestore } = require(path.join(DIST, 'lib', 'accountBackup.js'));
      const ready = plan('ready_plan_tpl_x', 'tpl_x');
      const device = createEmptyDatabase('fi').preferences;
      const restored = { ...device, activePlanId: ready.id, activePlanIds: ['plan_push_pull_legs', ready.id] };
      const committed = preferencesForRestore(restored, device, [ready]);
      assert.deepEqual(committed.activePlanIds, [ready.id]);
      assert.equal(committed.activePlanId, ready.id);
    },
  },
];
