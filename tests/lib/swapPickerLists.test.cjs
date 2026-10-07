const assert = require('node:assert/strict');

const { buildSwapPickerLibrary, narrowSwapAlternatives } = require('../../.test-dist/lib/swapPickerLists.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { getPopularExerciseLibraryOrder } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { isSpecialtyExercise, isStretchExercise } = require('../../.test-dist/lib/exerciseClassification.js');
const { matchesExercisePickerFilters } = require('../../.test-dist/lib/exercisePicker.js');

/**
 * The swap sheet's two lists, shared by the guided player and Home since
 * 2026-10-07 (review: Home's swap was a search and two plain lists, no chips).
 */
const library = createSeedExerciseLibrary();
const popularOrder = getPopularExerciseLibraryOrder(library);
const NO_CHIPS = { category: 'all', bodyPart: 'all', equipment: 'all' };
const byName = (name) => library.find((item) => item.name === name);

function list(options) {
  return buildSwapPickerLibrary(library, {
    query: '',
    filters: NO_CHIPS,
    language: 'fi',
    currentName: null,
    currentItem: null,
    excludeNames: [],
    popularOrder,
    ...options,
  });
}

module.exports = [
  {
    name: 'swap list: unsearched it is 25 loggable lifts, never the lift itself or one already shown',
    run() {
      const squat = byName('Barbell Full Squat');
      assert.ok(squat, 'the seed library holds the barbell squat');
      const excluded = exerciseNameLabel('fi', 'Leg Press');
      const rows = list({
        filters: { ...NO_CHIPS, bodyPart: 'quadriceps' },
        currentName: squat.name,
        currentItem: squat,
        excludeNames: ['Leg Press'],
      });
      assert.equal(rows.length, 25);
      const labels = rows.map((item) => exerciseNameLabel('fi', item.name));
      assert.ok(!labels.includes(exerciseNameLabel('fi', squat.name)), 'offers the lift being swapped');
      assert.ok(!labels.includes(excluded), 'offers a lift already on the sheet or in the session');
      assert.equal(new Set(labels).size, labels.length, 'one row per shown name');
      for (const item of rows) {
        assert.ok(!isStretchExercise(item), `${item.name}: a stretch is no swap for a set`);
        assert.ok(!isSpecialtyExercise(item), `${item.name}: specialty only under its chip`);
      }
      // Nearest first: the leg extension reaches "Etureidet" (#bugs 2026-10-06).
      assert.ok(rows.some((item) => item.name === 'Leg Extensions'), 'leg extension in the first 25');
    },
  },
  {
    name: 'swap list: a query searches the whole library, up to 40 rows',
    run() {
      const found = list({ query: 'penkki' });
      assert.ok(found.length > 0 && found.length <= 40);
      assert.ok(
        found.some((item) => /penkkipunnerrus/i.test(exerciseNameLabel('fi', item.name))),
        'the bench press answers "penkki"',
      );
      assert.ok(list({ query: 'a' }).length <= 40);
    },
  },
  {
    name: 'swap alternatives: the body-part chip leaves them, category and equipment narrow them',
    run() {
      // By the chip's own rule: the stored equipment of a kettlebell windmill
      // says dumbbell, and the chip reads what the row prints.
      const chip = (equipment) => (item) =>
        !isStretchExercise(item) && matchesExercisePickerFilters(item, { ...NO_CHIPS, equipment });
      const dumbbell = library.find(chip('dumbbell'));
      const barbell = library.find((item) => chip('barbell')(item) && !chip('dumbbell')(item));
      const rows = [
        { name: dumbbell.name, item: dumbbell },
        { name: barbell.name, item: barbell },
        { name: 'A Programme Name The Library Lacks', item: null },
      ];
      assert.equal(narrowSwapAlternatives(rows, NO_CHIPS).length, 3);
      assert.equal(narrowSwapAlternatives(rows, { ...NO_CHIPS, bodyPart: 'chest' }).length, 3);
      const dumbbellOnly = narrowSwapAlternatives(rows, { ...NO_CHIPS, equipment: 'dumbbell' });
      assert.deepEqual(dumbbellOnly.map((row) => row.name), [dumbbell.name]);
    },
  },
];
