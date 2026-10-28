const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { createEmptyDatabase } = require('../../src/data/seed');
const { buildFatigueModel } = require('../../src/lib/fatigueModel');

const NOW = new Date('2026-05-11T12:00:00.000Z');

function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeSession(id, performedAt, totalVolumeKg) {
  return {
    id,
    workoutTemplateId: 'tpl',
    workoutNameSnapshot: 'Push',
    performedAt,
    totalVolumeKg,
  };
}

module.exports = [
  {
    name: 'a fortnight of training across a clock change still earns confidence',
    run() {
      withHelsinkiClocks(() => {
        // Four sessions spanning exactly fourteen calendar days, 22 March to 5
        // April, crossing the change. Measuring that span as raw milliseconds
        // over 86400000 gives 13.96, short of the fourteen the confidence gate
        // wants — and `confident` is what decides whether the app may give load
        // advice at all, so the reader gets silence for a fortnight of work.
        const sessions = [
          makeSession('f1', new Date(2026, 2, 22, 12, 0, 0).toISOString(), 4000),
          makeSession('f2', new Date(2026, 2, 26, 12, 0, 0).toISOString(), 4000),
          makeSession('f3', new Date(2026, 3, 1, 12, 0, 0).toISOString(), 4000),
          makeSession('f4', new Date(2026, 3, 5, 12, 0, 0).toISOString(), 4000),
        ];

        const model = buildFatigueModel(
          { workoutSessions: sessions, exerciseLogs: [] },
          new Date(2026, 3, 5, 18, 0, 0),
        );

        assert.equal(model.sessionCount28d, 4);
        assert.equal(model.confident, true);

        // And the gate stays as tight as it was: thirteen days and an hour is
        // still not fourteen, clock change or no clock change. Counting days
        // and rounding would have let this through.
        const short = [
          makeSession('n1', new Date(2026, 1, 1, 23, 30, 0).toISOString(), 4000),
          makeSession('n2', new Date(2026, 1, 5, 12, 0, 0).toISOString(), 4000),
          makeSession('n3', new Date(2026, 1, 10, 12, 0, 0).toISOString(), 4000),
          makeSession('n4', new Date(2026, 1, 15, 0, 30, 0).toISOString(), 4000),
        ];

        const shortModel = buildFatigueModel(
          { workoutSessions: short, exerciseLogs: [] },
          new Date(2026, 1, 15, 6, 0, 0),
        );

        assert.equal(shortModel.sessionCount28d, 4);
        assert.equal(shortModel.confident, false);
      });
    },
  },
  {
    name: 'the acute window is seven days, not 168 hours',
    run() {
      withHelsinkiClocks(() => {
        // now = 4 April 2026 12:00. Seven calendar days back is 28 March 12:00,
        // and *that* span contains the 29 March change, so it is 167 real
        // hours. (A window ending 5 April would not: the change falls at 03:00
        // on the 29th, so a window opening at noon that day misses it entirely
        // and the test would prove nothing.) Subtracting 7 * 24h therefore
        // opens the acute window at 11:00 and counts a session that is seven
        // days and half an hour old as part of this week's load.
        const now = new Date(2026, 3, 4, 12, 0, 0);
        const sessions = [
          // Twenty-eight calendar days back is 7 March 12:00, and that span
          // contains the change too, so the fixed-millisecond edge opens at
          // 11:00 and admits this one from outside the chronic window.
          makeSession('outside_28d', new Date(2026, 2, 7, 11, 30, 0).toISOString(), 9000),
          makeSession('inside_28d', new Date(2026, 2, 28, 11, 30, 0).toISOString(), 5000),
          makeSession('inside_7d', new Date(2026, 3, 2, 12, 0, 0).toISOString(), 1000),
        ];

        const model = buildFatigueModel({ workoutSessions: sessions, exerciseLogs: [] }, now);

        // Only the 2 April session is inside seven days.
        assert.equal(model.sessionCount7d, 1);
        assert.equal(model.acuteLoadKg, 1000);
        // Only the 28 March and 2 April sessions are inside twenty-eight.
        assert.equal(model.sessionCount28d, 2);
      });
    },
  },
  {
    name: 'fatigue: no sessions produces undertrained signal and safe defaults',
    run() {
      const db = createEmptyDatabase();
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      assert.equal(result.signal, 'undertrained');
      assert.equal(result.acuteLoadKg, 0);
      assert.equal(result.chronicLoadKg, 0);
      assert.equal(result.acwr, 0);
      assert.equal(result.sessionCount7d, 0);
      assert.equal(result.sessionCount28d, 0);
    },
  },
  {
    name: 'fatigue: consistent weekly volume gives optimal signal',
    run() {
      // 4 sessions per week for 4 weeks, each with 2000 kg → chronic = 2000, acute = 2000, acwr = 1.0
      const db = createEmptyDatabase();
      db.workoutSessions = [
        // this week
        makeSession('w4a', daysAgo(1), 500),
        makeSession('w4b', daysAgo(2), 500),
        makeSession('w4c', daysAgo(4), 500),
        makeSession('w4d', daysAgo(6), 500),
        // week 2
        makeSession('w3a', daysAgo(8), 500),
        makeSession('w3b', daysAgo(10), 500),
        makeSession('w3c', daysAgo(12), 500),
        makeSession('w3d', daysAgo(14), 500),
        // week 3
        makeSession('w2a', daysAgo(15), 500),
        makeSession('w2b', daysAgo(17), 500),
        makeSession('w2c', daysAgo(19), 500),
        makeSession('w2d', daysAgo(21), 500),
        // week 4
        makeSession('w1a', daysAgo(22), 500),
        makeSession('w1b', daysAgo(24), 500),
        makeSession('w1c', daysAgo(26), 500),
        makeSession('w1d', daysAgo(27), 500),
      ];
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      assert.equal(result.signal, 'optimal');
      assert.equal(result.acwr, 1);
      assert.ok(result.recoveryScore >= 75, `expected score >= 75, got ${result.recoveryScore}`);
    },
  },
  {
    name: 'fatigue: spike week with low chronic baseline gives elevated or high signal',
    run() {
      const db = createEmptyDatabase();
      // chronic: 3 light weeks at 1000 kg each → chronicLoadKg = (3000 + acuteLoad) / 4
      // acute: 4000 kg this week → acwr ≈ 4000 / (7000/4) = 4000/1750 ≈ 2.28 → high
      db.workoutSessions = [
        makeSession('spike1', daysAgo(1), 1000),
        makeSession('spike2', daysAgo(2), 1000),
        makeSession('spike3', daysAgo(3), 1000),
        makeSession('spike4', daysAgo(4), 1000),
        makeSession('base1', daysAgo(10), 500),
        makeSession('base2', daysAgo(17), 500),
        makeSession('base3', daysAgo(24), 500),
      ];
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      assert.ok(result.acwr > 1.5, `expected acwr > 1.5, got ${result.acwr}`);
      assert.equal(result.signal, 'high');
      assert.ok(result.recoveryScore < 50);
    },
  },
  {
    name: 'fatigue: active last 3 weeks but no sessions this week gives undertrained',
    run() {
      const db = createEmptyDatabase();
      db.workoutSessions = [
        makeSession('old1', daysAgo(8), 1000),
        makeSession('old2', daysAgo(15), 1000),
        makeSession('old3', daysAgo(22), 1000),
      ];
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      assert.equal(result.acuteLoadKg, 0);
      assert.equal(result.sessionCount7d, 0);
      assert.equal(result.sessionCount28d, 3);
      assert.equal(result.signal, 'undertrained');
    },
  },
  {
    name: 'fatigue: sessions older than 28 days are excluded',
    run() {
      const db = createEmptyDatabase();
      db.workoutSessions = [
        makeSession('recent', daysAgo(3), 2000),
        makeSession('old', daysAgo(35), 99999), // must not count
      ];
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      assert.equal(result.sessionCount28d, 1);
      assert.equal(result.acuteLoadKg, 2000);
    },
  },
  {
    name: 'fatigue: falls back to exerciseLogs volume when totalVolumeKg is missing',
    run() {
      const db = createEmptyDatabase();
      // session without totalVolumeKg — should use log-level computation
      db.workoutSessions = [
        { id: 'sess1', workoutTemplateId: 'tpl', workoutNameSnapshot: 'Push', performedAt: daysAgo(2) },
        { id: 'sess2', workoutTemplateId: 'tpl', workoutNameSnapshot: 'Push', performedAt: daysAgo(10) },
        { id: 'sess3', workoutTemplateId: 'tpl', workoutNameSnapshot: 'Push', performedAt: daysAgo(18) },
        { id: 'sess4', workoutTemplateId: 'tpl', workoutNameSnapshot: 'Push', performedAt: daysAgo(26) },
      ];
      // 4 sets of 100 kg x 5 reps = 2000 kg per session
      function makeLogs(sessionId) {
        return [0, 1, 2, 3].map((i) => ({
          id: `${sessionId}_log_${i}`,
          sessionId,
          exerciseTemplateId: null,
          exerciseNameSnapshot: 'Squat',
          weight: 100,
          repsPerSet: [5, 5, 5, 5],
          sets: [0, 1, 2, 3].map((j) => ({
            orderIndex: j,
            weight: 100,
            reps: 5,
            kind: 'working',
            outcome: 'completed',
            status: 'completed',
          })),
          tracked: true,
          orderIndex: i,
          skipped: false,
        }));
      }
      db.exerciseLogs = [
        ...makeLogs('sess1'),
        ...makeLogs('sess2'),
        ...makeLogs('sess3'),
        ...makeLogs('sess4'),
      ];
      const result = buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW);
      // each session: 4 logs * 4 sets * 100 kg * 5 reps = 8000 kg
      assert.ok(result.acuteLoadKg > 0, 'should compute volume from logs');
      assert.equal(result.sessionCount7d, 1);
      assert.equal(result.sessionCount28d, 4);
    },
  },
  {
    name: 'fatigue: recoveryScore peaks near acwr 1.05 and degrades outside optimal zone',
    run() {
      function scoreAt(acwr) {
        // build a db that gives exactly that ACWR
        // chronic = 1000, so acute = acwr * 1000
        const db = createEmptyDatabase();
        const acuteLoad = acwr * 1000;
        // 3 weeks of 1000 each → total28d = 3000 + acuteLoad, chronic = (3000 + acuteLoad)/4
        // We want chronic = 1000, so total28d = 4000, so older weeks contribute 4000 - acuteLoad
        // The oldest on day 27, so the history covers the window's four weeks
        // and the chronic load is the four-week average this arithmetic assumes.
        db.workoutSessions = [
          makeSession('acute', daysAgo(1), acuteLoad),
          makeSession('old1', daysAgo(10), (4000 - acuteLoad) / 3),
          makeSession('old2', daysAgo(17), (4000 - acuteLoad) / 3),
          makeSession('old3', daysAgo(27), (4000 - acuteLoad) / 3),
        ];
        return buildFatigueModel({ workoutSessions: db.workoutSessions, exerciseLogs: db.exerciseLogs }, NOW).recoveryScore;
      }

      const scoreOptimal = scoreAt(1.05);
      const scoreUnder = scoreAt(0.5);
      const scoreHigh = scoreAt(2.0);

      assert.ok(scoreOptimal >= 95, `expected peak score >= 95, got ${scoreOptimal}`);
      assert.ok(scoreUnder < scoreOptimal, 'undertrained score should be below optimal');
      assert.ok(scoreHigh < scoreOptimal, 'overreaching score should be below optimal');
    },
  },
  {
    name: 'fatigue: one logged session is not enough history to judge load',
    run() {
      // It used to read 500 acute against 500/4 chronic — ACWR 4, a confident
      // "well above the safe zone" from a single workout. The flag guards it,
      // and the average no longer counts weeks nobody trained.
      const result = buildFatigueModel(
        { workoutSessions: [makeSession('s1', daysAgo(1), 500)], exerciseLogs: [] },
        NOW,
      );

      assert.equal(result.confident, false);
      assert.equal(result.acwr, 1);
    },
  },
  {
    name: 'fatigue: a new reader training steadily is not told recovery is low in week three',
    run() {
      // Identical 5,000 kg sessions every Mon/Wed/Fri from 31 Aug, read on Mon
      // 14 Sep, Wed 16 Sep and Fri 18 Sep. Dividing two weeks of load by four
      // read 1.71 "high" and then "elevated", and holds were applied to Pro loads.
      withHelsinkiClocks(() => {
        const days = [31, 2, 4, 7, 9, 11, 14, 16, 18];
        const months = [7, 8, 8, 8, 8, 8, 8, 8, 8];
        const sessions = days.map((day, index) =>
          makeSession(`steady${index}`, new Date(2026, months[index], day, 18, 0, 0).toISOString(), 5000),
        );
        for (const [day, count] of [[14, 7], [16, 8], [18, 9]]) {
          const model = buildFatigueModel(
            { workoutSessions: sessions.slice(0, count), exerciseLogs: [] },
            new Date(2026, 8, day, 20, 0, 0),
          );
          assert.equal(model.signal, 'optimal', `${day} Sep read ${model.signal} at ACWR ${model.acwr}`);
        }
      });
    },
  },
  {
    name: 'fatigue: four sessions spread over two weeks can be judged',
    run() {
      const result = buildFatigueModel(
        {
          workoutSessions: [
            makeSession('s1', daysAgo(20), 500),
            makeSession('s2', daysAgo(14), 500),
            makeSession('s3', daysAgo(7), 500),
            makeSession('s4', daysAgo(1), 500),
          ],
          exerciseLogs: [],
        },
        NOW,
      );

      assert.equal(result.confident, true);
    },
  },
  {
    name: 'fatigue: four sessions crammed into three days are not enough spread',
    run() {
      const result = buildFatigueModel(
        {
          workoutSessions: [
            makeSession('s1', daysAgo(3), 500),
            makeSession('s2', daysAgo(2), 500),
            makeSession('s3', daysAgo(1), 500),
            makeSession('s4', daysAgo(0), 500),
          ],
          exerciseLogs: [],
        },
        NOW,
      );

      assert.equal(result.confident, false);
    },
  },
  {
    name: 'fatigue: an empty history is never confident',
    run() {
      const result = buildFatigueModel({ workoutSessions: [], exerciseLogs: [] }, NOW);
      assert.equal(result.confident, false);
    },
  },
];
