const assert = require('node:assert/strict');

const {
  getHomeCarouselCalendarDays,
  getHomeDayView,
  getHomeMiniCalendarDays,
  getHomeMonthCalendar,
} = require('../../src/lib/homeCalendar');
const { cycleSchedule, weekdaySchedule } = require('../../src/lib/trainingSchedule');

module.exports = [
  {
    name: 'home mini calendar rolls from two days before today to four days after',
    run() {
      const days = getHomeMiniCalendarDays(new Date('2026-05-25T12:00:00.000Z'));

      assert.deepEqual(
        days.map((day) => day.label),
        ['SAT', 'SUN', '25/05', 'TUE', 'WED', 'THU', 'FRI'],
      );
      assert.deepEqual(
        days.map((day) => day.dateLabel),
        ['', '', '25/05', '', '', '', ''],
      );
      assert.equal(days.find((day) => day.isToday)?.weekdayLabel, 'MON');
    },
  },
  {
    name: 'home mini calendar advances one day at a time',
    run() {
      const days = getHomeMiniCalendarDays(new Date('2026-05-26T12:00:00.000Z'));

      assert.deepEqual(
        days.map((day) => day.label),
        ['SUN', 'MON', '26/05', 'WED', 'THU', 'FRI', 'SAT'],
      );
      assert.deepEqual(
        days.map((day) => day.dateLabel),
        ['', '', '26/05', '', '', '', ''],
      );
      assert.equal(days.find((day) => day.isToday)?.weekdayLabel, 'TUE');
    },
  },
  {
    name: 'home carousel calendar includes past days, today, and future days',
    run() {
      const days = getHomeCarouselCalendarDays(new Date('2026-05-25T12:00:00.000Z'));

      assert.equal(days.length, 22);
      assert.equal(days[0].weekdayLabel, 'MON');
      assert.equal(days[0].label, 'MON');
      assert.equal(days[7].weekdayLabel, 'MON');
      assert.equal(days[7].label, '25/05');
      assert.equal(days[7].dateLabel, '25/05');
      assert.equal(days[7].isToday, true);
      assert.equal(days[21].weekdayLabel, 'MON');
    },
  },
  {
    name: 'home month calendar builds a Monday-first grid around the current month',
    run() {
      // July 1, 2026 is a Wednesday -> grid starts Monday June 29 and ends Sunday August 2.
      const calendar = getHomeMonthCalendar(new Date('2026-07-08T12:00:00.000Z'));

      assert.equal(calendar.monthLabel, 'July 2026');
      assert.deepEqual(calendar.weekdayLabels, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      assert.equal(calendar.weeks.length, 5);
      assert.ok(calendar.weeks.every((week) => week.length === 7));

      assert.equal(calendar.weeks[0][0].dayOfMonth, 29);
      assert.equal(calendar.weeks[0][0].inMonth, false);
      assert.equal(calendar.weeks[0][0].weekdayIndex, 0);
      assert.equal(calendar.weeks[0][2].dayOfMonth, 1);
      assert.equal(calendar.weeks[0][2].inMonth, true);
      assert.equal(calendar.weeks[4][6].dayOfMonth, 2);
      assert.equal(calendar.weeks[4][6].inMonth, false);

      const today = calendar.weeks.flat().filter((day) => day.isToday);
      assert.equal(today.length, 1);
      assert.equal(today[0].dayOfMonth, 8);
      assert.equal(today[0].inMonth, true);
      assert.equal(today[0].weekdayIndex, 2);
    },
  },
  {
    name: 'home month calendar fits an exact four-week month without spill days',
    run() {
      // February 2027 starts on a Monday and has 28 days -> exactly 4 full weeks.
      const calendar = getHomeMonthCalendar(new Date('2027-02-15T12:00:00.000Z'));

      assert.equal(calendar.monthLabel, 'February 2027');
      assert.equal(calendar.weeks.length, 4);
      assert.ok(calendar.weeks.flat().every((day) => day.inMonth));
      assert.equal(calendar.weeks[0][0].dayOfMonth, 1);
      assert.equal(calendar.weeks[3][6].dayOfMonth, 28);
    },
  },
  {
    name: 'home day view shows recovery when selected day is outside the plan rhythm',
    run() {
      const [monday, tuesday, wednesday] = getHomeMiniCalendarDays(new Date('2026-05-25T12:00:00.000Z')).slice(2, 5);
      // Each day has a lift: a day with none hands its slot on (2026-09-26),
      // and this case is about the rhythm, not about empty days.
      const sessions = [
        { id: 'upper', title: 'Upper', duration: '~50 min', exercises: [{ name: 'Bench Press', setsLabel: '3 sets' }], hiddenExerciseCount: 0 },
        { id: 'lower', title: 'Lower', duration: '~50 min', exercises: [{ name: 'Back Squat', setsLabel: '3 sets' }], hiddenExerciseCount: 0 },
      ];

      assert.equal(getHomeDayView(monday, weekdaySchedule([0, 2, 4]), sessions).kind, 'training');
      assert.equal(getHomeDayView(monday, weekdaySchedule([0, 2, 4]), sessions).ctaEyebrow, 'NO EXCUSES');
      assert.equal(getHomeDayView(monday, weekdaySchedule([0, 2, 4]), sessions).ctaTitle, 'JUST RESULTS');
      assert.equal(getHomeDayView(tuesday, weekdaySchedule([0, 2, 4]), sessions).kind, 'recovery');
      assert.equal(getHomeDayView(wednesday, weekdaySchedule([0, 2, 4]), sessions).session?.id, 'lower');
      assert.equal(getHomeDayView(wednesday, weekdaySchedule([0, 2, 4]), sessions).ctaEyebrow, 'TRAINING');
      assert.equal(getHomeDayView(wednesday, weekdaySchedule([0, 2, 4]), sessions).ctaTitle, 'TODAY');
    },
  },
  {
    name: 'home day view treats Tuesday as recovery for a two day plan',
    run() {
      const [, , , tuesday] = getHomeMiniCalendarDays(new Date('2026-05-25T12:00:00.000Z'));
      const sessions = [
        {
          id: 'minimal_a',
          title: 'Minimal A',
          duration: '~45 min',
          exercises: [{ name: 'Bodyweight Squat', setsLabel: '3 sets' }],
          hiddenExerciseCount: 0,
        },
        {
          id: 'minimal_b',
          title: 'Minimal B',
          duration: '~45 min',
          exercises: [{ name: 'Incline Push-Up', setsLabel: '3 sets' }],
          hiddenExerciseCount: 0,
        },
      ];
      const view = getHomeDayView(tuesday, weekdaySchedule([0, 3]), sessions);

      assert.equal(tuesday.weekdayLabel, 'TUE');
      assert.equal(view.kind, 'recovery');
      assert.equal(view.session, null);
      assert.equal(view.ctaEyebrow, 'RECOVERY');
    },
  },
  {
    name: 'the day row crosses a clock change without repeating a day',
    run() {
      // Finland falls back on Sunday 25 October 2026, a 25-hour day. Stepped by
      // a fixed 24 hours the row drew Sunday twice, never drew the Monday after
      // it, and gave every later day the weekday before it — so Home offered
      // the wrong session for a day it had already shown.
      const originalTimezone = process.env.TZ;
      process.env.TZ = 'Europe/Helsinki';

      try {
        const days = getHomeCarouselCalendarDays(new Date(2026, 9, 20, 12, 0, 0), {
          daysBefore: 2,
          daysAfter: 10,
        });
        const dates = days.map((day) => new Date(day.dayStart).getDate());

        assert.deepEqual(dates, [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
        days.forEach((day) => {
          const date = new Date(day.dayStart);
          assert.equal(date.getHours(), 0, `${date.getDate()} October does not start at midnight`);
          // 0 = Monday, and it has to describe the day it is attached to.
          assert.equal(day.weekdayIndex, date.getDay() === 0 ? 6 : date.getDay() - 1);
        });
      } finally {
        if (originalTimezone === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTimezone;
        }
      }
    },
  },
];
