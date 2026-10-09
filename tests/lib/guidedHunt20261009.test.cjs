const assert = require('node:assert/strict');

const {
  buildGuidedSteps,
  guidedRestSeconds,
  guidedRestOpeningMs,
  withGuidedRestDeadline,
  getGuidedStepAnchor,
  findGuidedStepIndexByAnchor,
  resolveGuidedResumeIndex,
} = require('../../.test-dist/lib/guidedPlayer.js');

function restPlan(restSeconds) {
  return buildGuidedSteps({
    warmup: [],
    exercises: [{ slotId: 'a', name: 'Cobra Pose', restSeconds, setCount: 2, skipped: false }],
    cooldown: [],
  }).steps;
}

function firstRest(steps) {
  return steps.find((step) => step.type === 'rest');
}

module.exports = [
  {
    name: 'guided rest floor: a prescribed 0 s runs, and is quoted as, the shortest ring (hunt 2026-10-09 #22)',
    run() {
      assert.equal(guidedRestSeconds(0), 15);
      assert.equal(guidedRestSeconds(-5), 15);
      assert.equal(guidedRestSeconds(10), 15);
      assert.equal(guidedRestSeconds(120), 120);
      assert.equal(firstRest(restPlan(0)).seconds, guidedRestSeconds(0));
      assert.equal(firstRest(restPlan(120)).seconds, 120);
    },
  },
  {
    name: 'guided rest floor: a rest that is not a number gets the floor, not NaN',
    run() {
      assert.equal(guidedRestSeconds(Number.NaN), 15);
      assert.equal(guidedRestSeconds(Number.POSITIVE_INFINITY), 15);
      assert.equal(firstRest(restPlan(Number.NaN)).seconds, 15);
    },
  },
  {
    name: 'guided rest reopen: the time left comes from the stored deadline, not the nominal length (#19)',
    run() {
      const rest = firstRest(restPlan(120));
      const now = 1_000_000;
      const anchor = withGuidedRestDeadline(getGuidedStepAnchor(rest), now + 40_000);
      assert.equal(guidedRestOpeningMs(anchor, rest, now), 40_000);
      // An hour later the rest is long over: zero, so the timer moves on to the set.
      assert.equal(guidedRestOpeningMs(anchor, rest, now + 3_600_000), 0);
    },
  },
  {
    name: 'guided rest reopen: an anchor that says nothing about this rest leaves the nominal length',
    run() {
      const steps = restPlan(120);
      const rest = firstRest(steps);
      const now = 1_000_000;
      const plain = getGuidedStepAnchor(rest);
      assert.equal(guidedRestOpeningMs(plain, rest, now), null);
      assert.equal(guidedRestOpeningMs(null, rest, now), null);
      assert.equal(guidedRestOpeningMs(undefined, rest, now), null);
      // A deadline stored for another rest (other slot or set) is not this one's.
      const other = withGuidedRestDeadline({ ...plain, setIndex: plain.setIndex + 1 }, now + 40_000);
      assert.equal(guidedRestOpeningMs(other, rest, now), null);
      const otherSlot = withGuidedRestDeadline({ ...plain, slotId: 'zzz' }, now + 40_000);
      assert.equal(guidedRestOpeningMs(otherSlot, rest, now), null);
      // Not a rest step at all.
      const set = steps.find((step) => step.type === 'set');
      assert.equal(guidedRestOpeningMs(withGuidedRestDeadline(plain, now + 5_000), set, now), null);
      // Garbage in storage.
      assert.equal(guidedRestOpeningMs({ ...plain, restEndsAtMs: 'soon' }, rest, now), null);
      assert.equal(guidedRestOpeningMs({ ...plain, restEndsAtMs: Number.NaN }, rest, now), null);
    },
  },
  {
    name: 'guided rest reopen: a clock set back cannot strand the reader on a rest for hours',
    run() {
      const rest = firstRest(restPlan(120));
      const now = 1_000_000;
      const anchor = withGuidedRestDeadline(getGuidedStepAnchor(rest), now + 5 * 3_600_000);
      assert.ok(guidedRestOpeningMs(anchor, rest, now) <= 30 * 60 * 1000);
    },
  },
  {
    name: 'guided rest reopen: the deadline rides on the anchor without changing which step it names',
    run() {
      const steps = restPlan(120);
      const restIndex = steps.findIndex((step) => step.type === 'rest');
      const rest = steps[restIndex];
      const withDeadline = withGuidedRestDeadline(getGuidedStepAnchor(rest), 5_000_000);
      assert.equal(findGuidedStepIndexByAnchor(steps, withDeadline), restIndex);
      assert.equal(resolveGuidedResumeIndex(steps, restIndex, () => false, withDeadline), restIndex);
      // Taking it off again gives back the plain anchor.
      assert.deepEqual(withGuidedRestDeadline(withDeadline, null), getGuidedStepAnchor(rest));
      assert.equal('restEndsAtMs' in withGuidedRestDeadline(withDeadline, null), false);
    },
  },
];
