const assert = require('node:assert/strict');

const {
  blockWeekOfSession,
  blockWeekTally,
  buildHomePlanProgress,
} = require('../../src/lib/homePlanProgress');
const { countSessionsSince } = require('../../src/lib/programCompletion');
const { getCanonicalCompletedSessions } = require('../../src/lib/completedSessions');
const { createEmptyDatabase } = require('../../src/data/seed');

module.exports = [
  {
    name: 'home plan progress starts visible before the first workout',
    run() {
      assert.deepEqual(
        buildHomePlanProgress({
          completedSessions: 0,
          sessionsPerWeek: 2,
          totalWeeks: 8,
        }),
        {
          weekLabel: 'Week 1 of 8',
          progressPercent: 1,
          weekProgressLabel: 'Week 1 · 0 of 2 done',
          weekProgressPercent: 0,
          currentWeek: 1,
          totalWeeks: 8,
          sessionsDone: 0,
          sessionsTotal: 16,
        },
      );
    },
  },
  {
    name: 'home plan progress advances by completed workouts across planned sessions',
    run() {
      assert.deepEqual(
        buildHomePlanProgress({
          completedSessions: 1,
          sessionsPerWeek: 2,
          totalWeeks: 8,
        }),
        {
          weekLabel: 'Week 1 of 8',
          progressPercent: 6,
          weekProgressLabel: 'Week 1 · 1 of 2 done',
          weekProgressPercent: 50,
          currentWeek: 1,
          totalWeeks: 8,
          sessionsDone: 1,
          sessionsTotal: 16,
        },
      );

      assert.deepEqual(
        buildHomePlanProgress({
          completedSessions: 2,
          sessionsPerWeek: 2,
          totalWeeks: 8,
        }),
        {
          weekLabel: 'Week 2 of 8',
          progressPercent: 13,
          weekProgressLabel: 'Week 2 · 0 of 2 done',
          weekProgressPercent: 0,
          currentWeek: 2,
          totalWeeks: 8,
          sessionsDone: 2,
          sessionsTotal: 16,
        },
      );

      assert.deepEqual(
        buildHomePlanProgress({
          completedSessions: 16,
          sessionsPerWeek: 2,
          totalWeeks: 8,
        }),
        {
          weekLabel: 'Week 8 of 8',
          progressPercent: 100,
          weekProgressLabel: 'Week 8 · 2 of 2 done',
          weekProgressPercent: 100,
          currentWeek: 8,
          totalWeeks: 8,
          sessionsDone: 16,
          sessionsTotal: 16,
        },
      );
    },
  },
  {
    name: 'the summary names the week the session it summarises filled',
    run() {
      // Asked through blockWeekTally since 2026-09-21: the week rule is
      // private to it now, so a week label and the count beside it cannot
      // come from two rules again. Same cases, same answers.
      const week = (sessionsDone, sessionsTotal = 24, totalWeeks = 8) =>
        blockWeekTally({ sessionsDone, sessionsTotal, totalWeeks }).week;

      // A three-day plan over eight weeks. The third session of week 1 is
      // saved, so Home is already in week 2 — but the summary is about that
      // third session, and it belongs to week 1. This read "WEEK 2 · 3/3".
      assert.equal(week(3), 1);
      assert.equal(buildHomePlanProgress({ completedSessions: 3, sessionsPerWeek: 3, totalWeeks: 8 }).currentWeek, 2);

      // Mid-week the two agree: nothing has rolled over.
      assert.equal(week(4), 2);
      assert.equal(week(1), 1);

      // The block's last session belongs to the block's last week, not to a
      // ninth week that does not exist.
      assert.equal(week(24), 8);

      // Nothing logged yet, and unusable numbers, both answer week 1 rather
      // than dividing by zero.
      assert.equal(week(0), 1);
      assert.equal(week(2, 0, 0), 1);
    },
  },
  {
    name: 'the week pill counts the block, as Home does, not Monday to Sunday',
    run() {
      // The audit's plan (2026-09-20): taken up on a Thursday, three days a
      // week, eight weeks. After each save the pill read, by the calendar,
      // 1/3 · 2/3 · 1/3 · 2/3 · 3/3 · 1/3 — Monday's session, which finished
      // block week 1, read "WEEK 1 · 1/3", and Friday's "WEEK 2 · 3/3" with
      // week 2 two sessions in. Home said the opposite both times.
      const expected = [
        { week: 1, done: 1 }, // Thu
        { week: 1, done: 2 }, // Sat
        { week: 1, done: 3 }, // Mon: week 1 is finished, as Home says
        { week: 2, done: 1 }, // Wed
        { week: 2, done: 2 }, // Fri: week 2 is two in, as Home says
        { week: 2, done: 3 }, // Mon
      ];
      expected.forEach((reading, index) => {
        const sessionsDone = index + 1;
        const home = buildHomePlanProgress({ language: 'fi', completedSessions: sessionsDone, sessionsPerWeek: 3 });
        const pill = blockWeekTally({ sessionsDone, sessionsTotal: home.sessionsTotal, totalWeeks: home.totalWeeks });
        assert.deepEqual(pill, { ...reading, target: 3 }, `after session ${sessionsDone}`);
        // Whatever week the pill names holds exactly what Home's block does.
        assert.equal(pill.done, home.sessionsDone - (pill.week - 1) * 3);
      });
    },
  },
  {
    name: 'the finish view and the summary read the same week for the same session',
    run() {
      // Before the save the log does not hold the session in hand; after it,
      // it does. Asked with that one difference, the two readings of any
      // session are the same reading — and the finish view's week is the
      // week Home says the reader is in.
      for (let logged = 0; logged < 24; logged += 1) {
        const home = buildHomePlanProgress({ completedSessions: logged, sessionsPerWeek: 3, totalWeeks: 8 });
        const before = blockWeekTally({ sessionsDone: home.sessionsDone + 1, sessionsTotal: 24, totalWeeks: 8 });
        const after = blockWeekTally({ sessionsDone: logged + 1, sessionsTotal: 24, totalWeeks: 8 });
        assert.deepEqual(before, after, `session ${logged + 1}`);
        assert.equal(before.week, home.currentWeek, `session ${logged + 1}`);
      }
      // A finished block holds its last week full; a session past the end
      // does not read "4/3".
      assert.deepEqual(blockWeekTally({ sessionsDone: 25, sessionsTotal: 24, totalWeeks: 8 }), { week: 8, done: 3, target: 3 });
      assert.deepEqual(blockWeekTally({ sessionsDone: 0, sessionsTotal: 24, totalWeeks: 8 }), { week: 1, done: 0, target: 3 });
    },
  },
  {
    name: 'the week pill counts only the plan\'s own sessions with work in them',
    run() {
      // These two rules belonged to the calendar counter the pill used
      // (countPlanSessionsInRange, removed 2026-09-21). They hold because
      // the pill now reads Home's count: the canonical sessions, by plan
      // template. Two freestyle workouts once filled "VIIKKO 1 · 2/2" of a
      // programme neither touched, and an opened-and-abandoned player made
      // the week read "2/6" after one real session.
      const at = (day) => new Date(2026, 7, day, 18).toISOString();
      const done = { orderIndex: 0, weight: 60, reps: 8, kind: 'working', status: 'completed', completedAt: at(10) };
      const pending = { ...done, status: 'pending' };
      const session = (id, workoutTemplateId, day, sets) => ({
        session: { id, workoutTemplateId, workoutTemplateSessionId: null, workoutNameSnapshot: id, performedAt: at(day) },
        log: { id: `log_${id}`, sessionId: id, exerciseNameSnapshot: 'Bench', skipped: false, tracked: true, weight: 60, repsPerSet: [8], sets },
      });
      const rows = [
        session('free_1', 'tpl_freestyle_1', 11, [done]),
        session('free_2', 'tpl_freestyle_2', 12, [done]),
        session('opened', 'tpl_plan', 12, [pending]),
        session('real', 'tpl_plan', 13, [done]),
      ];
      const database = {
        ...createEmptyDatabase(),
        workoutSessions: rows.map((row) => row.session),
        exerciseLogs: rows.map((row) => row.log),
      };
      const sessionsDone = countSessionsSince(getCanonicalCompletedSessions(database), new Set(['tpl_plan']), at(1));
      assert.equal(sessionsDone, 1);
      assert.deepEqual(blockWeekTally({ sessionsDone, sessionsTotal: 16, totalWeeks: 8 }), { week: 1, done: 1, target: 2 });
    },
  },
  {
    name: 'the session analysis names the week the analysed session filled',
    run() {
      // The analysis passed the week the reader is IN, so the 3rd, 6th and
      // 9th sessions of a three-day plan read weeks 2, 3 and 4 beside a
      // summary that had just said 1, 2 and 3 (audit, 2026-09-20).
      const blockStartedAt = new Date(2026, 8, 1, 7).toISOString();
      const plan = new Set(['tpl_plan']);
      const sessions = Array.from({ length: 9 }, (_, index) => ({
        id: `s${index + 1}`,
        workoutTemplateId: 'tpl_plan',
        performedAt: new Date(2026, 8, 1 + index * 2, 18).toISOString(),
      }));
      const weekOf = (sessionId, list = sessions, startedAt = blockStartedAt) =>
        blockWeekOfSession({ sessionId, sessions: list, templateIds: plan, blockStartedAt: startedAt, sessionsTotal: 24, totalWeeks: 8 });

      assert.deepEqual(['s3', 's6', 's9'].map((id) => weekOf(id)), [1, 2, 3]);
      assert.equal(buildHomePlanProgress({ completedSessions: 9, sessionsPerWeek: 3 }).currentWeek, 4);

      // An older session is filed under its own week, not today's.
      assert.equal(weekOf('s1'), 1);
      assert.equal(weekOf('s4'), 2);
      // The list is newest first in the app; order must not matter.
      assert.equal(weekOf('s4', [...sessions].reverse()), 2);
    },
  },
  {
    name: 'the session analysis gives no week to a session outside the block',
    run() {
      const blockStartedAt = new Date(2026, 8, 10, 7).toISOString();
      const plan = new Set(['tpl_plan']);
      const sessions = [
        { id: 'before', workoutTemplateId: 'tpl_plan', performedAt: new Date(2026, 8, 8, 18).toISOString() },
        { id: 'first', workoutTemplateId: 'tpl_plan', performedAt: new Date(2026, 8, 10, 18).toISOString() },
        { id: 'freestyle', workoutTemplateId: 'tpl_freestyle', performedAt: new Date(2026, 8, 11, 18).toISOString() },
        { id: 'second', workoutTemplateId: 'tpl_plan', performedAt: new Date(2026, 8, 12, 18).toISOString() },
        { id: 'undated', workoutTemplateId: 'tpl_plan', performedAt: 'not-a-date' },
      ];
      const weekOf = (sessionId, startedAt = blockStartedAt) =>
        blockWeekOfSession({ sessionId, sessions, templateIds: plan, blockStartedAt: startedAt, sessionsTotal: 2, totalWeeks: 1 });

      // Trained before this block began, under no programme, or not at all.
      assert.equal(weekOf('before'), null);
      assert.equal(weekOf('freestyle'), null);
      assert.equal(weekOf('missing'), null);
      assert.equal(weekOf('undated'), null);
      assert.equal(weekOf('first', 'garbage'), null);
      // The block's own sessions are counted without the ones around them.
      assert.equal(weekOf('first'), 1);
      assert.equal(weekOf('second'), 1);
    },
  },
];
