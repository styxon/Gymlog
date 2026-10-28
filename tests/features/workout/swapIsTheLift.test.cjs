const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../../src/features/workout/workoutState');
const { getWorkoutTemplateById } = require('../../../src/features/workout/workoutCatalog');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../../src/features/workout/customWorkoutAdapter');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../../src/features/workout/workoutAppAdapter');
const { buildCustomSessionRuntimeTemplate, buildReadySessionRuntimeTemplate } = require('../../../src/lib/programDetails');
const { applySessionAdaptation } = require('../../../src/lib/sessionAdaptation');
const { persistCompletedWorkoutSessionToDatabase } = require('../../../src/state/completedWorkoutPersistence');
const { getLiftHistoryByName, getTrackedExerciseProgress } = require('../../../src/lib/progression');
const { normalizeExerciseLog } = require('../../../src/lib/exerciseLog');
const { resolveGuidedSetTarget } = require('../../../src/lib/guidedPlayer');
const { isUnloadedTrackingMode } = require('../../../src/features/workout/workoutTypes');
const { createEmptyDatabase } = require('../../../src/data/seed');
const { buildCompletionCardsFromAdaptedSession } = require('../../../src/app/workoutCompletionState');
const { buildExercisePrLookup } = require('../../../src/lib/workoutCompletionSummary');

/**
 * The lift that was lifted is the lift that is saved (swap audit, 2026-09-21).
 *
 * Three ways a swap used to put numbers under the wrong lift: the swapped-in
 * lift kept the slot's tracking mode (no weight dial on a lat pulldown), the
 * reader's own programmes filed a swapped-in lift under the programme's
 * exercise, and a swap mid-exercise filed the sets done before it under the
 * lift that replaced it.
 */

const T0 = Date.parse('2026-09-21T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };

function start(runtime, state = FRESH, orderIndex = 1) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: runtime, sessionOrderIndex: orderIndex, unitPreference: 'kg' },
  });
}

function readyDay(templateId, sessionIndex) {
  const template = getWorkoutTemplateById(templateId);
  return buildReadySessionRuntimeTemplate(template, template.sessions[sessionIndex].id);
}

function log(state, slotId, setIndex, kg, reps, atMs = T0 + setIndex * 120000) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText: kg === null ? '' : String(kg), repsText: String(reps) } },
  });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId, setIndex, nowMs: atMs, unitPreference: 'kg' } });
}

function swap(state, slotId, exerciseName) {
  const exercise = state.activeSession.exercises.find((item) => item.slotId === slotId);
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
  });
}

function save(session, database = { ...createEmptyDatabase(), workoutSessions: [], exerciseLogs: [] }) {
  const adapted = adaptCompletedWorkoutSessionForAppDatabase(session, T0 + 3600000);
  let n = 0;
  return { adapted, database: persistCompletedWorkoutSessionToDatabase(database, adapted, (prefix) => `${prefix}_${++n}`).database };
}

const progressRow = (database, key) => getTrackedExerciseProgress(database).find((row) => row.key === key) ?? null;

/** The reader's own programme: one day, one back squat. */
const MY_SQUAT = {
  id: 'ex_my_squat',
  workoutTemplateId: 'wt_mine',
  workoutTemplateSessionId: 'wts_day1',
  name: 'Back Squat',
  targetSets: 3,
  repMin: 5,
  repMax: 8,
  restSeconds: 120,
  trackedDefault: true,
  orderIndex: 0,
  libraryItemId: null,
};

function myProgrammeDay() {
  return buildCustomSessionRuntimeTemplate(
    adaptLegacyWorkoutTemplateToRuntimeTemplate(
      { id: 'wt_mine', name: 'My Programme', exerciseIds: [MY_SQUAT.id], sessions: [], createdAt: '', updatedAt: '' },
      [{ id: 'wts_day1', workoutTemplateId: 'wt_mine', name: 'Day 1', orderIndex: 0, exercises: [MY_SQUAT] }],
      [],
      90,
    ),
    'wts_day1',
  );
}

function myDatabase() {
  const empty = createEmptyDatabase();
  return { ...empty, exerciseTemplates: [...empty.exerciseTemplates, MY_SQUAT], workoutSessions: [], exerciseLogs: [] };
}

