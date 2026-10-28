const assert = require('node:assert/strict');

const { createEmptyDatabase } = require('../../src/data/seed');
const { accountBackupFingerprint } = require('../../src/lib/accountBackup');
const {
  combineHistoryHashes,
  hashHistoryCollection,
  hashHistoryRowTexts,
  historyContentHash,
} = require('../../src/lib/historyContentHash');
const { HISTORY_COLLECTIONS } = require('../../src/lib/historyRowCodec');

function session(id, extra = {}) {
  return {
    id,
    workoutTemplateId: 'workout_x',
    workoutTemplateSessionId: null,
    workoutNameSnapshot: 'Upper',
    sessionNotes: null,
    performedAt: '2026-09-15T09:00:00.000Z',
    startedAt: '2026-09-15T08:00:00.000Z',
    durationMinutes: 50,
    setsCompleted: 12,
    exercisesCompleted: 4,
    totalVolumeKg: 4200,
    ...extra,
  };
}

function database(sessions) {
  return { ...createEmptyDatabase('en'), workoutSessions: sessions };
}

const EMPTY_HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

module.exports = [
  {
    name: 'historyContentHash: a database missing a collection hashes as an empty one',
    run() {
      const full = database([session('a')]);
      const partial = { workoutSessions: full.workoutSessions };
      const emptied = { ...createEmptyDatabase('en'), workoutSessions: full.workoutSessions };
      assert.deepEqual(historyContentHash(partial), historyContentHash(emptied));
      assert.deepEqual(historyContentHash({}), historyContentHash(createEmptyDatabase('en')));
    },
  },
  {
    name: 'historyContentHash: the count is part of the combined digest',
    run() {
      const base = historyContentHash(database([session('a')]));
      const parts = {};
      for (const collection of HISTORY_COLLECTIONS) {
        parts[collection] = { count: base.counts[collection], hash: base.hashes[collection] };
      }
      assert.equal(combineHistoryHashes(parts).combined, base.combined);
      const bumped = { ...parts, workoutSessions: { ...parts.workoutSessions, count: parts.workoutSessions.count + 1 } };
      const result = combineHistoryHashes(bumped);
      assert.notEqual(result.combined, base.combined, 'same per-collection hashes, different count: different digest');
      assert.deepEqual(result.hashes, base.hashes);
    },
  },
  {
    name: 'historyContentHash: equal content hashes equal, whatever the object identity',
    run() {
      const a = historyContentHash(database([session('a'), session('b')]));
      const b = historyContentHash(database([session('a'), session('b')]));
      assert.deepEqual(a, b);
      assert.equal(a.counts.workoutSessions, 2);
      assert.deepEqual(Object.keys(a.hashes), [...HISTORY_COLLECTIONS]);
    },
  },
  {
    name: 'historyContentHash: an edit to a name, a note or the feel changes it, which the backup fingerprint can miss for logs',
    run() {
      const base = historyContentHash(database([session('a')]));
      for (const edit of [{ workoutNameSnapshot: 'Lower' }, { sessionNotes: 'sore' }, { feel: 'great' }]) {
        const changed = historyContentHash(database([session('a', edit)]));
        assert.notEqual(changed.combined, base.combined, JSON.stringify(edit));
        assert.notEqual(changed.hashes.workoutSessions, base.hashes.workoutSessions);
        // Only that collection moved.
        assert.equal(changed.hashes.exerciseLogs, base.hashes.exerciseLogs);
      }
      // A set's weight edit on a log that keeps its id, set count and volume is
      // the kind of change the fingerprint does not see; the content hash does.
      const logWith = (note) => ({ id: 'l1', sessionId: 'a', exerciseNameSnapshot: 'Squat', sets: [{ weight: 100, reps: 5 }], note });
      const dbA = { ...database([session('a')]), exerciseLogs: [logWith('x')] };
      const dbB = { ...database([session('a')]), exerciseLogs: [logWith('y')] };
      assert.equal(accountBackupFingerprint(dbA, EMPTY_HISTORY), accountBackupFingerprint(dbB, EMPTY_HISTORY));
      assert.notEqual(historyContentHash(dbA).combined, historyContentHash(dbB).combined);
    },
  },
  {
    name: 'historyContentHash: order matters, and a boundary between rows cannot be moved',
    run() {
      const a = session('a');
      const b = session('b');
      assert.notEqual(historyContentHash(database([a, b])).combined, historyContentHash(database([b, a])).combined);
      assert.notEqual(hashHistoryRowTexts(['ab', 'c']).hash, hashHistoryRowTexts(['a', 'bc']).hash);
    },
  },
  {
    name: 'historyContentHash: the memory side and the store side hash the same text to the same digest',
    run() {
      const items = [session('a'), session('b', { sessionNotes: 'x' })];
      const fromMemory = hashHistoryCollection(items);
      const fromStore = hashHistoryRowTexts(items.map((item) => JSON.stringify(item)));
      assert.deepEqual(fromMemory, fromStore);
      assert.equal(fromMemory.count, 2);
      const combined = combineHistoryHashes({
        workoutSessions: fromMemory,
        exerciseLogs: hashHistoryCollection([]),
        bodyweightEntries: hashHistoryCollection([]),
        measurementEntries: hashHistoryCollection([]),
        cardioSessions: hashHistoryCollection([]),
      });
      assert.equal(combined.combined, historyContentHash(database(items)).combined);
    },
  },
  {
    name: 'historyContentHash: what is not history (preferences, programmes) does not move it',
    run() {
      const base = database([session('a')]);
      const other = { ...base, preferences: { ...base.preferences, appLanguage: 'fi' }, workoutTemplates: [] };
      assert.equal(historyContentHash(base).combined, historyContentHash(other).combined);
    },
  },
  {
    name: 'historyContentHash: the backup fingerprint is unchanged by exporting its hasher',
    run() {
      // The digest of a fixed input, taken before createHash was exported. If the
      // hasher ever changes, every updated phone looks "changed" to the cloud copy.
      const fixed = {
        ...createEmptyDatabase('en'),
        workoutSessions: [
          { id: 'a', workoutNameSnapshot: 'Upper', performedAt: 'x', setsCompleted: 1, totalVolumeKg: 2, durationMinutes: 3 },
        ],
      };
      assert.equal(accountBackupFingerprint(fixed, EMPTY_HISTORY), '202bhb3fewk');
    },
  },
];
