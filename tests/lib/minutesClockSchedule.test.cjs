const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  minutesToLog,
  msUntilNextMinutesChange,
  startStopwatch,
  pauseStopwatch,
  stopwatchElapsedMs,
  STOPPED_STOPWATCH,
} = require('../../.test-dist/lib/minutesExercises.js');

/**
 * The guided player's set step used to re-render twice a second to keep a
 * minutes stopwatch's seconds moving. It needs only two readings from the
 * clock - the whole minutes on the dial and "planned minutes reached" - and
 * both change rarely, so the step now sleeps until msUntilNextMinutesChange
 * and a child draws the seconds on its own interval. The invariant that makes
 * that safe: between now and the returned moment neither reading changes, and
 * at it one of them does.
 */

const readings = (watch, nowMs, plannedMinutes) => {
  const elapsedMs = stopwatchElapsedMs(watch, nowMs);
  return {
    shown: minutesToLog({ plannedMinutes, elapsedMs }),
    reached: plannedMinutes > 0 && elapsedMs >= plannedMinutes * 60000,
    started: elapsedMs > 0,
  };
};

function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

module.exports = [
  {
    name: 'minutes clock: a stopped watch has nothing to wake for',
    run() {
      assert.equal(msUntilNextMinutesChange(STOPPED_STOPWATCH, 1000, 20), null);
      const paused = pauseStopwatch(startStopwatch(STOPPED_STOPWATCH, 0), 90000);
      assert.equal(msUntilNextMinutesChange(paused, 500000, 20), null);
    },
  },
  {
    name: 'minutes clock: between wake-ups neither the dial minutes nor "reached" change, and at the wake-up one does',
    run() {
      const random = rng(7);
      let wakeups = 0;
      for (let round = 0; round < 400; round += 1) {
        const planned = [0, 1, 4, 5, 15, 20][Math.floor(random() * 6)];
        const accumulatedMs = Math.floor(random() * 25 * 60000);
        const watch = { accumulatedMs, runningSinceMs: 1000 };
        let nowMs = 1000 + Math.floor(random() * 3 * 60000);
        // Walk a run of wake-ups, as the screen does.
        for (let step = 0; step < 12; step += 1) {
          const wait = msUntilNextMinutesChange(watch, nowMs, planned);
          assert.ok(Number.isInteger(wait) && wait >= 1, `wait ${wait}`);
          const before = readings(watch, nowMs, planned);
          // Nothing moves up to the last millisecond before the wake-up...
          for (const fraction of [0, 0.25, 0.5, 0.99]) {
            const probe = nowMs + Math.floor((wait - 1) * fraction);
            assert.deepEqual(readings(watch, probe, planned), before, `moved early (planned ${planned}, wait ${wait}, +${fraction})`);
          }
          // ...and at it, something has.
          const after = readings(watch, nowMs + wait, planned);
          assert.notDeepEqual(after, before, `nothing changed at the wake-up (planned ${planned}, elapsed ${stopwatchElapsedMs(watch, nowMs)})`);
          wakeups += 1;
          nowMs += wait;
        }
      }
      assert.ok(wakeups > 4000);
    },
  },
  {
    name: 'minutes clock: a bout from the first tap reaches its plan exactly at plan minutes, and the dial moves at 1:30 and each minute after',
    run() {
      const watch = startStopwatch(STOPPED_STOPWATCH, 0);
      // First moment of time: the dial leaves the prescription.
      assert.equal(msUntilNextMinutesChange(watch, 0, 20), 1);
      assert.equal(msUntilNextMinutesChange(watch, 1, 20), 90000 - 1);
      assert.equal(msUntilNextMinutesChange(watch, 90000, 20), 60000);
      // A 2-minute plan: the 1:30 mark, then the plan at 2:00.
      assert.equal(msUntilNextMinutesChange(watch, 90000, 2), 30000);
      assert.equal(readings(watch, 120000, 2).reached, true);
      assert.equal(readings(watch, 119999, 2).reached, false);
    },
  },
  {
    name: 'minutes clock: the set step no longer ticks its own state, and logs what the clock says at the tap',
    run() {
      const source = fs.readFileSync(path.join(__dirname, '../../src/screens/GuidedPlayerScreen.tsx'), 'utf8');
      // The 500 ms state tick that re-rendered the whole step is gone.
      assert.doesNotMatch(source, /setInterval\(\(\) => setWatchNowMs\(Date\.now\(\)\), 500\)/);
      // It sleeps to the next change instead.
      assert.match(source, /msUntilNextMinutesChange\(/);
      // The seconds are drawn by a child that owns its interval.
      assert.match(source, /function MinutesClockText\(/);
      assert.match(source, /<MinutesClockText\b/);
      // The tap reads the clock then, not the last render's minutes.
      assert.match(source, /minutesToLog\(\{\s*plannedMinutes,\s*elapsedMs: stopwatchElapsedMs\(watch, Date\.now\(\)\)\s*\}\)/);
      assert.doesNotMatch(source, /minutesMode \? shownMinutes : reps, bodyweight/);
    },
  },
];
