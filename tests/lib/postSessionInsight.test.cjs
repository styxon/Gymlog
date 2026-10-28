const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { computePostSessionInsight } = require('../../src/lib/postSessionInsight');

function session(id, performedAt, totalVolumeKg = 1000, setsCompleted = 3) {
  return { id, performedAt, totalVolumeKg, setsCompleted };
}

function log(sessionId, exerciseTemplateId, exerciseNameSnapshot, weight, reps, options = {}) {
  return {
    id: `${sessionId}_${exerciseTemplateId ?? exerciseNameSnapshot}`,
    sessionId,
    exerciseTemplateId,
    exerciseNameSnapshot,
    weight,
    repsPerSet: reps,
    sets: reps.map((rep, index) => ({
      orderIndex: index,
      weight,
      reps: rep,
      kind: 'working',
      outcome: options.outcome ?? 'completed',
      status: options.status ?? 'completed',
    })),
    tracked: options.tracked ?? true,
    orderIndex: options.orderIndex ?? 0,
    skipped: options.skipped ?? false,
  };
}

function baseInput(overrides = {}) {
  const completedSession = session('s4', '2026-05-08T10:00:00.000Z', 1400, 3);
  const priorSessions = [
    session('s1', '2026-04-20T10:00:00.000Z', 900, 3),
    session('s2', '2026-04-27T10:00:00.000Z', 1000, 3),
    session('s3', '2026-05-01T10:00:00.000Z', 1100, 3),
  ];

  return {
    completedSession,
    sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 82.5, [5])],
    allPriorSessions: priorSessions,
    allPriorExerciseLogs: [
      log('s1', 'bench', 'Bench press', 75, [5]),
      log('s2', 'bench', 'Bench press', 80, [5]),
      log('s3', 'bench', 'Bench press', 80, [5]),
    ],
    lastInsightSessionId: null,
    lastInsightType: null,
    unitPreference: 'kg',
    ...overrides,
  };
}

