const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createEmptyDatabase } = require('../../src/data/seed');
const { mergeStoredBoardLogs, freestyleLogsOf } = require('../../src/lib/emptyWorkoutSession');
const { persistCompletedWorkoutSessionToDatabase } = require('../../src/state/completedWorkoutPersistence');
const { workoutReducer, workoutInitialState } = require('../../src/features/workout/workoutState');

/**
 * A free workout board finished again under the id its earlier save holds (bug hunt 2026-10-03).
 *
 * A board that came back carried on after its save (a draft that reached it before the database had loaded) used to
 * be saved beside that save under `<id>_b`, every set the two shared counted twice. It is merged into it under the
 * same id, by place: the lift's key on the board and the set's position in it.
 */

let rowKey = 0;
const row = (kg, reps, done = true) => ({ localKey: `s${(rowKey += 1)}`, kg: String(kg), reps: String(reps), done });
const liftOn = (localKey, name, sets) => ({ localKey, name, libraryItemId: null, imageUrl: null, repMin: 8, repMax: 12, restSeconds: 90, trackedDefault: true, sets });
const logsOf = (board) =>
  freestyleLogsOf(board).map((log) => ({
    ...log,
    sets: log.sets.map((set) => ({ ...set, completedAt: set.status === 'completed' ? '2026-10-03T10:00:00.000Z' : null })),
  }));
const input = (logs, extra = {}) => ({
  sessionId: 'session_board',
  workoutTemplateId: 'tpl_freestyle',
  workoutNameSnapshot: 'Free workout',
  logs,
  startedAt: '2026-10-03T09:00:00.000Z',
  performedAt: '2026-10-03T10:00:00.000Z',
  ...extra,
});
const doneOf = (logs) =>
  [...logs]
    .sort((x, y) => x.orderIndex - y.orderIndex)
    .flatMap((log) => log.sets.filter((s) => s.status === 'completed').map((s) => `${log.exerciseNameSnapshot}:${s.reps}@${s.weight}`));

