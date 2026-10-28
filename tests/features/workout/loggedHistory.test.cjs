const assert = require('node:assert/strict');

const { workoutReducer } = require('../../../src/features/workout/workoutState');
const {
  findLatestEntryForExerciseName,
} = require('../../../src/lib/exerciseHistoryLookup');

/**
 * A weight remembered from a workout that never went through the player.
 *
 * The weight a set opens on comes from the provider's slot history, and the
 * only writer was the guided player's own finish. A lift done in an empty
 * workout therefore left no trace the prefill could see and opened at nothing
 * the next time — while the numbers sat in the database, and while the
 * lookup's own doc comment claimed empty workouts were covered ("paino
 * automaattisesti siihen mitä on viimeksi tehnyt", #bugs 2026-08-27).
 */
const EMPTY = {
  activeSession: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
};

function record(state, payload) {
  return workoutReducer(state, { type: 'history/recordLogged', payload });
}

function session(performedAt, exercises) {
  return { performedAt, sessionId: `s_${performedAt}`, templateName: 'Empty workout', exercises };
}

module.exports = [
  {
    name: 'a freestyle session becomes something the named lookup can find',
    run() {
      const next = record(
        EMPTY,
        session('2026-08-27T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [{ setIndex: 0, loadKg: 92.5, reps: 5 }] },
        ]),
      );
      const found = findLatestEntryForExerciseName(next.history.slotHistory, 'Back Squat', {
        requireLoaded: true,
      });
      assert.equal(found.sets[0].loadKg, 92.5);
      assert.equal(found.performedAt, '2026-08-27T10:00:00.000Z');
    },
  },
  {
    /**
     * The name is matched, not the slot — so the same lift found under a
     * programme slot and under a freestyle key is one history, and the newest
     * entry wins whichever side it came from.
     */
    name: 'the newest session wins, whichever way it was logged',
    run() {
      const withGuided = {
        ...EMPTY,
        history: {
          ...EMPTY.history,
          slotHistory: {
            'tpl:day:slot_1': [
              {
                slotId: 'tpl:day:slot_1',
                templateId: 'tpl',
                templateName: 'HOME Starter',
                exerciseName: 'Back Squat',
                substitutionGroup: 'squat',
                performedAt: '2026-08-20T10:00:00.000Z',
                sessionId: 'old',
                sets: [{ setIndex: 0, loadKg: 80, reps: 5, completedAt: '2026-08-20T10:00:00.000Z', effort: null }],
                skipped: false,
              },
            ],
          },
        },
      };
      const next = record(
        withGuided,
        session('2026-08-27T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [{ setIndex: 0, loadKg: 92.5, reps: 5 }] },
        ]),
      );
      // The programme's own entry is untouched — this only adds.
      assert.equal(next.history.slotHistory['tpl:day:slot_1'].length, 1);
      const found = findLatestEntryForExerciseName(next.history.slotHistory, 'Back Squat', {
        requireLoaded: true,
      });
      assert.equal(found.sets[0].loadKg, 92.5);
    },
  },
  {
    /**
     * An exercise put on the board and never performed is not a weight.
     * Filing it would open the next session on nothing while claiming a
     * source for it.
     */
    name: 'an exercise with no sets is not filed',
    run() {
      const next = record(
        EMPTY,
        session('2026-08-27T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [] },
          { exerciseName: '   ', sets: [{ setIndex: 0, loadKg: 60, reps: 5 }] },
        ]),
      );
      assert.deepEqual(Object.keys(next.history.slotHistory), []);
    },
  },
  {
    name: 'the same lift logged twice keeps both, newest first',
    run() {
      let state = record(
        EMPTY,
        session('2026-08-20T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [{ setIndex: 0, loadKg: 80, reps: 5 }] },
        ]),
      );
      state = record(
        state,
        session('2026-08-27T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [{ setIndex: 0, loadKg: 85, reps: 5 }] },
        ]),
      );
      const entries = state.history.slotHistory['logged:back squat'];
      assert.equal(entries.length, 2);
      assert.equal(entries[0].sets[0].loadKg, 85);
    },
  },
  {
    /**
     * Freestyle logging must not disturb a session in progress: it is filed
     * after a save, and the player may be mid-workout on something else.
     */
    name: 'filing history leaves an active session alone',
    run() {
      const active = { ...EMPTY, activeSession: { id: 'live', exercises: [] } };
      const next = record(
        active,
        session('2026-08-27T10:00:00.000Z', [
          { exerciseName: 'Back Squat', sets: [{ setIndex: 0, loadKg: 80, reps: 5 }] },
        ]),
      );
      assert.equal(next.activeSession, active.activeSession);
    },
  },
];
