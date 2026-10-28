const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { workoutReducer, completeWorkoutSession, resolveInstanceBorrowRepWindow } = require('../../../.test-dist/features/workout/workoutState');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../../.test-dist/features/workout/workoutAppAdapter');
const { resolveLastTimeEntry } = require('../../../.test-dist/lib/exerciseHistoryLookup');
const { isUnloadedTrackingMode } = require('../../../.test-dist/features/workout/workoutTypes');
const { persistCompletedWorkoutSessionToDatabase } = require('../../../.test-dist/state/completedWorkoutPersistence');
const { applyProgramSessionEdit } = require('../../../.test-dist/lib/programSessionEdit');
const { createCompletedSession, createExercise, createSet } = require('../../helpers/workoutFixtures.cjs');
const { readAppWiring } = require('../../helpers/appWiringSource.cjs');
const { functionBody } = require('../../helpers/sourceSlices.cjs');

/**
 * Session and history audit, 2026-09-15: what a finished workout leaves behind
 * has to be what happened, and belong to the lift that did it.
 */

const EMPTY = {
  activeSession: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  nowMs: 0,
};

const FIRST_AT = '2026-09-01T09:00:00.000Z';
const SWAPPED_AT = '2026-09-04T09:00:00.000Z';

function template() {
  return {
    id: 'tpl_lower',
    name: 'Lower',
    defaultScheduleMode: 'weekly',
    sessions: [
      {
        id: 'lower_a',
        name: 'Lower A',
        orderIndex: 0,
        exercises: [
          {
            id: 'e_hinge',
            exerciseName: 'Trap Bar Deadlift',
            slotId: 'hinge',
            role: 'primary',
            progressionPriority: 'high',
            trackingMode: 'load_and_reps',
            sets: 3,
            repsMin: 5,
            repsMax: 8,
            restSecondsMin: 120,
            restSecondsMax: 180,
            substitutionGroup: 'hinge',
          },
        ],
      },
    ],
  };
}

function start(state, orderIndex) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: template(), sessionOrderIndex: orderIndex, unitPreference: 'kg' },
  });
}

function logSet(state, slotId, setIndex, loadText, repsText, atIso) {
  const drafted = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId, setIndex, patch: { loadText, repsText } } });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId, setIndex, nowMs: Date.parse(atIso), unitPreference: 'kg' } });
}

function finish(state, atIso) {
  const done = workoutReducer(state, { type: 'session/finishWorkout', payload: { performedAt: atIso } });
  return workoutReducer(done, { type: 'session/clearCompletedSession' });
}

/** Trap bar 3 × 5 at 140, then a session where it was swapped for leg press 3 × 10 at 200. */
function afterSwappedSession() {
  let state = start(EMPTY, 0);
  const slotId = state.activeSession.exercises[0].slotId;
  for (let index = 0; index < 3; index += 1) {
    state = logSet(state, slotId, index, '140', '5', FIRST_AT);
  }
  state = finish(state, FIRST_AT);

  state = start(state, 1);
  state = workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName: 'Leg Press', substitutionGroup: 'hinge', unitPreference: 'kg' },
  });
  for (let index = 0; index < 3; index += 1) {
    state = logSet(state, slotId, index, '200', '10', SWAPPED_AT);
  }
  return { state: finish(state, SWAPPED_AT), slotId };
}

function panelLastTime(state, instance) {
  return resolveLastTimeEntry({
    slotHistory: state.history.slotHistory,
    slotId: instance.slotId,
    templateSlotId: instance.templateSlotId,
    exerciseName: instance.exerciseName,
    requireLoaded: !isUnloadedTrackingMode(instance.trackingMode),
    repWindow: resolveInstanceBorrowRepWindow(instance),
  });
}

