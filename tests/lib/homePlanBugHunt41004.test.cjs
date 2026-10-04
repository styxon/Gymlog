const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolvablePlanEntries, weeklyMinutesLabel } = require('../../.test-dist/lib/planResolvableEntries.js');
const { resolveNextPlanEntryIndex } = require('../../.test-dist/lib/planRotation.js');
const { resolveTodaySessionPick } = require('../../.test-dist/lib/todaySessionPick.js');
const { normalizeDatabase } = require('../../.test-dist/storage/database.js');

/**
 * Bug hunt, 2026-10-04: Home's active-plan card (B1 unresolvable entries,
 * B2 the day pick across programmes, B3 weekly minutes).
 */
const TODAY = new Date(2026, 9, 4).getTime();
const toDayStart = (iso) => {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const at = (hour, minute = 0) => new Date(2026, 9, 4, hour, minute).toISOString();

module.exports = [
  {
    name: 'plan entries: one that names no session is left out of the rotation, labels and counts alike',
    run() {
      const sessions = [{ id: 's0' }, { id: 's2' }, { id: 's3' }];
      const entries = [
        { workoutTemplateId: 't', workoutTemplateSessionId: 's0', orderIndex: 0, label: 'mon' },
        { workoutTemplateId: 't', workoutTemplateSessionId: 'dead', orderIndex: 1, label: 'tue' },
        { workoutTemplateId: 't', workoutTemplateSessionId: 's2', orderIndex: 2, label: 'wed' },
        { workoutTemplateId: 't', workoutTemplateSessionId: 's3', orderIndex: 3, label: 'fri' },
      ];
      const resolved = resolvablePlanEntries(entries, sessions);
      assert.deepEqual(resolved.map((r) => r.session.id), ['s0', 's2', 's3']);
      assert.deepEqual(resolved.map((r) => r.entry.label), ['mon', 'wed', 'fri']);

      // The rotation over the resolvable list indexes the session list: after
      // s2 it offers s3. Over the full list it said index 3, which is past the
      // three sessions Home can draw, so s3 was never offered.
      const rotation = resolved.map((r) => r.entry);
      const done = [{ workoutTemplateId: 't', workoutTemplateSessionId: 's2', performedAt: at(8) }];
      const next = resolveNextPlanEntryIndex(rotation, done);
      assert.equal(resolved[next].session.id, 's3');
      assert.equal(resolveNextPlanEntryIndex(entries, done), 3, 'the unfiltered index overruns the filtered list');

      // Entries with no session id still read the template by position.
      const positional = resolvablePlanEntries(
        [{ orderIndex: 0 }, { orderIndex: 1 }, { orderIndex: 7 }],
        [{ id: 'a' }, { id: 'b' }],
      );
      assert.deepEqual(positional.map((r) => r.session.id), ['a', 'b']);
    },
  },
  {
    name: 'weekly minutes: the week added up, not the next session times the count',
    run() {
      assert.equal(weeklyMinutesLabel([30, 45, 60]), '~135 min');
      assert.equal(weeklyMinutesLabel([]), '~0 min');
    },
  },
  {
    name: 'Home card: the hook computes rotation, labels, forecast and minutes over the resolvable entries',
    run() {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useHomeActivePlan.ts'), 'utf8');
      assert.match(source, /resolvablePlanEntries\(sortedEntries, activeTemplateSessions\)/);
      assert.match(source, /resolveNextPlanEntryIndex\(rotationEntries,/);
      assert.match(source, /planTrainedOnDay\(rotationEntries,/);
      assert.match(source, /rotationEntries\[sessionIndex\]\?\.label/);
      // Summed over the days that have something in them: an empty day's
      // estimate is only its warm-up and cool-down (review, 2026-10-04).
      assert.match(
        source,
        /weeklyMinutesLabel\(\s*homeSessions\.filter\(\(session\) => session\.exercises\.length > 0\)\.map/,
      );
      assert.doesNotMatch(source, /sortedEntries\[sessionIndex\]/);
      assert.doesNotMatch(source, /estimatedDuration \* sortedEntries/);
    },
  },
  {
    name: "today's pick: a pick made in one programme does not resolve in another that reuses the session id",
    run() {
      const sessions = [{ id: 'upper_a' }, { id: 'lower_a' }];
      const pick = { dayStart: TODAY, sessionId: 'upper_a', pickedAt: Date.parse(at(8)), workoutTemplateId: 'tpl_4_day' };
      const resolve = (templateIds, completed = []) =>
        resolveTodaySessionPick({ pick, sessions, todayDayStart: TODAY, completed, toDayStart, templateIds });
      assert.deepEqual(resolve(new Set(['tpl_4_day'])), { id: 'upper_a' });
      // The reader switched the lead to the 5-day hybrid the same day.
      assert.equal(resolve(new Set(['tpl_5_day_hybrid'])), null);
      // The same-id day trained in ANOTHER programme this afternoon did not
      // answer a pick made in this one.
      const elsewhere = [{ workoutTemplateId: 'tpl_5_day_hybrid', workoutTemplateSessionId: 'upper_a', performedAt: at(9) }];
      assert.deepEqual(resolve(new Set(['tpl_4_day']), elsewhere), { id: 'upper_a' });
      // Trained in this programme: answered, as before.
      const here = [{ workoutTemplateId: 'tpl_4_day', workoutTemplateSessionId: 'upper_a', performedAt: at(9) }];
      assert.equal(resolve(new Set(['tpl_4_day']), here), null);
    },
  },
  {
    name: "today's pick: a legacy pick with no programme keeps applying to the leading one",
    run() {
      const pick = { dayStart: TODAY, sessionId: 'upper_a', pickedAt: Date.parse(at(8)) };
      assert.deepEqual(
        resolveTodaySessionPick({
          pick,
          sessions: [{ id: 'upper_a' }],
          todayDayStart: TODAY,
          completed: [],
          toDayStart,
          templateIds: new Set(['anything']),
        }),
        { id: 'upper_a' },
      );
    },
  },
  {
    name: "today's pick: the programme survives a load, and an old install's pick loads without one",
    run() {
      const load = (todaySession) => normalizeDatabase({ preferences: { todaySession } }).preferences.todaySession;
      assert.equal(
        load({ dayStart: TODAY, sessionId: 'a', pickedAt: TODAY + 5, workoutTemplateId: 'tpl_x' }).workoutTemplateId,
        'tpl_x',
      );
      assert.equal(load({ dayStart: TODAY, sessionId: 'a', pickedAt: TODAY + 5 }).workoutTemplateId, null);
      assert.equal(load({ dayStart: TODAY, sessionId: 'a', workoutTemplateId: 7 }).workoutTemplateId, null);
    },
  },
];
