const assert = require('node:assert/strict');

const DIST = '../../src';
// Required per suite rather than at the top, so the two end-to-end suites
// below also run — and fail on their own assertions — against a tree that
// predates the module.
const sessionTotals = () => require(`${DIST}/lib/sessionTotals.js`);
const { buildHistorySessionViewModel } = require(`${DIST}/lib/historyView.js`);
const { buildFreestyleFinish } = require(`${DIST}/lib/emptyWorkoutSession.js`);
const { adaptCompletedWorkoutSessionForAppDatabase } = require(`${DIST}/features/workout/workoutAppAdapter.js`);
const { persistCompletedWorkoutSessionToDatabase } = require(`${DIST}/state/completedWorkoutPersistence.js`);
const { buildCompletionCardsFromAdaptedSession } = require(`${DIST}/app/workoutCompletionState.js`);
const { createCompletedSession, createExercise, createSet } = require('../helpers/workoutFixtures.cjs');

const emptyDatabase = () => ({
  workoutTemplates: [],
  exerciseTemplates: [],
  workoutPlans: [],
  exerciseLibrary: [],
  workoutSessions: [],
  exerciseLogs: [],
  cardioSessions: [],
  bodyweightEntries: [],
  measurementEntries: [],
  preferences: {},
});

const done = (orderIndex, weight, reps) => ({
  orderIndex,
  weight,
  reps,
  kind: 'working',
  outcome: 'completed',
  status: 'completed',
  completedAt: '2026-09-15T17:00:00.000Z',
});
// Typed in and never ticked: the freestyle row, or a plan target nobody did.
const typed = (orderIndex, weight, reps) => ({
  orderIndex,
  weight,
  reps,
  kind: 'working',
  outcome: null,
  status: 'pending',
  completedAt: null,
});

const log = (overrides) => ({
  id: 'log',
  sessionId: 's1',
  exerciseTemplateId: null,
  exerciseNameSnapshot: 'Bench Press',
  weight: 0,
  repsPerSet: [],
  sets: [],
  tracked: true,
  orderIndex: 0,
  skipped: false,
  ...overrides,
});

/**
 * One count of what was done (audit, 2026-09-20): the sets, the kilos and the
 * exercises of a saved session are read off its logs by one rule, and every
 * surface that shows them — the completion screen, History, the stored row
 * the rest of the app reads — agrees.
 */
