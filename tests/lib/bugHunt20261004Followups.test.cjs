const assert = require('node:assert/strict');

const {
  getExerciseProgressSignal,
  getTrackedExerciseProgress,
} = require('../../.test-dist/lib/progression.js');
const { buildExercisePrLookup } = require('../../.test-dist/lib/workoutCompletionSummary.js');
const { buildLiftHistories, sessionBestPoints } = require('../../.test-dist/lib/trainingHistory.js');
const { buildCoachModules } = require('../../.test-dist/lib/aiCoachModules.js');
const { pickDemoQuestion } = require('../../.test-dist/lib/coachDemoMoments.js');
const { buildAiTrainingContext } = require('../../.test-dist/lib/aiTrainingContext.js');
const { getLifetimeTrainingSummary } = require('../../.test-dist/lib/lifetimeSummary.js');

function at(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

const set = (weight, reps, orderIndex = 0) => ({ orderIndex, weight, reps, kind: 'working', outcome: 'completed' });

function log(id, sessionId, name, sets, extra = {}) {
  return {
    id,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: name,
    weight: sets[0] ? sets[0].weight : 0,
    repsPerSet: sets.map((s) => s.reps),
    sets,
    tracked: true,
    orderIndex: 0,
    skipped: false,
    ...extra,
  };
}

function db(sessions, logs) {
  return {
    exerciseTemplates: [],
    workoutSessions: sessions.map(([id, performedAt]) => ({ id, performedAt, workoutNameSnapshot: 'W' })),
    exerciseLogs: logs,
    preferences: { strengthGoals: [] },
  };
}

/** One workout, Bench 60 then 70 (a lift logged twice), and nothing else. */
function twiceInOneWorkout() {
  const session = { id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'W', performedAt: new Date(Date.now() - 86400000).toISOString() };
  return {
    sessions: [session],
    logs: [
      log('a', 's1', 'Bench Press', [set(60, 5)]),
      log('b', 's1', 'Bench Press', [set(70, 5)], { orderIndex: 1 }),
    ],
  };
}

module.exports = [
  {
    name: 'Records reads every log of the lift, so it shows the PR the finish screen announced (follow-up, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Back Squat', [set(100, 5)], { tracked: true }),
          log('l2', 's2', 'Back Squat', [set(110, 3)], { tracked: false }),
        ],
      );
      const [squat] = getTrackedExerciseProgress(database);
      assert.equal(squat.bestWeight, 110);
      assert.equal(buildExercisePrLookup(database).byName['back squat'].weight, 110);
      assert.equal(squat.allLogs.length, 2, 'allLogs carries the untracked log');
      assert.equal(squat.logs.length, 1, 'logs stays the trend: tracked only');
      assert.equal(squat.latestWeight, 100, 'the row story is still the tracked lift');
    },
  },
  {
    name: 'a lighter set logged after the latest session does not make the latest a new best (follow-up, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Back Squat', [set(100, 5)], { tracked: true }),
          log('l2', 's2', 'Back Squat', [set(60, 5)], { tracked: false }),
        ],
      );
      const [squat] = getTrackedExerciseProgress(database);
      assert.equal(squat.bestValueBefore, null, 'nothing came before the only tracked session');
      assert.notEqual(getExerciseProgressSignal(squat, 'en').kind, 'new_best');
    },
  },
  {
    name: 'an earlier untracked set still counts as "best before" (follow-up, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Back Squat', [set(105, 5)], { tracked: false }),
          log('l2', 's2', 'Back Squat', [set(100, 5)], { tracked: true }),
        ],
      );
      const [squat] = getTrackedExerciseProgress(database);
      assert.equal(squat.bestValueBefore, 105);
    },
  },
  {
    name: 'a bodyweight trend does not take a kilo best from a stray weighted set (follow-up, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Pull Up', [set(0, 8)], { tracked: true }),
          log('l2', 's2', 'Pull Up', [set(20, 5)], { tracked: false }),
        ],
      );
      const [row] = getTrackedExerciseProgress(database);
      assert.ok(!row.bestWeight, 'the row is read in reps, so no kilo best');
    },
  },
  {
    name: 'a lift logged twice in one workout is one session for the coach focus, demo and context (follow-up, 2026-10-04)',
    run() {
      const { sessions, logs } = twiceInOneWorkout();
      const modules = buildCoachModules({ sessions, logs, language: 'en' });
      assert.equal(modules.focus, null, 'one workout with 60 then 70 is not +10 kg of progress');

      const lifts = buildLiftHistories(sessions, logs);
      assert.equal(lifts[0].points.length, 2);
      assert.equal(sessionBestPoints(lifts[0]).length, 1);

      // Three logs in two sessions must not count as the three sessions a
      // decline needs.
      const base = Date.now() - 10 * 86400000;
      const twoSessions = [0, 1].map((i) => ({
        id: `d${i}`,
        workoutTemplateId: 't',
        workoutNameSnapshot: 'W',
        performedAt: new Date(base + i * 3 * 86400000).toISOString(),
      }));
      const declining = buildLiftHistories(twoSessions, [
        log('x1', 'd0', 'Bench Press', [set(100, 5)]),
        log('x2', 'd1', 'Bench Press', [set(90, 5)]),
        log('x3', 'd1', 'Bench Press', [set(80, 5)], { orderIndex: 1 }),
      ]);
      const picked = pickDemoQuestion('month1', { lifts: declining, fatigueSignal: null, cautionFlags: null });
      assert.equal(picked.questionKey, 'coach.demo.month1.pace', 'two sessions are not a decline');

      const context = buildAiTrainingContext({
        unitPreference: 'kg',
        activeWorkoutSummary: null,
        homeSummary: { streak: { sessionsThisWeek: 1, sessionsLast30Days: 1, activity: { days: [] } } },
        workoutSessions: sessions,
        exerciseLogs: logs,
        trackedProgress: [],
        readyProgramCount: 3,
        recommendedProgramId: null,
        recommendedProgramTitle: null,
        customProgramTitle: null,
        trainingDays: ['mon', 'thu'],
      });
      const bench = context.history.lifts.find((lift) => lift.name === 'Bench Press');
      assert.equal(bench.sessions, 1);
      assert.equal(bench.changeKg, 0);
      assert.deepEqual(bench.weightSeriesKg, [70]);
    },
  },
  {
    name: 'Walking Lunge and Glute Bridge Hold open bodyweight demos while history filing stays put (follow-up, 2026-10-04)',
    run() {
      const { findFiledLibraryIndex, findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const library = createSeedExerciseLibrary();
      const names = library.map((item) => item.name);
      const demo = (name) => library[findGuidedLibraryIndex(name, names)];
      const filed = (name) => {
        const index = findFiledLibraryIndex(name, names);
        return index === null ? null : names[index];
      };
      assert.equal(demo('Walking Lunge').name, 'Bodyweight Walking Lunge');
      assert.equal(demo('Glute Bridge Hold').name, 'Butt Lift (Bridge)');
      assert.equal(demo('Glute Bridge Hold').equipment, 'bodyweight');
      // Filing is what it was before the demo aliases moved (checked against
      // the pre-change build for every catalogue row and library name).
      assert.equal(filed('Walking Lunge'), null);
      assert.equal(filed('Glute Bridge Hold'), 'Barbell Glute Bridge');
      assert.equal(filed('Bodyweight Walking Lunge'), 'Bodyweight Walking Lunge');
      assert.equal(filed('Barbell Walking Lunge'), 'Barbell Walking Lunge');
      assert.equal(filed('Glute Bridge'), 'Butt Lift (Bridge)');
      // The plain bridge is a rep exercise; borrowing its demo does not make it a hold.
      const { isHoldExerciseName } = require('../../.test-dist/lib/holdExercises.js');
      assert.equal(isHoldExerciseName('Glute Bridge Hold'), true);
      assert.equal(isHoldExerciseName('Butt Lift (Bridge)'), false);
    },
  },
  {
    name: 'best week streak is 0 when no session has a usable date (follow-up, 2026-10-04)',
    run() {
      const summary = getLifetimeTrainingSummary({
        workoutSessions: [{ id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'W', performedAt: 'not a date', totalVolumeKg: 100 }],
        cardioSessions: [],
        exerciseLogs: [log('l1', 's1', 'Bench Press', [set(60, 5)])],
        exerciseTemplates: [],
        workoutTemplates: [],
      });
      assert.equal(summary.bestWeekStreak, 0);
    },
  },
];
