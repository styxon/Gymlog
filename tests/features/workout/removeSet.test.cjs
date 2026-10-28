const assert = require('node:assert/strict');

const { workoutReducer } = require('../../../src/features/workout/workoutState');

/**
 * Taking a set back, the other half of adding one.
 *
 * The set row has carried a "+" since the pause sheet stopped owning it, and
 * nothing beside it — so a set added by a mis-tap stayed for the rest of the
 * exercise (#bugs 2026-08-26, "punainen − ikoni"). The two refusals below are
 * the reason this is a reducer case rather than a slice of an array in the
 * screen: what may be removed is a rule about the session, not about a button.
 */
function sessionWith(sets) {
  return {
    activeSession: {
      id: 's1',
      startedAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-27T10:00:00.000Z',
      status: 'active',
      // Where the reader is lives under `ui`, not on the session itself.
      ui: { activeSlotId: 'slot_1', activeSetIndex: 0 },
      restTimer: null,
      exercises: [
        {
          slotId: 'slot_1',
          exerciseName: 'Hip Thrust',
          status: 'active',
          sets: sets.map((status, index) => ({
            setIndex: index,
            plannedRepsMin: 8,
            plannedRepsMax: 8,
            draftLoadText: '',
            draftRepsText: '',
            status,
            effort: null,
            edited: false,
          })),
        },
      ],
    },
  };
}

const remove = (state) => workoutReducer(state, { type: 'exercise/removeSet', payload: { slotId: 'slot_1' } });

module.exports = [
  {
    // Break round, 2026-09-28: every set left was logged, the lift stayed
    // 'active', and History badged a finished lift "Partial".
    name: 'taking back the only set left to do finishes the lift',
    run() {
      const next = remove(sessionWith(['completed', 'completed', 'pending']));
      assert.equal(next.activeSession.exercises[0].sets.length, 2);
      assert.equal(next.activeSession.exercises[0].status, 'completed');

      // Sets still to do: the lift is as it was.
      assert.equal(remove(sessionWith(['completed', 'pending', 'pending'])).activeSession.exercises[0].status, 'active');
      // Recheck of #222: finished, the lift is no longer the one in front of
      // the reader — the next lift with a set to do is.
      const two = sessionWith(['completed', 'pending']);
      two.activeSession.exercises.push({
        ...two.activeSession.exercises[0],
        slotId: 'slot_2',
        exerciseName: 'Row',
        status: 'pending',
        sets: two.activeSession.exercises[0].sets.map((set) => ({ ...set, status: 'pending' })),
      });
      const moved = remove(two).activeSession;
      assert.equal(moved.exercises[0].status, 'completed');
      assert.equal(moved.ui.activeSlotId, 'slot_2', 'the finished lift stayed the active one');
      assert.equal(moved.ui.activeSetIndex, 0);

      // And a lift not started is not started by removing a set from it.
      const untouched = sessionWith(['pending', 'pending']);
      untouched.activeSession.exercises[0].status = 'pending';
      assert.equal(remove(untouched).activeSession.exercises[0].status, 'pending');
    },
  },
  {
    name: 'the last pending set can be taken back',
    run() {
      const next = remove(sessionWith(['completed', 'pending', 'pending']));
      assert.equal(next.activeSession.exercises[0].sets.length, 2);
      // The set that stays is the one before it, and it is where you are now.
      assert.equal(next.activeSession.ui.activeSetIndex, 1);
    },
  },
  {
    /**
     * Removing a logged set would throw away work through a control meant for
     * planning. Undoing a logged set is a different action with its own path.
     */
    name: 'a set you have already logged is not removed',
    run() {
      const before = sessionWith(['completed', 'completed']);
      const after = remove(before);
      assert.equal(after.activeSession.exercises[0].sets.length, 2);
    },
  },
  {
    name: 'the last set standing stays — an exercise with no sets is not an exercise',
    run() {
      const after = remove(sessionWith(['pending']));
      assert.equal(after.activeSession.exercises[0].sets.length, 1);
    },
  },
  {
    name: 'an unknown slot and a dead session change nothing',
    run() {
      const state = sessionWith(['pending', 'pending']);
      const other = workoutReducer(state, { type: 'exercise/removeSet', payload: { slotId: 'nope' } });
      assert.equal(other.activeSession.exercises[0].sets.length, 2);
      const empty = workoutReducer({ activeSession: null }, {
        type: 'exercise/removeSet',
        payload: { slotId: 'slot_1' },
      });
      assert.equal(empty.activeSession, null);
    },
  },
];
