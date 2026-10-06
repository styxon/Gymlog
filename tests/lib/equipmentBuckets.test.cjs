const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSeedExerciseLibrary, createEmptyDatabase } = require('../../.test-dist/data/seed.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const { displayEquipmentValue, libraryLabel } = require('../../.test-dist/lib/libraryLabel.js');
const { isExerciseAllowedWithEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { resolveProgramEquipment } = require('../../.test-dist/lib/programEquipment.js');
const { buildAiCoachPlanSchema } = require('../../.test-dist/lib/aiCoachPlan.js');
const { getCatalogTrackingMode } = require('../../.test-dist/lib/catalogExercisePools.js');

/**
 * "Kehonpaino" is what needs nothing in your hands (#bugs 2026-10-06). The
 * library files every band, medicine-ball, exercise-ball and foam-roller row
 * as bodyweight, so the chip listed 20 band, 16 medicine-ball and 10
 * exercise-ball rows among the push-ups, and a reader who said "no equipment"
 * could be handed a band pull-apart. Bands and balls are chips of their own
 * ("Kuminauha", "Pallo"); the stored bucket — what tracking reads — is not
 * touched.
 */
const library = createSeedExerciseLibrary();
const unsearched = browse.filterBrowsableExercises(library);
const names = (rows) => rows.map((item) => item.name);
const byName = (name) => {
  const item = library.find((entry) => entry.name === name);
  assert.ok(item, `${name} missing from the library`);
  return item;
};
const GEAR_SOURCES = new Set(['bands', 'medicine ball', 'exercise ball', 'foam roll']);
const GEAR_IN_NAME = /\bbands?\b|\b(?:exercise|stability|medicine|swiss) ball\b|physioball|-smr\b/i;
const NOT_GEAR = /\bit band\b/i;
const isBand = (item) => item.sourceEquipment === 'bands' || (/\bbands?\b/i.test(item.name) && !NOT_GEAR.test(item.name));
const isBall = (item) =>
  item.sourceEquipment === 'medicine ball' ||
  item.sourceEquipment === 'exercise ball' ||
  /\b(?:exercise|stability|medicine|swiss) ball\b|physioball/i.test(item.name);

module.exports = [
  {
    name: 'equipment buckets: "Kehonpaino" lists no band, ball or foam-roller row',
    run() {
      const bodyweightChip = unsearched.filter((item) => browse.matchesEquipmentFilter(item, 'bodyweight'));
      const gear = bodyweightChip.filter(
        (item) => GEAR_SOURCES.has(item.sourceEquipment) || (GEAR_IN_NAME.test(item.name) && !NOT_GEAR.test(item.name)),
      );
      assert.deepEqual(names(gear), []);
      // The reported shape, and the band and ball rows the source files as
      // "other" or "body only".
      for (const name of [
        'Band Pull Apart',
        'Monster Walk',
        'Band Assisted Pull-Up',
        'Seated Band Hamstring Curl',
        'Medicine Ball Chest Pass',
        'Overhead Slam',
        'Exercise Ball Crunch',
        'Crunch - Legs On Exercise Ball',
      ]) {
        assert.equal(browse.matchesEquipmentFilter(byName(name), 'bodyweight'), false, `${name} is under Kehonpaino`);
      }
      // The push-up is still there.
      assert.equal(browse.matchesEquipmentFilter(byName('Pushups'), 'bodyweight'), true);
    },
  },
  {
    name: 'equipment buckets: "Kuminauha" and "Pallo" list every band and ball row filed as bodyweight, labelled in both languages',
    run() {
      assert.ok(browse.EQUIPMENT_FILTERS.includes('band'));
      assert.ok(browse.EQUIPMENT_FILTERS.includes('ball'));
      const filedBodyweight = library.filter((item) => item.equipment === 'bodyweight' && item.sourceCategory !== 'stretching');
      const bands = filedBodyweight.filter(isBand);
      const balls = filedBodyweight.filter(isBall);
      assert.ok(bands.length >= 22, `${bands.length} band rows`);
      assert.ok(balls.length >= 23, `${balls.length} ball rows`);
      assert.deepEqual(names(bands.filter((item) => !browse.matchesEquipmentFilter(item, 'band'))), []);
      assert.deepEqual(names(balls.filter((item) => !browse.matchesEquipmentFilter(item, 'ball'))), []);
      // A loaded lift with bands on the bar keeps its bar.
      assert.equal(displayEquipmentValue(byName('Squat with Bands')), 'barbell');
      assert.equal(displayEquipmentValue(byName('Weighted Ball Side Bend')), 'dumbbell');
      // The iliotibial band is not a band.
      assert.equal(displayEquipmentValue(byName('IT Band and Glute Stretch')), 'bodyweight');
      // The stored bucket is untouched: a band row still logs reps, no weight dial.
      assert.equal(byName('Band Pull Apart').equipment, 'bodyweight');
      assert.equal(getCatalogTrackingMode('Band Pull Apart'), 'bodyweight');
      // Labels.
      assert.equal(libraryLabel('band', 'fi'), 'Kuminauha');
      assert.equal(libraryLabel('ball', 'fi'), 'Pallo');
      assert.equal(libraryLabel('band', 'en'), 'Band');
      assert.equal(libraryLabel('ball', 'en'), 'Ball');
      // The add sheet labels its chips through libraryLabel (a parallel
      // change moved it off its own FACET_KEYS), so the two keys above are
      // all a new chip needs.
      // The quick-add list's tag says Kehonpaino only for the same rows.
      // It prints the shared row words (lib/exercisePicker), so a band row
      // says Kuminauha there too.
      const empty = fs.readFileSync(path.join(__dirname, '../../src/screens/EmptyWorkoutScreen.tsx'), 'utf8');
      assert.match(empty, /exercisePickerRowMeta\(item, language\)/);
      const { exercisePickerRowMeta } = require('../../.test-dist/lib/exercisePicker.js');
      const bandRow = library.find((item) => displayEquipmentValue(item) === 'band' && browse.isBrowsableExercise(item));
      assert.ok(bandRow, 'no band row');
      assert.match(exercisePickerRowMeta(bandRow, 'fi'), /Kuminauha/);
      assert.doesNotMatch(exercisePickerRowMeta(bandRow, 'fi'), /Kehonpaino/);
      // The foam-roller rows are rolled, not repped: not offered unasked.
      assert.deepEqual(names(unsearched.filter((item) => displayEquipmentValue(item) === 'foam roll')), []);
    },
  },
  {
    name: 'equipment buckets: a reader with no gear is not handed a band or ball row; a reader with a band is',
    run() {
      const gearRows = library.filter(
        (item) => item.equipment === 'bodyweight' && item.sourceCategory !== 'stretching' && (isBand(item) || isBall(item)),
      );
      assert.deepEqual(names(gearRows.filter((item) => isExerciseAllowedWithEquipment(item.name, []))), []);
      const everything = ['Barbells', 'Barbell & plates', 'Squat rack', 'Bench', 'Dumbbells', 'Kettlebells', 'Machines', 'Cables', 'Pull-up bar', 'Resistance bands', 'Cardio machines', 'Yoga mat'];
      assert.deepEqual(names(gearRows.filter((item) => !isExerciseAllowedWithEquipment(item.name, everything))), []);
      // The band alone is enough for the band rows that need nothing else —
      // the band good morning and skull crusher stopped asking for a bar.
      for (const name of ['Band Pull Apart', 'Monster Walk', 'Band Good Morning', 'Band Good Morning (Pull Through)', 'Band Skull Crusher', 'Seated Band Hamstring Curl', 'Band Hip Adductions', 'Band Curl']) {
        assert.equal(isExerciseAllowedWithEquipment(name, ['Resistance bands']), true, name);
      }
      // The programme page reads the same requirement forwards.
      assert.deepEqual(resolveProgramEquipment(['Monster Walk']), ['Resistance bands']);
      assert.deepEqual(resolveProgramEquipment(['Overhead Slam']), ['Machines']);
      // A catalogue name that only resolves to a band row is not one.
      assert.equal(isExerciseAllowedWithEquipment('Skull Crusher', ['Resistance bands']), false);
    },
  },
  {
    name: 'equipment buckets: the coach\'s "bodyweight" plan uses nothing in your hands; "minimal" may use a band',
    run() {
      const preferences = createEmptyDatabase().preferences;
      const plannedRows = (overrides) => {
        const plan = buildAiCoachPlanSchema({ ...preferences, ...overrides }, library);
        return plan.sessions
          .flatMap((session) => session.exercises)
          .map((exercise) => (exercise.libraryItemId ? library.find((item) => item.id === exercise.libraryItemId) : null))
          .filter(Boolean);
      };
      for (const aiPlannerGoal of ['strength', 'muscle', 'fat_loss', 'fitness']) {
        for (const aiPlannerDaysPerWeek of [1, 2, 3, 4]) {
          const rows = plannedRows({
            aiPlannerEquipment: 'bodyweight',
            aiPlannerGoal,
            aiPlannerDaysPerWeek,
            aiPlannerMustInclude: 'band pull apart, medicine ball, monster walk, exercise ball',
          });
          // Judged by the suite's own reading of the row, not by the function
          // under test.
          const gear = rows.filter(
            (item) => item.equipment !== 'bodyweight' || isBand(item) || isBall(item) || GEAR_SOURCES.has(item.sourceEquipment),
          );
          assert.deepEqual(names(gear), [], `${aiPlannerGoal} × ${aiPlannerDaysPerWeek}`);
        }
      }
      const minimal = plannedRows({ aiPlannerEquipment: 'minimal', aiPlannerMustInclude: 'band pull apart' });
      assert.ok(minimal.some((item) => item.name === 'Band Pull Apart'), names(minimal).join(', '));
    },
  },
];
