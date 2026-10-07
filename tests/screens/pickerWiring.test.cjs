const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8').replace(/\r\n/g, '\n');

/**
 * Every exercise picker lists through `listPickerExercises` and labels through
 * `exercisePickerLabel` / `exercisePickerRowMeta` (src/lib/exercisePicker.ts).
 * tests/lib/pickerRules.test.cjs proves those two keep the user's rules over
 * the whole library; this proves each screen calls them — the rule nobody
 * calls is the failure this project keeps meeting.
 *
 * Inventory (2026-10-06):
 *   AddExerciseSheet         — programme builder, programme day, guided add
 *   GuidedPlayerScreen       — the swap sheet (same component, swap mode)
 *   EmptyWorkoutScreen       — the free workout's add sheet
 *   ExerciseLibraryBrowser   — the exercise library screen
 *   NewProgramSheet          — the import's "which lift did you mean" list
 * Home's and the programme day's swap search go through buildSwapLibraryMatches,
 * whose ranking is the same rankExerciseMatches (pinned in pickerRules).
 */
const PICKER_FILES = {
  'add sheet': 'src/components/AddExerciseSheet.tsx',
  'guided swap': 'src/screens/GuidedPlayerScreen.tsx',
  'empty workout': 'src/screens/EmptyWorkoutScreen.tsx',
  'library screen': 'src/components/ExerciseLibraryBrowser.tsx',
  'import teach list': 'src/components/NewProgramSheet.tsx',
};

module.exports = [
  {
    name: 'picker wiring: every picker lists through listPickerExercises',
    run() {
      for (const [picker, file] of Object.entries(PICKER_FILES)) {
        const source = read(file);
        assert.match(source, /from '\.\.\/lib\/exercisePicker'/, `${picker} does not import the shared list`);
        assert.match(source, /listPickerExercises\(/, `${picker} composes its own list`);
        // No picker reaches past the rule to the pieces it composes.
        assert.doesNotMatch(source, /filterBrowsableExercises\(|passesSpecialtyGate\(|matchesBodyPartFilter\(/, picker);
        // Nor filters by the stored body part, which has no leg muscles.
        assert.doesNotMatch(source, /\bitem\.bodyPart (?:===|!==) /, `${picker} filters by the stored body part`);
      }
    },
  },
  {
    name: 'picker wiring: only the library screen lists stretches',
    run() {
      for (const [picker, file] of Object.entries(PICKER_FILES)) {
        const lists = /listsStretches: true/.test(read(file));
        assert.equal(lists, picker === 'library screen', picker);
      }
    },
  },
  {
    name: 'picker wiring: every picker with body-part chips offers the shared chips, leg muscles included',
    run() {
      const sheet = read(PICKER_FILES['add sheet']);
      assert.match(sheet, /options=\{BODY_PART_FILTERS\}|BODY_PART_FILTERS\.map\(/);
      const empty = read(PICKER_FILES['empty workout']);
      assert.match(empty, /BODY_PART_FILTERS\.map\(/, 'the empty workout keeps its own six chips');
      assert.doesNotMatch(empty, /EMPTY_WORKOUT_MUSCLE_FILTERS|matchesMuscleFilter/);
      const browser = read(PICKER_FILES['library screen']);
      assert.match(browser, /const bodyPartOptions = BODY_PART_FILTERS;/, 'the library screen derives its chips from stored body parts');
      assert.match(browser, /const equipmentOptions = EQUIPMENT_FILTERS;/);
      assert.match(browser, /const categoryOptions = EXERCISE_TYPE_FILTERS;/);
    },
  },
  {
    name: 'picker wiring: rows and chips say one word per value, from one label function',
    run() {
      for (const [picker, file] of Object.entries(PICKER_FILES)) {
        const source = read(file);
        // The sheet's own dictionary, the body-part dictionary and the tag
        // dictionary each worded a value their own way.
        assert.doesNotMatch(source, /FACET_KEYS|'facet\.(?:chest|back|compound|isolation|cardio|barbell|dumbbell|cable|machine|specialty)'/, picker);
        assert.doesNotMatch(source, /bodyPartLabel\(|exerciseTag\./, picker);
      }
      const sheet = read(PICKER_FILES['add sheet']);
      assert.match(sheet, /exercisePickerChipLabel\(option, language\)/);
      assert.match(read(PICKER_FILES['library screen']), /exercisePickerChipLabel\(option, language\)/);
      assert.match(read(PICKER_FILES['empty workout']), /exercisePickerChipLabel\(option, language\)/);
      assert.match(sheet, /exercisePickerRowLabels\(item, language\)/);
      assert.match(read(PICKER_FILES['empty workout']), /exercisePickerRowMeta\(item, language\)/);
      assert.match(read(PICKER_FILES['library screen']), /exercisePickerRowMeta\(/);
      // The programme builder's rows print the displayed equipment too.
      const builder = read('src/screens/CreateTemplateScreen.tsx');
      assert.match(builder, /exercisePickerRowMeta\(libraryItem, language\)/);
    },
  },
  {
    /**
     * The library row opens the lift's own page, which kept a third
     * dictionary: "Moninivel · Käsipainot" on the row, "Perusliike" and
     * "Käsipaino" on the page, and a tyre flip's page called it "Moninivel"
     * under a row that said "Erikoisliike". The page keeps its source
     * equipment on purpose (libraryLabel's note) — in the same words.
     */
    name: 'picker wiring: a lift\'s own page says what its row said',
    run() {
      const detail = read('src/screens/ExerciseDetailScreen.tsx');
      assert.doesNotMatch(detail, /DETAIL_LABEL_KEYS|'facet\.(?:chest|compound|isolation|cardio|dumbbell|cable)'/);
      assert.match(detail, /return exercisePickerLabel\(value, language\);/);
      // The type tile is the row's type (exerciseTypeOf), not the stored mechanic.
      assert.match(detail, /exerciseTypeOf\(item\)/);
      assert.doesNotMatch(detail, /item\.sourceMechanic \?\? item\.category/);
    },
  },
];
