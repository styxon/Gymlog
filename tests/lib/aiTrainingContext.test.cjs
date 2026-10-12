const assert = require('node:assert/strict');

const {
  buildAiCoachBodyState,
  buildAiTrainingContext,
} = require('../../.test-dist/lib/aiTrainingContext.js');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

module.exports = [
  {
    name: 'the coach\'s weight window is thirty days, not 720 hours',
    run() {
      withHelsinkiClocks(() => {
        // now = 10 April 2026 12:00. Thirty calendar days back is 11 March
        // 12:00, a span of 719 hours, so subtracting 30 * 24h opens the window
        // at 11:00 and hands the coach a weigh-in from outside it — which then
        // becomes the "first" reading the reported change is measured from.
        const now = new Date(2026, 3, 10, 12, 0, 0);
        const weights = [
          { id: 'w_outside', recordedAt: new Date(2026, 2, 11, 11, 30, 0).toISOString(), weight: 90 },
          { id: 'w_first', recordedAt: new Date(2026, 2, 11, 12, 30, 0).toISOString(), weight: 80 },
          { id: 'w_last', recordedAt: new Date(2026, 3, 9, 12, 0, 0).toISOString(), weight: 82 },
        ];

        const body = buildAiCoachBodyState(weights, [], now);

        // Measured from the 80 kg reading inside the window, not the 90 kg one
        // half an hour outside it.
        assert.equal(body.weightChange30d.deltaKg, 2);

        // And closed at the top: a weigh-in stamped in the future, which a
        // wrong device clock leaves behind permanently, is not the reading a
        // thirty-day change is measured to.
        const withFuture = buildAiCoachBodyState(
          [...weights, { id: 'w_future', recordedAt: new Date(2027, 0, 1, 12, 0, 0).toISOString(), weight: 120 }],
          [],
          now,
        );

        assert.equal(withFuture.weightChange30d.deltaKg, 2);
      });
    },
  },
  {
    name: 'ai training context keeps a compact but actionable aiCoach summary without active workout context by default',
    run() {
      const context = buildAiTrainingContext({
        unitPreference: 'kg',
        activeWorkoutSummary: {
          title: '3-Day Full Body',
          nextExercise: 'Back Squat',
          meta: '12 sets left | Started 15:49',
        },
        homeSummary: {
          streak: {
            sessionsThisWeek: 2,
            sessionsLast30Days: 7,
            activity: {
              days: [
                {
                  dayStart: 1,
                  dayNumber: 10,
                  weekdayLabel: 'ma',
                  active: true,
                  isToday: false,
                },
                {
                  dayStart: 2,
                  dayNumber: 11,
                  weekdayLabel: 'ti',
                  active: false,
                  isToday: true,
                },
              ],
            },
          },
        },
        exerciseLogs: [],
        workoutSessions: [
          {
            id: 's1',
            workoutTemplateId: 't1',
            workoutNameSnapshot: 'Push Day',
            performedAt: '2026-03-26T09:00:00.000Z',
            durationMinutes: 52,
            setsCompleted: 15,
            exercisesSwapped: 1,
            noteCount: 2,
          },
          { id: 's2', workoutTemplateId: 't2', workoutNameSnapshot: 'Upper', performedAt: '2026-03-25T09:00:00.000Z' },
        ],
        trackedProgress: [
          {
            key: 'bench',
            name: 'Bench Press',
            logs: [],
            latestWeight: 85,
            previousWeight: 82.5,
            latestReps: '7,7,6',
            bestWeight: 87.5,
            bestReps: 21,
            latestLog: { performedAt: '2026-03-26T09:00:00.000Z' },
          },
        ],
        readyProgramCount: 3,
        recommendedProgramId: 'tpl_3_day_full_body_v1',
        recommendedProgramTitle: '3-Day Full Body',
        customProgramTitle: 'Oma ylakroppa',
      });

      assert.deepEqual(Object.keys(context).sort(), [
        'activeSession',
        'body',
        'cardio',
        'cautionAreas',
        'coachMemory',
        'customProgramTitle',
        'fatigue',
        'goals',
        'history',
        'homeState',
        'lastSession',
        'latestTopSets',
        'plateaus',
        'profile',
        'programme',
        'readyProgramCount',
        'recentCompletedSessions',
        'recommendedProgramId',
        'recommendedProgramTitle',
        'rhythm',
        'sessionsLast30Days',
        'sessionsThisWeek',
        'trackedLifts',
        'unitPreference',
      ]);
      assert.equal(context.activeSession, null);
      assert.equal(context.recentCompletedSessions[0].title, 'Push Day');
      assert.equal(context.recentCompletedSessions[0].sessionId, 's1');
      assert.equal(context.recentCompletedSessions[0].noteCount, 2);
      assert.equal(context.recommendedProgramTitle, '3-Day Full Body');
      assert.equal(context.trackedLifts[0].key, 'bench');
      assert.equal(context.trackedLifts[0].name, 'Bench Press');
      assert.equal(context.latestTopSets[0].reps, '7,7,6');
      assert.equal(context.rhythm.length, 2);
      // These sessions are months old, so the eight-week history is empty and
      // says so rather than reporting them as recent training.
      assert.equal(context.history.sessionCount, 0);
      assert.deepEqual(context.history.lifts, []);
    },
  },
  {
    name: 'the history block carries the last eight weeks of logged training',
    run() {
      const DAY = 86400000;
      const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
      const session = (id, performedAt, totalVolumeKg) => ({
        id,
        workoutTemplateId: 't1',
        workoutNameSnapshot: 'Push',
        performedAt,
        durationMinutes: 50,
        totalVolumeKg,
      });
      const log = (sessionId, weight) => ({
        id: `${sessionId}-bench`,
        sessionId,
        exerciseTemplateId: null,
        exerciseNameSnapshot: 'Bench Press',
        weight,
        repsPerSet: [5, 5, 5],
        tracked: true,
        orderIndex: 0,
      });

      const context = buildAiTrainingContext({
        unitPreference: 'kg',
        activeWorkoutSummary: null,
        homeSummary: {
          streak: { sessionsThisWeek: 1, sessionsLast30Days: 3, activity: { days: [] } },
        },
        workoutSessions: [
          session('s1', at(21), 3000),
          session('s2', at(14), 3200),
          session('s3', at(7), 3400),
        ],
        exerciseLogs: [log('s1', 80), log('s2', 80), log('s3', 80)],
        trackedProgress: [],
        readyProgramCount: 3,
        recommendedProgramId: null,
        recommendedProgramTitle: null,
        customProgramTitle: null,
        trainingDays: ['mon', 'thu'],
      });

      const history = context.history;
      assert.equal(history.sessionCount, 3);
      assert.equal(history.totalVolumeKg, 9600);
      assert.equal(history.truncated, false);
      assert.deepEqual(
        history.sessions.map((entry) => entry.setCount),
        [3, 3, 3],
      );

      // A lift logged at the same weight three times is a plateau the model can
      // see for itself, without being told the conclusion.
      assert.equal(history.lifts.length, 1);
      assert.equal(history.lifts[0].name, 'Bench Press');
      assert.equal(history.lifts[0].changeKg, 0);
      assert.equal(history.lifts[0].stalledSessions, 3);
      assert.deepEqual(history.lifts[0].weightSeriesKg, [80, 80, 80]);

      assert.ok(history.schedule);
      assert.deepEqual(history.schedule.trainingDays, ['mon', 'thu']);
      assert.equal(history.schedule.completedSessions, 3);
      assert.ok(
        history.schedule.plannedSessions >= history.schedule.completedSessions,
        'a twice-weekly schedule over four weeks plans at least as many as were done',
      );
      assert.ok(history.weeks.length >= 4);
    },
  },
  {
    // The deployed endpoint crashed on `context: {}` (FUNCTION_INVOCATION_FAILED,
    // formatLiftLine reading trackedLifts[0]) — the smoke test found it before
    // a user did. A context with fields missing is repaired, not thrown on.
    name: 'a context with fields missing is normalized so the preview can answer it',
    run() {
      const { normalizeAiCoachTrainingContext } = require('../../.test-dist/lib/aiTrainingContext.js');
      const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');
      for (const raw of [{}, null, undefined, { trackedLifts: 'nonsense' }, { unitPreference: 'stone' }]) {
        const context = normalizeAiCoachTrainingContext(raw);
        assert.deepEqual(context.trackedLifts, []);
        assert.equal(context.unitPreference, 'kg');
        assert.equal(context.fatigue.confident, false);
        assert.equal(typeof context.history.windowDays, 'number');
        const answer = buildAiCoachPreviewAnswer('hei', context, 'fi');
        assert.ok(answer && typeof answer.takeaway === 'string');
      }
      // A present field is trusted as sent.
      const kept = normalizeAiCoachTrainingContext({ unitPreference: 'lb', sessionsThisWeek: 3 });
      assert.equal(kept.unitPreference, 'lb');
      assert.equal(kept.sessionsThisWeek, 3);
    },
  },
  {
    name: 'history confidence is counted from the record, and both halves are needed for the top step',
    run() {
      const { resolveHistoryConfidence } = require('../../.test-dist/lib/aiTrainingContext.js');

      // The bottom step is the rule the prompt already had: three sessions is
      // where a trend starts.
      assert.equal(resolveHistoryConfidence(0, 0), 'low');
      assert.equal(resolveHistoryConfidence(2, 30), 'low');
      assert.equal(resolveHistoryConfidence(3, 1), 'medium');

      // Twelve sessions crammed into a fortnight say less about a direction
      // than the same twelve spread over six weeks, so the top step needs the
      // count and the calendar together.
      assert.equal(resolveHistoryConfidence(12, 41), 'medium', 'enough sessions, too short a stretch');
      assert.equal(resolveHistoryConfidence(11, 56), 'medium', 'long enough stretch, too few sessions');
      assert.equal(resolveHistoryConfidence(12, 42), 'high');
    },
  },
  {
    name: 'a history from an older app is recounted, not called short',
    run() {
      const { normalizeAiCoachTrainingContext } = require('../../.test-dist/lib/aiTrainingContext.js');

      // Defaulting a missing flag to 'low' would tell a reader with two
      // months of training that their record is too short to read.
      const sessions = Array.from({ length: 14 }, (_, index) => ({
        sessionId: `s${index}`,
        performedAt: new Date(2026, 5, 1 + index * 4).toISOString(),
      }));
      const recounted = normalizeAiCoachTrainingContext({
        history: { sessionCount: 14, sessions },
      });
      assert.equal(recounted.history.confidence, 'high');

      // A history that already carries the level is left alone.
      const asSent = normalizeAiCoachTrainingContext({
        history: { sessionCount: 14, sessions, confidence: 'medium' },
      });
      assert.equal(asSent.history.confidence, 'medium');

      // And a context with no history at all is still the empty one.
      assert.equal(normalizeAiCoachTrainingContext({}).history.confidence, 'low');
    },
  },
  {
    name: 'the coach hears the flagged areas: area and level from the phone, re-checked on the endpoint',
    run() {
      const { buildAiTrainingContext, normalizeAiCoachTrainingContext } = require('../../.test-dist/lib/aiTrainingContext');
      const { buildAiCoachContextText } = require('../../.test-dist/lib/aiCoachSystemContext');
      const base = {
        unitPreference: 'kg',
        activeWorkoutSummary: null,
        homeSummary: { streak: { sessionsThisWeek: 0, sessionsLast30Days: 0, activity: { days: [] } } },
        workoutSessions: [],
        exerciseLogs: [],
        trackedProgress: [],
        readyProgramCount: 0,
        recommendedProgramId: null,
        recommendedProgramTitle: null,
        customProgramTitle: null,
        now: new Date('2026-09-30T09:00:00.000Z'),
      };

      // Nothing flagged: an empty list, and no section in the text.
      const none = buildAiTrainingContext(base);
      assert.deepEqual(none.cautionAreas, []);
      assert.doesNotMatch(buildAiCoachContextText(none), /Flagged body areas/);

      // Flagged: area and level travel, the reader's own refinement notes stay.
      const flagged = buildAiTrainingContext({
        ...base,
        cautionFlags: [
          { area: 'knees', level: 'careful', refinements: ['meniscus 2019'] },
          { area: 'lower_back', level: 'avoid', refinements: [] },
        ],
      });
      assert.deepEqual(flagged.cautionAreas, [
        { area: 'knees', level: 'careful' },
        { area: 'lower_back', level: 'avoid' },
      ]);
      assert.doesNotMatch(JSON.stringify(flagged), /meniscus/);
      const text = buildAiCoachContextText(flagged);
      assert.match(text, /Flagged body areas/);
      assert.match(text, /- knees: careful: .*never adds weight or reps/);
      assert.match(text, /- lower back: avoid: the plan leaves this area out/);

      // The endpoint re-parses: unknown areas and levels, duplicates and junk
      // are dropped; an older client that sends nothing parses to nothing.
      const posted = normalizeAiCoachTrainingContext({
        ...flagged,
        cautionAreas: [
          { area: 'knees', level: 'careful' },
          { area: 'knees', level: 'avoid' },
          { area: 'spleen', level: 'careful' },
          { area: 'hips', level: 'drop table' },
          'junk',
          null,
        ],
      });
      assert.deepEqual(posted.cautionAreas, [{ area: 'knees', level: 'careful' }]);

      // Where the good rows sit does not decide whether they survive.
      const junkFirst = normalizeAiCoachTrainingContext({
        ...flagged,
        cautionAreas: [...Array.from({ length: 40 }, () => 'junk'), { area: 'hips', level: 'avoid' }],
      });
      assert.deepEqual(junkFirst.cautionAreas, [{ area: 'hips', level: 'avoid' }]);
      const older = { ...flagged };
      delete older.cautionAreas;
      assert.deepEqual(normalizeAiCoachTrainingContext(older).cautionAreas, []);
    },
  },
  {
    name: 'the coach context leaves a lift held for a flagged area out of the plateau list',
    run() {
      const log = (name, weight, daysAgo) => ({
        id: `log-${name}-${daysAgo}`,
        sessionId: `s${daysAgo}`,
        exerciseTemplateId: null,
        exerciseNameSnapshot: name,
        weight,
        repsPerSet: [8, 8, 8],
        sets: [0, 1, 2].map((orderIndex) => ({ orderIndex, weight, reps: 8, kind: 'working', outcome: 'completed', status: 'completed' })),
        tracked: true,
        orderIndex: 0,
        skipped: false,
        performedAt: new Date(Date.UTC(2026, 8, 30) - daysAgo * 86400000).toISOString(),
        workoutNameSnapshot: 'Day',
      });
      const summary = (key, name, weight) => {
        const logs = [0, 7, 14, 21].map((daysAgo) => log(name, weight, daysAgo));
        return {
          key,
          name,
          logs,
          latestLog: logs[0],
          previousLog: logs[1],
          latestWeight: weight,
          previousWeight: weight,
          latestReps: '8,8,8',
          bestWeight: weight,
          bestReps: 24,
        };
      };
      const trackedProgress = [summary('back squat', 'Back Squat', 100), summary('bench press', 'Bench Press', 80)];
      // The plateau list reads the same stall count as the history beside it,
      // so the sessions and logs behind the summaries are passed too.
      const exerciseLogs = trackedProgress.flatMap((entry) => entry.logs);
      const workoutSessions = [...new Map(exerciseLogs.map((entry) => [entry.sessionId, entry])).values()].map((entry) => ({
        id: entry.sessionId,
        workoutTemplateId: 'tpl',
        workoutNameSnapshot: 'Day',
        performedAt: entry.performedAt,
      }));
      const build = (cautionFlags) =>
        buildAiTrainingContext({
          unitPreference: 'kg',
          activeWorkoutSummary: null,
          homeSummary: { streak: { sessionsThisWeek: 1, sessionsLast30Days: 3, activity: { days: [] } } },
          workoutSessions,
          exerciseLogs,
          trackedProgress,
          readyProgramCount: 3,
          recommendedProgramId: null,
          recommendedProgramTitle: null,
          customProgramTitle: null,
          cautionFlags,
          now: new Date(Date.UTC(2026, 8, 30, 12)),
        });
      assert.deepEqual(build([]).plateaus.map((p) => p.name).sort(), ['Back Squat', 'Bench Press']);
      assert.deepEqual(
        build([{ area: 'knees', level: 'careful', refinements: [] }]).plateaus.map((p) => p.name),
        ['Bench Press'],
      );
      assert.deepEqual(
        build([{ area: 'knees', level: 'info', refinements: [] }]).plateaus.map((p) => p.name).sort(),
        ['Back Squat', 'Bench Press'],
      );
    },
  },
];