module.exports = [
  {
    name: 'session totals: an exercise is done when a set in it was, whatever its status says',
    run() {
      const { isExerciseDone } = sessionTotals();
      assert.equal(isExerciseDone(null), false);
      assert.equal(isExerciseDone(log({ sets: [done(0, 60, 8)], skipped: true })), false, 'a skipped lift is not done');
      assert.equal(isExerciseDone(log({ sets: [typed(0, 100, 5), typed(1, 100, 5)] })), false, 'typed is not done');
      assert.equal(isExerciseDone(log({ sets: [done(0, 60, 8), typed(1, 60, 8)] })), true, 'one set is enough');
      // The log status is not the test: a lift swapped and then done keeps
      // "swapped", and one left with a set pending stays "active".
      assert.equal(isExerciseDone(log({ status: 'swapped', sets: [done(0, 50, 10)] })), true);
      assert.equal(isExerciseDone(log({ status: 'swapped', sets: [typed(0, 50, 10)] })), false);
      assert.equal(isExerciseDone(log({ status: 'active', sets: [done(0, 50, 10), typed(1, 50, 10)] })), true);
      // A log from before set statuses existed is older than the field, not
      // pending: its rows count, as they do everywhere else.
      assert.equal(isExerciseDone(log({ weight: 60, repsPerSet: [8, 8], sets: undefined })), true);
      // A draft about to be saved has no legacy pair at all.
      assert.equal(isExerciseDone({ sets: [done(0, 20, 10)] }), true);
      assert.equal(isExerciseDone({ sets: [typed(0, 20, 10)] }), false);
    },
  },
  {
    name: 'session totals: sets, kilos and exercises done are read by the helpers History reads them with',
    run() {
      const { getSessionTotals } = sessionTotals();
      const logs = [
        log({ id: 'a', sets: [done(0, 60, 8), done(1, 60, 8)] }),
        log({ id: 'b', exerciseNameSnapshot: 'Squat', orderIndex: 1, sets: [typed(0, 100, 5), typed(1, 100, 5)] }),
        log({ id: 'c', exerciseNameSnapshot: 'Row', orderIndex: 2, skipped: true, sets: [] }),
      ];
      assert.deepEqual(getSessionTotals(logs), { setsCompleted: 2, totalVolumeKg: 960, exercisesCompleted: 1 });

      const history = buildHistorySessionViewModel(
        { id: 's1', workoutTemplateId: 't', workoutNameSnapshot: 'Free workout', performedAt: '2026-09-15T17:00:00.000Z' },
        logs,
      );
      assert.equal(history.setsCompleted, 2);
      assert.equal(history.totalVolume, 960);
      assert.equal(history.exerciseCount, 1, 'History counted every log that was not skipped');
      assert.equal(history.skippedExercises, 1);
    },
  },
  {
    name: 'session totals: a stored total is read again from the session\'s own logs',
    run() {
      const { withLoggedSessionTotals } = sessionTotals();
      // As a build before #159 wrote it: the squat typed and never ticked
      // counted as two sets and a tonne.
      const stale = { id: 's1', setsCompleted: 4, totalVolumeKg: 1960, exercisesCompleted: 2, feel: 'hard' };
      const orphan = { id: 's2', setsCompleted: 3, totalVolumeKg: 300, exercisesCompleted: 1 };
      const logs = [
        log({ id: 'a', sets: [done(0, 60, 8), done(1, 60, 8)] }),
        log({ id: 'b', exerciseNameSnapshot: 'Squat', orderIndex: 1, sets: [typed(0, 100, 5), typed(1, 100, 5)] }),
        // Another session's log does not leak into this one.
        log({ id: 'x', sessionId: 's9', sets: [done(0, 200, 5)] }),
      ];

      const [read, empty] = withLoggedSessionTotals([stale, orphan], logs);
      assert.equal(read.setsCompleted, 2);
      assert.equal(read.totalVolumeKg, 960);
      assert.equal(read.exercisesCompleted, 1);
      assert.equal(read.feel, 'hard', 'everything else on the row is kept');
      // No logs is nothing to read from: unknown, not zero, and not the
      // stored figure either — that is the number being stopped.
      assert.deepEqual(
        { sets: empty.setsCompleted, volume: empty.totalVolumeKg, exercises: empty.exercisesCompleted },
        { sets: undefined, volume: undefined, exercises: undefined },
      );
      assert.equal(stale.totalVolumeKg, 1960, 'the input rows are not mutated');
    },
  },
  {
    name: 'one count: the completion tile, the saved row and History agree on a lift swapped and never started',
    run() {
      const pending = (setIndex) =>
        createSet({
          setIndex,
          status: 'pending',
          actualLoadKg: undefined,
          actualReps: undefined,
          completedAt: undefined,
          edited: false,
          draftLoadText: '',
          draftRepsText: '',
        });
      // Bench done; the row swapped to a machine at a busy gym and then not
      // done; the curl never reached. Left through "Finish and save".
      const runtime = createCompletedSession({
        exercises: [
          createExercise({ slotId: 'a', exerciseName: 'Bench Press', orderIndex: 0 }),
          createExercise({
            slotId: 'b',
            templateExerciseId: 'row',
            exerciseName: 'Machine Row',
            sourceExerciseName: 'Barbell Row',
            status: 'swapped',
            orderIndex: 1,
            sets: [pending(0), pending(1), pending(2)],
          }),
          createExercise({ slotId: 'c', templateExerciseId: 'curl', exerciseName: 'Curl', status: 'active', orderIndex: 2, sets: [pending(0), pending(1)] }),
        ],
      });
      const adapted = adaptCompletedWorkoutSessionForAppDatabase(runtime);
      let n = 0;
      const saved = persistCompletedWorkoutSessionToDatabase(emptyDatabase(), adapted, (prefix) => `${prefix}_${++n}`);
      const session = saved.database.workoutSessions[0];
      const logs = saved.database.exerciseLogs.filter((entry) => entry.sessionId === session.id);
      assert.equal(logs.length, 2, 'the swapped row is saved, with nothing done in it');

      const history = buildHistorySessionViewModel(session, logs);
      assert.equal(saved.summary.exercisesCompleted, 1, 'the completion tile reads the save\'s count');
      assert.equal(session.exercisesCompleted, 1);
      assert.equal(history.exerciseCount, 1, 'History said 2');

      // The cards under the tile draw every lift; the ones with a set done are
      // the ones the tile counts.
      const { exerciseCards } = buildCompletionCardsFromAdaptedSession({
        exercises: adapted.exercises,
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: { byLibraryItemId: {}, byName: {}, namesWithRecordsRow: {} },
        language: 'fi',
      });
      assert.equal(exerciseCards.filter((card) => card.completedSets > 0).length, saved.summary.exercisesCompleted);
      assert.equal(saved.summary.setsCompleted, history.setsCompleted);
    },
  },
  {
    name: 'one count: a free workout counts the lifts ticked, not the lifts typed in',
    run() {
      const { summary } = buildFreestyleFinish({
        exercises: [
          {
            localKey: 'b', name: 'Bench Press', libraryItemId: null, imageUrl: null, repMin: 8, repMax: 8, restSeconds: 90,
            trackedDefault: true,
            sets: [{ localKey: 'b1', kg: '60', reps: '8', done: true }, { localKey: 'b2', kg: '60', reps: '8', done: true }],
          },
          {
            localKey: 's', name: 'Squat', libraryItemId: null, imageUrl: null, repMin: 5, repMax: 5, restSeconds: 120,
            trackedDefault: true,
            sets: [{ localKey: 's1', kg: '100', reps: '5', done: false }, { localKey: 's2', kg: '100', reps: '5', done: false }],
          },
        ],
        workoutName: 'Free workout',
        startedAtIso: '2026-09-15T16:20:00.000Z',
        performedAtIso: '2026-09-15T17:00:00.000Z',
        elapsedSeconds: 2400,
        exercisePrLookup: { byLibraryItemId: {}, byName: {}, namesWithRecordsRow: {} },
      });
      assert.equal(summary.exercisesLogged, 1, 'every named row counted');

      let n = 0;
      const saved = persistCompletedWorkoutSessionToDatabase(
        emptyDatabase(),
        {
          sessionId: 'free_1',
          workoutTemplateId: 'tpl_free',
          workoutNameSnapshot: summary.workoutName,
          logs: summary.logs,
          startedAt: summary.startedAt,
          performedAt: summary.performedAt,
        },
        (prefix) => `${prefix}_${++n}`,
      );
      const session = saved.database.workoutSessions[0];
      const history = buildHistorySessionViewModel(session, saved.database.exerciseLogs);
      assert.deepEqual(
        { exercises: history.exerciseCount, sets: history.setsCompleted, volume: history.totalVolume },
        { exercises: summary.exercisesLogged, sets: summary.setsCompleted, volume: summary.totalVolume },
        'the completion screen and History describe the same session',
      );
    },
  },
];
