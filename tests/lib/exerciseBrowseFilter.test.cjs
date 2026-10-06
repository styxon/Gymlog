const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isBrowsableExercise,
  filterBrowsableExercises,
  matchesBodyPartFilter,
  BODY_PART_FILTERS,
} = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');

module.exports = [
  {
    name: 'browse filter: stretches and field drills are not offered as sets',
    run() {
      for (const name of [
        'Behind Head Chest Stretch',
        'Dynamic Chest Stretch',
        'Chest Push (multiple response)',
        'Chest Push (single response)',
        'Front Cone Hops (or hurdle hops)',
        'Hurdle Hops',
        'Bench Sprint',
      ]) {
        assert.equal(isBrowsableExercise({ name }), false, `still offered: ${name}`);
      }
    },
  },
  {
    name: 'browse filter: the rule does not reach past what it names',
    run() {
      // Each of these was caught by a broader draft of the rule. A drag curl is
      // a barbell biceps lift; sled and Bosu work is loaded and logged; the
      // Olympic "balance" positions are lifts, not balance drills.
      for (const name of [
        'Drag Curl',
        'Sled Push',
        'Sled Row',
        'Bear Crawl Sled Drags',
        'Bosu Ball Cable Crunch With Side Bends',
        'Heaving Snatch Balance',
        'Jerk Balance',
        'Barbell Bench Press - Medium Grip',
        'Machine Hip Thrust',
      ]) {
        assert.equal(isBrowsableExercise({ name }), true, `wrongly hidden: ${name}`);
      }
    },
  },
  {
    name: 'browse filter: a query is the reader naming it, so nothing is withheld',
    run() {
      const items = [{ name: 'Barbell Bench Press' }, { name: 'Dynamic Chest Stretch' }];
      assert.equal(filterBrowsableExercises(items).length, 1);
      assert.equal(filterBrowsableExercises(items, { query: '' }).length, 1);
      assert.equal(filterBrowsableExercises(items, { query: '  ' }).length, 1);
      assert.equal(filterBrowsableExercises(items, { query: 'stretch' }).length, 2);
      // Even a query that matches neither: the point is that the picker stops
      // choosing once the reader has, not that the word was "stretch".
      assert.equal(filterBrowsableExercises(items, { query: 'kyykky' }).length, 2);
    },
  },
  {
    name: 'browse filter: it removes a real slice of the real library, and no more',
    run() {
      // A rule that hides nothing is decoration; one that hides hundreds has
      // stopped being a filter and started being a different library.
      const library = createSeedExerciseLibrary();
      const kept = filterBrowsableExercises(library);
      const hidden = library.length - kept.length;
      assert.ok(hidden >= 40, `hid only ${hidden} of ${library.length}`);
      // 92 once the ready programmes' own stretches, cone drill and sprint got
      // rows, and the foam-roller rows joined the stretches (2026-10-06): the
      // rule hides them as it should.
      assert.ok(hidden <= 115, `hid ${hidden} of ${library.length} — too wide`);

      // The lifts a programme is actually built from all survive.
      const names = new Set(kept.map((item) => item.name));
      for (const name of ['Barbell Bench Press - Medium Grip', 'Barbell Squat', 'Barbell Deadlift']) {
        assert.ok(names.has(name), `missing from the picker: ${name}`);
      }
    },
  },
  {
    name: 'browse filter: the picker actually uses it',
    run() {
      const sheet = fs.readFileSync(
        path.join(__dirname, '../../src/components/AddExerciseSheet.tsx'),
        'utf8',
      );
      // Through every picker's one list (lib/exercisePicker, 2026-10-06),
      // which applies it with the query passed through so searching still
      // reaches everything, and the type chip so the specialty chip can list
      // what the default list hides.
      assert.match(sheet, /listPickerExercises\(items, \{\s*query: search,\s*filters: \{ category, bodyPart, equipment \}/);
      const shared = fs.readFileSync(path.join(__dirname, '../../src/lib/exercisePicker.ts'), 'utf8');
      assert.match(shared, /filterBrowsableExercises\(\[\.\.\.items\], \{ query: typed, type: chips\.category \}\)/);
    },
  },
  {
    name: 'body-part chips: arms and the three leg muscles each find their lifts',
    run() {
      const library = createSeedExerciseLibrary();
      const count = (filter) => library.filter((item) => matchesBodyPartFilter(item, filter)).length;
      for (const filter of ['biceps', 'triceps', 'quadriceps', 'hamstrings', 'calves']) {
        assert.ok(BODY_PART_FILTERS.includes(filter), `no chip for ${filter}`);
        assert.ok(count(filter) >= 10, `${filter} finds only ${count(filter)} lifts`);
      }
      // A muscle chip reads the primary muscles, not the coarse body part:
      // every lift it returns names that muscle, and "legs" still holds them all.
      for (const muscle of ['quadriceps', 'hamstrings', 'calves']) {
        const found = library.filter((item) => matchesBodyPartFilter(item, muscle));
        assert.ok(found.every((item) => (item.primaryMuscles ?? []).includes(muscle)));
      }
      const squat = library.find((item) => item.name === 'Barbell Squat');
      assert.ok(squat, 'Barbell Squat missing from the library');
      assert.equal(matchesBodyPartFilter(squat, 'legs'), true);
      assert.equal(matchesBodyPartFilter(squat, 'quadriceps'), true);
      assert.equal(matchesBodyPartFilter(squat, 'hamstrings'), false);
      assert.equal(matchesBodyPartFilter(squat, 'biceps'), false);
      assert.equal(matchesBodyPartFilter(squat, 'all'), true);
      // A lift with no muscle data is not in any muscle chip, and does not throw.
      assert.equal(matchesBodyPartFilter({ bodyPart: 'legs' }, 'calves'), false);
    },
  },
  {
    name: 'body-part chips: the quick row and the full filter are the same list',
    run() {
      const sheet = fs.readFileSync(
        path.join(__dirname, '../../src/components/AddExerciseSheet.tsx'),
        'utf8',
      );
      // Two lists is how the quick row lost biceps and triceps.
      // Both rows map the shared list, and no hand-written body-part list
      // ('all' followed by a body part) sits beside it.
      assert.match(sheet, /BODY_PART_FILTERS\.map\(/, 'the quick row');
      assert.match(sheet, /options=\{BODY_PART_FILTERS\}/, 'the full filter');
      assert.doesNotMatch(sheet, /'all',\s*'(?:chest|back|shoulders|legs|biceps|triceps)'/);
      // The chips' rule and labels are every picker's (lib/exercisePicker).
      const shared = fs.readFileSync(path.join(__dirname, '../../src/lib/exercisePicker.ts'), 'utf8');
      assert.match(shared, /matchesBodyPartFilter\(item, filters\.bodyPart\)/);
      const { exercisePickerLabel } = require('../../.test-dist/lib/exercisePicker.js');
      for (const [muscle, fi] of [['quadriceps', 'Etureidet'], ['hamstrings', 'Takareidet'], ['calves', 'Pohkeet']]) {
        assert.equal(exercisePickerLabel(muscle, 'fi'), fi, `no label for ${muscle}`);
      }
    },
  },
];
