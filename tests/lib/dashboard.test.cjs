const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { createEmptyDatabase } = require('../../src/data/seed');
const {
  getCalendarWeekStartBefore,
  getCalendarWeekStartTimestamp,
  getCurrentWeekStreak,
  getMonthlyActivityCalendar,
  getRecentActivityStrip,
  getSessionsLast30Days,
  getSessionsThisWeek,
} = require('../../src/lib/completedSessions');
const dashboard = require('../../src/lib/dashboard');
const { getHomeSummary } = dashboard;

function createSession(id, performedAt, workoutTemplateId = 'workout_upper', workoutNameSnapshot = 'Upper') {
  return { id, workoutTemplateId, workoutNameSnapshot, performedAt };
}

function createCompletedLog(sessionId, orderIndex = 0, weight = 100, reps = [5]) {
  return {
    id: `${sessionId}_log_${orderIndex}`,
    sessionId,
    exerciseTemplateId: 'exercise_upper_bench',
    exerciseNameSnapshot: 'Bench Press',
    weight,
    repsPerSet: reps,
    sets: reps.map((rep, index) => ({
      orderIndex: index,
      weight,
      reps: rep,
      kind: 'working',
      outcome: 'completed',
    })),
    tracked: true,
    orderIndex,
    skipped: false,
  };
}

