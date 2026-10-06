const assert = require('node:assert/strict');

const {
  normalizeAppliedMigrations,
  restoreTrackingAfterCategoryCorrection,
} = require('../../.test-dist/lib/trackingCategoryMigration.js');
const { CATEGORY_CORRECTED_LIBRARY_IDS } = require('../../.test-dist/data/categoryCorrectedLibraryIds.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');

/**
 * The rule that keeps a programme saved before the library's category
 * correction on the progression it had (lib/trackingCategoryMigration): a
 * stored false on a lift the shipped app called compound and the corrected
 * library does not becomes true. Nothing else moves.
 */

const library = createSeedExerciseLibrary();
const row = (name, trackedDefault, libraryItemId = null) => ({ name, trackedDefault, libraryItemId });

module.exports = [
  {
    name: 'tracking migration: the frozen list is every generated lift the correction moved out of compound, and the shipped Band Curl',
    run() {
      // Derived here from the raw generated rows, independently of the list:
      // the generated file is what shipped (it is unchanged since 493f3d30).
      const corrected = new Map(library.map((item) => [item.id, item.category]));
      const moved = GENERATED_EXERCISE_LIBRARY.filter(
        (item) => item.category === 'compound' && corrected.get(item.id) !== 'compound',
      ).map((item) => item.id);
      assert.ok(moved.length > 200, `the correction moved ${moved.length} generated lifts`);
      // Band Curl shipped as a hand-written compound row (493f3d30) and is filed
      // isolation since; the generated file cannot show that.
      assert.deepEqual([...CATEGORY_CORRECTED_LIBRARY_IDS].sort(), [...moved, 'extra_band_curl'].sort());
      for (const id of CATEGORY_CORRECTED_LIBRARY_IDS) {
        assert.notEqual(corrected.get(id), 'compound', `${id} is compound again: the migration would be moot for it`);
      }
    },
  },
  {
    name: 'tracking migration: a stored false on a lift the correction moved becomes true, by library id or by name',
    run() {
      const out = restoreTrackingAfterCategoryCorrection(
        [
          row('Barbell Curl', false),
          row('Cable Crossover', false, 'free_cable_crossover'),
          // The id wins over the name, as in customWorkoutAdapter.
          row('Something else entirely', false, 'free_triceps_pushdown'),
          row('Band Curl', false),
        ],
        library,
      );
      assert.deepEqual(out.map((entry) => entry.trackedDefault), [true, true, true, true]);
    },
  },
  {
    name: 'tracking migration: nothing whose role the correction does not change is touched',
    run() {
      const shippedIsolation = GENERATED_EXERCISE_LIBRARY.find((item) => item.category === 'isolation');
      const input = [
        // Stored true: tracked either way.
        row('Leg Extensions', true),
        // Still compound: tracked either way.
        row('Barbell Squat', false),
        // Core and cardio read the stored false then as now.
        row('Plank', false),
        // An isolation lift the shipped app already called isolation.
        row(shippedIsolation.name, false, shippedIsolation.id),
        // No library row: the stored value decided then and decides now.
        row('Back Squat', false),
        row('A lift nobody has heard of', false),
      ];
      const out = restoreTrackingAfterCategoryCorrection(input, library);
      assert.deepEqual(out, input);
      // Untouched rows are the same objects: nothing rewritten for nothing.
      out.forEach((entry, index) => assert.equal(entry, input[index]));
    },
  },
  {
    name: 'tracking migration: the rule run twice is the rule run once, and every other field rides along',
    run() {
      const input = [
        { id: 'a', name: 'Barbell Curl', trackedDefault: false, libraryItemId: null, targetSets: 4, repMin: 8, repMax: 8, restSeconds: 90, supersetGroup: 'ss1' },
        { id: 'b', name: 'Plank', trackedDefault: false, libraryItemId: null, targetSets: 3, repMin: 30, repMax: 30, restSeconds: 60, supersetGroup: null },
      ];
      const once = restoreTrackingAfterCategoryCorrection(input, library);
      assert.deepEqual(restoreTrackingAfterCategoryCorrection(once, library), once);
      assert.deepEqual(once[0], { ...input[0], trackedDefault: true });
      assert.equal(input[0].trackedDefault, false, 'the input is not mutated');
    },
  },
  {
    name: 'tracking migration: a stored marker list keeps strings, each once, and anything else is no list',
    run() {
      assert.deepEqual(normalizeAppliedMigrations(undefined), []);
      assert.deepEqual(normalizeAppliedMigrations('x'), []);
      assert.deepEqual(normalizeAppliedMigrations(['a', 1, null, '', 'a', 'b']), ['a', 'b']);
    },
  },
];