module.exports = [
  {
    name: 'a session volume peak needs four priors it can actually measure',
    run() {
      // Stored sessions may carry no totalVolumeKg at all: database.ts
      // normalises a missing or malformed value to undefined, so anyone with
      // legacy or partially written history has them. Counting those as zero
      // made the smallest possible session "the highest in six weeks".
      const input = baseInput({
        completedSession: session('s_tiny', '2026-05-08T10:00:00.000Z', 5, 3),
        sessionExerciseLogs: [log('s_tiny', 'bench', 'Bench press', 20, [5])],
        allPriorSessions: [
          { id: 'v1', performedAt: '2026-04-10T10:00:00.000Z', setsCompleted: 3 },
          { id: 'v2', performedAt: '2026-04-20T10:00:00.000Z', setsCompleted: 3 },
          { id: 'v3', performedAt: '2026-04-28T10:00:00.000Z', setsCompleted: 3 },
          { id: 'v4', performedAt: '2026-05-01T10:00:00.000Z', setsCompleted: 3 },
        ],
        allPriorExerciseLogs: [
          log('v1', 'bench', 'Bench press', 60, [5]),
          log('v2', 'bench', 'Bench press', 62, [5]),
          log('v3', 'bench', 'Bench press', 64, [5]),
          log('v4', 'bench', 'Bench press', 66, [5]),
        ],
      });

      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.notEqual(insight?.type, 'session_volume_peak');
    },
  },
  {
    name: 'a seven-day comeback across a clock change is still seven days',
    run() {
      withHelsinkiClocks(() => {
        // 22 March 12:00 to 29 March 12:00 is seven calendar days and 167 real
        // hours. Flooring the raw span gives six, which is below the gate, so
        // the reader who came back after a week was told nothing at all.
        const local = (month, day, hour) => new Date(2026, month, day, hour, 0, 0).toISOString();
        const input = baseInput({
          completedSession: session('s_back', local(2, 29, 12), 1000, 3),
          sessionExerciseLogs: [log('s_back', 'bench', 'Bench press', 68, [5])],
          allPriorSessions: [
            session('p1', local(2, 22, 12), 1000, 3),
            session('p2', local(2, 10, 12), 1000, 3),
            session('p3', local(2, 1, 12), 1000, 3),
          ],
          // Rising then falling, so neither a record nor a plateau outranks the
          // comeback: this test is about the gap and nothing else.
          allPriorExerciseLogs: [
            log('p1', 'bench', 'Bench press', 70, [5]),
            log('p2', 'bench', 'Bench press', 65, [5]),
            log('p3', 'bench', 'Bench press', 60, [5]),
          ],
        });

        const insight = computePostSessionInsight(input, new Date(2026, 2, 29, 14, 0, 0));

        assert.ok(insight, 'expected a return-after-gap insight, got none');
        assert.equal(insight.type, 'return_after_gap');
        assert.match(insight.message, /7/);

        // And the gate stays as tight as it was. Sunday night to the following
        // Sunday morning touches seven dates but is 145 hours — the old
        // arithmetic withheld it, and making the seven-day rule DST-proof must
        // not turn it into "any gap that spans seven calendar squares".
        const shortGap = baseInput({
          completedSession: session('s_short', new Date(2026, 4, 10, 0, 30, 0).toISOString(), 1000, 3),
          sessionExerciseLogs: [log('s_short', 'bench', 'Bench press', 68, [5])],
          allPriorSessions: [
            session('q1', new Date(2026, 4, 3, 23, 0, 0).toISOString(), 1000, 3),
            session('q2', new Date(2026, 3, 20, 12, 0, 0).toISOString(), 1000, 3),
            session('q3', new Date(2026, 3, 10, 12, 0, 0).toISOString(), 1000, 3),
          ],
          allPriorExerciseLogs: [
            log('q1', 'bench', 'Bench press', 70, [5]),
            log('q2', 'bench', 'Bench press', 65, [5]),
            log('q3', 'bench', 'Bench press', 60, [5]),
          ],
        });

        const none = computePostSessionInsight(shortGap, new Date(2026, 4, 10, 2, 0, 0));
        assert.notEqual(none?.type, 'return_after_gap');
      });
    },
  },
  {
    name: 'the volume-peak window is six weeks, not 1008 hours',
    run() {
      withHelsinkiClocks(() => {
        // Session completed 5 May 2026 12:00. Forty-two calendar days back is
        // 24 March 12:00, and that span contains the 29 March clock change, so
        // it is 1007 real hours. Subtracting 42 * 24h opens the window at 11:00
        // and drags in a heavier session from half an hour outside it, which
        // then outranks today's and withholds a peak the reader did set.
        const local = (month, day, hour, minute = 0) =>
          new Date(2026, month, day, hour, minute, 0).toISOString();

        const input = baseInput({
          completedSession: session('s_today', local(4, 5, 12), 1800, 3),
          sessionExerciseLogs: [log('s_today', 'bench', 'Bench press', 75, [5])],
          allPriorSessions: [
            session('s_outside', local(2, 24, 11, 30), 2500, 3),
            session('s1', local(3, 10, 10), 900, 3),
            session('s2', local(3, 20, 10), 1000, 3),
            session('s3', local(3, 28, 10), 1100, 3),
            session('s4', local(4, 1, 10), 1200, 3),
          ],
        });

        const insight = computePostSessionInsight(input, new Date(2026, 4, 5, 14, 0, 0));

        // Named rather than dereferenced: a regression here returns null, and
        // "cannot read properties of null" does not say which gate fell.
        assert.ok(insight, 'expected an insight, got none');
        assert.equal(insight.type, 'session_volume_peak');
      });
    },
  },
  {
    name: 'post-session insight returns null with fewer than 3 prior sessions',
    run() {
      const input = baseInput({
        allPriorSessions: [session('s1', '2026-05-01T10:00:00.000Z'), session('s2', '2026-05-04T10:00:00.000Z')],
      });

      assert.equal(computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z')), null);
    },
  },
  {
    name: 'post-session insight returns null when the previous completed session already received an insight',
    run() {
      const input = baseInput({
        lastInsightSessionId: 's3',
        lastInsightType: 'personal_record',
      });

      assert.equal(computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z')), null);
    },
  },
  {
    name: 'post-session insight detects a new top-set personal record',
    run() {
      const insight = computePostSessionInsight(baseInput(), new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'personal_record');
      assert.equal(insight.confidence, 1);
      assert.equal(insight.exerciseKey, 'bench');
      assert.match(insight.message, /Bench press/);
      assert.match(insight.message, /82.5 kg/);
      assert.equal(insight.message.includes('!'), false);
    },
  },
  {
    name: 'post-session insight detects same weight with more reps as a personal record',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 80, [6])],
      });
      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'personal_record');
      assert.equal(insight.confidence, 0.85);
      assert.match(insight.message, /80 kg/);
      assert.match(insight.message, /6/);
    },
  },
  {
    name: 'post-session insight does not trigger personal record from name-only exercise matching',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [log('s4', null, 'Bench press', 90, [5])],
      });

      assert.equal(computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z')), null);
    },
  },
  {
    // Swap audit, 2026-09-21. A swap made on Home before the start finishes
    // as `completed`, and its log is keyed by the slot's template exercise —
    // the programmed lift's key. Read as that lift, a dumbbell press at 90 kg
    // was the bench press's new record.
    name: 'post-session insight does not read a swapped-in lift as the lift it replaced',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [
          { ...log('s4', null, 'Dumbbell Bench Press', 90, [5]), templateExerciseId: 'bench', swappedFrom: 'Bench press' },
        ],
      });

      assert.equal(computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z')), null);
    },
  },
  {
    name: 'post-session insight detects a three-session plateau by exercise id',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 80, [5])],
      });
      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'plateau_detected');
      assert.equal(insight.confidence, 0.9);
      assert.match(insight.message, /three sessions/);
      assert.match(insight.message, /80 kg/);
    },
  },
  {
    name: 'post-session insight detects a six-week session volume peak',
    run() {
      const input = baseInput({
        completedSession: session('s4', '2026-05-08T10:00:00.000Z', 1800, 3),
        sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 75, [5])],
        allPriorSessions: [
          session('s0', '2026-03-01T10:00:00.000Z', 2500, 3),
          session('s1', '2026-04-10T10:00:00.000Z', 900, 3),
          session('s2', '2026-04-20T10:00:00.000Z', 1000, 3),
          session('s3', '2026-05-01T10:00:00.000Z', 1100, 3),
          session('s5', '2026-05-04T10:00:00.000Z', 1200, 3),
        ],
      });
      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'session_volume_peak');
      assert.equal(insight.confidence, 0.85);
      assert.match(insight.message, /volume/);
      assert.match(insight.message, /six weeks/);
    },
  },
  {
    name: 'post-session insight detects return after a 7 day gap',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 75, [5])],
        allPriorSessions: [
          session('s1', '2026-04-10T10:00:00.000Z', 900, 3),
          session('s2', '2026-04-20T10:00:00.000Z', 1000, 3),
          session('s3', '2026-05-01T10:00:00.000Z', 1100, 3),
        ],
      });
      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'return_after_gap');
      assert.equal(insight.confidence, 0.95);
      assert.match(insight.message, /7 days/);
    },
  },
  {
    name: 'post-session insight priority returns personal record over plateau',
    run() {
      const input = baseInput({
        sessionExerciseLogs: [log('s4', 'bench', 'Bench press', 85, [5])],
        allPriorExerciseLogs: [
          log('s1', 'bench', 'Bench press', 80, [5]),
          log('s2', 'bench', 'Bench press', 80, [5]),
          log('s3', 'bench', 'Bench press', 80, [5]),
        ],
      });
      const insight = computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z'));

      assert.equal(insight.type, 'personal_record');
    },
  },
  {
    name: 'post-session insight does not repeat the last insight type consecutively',
    run() {
      const input = baseInput({
        lastInsightSessionId: 'older_session',
        lastInsightType: 'personal_record',
      });

      assert.equal(computePostSessionInsight(input, new Date('2026-05-08T12:00:00.000Z')), null);
    },
  },
];
