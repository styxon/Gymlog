const assert = require('node:assert/strict');

const { getLiftProgress, getExerciseProgressSignal, getTrackedExerciseProgress } = require('../../src/lib/progression');
const {
  announcesRecord,
  buildExercisePrLookup,
  findLatestSessionPr,
} = require('../../src/lib/workoutCompletionSummary');
const { buildCompletionCardsFromAdaptedSession } = require('../../src/app/workoutCompletionState');
const { buildFreestyleFinish } = require('../../src/lib/emptyWorkoutSession');
const { buildLiftHistories, stalledRunPoints } = require('../../src/lib/trainingHistory');
const { buildWeeklyRead, plateauEpisodeKey } = require('../../src/lib/proInsights');
const { formatCompactVolume, withNumberLanguage } = require('../../src/lib/format');

function at(month, day) {
  return new Date(2026, month - 1, day, 18, 0, 0, 0).toISOString();
}

const set = (weight, reps, orderIndex = 0) => ({ orderIndex, weight, reps, kind: 'working', outcome: 'completed', status: 'completed' });

function log(id, sessionId, name, weight, reps, extra = {}) {
  const sets = reps.map((count, index) => set(weight, count, index));
  return {
    id,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: name,
    weight,
    repsPerSet: reps,
    sets,
    tracked: true,
    orderIndex: 0,
    skipped: false,
    ...extra,
  };
}

function db(sessions, logs, strengthGoals = []) {
  return {
    exerciseTemplates: [],
    workoutSessions: sessions.map(([id, performedAt]) => ({ id, performedAt, workoutNameSnapshot: 'W' })),
    exerciseLogs: logs,
    preferences: { strengthGoals },
  };
}

const isSameName = (left, right) => left.trim().toLowerCase() === right.trim().toLowerCase();

function adapted(exerciseName, weightKg, reps, tracked) {
  return {
    slotId: `slot_${exerciseName}`,
    exerciseName,
    persistedExerciseTemplateId: null,
    tracked,
    trackingMode: 'reps',
    notes: null,
    sets: [{ orderIndex: 0, status: 'completed', weightKg, reps }],
  };
}

function freestyle(name, kg, reps, trackedDefault) {
  return {
    localKey: `k_${name}`,
    name,
    libraryItemId: null,
    imageUrl: null,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    trackedDefault,
    sets: [{ localKey: `s_${name}`, kg: String(kg), reps: String(reps), done: true }],
  };
}

