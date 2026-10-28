const assert = require('node:assert/strict');

const { formatListDate } = require('../../src/lib/format');
const { splitLastSessionRecords } = require('../../src/lib/personalRecords');

const NOW = new Date(2026, 9, 19, 12, 0);

function record(key, performedAt, fresh) {
  return {
    key,
    name: key,
    bodyPart: null,
    kind: 'weight',
    value: 100,
    companion: 5,
    performedAt,
    firstAt: performedAt,
    previous: null,
    fresh,
  };
}

/**
 * The one date every list row prints, and the "last session" group that
 * replaced the NEW badge (owner, 2026-10-19).
 */
module.exports = [
  {
    name: 'listDates: Finnish 19.10., English Oct 19, no year in the current year',
    run() {
      const day = new Date(2026, 9, 19, 18, 6);
      assert.equal(formatListDate(day, 'fi', { now: NOW }), '19.10.');
      assert.equal(formatListDate(day, 'en', { now: NOW }), 'Oct 19');
      assert.equal(formatListDate(new Date(2026, 0, 5), 'fi', { now: NOW }), '5.1.');
      assert.equal(formatListDate(new Date(2026, 0, 5), 'en', { now: NOW }), 'Jan 5');
    },
  },
  {
    name: 'listDates: the weekday joins on request (su 18.10. / Sun, Oct 18)',
    run() {
      const sunday = new Date(2026, 9, 18, 9, 0);
      assert.equal(formatListDate(sunday, 'fi', { weekday: true, now: NOW }), 'su 18.10.');
      assert.equal(formatListDate(sunday, 'en', { weekday: true, now: NOW }), 'Sun, Oct 18');
      const monday = new Date(2026, 9, 19, 9, 0);
      assert.equal(formatListDate(monday, 'fi', { weekday: true, now: NOW }), 'ma 19.10.');
    },
  },
  {
    name: 'listDates: another year is named, and an ISO string reads as a local day',
    run() {
      const last = new Date(2025, 11, 31, 20, 0);
      assert.equal(formatListDate(last, 'fi', { now: NOW }), '31.12.2025');
      assert.equal(formatListDate(last, 'en', { now: NOW }), 'Dec 31, 2025');
      assert.equal(formatListDate(new Date(2026, 9, 19, 8, 0).toISOString(), 'fi', { now: NOW }), '19.10.');
    },
  },
  {
    name: 'listDates: an unparseable date is empty, never NaN',
    run() {
      assert.equal(formatListDate('not a date', 'fi', { now: NOW }), '');
      assert.equal(formatListDate('', 'en', { now: NOW }), '');
    },
  },
  {
    name: 'lastSessionRecords: the newest session leads, the rest keep their order',
    run() {
      const newest = new Date(2026, 9, 18, 18, 0).toISOString();
      const sameSession = new Date(2026, 9, 18, 18, 0, 20).toISOString();
      const older = new Date(2026, 9, 10, 18, 0).toISOString();
      const records = [record('b', older, true), record('a', newest, true), record('c', sameSession, true)];
      const { lastSession, rest } = splitLastSessionRecords(records, newest);
      assert.deepEqual(lastSession.map((r) => r.key), ['a', 'c']);
      assert.deepEqual(rest.map((r) => r.key), ['b']);
    },
  },
  {
    name: 'lastSessionRecords: a newest record that is not fresh opens no group',
    run() {
      const old = new Date(2026, 5, 1, 18, 0).toISOString();
      const { lastSession, rest } = splitLastSessionRecords([record('a', old, false)], old);
      assert.deepEqual(lastSession, []);
      assert.equal(rest.length, 1);
      assert.deepEqual(splitLastSessionRecords([], old), { lastSession: [], rest: [] });
    },
  },
  {
    name: 'lastSessionRecords: a fresh record from an older session than the latest workout opens no group',
    run() {
      const recordAt = new Date(2026, 9, 1, 18, 0).toISOString(); // 20 days before NOW, still fresh
      const laterSession = new Date(2026, 9, 18, 18, 0).toISOString(); // lighter sessions since
      const { lastSession, rest } = splitLastSessionRecords([record('squat', recordAt, true)], laterSession);
      assert.deepEqual(lastSession, []);
      assert.deepEqual(rest.map((r) => r.key), ['squat']);
    },
  },
  {
    name: 'lastSessionRecords: records set in the latest session open the group, older ones stay below',
    run() {
      const latest = new Date(2026, 9, 18, 18, 0).toISOString();
      const sameSession = latest; // a lift's logs carry the session's stamp
      const older = new Date(2026, 9, 5, 18, 0).toISOString();
      const records = [record('old', older, true), record('bench', latest, true), record('row', sameSession, true)];
      const { lastSession, rest } = splitLastSessionRecords(records, latest);
      assert.deepEqual(lastSession.map((r) => r.key), ['bench', 'row']);
      assert.deepEqual(rest.map((r) => r.key), ['old']);
    },
  },
  {
    name: 'lastSessionRecords: an earlier workout the same day is not the last session (hunt 1.1.1)',
    run() {
      const morning = new Date(2026, 9, 18, 8, 0).toISOString();
      const evening = new Date(2026, 9, 18, 10, 0).toISOString();
      // The morning set a squat record; the later workout set nothing.
      const none = splitLastSessionRecords([record('squat', morning, true)], evening);
      assert.deepEqual(none.lastSession, [], 'a record from two hours earlier sat under "Last session"');
      // Both set one: only the later workout's record is in the group.
      const both = splitLastSessionRecords([record('squat', morning, true), record('bench', evening, true)], evening);
      assert.deepEqual(both.lastSession.map((r) => r.key), ['bench']);
      assert.deepEqual(both.rest.map((r) => r.key), ['squat']);
    },
  },
  {
    name: 'lastSessionRecords: with no completed session the group stays closed',
    run() {
      const at = new Date(2026, 9, 18, 18, 0).toISOString();
      for (const none of [null, undefined, '', 'not a date']) {
        const { lastSession, rest } = splitLastSessionRecords([record('a', at, true)], none);
        assert.deepEqual(lastSession, []);
        assert.equal(rest.length, 1);
      }
    },
  },
];