module.exports = [
  {
    name: 'a free workout board finished again merges into its save by place: an edited set once, an added one added, a stored one the board lacks kept, nothing twice',
    run() {
      const first = [liftOn('l1', 'Bench Press', [row(60, 8), row(62.5, 6)]), liftOn('l2', 'Row', [row(50, 10)])];
      const stored = persistCompletedWorkoutSessionToDatabase(createEmptyDatabase('en'), input(logsOf(first))).database;
      const storedLogs = stored.exerciseLogs;

      // Carried on: the second bench set's weight corrected, a third set and a curl added.
      const carried = [
        liftOn('l1', 'Bench Press', [row(60, 8), row(65, 6), row(65, 5)]),
        liftOn('l2', 'Row', [row(50, 10)]),
        liftOn('l3', 'Curl', [row(20, 12)]),
      ];
      assert.deepEqual(doneOf(mergeStoredBoardLogs(storedLogs, logsOf(carried))), [
        'Bench Press:8@60',
        'Bench Press:6@65',
        'Bench Press:5@65',
        'Row:10@50',
        'Curl:12@20',
      ]);
      // The board came back before the row was ticked (a draft behind its save) and the reader logs on: the row stays.
      const behind = [liftOn('l1', 'Bench Press', [row(60, 8), row(62.5, 6), row(65, 5)]), liftOn('l2', 'Row', [row(50, 10, false)])];
      assert.deepEqual(doneOf(mergeStoredBoardLogs(storedLogs, logsOf(behind))), [
        'Bench Press:8@60',
        'Bench Press:6@62.5',
        'Bench Press:5@65',
        'Row:10@50',
      ]);

      const merged = persistCompletedWorkoutSessionToDatabase(stored, input(logsOf(carried), { mergeStored: true, mergeBy: 'place' }));
      assert.equal(merged.didPersist, true);
      assert.equal(merged.summary.sessionId, 'session_board', 'the same id, not `<id>_b`');
      assert.equal(merged.database.workoutSessions.length, 1, 'one workout');
      const saved = merged.database.workoutSessions[0];
      assert.equal(saved.setsCompleted, 5);
      assert.equal(saved.totalVolumeKg, 8 * 60 + 6 * 65 + 5 * 65 + 10 * 50 + 12 * 20, 'the volume of one workout, not two');
      assert.equal(saved.workoutTemplateId, 'tpl_freestyle', 'the template the save hangs on');

      const again = persistCompletedWorkoutSessionToDatabase(merged.database, input(logsOf(carried), { mergeStored: true, mergeBy: 'place' }));
      assert.equal(again.didPersist, false, 'the same board again writes nothing');
      assert.equal(again.wasStored, true);
    },
  },
  {
    name: 'a free workout finished again goes through the merge, keeps its template, is counted once, and never says the save failed after it landed',
    run() {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'finishSaves.tsx'), 'utf8').replace(/\r\n/g, '\n');
      const fn = source.slice(source.indexOf('const finishLoggedWorkoutSave = async'), source.indexOf('return { handleDiscardWorkout'));
      assert.match(fn, /const storedRow = summary\.sessionId \? getDatabase\(\)\.workoutSessions\.find\(\(row\) => row\.id === sessionId\) : undefined;/);
      assert.match(fn, /workoutTemplateId: storedRow\.workoutTemplateId,[\s\S]*?mergeStored: true,\s*mergeBy: 'place',/);
      assert.ok(fn.indexOf('upsertWorkoutTemplate(draft)') > fn.indexOf('if (storedRow) {'), 'a new template only for a first save');
      assert.match(fn, /if \(firstSave\) \{\s*countWorkoutCompleted\(landedAs\);/);
      // The summary's tiles and name are the stored row's: after a merge it holds stored sets the board no longer shows.
      assert.match(fn, /workoutName: storedRow\?\.workoutNameSnapshot \?\? summary\.workoutName,/);
      assert.match(fn, /\{ setsCompleted: saved\.setsCompleted, totalVolume: saved\.totalVolume, exercisesLogged: saved\.exercisesCompleted \}/);
      // After the save landed, a failure is logged and the board is left, never rethrown as a failed save.
      const after = fn.slice(fn.indexOf('// The sets are on disk.'));
      assert.match(after, /\} catch \(error\) \{\s*console\.error\('Failed after the free workout was saved', error\);\s*navigateBack\(getWorkoutLoggerFallbackRoute\(\)\);\s*\}/);
      assert.doesNotMatch(after, /^\s*throw /m);
    },
  },
  {
    name: 'a workout recorded again replaces its own entry in the slot history',
    run() {
      const record = (sessionId, kg) => ({
        type: 'history/recordLogged',
        payload: {
          performedAt: '2026-10-03T10:00:00.000Z',
          sessionId,
          templateName: 'Free workout',
          exercises: [{ exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: kg, reps: 8 }] }],
        },
      });
      let state = { ...workoutInitialState, hydrated: true };
      state = workoutReducer(state, record('session_old', 50));
      state = workoutReducer(state, record('session_board', 60));
      state = workoutReducer(state, record('session_board', 65));
      const entries = state.history.slotHistory['logged:bench press'];
      assert.deepEqual(entries.map((entry) => `${entry.sessionId}:${entry.sets[0].loadKg}`), ['session_board:65', 'session_old:50']);
      // Two rows of one lift in one session (top sets, then back-off) are both recorded, and both replaced next time.
      const twoRows = (sessionId, top, backOff) => ({
        type: 'history/recordLogged',
        payload: {
          performedAt: '2026-10-03T10:00:00.000Z',
          sessionId,
          templateName: 'Free workout',
          exercises: [
            { exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: top, reps: 5 }] },
            { exerciseName: 'Bench Press', sets: [{ setIndex: 0, loadKg: backOff, reps: 12 }] },
          ],
        },
      });
      state = workoutReducer(state, twoRows('session_board', 100, 70));
      state = workoutReducer(state, twoRows('session_board', 102.5, 70));
      assert.deepEqual(
        state.history.slotHistory['logged:bench press'].map((entry) => `${entry.sessionId}:${entry.sets[0].loadKg}`),
        ['session_board:70', 'session_board:102.5', 'session_old:50'],
      );
    },
  },
  {
    // Bug hunt 5 (2026-10-03): the board's record cards were read against a database that already held this
    // session's first save, so the set that set the record the first time was its own previous best.
    name: 'a free workout board finished again keeps its record cards: compared with what came before it, not with its own save',
    run() {
      const { buildFreestyleFinish } = require('../../src/lib/emptyWorkoutSession');
      const { buildExercisePrLookup, buildExercisePrLookupBefore } = require('../../src/lib/workoutCompletionSummary');
      const tablesOf = (db) => ({ exerciseLogs: db.exerciseLogs, workoutSessions: db.workoutSessions, exerciseTemplates: db.exerciseTemplates });
      const board = [liftOn('l1', 'Bench Press', [row(100, 5)])];
      const finish = (db, performedAtIso) => {
        const full = buildExercisePrLookup(tablesOf(db));
        return buildFreestyleFinish({
          exercises: board,
          workoutName: 'Free workout',
          startedAtIso: '2026-10-03T09:00:00.000Z',
          performedAtIso,
          elapsedSeconds: 3600,
          exercisePrLookup: buildExercisePrLookupBefore(tablesOf(db), 'session_board', full),
          sessionId: 'session_board',
        });
      };
      // An earlier workout with a lighter bench: the board beats it.
      let db = persistCompletedWorkoutSessionToDatabase(
        createEmptyDatabase('en'),
        input(logsOf([liftOn('o1', 'Bench Press', [row(90, 5)])]), { sessionId: 'session_old', performedAt: '2026-10-01T10:00:00.000Z', startedAt: '2026-10-01T09:00:00.000Z' }),
      ).database;
      const first = finish(db, '2026-10-03T10:00:00.000Z');
      assert.deepEqual(first.summary.prCards.map((card) => `${card.exerciseName} ${card.previousBestWeightKg}->${card.performedWeightKg}`), ['Bench Press 90->100']);
      db = persistCompletedWorkoutSessionToDatabase(db, input(first.summary.logs)).database;

      const again = finish(db, '2026-10-03T10:05:00.000Z');
      assert.deepEqual(
        again.summary.prCards.map((card) => `${card.exerciseName} ${card.previousBestWeightKg}->${card.performedWeightKg}`),
        ['Bench Press 90->100'],
        'the record it set the first time, against the same previous best',
      );
      // No earlier save under that id: the lookup the caller already has, not a rebuilt one.
      const full = buildExercisePrLookup(tablesOf(db));
      assert.equal(buildExercisePrLookupBefore(tablesOf(db), 'session_new', full), full);
      assert.equal(buildExercisePrLookupBefore(tablesOf(db), undefined, full), full);

      // Wired: the board asks for the lookup for the id it finishes under, and the shell hands it the one that leaves it out.
      const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
      assert.match(read('src', 'screens', 'EmptyWorkoutScreen.tsx'), /exercisePrLookup: exercisePrLookupBefore\(sessionIdRef\.current\),\s*sessionId: sessionIdRef\.current \?\? undefined,/);
      assert.match(read('src', 'app', 'renderWorkoutTab.tsx'), /exercisePrLookupBefore=\{exercisePrLookupBefore\}/);
      assert.match(read('src', 'app', 'useCustomProgramViews.ts'), /buildExercisePrLookupBefore\(\s*\{[^}]*\},\s*sessionId,\s*exercisePrLookup,\s*\)/);
      assert.match(read('src', 'app', 'finishSaves.tsx'), /const priorPrLookup = buildExercisePrLookupBefore\(database, adaptedSession\.sessionId, exercisePrLookup\);/);
    },
  },
];
