const assert = require('node:assert/strict');

const { withHelsinkiClocks } = require('../helpers/clockChange.cjs');

const { buildTrainingHistory, buildLiftHistories, topSetOf } = require('../../.test-dist/lib/trainingHistory.js');
const { getSessionTotals } = require('../../.test-dist/lib/sessionTotals.js');
const { buildAiTrainingContext } = require('../../.test-dist/lib/aiTrainingContext.js');
const { computePostSessionInsight } = require('../../.test-dist/lib/postSessionInsight.js');
const { heaviestOfSets, resolveRecord } = require('../../.test-dist/lib/personalRecords.js');
const {
  getExerciseProgressForName,
  getTotalVolume,
  getTrackedExerciseProgress,
} = require('../../.test-dist/lib/progression.js');
const { getTopComparableSet } = require('../../.test-dist/lib/profileOverview.js');
const { buildHistorySessionViewModel } = require('../../.test-dist/lib/historyView.js');
const { buildPreviousTopSets } = require('../../.test-dist/lib/sessionMovement.js');
const { buildCoachModules } = require('../../.test-dist/lib/aiCoachModules.js');
const { isSuggestionSilenced } = require('../../.test-dist/lib/coachSuggestions.js');
const { decideRatingPrompt, RATING_MIN_SESSIONS } = require('../../.test-dist/lib/ratingPrompt.js');

/**
 * The numbers the coach context, History and the post-session insight state
 * about a lift or a session come from the rules History, Records and the
 * plateau card use (duplicate sweep 13, 2026-10-12).
 */

function set(weight, reps, extra = {}) {
  return { weight, reps, kind: 'working', outcome: 'completed', status: 'completed', ...extra };
}

function log(sessionId, name, sets, extra = {}) {
  return {
    id: `${sessionId}:${name}:${extra.orderIndex ?? 0}`,
    sessionId,
    exerciseTemplateId: extra.exerciseTemplateId ?? null,
    exerciseNameSnapshot: name,
    weight: sets[0]?.weight ?? 0,
    repsPerSet: extra.repsPerSet ?? sets.filter((entry) => entry.status === 'completed').map((entry) => entry.reps),
    sets: sets.map((entry, orderIndex) => ({ orderIndex, ...entry })),
    tracked: extra.tracked ?? true,
    orderIndex: extra.orderIndex ?? 0,
    skipped: false,
    ...extra,
  };
}

function session(id, performedAt, extra = {}) {
  return { id, workoutTemplateId: 'tpl', workoutNameSnapshot: 'Day', performedAt, durationMinutes: 50, ...extra };
}

const HOME = { streak: { sessionsThisWeek: 1, sessionsLast30Days: 4, activity: { days: [] } } };

function coachContext(workoutSessions, exerciseLogs, now) {
  const trackedProgress = getTrackedExerciseProgress({
    workoutSessions,
    exerciseLogs,
    exerciseTemplates: [],
    preferences: { strengthGoals: [] },
  });
  return buildAiTrainingContext({
    unitPreference: 'kg',
    activeWorkoutSummary: null,
    homeSummary: HOME,
    workoutSessions,
    exerciseLogs,
    trackedProgress,
    readyProgramCount: 3,
    recommendedProgramId: null,
    recommendedProgramTitle: null,
    customProgramTitle: null,
    now,
  });
}

