const assert = require('node:assert/strict');
const { isDeepStrictEqual: deepEqual } = require('node:util');

const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

function fixture(count, seed) {
  return require('../../src/lib/historyFixture').buildHistoryFixture(count, seed);
}

function duplicates(rows) {
  return rows.length - new Set(rows.map((row) => row.id)).size;
}

module.exports = [
  {
    name: 'historyFixture: the same seed gives the same bytes, another seed gives other rows',
    run() {
      assert.equal(JSON.stringify(fixture(120, 7)), JSON.stringify(fixture(120, 7)));
      assert.notEqual(JSON.stringify(fixture(120, 7)), JSON.stringify(fixture(120, 8)));
    },
  },
  {
    name: 'historyFixture: counts follow the session count, ids are unique and every log has its session',
    run() {
      for (const count of [0, 1, 300]) {
        const h = fixture(count);
        assert.equal(h.workoutSessions.length, count);
        assert.equal(h.cardioSessions.length, Math.ceil(count / 5));
        assert.ok(h.exerciseLogs.length >= count * 5 && h.exerciseLogs.length <= count * 7);
        if (count > 0) {
          assert.ok(h.bodyweightEntries.length > 0 && h.measurementEntries.length > 0);
        }
        for (const rows of Object.values(h)) {
          assert.equal(duplicates(rows), 0);
        }
        const sessionIds = new Set(h.workoutSessions.map((session) => session.id));
        assert.ok(h.exerciseLogs.every((log) => sessionIds.has(log.sessionId)));
      }
    },
  },
  {
    name: 'historyFixture: sessions run newest first, like the repository leaves them',
    run() {
      const { workoutSessions, bodyweightEntries } = fixture(50);
      for (let index = 1; index < workoutSessions.length; index += 1) {
        assert.ok(Date.parse(workoutSessions[index - 1].performedAt) > Date.parse(workoutSessions[index].performedAt));
      }
      assert.ok(Date.parse(bodyweightEntries[0].recordedAt) > Date.parse(bodyweightEntries[1].recordedAt));
    },
  },
  {
    name: 'historyFixture: normalizeDatabase takes the history in and gives it back unchanged',
    run() {
      const { createEmptyDatabase } = require('../../src/data/seed');
      const { database } = loadAgainstFake(createFakeAsyncStorage(), (requireDist) => ({
        database: requireDist('storage/database.js'),
      }));
      const history = fixture(300);
      const stored = { ...createEmptyDatabase('fi'), ...history };
      const normalized = database.normalizeDatabase(JSON.parse(JSON.stringify(stored)));
      // Through JSON: the normaliser leaves optional keys as undefined and orders keys its
      // own way, neither of which a save keeps.
      const viaJson = (value) => JSON.parse(JSON.stringify(value));
      for (const key of Object.keys(history)) {
        assert.ok(deepEqual(viaJson(normalized[key]), viaJson(history[key])), `${key} changed in normalizeDatabase`);
      }
    },
  },
  {
    name: 'historyFixture: it is shaped like real history, a few kilobytes a session',
    run() {
      const bytesPerSession = JSON.stringify(fixture(300)).length / 300;
      assert.ok(bytesPerSession > 4000 && bytesPerSession < 12000, `${bytesPerSession} bytes per session`);
    },
  },
];