module.exports = [
  {
    name: 'a lift Records has no row for gets no record card or notification (bug hunt, 2026-10-26)',
    run() {
      const database = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [
          log('l1', 's1', 'Lateral Raise', 10, [12, 12, 12], { tracked: false }),
          log('l2', 's2', 'Lateral Raise', 12.5, [10, 10, 10], { tracked: false }),
        ],
      );
      assert.equal(getTrackedExerciseProgress(database).length, 0, 'Records has no Lateral Raise row');
      assert.equal(findLatestSessionPr(database), null, 'so the morning notification names no record');

      const prior = buildExercisePrLookup(db([['s1', at(10, 1)]], [database.exerciseLogs[0]]));
      const untracked = buildCompletionCardsFromAdaptedSession({
        exercises: [adapted('Lateral Raise', 12.5, 10, false)],
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: prior,
        language: 'fi',
      });
      assert.equal(untracked.prCards.length, 0, 'nor the finish screen a card');

      const freeFinish = buildFreestyleFinish({
        exercises: [freestyle('Lateral Raise', 12.5, 10, false)],
        workoutName: 'Vapaa',
        startedAtIso: at(10, 8),
        performedAtIso: at(10, 8),
        elapsedSeconds: 600,
        exercisePrLookup: prior,
        sessionId: 's2',
      });
      assert.equal(freeFinish.summary.prCards.length, 0, 'nor a free workout');

      // The same set, ticked tracked, is a record Records will show.
      const trackedFinish = buildFreestyleFinish({
        exercises: [freestyle('Lateral Raise', 12.5, 10, true)],
        workoutName: 'Vapaa',
        startedAtIso: at(10, 8),
        performedAtIso: at(10, 8),
        elapsedSeconds: 600,
        exercisePrLookup: prior,
        sessionId: 's2',
      });
      assert.equal(trackedFinish.summary.prCards.length, 1);
    },
  },
  {
    name: 'a record is still announced when the lift is tracked here, tracked before, or a target',
    run() {
      const prior = buildExercisePrLookup(
        db(
          [['s1', at(10, 1)]],
          [
            log('l1', 's1', 'Lateral Raise', 10, [12], { tracked: false }),
            log('l2', 's1', 'Bench Press', 80, [5], { tracked: true }),
            log('l3', 's1', 'Leg Curl', 30, [12], { tracked: false }),
          ],
          [{ exerciseName: 'Leg Curl', targetKg: 60, createdAt: at(9, 1) }],
        ),
      );
      assert.equal(announcesRecord(prior, 'Lateral Raise', true), true, 'tracked in this workout: Records gets the row');
      assert.equal(announcesRecord(prior, 'bench press', false), true, 'tracked before: the row is there');
      assert.equal(announcesRecord(prior, 'Leg Curl', false), true, 'a target has a row');
      assert.equal(announcesRecord(prior, 'Lateral Raise', false), false);

      const { prCards } = buildCompletionCardsFromAdaptedSession({
        exercises: [adapted('Bench Press', 85, 5, false), adapted('Lateral Raise', 12.5, 10, true)],
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: prior,
        language: 'fi',
      });
      assert.deepEqual(prCards.map((card) => card.exerciseName), ['Bench Press', 'Lateral Raise']);

      // The morning notification: the latest session's untracked Bench Press beat a tracked best.
      const database = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [log('l1', 's1', 'Bench Press', 80, [5]), log('l2', 's2', 'Bench Press', 85, [5], { tracked: false })],
      );
      assert.equal(findLatestSessionPr(database).weightKg, 85);

      // A heavier untracked row beside a tracked row of the same lift in one workout: Records
      // gets the row (from the tracked one) and its best (from every set), so both announce it.
      const twins = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [
          log('l1', 's1', 'Row', 60, [8], { tracked: false }),
          log('l2', 's2', 'Row', 50, [10], { tracked: true }),
          log('l3', 's2', 'Row', 65, [8], { tracked: false }),
        ],
      );
      assert.equal(findLatestSessionPr(twins).weightKg, 65);
      const twinCards = buildCompletionCardsFromAdaptedSession({
        exercises: [adapted('Row', 50, 10, true), { ...adapted('Row', 65, 8, false), slotId: 'slot_row_2' }],
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: buildExercisePrLookup(db([['s1', at(10, 1)]], [twins.exerciseLogs[0]])),
        language: 'fi',
      }).prCards;
      assert.deepEqual(twinCards.map((card) => card.performedWeightKg), [65]);
    },
  },
  {
    name: "a target lift's card reads its best from every performed set, untracked too (bug hunt, 2026-10-26)",
    run() {
      const database = db(
        [['s1', at(8, 1)], ['s2', at(9, 1)], ['s3', at(10, 1)]],
        [
          log('l1', 's1', 'Bench Press', 80, [5]),
          log('l2', 's2', 'Bench Press', 100, [3], { tracked: false }),
          log('l3', 's3', 'Bench Press', 85, [5]),
        ],
      );
      const summaries = getTrackedExerciseProgress(database);
      const lift = getLiftProgress('Bench Press', summaries, isSameName);
      assert.equal(lift.bestWeight, 100, 'the card agrees with Records');
      assert.equal(lift.bestValueBefore, 100);
      assert.equal(lift.latestWeight, 85, 'the trend stays the tracked lift');
      assert.notEqual(getExerciseProgressSignal(lift, 'fi').kind, 'new_best', '85 kg is no record over 100 kg');
      assert.deepEqual(getExerciseProgressSignal(lift, 'fi'), getExerciseProgressSignal(summaries[0], 'fi'));
    },
  },
  {
    name: 'a lighter second log of a lift in the last workout does not flip the trend to declining (bug hunt, 2026-10-26)',
    run() {
      const sessions = [{ id: 'a', performedAt: at(10, 5) }, { id: 'b', performedAt: at(10, 12) }, { id: 'c', performedAt: at(10, 19) }];
      const logs = [
        log('l1', 'a', 'Bench Press', 60, [5, 5, 5]),
        log('l2', 'b', 'Bench Press', 65, [5, 5, 5]),
        log('l3', 'c', 'Bench Press', 70, [5, 5, 5]),
        // A back-off of the same lift, saved with the same performedAt.
        log('l4', 'c', 'Bench Press', 50, [10, 10, 10]),
      ];
      const [lift] = buildLiftHistories(sessions, logs);
      assert.equal(lift.points.length, 4, 'the chart keeps a point per log');
      assert.equal(lift.first.topSetWeightKg, 60);
      assert.equal(lift.latest.topSetWeightKg, 70);
      assert.equal(lift.weightChangeKg, 10);
      assert.equal(lift.stalledSessions, 1);
      assert.equal(plateauEpisodeKey(lift), 'bench press::70');
      assert.deepEqual(stalledRunPoints(lift).map((point) => point.topSetWeightKg), [70]);
      const [row] = buildWeeklyRead([lift], null, 'fi', null);
      assert.equal(row.tone, 'green');
      assert.equal(row.status, 'Kehittyy');
    },
  },
  {
    name: 'a stall is counted by session best: a back-off after the top set does not end the run',
    run() {
      const sessions = [{ id: 'a', performedAt: at(10, 5) }, { id: 'b', performedAt: at(10, 12) }, { id: 'c', performedAt: at(10, 19) }];
      const logs = [
        log('l1', 'a', 'Squat', 100, [5, 5, 5]),
        log('l2', 'b', 'Squat', 100, [5, 5, 5]),
        log('l3', 'b', 'Squat', 80, [8, 8]),
        log('l4', 'c', 'Squat', 100, [5, 5, 5]),
      ];
      const [lift] = buildLiftHistories(sessions, logs);
      assert.equal(lift.stalledSessions, 3, 'three workouts at 100 kg without a rep best');
      assert.equal(lift.weightChangeKg, 0);
    },
  },
  {
    name: 'compact volume rounds before it picks the unit, and groups whole tonnes (bug hunt, 2026-10-26)',
    run() {
      const nbsp = ' ';
      withNumberLanguage('fi', () => {
        assert.equal(formatCompactVolume(999.4), '999 kg');
        assert.equal(formatCompactVolume(999.6), '1 t');
        assert.equal(formatCompactVolume(1000), '1 t');
        assert.equal(formatCompactVolume(32200), '32,2 t');
        assert.equal(formatCompactVolume(99940), '99,9 t');
        assert.equal(formatCompactVolume(99950), '100 t');
        assert.equal(formatCompactVolume(999999), `1${nbsp}000 t`);
        assert.equal(formatCompactVolume(1234567), `1${nbsp}235 t`);
        assert.equal(formatCompactVolume(0), '0 kg');
      });
      withNumberLanguage('en', () => {
        assert.equal(formatCompactVolume(999.6), '1 t');
        assert.equal(formatCompactVolume(32200), '32.2 t');
        assert.equal(formatCompactVolume(999999), '1,000 t');
      });
    },
  },
];
