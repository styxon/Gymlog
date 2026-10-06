const assert = require('node:assert/strict');

const { workoutReducer, workoutInitialState } = require('../../../.test-dist/features/workout/workoutState.js');
const { getWorkoutTemplateById } = require('../../../.test-dist/features/workout/workoutCatalog.js');
const { buildReadySessionRuntimeTemplate } = require('../../../.test-dist/lib/programDetails.js');
const { buildLoggedSetPlan } = require('../../../.test-dist/lib/loggedSetPlan.js');
const { programmeSetCount, toWorkingHistoryEntry } = require('../../../.test-dist/lib/warmupSets.js');

/**
 * A swap keeps the "added mid-session" mark (bug hunt W11, 2026-10-05, after
 * #321).
 *
 * Last time's warm-ups logged as ordinary sets are told from its work against
 * the programme's set count, which is the live sets less the ones the reader
 * added. A swap cleared that mark (to stop the added set saving as `added`
 * once the app had re-resolved its weight), so after a set was added and the
 * lift swapped, the count grew by the added sets: the "Last time" panel listed
 * the warm-up as set 1, and a second swap opened the work on it.
 */

const T0 = Date.parse('2026-10-05T09:00:00.000Z');
const FRESH = { ...workoutInitialState, hydrated: true, isRestoring: false };

function readyDay() {
  const template = getWorkoutTemplateById('tpl_3_day_full_body_v1');
  return buildReadySessionRuntimeTemplate(template, template.sessions[0].id);
}

function startReady(state = FRESH) {
  return workoutReducer(state, {
    type: 'session/startFromRuntimeTemplate',
    payload: { template: readyDay(), sessionOrderIndex: 1, unitPreference: 'kg' },
  });
}

function logSet(state, slotId, setIndex, kg, reps) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { loadText: String(kg), repsText: String(reps) } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: T0 + setIndex * 120000, unitPreference: 'kg' },
  });
}

function swap(state, slotId, exerciseName) {
  const exercise = state.activeSession.exercises.find((item) => item.slotId === slotId);
  return workoutReducer(state, {
    type: 'exercise/swap',
    payload: { slotId, exerciseName, substitutionGroup: exercise.substitutionGroup, unitPreference: 'kg' },
  });
}

/**
 * Last time's leg press, with its warm-up logged as an ordinary set ahead of
 * `workingSets` sets of the work — a session that ran one past the programme.
 */
function withWarmedUpHistory(state, exerciseName, workingSets) {
  return {
    ...state,
    history: {
      ...state.history,
      slotHistory: {
        ...state.history.slotHistory,
        history_slot: [
          {
            slotId: 'history_slot',
            templateId: 'tpl_other',
            templateName: 'Other',
            exerciseName,
            substitutionGroup: 'g',
            performedAt: '2026-09-28T09:00:00.000Z',
            sessionId: 'old_session',
            skipped: false,
            sets: [{ loadKg: 40, reps: 8 }, ...Array.from({ length: workingSets }, () => ({ loadKg: 100, reps: 8 }))].map(
              (set, setIndex) => ({ setIndex, ...set, completedAt: '2026-09-28T09:10:00.000Z' }),
            ),
          },
        ],
      },
    },
  };
}

module.exports = [
  {
    name: 'W11: a swap keeps the added-set mark, so last time\'s warm-up stays a warm-up — on the next swap and in the "Last time" panel',
    run() {
      let state = startReady();
      const slotId = state.activeSession.exercises[0].slotId;
      const programmed = state.activeSession.exercises[0].sets.length;
      state = logSet(state, slotId, 0, 60, 8);
      state = workoutReducer(state, { type: 'exercise/addSet', payload: { slotId } });
      state = withWarmedUpHistory(state, 'Leg Press', programmed);

      // First swap: to a lift with no history.
      state = swap(state, slotId, 'Hack Squat');
      let exercise = state.activeSession.exercises[0];
      assert.equal(exercise.sets.length, programmed + 1);
      assert.equal(exercise.sets[programmed].addedMidSession, true, 'still past the programme');
      assert.equal(programmeSetCount(exercise.sets), programmed);
      assert.equal(buildLoggedSetPlan(exercise.sets[programmed]).basis, 'none', 'and the app\'s number, not the reader\'s');

      // The "Last time" panel for the leg press reads last time against the
      // programme's count (GuidedPlayerScreen resolveSlotHistory).
      const [entry] = state.history.slotHistory.history_slot;
      const last = toWorkingHistoryEntry(entry, programmeSetCount(exercise.sets));
      assert.deepEqual(last.sets.map((set) => set.loadKg), Array(programmed).fill(100), 'set 1 is the work, not the 40');

      // Second swap: the leg press opens on its work, not on last time's warm-up.
      state = swap(state, slotId, 'Leg Press');
      exercise = state.activeSession.exercises[0];
      const pending = exercise.sets.filter((set) => set.status === 'pending');
      assert.ok(pending.length > 0);
      assert.deepEqual(pending.map((set) => set.plannedLoadKg), pending.map(() => 100));
      assert.equal(exercise.sets[programmed].addedMidSession, true);
      assert.equal(buildLoggedSetPlan(exercise.sets[programmed]).basis, 'borrowed');
    },
  },
  {
    name: 'W11: the screen reads the programme\'s count through programmeSetCount, not a count a swap can change',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'screens', 'GuidedPlayerScreen.tsx'), 'utf8');
      assert.match(screen, /toWorkingHistoryEntry\(found, instance \? programmeSetCount\(instance\.sets\) : found\.sets\.length\)/);
    },
  },
];