module.exports = [
  {
    name: 'history: a swapped-in lift’s weights do not open the programmed lift next time',
    run() {
      const { state: afterSwap, slotId } = afterSwappedSession();
      // The premise: both sessions sit under the one slot id.
      assert.deepEqual(afterSwap.history.slotHistory[slotId].map((entry) => entry.exerciseName), ['Leg Press', 'Trap Bar Deadlift']);

      const state = start(afterSwap, 2);
      const instance = state.activeSession.exercises[0];
      assert.equal(instance.exerciseName, 'Trap Bar Deadlift');
      // It opens on its own last session, not on the leg press.
      assert.equal(instance.sets[0].draftLoadText, '140');
      const shown = panelLastTime(state, instance);
      assert.ok(shown);
      assert.equal(shown.entry.exerciseName, 'Trap Bar Deadlift');
      assert.equal(shown.entry.performedAt, FIRST_AT);
      assert.equal(shown.borrowed, false);
    },
  },
  {
    name: 'history: a deleted workout is forgotten by prefill and "Last time"',
    run() {
      let state = start(EMPTY, 0);
      const slotId = state.activeSession.exercises[0].slotId;
      for (let index = 0; index < 3; index += 1) {
        state = logSet(state, slotId, index, '140', '5', FIRST_AT);
      }
      state = finish(state, FIRST_AT);
      state = start(state, 1);
      const typoSessionId = state.activeSession.sessionId;
      for (let index = 0; index < 3; index += 1) {
        state = logSet(state, slotId, index, '450', '5', SWAPPED_AT);
      }
      state = finish(state, SWAPPED_AT);

      state = workoutReducer(state, { type: 'history/forgetSession', payload: { sessionId: typoSessionId } });
      assert.equal(state.history.slotHistory[slotId].some((entry) => entry.sessionId === typoSessionId), false);
      assert.equal(state.history.sessions.some((summary) => summary.sessionId === typoSessionId), false);

      const next = start(state, 2);
      assert.equal(next.activeSession.exercises[0].sets[0].draftLoadText, '140');
      assert.equal(panelLastTime(next, next.activeSession.exercises[0]).entry.performedAt, FIRST_AT);

      // A session the history never had changes nothing, and returns the same state.
      assert.equal(workoutReducer(state, { type: 'history/forgetSession', payload: { sessionId: 'nope' } }), state);
    },
  },
  {
    name: 'history: finishing the same session twice files it once',
    run() {
      let state = start(EMPTY, 0);
      const slotId = state.activeSession.exercises[0].slotId;
      state = logSet(state, slotId, 0, '140', '5', FIRST_AT);
      const once = completeWorkoutSession(state, FIRST_AT);
      const twice = completeWorkoutSession(once, FIRST_AT);
      assert.equal(twice, once);
      assert.equal(twice.history.slotHistory[slotId].length, 1);
      assert.equal(twice.history.sessions.length, 1);
    },
  },
  {
    name: 'history: the saved duration leaves the pauses out, as the player’s clock did',
    run() {
      const session = createCompletedSession({
        status: 'active',
        startedAt: '2026-09-10T15:00:00.000Z',
        updatedAt: '2026-09-10T16:15:00.000Z',
        completedAt: undefined,
        pausedMs: 30 * 60 * 1000,
        pausedAt: null,
        exercises: [createExercise({ sets: [createSet({ setIndex: 0, completedAt: '2026-09-10T16:10:00.000Z' })] })],
      });
      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);
      assert.equal(adapted.performedAt, '2026-09-10T16:15:00.000Z');
      assert.equal(adapted.durationMinutes, 45);

      // And the save writes that number, not finish minus start.
      const database = { workoutSessions: [], exerciseLogs: [], workoutTemplates: [], exerciseTemplates: [], workoutPlans: [], preferences: {} };
      const { database: saved, summary } = persistCompletedWorkoutSessionToDatabase(database, adapted, (prefix) => `${prefix}_1`);
      assert.equal(summary.durationMinutes, 45);
      assert.equal(saved.workoutSessions[0].durationMinutes, 45);
      // Without a count of its own (a freestyle or imported session), start to finish still applies.
      const { summary: wall } = persistCompletedWorkoutSessionToDatabase(database, { ...adapted, durationMinutes: undefined }, (prefix) => `${prefix}_1`);
      assert.equal(wall.durationMinutes, 75);
    },
  },
  {
    name: 'history: a session reopened days later is saved on the day it was trained',
    run() {
      // Closed mid-rest on the 10th; the clock moved updatedAt to the 13th on reopening.
      const session = createCompletedSession({
        status: 'active',
        startedAt: '2026-09-10T15:00:00.000Z',
        updatedAt: '2026-09-13T08:00:00.000Z',
        completedAt: undefined,
        pausedMs: 0,
        pausedAt: null,
        exercises: [
          createExercise({
            sets: [
              createSet({ setIndex: 0, completedAt: '2026-09-10T15:20:00.000Z' }),
              createSet({ setIndex: 1, completedAt: '2026-09-10T15:48:00.000Z' }),
            ],
          }),
        ],
      });
      const adapted = adaptCompletedWorkoutSessionForAppDatabase(session);
      assert.equal(adapted.performedAt, '2026-09-10T15:48:00.000Z');
      assert.equal(adapted.durationMinutes, 48);
    },
  },
  {
    name: 'history: a workout paused, left for days and resumed keeps its own length, not one minute',
    run() {
      // PR #120 review: last set 15:48, paused 15:50, resumed three days later —
      // `pausedMs` now holds three days, and all of it came off a 48-minute workout.
      const base = {
        status: 'active',
        startedAt: '2026-09-10T15:00:00.000Z',
        updatedAt: '2026-09-13T16:00:00.000Z',
        completedAt: undefined,
        pausedMs: 72 * 60 * 60 * 1000 + 10 * 60 * 1000,
        pausedAt: null,
        exercises: [createExercise({ sets: [createSet({ setIndex: 0, completedAt: '2026-09-10T15:48:00.000Z' })] })],
      };
      // Ten minutes of pause had run by the last set.
      const stamped = adaptCompletedWorkoutSessionForAppDatabase(createCompletedSession({ ...base, pausedMsAtLastSet: 10 * 60 * 1000 }));
      assert.equal(stamped.performedAt, '2026-09-10T15:48:00.000Z');
      assert.equal(stamped.durationMinutes, 38);
      // A session from before the stamp: its pauses swallow the window, so the wall clock.
      const legacy = adaptCompletedWorkoutSessionForAppDatabase(createCompletedSession(base));
      assert.equal(legacy.durationMinutes, 48);

      // The reducer stamps the pause time on every logged set, open pause included.
      let state = start(EMPTY, 0);
      const slotId = state.activeSession.exercises[0].slotId;
      state = { ...state, activeSession: { ...state.activeSession, pausedMs: 5 * 60 * 1000, pausedAt: '2026-09-10T15:40:00.000Z' } };
      state = logSet(state, slotId, 0, '140', '5', '2026-09-10T15:42:00.000Z');
      assert.equal(state.activeSession.pausedMsAtLastSet, 7 * 60 * 1000);
      // And the reducer's own summary reads the same way.
      const completed = completeWorkoutSession(
        { ...state, activeSession: { ...state.activeSession, startedAt: '2026-09-10T15:00:00.000Z', pausedMs: 72 * 60 * 60 * 1000, pausedAt: null } },
        '2026-09-10T15:42:00.000Z',
      );
      assert.equal(completed.completionSummary.durationMinutes, 35);
    },
  },
  {
    name: 'history: replacing a lift in a programme gives the row a new id, so the old lift keeps its history',
    run() {
      const sessions = [
        {
          id: 'day_1',
          name: 'Day 1',
          exercises: [
            { id: 'ex_bench', name: 'Bench Press', targetSets: 3, repMin: 5, repMax: 8, restSeconds: 120, trackedDefault: true, libraryItemId: 'lib_bench', supersetGroup: null },
          ],
        },
      ];
      const result = applyProgramSessionEdit(sessions, 'day_1', { kind: 'replace', exerciseId: 'ex_bench', exerciseName: 'Incline Dumbbell Press', libraryItemId: 'lib_incline' }, undefined, () => 'ex_new');
      assert.equal(result.kind, 'save');
      const row = result.sessions[0].exercises[0];
      assert.equal(row.id, 'ex_new');
      assert.equal(row.name, 'Incline Dumbbell Press');
      // A dose change is the same lift, and keeps its id.
      const dosed = applyProgramSessionEdit(sessions, 'day_1', { kind: 'prescribe', exerciseId: 'ex_bench', prescription: { targetSets: 4, repMin: 5, repMax: 8, restSeconds: null } }, undefined, () => 'ex_new');
      assert.equal(dosed.sessions[0].exercises[0].id, 'ex_bench');
    },
  },
  {
    name: 'history: the finish is guarded by a ref, and History’s delete reaches the workout store',
    run() {
      // The route-to-screen dispatch moved out of App.tsx into src/app/renderAppContent.tsx.
      const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'renderAppContent.tsx'), 'utf8').replace(/\r\n/g, '\n');
      // The finish handler on its own, wherever the shell keeps it: it leaves
      // VinhaApp in the phase-C split (2026-10-01), and its old neighbour
      // handleDeleteCompletedSession no longer bounds it.
      const finish = functionBody(readAppWiring().replace(/\r\n/g, '\n'), 'async function handleConfirmFinishWorkout()');
      // Two taps inside one render both read the state as idle.
      assert.match(finish, /if \(!activeSession \|\| finishInFlightRef\.current\) \{\s*return;/);
      assert.doesNotMatch(finish, /finishSaveState\.status === 'saving'/);
      assert.match(finish, /finally \{\s*finishInFlightRef\.current = false;\s*\}/);

      // The delete over the whole shell: App.tsx or the src/app module it
      // stands in.
      const remove = functionBody(readAppWiring().replace(/\r\n/g, '\n'), 'async function handleDeleteCompletedSession(');
      assert.ok(remove.indexOf('await deleteCompletedWorkoutSession(sessionId);') >= 0);
      assert.ok(remove.indexOf('await deleteCompletedWorkoutSession(sessionId);') < remove.indexOf('workout.forgetHistorySession(sessionId);'));
      assert.match(app, /deleteCompletedWorkoutSession: handleDeleteCompletedSession,/);
    },
  },
];