module.exports = [
  {
    name: 'swap is the lift: a pull-up swapped for a lat pulldown asks for, and saves, the weight',
    run() {
      let state = start(readyDay('tpl_gainer_athlete_conditioning_v1', 3));
      const pullUp = state.activeSession.exercises.find((item) => item.exerciseName === 'Pull-Up');
      assert.equal(pullUp.trackingMode, 'bodyweight');
      state = swap(state, pullUp.slotId, 'Lat Pulldown (Wide Grip)');
      const pulldown = state.activeSession.exercises.find((item) => item.slotId === pullUp.slotId);
      // The set screen reads this to show the weight dial.
      assert.equal(isUnloadedTrackingMode(pulldown.trackingMode), false);
      state = log(state, pullUp.slotId, 0, 50, 12);
      const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.find((row) => row.slotId === pullUp.slotId);
      assert.deepEqual(saved.sets.filter((set) => set.status === 'completed').map((set) => `${set.weight}x${set.reps}`), ['50x12']);
    },
  },
  {
    name: 'swap is the lift: a loaded slot swapped to a lift only the library knows keeps its weight dial',
    run() {
      // CI review of #170: the library filed a weighted squat and a banded
      // bench press as "bodyweight". Taken at its word, the swap from the
      // sheet's library search hid the dial and saved 0 kg. The weighted
      // squat is loaded in the library now (2026-09-21), so the rule is held
      // to a lift it still files as bodyweight: a banded squat.
      const { getCatalogTrackingMode } = require('../../../src/lib/catalogExercisePools');
      assert.equal(getCatalogTrackingMode('Squats - With Bands'), 'bodyweight');
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];
      assert.equal(squat.trackingMode, 'load_and_reps');
      state = swap(state, squat.slotId, 'Squats - With Bands');
      const weighted = state.activeSession.exercises[0];
      assert.equal(isUnloadedTrackingMode(weighted.trackingMode), false);
      state = log(state, squat.slotId, 0, 60, 8);
      const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.find((row) => row.slotId === squat.slotId);
      assert.deepEqual(saved.sets.filter((set) => set.status === 'completed').map((set) => `${set.weight}x${set.reps}`), ['60x8']);

      // The same swap made on Home before the start.
      const day = readyDay('tpl_3_day_full_body_v1', 0);
      const bench = day.sessions[0].exercises.find((exercise) => exercise.exerciseName === 'Bench Press');
      const banded = applySessionAdaptation(day, { swaps: { [bench.slotId]: 'Bench Press - With Bands' }, drops: [] })
        .sessions[0].exercises.find((exercise) => exercise.slotId === bench.slotId);
      assert.equal(banded.exerciseName, 'Bench Press - With Bands');
      assert.equal(isUnloadedTrackingMode(banded.trackingMode), false);
    },
  },
  {
    name: 'swap is the lift: a hold swapped for a loaded lift stops counting seconds',
    run() {
      let state = start(readyDay('tpl_gainer_advanced_glutes_v1', 4));
      const bridge = state.activeSession.exercises.find((item) => item.exerciseName === 'Glute Bridge Hold');
      assert.equal(bridge.trackingMode, 'hold');
      state = swap(state, bridge.slotId, 'Barbell Hip Thrust');
      const thrust = state.activeSession.exercises.find((item) => item.slotId === bridge.slotId);
      assert.equal(thrust.trackingMode, 'load_and_reps');
      const target = resolveGuidedSetTarget(thrust.sets, 0, thrust.trackingMode);
      assert.equal(target.timed, undefined);
      // The hold's seconds are not the hip thrust's repetitions.
      assert.ok(bridge.sets[0].plannedRepsMax >= 30);
      assert.ok(target.reps <= 15, `the hip thrust opens at ${target.reps} reps`);
      state = log(state, bridge.slotId, 0, 80, 10);
      const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.find((row) => row.slotId === bridge.slotId);
      assert.equal(saved.sets[0].weight, 80);
    },
  },
  {
    name: 'swap is the lift: a set logged before the swap keeps the mode it was logged in',
    run() {
      let state = start(readyDay('tpl_gainer_athlete_conditioning_v1', 3));
      const slotId = state.activeSession.exercises.find((item) => item.exerciseName === 'Pull-Up').slotId;
      state = log(state, slotId, 0, null, 8);
      state = swap(state, slotId, 'Lat Pulldown (Wide Grip)');
      state = log(state, slotId, 1, 50, 12);
      // Correcting the pull-up set does not ask it for a weight it never had.
      const corrected = workoutReducer(state, { type: 'set/editLogged', payload: { slotId, setIndex: 0, reps: 9, loadKg: null } });
      assert.notEqual(corrected, state);
      assert.equal(corrected.activeSession.exercises.find((item) => item.slotId === slotId).sets[0].actualReps, 9);
      // And the finish screen reads each lift in its own terms.
      const rows = adaptCompletedWorkoutSessionForAppDatabase(corrected.activeSession).exercises.filter((row) =>
        row.slotId.startsWith(slotId),
      );
      assert.deepEqual(rows.map((row) => [row.exerciseName, row.trackingMode]), [
        ['Pull-Up', 'bodyweight'],
        ['Lat Pulldown (Wide Grip)', 'load_and_reps'],
      ]);
    },
  },
  {
    name: "swap is the lift: in the reader's own programme a swapped-in lift is saved under its own name",
    run() {
      let state = start(myProgrammeDay());
      const slotId = state.activeSession.exercises[0].slotId;
      state = swap(state, slotId, 'Leg Press');
      for (let index = 0; index < 3; index += 1) {
        state = log(state, slotId, index, 200, 10);
      }
      const { adapted, database } = save(state.activeSession, myDatabase());
      assert.equal(adapted.logs[0].exerciseTemplateId, null);
      assert.equal(adapted.logs[0].swappedFrom, 'Back Squat');
      assert.equal(progressRow(database, 'leg press').latestWeight, 200);
      assert.equal(progressRow(database, 'back squat'), null);
      const history = getLiftHistoryByName(database);
      assert.equal(history.get('back squat'), undefined);
      assert.equal(history.get('leg press')[0].sets.length, 3);
      // A swap is not the legacy shape the session's diagnostics count.
      assert.deepEqual(adapted.legacyShapeMismatches, []);
    },
  },
  {
    name: "swap is the lift: a swap made on Home before the start is saved the same way as one made in the player",
    run() {
      const day = myProgrammeDay();
      const slotKey = day.sessions[0].exercises[0].slotId;
      let state = start(applySessionAdaptation(day, { swaps: { [slotKey]: 'Leg Press' }, drops: [] }));
      const exercise = state.activeSession.exercises[0];
      assert.equal(exercise.sourceExerciseName, 'Back Squat');
      for (let index = 0; index < 3; index += 1) {
        state = log(state, exercise.slotId, index, 200, 10);
      }
      const { adapted, database } = save(state.activeSession, myDatabase());
      assert.equal(adapted.logs[0].swappedFrom, 'Back Squat');
      assert.equal(adapted.logs[0].exerciseTemplateId, null);
      assert.equal(progressRow(database, 'leg press').latestWeight, 200);
      assert.equal(progressRow(database, 'back squat'), null);
    },
  },
  {
    name: 'swap is the lift: a swap made on Home is on record once it is done, and saves nothing until then',
    run() {
      const day = readyDay('tpl_3_day_full_body_v1', 0);
      const squatSlot = day.sessions[0].exercises[0].slotId;
      let state = start(applySessionAdaptation(day, { swaps: { [squatSlot]: 'Goblet Squat' }, drops: [] }));
      const goblet = state.activeSession.exercises[0];
      assert.equal(goblet.sourceExerciseName, 'Back Squat');
      // Found in review of this change: with the swap on record, "a swap is
      // on record" kept the row even with nothing done — an untouched session
      // was saved as a finished workout instead of being discarded, and a
      // row nobody did went into History as a partial lift.
      assert.deepEqual(adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs, []);
      const bench = state.activeSession.exercises[1];
      state = log(state, bench.slotId, 0, 80, 5);
      assert.deepEqual(
        adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.map((row) => row.exerciseNameSnapshot),
        [bench.exerciseName],
      );

      // Done, it is the goblet squat, and says what it replaced.
      state = log(state, goblet.slotId, 0, 30, 10);
      const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.find((row) => row.slotId === goblet.slotId);
      assert.deepEqual([saved.exerciseNameSnapshot, saved.swappedFrom], ['Goblet Squat', 'Back Squat']);

      // A swap made in the player is still on record with nothing after it.
      state = swap(state, state.activeSession.exercises[2].slotId, 'Seated Cable Row');
      assert.ok(
        adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.some((row) => row.exerciseNameSnapshot === 'Seated Cable Row'),
      );
    },
  },
  {
    name: 'swap is the lift: swapped after its last set, the slot is saved as the lift that was done',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];
      squat.sets.forEach((item) => {
        state = log(state, squat.slotId, item.setIndex, 100, 5);
      });
      state = swap(state, squat.slotId, 'Goblet Squat');
      state = workoutReducer(state, { type: 'exercise/updateNotes', payload: { slotId: squat.slotId, notes: 'Knees fine' } });
      const adapted = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession);
      assert.deepEqual(
        adapted.logs.filter((row) => row.slotId === squat.slotId).map((row) => [row.exerciseNameSnapshot, row.sets.length, row.notes]),
        [['Back Squat', squat.sets.length, 'Knees fine']],
      );
      // One card, under the slot's own id.
      assert.deepEqual(
        adapted.exercises.filter((row) => row.slotId.startsWith(squat.slotId)).map((row) => [row.slotId, row.exerciseName]),
        [[squat.slotId, 'Back Squat']],
      );
    },
  },
  {
    name: 'swap is the lift: a swap already saved under the programmed lift is read under its own name',
    run() {
      // Saved before the fix: the leg press log still carries the back
      // squat's template id. It is filed under the lift it names on load.
      const stored = normalizeExerciseLog({
        id: 'log_old',
        sessionId: 'session_old',
        exerciseTemplateId: 'ex_my_squat',
        exerciseNameSnapshot: 'Leg Press',
        weight: 200,
        repsPerSet: [10, 10, 10],
        tracked: true,
        orderIndex: 0,
        swappedFrom: 'Back Squat',
      });
      assert.equal(stored.exerciseTemplateId, null);
      const unswapped = normalizeExerciseLog({ ...stored, id: 'log_plain', swappedFrom: null, exerciseTemplateId: 'ex_my_squat' });
      assert.equal(unswapped.exerciseTemplateId, 'ex_my_squat');
      // Swapped away and back, an older build saved the squat "swapped from"
      // itself. That is the programmed lift, and it keeps its template.
      const swappedBack = normalizeExerciseLog({
        ...stored,
        id: 'log_back',
        exerciseNameSnapshot: 'Back Squat',
        swappedFrom: 'Back Squat',
        exerciseTemplateId: 'ex_my_squat',
      });
      assert.equal(swappedBack.exerciseTemplateId, 'ex_my_squat');
      // And it loads as no swap at all: History's badge, the swap counts and
      // Progress read the same answer.
      assert.equal(swappedBack.swappedFrom, null);
      assert.equal(stored.swappedFrom, 'Back Squat');

      const database = {
        ...myDatabase(),
        workoutSessions: [{ id: 'session_old', workoutTemplateId: 'wt_mine', workoutNameSnapshot: 'Day 1', performedAt: '2026-09-10T09:00:00.000Z' }],
        exerciseLogs: [stored],
      };
      assert.equal(progressRow(database, 'leg press').latestWeight, 200);
      assert.equal(progressRow(database, 'back squat'), null);
    },
  },
  {
    name: 'swap is the lift: a swap mid-exercise saves the sets before it under the lift they were',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = state.activeSession.exercises[0];
      assert.equal(squat.exerciseName, 'Back Squat');
      state = log(state, squat.slotId, 0, 100, 5);
      state = log(state, squat.slotId, 1, 100, 5);
      state = swap(state, squat.slotId, 'Goblet Squat');
      state = log(state, squat.slotId, 2, 30, 10);

      const { adapted, database } = save(state.activeSession);
      const logs = adapted.logs.filter((row) => row.slotId === squat.slotId);
      assert.deepEqual(
        logs.map((row) => [row.exerciseNameSnapshot, row.swappedFrom, row.status, row.sets.map((set) => `${set.orderIndex}:${set.weight}x${set.reps}`)]),
        [
          ['Back Squat', null, 'completed', ['0:100x5', '1:100x5']],
          ['Goblet Squat', 'Back Squat', 'swapped', ['0:30x10']],
        ],
      );
      // Progress and the lift history see two lifts.
      assert.equal(progressRow(database, 'back squat').latestWeight, 100);
      assert.equal(progressRow(database, 'goblet squat').latestWeight, 30);
      assert.deepEqual(getLiftHistoryByName(database).get('goblet squat')[0].sets, [{ weight: 30, reps: 10 }]);

      // The finish screen: one row per lift, told apart, and no record for
      // the goblet squat out of the back squat's hundred kilos.
      const cards = buildCompletionCardsFromAdaptedSession({
        exercises: adapted.exercises,
        exerciseTemplates: [],
        exerciseLibrary: [],
        exercisePrLookup: buildExercisePrLookup({ exerciseLogs: [], workoutSessions: [], exerciseTemplates: [] }),
        language: 'en',
      });
      const squatCards = cards.exerciseCards.filter((card) => card.id.startsWith(squat.slotId));
      assert.deepEqual(squatCards.map((card) => [card.name, card.completedSets]), [
        ['Back Squat', 2],
        ['Goblet Squat', 1],
      ]);
      assert.equal(new Set(cards.exerciseCards.map((card) => card.id)).size, cards.exerciseCards.length);
      const gobletPr = cards.prCards.find((card) => card.exerciseName === 'Goblet Squat');
      assert.equal(gobletPr.performedWeightKg, 30);
    },
  },
  {
    name: 'swap is the lift: after a swap mid-exercise, each lift opens next time on what it lifted',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      for (let index = 0; index < 3; index += 1) {
        state = log(state, slotId, index, 90, 5);
      }
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: '2026-09-14T09:00:00.000Z' } });
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      state = start(readyDay('tpl_3_day_full_body_v1', 0), state, 2);
      state = log(state, slotId, 0, 100, 5);
      state = log(state, slotId, 1, 100, 5);
      state = swap(state, slotId, 'Leg Press');
      state = log(state, slotId, 2, 200, 10);
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: '2026-09-21T09:00:00.000Z' } });
      assert.deepEqual(
        state.history.slotHistory[slotId].slice(0, 2).map((entry) => [entry.exerciseName, entry.swappedFrom, entry.sets.map((set) => `${set.setIndex}:${set.loadKg}`)]),
        [
          ['Leg Press', 'Back Squat', ['0:200']],
          ['Back Squat', undefined, ['0:100', '1:100']],
        ],
      );
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      // Next time the back squat opens on today's 100, not last week's 90.
      let next = start(readyDay('tpl_3_day_full_body_v1', 0), state, 3);
      const squat = next.activeSession.exercises[0];
      assert.equal(resolveGuidedSetTarget(squat.sets, 0, squat.trackingMode).loadKg, 100);
      // And the leg press, swapped in again, opens on its own 200.
      next = swap(next, slotId, 'Leg Press');
      const press = next.activeSession.exercises[0];
      assert.equal(resolveGuidedSetTarget(press.sets, 0, press.trackingMode, press.swappedAfterSetIndex).loadKg, 200);
    },
  },
  {
    /*
     * Review of #170: a slot that held two lifts stores each one's sets
     * numbered from 0, and the swap's prefill asked that history by the slot's
     * own index. Swapped in at index 0 the two agree, which is the only case
     * the suite above tries; swapped in after two sets of something else, the
     * leg press asked its history for set 2, found nothing, and opened empty.
     */
    name: 'swap is the lift: a lift swapped in mid-exercise again opens on what it lifted',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      state = log(state, slotId, 0, 100, 5);
      state = log(state, slotId, 1, 100, 5);
      state = swap(state, slotId, 'Leg Press');
      state = log(state, slotId, 2, 200, 10);
      state = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: '2026-09-14T09:00:00.000Z' } });
      state = workoutReducer(state, { type: 'session/clearCompletedSession' });

      let next = start(readyDay('tpl_3_day_full_body_v1', 0), state, 2);
      next = log(next, slotId, 0, 100, 5);
      next = log(next, slotId, 1, 100, 5);
      next = swap(next, slotId, 'Leg Press');
      const press = next.activeSession.exercises[0];
      const pending = press.sets.filter((set) => set.status === 'pending');
      assert.ok(pending.length > 0, 'the swap leaves sets to do');
      assert.equal(pending[0].setIndex, 2, 'the first set of the leg press is the slot\'s third');
      assert.equal(pending[0].plannedLoadKg, 200, 'and it opens on the leg press\'s own first set');
      assert.equal(pending[0].draftLoadText, '200');
    },
  },
  {
    name: 'swap is the lift: a set added after the swap takes nothing from the lift before it',
    run() {
      // Review of #170: every hold set done, a swap to a hip thrust, then
      // "add set" — the new set copied the last set's 60 (seconds) as reps.
      let state = start(readyDay('tpl_gainer_advanced_glutes_v1', 4));
      const bridge = state.activeSession.exercises.find((item) => item.exerciseName === 'Glute Bridge Hold');
      bridge.sets.forEach((item) => {
        state = log(state, bridge.slotId, item.setIndex, null, 60);
      });
      state = swap(state, bridge.slotId, 'Barbell Hip Thrust');
      state = workoutReducer(state, { type: 'exercise/addSet', payload: { slotId: bridge.slotId } });
      const thrust = state.activeSession.exercises.find((item) => item.slotId === bridge.slotId);
      const added = thrust.sets[thrust.sets.length - 1];
      assert.equal(added.status, 'pending');
      assert.ok(added.plannedRepsMax <= 15, `the added hip thrust set asks for ${added.plannedRepsMax}`);

      // Nor the old lift's weight: three squats at 100, a swap to goblet
      // squats, and the added set opened on the squat's 100.
      let squatState = start(readyDay('tpl_3_day_full_body_v1', 0));
      const squat = squatState.activeSession.exercises[0];
      squat.sets.forEach((item) => {
        squatState = log(squatState, squat.slotId, item.setIndex, 100, 5);
      });
      squatState = swap(squatState, squat.slotId, 'Goblet Squat');
      squatState = workoutReducer(squatState, { type: 'exercise/addSet', payload: { slotId: squat.slotId } });
      const goblet = squatState.activeSession.exercises[0];
      const gobletSet = goblet.sets[goblet.sets.length - 1];
      assert.equal(gobletSet.plannedLoadKg, undefined);
      assert.equal(resolveGuidedSetTarget(goblet.sets, gobletSet.setIndex, goblet.trackingMode, goblet.swappedAfterSetIndex).loadKg, null);
      // Same unit, so the same numbers.
      assert.equal(gobletSet.plannedRepsMax, squat.sets[0].plannedRepsMax);
    },
  },
  {
    name: 'swap is the lift: a set taken back after the swap and logged again is the new lift',
    run() {
      let state = start(readyDay('tpl_3_day_full_body_v1', 0));
      const slotId = state.activeSession.exercises[0].slotId;
      state = log(state, slotId, 0, 100, 5);
      state = log(state, slotId, 1, 100, 5);
      state = swap(state, slotId, 'Goblet Squat');
      state = workoutReducer(state, { type: 'set/undo', payload: { slotId, setIndex: 1 } });
      // Taken back, it is a set still ahead — of the lift the slot holds now.
      const squatRow = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.find(
        (row) => row.slotId === slotId && row.exerciseNameSnapshot === 'Back Squat',
      );
      assert.deepEqual(squatRow.sets.map((set) => set.status), ['completed']);
      state = log(state, slotId, 1, 30, 10);
      state = log(state, slotId, 2, 30, 10);
      const logs = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession).logs.filter((row) => row.slotId === slotId);
      // The line the swap drew still covers set 1, but the set logged again
      // under it was a goblet squat; set 0, never taken back, is the squat.
      assert.deepEqual(
        logs.map((row) => [row.exerciseNameSnapshot, row.sets.filter((set) => set.status === 'completed').map((set) => set.weight)]),
        [
          ['Back Squat', [100]],
          ['Goblet Squat', [30, 30]],
        ],
      );
    },
  },
];