module.exports = [
  {
    // D1-1
    name: 'the coach counts a session\'s sets and exercises the way History does',
    run() {
      const sessions = [session('s1', '2026-07-20T10:00:00.000Z')];
      const logs = [
        log('s1', 'Bench Press', [set(60, 5), set(60, 5), set(60, 5), set(40, 8, { kind: 'drop' })], {
          repsPerSet: [5, 5, 5],
        }),
        // Swapped in and never started: its sets are the plan's, all pending.
        log('s1', 'Leg Press', [set(100, 10, { status: 'pending' }), set(100, 10, { status: 'pending' })], {
          status: 'swapped',
          orderIndex: 1,
          repsPerSet: [],
        }),
        // A note, nothing done.
        log('s1', 'Barbell Row', [set(50, 8, { status: 'pending' })], { notes: 'Back tight', orderIndex: 2, repsPerSet: [] }),
      ];
      const history = buildTrainingHistory({ sessions, logs, now: Date.parse('2026-07-22T12:00:00.000Z') });
      const totals = getSessionTotals(logs);

      assert.equal(totals.exercisesCompleted, 1);
      assert.equal(history.sessions[0].exerciseCount, 1, 'was 3: every log not skipped');
      assert.equal(history.sessions[0].setCount, totals.setsCompleted);
      assert.equal(history.sessions[0].setCount, 4, 'the drop set is a set lifted');
    },
  },
  {
    // D1-2
    name: 'the coach\'s plateau list is the history\'s stall count, not a second counter',
    run() {
      const now = new Date('2026-07-22T12:00:00.000Z');
      const climbing = [
        session('a', '2026-07-01T10:00:00.000Z'),
        session('b', '2026-07-08T10:00:00.000Z'),
        session('c', '2026-07-15T10:00:00.000Z'),
      ];
      const climbingLogs = [
        log('a', 'Bench Press', [set(60, 8), set(60, 8), set(60, 6)]),
        log('b', 'Bench Press', [set(60, 8), set(60, 8), set(60, 7)]),
        log('c', 'Bench Press', [set(60, 8), set(60, 8), set(60, 8)]),
      ];
      const moving = coachContext(climbing, climbingLogs, now);
      assert.equal(moving.history.lifts[0].stalledSessions, 1);
      assert.deepEqual(moving.plateaus, [], 'the weakest set climbing every session is not a plateau');

      // The same lift logged twice in each of two workouts is two sessions.
      const twice = [session('a', '2026-07-08T10:00:00.000Z'), session('b', '2026-07-15T10:00:00.000Z')];
      const twiceLogs = ['a', 'b'].flatMap((id) => [
        log(id, 'Bench Press', [set(60, 8), set(60, 8)]),
        log(id, 'Bench Press', [set(60, 8), set(60, 8)], { orderIndex: 1 }),
      ]);
      assert.deepEqual(coachContext(twice, twiceLogs, now).plateaus, [], 'was four stagnant sessions after two workouts');

      const flat = ['a', 'b', 'c', 'd'].map((id, index) => session(id, `2026-07-${String(1 + index * 5).padStart(2, '0')}T10:00:00.000Z`));
      const flatLogs = flat.map((entry) => log(entry.id, 'Bench Press', [set(60, 8), set(60, 8), set(60, 8)]));
      const stuck = coachContext(flat, flatLogs, now);
      assert.equal(stuck.plateaus.length, 1);
      assert.equal(stuck.plateaus[0].stagnantSessions, stuck.history.lifts[0].stalledSessions);
      assert.equal(stuck.plateaus[0].stagnantSessions, 4);
      assert.equal(stuck.plateaus[0].topWeightKg, 60);
      assert.equal(stuck.plateaus[0].exerciseKey, 'bench press');
    },
  },
  {
    // D1-3
    name: 'the post-session insight calls a record only what Records and the PR cards call one',
    run() {
      const priors = [
        session('p1', '2026-05-01T10:00:00.000Z', { totalVolumeKg: 1500, setsCompleted: 3 }),
        session('p2', '2026-05-03T10:00:00.000Z', { totalVolumeKg: 1500, setsCompleted: 3 }),
        session('p3', '2026-05-05T10:00:00.000Z', { totalVolumeKg: 1500, setsCompleted: 3 }),
      ];
      const today = session('t', '2026-05-07T10:00:00.000Z', { totalVolumeKg: 2880, setsCompleted: 3 });
      const bench = (sessionId, sets) => log(sessionId, 'Bench Press', sets, { exerciseTemplateId: 'bench' });
      const input = (todaySets, priorSets) => ({
        completedSession: today,
        sessionExerciseLogs: [bench('t', todaySets)],
        allPriorSessions: priors,
        allPriorExerciseLogs: priors.map((entry, index) => bench(entry.id, priorSets[index])),
        lastInsightSessionId: null,
        lastInsightType: null,
        unitPreference: 'kg',
      });
      const at = new Date('2026-05-07T12:00:00.000Z');
      const three = (weight, reps) => [set(weight, reps), set(weight, reps), set(weight, reps)];

      // Lighter for more reps is not a record: Records keeps 100 × 5.
      const lighter = computePostSessionInsight(input(three(80, 12), [three(100, 5), three(100, 5), three(100, 5)]), at);
      assert.notEqual(lighter?.type, 'personal_record', lighter?.message);

      // The same weight for more reps is.
      const more = computePostSessionInsight(input(three(100, 6), [three(100, 5), three(100, 5), three(100, 5)]), at);
      assert.equal(more?.type, 'personal_record');
      assert.match(more.message, /New best on Bench Press: 100 kg for 6 reps/);

      // A pending row — a target never ticked — is not work done.
      const pending = computePostSessionInsight(
        input([set(110, 5, { status: 'pending' }), set(110, 5, { status: 'pending' })], [three(100, 5), three(100, 5), three(100, 5)]),
        at,
      );
      assert.equal(pending, null);

      // The weakest set climbing every session is not a plateau.
      const climbing = computePostSessionInsight(
        input([set(60, 8), set(60, 8), set(60, 8)], [
          [set(60, 8), set(60, 8), set(60, 5)],
          [set(60, 8), set(60, 8), set(60, 6)],
          [set(60, 8), set(60, 8), set(60, 7)],
        ]),
        at,
      );
      assert.notEqual(climbing?.type, 'plateau_detected', climbing?.message);

      // A flat run still is.
      const flat = computePostSessionInsight(input(three(60, 8), [three(60, 8), three(60, 8), three(60, 8)]), at);
      assert.equal(flat?.type, 'plateau_detected');
      assert.match(flat.message, /Bench Press has been at 60 kg for three sessions/);
    },
  },
  {
    // D1-6
    name: 'a loaded hold is no kilos of volume and no top set',
    run() {
      const plank = log('s1', 'Plank', [set(10, 60), set(10, 60)]);
      assert.equal(getTotalVolume(plank), 0, 'was 1200 kg');
      assert.equal(topSetOf(plank), null, 'was 10 kg × 60');
      const history = buildTrainingHistory({
        sessions: [session('s1', '2026-07-20T10:00:00.000Z')],
        logs: [plank, log('s1', 'Bench Press', [set(60, 5)], { orderIndex: 1 })],
        now: Date.parse('2026-07-22T12:00:00.000Z'),
      });
      assert.deepEqual(history.lifts.map((lift) => lift.name), ['Bench Press']);
      assert.deepEqual(history.repsLifts, []);
    },
  },
  {
    // D1-7
    name: 'a set with no reps is no top set anywhere',
    run() {
      const sets = [set(100, 0), set(80, 5)];
      assert.deepEqual(heaviestOfSets(sets.map(({ weight, reps }) => ({ weight, reps }))), { weight: 80, reps: 5 });

      const bench = log('s1', 'Bench Press', sets);
      assert.deepEqual(topSetOf(bench), { weight: 80, reps: 5 });
      assert.equal(getTopComparableSet(bench).weight, 80);
      assert.equal(
        buildHistorySessionViewModel(session('s1', '2026-07-20T10:00:00.000Z'), [bench]).topLiftWeightKg,
        80,
      );
      const previous = buildPreviousTopSets({
        logs: [bench],
        performedAtBySessionId: { s1: '2026-07-20T10:00:00.000Z' },
        excludeSessionId: 'today',
      });
      assert.equal(previous['bench press'], 80);
      const record = resolveRecord(
        { key: 'bench press', name: 'Bench Press', entries: [{ performedAt: '2026-07-20T10:00:00.000Z', sets }] },
        'weight',
        new Date('2026-07-22T12:00:00.000Z'),
      );
      assert.equal(record.value, 80, 'a 100 kg row with no reps is not a weight record');
    },
  },
  {
    // D2-4
    name: 'a lift\'s span is calendar days, whatever the time of day',
    run() {
      withHelsinkiClocks(() => {
        const at = (day, hour) => new Date(2026, 9, day, hour, 0, 0).toISOString();
        const span = (first, second) =>
          buildLiftHistories(
            [session('a', first), session('b', second)],
            [log('a', 'Back Squat', [set(100, 5)]), log('b', 'Back Squat', [set(102.5, 5)])],
          )[0].spanDays;

        // Monday morning to Tuesday evening is one day, not two.
        assert.equal(span(at(5, 8), at(6, 20)), 1);
        // Monday night to Wednesday small hours is two days, not one.
        assert.equal(span(at(5, 23), at(7, 1)), 2);

        const sessions = [session('a', at(5, 8)), session('b', at(6, 20))];
        const logs = [log('a', 'Back Squat', [set(100, 5)]), log('b', 'Back Squat', [set(102.5, 5)])];
        const context = coachContext(sessions, logs, new Date(2026, 9, 7, 12));
        assert.equal(context.history.lifts[0].spanDays, 1);

        const modules = buildCoachModules({ sessions, logs, language: 'en', now: new Date(2026, 9, 7, 12) });
        assert.ok(modules.focus, 'expected a focus module');
        assert.ok(modules.focus.body.highlights.includes('1 day'), JSON.stringify(modules.focus.body));
      });
    },
  },
  {
    // D2-5
    name: 'the record badge, the coach\'s offer and the rating ask count calendar days across a clock change',
    run() {
      withHelsinkiClocks(() => {
        // A record set 26 September 10:00 is thirty calendar days old at 26
        // October 10:00 — still inside the window, though 721 hours passed.
        const record = resolveRecord(
          {
            key: 'bench press',
            name: 'Bench Press',
            entries: [{ performedAt: new Date(2026, 8, 26, 10).toISOString(), sets: [{ weight: 100, reps: 5 }] }],
          },
          'weight',
          new Date(2026, 9, 26, 10),
        );
        assert.equal(record.fresh, true);

        // Refused 25 September 12:00; at 25 October 11:30 the month is not up,
        // though 720.5 hours have passed.
        const state = { set_goal: { rejectedCount: 1, lastRejectedAt: new Date(2026, 8, 25, 12).toISOString(), acceptedAt: null } };
        assert.equal(isSuggestionSilenced(state, 'set_goal', new Date(2026, 9, 25, 11, 30)), true);
        // An unreadable date still silences nothing.
        assert.equal(
          isSuggestionSilenced({ set_goal: { rejectedCount: 1, lastRejectedAt: 'garbage', acceptedAt: null } }, 'set_goal', new Date(2026, 9, 25, 11, 30)),
          false,
        );

        // Asked 19 October 12:00; at 26 October 11:30 the week is not up,
        // though 168.5 hours have passed.
        const ask = (lastAskedAt) =>
          decideRatingPrompt({
            state: { lastAskedAt, askCount: 1, rated: false },
            sessionsLogged: RATING_MIN_SESSIONS,
            atPeakMoment: true,
            nowMs: new Date(2026, 9, 26, 11, 30).getTime(),
          });
        assert.deepEqual(ask(new Date(2026, 9, 19, 12).toISOString()), { ask: false, reason: 'cooling_down' });
        assert.deepEqual(ask(new Date(2026, 9, 19, 11).toISOString()), { ask: true });
        assert.deepEqual(ask('garbage'), { ask: false, reason: 'cooling_down' });
      });
    },
  },
  {
    // D4-6 (owner, 2026-10-12): a log is named by its stored snapshot.
    name: 'a log belongs under the name it was logged as, not its row\'s current name',
    run() {
      const database = {
        workoutSessions: [session('s1', '2026-07-20T10:00:00.000Z')],
        exerciseLogs: [log('s1', 'Back Squat', [set(140, 5)], { exerciseTemplateId: 'ex1' })],
        exerciseTemplates: [{ id: 'ex1', name: 'Barbell Squat' }],
        preferences: { strengthGoals: [] },
      };
      const tracked = getTrackedExerciseProgress(database);
      assert.deepEqual(tracked.map((summary) => summary.name), ['Back Squat']);
      assert.equal(tracked[0].bestWeight, 140);
      assert.equal(getExerciseProgressForName(database, 'Back Squat').logs.length, 1);
      assert.equal(getExerciseProgressForName(database, 'Barbell Squat').logs.length, 0);
    },
  },
];
