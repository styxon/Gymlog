const assert = require('node:assert/strict');

/**
 * These assert English copy, so they assert English number formatting with it.
 * removeTrailingZeros reads a module-level decimal mark (lib/format.ts) that
 * the app sets from preferences and that defaults to Finnish, so a suite that
 * wants points rather than commas has to say so — otherwise it passes or fails
 * on whichever suite ran before it.
 */
const { setNumberLanguage } = require('../../.test-dist/lib/format.js');
setNumberLanguage('en');

const { cycleSchedule, weekdaySchedule } = require('../../.test-dist/lib/trainingSchedule.js');
const {
  buildNotificationPlan,
  parseReminderTime,
  COMEBACK_AFTER_DAYS,
  comebackGapDays,
  DAILY_CAP_BY_LEVEL,
  REMINDER_HORIZON_DAYS,
} = require('../../.test-dist/lib/notificationPlan.js');

// Local wall-clock helper: every assertion below is built the same way the
// planner builds its timestamps, so the suite passes in any timezone.
function at(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

const BASE_PREFS = {
  pushEnabled: true,
  level: 'motivating',
  personalRecords: true,
  weeklySummary: true,
  comebackNudge: true,
  sessionReminders: true,
  reminderTime: '17:30',
  measurementReminderKind: null,
  measurementReminderDay: 'sun',
};

function planWith(overrides = {}) {
  const { prefs, ...rest } = overrides;
  return buildNotificationPlan({
    // Wednesday 2026-07-01, 12:00 local.
    nowMs: at(2026, 7, 1, 12, 0),
    prefs: { ...BASE_PREFS, ...(prefs ?? {}) },
    language: 'en',
    schedule: weekdaySchedule([0, 2, 4]),
    lastSessionAtMs: null,
    lastWorkoutAtMs: null,
    weekSessionCount: 0,
    weekVolumeKg: 0,
    latestPr: null,
    onTrainingBreak: false,
    ...rest,
  });
}

module.exports = [
  {
    name: 'notificationPlan: the weigh-in nudge is off until asked for, then daily, and skips a day already weighed',
    run() {
      // This is the one message a reader turns on by name, so it stays off
      // until they do.
      assert.equal(planWith().filter((item) => item.category === 'weighIn').length, 0);

      const on = planWith({ prefs: { weighInReminder: true, level: 'motivating' } }).filter(
        (item) => item.category === 'weighIn',
      );
      assert.ok(on.length >= 10, `daily over the horizon, got ${on.length}`);
      // Tomorrow morning, not this afternoon: 07:30 today has already gone.
      assert.equal(on[0].fireAtMs, at(2026, 7, 2, 7, 30));
      assert.ok(on.every((item, index) => index === 0 || item.fireAtMs > on[index - 1].fireAtMs));

      // Already on the scale this morning — a reminder for something done is
      // the sign that explains a sign.
      const weighedTomorrow = planWith({
        prefs: { weighInReminder: true },
        nowMs: at(2026, 7, 1, 12, 0),
        lastBodyweightAtMs: at(2026, 7, 2, 8, 0),
      }).filter((item) => item.category === 'weighIn');
      assert.ok(
        weighedTomorrow.every((item) => item.fireAtMs !== at(2026, 7, 2, 7, 30)),
        'the day with a weigh-in on it gets no nudge',
      );
    },
  },
  {
    name: 'notificationPlan: the weekly measurement is off until a kind is chosen, then one morning a week, and skips a day already measured',
    run() {
      // #bugs 2026-08-29: "kerran viikossa esim lantion mittaus tai sen mitä
      // itse haluaa". Off by default — nothing to measure is nothing to say.
      assert.equal(planWith().filter((item) => item.category === 'measure').length, 0);

      // Hips, Sunday mornings, at the weigh-in hour. Now is Wednesday
      // 2026-07-01, so the first is Sunday the 5th; four Sundays fit in the
      // 28-day horizon (5, 12, 19, 26 July) and the 2nd of August does not.
      const hips = planWith({
        prefs: { measurementReminderKind: 'hips', measurementReminderDay: 'sun', level: 'motivating' },
      }).filter((item) => item.category === 'measure');
      assert.deepEqual(
        hips.map((item) => item.fireAtMs),
        [at(2026, 7, 5, 7, 30), at(2026, 7, 12, 7, 30), at(2026, 7, 19, 7, 30), at(2026, 7, 26, 7, 30)],
      );
      assert.equal(hips[0].title, 'Tape measure: Hips');
      assert.match(hips[0].key, /^measure-hips-2026-7-5$/);
      // The kind travels, so the tap can open the measures list ON hips
      // rather than on whatever was selected last (#bugs 2026-09-05).
      assert.equal(hips[0].measureKind, 'hips');

      // Wednesday today, 07:30 already gone: next Wednesday, not this one.
      const wednesdays = planWith({
        prefs: { measurementReminderKind: 'waist', measurementReminderDay: 'wed' },
      }).filter((item) => item.category === 'measure');
      assert.equal(wednesdays[0].fireAtMs, at(2026, 7, 8, 7, 30));

      // Measured that morning already — the reminder for a thing done is
      // dropped, and the following week is untouched.
      const measured = planWith({
        prefs: { measurementReminderKind: 'hips', measurementReminderDay: 'sun' },
        lastMeasurementAtMs: at(2026, 7, 5, 6, 50),
      }).filter((item) => item.category === 'measure');
      assert.deepEqual(
        measured.map((item) => item.fireAtMs),
        [at(2026, 7, 12, 7, 30), at(2026, 7, 19, 7, 30), at(2026, 7, 26, 7, 30)],
      );

      // On a quiet day the weekly measurement outranks the session reminder
      // AND the daily weigh-in on the same minute: the rarest message keeps
      // the slot. With the weigh-in ranked first, a reader who turned both on
      // got the weigh-in every Sunday and the measurement never (PR review).
      const quiet = planWith({
        prefs: {
          measurementReminderKind: 'hips',
          measurementReminderDay: 'sun',
          weighInReminder: true,
          level: 'quiet',
        },
        schedule: weekdaySchedule([0, 1, 2, 3, 4, 5, 6]),
      }).filter((item) => item.fireAtMs >= at(2026, 7, 5, 0, 0) && item.fireAtMs < at(2026, 7, 6, 0, 0));
      assert.equal(quiet.length, 1);
      assert.equal(quiet[0].category, 'measure');
      // And the weigh-in still owns the other six mornings.
      const saturday = planWith({
        prefs: { measurementReminderKind: 'hips', measurementReminderDay: 'sun', weighInReminder: true, level: 'quiet' },
      }).filter((item) => item.fireAtMs >= at(2026, 7, 4, 0, 0) && item.fireAtMs < at(2026, 7, 5, 0, 0));
      assert.deepEqual(saturday.map((item) => item.category), ['weighIn']);
    },
  },
  {
    name: 'notificationPlan: on a crowded quiet day the weigh-in outranks the session reminder',
    run() {
      // A reader who asked for this by name should not lose it to a reminder
      // that was on by default — only a personal record outranks it.
      const quiet = planWith({
        prefs: { weighInReminder: true, level: 'quiet' },
        schedule: weekdaySchedule([0, 1, 2, 3, 4, 5, 6]),
      });
      const thursday = quiet.filter(
        (item) => item.fireAtMs >= at(2026, 7, 2, 0, 0) && item.fireAtMs < at(2026, 7, 3, 0, 0),
      );
      assert.equal(thursday.length, 1, 'quiet is one message a day');
      assert.equal(thursday[0].category, 'weighIn');
    },
  },
  {
    name: 'notificationPlan: the master switch off schedules nothing at all',
    run() {
      assert.deepEqual(planWith({ prefs: { pushEnabled: false } }), []);
    },
  },
  {
    name: 'notificationPlan: a declared training break silences every category',
    run() {
      const plan = planWith({
        onTrainingBreak: true,
        lastSessionAtMs: at(2026, 6, 30, 18, 0),
        weekSessionCount: 2,
        weekVolumeKg: 8000,
        latestPr: { exerciseName: 'Bench press', weightKg: 92.5, reps: 3, achievedAtMs: at(2026, 7, 1, 9, 0) },
      });
      assert.deepEqual(plan, []);
    },
  },
  {
    name: 'notificationPlan: reminders land on the picked weekdays at the picked time',
    run() {
      const plan = planWith({ prefs: { weeklySummary: false } }).filter((item) => item.category === 'reminder');

      assert.ok(plan.length > 0, 'expected reminders for mon/wed/fri');
      // Today is Wednesday and 17:30 has not passed yet, so today counts.
      assert.equal(plan[0].fireAtMs, at(2026, 7, 1, 17, 30));
      assert.equal(plan[1].fireAtMs, at(2026, 7, 3, 17, 30));
      assert.equal(plan[2].fireAtMs, at(2026, 7, 6, 17, 30));

      plan.forEach((item) => {
        const fireAt = new Date(item.fireAtMs);
        assert.ok([1, 3, 5].includes(fireAt.getDay()), 'only mon/wed/fri');
        assert.equal(fireAt.getHours(), 17);
        assert.equal(fireAt.getMinutes(), 30);
      });
    },
  },
  {
    name: 'notificationPlan: reminders cover the whole horizon and never the past',
    run() {
      const nowMs = at(2026, 7, 1, 12, 0);
      const plan = planWith({ prefs: { weeklySummary: false } }).filter((item) => item.category === 'reminder');

      const horizonEnd = at(2026, 7, 1 + REMINDER_HORIZON_DAYS, 23, 59);
      plan.forEach((item) => {
        assert.ok(item.fireAtMs > nowMs, 'nothing scheduled in the past');
        assert.ok(item.fireAtMs <= horizonEnd, 'nothing past the horizon');
      });
      // 4 weeks of mon/wed/fri, starting from today.
      assert.equal(plan.length, 13);
    },
  },
  {
    name: 'notificationPlan: a reminder time already past today starts tomorrow',
    run() {
      const plan = buildNotificationPlan({
        nowMs: at(2026, 7, 1, 19, 0), // Wednesday, after 17:30
        prefs: { ...BASE_PREFS, weeklySummary: false },
        language: 'en',
        schedule: weekdaySchedule([0, 2, 4]),
        lastSessionAtMs: null,
        weekSessionCount: 0,
        weekVolumeKg: 0,
        latestPr: null,
        onTrainingBreak: false,
      }).filter((item) => item.category === 'reminder');

      assert.equal(plan[0].fireAtMs, at(2026, 7, 3, 17, 30), 'Wednesday is spent, Friday is next');
    },
  },
  {
    name: 'notificationPlan: a day already trained gets no reminder',
    run() {
      const plan = planWith({
        prefs: { weeklySummary: false, comebackNudge: false },
        lastSessionAtMs: at(2026, 7, 1, 8, 15),
        lastWorkoutAtMs: at(2026, 7, 1, 8, 15), // trained this morning
      }).filter((item) => item.category === 'reminder');

      assert.equal(plan[0].fireAtMs, at(2026, 7, 3, 17, 30), "today's reminder is dropped");
    },
  },
  {
    name: 'notificationPlan: a morning run does not cancel the evening workout reminder',
    run() {
      // A run marks the day on the calendar without doing the workout planned
      // for it — the widget's rule. Fed the any-activity timestamp, the
      // reminder skip treated this morning's run as the day's training done.
      const plan = planWith({
        prefs: { weeklySummary: false, comebackNudge: false },
        lastSessionAtMs: at(2026, 7, 1, 7, 0), // ran this morning
        lastWorkoutAtMs: at(2026, 6, 29, 18, 0), // last lifted on Monday
      }).filter((item) => item.category === 'reminder');

      assert.equal(plan[0].fireAtMs, at(2026, 7, 1, 17, 30), "today's reminder still fires");
    },
  },
  {
    name: 'notificationPlan: no picked days means no reminders, not invented ones',
    run() {
      const plan = planWith({ schedule: weekdaySchedule([]) });
      assert.equal(plan.filter((item) => item.category === 'reminder').length, 0);
    },
  },
  {
    // Bug hunt, 2026-10-04: a flat 5-day nudge fired weekly for a once-a-week plan.
    name: 'notificationPlan: the comeback nudge waits for a missed planned day',
    run() {
      const comebackFor = (schedule, lastSessionAtMs, nowMs) =>
        planWith({
          prefs: { sessionReminders: false, weeklySummary: false },
          schedule,
          lastSessionAtMs,
          nowMs,
        }).filter((item) => item.category === 'comeback');

      // Monday-only plan, trained Mon 2026-06-29: next planned day Mon 07-06
      // passes, so the nudge is Tue 07-07 (8 days), not Sat 07-04.
      const mon = comebackFor(weekdaySchedule([0]), at(2026, 6, 29, 18, 0), at(2026, 7, 1, 12, 0));
      assert.equal(mon.length, 1);
      assert.equal(mon[0].fireAtMs, at(2026, 7, 7, 17, 30));
      assert.match(mon[0].body, /8 days/);

      // Mon/Wed/Fri: Wed missed -> day after is 2 days, so the 5-day floor holds.
      const mwf = comebackFor(weekdaySchedule([0, 2, 4]), at(2026, 6, 29, 18, 0), at(2026, 7, 1, 12, 0));
      assert.equal(mwf[0].fireAtMs, at(2026, 7, 4, 17, 30));

      // Cycle plan (1 on, 6 off, anchored on the session day): next planned day is 7 days on.
      const cycle = cycleSchedule([true, false, false, false, false, false, false], new Date(2026, 5, 29));
      const cyc = comebackFor(cycle, at(2026, 6, 29, 18, 0), at(2026, 7, 1, 12, 0));
      assert.equal(cyc[0].fireAtMs, at(2026, 7, 7, 17, 30));

      // No schedule: the flat window stays.
      const none = comebackFor(weekdaySchedule([]), at(2026, 6, 29, 18, 0), at(2026, 7, 1, 12, 0));
      assert.equal(none[0].fireAtMs, at(2026, 7, 4, 17, 30));

      // Calendar stepping across the late-October DST change.
      assert.equal(comebackGapDays(weekdaySchedule([0]), new Date(2026, 9, 26, 18, 0)), 8);
    },
  },
  {
    name: 'notificationPlan: the comeback nudge is anchored to the last session only',
    run() {
      const lastSessionAtMs = at(2026, 6, 29, 18, 0);
      const plan = planWith({
        prefs: { sessionReminders: false, weeklySummary: false },
        lastSessionAtMs,
      });

      assert.equal(plan.length, 1);
      assert.equal(plan[0].category, 'comeback');
      assert.equal(plan[0].fireAtMs, at(2026, 6, 29 + COMEBACK_AFTER_DAYS, 17, 30));
    },
  },
  {
    name: 'notificationPlan: a gap longer than the nudge window produces no second nudge',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, weeklySummary: false },
        lastSessionAtMs: at(2026, 6, 20, 18, 0), // 11 days ago
      });
      assert.deepEqual(plan, [], 'the moment passed — no daily drip');
    },
  },
  {
    name: 'notificationPlan: never trained means nothing to come back to',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, weeklySummary: false },
        lastSessionAtMs: null,
      });
      assert.deepEqual(plan, []);
    },
  },
  {
    name: 'notificationPlan: the weekly summary quotes this week and lands on Sunday',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, comebackNudge: false },
        weekSessionCount: 3,
        weekVolumeKg: 12400,
      });

      assert.equal(plan.length, 1);
      assert.equal(plan[0].category, 'weekly');
      assert.equal(plan[0].fireAtMs, at(2026, 7, 5, 18, 0), 'the coming Sunday at 18:00');
      assert.match(plan[0].body, /3 sessions/);
      assert.match(plan[0].body, /12\.4 t/);
    },
  },
  {
    name: 'notificationPlan: an empty week gets no summary rather than a guilt trip',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, comebackNudge: false },
        weekSessionCount: 0,
        weekVolumeKg: 0,
      });
      assert.deepEqual(plan, []);
    },
  },
  {
    name: 'notificationPlan: a cardio-only week reports sessions without quoting 0 kg',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, comebackNudge: false },
        weekSessionCount: 2,
        weekVolumeKg: 0,
      });

      assert.equal(plan.length, 1);
      assert.equal(plan[0].body, 'Sessions this week: 2.');
      assert.ok(!plan[0].body.includes('0 kg'));
    },
  },
  {
    name: 'notificationPlan: Sunday evening is not carried over into next week',
    run() {
      const plan = buildNotificationPlan({
        nowMs: at(2026, 7, 5, 20, 0), // Sunday, after 18:00
        prefs: { ...BASE_PREFS, sessionReminders: false, comebackNudge: false },
        language: 'en',
        schedule: weekdaySchedule([]),
        lastSessionAtMs: null,
        weekSessionCount: 4,
        weekVolumeKg: 9000,
        latestPr: null,
        onTrainingBreak: false,
      });

      assert.deepEqual(plan, [], 'next Sunday would describe a different week');
    },
  },
  {
    name: 'notificationPlan: the record note fires the morning after the session',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, comebackNudge: false, weeklySummary: false },
        latestPr: {
          exerciseName: 'Bench press',
          weightKg: 92.5,
          reps: 3,
          achievedAtMs: at(2026, 7, 1, 18, 40),
        },
      });

      assert.equal(plan.length, 1);
      assert.equal(plan[0].category, 'record');
      assert.equal(plan[0].fireAtMs, at(2026, 7, 2, 9, 0));
      assert.match(plan[0].body, /Bench press/);
      assert.match(plan[0].body, /92\.5 kg × 3/);
    },
  },
  {
    name: 'notificationPlan: a record whose morning has passed is not resurrected',
    run() {
      const plan = planWith({
        prefs: { sessionReminders: false, comebackNudge: false, weeklySummary: false },
        latestPr: {
          exerciseName: 'Bench press',
          weightKg: 92.5,
          reps: 3,
          achievedAtMs: at(2026, 6, 28, 18, 40),
        },
      });
      assert.deepEqual(plan, []);
    },
  },
  {
    name: 'notificationPlan: quiet keeps one message a day and drops the rarest-loses',
    run() {
      const input = {
        prefs: { level: 'quiet' },
        lastSessionAtMs: at(2026, 6, 30, 18, 0),
        weekSessionCount: 2,
        weekVolumeKg: 5000,
        latestPr: {
          exerciseName: 'Squat',
          weightKg: 140,
          reps: 2,
          achievedAtMs: at(2026, 6, 30, 18, 0),
        },
      };

      const quiet = planWith(input);
      const byDay = new Map();
      quiet.forEach((item) => {
        const day = new Date(item.fireAtMs).toDateString();
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      });
      byDay.forEach((count) => assert.ok(count <= DAILY_CAP_BY_LEVEL.quiet, 'quiet caps at 1 per day'));

      // Sunday 2026-07-05 collides: the comeback nudge at 17:30 and the weekly
      // summary at 18:00 want the same single slot. The rarer one takes it.
      const sunday = quiet.filter((item) => new Date(item.fireAtMs).getDay() === 0);
      assert.equal(sunday.length, 1);
      assert.equal(sunday[0].category, 'comeback', 'a once-per-gap nudge outranks a weekly recap');
    },
  },
  {
    name: 'notificationPlan: a busy day keeps the record over the routine reminder',
    run() {
      const plan = planWith({
        prefs: { level: 'quiet', weeklySummary: false, comebackNudge: false },
        latestPr: {
          exerciseName: 'Deadlift',
          weightKg: 180,
          reps: 1,
          achievedAtMs: at(2026, 7, 2, 19, 0), // Thursday session
        },
      });

      // Friday 2026-07-03: record note at 09:00 vs the usual reminder at 17:30.
      const collisionDay = plan.filter(
        (item) => new Date(item.fireAtMs).toDateString() === new Date(at(2026, 7, 3)).toDateString(),
      );
      assert.equal(collisionDay.length, 1);
      assert.equal(collisionDay[0].category, 'record', 'a record outranks a weekly-recurring reminder');

      // The Fridays without a record still get their ordinary reminder.
      const laterFriday = plan.filter(
        (item) => new Date(item.fireAtMs).toDateString() === new Date(at(2026, 7, 10)).toDateString(),
      );
      assert.equal(laterFriday.length, 1);
      assert.equal(laterFriday[0].category, 'reminder');
    },
  },
  {
    name: 'notificationPlan: a higher level raises the cap it advertises',
    run() {
      assert.deepEqual(DAILY_CAP_BY_LEVEL, { quiet: 1, normal: 2, motivating: 3 });
    },
  },
  {
    name: 'notificationPlan: every planned key is unique so nothing schedules twice',
    run() {
      const plan = planWith({
        lastSessionAtMs: at(2026, 6, 30, 18, 0),
        weekSessionCount: 2,
        weekVolumeKg: 5000,
        latestPr: { exerciseName: 'Row', weightKg: 80, reps: 6, achievedAtMs: at(2026, 7, 1, 8, 0) },
      });

      const keys = plan.map((item) => item.key);
      assert.equal(new Set(keys).size, keys.length);
      plan.forEach((item) => {
        assert.ok(item.title.length > 0, `${item.key} needs a title`);
        assert.ok(item.body.length > 0, `${item.key} needs a body`);
      });
    },
  },
  {
    name: 'notificationPlan: the plan is ordered by fire time',
    run() {
      const plan = planWith({
        lastSessionAtMs: at(2026, 6, 30, 18, 0),
        weekSessionCount: 2,
        weekVolumeKg: 5000,
      });

      for (let index = 1; index < plan.length; index += 1) {
        assert.ok(plan[index].fireAtMs >= plan[index - 1].fireAtMs, 'sorted by fire time');
      }
    },
  },
  {
    name: 'notificationPlan: Finnish copy is used when the app is in Finnish',
    run() {
      const plan = planWith({
        language: 'fi',
        prefs: { sessionReminders: false, comebackNudge: false },
        weekSessionCount: 3,
        weekVolumeKg: 12400,
      });

      assert.equal(plan.length, 1);
      assert.match(plan[0].body, /3 treeniä/);
      assert.equal(plan[0].title, 'Viikkosi');
    },
  },
  {
    name: 'notificationPlan: a malformed reminder time falls back instead of drifting',
    run() {
      assert.deepEqual(parseReminderTime('06:45'), { hour: 6, minute: 45 });
      assert.deepEqual(parseReminderTime('25:00'), { hour: 17, minute: 30 });
      assert.deepEqual(parseReminderTime('7:5'), { hour: 17, minute: 30 });
      assert.deepEqual(parseReminderTime(null), { hour: 17, minute: 30 });
      assert.deepEqual(parseReminderTime(''), { hour: 17, minute: 30 });

      const plan = planWith({
        prefs: { reminderTime: 'nonsense', weeklySummary: false, comebackNudge: false },
      });
      assert.equal(plan[0].fireAtMs, at(2026, 7, 1, 17, 30));
    },
  },
  {
    name: 'the trial warning fires two days out, survives a break, and is never invented',
    run() {
      const DAY = 24 * 60 * 60 * 1000;
      const now = at(2026, 7, 1, 12, 0);
      const trialOf = (plan) => plan.filter((item) => item.category === 'trial');

      // No trial running, no notice. This is a promise the app made, not a
      // nudge it decided to send.
      assert.equal(trialOf(planWith()).length, 0);
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: null })).length, 0);
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: Number.NaN })).length, 0);

      // Fourteen days out: one notice, two days before the end.
      const endsAt = now + 14 * DAY;
      const notices = trialOf(planWith({ proTrialEndsAtMs: endsAt }));
      assert.equal(notices.length, 1);
      assert.equal(notices[0].fireAtMs, endsAt - 2 * DAY);
      assert.ok(notices[0].title.length > 0 && notices[0].body.length > 0);
      // Keyed on the end, so re-planning an unchanged trial schedules the same
      // alarm rather than a second one.
      assert.equal(notices[0].key, `trial:${endsAt}`);
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: endsAt }))[0].key, notices[0].key);

      // Inside the last two days there is nothing left to warn about: the
      // moment has passed, and an alarm in the past would fire at once.
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: now + DAY })).length, 0);
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: now - DAY })).length, 0);
      // Exactly on the boundary is also past: fireAtMs === now is not future.
      assert.equal(trialOf(planWith({ proTrialEndsAtMs: now + 2 * DAY })).length, 0);

      // A training break silences training. The trial runs out regardless, so
      // the notice goes anyway — and it is the only thing left in the plan.
      const onBreak = planWith({ proTrialEndsAtMs: endsAt, onTrainingBreak: true });
      assert.equal(onBreak.length, 1);
      assert.equal(onBreak[0].category, 'trial');

      // Push off is the one thing that stops it: the app cannot deliver a
      // warning to somebody who turned notifications off, and pretending
      // otherwise would be the lie.
      assert.equal(
        trialOf(planWith({ proTrialEndsAtMs: endsAt, prefs: { pushEnabled: false } })).length,
        0,
      );
    },
  },
  {
    name: 'notificationPlan: a training cycle is reminded on its own days, not on last week’s weekdays',
    run() {
      // 3 on, 1 off from Monday 14 September 2026: training days are the
      // 14th, 15th, 16th, then the 17th is rest, then 18th–20th. A weekday
      // list cannot express that, and reminders used to read the weekdays
      // setup once named — which after the first week is a different set of
      // days entirely (2026-09-16).
      const anchor = at(2026, 9, 14);
      const plan = planWith({
        nowMs: at(2026, 9, 14, 6, 0),
        schedule: cycleSchedule([true, true, true, false], anchor),
        prefs: { ...BASE_PREFS, sessionReminders: true, reminderTime: '18:00' },
      });
      const reminderDays = plan
        .filter((entry) => entry.category === 'reminder')
        .map((entry) => new Date(entry.fireAtMs).getDate());
      assert.ok(reminderDays.includes(14) && reminderDays.includes(15) && reminderDays.includes(16), reminderDays.join(','));
      assert.ok(!reminderDays.includes(17), 'the rest day gets no reminder');
      assert.ok(reminderDays.includes(18), 'and the cycle turns over');
      // Which is a different answer from the weekday list it used to use.
      const asWeekdays = planWith({
        nowMs: at(2026, 9, 14, 6, 0),
        schedule: weekdaySchedule([0, 1, 2]),
        prefs: { ...BASE_PREFS, sessionReminders: true, reminderTime: '18:00' },
      })
        .filter((entry) => entry.category === 'reminder')
        .map((entry) => new Date(entry.fireAtMs).getDate());
      assert.ok(!asWeekdays.includes(18), 'a weekday list repeats the same three days');
    },
  },
  {
    name: 'notificationPlan: the hook hands the planner the rhythm, not a list of free days',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const hook = fs
        .readFileSync(path.join(__dirname, '../../src/hooks/useScheduledNotifications.ts'), 'utf8');
      // The reader's cycle first, then the days their own plan names, and
      // only then what setup said they had free — the order itself is tested
      // in tests/lib/reminderSchedule.test.cjs, against the function the hook
      // and the settings screens share.
      // And the days taken off from the recovery sheet (2026-09-26): no
      // reminder to train on a day the reader just made a rest day.
      assert.match(hook, /return resolveReminderSchedule\(\{\s*trainingCycle: database\.preferences\.trainingCycle,\s*planEntries: activePlan\?\.entries \?\? \[\],\s*availableDays: setupAvailableDays,\s*restDayStarts: database\.preferences\.restDayStarts,\s*\}\);/);
      assert.match(hook, /schedule,/);
      assert.doesNotMatch(hook, /trainingDays: setupAvailableDays/);
    },
  },
];
