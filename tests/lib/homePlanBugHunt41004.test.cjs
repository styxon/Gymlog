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
  {
    name: 'dead plan entry: the strip, the reminders and Home count the same entries and land on the same weekdays',
    run() {
      const { livePlanEntries } = require('../../.test-dist/lib/planResolvableEntries.js');
      const { planWeekdayIndexes, resolveDerivedTrainingDays, WEEKDAY_KEYS } = require('../../.test-dist/lib/programTrainingDays.js');
      const { resolveReminderSchedule, reminderWeekdays } = require('../../.test-dist/lib/reminderSchedule.js');
      const sessionsFor = (id) => (id === 't' ? [{ id: 's0' }, { id: 's2' }, { id: 's3' }] : []);
      const entry = (sid, orderIndex, label) => ({ workoutTemplateId: 't', workoutTemplateSessionId: sid, orderIndex, label });

      // Labelled plan: the dead Tuesday is not a training day anywhere.
      const labelled = [entry('s0', 0, 'mon'), entry('dead', 1, 'tue'), entry('s2', 2, 'wed'), entry('s3', 3, 'fri')];
      const live = livePlanEntries(labelled, sessionsFor);
      const home = resolvablePlanEntries(labelled, sessionsFor('t')).map((r) => r.entry);
      assert.deepEqual(live, home, 'same list as Home rotates over');
      assert.deepEqual(planWeekdayIndexes(live), [0, 2, 4]);
      assert.deepEqual(planWeekdayIndexes(labelled), [0, 1, 2, 4], 'the raw list lit the dead day');
      const open = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const reminded = resolveReminderSchedule({ trainingCycle: null, planEntries: live, availableDays: open });
      assert.deepEqual(reminderWeekdays(reminded), [0, 2, 4].map((i) => WEEKDAY_KEYS[i]));

      // Unlabelled plan: the derived day count is Home's (2), not the raw 3.
      const bare = [entry('s0', 0, 'Day 1'), entry('dead', 1, 'Day 2'), entry('s2', 2, 'Day 3')];
      const liveBare = livePlanEntries(bare, sessionsFor);
      assert.equal(liveBare.length, 2);
      const openIndexes = [0, 1, 2, 3, 4];
      const stripDays = resolveDerivedTrainingDays(openIndexes, liveBare.length);
      const reminderDays = reminderWeekdays(
        resolveReminderSchedule({ trainingCycle: null, planEntries: liveBare, availableDays: open }),
      );
      assert.deepEqual(reminderDays, stripDays.map((i) => WEEKDAY_KEYS[i]));
      assert.equal(stripDays.length, 2);
      assert.notDeepEqual(stripDays, resolveDerivedTrainingDays(openIndexes, bare.length));
    },
  },
  {
    name: 'dead plan entry: a template with no sessions to judge by keeps every entry',
    run() {
      const { livePlanEntries } = require('../../.test-dist/lib/planResolvableEntries.js');
      const entries = [
        { workoutTemplateId: 'gone', workoutTemplateSessionId: 'a', orderIndex: 1, label: 'wed' },
        { workoutTemplateId: 'gone', workoutTemplateSessionId: 'b', orderIndex: 0, label: 'mon' },
      ];
      assert.deepEqual(livePlanEntries(entries, () => []), entries);
      assert.deepEqual(livePlanEntries([], () => [{ id: 'a' }]), []);
    },
  },
  {
    name: 'rhythm save: counts the entries the strip draws, relabels only those, and never returns silently',
    run() {
      const { livePlanEntries } = require('../../.test-dist/lib/planResolvableEntries.js');
      const entries = [
        { workoutTemplateId: 't', workoutTemplateSessionId: 's0', orderIndex: 0, label: 'mon' },
        { workoutTemplateId: 't', workoutTemplateSessionId: 'dead', orderIndex: 1, label: 'tue' },
        { workoutTemplateId: 't', workoutTemplateSessionId: 's2', orderIndex: 2, label: 'wed' },
      ];
      const strip = livePlanEntries(entries, () => [{ id: 's0' }, { id: 's2' }]);
      // The strip hands back one day per live entry: 2, where the stored list holds 3.
      assert.equal(strip.length, 2);
      assert.notEqual(entries.length, strip.length);

      const src = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
      const edits = src('app', 'programmePlanEdits.tsx');
      const body = edits.slice(edits.indexOf('async function handleSaveRhythm'), edits.indexOf('The weekday picker in Profile'));
      assert.doesNotMatch(body, /plan\.entries\.length !== dayIndexes\.length/);
      assert.match(body, /livePlanEntries\(allOrdered, templateSessionsReader\(database\)\)/);
      assert.match(body, /ordered\.length !== dayIndexes\.length/);
      assert.match(body, /allOrdered\.map\(/, 'dead entries are written back untouched');
      assert.match(body, /return true;/);
      const tab = src('app', 'renderWorkoutTab.tsx');
      assert.match(tab, /handleSaveRhythm\(route\.workoutTemplateId, dayIndexes\)\.then\(\s*\(saved\) => \{\s*if \(!saved\) \{[^}]*toast\.planSaveFailed/);
      // And the programme page draws the same live entries.
      assert.match(tab, /const detailPlanEntries = livePlanEntries\(/);
    },
  },
  {
    name: 'dead plan entry: every reader of the plan for scheduling goes through livePlanEntries',
    run() {
      const src = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...p), 'utf8').replace(/\r\n/g, '\n');
      assert.match(src('app', 'useHomeTrainingSchedule.ts'), /planWeekdayIndexes\(\s*livePlanEntries\(activePlan\?\.entries \?\? \[\], templateSessionsReader\(database\)\),\s*\)/);
      assert.match(src('hooks', 'useScheduledNotifications.ts'), /planEntries: livePlanEntries\(/);
      assert.match(src('app', 'renderProfileTab.tsx'), /planEntries: livePlanEntries\(/);
    },
  },
  {
    name: 'resolveProgramTrainingDays: a count that is not a whole number behaves as the stride rule does',
    run() {
      const { resolveProgramTrainingDays, resolveDerivedTrainingDays } = require('../../.test-dist/lib/programTrainingDays.js');
      const open = [0, 1, 2, 3, 4];
      for (const bad of [Number.NaN, undefined, 2.5, 0.5, Infinity]) {
        const days = resolveProgramTrainingDays(open, bad);
        assert.ok(days.length > 0, `${String(bad)} still gives days`);
        assert.equal(days.length, resolveDerivedTrainingDays(open, bad).length, `${String(bad)}: same count as the stride rule`);
      }
      assert.deepEqual(resolveProgramTrainingDays(open, 2.5), resolveProgramTrainingDays(open, 3));
      assert.deepEqual(resolveProgramTrainingDays(open, Number.NaN), open);
      assert.deepEqual(resolveProgramTrainingDays(open, -1), []);
      assert.deepEqual(resolveProgramTrainingDays([], Number.NaN), []);
    },
  },
];
