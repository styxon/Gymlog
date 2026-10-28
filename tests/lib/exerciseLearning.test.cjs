const assert = require('node:assert/strict');

const {
  normalizeTechniqueChecks,
  normalizeLearnedExerciseIds,
  toggleTechniqueStatement,
  countRemainingStatements,
} = require('../../src/lib/exerciseLearning');

/**
 * The four rules behind the technique check and "Mark as learned".
 *
 * These cases used to live in tests/screens/teachingSections.test.cjs, which
 * is a source-reading suite about what ExerciseDetailScreen renders — a
 * different question, and the wrong directory. Flagged by the PR review on
 * #40 against CLAUDE.md: "New domain logic belongs in `src/lib/` as a pure
 * function, covered by a test in `tests/lib/`." Every sibling module added in
 * this PR had its own file there; this one was the outlier.
 *
 * Moved rather than rewritten. The assertions were already driving the real
 * functions, so what was wrong was where they lived, not what they said.
 */
module.exports = [
  {
    /**
     * The loader normalises what it reads. A stored index that is negative,
     * fractional or repeated would each draw a wrong "N left" counter — and
     * the counter is the only thing the section says out loud.
     *
     * The rule lives in src/lib rather than in the loader because
     * `storage/database.ts` reaches AsyncStorage, which reaches React Native,
     * which no test in this suite can import. The loader delegates.
     */
    name: 'learning: a corrupt stored value cannot draw a wrong counter',
    run() {
      const checks = normalizeTechniqueChecks({
        good: [2, 0, 0, 1],
        negative: [-1, 1],
        fractional: [1.5, 2],
        notAnArray: 3,
        empty: [],
        '': [1],
      });

      // Duplicates collapsed and sorted, so the same four boxes ticked in a
      // different order compare equal between devices.
      assert.deepEqual(checks.good, [0, 1, 2]);
      assert.deepEqual(checks.negative, [1]);
      assert.deepEqual(checks.fractional, [2]);
      assert.equal(checks.notAnArray, undefined);
      assert.equal(checks.empty, undefined);
      assert.equal(checks[''], undefined);

      assert.deepEqual(normalizeTechniqueChecks(null), {});
      assert.deepEqual(normalizeTechniqueChecks([1, 2]), {});
      assert.deepEqual(normalizeLearnedExerciseIds(['keep', '', '   ', 42, null, 'keep']), ['keep']);
      assert.deepEqual(normalizeLearnedExerciseIds('nope'), []);

      // That the LOADER calls these is a wiring fact about a file this suite
      // does not read — it lives with the other source guards, in
      // tests/screens/teachingSections.test.cjs.
    },
  },
  {
    name: 'learning: ticking the last box off removes the lift rather than storing none',
    run() {
      const one = toggleTechniqueStatement({}, 'ex', 2);
      assert.deepEqual(one, { ex: [2] });

      const two = toggleTechniqueStatement(one, 'ex', 0);
      assert.deepEqual(two, { ex: [0, 2] });

      const back = toggleTechniqueStatement(toggleTechniqueStatement(two, 'ex', 0), 'ex', 2);
      assert.deepEqual(back, {}, 'an emptied lift leaves no row behind');

      // Other lifts are untouched, and the input is never mutated.
      const seed = { other: [1] };
      const next = toggleTechniqueStatement(seed, 'ex', 0);
      assert.deepEqual(seed, { other: [1] });
      assert.deepEqual(next, { other: [1], ex: [0] });
    },
  },
  {
    name: 'learning: the counter names what is left, and reaches zero',
    run() {
      assert.equal(countRemainingStatements(4, []), 4);
      assert.equal(countRemainingStatements(4, [0, 2]), 2);
      assert.equal(countRemainingStatements(4, [0, 1, 2, 3]), 0);
      assert.equal(countRemainingStatements(4, null), 4);
      // A stored index past the end is not a tick on anything, so it cannot
      // talk the counter below what is really left.
      assert.equal(countRemainingStatements(4, [9, 9, 9, 9]), 4);
    },
  },
];
