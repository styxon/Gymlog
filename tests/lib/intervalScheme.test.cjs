const assert = require('node:assert/strict');

const { parseIntervalScheme } = require('../../src/lib/intervalScheme');
const { buildGuidedSteps } = require('../../src/lib/guidedPlayer');

function exercise(name, overrides = {}) {
  return {
    slotId: 'slot1',
    name,
    restSeconds: 90,
    setCount: 3,
    skipped: false,
    ...overrides,
  };
}

function planFor(name, overrides = {}) {
  return buildGuidedSteps(
    { warmup: [], exercises: [exercise(name, overrides)], cooldown: [] },
    'en',
  );
}

module.exports = [
  {
    name: 'an interval states both halves of its rhythm in its own name',
    run() {
      // The treadmill is the one machine whose halves have plain names the
      // reader already uses (user 2026-08-26: "30s kävelyä/30s juoksua").
      assert.deepEqual(parseIntervalScheme('Treadmill HIIT (30s on / 30s off)'), {
        workSeconds: 30,
        recoverySeconds: 30,
        workKind: 'run',
        recoveryKind: 'walk',
      });

      // Everywhere else the honest word is the effort, not an invented
      // movement — and a recovery under fifteen seconds is a stop, not a pace.
      assert.deepEqual(parseIntervalScheme('Bike HIIT (45s sprint / 15s rest)'), {
        workSeconds: 45,
        recoverySeconds: 15,
        workKind: 'hard',
        recoveryKind: 'rest',
      });
      assert.deepEqual(parseIntervalScheme('Squat Jump (20s on / 10s off)'), {
        workSeconds: 20,
        recoverySeconds: 10,
        workKind: 'hard',
        recoveryKind: 'rest',
      });
    },
  },
  {
    name: 'an exercise that is not an interval is left alone',
    run() {
      assert.equal(parseIntervalScheme('Bench Press'), null);
      assert.equal(parseIntervalScheme('Plank'), null);
      // One half is not a scheme: "30s sprint" says nothing about recovery,
      // and guessing one would be inventing the workout.
      assert.equal(parseIntervalScheme('Air Bike (30s sprint)'), null);
      assert.equal(parseIntervalScheme('Rowing Machine (500m intervals)'), null);
    },
  },
  {
    name: 'the player builds an interval as timed work, not a set to dial in',
    run() {
      const { steps } = planFor('Treadmill HIIT (30s on / 30s off)');
      const sets = steps.filter((step) => step.type === 'set');
      assert.equal(sets.length, 3);
      for (const set of sets) {
        assert.equal(set.interval.workSeconds, 30, 'the work bout runs on the clock');
        assert.equal(set.interval.workKind, 'run');
      }
    },
  },
  {
    name: "an interval's recovery is its own off-phase, not the exercise's rest",
    run() {
      // restSeconds is 90 in the fixture — an ordinary exercise would rest
      // that long, and the interval must not.
      const { steps } = planFor('Treadmill HIIT (30s on / 30s off)');
      const rests = steps.filter((step) => step.type === 'rest');
      assert.equal(rests.length, 2, 'no recovery after the last bout');
      for (const rest of rests) {
        assert.equal(rest.seconds, 30);
        assert.equal(rest.recoveryKind, 'walk');
      }
    },
  },
  {
    name: "a tabata's ten seconds survives the ordinary fifteen-second rest floor",
    run() {
      // Math.max(15, restSeconds) is right for a rest between heavy sets and
      // wrong for a tabata: ten seconds is the prescription, not a typo.
      const { steps } = planFor('Squat Jump (20s on / 10s off)');
      const rest = steps.find((step) => step.type === 'rest');
      assert.equal(rest.seconds, 10);
      assert.equal(rest.recoveryKind, 'rest');
    },
  },
  {
    name: 'an ordinary exercise keeps its dials and its own rest',
    run() {
      const { steps } = planFor('Bench Press', { restSeconds: 90 });
      const set = steps.find((step) => step.type === 'set');
      const rest = steps.find((step) => step.type === 'rest');
      assert.equal(set.interval, undefined, 'no timer on a set you end yourself');
      assert.equal(rest.recoveryKind, undefined);
      assert.equal(rest.seconds, 90);
    },
  },
];
