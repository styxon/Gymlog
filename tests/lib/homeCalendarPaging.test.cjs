const assert = require('node:assert/strict');

const { getHomeMonthCalendar } = require('../../src/lib/homeCalendar');

// Local noon keeps the assertions clear of timezone edges.
const JAN_31 = new Date(2026, 0, 31, 12, 0, 0);

module.exports = [
  {
    name: 'month paging moves whole months without overflowing short months',
    run() {
      // Naive date arithmetic turns 31 January + 1 month into 3 March.
      assert.equal(getHomeMonthCalendar(JAN_31, 'en', 0).monthLabel, 'January 2026');
      assert.equal(getHomeMonthCalendar(JAN_31, 'en', 1).monthLabel, 'February 2026');
      assert.equal(getHomeMonthCalendar(JAN_31, 'en', 2).monthLabel, 'March 2026');
      assert.equal(getHomeMonthCalendar(JAN_31, 'en', -1).monthLabel, 'December 2025');
      assert.equal(getHomeMonthCalendar(JAN_31, 'en', -13).monthLabel, 'December 2024');
    },
  },
  {
    name: 'today is only inside the month that actually contains it',
    run() {
      const current = getHomeMonthCalendar(JAN_31, 'en', 0);
      const todays = current.weeks.flat().filter((day) => day.isToday && day.inMonth);
      assert.equal(todays.length, 1);
      assert.equal(todays[0].dayOfMonth, 31);

      // A neighbouring month's grid may still show today as a spill-over day —
      // that cell is genuinely today — but never as one of its own days.
      for (const offset of [-2, -1, 1, 2]) {
        const paged = getHomeMonthCalendar(JAN_31, 'en', offset);
        assert.equal(
          paged.weeks.flat().filter((day) => day.isToday && day.inMonth).length,
          0,
          `month offset ${offset} should not claim one of its own days is today`,
        );
      }
    },
  },
  {
    name: 'a paged month still builds a full Monday-first grid',
    run() {
      const february = getHomeMonthCalendar(JAN_31, 'en', 1);

      assert.deepEqual(february.weekdayLabels, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
      for (const week of february.weeks) {
        assert.equal(week.length, 7);
      }

      const inMonth = february.weeks.flat().filter((day) => day.inMonth);
      assert.equal(inMonth.length, 28);
      assert.equal(inMonth[0].dayOfMonth, 1);
      assert.equal(inMonth[inMonth.length - 1].dayOfMonth, 28);
    },
  },
  {
    name: 'the month label follows the app language',
    run() {
      // Lowercase: Finnish writes month names lowercase, headings included.
      assert.equal(getHomeMonthCalendar(JAN_31, 'fi', 0).monthLabel, 'tammikuu 2026');
      assert.equal(getHomeMonthCalendar(JAN_31, 'fi', 1).monthLabel, 'helmikuu 2026');
    },
  },
];
