const assert = require('node:assert/strict');

const { guidedClockHeld } = require('../../.test-dist/lib/guidedClockHold.js');

const NONE = {
  paused: false,
  howToOpen: false,
  exitOpen: false,
  pauseSheetOpen: false,
  swapOpen: false,
  addExerciseOpen: false,
  restEditOpen: false,
  runSheetOpen: false,
  ownBlockActive: false,
  restAlertsAskOpen: false,
  confirmingEnd: false,
  confirmingSkipExercise: false,
};

module.exports = [
  {
    name: 'guided clock: the contents sheet never holds a running rest (#bugs 2026-10-06)',
    run() {
      assert.equal(guidedClockHeld(NONE), false);
      assert.equal(guidedClockHeld({ ...NONE, runSheetOpen: true }), false);
    },
  },
  {
    name: 'guided clock: every other overlay holds it, with or without the contents sheet open',
    run() {
      for (const key of Object.keys(NONE)) {
        if (key === 'runSheetOpen') {
          continue;
        }
        assert.equal(guidedClockHeld({ ...NONE, [key]: true }), true, key);
        assert.equal(guidedClockHeld({ ...NONE, [key]: true, runSheetOpen: true }), true, `${key} + sheet`);
      }
    },
  },
  {
    name: 'guided clock: closing another overlay over the open contents sheet releases the clock',
    run() {
      // A correction opened over the sheet holds the rest; once it is saved
      // the rest runs again even with the contents sheet still open.
      const correcting = { ...NONE, runSheetOpen: true, restEditOpen: true };
      assert.equal(guidedClockHeld(correcting), true);
      assert.equal(guidedClockHeld({ ...correcting, restEditOpen: false }), false);
    },
  },
  {
    name: 'guided clock: a rest does not run out behind "End workout?" (hunt 2026-10-09)',
    run() {
      // The exit sheet closes before the confirmation opens, so the dialog
      // has to hold the clock by itself.
      assert.equal(guidedClockHeld({ ...NONE, exitOpen: false, confirmingEnd: true }), true);
      assert.equal(guidedClockHeld({ ...NONE, pauseSheetOpen: false, confirmingSkipExercise: true }), true);
    },
  },
];
