const assert = require('node:assert/strict');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { displayEquipmentValue } = require('../../.test-dist/lib/libraryLabel.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');

/**
 * A lift named for the body alone lists no weight (#bugs 2026-10-19): the swap
 * sheet showed "Taakse astuva askelkyykky kehonpainolla" as "Käsipaino",
 * because the name resolved to the loaded reverse lunge's row.
 */
const EXTERNAL_LOAD = new Set(['barbell', 'dumbbell', 'kettlebells', 'machine', 'cable']);

// Real exceptions: the source's "Bodyweight Flyes" is done on two EZ bars that
// roll apart under the hands; the name says the body is the load, the bars are
// the prop, and the row's steps say so.
const ALLOWED = new Set(['Bodyweight Flyes']);

const library = createSeedExerciseLibrary();

module.exports = [
  {
    name: 'a bodyweight-named exercise lists no external load equipment',
    run() {
      const named = (item) =>
        /body ?weight|no equipment|unweighted/i.test(item.name) ||
        /kehonpaino(?!kyykky kuminauhalla)|ilman väline/i.test(exerciseNameLabel('fi', item.name));
      const offenders = library
        .filter((item) => named(item) && !ALLOWED.has(item.name))
        .filter((item) => EXTERNAL_LOAD.has(displayEquipmentValue(item)) || EXTERNAL_LOAD.has(item.equipment))
        .map((item) => `${item.name}: ${item.equipment}`);
      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'the allow-list holds only rows that exist and still break the rule',
    run() {
      for (const name of ALLOWED) {
        const row = library.find((item) => item.name === name);
        assert.ok(row, `${name} is in the library`);
        assert.ok(EXTERNAL_LOAD.has(displayEquipmentValue(row)), `${name} no longer needs its exception`);
      }
    },
  },
  {
    name: 'Bodyweight Reverse Lunge is a bodyweight row, not the dumbbell one',
    run() {
      const row = library.find((item) => item.name === 'Bodyweight Reverse Lunge');
      assert.ok(row);
      assert.equal(row.equipment, 'bodyweight');
      assert.equal(displayEquipmentValue(row), 'bodyweight');
    },
  },
];
