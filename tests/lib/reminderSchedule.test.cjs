const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveReminderSchedule, reminderWeekdays } = require('../../.test-dist/lib/reminderSchedule.js');
const { isScheduleKnown, trainsOn } = require('../../.test-dist/lib/trainingSchedule.js');

const ROOT = path.join(__dirname, '..', '..');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...parts) => strip(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));

const NO_PLAN = [];
const MON_THU = [{ label: 'mon' }, { label: 'thu' }];

/**
 * The rhythm the training-day reminders follow, and the two screens that say
 * whether there is one (audit 2026-09-16, S6): "No training days picked yet"
 * beside reminders that were firing on the plan's own days.
 */
module.exports = [
  {
    name: 'reminder schedule: a cycle first, then the plan’s weekdays, then the days setup left open',
    run() {
      const anchor = new Date(2026, 8, 14).getTime();
      const cycle = resolveReminderSchedule({
        trainingCycle: { pattern: [true, true, false], anchorDayStart: anchor },
        planEntries: MON_THU,
        availableDays: ['tue'],
      });
      assert.equal(cycle.kind, 'cycle');
      assert.equal(trainsOn(cycle, new Date(2026, 8, 16)), false, 'the cycle’s rest day');
      assert.deepEqual(reminderWeekdays(cycle), [], 'a cycle has no weekdays to name');

      const named = resolveReminderSchedule({ trainingCycle: null, planEntries: MON_THU, availableDays: ['tue'] });
      assert.deepEqual(reminderWeekdays(named), ['mon', 'thu']);

      const open = resolveReminderSchedule({
        trainingCycle: null,
        planEntries: [{ label: 'Day 1' }, { label: 'mon' }],
        availableDays: ['fri', 'tue'],
      });
      assert.deepEqual(reminderWeekdays(open), ['tue', 'fri'], 'a positional plan names no days');

      const none = resolveReminderSchedule({ trainingCycle: null, planEntries: NO_PLAN, availableDays: [] });
      assert.equal(isScheduleKnown(none), false);
      // The case the screens got wrong: nothing picked in setup, and still a
      // rhythm the reminders fire on.
      assert.equal(
        isScheduleKnown(resolveReminderSchedule({ trainingCycle: null, planEntries: MON_THU, availableDays: [] })),
        true,
      );
    },
  },
  {
    name: 'reminder schedule: a three-session plan reminds three times, not on every free day',
    run() {
      const { resolveDerivedTrainingDays, WEEKDAY_KEYS } = require('../../.test-dist/lib/programTrainingDays.js');

      // Free Monday to Friday, running a three-session programme whose days
      // are positional ("Day 1"), so the plan names no weekdays. This fired
      // five reminders a week while Home's strip lit three dots.
      const free = ['mon', 'tue', 'wed', 'thu', 'fri'];
      const positional = [{ label: 'Day 1' }, { label: 'Day 2' }, { label: 'Day 3' }];
      const days = reminderWeekdays(
        resolveReminderSchedule({ trainingCycle: null, planEntries: positional, availableDays: free }),
      );
      assert.equal(days.length, 3, `three sessions, three reminder days (${days.join(', ')})`);

      // The same days Home's week strip lights, from the same function.
      const strip = resolveDerivedTrainingDays(
        free.map((day) => WEEKDAY_KEYS.indexOf(day)),
        positional.length,
      ).map((index) => WEEKDAY_KEYS[index]);
      assert.deepEqual(days, strip, 'the reminders and the week strip name the same days');

      // A plan with more sessions than free days keeps every one of them, and
      // no plan at all leaves availability as the only answer there is.
      assert.deepEqual(
        reminderWeekdays(
          resolveReminderSchedule({
            trainingCycle: null,
            planEntries: [{}, {}, {}, {}, {}, {}],
            availableDays: ['mon', 'wed', 'fri'],
          }),
        ),
        ['mon', 'wed', 'fri'],
      );
      assert.deepEqual(
        reminderWeekdays(
          resolveReminderSchedule({ trainingCycle: null, planEntries: NO_PLAN, availableDays: free }),
        ),
        free,
      );
    },
  },
  {
    name: 'reminder schedule: the settings screens read the rule the reminders follow',
    run() {
      const screen = read('src', 'screens', 'NotificationsScreen.tsx');
      assert.match(screen, /const remindersWithoutDays = prefs\.sessionReminders && !scheduleKnown;/);
      assert.doesNotMatch(screen, /trainingDays/);

      const tab = read('src', 'app', 'renderProfileTab.tsx');
      assert.match(tab, /scheduleKnown=\{isScheduleKnown\(reminderSchedule\(\)\)\}/);
      assert.match(
        tab,
        /resolveReminderSchedule\(\{\s*trainingCycle: preferences\.trainingCycle,\s*planEntries: livePlanEntries\(\s*database\.workoutPlans\.find\(\(plan\) => plan\.id === preferences\.activePlanId\)\?\.entries \?\? \[\],\s*templateSessionsReader\(database\),\s*\),\s*availableDays: preferences\.setupAvailableDays,\s*\}\)/,
      );
      // The plan screen shows the days reminders follow when setup left none.
      assert.match(
        tab,
        /trainingDays=\{\s*preferences\.setupAvailableDays\.length > 0\s*\? preferences\.setupAvailableDays\s*: reminderWeekdays\(reminderSchedule\(\)\)\s*\}/,
      );
      assert.doesNotMatch(tab, /trainingDays=\{preferences\.setupAvailableDays\}/);
    },
  },
  {
    name: 'a plan with no weekday labels keeps the days it was derived on before the placement change',
    run() {
      // Home's strip and the reminders derive these on every read, so a new
      // placement here would move a reader's training days on update with
      // nothing on screen to say why (review of the 2026-10-04 bug hunt).
      const fs = require('node:fs');
      const path = require('node:path');
      const { resolveDerivedTrainingDays, resolveProgramTrainingDays } = require('../../.test-dist/lib/programTrainingDays.js');
      assert.deepEqual(resolveDerivedTrainingDays([0, 1, 2, 3, 4], 3), [0, 2, 3]);
      assert.deepEqual(resolveDerivedTrainingDays([0, 1, 2, 3, 4, 5, 6], 2), [0, 4]);
      // A plan saved from now on stores the better-spread days instead.
      assert.deepEqual(resolveProgramTrainingDays([0, 1, 2, 3, 4], 3), [0, 2, 4]);
      const home = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useHomeTrainingSchedule.ts'), 'utf8');
      assert.match(home, /return resolveDerivedTrainingDays\(open, sessionsPerWeek\);/);
    },
  },
];
