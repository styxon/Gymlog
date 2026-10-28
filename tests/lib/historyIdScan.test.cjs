const assert = require('node:assert/strict');

const { scanHistoryIds, formatHistoryScan } = require('../../src/lib/historyIdScan');
const { buildHistoryFixture } = require('../../src/lib/historyFixture');

function byName(scan, name) {
  return scan.collections.find((collection) => collection.name === name);
}

module.exports = [
  {
    name: 'historyIdScan: a clean fixture has counts, no duplicates, nothing missing, newest first',
    run() {
      const h = buildHistoryFixture(100);
      const scan = scanHistoryIds(h);
      assert.equal(scan.format, 'appDatabase');
      const sessions = byName(scan, 'workoutSessions');
      assert.equal(sessions.count, 100);
      assert.equal(sessions.duplicateIds, 0);
      assert.equal(sessions.missingId, 0);
      assert.equal(sessions.missingDate, 0);
      assert.equal(sessions.order, 'newest-first');
      const logs = byName(scan, 'exerciseLogs');
      assert.equal(logs.count, h.exerciseLogs.length);
      assert.equal(logs.missingSessionId, 0);
      assert.equal(logs.orphanedSessionId, 0);
      assert.equal(logs.missingDate, null);
      assert.equal(logs.order, 'n/a');
      assert.equal(byName(scan, 'cardioSessions').count, 20);
    },
  },
  {
    name: 'historyIdScan: duplicate ids, missing fields, orphans and a reversed list are counted',
    run() {
      const h = buildHistoryFixture(10);
      h.workoutSessions.push({ ...h.workoutSessions[3] }); // a duplicate id
      h.workoutSessions.push({ ...h.workoutSessions[3] }); // and a third copy
      h.workoutSessions.push({ performedAt: h.workoutSessions[0].performedAt }); // no id
      h.workoutSessions.push({ id: 'no_date' }); // no date
      h.workoutSessions.push('junk');
      h.exerciseLogs.push({ id: 'orphan', sessionId: 'workout_session_missing' });
      h.exerciseLogs.push({ id: 'floating' });
      h.bodyweightEntries.reverse();
      const scan = scanHistoryIds(h);
      const sessions = byName(scan, 'workoutSessions');
      assert.equal(sessions.duplicateIds, 1);
      assert.equal(sessions.duplicateExtraRows, 2);
      assert.equal(sessions.missingId, 1);
      assert.equal(sessions.missingDate, 1);
      assert.equal(sessions.notObjects, 1);
      const logs = byName(scan, 'exerciseLogs');
      assert.equal(logs.orphanedSessionId, 1);
      assert.equal(logs.missingSessionId, 1);
      assert.equal(byName(scan, 'bodyweightEntries').order, 'oldest-first');
    },
  },
  {
    name: 'historyIdScan: a list in no order is mixed, one dated row is not an order, absent keys are absent',
    run() {
      const h = buildHistoryFixture(6);
      [h.workoutSessions[1], h.workoutSessions[2]] = [h.workoutSessions[2], h.workoutSessions[1]];
      assert.equal(byName(scanHistoryIds({ workoutSessions: h.workoutSessions }), 'workoutSessions').order, 'mixed');
      const one = scanHistoryIds({ workoutSessions: h.workoutSessions.slice(0, 1), cardioSessions: 'nope' });
      assert.equal(byName(one, 'workoutSessions').order, 'n/a');
      assert.equal(byName(one, 'cardioSessions').present, false);
      assert.equal(byName(one, 'measurementEntries').present, false);
    },
  },
  {
    name: 'historyIdScan: an account backup payload is read through its database and its slot history',
    run() {
      const h = buildHistoryFixture(5);
      const payload = {
        version: 1,
        exportedAt: '2026-10-28T00:00:00.000Z',
        database: { ...h, preferences: {} },
        workoutHistory: {
          sessions: h.workoutSessions.map((session) => ({ sessionId: session.id, performedAt: session.performedAt })),
          slotHistory: {},
          lastSelectedTemplateId: null,
        },
      };
      const scan = scanHistoryIds(payload);
      assert.equal(scan.format, 'accountBackup');
      assert.equal(byName(scan, 'workoutSessions').count, 5);
      const history = byName(scan, 'workoutHistory.sessions');
      assert.equal(history.count, 5);
      assert.equal(history.duplicateIds, 0);
      assert.equal(history.order, 'newest-first');
    },
  },
  {
    name: 'historyIdScan: something else is unknown and prints no collections',
    run() {
      for (const input of [null, 'text', 5, [], {}, { hello: 'world' }]) {
        const scan = scanHistoryIds(input);
        assert.equal(scan.format, 'unknown');
        assert.deepEqual(scan.collections, []);
      }
      assert.match(formatHistoryScan(scanHistoryIds({})), /No history collections/);
    },
  },
  {
    name: 'historyIdScan: the printed result carries no row content, no id and no note',
    run() {
      const h = buildHistoryFixture(10);
      h.workoutSessions[2].id = 'SECRET_SESSION_ID';
      h.workoutSessions[3].id = 'SECRET_SESSION_ID';
      h.workoutSessions[2].sessionNotes = 'SECRET_NOTE';
      h.exerciseLogs[0].exerciseNameSnapshot = 'SECRET_LIFT';
      const scan = scanHistoryIds(h);
      const printed = formatHistoryScan(scan) + JSON.stringify(scan);
      assert.ok(!/SECRET/.test(printed), 'row content leaked into the scan output');
      assert.match(printed, /duplicate ids 1 \(1 extra rows\)/);
    },
  },
];
