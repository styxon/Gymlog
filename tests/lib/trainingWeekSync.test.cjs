const assert = require('node:assert/strict');

const {
  planLabelsForProgramme,
  planLabelsFromWeekdays,
  rotateLabelsForNextSession,
  weekdaysFromPlanLabels,
} = require('../../.test-dist/lib/trainingWeekSync.js');
const { buildSavedOnboardingWorkoutPlan } = require('../../.test-dist/app/onboardingHandoff.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');

module.exports = [
  {
    name: "rotateLabelsForNextSession: today's session done, the next one starts on the next training day",
    run() {
      // Bug hunt, 2026-10-04. Mon/Wed/Fri, session 0 trained on Monday, rhythm
      // edited on Monday: next is session 1, and the forecast puts it on
      // Wednesday. The labels put it on Monday because today counted as open.
      const monday = new Date(2026, 7, 24, 12);
      const done = rotateLabelsForNextSession(["mon", "wed", "fri"], 1, monday, true);
      assert.equal(done[1], "wed", "session 1 sits on Wednesday");
      // Not trained yet: today is still open, as before.
      assert.equal(rotateLabelsForNextSession(["mon", "wed", "fri"], 1, monday, false)[1], "mon");
      // Sunday, trained: nothing left this week, the week wraps to Monday.
      const sunday = new Date(2026, 7, 30, 12);
      assert.equal(rotateLabelsForNextSession(["mon", "wed", "sun"], 0, sunday, true)[0], "mon");
    },
  },
  {
    name: 'reads the weekdays a plan names, Monday first and without repeats',
    run() {
      assert.deepEqual(
        weekdaysFromPlanLabels([{ label: 'fri' }, { label: 'mon' }, { label: 'wed' }]),
        ['mon', 'wed', 'fri'],
      );
      // Case and padding come from stored data, not from a picker.
      assert.deepEqual(weekdaysFromPlanLabels([{ label: ' Mon ' }, { label: 'MON' }]), ['mon']);
    },
  },
  {
    name: 'reads nothing from a plan that labels entries by position',
    run() {
      // "Day 1" is not a weekday. Returning the labelled half would tell the
      // rest of the app a rhythm the plan does not actually keep.
      assert.deepEqual(weekdaysFromPlanLabels([{ label: 'mon' }, { label: 'Day 2' }]), []);
      assert.deepEqual(weekdaysFromPlanLabels([{ label: null }]), []);
      assert.deepEqual(weekdaysFromPlanLabels([]), []);
    },
  },
  {
    name: 'places every session when there are days enough',
    run() {
      assert.deepEqual(planLabelsFromWeekdays(3, ['mon', 'wed', 'fri']), ['mon', 'wed', 'fri']);
      // Chosen days arrive in tap order; the plan gets them in week order.
      assert.deepEqual(planLabelsFromWeekdays(2, ['sat', 'tue']), ['tue', 'sat']);
    },
  },
  {
    name: 'spreads a short programme across a wide week instead of stacking it',
    run() {
      // Two sessions across five open days land apart, the same spread the
      // week strip derives with — not Monday and Tuesday.
      assert.deepEqual(planLabelsFromWeekdays(2, ['mon', 'tue', 'wed', 'thu', 'fri']), ['mon', 'thu']);
    },
  },
  {
    name: 'refuses to write when the sessions do not fit the chosen days',
    run() {
      // Four sessions, three days: repeating a day to make the count fit would
      // hand back a week the reader never chose. The caller keeps the old
      // rhythm and stores the availability only.
      assert.equal(planLabelsFromWeekdays(4, ['mon', 'wed', 'fri']), null);
      assert.equal(planLabelsFromWeekdays(1, []), null);
      assert.equal(planLabelsFromWeekdays(0, ['mon']), null);
    },
  },
  {
    name: 'survives a round trip in both directions',
    run() {
      const days = ['tue', 'thu', 'sat'];
      const labels = planLabelsFromWeekdays(3, days);
      assert.deepEqual(labels, days);
      assert.deepEqual(
        weekdaysFromPlanLabels(labels.map((label) => ({ label }))),
        days,
      );
    },
  },
  {
    name: 'a programme keeps its own number of days when it is taken into use',
    run() {
      // The bug this pins: adoption read availability alone and fell back to a
      // three-day default, so every programme — one session or six — ran as a
      // three-day programme.
      assert.equal(planLabelsForProgramme(6, []).length, 6);
      assert.equal(planLabelsForProgramme(1, []).length, 1);
      assert.equal(planLabelsForProgramme(4, []).length, 4);
      // No day is ever repeated to make the count fit.
      const six = planLabelsForProgramme(6, []);
      assert.equal(new Set(six).size, 6);
    },
  },
  {
    name: 'availability places the days when it can hold the programme',
    run() {
      assert.deepEqual(planLabelsForProgramme(2, ['tue', 'thu', 'sat']), ['tue', 'sat']);
      assert.deepEqual(planLabelsForProgramme(1, ['wed', 'sun']), ['wed']);
      // Three open days cannot hold six sessions, so the programme's own week
      // wins rather than being halved in silence.
      assert.equal(planLabelsForProgramme(6, ['mon', 'wed', 'fri']).length, 6);
    },
  },
  {
    name: 'the cycle starts from the first session, on the first day not already gone',
    run() {
      // Reported mid-week 2026-08-26: adopting a Mon/Thu plan on a Wednesday
      // put session one on Monday, a day already spent, so Home offered
      // session TWO and the programme began in the middle of itself.
      const wednesday = new Date(2026, 7, 26); // Wed 26 Aug 2026
      const monday = new Date(2026, 7, 24);
      const sunday = new Date(2026, 7, 30);

      // Without a date, nothing moves — the raw pattern is still the default.
      assert.deepEqual(planLabelsForProgramme(2, []), ['mon', 'thu']);

      // On Wednesday the first upcoming day is Thursday, so session one goes
      // there and Monday follows. The PATTERN is untouched; only which
      // session lands on which of its days changes.
      assert.deepEqual(planLabelsForProgramme(2, [], wednesday), ['thu', 'mon']);

      // Adopt on a training day and it starts today.
      assert.deepEqual(planLabelsForProgramme(2, [], monday), ['mon', 'thu']);

      // Adopt on a rest day past the last one and the week wraps to the
      // first day, which is what a week does.
      assert.deepEqual(planLabelsForProgramme(2, [], sunday), ['mon', 'thu']);

      // Days the reader chose are rotated the same way.
      assert.deepEqual(
        planLabelsForProgramme(3, ['mon', 'wed', 'fri'], new Date(2026, 7, 27)),
        ['fri', 'mon', 'wed'],
        'a Thursday adoption of a Mon/Wed/Fri plan opens on Friday',
      );

      // One session has nothing to rotate, and must not be reordered into
      // something else by accident.
      assert.deepEqual(planLabelsForProgramme(1, ['thu'], wednesday), ['thu']);
    },
  },
  {
    name: "moving a day keeps the next session on the next training day",
    run() {
      // Sunday 30 Aug 2026. The reader trains wed/fri/sun and has finished
      // nothing, so session one is next and Sunday is the first day left.
      const sunday = new Date(2026, 7, 30);
      assert.deepEqual(
        rotateLabelsForNextSession(["wed", "fri", "sun"], 0, sunday),
        ["sun", "wed", "fri"],
      );

      // Two sessions done, so session THREE is next — and it, not session
      // one, is what today gets. Writing the spread Monday-first instead is
      // what let Home offer one session and print another one's day on it.
      assert.deepEqual(
        rotateLabelsForNextSession(["wed", "fri", "sun"], 2, sunday),
        ["wed", "fri", "sun"],
        "session three takes Sunday; the other two follow in programme order",
      );

      // Every training day of the week has gone: the week wraps to its own
      // first day rather than refusing to place anything.
      assert.deepEqual(
        rotateLabelsForNextSession(["mon", "wed", "fri"], 0, sunday),
        ["mon", "wed", "fri"],
      );

      // A one-session programme has nothing to rotate and must not be
      // reordered into something else by accident.
      assert.deepEqual(rotateLabelsForNextSession(["thu"], 0, sunday), ["thu"]);

      // An out-of-range pointer is folded rather than throwing: it arrives
      // from a rotation that is modulo the entry count anyway.
      assert.deepEqual(
        rotateLabelsForNextSession(["wed", "fri", "sun"], 3, sunday),
        rotateLabelsForNextSession(["wed", "fri", "sun"], 0, sunday),
      );

      // Days in ANY order. "The first day that has not gone" is only findable
      // against the week's own order, and reading it off the caller's order
      // returns a confident wrong answer rather than an error: asked on a
      // Wednesday, a raw scan of sun/wed/fri matches Sunday first (6 >= 2) and
      // concludes there is nothing to move — on a day that is a training day.
      const wednesday = new Date(2026, 7, 26);
      assert.deepEqual(
        rotateLabelsForNextSession(["sun", "wed", "fri"], 0, wednesday),
        ["wed", "fri", "sun"],
        "already-rotated days still open on today",
      );
      assert.deepEqual(
        rotateLabelsForNextSession(["sun", "wed", "fri"], 0, sunday),
        rotateLabelsForNextSession(["wed", "fri", "sun"], 0, sunday),
        "the answer depends on the week, not on how the caller held it",
      );
    },
  },
  {
    name: 'the questionnaire places its days the way adoption does, not from Monday',
    run() {
      // Finished on a Thursday. Home offers the session that comes next —
      // today — and the calendar reads these labels, so dealing them out from
      // the reader's first day put day 1 on Monday and the two disagreed.
      const thursday = new Date(2026, 8, 17, 18, 0, 0);
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        scheduleMode: 'self_managed',
        availableDays: ['mon', 'wed', 'fri'],
        daysPerWeek: 3,
      };
      const realDate = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends realDate {
        constructor(...args) {
          super(...(args.length ? args : [thursday.getTime()]));
        }
        static now() {
          return thursday.getTime();
        }
      };
      try {
        const plan = buildSavedOnboardingWorkoutPlan(selection, 'tpl_copy', ['d1', 'd2', 'd3'], 'fi');
        assert.deepEqual(plan.entries.map((entry) => entry.label), ['fri', 'mon', 'wed']);
        // Same answer adoption gives for the same day.
        assert.deepEqual(planLabelsForProgramme(3, ['mon', 'wed', 'fri'], thursday), ['fri', 'mon', 'wed']);
      } finally {
        // eslint-disable-next-line no-global-assign
        Date = realDate;
      }
    },
  },
];
