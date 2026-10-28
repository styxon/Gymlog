const assert = require('node:assert/strict');

const {
  MAX_DEFAULT_REST_SECONDS,
  normalizeDefaultRestSeconds,
} = require('../../src/lib/restPreference');

const FALLBACK = 90;

module.exports = [
  {
    name: 'a fraction that rounds to nothing is not a rest',
    run() {
      // The hole the PR reviewer found on #32: the positivity check ran on the
      // RAW value and the rounding came after it, so 0.3 cleared `> 0` and
      // Math.round then produced exactly the 0 the guard existed to reject.
      // That 0 became every exercise's restSeconds and put the rest bar back
      // where this whole change started — never starting.
      assert.equal(normalizeDefaultRestSeconds(0.3, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(0.49, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(0.0001, FALLBACK), FALLBACK);

      // The old expression is spelled out so the difference is visible rather
      // than asserted about: it accepted 0.3 and returned 0.
      const oldRule = (value) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0
          ? Math.min(Math.round(value), MAX_DEFAULT_REST_SECONDS)
          : FALLBACK;
      assert.equal(oldRule(0.3), 0);
      assert.notEqual(oldRule(0.3), normalizeDefaultRestSeconds(0.3, FALLBACK));
    },
  },
  {
    name: 'a fraction that rounds to a real rest is kept, rounded',
    run() {
      // Half a second up is a rest of one second: unhelpful, but honest, and
      // the bar can count it. The line is at what rounding produces, not at
      // what was stored.
      assert.equal(normalizeDefaultRestSeconds(0.5, FALLBACK), 1);
      assert.equal(normalizeDefaultRestSeconds(74.4, FALLBACK), 74);
      assert.equal(normalizeDefaultRestSeconds(74.6, FALLBACK), 75);
    },
  },
  {
    name: 'anything that is not a finite number falls back',
    run() {
      // typeof NaN === 'number' is the reason this function exists at all.
      assert.equal(normalizeDefaultRestSeconds(NaN, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(Infinity, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(-Infinity, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(undefined, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(null, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds('120', FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds({}, FALLBACK), FALLBACK);
    },
  },
  {
    name: 'zero and negatives fall back, and an absurd value is capped',
    run() {
      assert.equal(normalizeDefaultRestSeconds(0, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(-0, FALLBACK), FALLBACK);
      assert.equal(normalizeDefaultRestSeconds(-120, FALLBACK), FALLBACK);

      assert.equal(normalizeDefaultRestSeconds(86400, FALLBACK), MAX_DEFAULT_REST_SECONDS);
      assert.equal(normalizeDefaultRestSeconds(MAX_DEFAULT_REST_SECONDS, FALLBACK), MAX_DEFAULT_REST_SECONDS);
      assert.equal(normalizeDefaultRestSeconds(MAX_DEFAULT_REST_SECONDS + 1, FALLBACK), MAX_DEFAULT_REST_SECONDS);
    },
  },
  {
    name: 'an ordinary stored rest passes through untouched',
    run() {
      assert.equal(normalizeDefaultRestSeconds(120, FALLBACK), 120);
      assert.equal(normalizeDefaultRestSeconds(45, FALLBACK), 45);
      assert.equal(normalizeDefaultRestSeconds(1, FALLBACK), 1);
    },
  },
];
