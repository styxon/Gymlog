const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

/**
 * The word a kettlebell row prints, and the chip that has to select it.
 *
 * `displayEquipmentValue` is unit-tested next door in tests/lib — that suite
 * proves the rule returns "kettlebells" for the 54 exercises the library files
 * under `dumbbell`. It says nothing about whether any screen calls it, and a
 * rule nothing calls is the failure mode this project keeps meeting: the call
 * exists, the behaviour never arrives.
 *
 * Three surfaces have to agree, and each one of them was wrong at some point
 * in the same afternoon:
 *   · the row's subtitle, which said "Käsipainot" under kahvakuula steps
 *   · the filter chips, which had no chip that selects them and one that
 *     returned them under the wrong word
 *   · the search haystack, which made 15 of them unfindable by the word the
 *     row had just started printing
 */
module.exports = [
  {
    name: 'equipment label: both browse surfaces print the displayed value, not the stored bucket',
    run() {
      // Both print every picker's row line (lib/exercisePicker), built from
      // exerciseRowMetaValues, which reads the displayed value
      // (tests/lib/exerciseFilterInvariants).
      const sheet = read('src/components/AddExerciseSheet.tsx');
      assert.match(sheet, /exercisePickerRowLabels\(item, language\)/, 'the sheet labels item.equipment directly');
      const browser = read('src/components/ExerciseLibraryBrowser.tsx');
      assert.match(browser, /return exercisePickerRowMeta\(item, language\);/);
      assert.match(read('src/lib/exercisePicker.ts'), /exerciseRowMetaValues\(item\)\.map\(\(value\) => exercisePickerLabel\(value, language\)\)/);
      assert.match(read('src/lib/exerciseClassification.ts'), /item\.bodyPart, displayEquipmentValue\(item\)/);
    },
  },
  {
    name: 'equipment label: the filter selects by the same value the row shows',
    run() {
      // A chip built from `item.equipment` while the row prints something else
      // is a filter that argues with its own list.
      // Both screens offer the shared chip list and filter through every
      // picker's one list (lib/exercisePicker).
      const browser = read('src/components/ExerciseLibraryBrowser.tsx');
      assert.match(browser, /const equipmentOptions = EQUIPMENT_FILTERS;/);
      assert.match(browser, /equipment: equipmentFilter/);
      assert.match(read('src/lib/exercisePicker.ts'), /matchesEquipmentFilter\(item, filters\.equipment\)/);

      const sheet = read('src/components/AddExerciseSheet.tsx');
      assert.match(sheet, /filters: \{ category, bodyPart, equipment \}/);
      // Both select by the displayed value (and never a specialty movement).
      const filter = read('src/lib/exerciseBrowseFilter.ts');
      assert.match(filter, /!isSpecialtyExercise\(item\) && displayEquipmentValue\(item\) === filter/);
      // The sheet's chip list is hardcoded rather than derived, so the value
      // has to be named in it explicitly or there is no chip to tap.
      assert.match(sheet, /const equipmentOptions: SheetEquipmentOption\[\] = EQUIPMENT_FILTERS;/);
      assert.match(filter, /export const EQUIPMENT_FILTERS: EquipmentFilter\[\] = \[[^\]]*'kettlebells'/s);
      // Labelled by the one label function, which knows the word.
      const { exercisePickerLabel } = require('../../.test-dist/lib/exercisePicker.js');
      assert.equal(exercisePickerLabel('kettlebells', 'fi'), 'Kahvakuula');
    },
  },
  {
    name: 'equipment label: search finds the word the row prints',
    run() {
      const search = read('src/lib/exerciseSearch.ts');
      assert.match(search, /displayEquipmentValue\(item\)/);
      // Additive, not a replacement: "käsipaino" was a working query before
      // this and has to stay one.
      assert.match(search, /item\.equipment, displayEquipmentValue\(item\)/);
    },
  },
];
