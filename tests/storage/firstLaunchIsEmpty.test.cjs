const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createEmptyDatabase, createSeedDatabase } = require('../../src/data/seed');

const databaseSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'storage', 'database.ts'),
  'utf8',
);

// Comments are allowed to name the seed — the point of the guard is that no
// code path calls it.
const databaseCode = databaseSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

module.exports = [
  {
    name: 'a first launch never inherits the demo seed',
    run() {
      // The guard is at the source level because loadDatabase talks to
      // AsyncStorage, which does not exist in the Node test environment.
      assert.doesNotMatch(
        databaseCode,
        /createSeedDatabase\(\)/,
        'storage/database.ts must not build the demo seed — a new install would show invented history',
      );
      // The reset's blank database is the empty one too, in the phone's
      // language (tests/storage/resetKeepsInstall runs it).
      assert.match(databaseCode, /const blank = createEmptyDatabase\(resolveDeviceLanguage\(\)\);/);
    },
  },
  {
    name: 'the empty database has no sessions, logs, or bodyweight history',
    run() {
      const empty = createEmptyDatabase();

      assert.deepEqual(empty.workoutSessions, []);
      assert.deepEqual(empty.exerciseLogs, []);
      assert.deepEqual(empty.bodyweightEntries, []);
      assert.deepEqual(empty.measurementEntries, []);
      assert.deepEqual(empty.workoutTemplates, []);
      assert.equal(empty.preferences.activePlanId, null);
      // The exercise library is reference data, not the user's history.
      assert.ok(empty.exerciseLibrary.length > 0);
    },
  },
  {
    name: 'the demo seed still carries history, so the distinction stays meaningful',
    run() {
      const seed = createSeedDatabase();

      assert.ok(seed.workoutSessions.length > 0);
      assert.ok(seed.exerciseLogs.length > 0);
      assert.ok(seed.bodyweightEntries.length > 0);
    },
  },
];
