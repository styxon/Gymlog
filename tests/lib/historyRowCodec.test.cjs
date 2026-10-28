const assert = require('node:assert/strict');

const {
  HISTORY_COLLECTIONS,
  HISTORY_TABLES,
  decodeHistoryRow,
  decodeHistoryRows,
  encodeHistoryRow,
} = require('../../src/lib/historyRowCodec');

module.exports = [
  {
    name: 'historyRowCodec: a row is its JSON and the derived columns, and decodes back to the same text',
    run() {
      const session = { id: 's1', performedAt: '2026-09-15T09:00:00.000Z', workoutNameSnapshot: 'Upper', durationMinutes: 50 };
      const encoded = encodeHistoryRow('workoutSessions', session);
      assert.deepEqual(encoded.values, ['s1', '2026-09-15T09:00:00.000Z']);
      assert.equal(encoded.json, JSON.stringify(session));
      const decoded = decodeHistoryRow('workoutSessions', encoded.json);
      assert.deepEqual(decoded, session);
      assert.equal(JSON.stringify(decoded), encoded.json, 'the text survives a round trip, key order included');
    },
  },
  {
    name: 'historyRowCodec: every collection has a table, columns and sources of equal length, with id first',
    run() {
      assert.equal(Object.keys(HISTORY_TABLES).length, HISTORY_COLLECTIONS.length);
      const tables = new Set();
      for (const collection of HISTORY_COLLECTIONS) {
        const spec = HISTORY_TABLES[collection];
        assert.equal(spec.columns.length, spec.sources.length, collection);
        assert.equal(spec.columns[0], 'id');
        assert.equal(spec.sources[0], 'id');
        assert.match(spec.table, /^[a-z_]+$/);
        tables.add(spec.table);
      }
      assert.equal(tables.size, HISTORY_COLLECTIONS.length);
    },
  },
  {
    name: 'historyRowCodec: derived columns come from the plan\'s fields and are null when absent or not text',
    run() {
      assert.deepEqual(encodeHistoryRow('exerciseLogs', { id: 'l1', sessionId: 's1' }).values, ['l1', 's1']);
      assert.deepEqual(encodeHistoryRow('bodyweightEntries', { id: 'b1', recordedAt: '2026-01-01' }).values, ['b1', '2026-01-01']);
      assert.deepEqual(
        encodeHistoryRow('measurementEntries', { id: 'm1', kind: 'waist', recordedAt: '2026-01-02' }).values,
        ['m1', 'waist', '2026-01-02'],
      );
      assert.deepEqual(encodeHistoryRow('cardioSessions', { id: 'c1', performedAt: '2026-01-03' }).values, ['c1', '2026-01-03']);
      // Old or damaged data: nothing throws, the column is just empty.
      assert.deepEqual(encodeHistoryRow('workoutSessions', { id: 7, performedAt: undefined }).values, [null, null]);
      assert.deepEqual(encodeHistoryRow('workoutSessions', {}).values, [null, null]);
    },
  },
  {
    name: 'historyRowCodec: a row that is not a JSON object decodes to null instead of throwing',
    run() {
      for (const junk of [null, undefined, 5, {}, [], '', 'not json', '{', 'null', '5', '"text"', '[1,2]']) {
        assert.equal(decodeHistoryRow('exerciseLogs', junk), null, String(junk));
      }
      assert.deepEqual(decodeHistoryRow('exerciseLogs', '{}'), {});
    },
  },
  {
    name: 'historyRowCodec: decodeHistoryRows keeps order and counts what it dropped',
    run() {
      const result = decodeHistoryRows('bodyweightEntries', ['{"id":"a"}', 'broken', '{"id":"b"}', '[]']);
      assert.deepEqual(result.items, [{ id: 'a' }, { id: 'b' }]);
      assert.equal(result.dropped, 2);
    },
  },
];
