const assert = require('node:assert/strict');

const { setNumberLanguage } = require('../../src/lib/format');
// The decimal mark is a module-level setting (see format.ts), shared with
// every other suite in the same run — leaving it on 'fi' bled a comma into
// unrelated suites that assume 'en' (sessionOverviewRows, warmupBrief,
// sessionMovement, cardio all set 'en' at require time and never again).
// Every test below that switches language restores 'en' before returning.
setNumberLanguage('en');

const {
  isUniformLoad,
  formatLoadOrRange,
  summarizeHistoricalSetChips,
} = require('../../src/lib/guidedSetWeightSummary');

module.exports = [
  {
    name: 'isUniformLoad: same weight every set is uniform, a ramp is not',
    run() {
      assert.equal(isUniformLoad([60, 60, 60]), true);
      assert.equal(isUniformLoad([16.25, 16.25, 30, 30, 30]), false);
      // Empty and single-set lists have nothing to vary against.
      assert.equal(isUniformLoad([]), true);
      assert.equal(isUniformLoad([42]), true);
      // Floating-point jitter from the same weight is still uniform.
      assert.equal(isUniformLoad([60, 60.001, 59.999]), true);
    },
  },
  {
    name: 'formatLoadOrRange: uniform sets print one weight, a ramp prints its span',
    run() {
      setNumberLanguage('fi');
      try {
        assert.equal(formatLoadOrRange([60, 60, 60]), '60 kg');
        // The real case reported 2026-09-29: Lantionnosto laitteessa ramped
        // 16,25 -> 30. The span reads "16,25-30 kg", not one of the two numbers.
        assert.equal(formatLoadOrRange([16.25, 16.25, 30, 30, 30]), '16,25-30 kg');
        // Sumo: last time 55, 60, 60, 60.
        assert.equal(formatLoadOrRange([55, 60, 60, 60]), '55-60 kg');
        // All-zero (bodyweight) is not a loaded set to summarize.
        assert.equal(formatLoadOrRange([0, 0, 0]), null);
        assert.equal(formatLoadOrRange([]), null);
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'formatLoadOrRange: decimal comma follows the active language, like every other weight',
    run() {
      try {
        assert.equal(formatLoadOrRange([16.25, 30]), '16.25-30 kg');
        setNumberLanguage('fi');
        assert.equal(formatLoadOrRange([16.25, 30]), '16,25-30 kg');
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'summarizeHistoricalSetChips: uniform weight keeps plain rep chips (today\'s exact look)',
    run() {
      setNumberLanguage('fi');
      try {
        const view = summarizeHistoricalSetChips([
          { loadKg: 30, reps: 8 },
          { loadKg: 30, reps: 8 },
          { loadKg: 30, reps: 6 },
        ]);
        assert.equal(view.uniform, true);
        assert.deepEqual(view.chips, ['8', '8', '6']);
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'summarizeHistoricalSetChips: a ramp shows weight x reps per set instead of one heading number',
    run() {
      setNumberLanguage('fi');
      try {
        // The reported case: 16,25x8, 16,25x8, 30x6, 30x6, 30x6.
        const view = summarizeHistoricalSetChips([
          { loadKg: 16.25, reps: 8 },
          { loadKg: 16.25, reps: 8 },
          { loadKg: 30, reps: 6 },
          { loadKg: 30, reps: 6 },
          { loadKg: 30, reps: 6 },
        ]);
        assert.equal(view.uniform, false);
        assert.deepEqual(view.chips, ['16,25×8', '16,25×8', '30×6', '30×6', '30×6']);
      } finally {
        setNumberLanguage('en');
      }
    },
  },
  {
    name: 'summarizeHistoricalSetChips: bodyweight sets (0 kg throughout) stay reps-only',
    run() {
      const view = summarizeHistoricalSetChips([
        { loadKg: 0, reps: 12 },
        { loadKg: 0, reps: 10 },
      ]);
      assert.equal(view.uniform, true);
      assert.deepEqual(view.chips, ['12', '10']);
    },
  },
];
