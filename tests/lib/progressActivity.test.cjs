const assert = require('node:assert/strict');

const { getProgressActivityDayStatus } = require('../../src/lib/progressActivity');
const { cycleSchedule, weekdaySchedule } = require('../../src/lib/trainingSchedule');

// A fixed week so weekday maths is readable: 2026-07-20 is a Monday.
function dayStart(dayOfMonth) {
  return new Date(2026, 6, dayOfMonth).getTime();
}

const TODAY = dayStart(23); // Thursday

function day(dayOfMonth, overrides = {}) {
  return {
    dayStart: dayStart(dayOfMonth),
    dayNumber: dayOfMonth,
    active: false,
    isToday: dayStart(dayOfMonth) === TODAY,
    inCurrentMonth: true,
    ...overrides,
  };
}

// Monday-first indexes: 0 = Monday, 3 = Thursday.
const PLAN = { schedule: weekdaySchedule([0, 3]), todayStart: TODAY };

module.exports = [
  {
    name: 'progress activity marks completed workout days from persisted activity only',
    run() {
      assert.equal(getProgressActivityDayStatus(day(20, { active: true }), PLAN), 'done');
    },
  },
  {
    name: 'progress activity does not fabricate planned days from odd calendar dates',
    run() {
      // No schedule supplied: an empty day is rest, never a missed session.
      assert.equal(getProgressActivityDayStatus(day(21)), 'rest');
    },
  },
  {
    name: 'progress activity treats outside-month cells as empty calendar space',
    run() {
      assert.equal(getProgressActivityDayStatus(day(30, { inCurrentMonth: false }), PLAN), 'outside');
    },
  },
  {
    name: 'a passed training day with no session is missed',
    run() {
      // Monday the 20th is planned and already gone.
      assert.equal(getProgressActivityDayStatus(day(20), PLAN), 'missed');
    },
  },
  {
    name: 'a future training day is upcoming, not missed',
    run() {
      // Monday the 27th is planned and still ahead.
      assert.equal(getProgressActivityDayStatus(day(27), PLAN), 'upcoming');
    },
  },
  {
    name: 'today is upcoming until it ends, never missed',
    run() {
      assert.equal(getProgressActivityDayStatus(day(23), PLAN), 'upcoming');
    },
  },
  {
    name: 'a passed rest day is rest, not missed',
    run() {
      // Tuesday the 21st is not in the plan.
      assert.equal(getProgressActivityDayStatus(day(21), PLAN), 'rest');
    },
  },
  {
    name: 'a logged session on an unplanned day still counts as done',
    run() {
      assert.equal(getProgressActivityDayStatus(day(21, { active: true }), PLAN), 'done');
    },
  },
  {
    name: 'a cycle schedule marks the same days the home calendar would',
    run() {
      // Two on, one off anchored to Monday the 20th: 20 ✓ 21 ✓ 22 rest, 23 ✓ …
      // A weekday list cannot express this rhythm — the whole reason the
      // calendar takes a schedule (2026-08-25).
      const cycle = { schedule: cycleSchedule([true, true, false], dayStart(20)), todayStart: TODAY };
      assert.equal(getProgressActivityDayStatus(day(20), cycle), 'missed');
      assert.equal(getProgressActivityDayStatus(day(22), cycle), 'rest');
      assert.equal(getProgressActivityDayStatus(day(23), cycle), 'upcoming');
      assert.equal(getProgressActivityDayStatus(day(25), cycle), 'rest');
      assert.equal(getProgressActivityDayStatus(day(26), cycle), 'upcoming');
    },
  },
  {
    name: 'without a schedule nothing is ever called missed',
    run() {
      assert.equal(getProgressActivityDayStatus(day(20), { schedule: weekdaySchedule([]), todayStart: TODAY }), 'rest');
    },
  },
  {
    name: 'without a reference day nothing is ever called missed',
    run() {
      assert.equal(getProgressActivityDayStatus(day(20), { schedule: weekdaySchedule([0]) }), 'rest');
    },
  },
  {
    name: 'the Progress calendar fills only trained days: planned ones are outlined, missed ones quiet',
    run() {
      // The 1.1.0 build painted planned and missed days the same violet as
      // trained ones, so October showed 18 filled squares beside "13 sessions"
      // (store shots, 2026-10-26). Fixed in #420; this keeps the fill tied to
      // 'done' alone.
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../../src/screens/ProgressScreen.tsx'),
        'utf8',
      );
      assert.match(source, /const training = status === 'done';/);
      assert.match(source, /const planned = status === 'upcoming';/);
      assert.match(source, /training && styles\.calendarBubbleTraining,/);
      assert.match(source, /planned && styles\.calendarBubblePlanned,/);
    },
  },
];
