const assert = require('node:assert/strict');

const { elapsedSecondsOf } = require('../../src/features/workout/workoutState');

/**
 * "Eikö tauko tarkoita että tauko treenistä ja sitten jatkuu kun valmis" —
 * reported 2026-08-21. The workout clock was plain wall time from `startedAt`,
 * so pausing froze the step countdown on screen and the session clock carried
 * on behind it.
 */
const START = new Date('2026-08-21T10:00:00.000Z').getTime();

function session(overrides = {}) {
  return {
    startedAt: new Date(START).toISOString(),
    pausedMs: 0,
    pausedAt: null,
    ...overrides,
  };
}

const MINUTE = 60 * 1000;

module.exports = [
  {
    name: 'pause clock: a workout that was never paused reads as wall time',
    run() {
      assert.equal(elapsedSecondsOf(session(), START + 30 * MINUTE), 1800);
    },
  },
  {
    name: 'pause clock: a closed pause comes off the total',
    run() {
      // Half an hour in, ten of them spent waiting for a rack.
      assert.equal(elapsedSecondsOf(session({ pausedMs: 10 * MINUTE }), START + 30 * MINUTE), 1200);
    },
  },
  {
    name: 'pause clock: an open pause stops the clock where it stood',
    run() {
      const paused = session({ pausedAt: new Date(START + 20 * MINUTE).toISOString() });

      // The clock reads 20 minutes now, and still reads 20 minutes later —
      // which is the whole point of a pause.
      assert.equal(elapsedSecondsOf(paused, START + 20 * MINUTE), 1200);
      assert.equal(elapsedSecondsOf(paused, START + 35 * MINUTE), 1200);
      assert.equal(elapsedSecondsOf(paused, START + 90 * MINUTE), 1200);
    },
  },
  {
    name: 'pause clock: earlier pauses and an open one both count',
    run() {
      const paused = session({
        pausedMs: 5 * MINUTE,
        pausedAt: new Date(START + 25 * MINUTE).toISOString(),
      });

      assert.equal(elapsedSecondsOf(paused, START + 40 * MINUTE), 20 * 60);
    },
  },
  {
    name: 'pause clock: a session stored before pauses existed still reads',
    run() {
      // Sessions persisted by an older build carry neither field, and a
      // workout in progress across an update must not read as NaN.
      const legacy = { startedAt: new Date(START).toISOString() };
      assert.equal(elapsedSecondsOf(legacy, START + 12 * MINUTE), 720);
    },
  },
  {
    name: 'pause clock: nothing reads as negative',
    run() {
      // Clocks move backwards — a timezone change, a manual correction. A
      // negative duration would be written to history as one.
      assert.equal(elapsedSecondsOf(session(), START - 5 * MINUTE), 0);
      assert.equal(elapsedSecondsOf(session({ pausedMs: 99 * MINUTE }), START + MINUTE), 0);
    },
  },
];