module.exports = [
  {
    name: 'the week streak survives a clock change',
    run() {
      withHelsinkiClocks(() => {
        // Finland moves its clocks on Sunday 29 March 2026, inside the week of
        // Monday 23 March. That week is 167 hours long, so stepping back a flat
        // WEEK_MS from Monday 30 March lands on Sunday 22 March at 23:00 — a
        // timestamp no week start can equal, because week starts are local
        // midnights. Three unbroken weeks then read as one.
        const database = createEmptyDatabase();
        database.workoutSessions = [
          createSession('session_week_16', '2026-03-17T10:00:00'),
          createSession('session_week_23', '2026-03-24T10:00:00'),
          createSession('session_week_30', '2026-03-31T10:00:00'),
        ];
        database.exerciseLogs = [
          createCompletedLog('session_week_16'),
          createCompletedLog('session_week_23'),
          createCompletedLog('session_week_30'),
        ];

        assert.equal(getCurrentWeekStreak(database, new Date(2026, 3, 1, 12, 0, 0)), 3);

        // Autumn is the same fault with the cursor an hour the other way:
        // clocks go back 25 October 2026, so the week of 26 October is 169
        // hours after the week of 19 October.
        const autumn = createEmptyDatabase();
        autumn.workoutSessions = [
          createSession('session_week_12_oct', '2026-10-13T10:00:00'),
          createSession('session_week_19_oct', '2026-10-20T10:00:00'),
          createSession('session_week_26_oct', '2026-10-27T10:00:00'),
        ];
        autumn.exerciseLogs = [
          createCompletedLog('session_week_12_oct'),
          createCompletedLog('session_week_19_oct'),
          createCompletedLog('session_week_26_oct'),
        ];

        assert.equal(getCurrentWeekStreak(autumn, new Date(2026, 9, 28, 12, 0, 0)), 3);
      });
    },
  },
  {
    name: 'last week is still last week after a clock change',
    run() {
      withHelsinkiClocks(() => {
        // Same 167-hour week: the previous-week key computed by fixed
        // milliseconds matches nothing, so every "vs last week" figure reads
        // zero and the delta shows a gain the reader did not make.
        const database = createEmptyDatabase();
        database.workoutSessions = [
          createSession('session_previous_week', '2026-03-24T10:00:00'),
          createSession('session_current_week', '2026-03-31T10:00:00'),
        ];
        database.exerciseLogs = [
          createCompletedLog('session_previous_week'),
          createCompletedLog('session_current_week'),
        ];

        // The summary's own week snapshot went with the dead rotation
        // (duplicate sweep 13, 2026-10-12); the step it relied on is asked
        // directly, the way every surviving "last week" is computed.
        const currentWeekStart = getCalendarWeekStartTimestamp(new Date(2026, 3, 1, 12, 0, 0));
        const weekOf = (session) => getCalendarWeekStartTimestamp(session.performedAt);
        assert.equal(weekOf(database.workoutSessions[1]), currentWeekStart);
        assert.equal(weekOf(database.workoutSessions[0]), getCalendarWeekStartBefore(currentWeekStart));
      });
    },
  },
  {
    name: 'completing one workout this week results in Current Streak = 1',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [createSession('session_this_week', '2026-03-18T18:00:00.000Z')];
      database.exerciseLogs = [createCompletedLog('session_this_week')];

      const now = new Date('2026-03-19T12:00:00.000Z');
      assert.equal(getCurrentWeekStreak(database, now), 1);
      assert.equal(getSessionsThisWeek(database, now), 1);
      assert.equal(getSessionsLast30Days(database, now), 1);
    },
  },
  {
    name: 'workouts in three consecutive active weeks result in streak = 3',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [
        createSession('session_week_1', '2026-03-18T18:00:00.000Z'),
        createSession('session_week_2', '2026-03-11T18:00:00.000Z'),
        createSession('session_week_3', '2026-03-04T18:00:00.000Z'),
      ];
      database.exerciseLogs = [
        createCompletedLog('session_week_1'),
        createCompletedLog('session_week_2'),
        createCompletedLog('session_week_3'),
      ];

      const now = new Date('2026-03-19T12:00:00.000Z');
      assert.equal(getCurrentWeekStreak(database, now), 3);
      assert.equal(getSessionsThisWeek(database, now), 1);
      assert.equal(getSessionsLast30Days(database, now), 3);
    },
  },
  {
    /*
     * This used to pin the opposite: an empty current week read as 0. That
     * is a counter that resets every Monday morning until the first session,
     * which the Progress calendar and the lifetime summary already refused
     * to be — so Home, Progress and Milestones showed three numbers for one
     * log (audit round 4, 2026-09-20). The week that is not over yet does
     * not break the run; a week that IS over and empty does.
     */
    name: 'an empty current week does not break the streak; an empty finished week does',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [
        createSession('session_last_week', '2026-03-11T18:00:00.000Z'),
        createSession('session_two_weeks_ago', '2026-03-04T18:00:00.000Z'),
      ];
      database.exerciseLogs = [createCompletedLog('session_last_week'), createCompletedLog('session_two_weeks_ago')];

      const now = new Date('2026-03-19T12:00:00.000Z');
      assert.equal(getCurrentWeekStreak(database, now), 2, 'Thursday of an empty week: last week and the one before still count');
      assert.equal(getCurrentWeekStreak(database, new Date('2026-03-26T12:00:00.000Z')), 0, 'a whole empty week has passed: the run is over');
      assert.equal(getSessionsThisWeek(database, now), 0);
      assert.equal(getSessionsLast30Days(database, now), 2);
    },
  },
  {
    name: 'duplicate completed-session records do not inflate streak or weekly session counts',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [
        createSession('session_primary', '2026-03-18T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_duplicate', '2026-03-18T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_last_week', '2026-03-11T18:00:00.000Z', 'workout_upper', 'Upper'),
      ];
      database.exerciseLogs = [
        createCompletedLog('session_primary'),
        createCompletedLog('session_duplicate'),
        createCompletedLog('session_last_week'),
      ];

      const now = new Date('2026-03-19T12:00:00.000Z');
      assert.equal(getCurrentWeekStreak(database, now), 2);
      assert.equal(getSessionsThisWeek(database, now), 1);
      assert.equal(getSessionsLast30Days(database, now), 2);
    },
  },
  {
    name: 'monthly activity calendar marks completed dates once even with duplicate sessions',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [
        createSession('session_primary', '2026-03-22T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_duplicate', '2026-03-22T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_previous', '2026-03-16T18:00:00.000Z', 'workout_upper', 'Upper'),
      ];
      database.exerciseLogs = [
        createCompletedLog('session_primary'),
        createCompletedLog('session_duplicate'),
        createCompletedLog('session_previous'),
      ];

      const now = new Date('2026-03-22T12:00:00.000Z');
      const calendar = getMonthlyActivityCalendar(database, now);
      const activeDays = calendar.weeks.flat().filter((day) => day.active);
      const today = calendar.weeks.flat().find((day) => day.isToday);

      assert.equal(calendar.monthLabel, 'maaliskuu 2026');
      assert.equal(activeDays.length, 2);
      assert.deepEqual(
        activeDays.map((day) => day.dayNumber),
        [16, 22],
      );
      assert.equal(today?.dayNumber, 22);
      assert.equal(today?.isToday, true);
    },
  },
  {
    name: 'recent activity strip stays ordered and deduplicated',
    run() {
      const database = createEmptyDatabase();
      database.workoutSessions = [
        createSession('session_primary', '2026-03-22T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_duplicate', '2026-03-22T18:00:00.000Z', 'workout_upper', 'Upper'),
        createSession('session_previous', '2026-03-20T18:00:00.000Z', 'workout_upper', 'Upper'),
      ];
      database.exerciseLogs = [
        createCompletedLog('session_primary'),
        createCompletedLog('session_duplicate'),
        createCompletedLog('session_previous'),
      ];

      const now = new Date('2026-03-22T12:00:00.000Z');
      const strip = getRecentActivityStrip(database, now, 5);
      const activeDays = strip.filter((day) => day.active);
      const today = strip.find((day) => day.isToday);

      assert.equal(strip.length, 5);
      assert.deepEqual(
        strip.map((day) => day.dayNumber),
        [18, 19, 20, 21, 22],
      );
      assert.deepEqual(
        activeDays.map((day) => day.dayNumber),
        [20, 22],
      );
      assert.equal(today?.dayNumber, 22);
      assert.equal(today?.weekdayLabel, 'su');
    },
  },
  {
    name: 'recent activity strip keeps a day trained before a clock change',
    run() {
      // Finland moves its clocks on 29 March 2026, so a strip ending 5 April
      // spans a 23-hour day. Built from fixed 24-hour chunks, every day before
      // the change lands at 01:00 instead of midnight and matches nothing.
      withHelsinkiClocks(() => {
        const database = createEmptyDatabase();
        database.workoutSessions = [
          createSession('session_before_dst', new Date(2026, 2, 20, 18, 0, 0).toISOString()),
        ];
        database.exerciseLogs = [createCompletedLog('session_before_dst')];

        const strip = getRecentActivityStrip(database, new Date(2026, 3, 5, 12, 0, 0), 21);

        assert.equal(strip.find((day) => day.dayNumber === 20)?.active, true);
        strip.forEach((day) => {
          assert.equal(new Date(day.dayStart).getHours(), 0);
        });
      });
    },
  },
  {
    name: 'the 30-day window holds its edge across a clock change, both directions',
    run() {
      // Finland moves its clocks on 29 March 2026, so the thirty days ending
      // 10 April contain a 23-hour day and span 719 real hours, not 720.
      // Subtracting 30 * DAY_MS therefore starts the window at 11:00 rather
      // than 12:00 and counts a session that is thirty days and half an hour
      // old — older than the figure claims to cover.
      withHelsinkiClocks(() => {
        // Without this the test is vacuous: under UTC there is no clock change,
        // the window is a flat 720 hours, and the assertions below pass against
        // the very arithmetic they exist to reject. A runner that ignores a
        // mid-process TZ override should fail here rather than go quietly green.
        assert.notEqual(
          new Date(2026, 3, 10).getTimezoneOffset(),
          new Date(2026, 2, 10).getTimezoneOffset(),
          'TZ override did not take effect, so this test proves nothing',
        );

        // Spring: the thirty days ending 10 April span 719 real hours, so
        // subtracting 720 starts the window at 11:00 and counts a session that
        // is thirty days and half an hour old.
        const spring = createEmptyDatabase();
        spring.workoutSessions = [
          createSession('session_just_outside', new Date(2026, 2, 11, 11, 30, 0).toISOString()),
          createSession('session_just_inside', new Date(2026, 2, 11, 12, 30, 0).toISOString()),
        ];
        spring.exerciseLogs = [
          createCompletedLog('session_just_outside'),
          createCompletedLog('session_just_inside'),
        ];

        assert.equal(getSessionsLast30Days(spring, new Date(2026, 3, 10, 12, 0, 0)), 1);

        // Autumn is the same fault in the other direction, and the one a reader
        // would not guess: clocks go back 25 October 2026, so the thirty days
        // ending 20 November span 721 hours and subtracting 720 starts the
        // window at 13:00 — dropping a session that is inside thirty days.
        const autumn = createEmptyDatabase();
        autumn.workoutSessions = [
          createSession('session_inside_autumn', new Date(2026, 9, 21, 12, 30, 0).toISOString()),
        ];
        autumn.exerciseLogs = [createCompletedLog('session_inside_autumn')];

        assert.equal(getSessionsLast30Days(autumn, new Date(2026, 10, 20, 12, 0, 0)), 1);
      });
    },
  },
  {
    // Duplicate sweep 13 (D5-5, 2026-10-12): dashboard kept its own rotation
    // (getNextWorkoutCandidate) and a lifting-only week snapshot, built on
    // every Home summary and read by nothing. The rotation had drifted from
    // lib/planRotation — on a plan whose entries name no session it offered
    // entry 2 for ever — so the next person to wire it would have wired the
    // bug. The rotation is planRotation's alone (tests/lib/planRotation*).
    name: 'the Home summary carries no rotation and no week snapshot of its own',
    run() {
      assert.equal(dashboard.getNextWorkoutCandidate, undefined);
      const summary = getHomeSummary(createEmptyDatabase(), 'kg', new Date(2026, 9, 12, 12, 0, 0));
      assert.equal('nextWorkout' in summary, false);
      assert.equal('weeklySnapshot' in summary, false);
    },
  },
];
