const assert = require('node:assert/strict');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { createEmptyDatabase } = require('../../src/data/seed');

/**
 * The preferences key lands with the database blob, or neither does.
 *
 * The load lays the preferences key over the blob's own copy. A commit that
 * changed both used to write them one after the other, and a kill between
 * the two kept a new programme in the blob under the old preferences: the
 * next launch opened onboarding over a programme nothing ran (break round,
 * 2026-09-28). The fake's multiSet is one transaction, as on the phone.
 */

const DB_KEY = '@vinha/database/v1';
const PREFS_KEY = '@vinha/preferences/v1';

function load() {
  const fake = createFakeAsyncStorage();
  const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
  return { fake, database };
}

function onboarded(database) {
  const blank = database.normalizeDatabase(createEmptyDatabase('fi'));
  return { ...blank, preferences: { ...blank.preferences, setupCompleted: true } };
}

module.exports = [
  {
    name: 'preferences with the blob: one write carries both, and the next load sees the new preferences',
    async run() {
      const { fake, database } = load();
      const next = onboarded(database);
      await database.saveDatabase(next, { withPreferences: true });
      assert.equal(JSON.parse(fake.rows.get(PREFS_KEY)).setupCompleted, true);
      assert.equal(JSON.parse(fake.rows.get(DB_KEY)).preferences.setupCompleted, true);
      assert.equal((await database.loadDatabase()).preferences.setupCompleted, true);
    },
  },
  {
    name: 'preferences with the blob: a refused write leaves both as they were, never one of them',
    async run() {
      const { fake, database } = load();
      const before = database.normalizeDatabase(createEmptyDatabase('fi'));
      await database.saveDatabase(before, { withPreferences: true });
      const blobBefore = fake.rows.get(DB_KEY);
      const prefsBefore = fake.rows.get(PREFS_KEY);

      fake.faults.multiSet = 1;
      await assert.rejects(database.saveDatabase(onboarded(database), { withPreferences: true }));
      assert.equal(fake.rows.get(DB_KEY), blobBefore, 'the blob moved without its preferences');
      assert.equal(fake.rows.get(PREFS_KEY), prefsBefore, 'the preferences moved without the blob');
    },
  },
  {
    name: 'preferences with the blob: a save that changed no preference leaves the key alone',
    async run() {
      const { fake, database } = load();
      await database.saveDatabase(database.normalizeDatabase(createEmptyDatabase('fi')));
      assert.equal(fake.rows.has(PREFS_KEY), false);
    },
  },
];
