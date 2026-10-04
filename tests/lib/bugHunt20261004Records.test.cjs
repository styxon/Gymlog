const assert = require('node:assert/strict');

const {
  getExerciseProgressForName,
  getLatestLogForTemplateExercise,
  getRecentLogsForExercise,
  getTrackedExerciseProgress,
} = require('../../.test-dist/lib/progression.js');
const { buildExercisePrLookup } = require('../../.test-dist/lib/workoutCompletionSummary.js');
const { buildLiftHistories } = require('../../.test-dist/lib/trainingHistory.js');
const {
  buildWeeklyRead,
  pickCompletionLift,
  sessionBestPoints,
} = require('../../.test-dist/lib/proInsights.js');
const { getCombinedActivityMinutes } = require('../../.test-dist/lib/cardio.js');

function at(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

const set = (weight, reps, orderIndex = 0) => ({ orderIndex, weight, reps, kind: 'working', outcome: 'completed' });
const emptySet = (weight, orderIndex = 0) => ({ orderIndex, weight, reps: 0, kind: 'working', outcome: 'pending' });

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

module.exports = [
  {
    name: 'an unperformed log is not the latest session of a lift (bug hunt, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Bench Press', [set(80, 5)], { exerciseTemplateId: 't1' }),
          // Every set skipped individually: saved, not `skipped`, no reps.
          log('l2', 's2', 'Bench Press', [emptySet(80)], { exerciseTemplateId: 't1' }),
        ],
      );
      assert.equal(getRecentLogsForExercise(database, 'Bench Press', 2).length, 1);
      assert.equal(getRecentLogsForExercise(database, 'Bench Press', 2)[0].id, 'l1');
      assert.equal(getExerciseProgressForName(database, 'Bench Press').latestLog.id, 'l1');
      assert.equal(getLatestLogForTemplateExercise(database, 't1').id, 'l1');
    },
  },
  {
    name: 'Records best counts untracked logs, so it agrees with the PR badge (bug hunt, 2026-10-04)',
    run() {
      const database = db(
        [['s1', at(2026, 9, 1)], ['s2', at(2026, 9, 8)]],
        [
          log('l1', 's1', 'Back Squat', [set(100, 5)], { tracked: true }),
          log('l2', 's2', 'Back Squat', [set(110, 3)], { tracked: false }),
          log('l3', 's2', 'Leg Curl', [set(40, 12)], { tracked: false }),
        ],
      );
      const [squat, ...rest] = getTrackedExerciseProgress(database);
      assert.equal(rest.length, 0, 'a lift never tracked anywhere still gets no row');
      assert.equal(squat.bestWeight, 110);
      const lookup = buildExercisePrLookup(database);
      assert.equal(lookup.byName['back squat'].weight, squat.bestWeight);
    },
  },
  {
    name: 'a lift logged twice in one workout is one session in the Pro insights (bug hunt, 2026-10-04)',
    run() {
      const DAY = 86400000;
      const base = Date.parse('2026-09-20T09:00:00.000Z');
      const sessions = [0, 1].map((i) => ({
        id: `s${i}`,
        workoutTemplateId: 't',
        workoutNameSnapshot: 'W',
        performedAt: new Date(base + i * 4 * DAY).toISOString(),
      }));
      const logs = [
        log('a', 's0', 'Barbell Back Squat', [set(100, 5)]),
        log('b', 's1', 'Barbell Back Squat', [set(100, 5)]),
        log('c', 's1', 'Barbell Back Squat', [set(90, 8)], { orderIndex: 1 }),
      ];
      const lifts = buildLiftHistories(sessions, logs);
      assert.equal(lifts[0].points.length, 3, 'charts keep a point per log');
      assert.equal(sessionBestPoints(lifts[0]).length, 2);
      assert.equal(sessionBestPoints(lifts[0])[1].topSetWeightKg, 100, 'the heavier top set represents the session');
      // Three logs but two sessions: no weekly-read row (needs three sessions).
      assert.equal(buildWeeklyRead(lifts, null, 'en', null).length, 0);
      // Single workout with the lift twice: nothing to say about a next session.
      const one = buildLiftHistories(
        [sessions[0]],
        [log('a', 's0', 'Barbell Back Squat', [set(100, 5)]), log('b', 's0', 'Barbell Back Squat', [set(90, 8)])],
      );
      assert.equal(pickCompletionLift(one), null);
    },
  },
  {
    name: 'month activity minutes round the runs once over their total (bug hunt, 2026-10-04)',
    run() {
      const strides = Array.from({ length: 10 }, () => ({ durationSec: 90 }));
      assert.equal(getCombinedActivityMinutes(40, strides), 55);
    },
  },
  {
    name: 'review: the calf-raise demo alias files no history, the single-leg name opens the single-leg raise',
    run() {
      const { findFiledLibraryIndex, findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
      const names = createSeedExerciseLibrary().map((item) => item.name);
      // The demo: the bodyweight raise.
      assert.equal(names[findGuidedLibraryIndex('Calf Raise', names)], 'Bodyweight Calf Raise');
      // The history: a loaded gym calf raise is not filed under the bodyweight
      // lift's page (review, 2026-10-04).
      const filed = findFiledLibraryIndex('Calf Raise', names);
      assert.notEqual(filed === null ? null : names[filed], 'Bodyweight Calf Raise');
      assert.equal(names[findGuidedLibraryIndex('Calf Raise (Single-Leg)', names)], 'Single-Leg Calf Raise');
      assert.equal(names[findGuidedLibraryIndex('Seated Calf Raise', names)], 'Seated Calf Raise');
    },
  },
  {
    name: 'review: a run with an unparseable date does not break the lifetime week count',
    run() {
      const { getLifetimeTrainingSummary } = require('../../.test-dist/lib/lifetimeSummary.js');
      const db = {
        workoutSessions: [
          { id: 's1', performedAt: '2026-09-22T08:00:00.000Z', status: 'completed', totalVolumeKg: 1000, exercises: [] },
        ],
        cardioSessions: [{ id: 'c1', performedAt: 'not a date', durationSec: 1800, kind: 'run' }],
        exerciseLogs: [],
      };
      let summary;
      try {
        summary = getLifetimeTrainingSummary(db, new Date('2026-10-04T12:00:00.000Z'));
      } catch (error) {
        assert.fail(`threw: ${error}`);
      }
      for (const [key, value] of Object.entries(summary)) {
        if (typeof value === 'number') {
          assert.ok(!Number.isNaN(value), `${key} is NaN`);
        }
      }
    },
  },
];
