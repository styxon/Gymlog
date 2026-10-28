const assert = require('node:assert/strict');

const { workoutReducer } = require('../../../src/features/workout/workoutState');
const { withNumberLanguage } = require('../../../src/lib/format');

/**
 * Correcting a set that is already logged.
 *
 * The rest screen offers "Edit" on the set just finished, and until 2026-09-04
 * that walked back to the set screen — which showed a completed set whose Log
 * button `set/complete` refuses, because completing a completed set would move
 * the session's pointer a second time. So the way back was a way to nowhere.
 *
 * This is the other act: the numbers change, the session does not move.
 */
function sessionWith(set, trackingMode = 'load_and_reps') {
  return {
    activeSession: {
      id: 's1',
      startedAt: '2026-09-04T10:00:00.000Z',
      updatedAt: '2026-09-04T10:00:00.000Z',
      status: 'active',
      ui: { activeSlotId: 'slot_1', activeSetIndex: 1 },
      restTimer: null,
      exercises: [
        {
          slotId: 'slot_1',
          exerciseName: 'Back Squat',
          status: 'active',
          trackingMode,
          sets: [
            {
              setIndex: 0,
              plannedRepsMin: 5,
              plannedRepsMax: 5,
              draftLoadText: '70',
              draftRepsText: '5',
              effort: null,
              edited: false,
              ...set,
            },
          ],
        },
      ],
    },
  };
}

const edit = (state, payload) =>
  workoutReducer(state, { type: 'set/editLogged', payload: { slotId: 'slot_1', setIndex: 0, ...payload } });

const logged = { status: 'completed', actualReps: 5, actualLoadKg: 70 };

module.exports = [
  {
    name: 'a logged set takes new numbers, and its drafts follow them',
    run() {
      // The draft is written in the reader's number language, so this test
      // sets the one it expects: it used to inherit whatever the suite before
      // it left behind, and failed alone with '72,5' (#bugs 2026-10-01).
      // withNumberLanguage puts the previous language back afterwards.
      const next = withNumberLanguage('en', () => edit(sessionWith(logged), { reps: 6, loadKg: 72.5 }));
      const set = next.activeSession.exercises[0].sets[0];
      assert.equal(set.actualReps, 6);
      assert.equal(set.actualLoadKg, 72.5);
      // Reopening the set screen must show what the set now says, not what it
      // said when it was logged.
      assert.equal(set.draftRepsText, '6');
      assert.equal(set.draftLoadText, '72.5');
      // And a Finnish reader's draft carries a Finnish decimal comma.
      const finnish = withNumberLanguage('fi', () => edit(sessionWith(logged), { reps: 6, loadKg: 72.5 }));
      assert.equal(finnish.activeSession.exercises[0].sets[0].draftLoadText, '72,5');
      assert.equal(set.edited, true);
      // Still logged, and the session has not moved.
      assert.equal(set.status, 'completed');
      assert.equal(next.activeSession.ui.activeSetIndex, 1);
    },
  },
  {
    name: 'a set that is not logged is not edited — it is completed, which is a different act',
    run() {
      const pending = sessionWith({ status: 'pending' });
      assert.equal(edit(pending, { reps: 6, loadKg: 72.5 }), pending);
      const skipped = sessionWith({ status: 'skipped' });
      assert.equal(edit(skipped, { reps: 6, loadKg: 72.5 }), skipped);
    },
  },
  {
    name: 'numbers that are not numbers leave the set alone',
    run() {
      const state = sessionWith(logged);
      // Zero or negative reps would log a set nobody did.
      assert.equal(edit(state, { reps: 0, loadKg: 70 }), state);
      assert.equal(edit(state, { reps: -3, loadKg: 70 }), state);
      assert.equal(edit(state, { reps: Number.NaN, loadKg: 70 }), state);
      // A loaded lift needs a load; null is not one.
      assert.equal(edit(state, { reps: 5, loadKg: null }), state);
      assert.equal(edit(state, { reps: 5, loadKg: Number.NaN }), state);
    },
  },
  {
    name: 'a bodyweight lift is edited by reps alone, and keeps no weight',
    run() {
      const next = edit(sessionWith({ ...logged, actualLoadKg: 0 }, 'bodyweight'), {
        reps: 12,
        loadKg: null,
      });
      const set = next.activeSession.exercises[0].sets[0];
      assert.equal(set.actualReps, 12);
      assert.equal(set.actualLoadKg, 0);
      assert.equal(set.draftLoadText, '');
    },
  },
  {
    name: 'a slot or a set that is not there changes nothing',
    run() {
      const state = sessionWith(logged);
      assert.equal(
        workoutReducer(state, {
          type: 'set/editLogged',
          payload: { slotId: 'nope', setIndex: 0, reps: 6, loadKg: 70 },
        }),
        state,
      );
      assert.equal(edit(state, { setIndex: 9, reps: 6, loadKg: 70 }), state);
      const empty = { activeSession: null };
      assert.equal(edit(empty, { reps: 6, loadKg: 70 }), empty);
    },
  },
];
