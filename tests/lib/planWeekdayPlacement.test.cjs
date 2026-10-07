const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { placeWeekdaysOnPlan } = require('../../.test-dist/lib/planWeekdayPlacement.js');
const { planLabelsFromWeekdays } = require('../../.test-dist/lib/trainingWeekSync.js');

/**
 * Re-hunt, 2026-10-07: Profile's weekday picker counted every stored plan
 * entry, a dead one too, where the rhythm strip counts only the live ones.
 */
const ENTRIES = [
  { id: 'e0', workoutTemplateId: 't', workoutTemplateSessionId: 's0', orderIndex: 0, label: 'tue' },
  { id: 'e1', workoutTemplateId: 't', workoutTemplateSessionId: 'dead', orderIndex: 1, label: 'thu' },
  { id: 'e2', workoutTemplateId: 't', workoutTemplateSessionId: 's2', orderIndex: 2, label: 'sat' },
];
const SESSIONS = () => [{ id: 's0' }, { id: 's2' }];
const NONE_LOGGED = () => [];
// Monday 5 October 2026, noon: nothing logged, so session one takes Monday.
const MONDAY = new Date(2026, 9, 5, 12);
const pick = (days) => (liveCount) => planLabelsFromWeekdays(liveCount, days);
const liveLabels = (entries) => entries.filter((entry) => entry.id !== 'e1').map((entry) => entry.label);

module.exports = [
  {
    name: 'weekday placement: two days for a two-session programme with a dead entry are written',
    run() {
      const placed = placeWeekdaysOnPlan(ENTRIES, SESSIONS, pick(['mon', 'wed']), NONE_LOGGED, MONDAY);
      assert.ok(placed, 'two chosen days place two live sessions');
      assert.deepEqual(liveLabels(placed), ['mon', 'wed']);
      // The dead entry is the reader's data and stays as stored.
      assert.deepEqual(placed[1], ENTRIES[1]);
      assert.deepEqual(placed.map((entry) => entry.id), ['e0', 'e1', 'e2']);
    },
  },
  {
    name: 'weekday placement: no chosen day is handed to a dead entry',
    run() {
      const placed = placeWeekdaysOnPlan(ENTRIES, SESSIONS, pick(['mon', 'wed', 'fri']), NONE_LOGGED, MONDAY);
      assert.ok(placed);
      const live = liveLabels(placed);
      assert.equal(live.length, 2);
      assert.equal(new Set(live).size, 2);
      for (const label of live) {
        assert.ok(['mon', 'wed', 'fri'].includes(label), label);
      }
      assert.equal(placed[1].label, 'thu');
    },
  },
  {
    name: 'weekday placement: the session that comes next takes the first day not yet gone',
    run() {
      // Asked on a Tuesday with nothing logged: s0 is next and Monday is gone,
      // so s0 takes Wednesday and s2 the Monday after.
      const tuesday = new Date(2026, 9, 6, 12);
      assert.deepEqual(liveLabels(placeWeekdaysOnPlan(ENTRIES, SESSIONS, pick(['mon', 'wed']), NONE_LOGGED, tuesday)), ['wed', 'mon']);
      // s0 trained on Monday, asked the same Monday: s2 is next and takes Wednesday.
      const logged = () => [{ workoutTemplateId: 't', workoutTemplateSessionId: 's0', performedAt: new Date(2026, 9, 5, 9).toISOString() }];
      assert.deepEqual(liveLabels(placeWeekdaysOnPlan(ENTRIES, SESSIONS, pick(['mon', 'wed']), logged, MONDAY)), ['mon', 'wed']);
    },
  },
  {
    name: 'weekday placement: too few days, or a strip count that misses the live count, writes nothing',
    run() {
      assert.equal(placeWeekdaysOnPlan(ENTRIES, SESSIONS, pick(['mon']), NONE_LOGGED, MONDAY), null);
      const strip = (days) => (liveCount) => (liveCount === days.length ? days : null);
      assert.equal(placeWeekdaysOnPlan(ENTRIES, SESSIONS, strip(['mon', 'wed', 'fri']), NONE_LOGGED, MONDAY), null);
      assert.ok(placeWeekdaysOnPlan(ENTRIES, SESSIONS, strip(['mon', 'wed']), NONE_LOGGED, MONDAY));
    },
  },
  {
    name: "weekday placement: Profile's picker and the rhythm strip both place through it",
    run() {
      const edits = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'programmePlanEdits.tsx'), 'utf8')
        .replace(/\r\n/g, '\n');
      const picker = edits.slice(edits.indexOf('async function handleChangeTrainingDays'), edits.indexOf('async function handleSaveEmphasis'));
      assert.ok(picker.length > 0);
      assert.match(
        picker,
        /const entries = placeWeekdaysOnPlan\(\s*plan\.entries,\s*templateSessionsReader\(database\),\s*\(liveCount\) => planLabelsFromWeekdays\(liveCount, days\),/,
      );
      assert.match(picker, /entries,\s*\/\/ Untouched on purpose/);
      assert.doesNotMatch(picker, /planLabelsFromWeekdays\(ordered\.length/);
    },
  },
];
