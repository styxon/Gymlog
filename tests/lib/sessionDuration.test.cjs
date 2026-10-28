const assert = require('node:assert/strict');

const {
  EXERCISE_SETUP_SECONDS,
  SECONDS_PER_REP,
  SET_SETUP_SECONDS,
  estimateSessionMinutes,
  estimateSessionSeconds,
  estimateWorkingSetSeconds,
} = require('../../src/lib/sessionDuration');

module.exports = [
  {
    name: 'a set costs its reps, so 5 and 15 stop taking the same time',
    run() {
      // The rule of thumb this replaces was "a set is about a minute". At ten
      // reps that still holds — it just stops being true of every set.
      assert.equal(estimateWorkingSetSeconds(10), 10 * SECONDS_PER_REP + SET_SETUP_SECONDS);
      assert.equal(estimateWorkingSetSeconds(10), 55);
      assert.ok(estimateWorkingSetSeconds(5) < estimateWorkingSetSeconds(15));

      // Nonsense in, a sane default out — never NaN on a screen.
      assert.equal(estimateWorkingSetSeconds(0), estimateWorkingSetSeconds(8));
      assert.equal(estimateWorkingSetSeconds(Number.NaN), estimateWorkingSetSeconds(8));
    },
  },
  {
    name: 'rest is counted between sets, not after the last one',
    run() {
      const one = estimateSessionSeconds({ exercises: [{ sets: 1, reps: 10, restSeconds: 120 }] });
      // A single set has no rest to serve: setup + the set itself.
      assert.equal(one, EXERCISE_SETUP_SECONDS + 55);

      const three = estimateSessionSeconds({ exercises: [{ sets: 3, reps: 10, restSeconds: 120 }] });
      assert.equal(three, EXERCISE_SETUP_SECONDS + 3 * 55 + 2 * 120);

      // Long rests are most of a heavy session, which is the whole reason the
      // old flat-per-set guess was wrong.
      const shortRest = estimateSessionSeconds({ exercises: [{ sets: 3, reps: 10, restSeconds: 45 }] });
      assert.ok(three - shortRest === 2 * 75);
    },
  },
  {
    name: 'skipped and empty work cost nothing, and warm-up counts as prescribed',
    run() {
      const base = { sets: 3, reps: 8, restSeconds: 90 };
      const withSkip = estimateSessionSeconds({
        exercises: [base, { ...base, skipped: true }, { ...base, sets: 0 }],
      });
      assert.equal(withSkip, estimateSessionSeconds({ exercises: [base] }));

      const withBlocks = estimateSessionSeconds({
        exercises: [base],
        warmupSeconds: 360,
        cooldownSeconds: 240,
      });
      assert.equal(withBlocks, estimateSessionSeconds({ exercises: [base] }) + 600);
    },
  },
  {
    name: 'minutes round to five, and an empty session claims no time at all',
    run() {
      // A real day: two heavy fours and three accessory threes.
      const minutes = estimateSessionMinutes({
        exercises: [
          { sets: 4, reps: 6, restSeconds: 150 },
          { sets: 4, reps: 6, restSeconds: 150 },
          { sets: 3, reps: 8, restSeconds: 90 },
          { sets: 3, reps: 12, restSeconds: 60 },
          { sets: 3, reps: 12, restSeconds: 60 },
        ],
        warmupSeconds: 360,
        cooldownSeconds: 240,
      });
      assert.equal(minutes % 5, 0);
      assert.ok(minutes >= 40 && minutes <= 70, `expected a plausible session, got ${minutes}`);

      // Trimming sets has to move the number — the Adapt sheet's promise and
      // the session's own estimate are the same function now.
      const trimmed = estimateSessionMinutes({
        exercises: [
          { sets: 4, reps: 6, restSeconds: 150 },
          { sets: 4, reps: 6, restSeconds: 150 },
          { sets: 1, reps: 8, restSeconds: 90 },
          { sets: 1, reps: 12, restSeconds: 60 },
          { sets: 1, reps: 12, restSeconds: 60 },
        ],
        warmupSeconds: 360,
        cooldownSeconds: 240,
      });
      assert.ok(trimmed < minutes);

      assert.equal(estimateSessionMinutes({ exercises: [] }), 0);
      assert.equal(estimateSessionMinutes({ exercises: [{ sets: 0, reps: 10, restSeconds: 60 }] }), 0);
    },
  },
];
