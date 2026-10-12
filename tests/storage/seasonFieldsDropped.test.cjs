const assert = require('node:assert/strict');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

/**
 * The summer/winter season competition is gone (owner decision 2026-10-12).
 *
 * An install that joined a season before then holds `seasonEnrolments` in its
 * preferences — in the database blob and in the preferences key. The loader
 * builds preferences field by field, so the old field is simply not carried:
 * it must load without a throw (a throw sets the whole blob aside as corrupt),
 * keep everything else, and not be written back on the next save.
 *
 * The two season programmes are ordinary catalogue programmes now and keep
 * their ids, so a plan that runs one still loads as running.
 */

const DB_KEY = '@vinha/database/v1';
const PREFS_KEY = '@vinha/preferences/v1';

const SEASON_PLAN = {
  id: 'ready_plan_tpl_season_winter_v1',
  name: 'Winter Engine',
  isActive: true,
  entries: [{ id: 'e1', workoutTemplateId: 'tpl_season_winter_v1', dayOfWeek: 1 }],
};

function storedPreferences() {
  return {
    setupCompleted: true,
    appLanguage: 'fi',
    activePlanId: SEASON_PLAN.id,
    activePlanIds: [SEASON_PLAN.id],
    strengthGoals: [{ exerciseName: 'Deadlift', targetKg: 180, createdAt: '2026-09-01T10:00:00.000Z' }],
    // The shape lib/seasonEnrolment wrote, plus the junk an old normaliser
    // would have dropped: none of it may matter now.
    seasonEnrolments: [
      { season: 'winter', year: 2026, joinedAt: '2026-10-01T10:00:00.000Z' },
      { season: 'summer', year: 2026, joinedAt: '2026-04-02T08:00:00.000Z' },
      null,
      'winter',
    ],
  };
}

function load() {
  const fake = createFakeAsyncStorage();
  const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
  return { fake, database };
}

module.exports = [
  {
    name: 'seasons removed: stored seasonEnrolments are dropped by the normaliser, everything beside them kept',
    run() {
      const { database } = load();
      const out = database.normalizeDatabase({
        preferences: storedPreferences(),
        workoutPlans: [SEASON_PLAN],
        workoutSessions: [{ id: 's1', performedAt: '2026-10-05T17:00:00.000Z', workoutTemplateId: 'tpl_season_winter_v1' }],
      });
      assert.ok(!('seasonEnrolments' in out.preferences), 'the season sign-ups were carried into the loaded preferences');
      assert.equal(out.preferences.setupCompleted, true);
      assert.equal(out.preferences.appLanguage, 'fi');
      assert.equal(out.preferences.activePlanId, SEASON_PLAN.id, 'a plan running a season programme is still the lead');
      assert.deepEqual(out.preferences.activePlanIds, [SEASON_PLAN.id]);
      assert.equal(out.preferences.strengthGoals.length, 1);
      assert.equal(out.workoutSessions.length, 1);
    },
  },
  {
    name: 'seasons removed: an old install with season sign-ups in both keys loads, and the next save writes none',
    async run() {
      const { fake, database } = load();
      const prefs = storedPreferences();
      fake.rows.set(DB_KEY, JSON.stringify({ preferences: prefs, workoutPlans: [SEASON_PLAN] }));
      fake.rows.set(PREFS_KEY, JSON.stringify(prefs));

      const loaded = await database.loadDatabase();
      assert.ok(!('seasonEnrolments' in loaded.preferences));
      assert.equal(loaded.preferences.setupCompleted, true, 'the install opened as a fresh one');
      assert.equal(loaded.preferences.activePlanId, SEASON_PLAN.id);
      assert.ok(loaded.workoutPlans.some((plan) => plan.id === SEASON_PLAN.id), 'the plan was set aside');

      await database.saveDatabase(loaded, { withPreferences: true });
      assert.doesNotMatch(fake.rows.get(DB_KEY), /seasonEnrolments/);
      assert.doesNotMatch(fake.rows.get(PREFS_KEY), /seasonEnrolments/);
    },
  },
];
