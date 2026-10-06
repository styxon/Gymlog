const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const classification = require('../../.test-dist/lib/exerciseClassification.js');
const { orderSwapCandidates, resolveSwapBrowsePrefilter } = require('../../.test-dist/lib/swapBrowsePrefilter.js');
const { getPopularExerciseLibraryOrder, getSuggestedExerciseLibraryItems } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { displayEquipmentValue, libraryLabel } = require('../../.test-dist/lib/libraryLabel.js');
const { rankExerciseMatches } = require('../../.test-dist/lib/exerciseSearch.js');

/**
 * Every exercise filter, over the whole library (#bugs 2026-10-06: "kaikki
 * filtterit uusiksi"). The reader found, from the phone:
 *
 * - "Etureidet" listing cable hip adduction, the cable deadlift, a diagonal
 *   bound and a backward sled drag — and still not the leg extension;
 * - "Laite" listing the car deadlift and Conan's wheel;
 * - rows reading "Keskivartalo · Kehonpaino · Keskivartalo".
 *
 * Each suite here states what a chip promises and checks every row, so the
 * next wrong row is found by the suite, not by the reader.
 */
const library = createSeedExerciseLibrary();
const byName = (name) => {
  const item = library.find((entry) => entry.name === name);
  assert.ok(item, `${name} missing from the library`);
  return item;
};
const unsearched = browse.filterBrowsableExercises(library);
const names = (rows) => rows.map((item) => item.name);

const SPECIALTY_EXAMPLES = [
  'Car Deadlift',
  "Conan's Wheel",
  'Tire Flip',
  'Atlas Stones',
  'Yoke Walk',
  'Log Lift',
  'Keg Load',
  'Axle Deadlift',
  'Backward Drag',
];

module.exports = [
  {
    name: 'filters: "Etureidet" lists quadriceps lifts — no hinge, no adduction, no cardio machine, no stretch',
    run() {
      const quads = unsearched.filter((item) => browse.matchesBodyPartFilter(item, 'quadriceps'));
      // Every row names the muscle.
      assert.deepEqual(names(quads.filter((item) => !(item.primaryMuscles ?? []).includes('quadriceps'))), []);
      // A deadlift, pull-through, good morning, hip thrust, kickback or an
      // adduction is a hip or adductor lift. The trap bar and leverage
      // deadlifts are the knee-dominant hybrids and stay.
      const hinge = /\b(deadlifts?|pull[- ]?through|good morning|hip thrust|kickback|adduct\w*|abduct\w*)\b/i;
      const kneeDominant = /^(Trap Bar Deadlift|Leverage Deadlift)$/;
      assert.deepEqual(names(quads.filter((item) => hinge.test(item.name) && !kneeDominant.test(item.name))), []);
      // The three muscle chips train the muscle: the treadmill and the
      // kneeling hip-flexor stretch name the quadriceps too.
      for (const muscle of browse.LEG_MUSCLE_FILTERS) {
        const noise = library.filter(
          (item) =>
            browse.matchesBodyPartFilter(item, muscle) &&
            (item.category === 'cardio' || item.sourceCategory === 'stretching'),
        );
        assert.deepEqual(names(noise), [], `${muscle} lists cardio or stretches`);
      }
      // The reported rows, by name.
      for (const name of ['Cable Hip Adduction', 'Cable Deadlifts', 'Car Deadlift', 'Backward Drag']) {
        assert.equal(quads.some((item) => item.name === name), false, `${name} is in Etureidet`);
      }
      assert.equal(browse.matchesBodyPartFilter(byName('Cable Hip Adduction'), 'quadriceps'), false);
      assert.deepEqual(byName('Cable Hip Adduction').primaryMuscles, ['adductors']);
    },
  },
  {
    name: 'filters: the leg extension is in "Etureidet", and every squat, lunge, leg press and step-up with it',
    run() {
      for (const name of ['Leg Extensions', 'Single-Leg Leg Extension']) {
        assert.equal(browse.matchesBodyPartFilter(byName(name), 'quadriceps'), true, name);
        assert.ok(unsearched.includes(byName(name)), `${name} is hidden from the unsearched list`);
      }
      const knee = /\b(squats?|lunges?|leg press|leg extensions?|step[- ]?ups?)\b/i;
      // Named exceptions: the calf press on the leg press machine, the
      // Turkish get-ups (a shoulder lift), and the kneeling squat and step-up
      // with knee raise, which the source files as glute lifts. The source's
      // warm-up drills (Sit Squats, Split Squats, Crossover Reverse Lunge) are
      // filed as stretching, and a muscle chip lists training.
      const notQuads = /calf press|turkish get-up|^kneeling (jump )?squat$|knee raise/i;
      const missing = unsearched.filter(
        (item) =>
          knee.test(item.name) &&
          !notQuads.test(item.name) &&
          item.sourceCategory !== 'stretching' &&
          !browse.matchesBodyPartFilter(item, 'quadriceps'),
      );
      assert.deepEqual(names(missing), []);
      // And the curls and calf raises in theirs.
      assert.deepEqual(
        names(unsearched.filter((item) => /\bleg curls?\b/i.test(item.name) && !browse.matchesBodyPartFilter(item, 'hamstrings'))),
        [],
      );
      assert.deepEqual(
        names(unsearched.filter((item) => /\bcalf (raises?|press)\b/i.test(item.name) && !browse.matchesBodyPartFilter(item, 'calves'))),
        [],
      );
    },
  },
  {
    /**
     * "Reiden ojennus" was in the quadriceps pool all along — at position 74
     * of 137 when swapping a barbell squat, behind 47 barbell rows (snatches,
     * clean pulls, jerk dip squats), and the swap list shows 25. Mirrors the
     * unsearched list in GuidedPlayerScreen's `swapLibrary`.
     */
    name: 'filters: swapping any quadriceps staple shows the leg extension in the first 25 rows',
    run() {
      const popular = getPopularExerciseLibraryOrder(library);
      const SWAP_LIST_ROWS = 25;
      for (const name of [
        'Barbell Squat',
        'Barbell Full Squat',
        'Front Barbell Squat',
        'Leg Press',
        'Hack Squat',
        'Goblet Squat',
        'Bulgarian Split Squat',
        'Barbell Lunge',
        'Smith Machine Squat',
      ]) {
        const current = byName(name);
        const chip = resolveSwapBrowsePrefilter(current);
        assert.equal(chip, 'quadriceps', name);
        const pool = unsearched.filter((item) => item.name !== name && browse.matchesBodyPartFilter(item, chip));
        const shown = names(orderSwapCandidates(pool, current, popular).slice(0, SWAP_LIST_ROWS));
        assert.ok(shown.includes('Leg Extensions'), `swapping ${name}: ${shown.join(', ')}`);
        for (const reported of ['Alternate Leg Diagonal Bound', 'Backward Drag', 'Cable Hip Adduction', 'Cable Deadlifts']) {
          assert.equal(shown.includes(reported), false, `swapping ${name} shows ${reported}`);
        }
      }
    },
  },
  {
    name: 'filters: "Laite" lists machines — sourced as one, a sled, or the app\'s own machine rows',
    run() {
      const machine = unsearched.filter((item) => browse.matchesEquipmentFilter(item, 'machine'));
      const notAMachine = machine.filter(
        (item) =>
          !(
            item.sourceEquipment === 'machine' ||
            /\b(sled|prowler)\b/i.test(item.name) ||
            (item.sourceEquipment == null && item.id.startsWith('extra_'))
          ),
      );
      assert.deepEqual(names(notAMachine), []);
      assert.ok(machine.some((item) => item.name === 'Leg Extensions'));
      assert.ok(machine.some((item) => item.name === 'Leg Press'));
    },
  },
  {
    name: 'filters: specialty movements are hidden from every default list and equipment chip, and reachable',
    run() {
      for (const name of SPECIALTY_EXAMPLES) {
        const item = byName(name);
        assert.equal(classification.isSpecialtyExercise(item), true, name);
        // Not in the unsearched list, under any body part or equipment chip.
        assert.equal(unsearched.includes(item), false, `${name} is offered unasked`);
        for (const equipment of browse.EQUIPMENT_FILTERS.filter((value) => value !== 'all')) {
          assert.equal(browse.matchesEquipmentFilter(item, equipment), false, `${name} under ${equipment}`);
        }
        // Their own chip lists them...
        const chip = browse
          .filterBrowsableExercises(library, { type: 'specialty' })
          .filter((entry) => browse.matchesExerciseTypeFilter(entry, 'specialty'));
        assert.ok(chip.includes(item), `${name} missing from the specialty chip`);
        assert.equal(browse.passesSpecialtyGate(item, { query: '', type: 'all' }), false);
        assert.equal(browse.passesSpecialtyGate(item, { query: '', type: 'specialty' }), true);
      }
      // ...and only them.
      const chip = browse
        .filterBrowsableExercises(library, { type: 'specialty' })
        .filter((entry) => browse.matchesExerciseTypeFilter(entry, 'specialty'));
      assert.deepEqual(names(chip.filter((item) => !classification.isSpecialtyExercise(item))), []);
      // Search finds them in both languages.
      for (const [query, language, name] of [
        ['autonnosto', 'fi', 'Car Deadlift'],
        ['conan', 'fi', "Conan's Wheel"],
        ['tire flip', 'en', 'Tire Flip'],
      ]) {
        const found = rankExerciseMatches(browse.filterBrowsableExercises(library, { query }), query, language, () => undefined);
        assert.ok(found.some((item) => item.name === name), `"${query}" does not find ${name}`);
      }
      // The whole unsearched library holds none.
      assert.deepEqual(names(unsearched.filter(classification.isSpecialtyExercise)), []);
    },
  },
  {
    name: 'filters: everything a ready programme prescribes stays a normal exercise',
    run() {
      const libraryNames = names(library);
      const prescribed = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const index = findGuidedLibraryIndex(exercise.exerciseName, libraryNames);
            if (index !== null) prescribed.add(library[index]);
          }
        }
      }
      assert.ok(prescribed.size > 100, `only ${prescribed.size} prescribed lifts resolved`);
      assert.deepEqual(names([...prescribed].filter(classification.isSpecialtyExercise)), []);
      // The two strongman rows that are everyday gym work.
      assert.equal(classification.isSpecialtyExercise(byName("Farmer's Walk")), false);
      assert.equal(classification.isSpecialtyExercise(byName('Sled Push')), false);
    },
  },
  {
    name: 'filters: suggestions never offer a specialty movement or something that is not a set',
    run() {
      const legMachineDay = ['free_leg_press', 'free_leg_extensions'];
      for (const currentItemIds of [legMachineDay, ['free_barbell_deadlift'], ['free_seated_cable_rows'], []]) {
        const suggested = getSuggestedExerciseLibraryItems({ exerciseLibrary: library, currentItemIds, limit: 40 });
        assert.deepEqual(names(suggested.filter((item) => !unsearched.includes(item))), [], currentItemIds.join());
      }
    },
  },
  {
    name: 'filters: every row is in exactly one type chip, and compound / isolation follow the source mechanic',
    run() {
      const types = browse.EXERCISE_TYPE_FILTERS.filter((value) => value !== 'all');
      for (const item of library) {
        const chips = types.filter((type) => browse.matchesExerciseTypeFilter(item, type));
        assert.equal(chips.length, 1, `${item.name}: ${chips.join(', ') || 'no type chip'}`);
      }
      const wrongMechanic = library.filter(
        (item) =>
          (item.sourceMechanic === 'isolation' || item.sourceMechanic === 'compound') &&
          (item.category === 'compound' || item.category === 'isolation') &&
          !classification.isSpecialtyExercise(item) &&
          !browse.matchesExerciseTypeFilter(item, item.sourceMechanic),
      );
      assert.deepEqual(names(wrongMechanic), []);
      assert.equal(browse.matchesExerciseTypeFilter(byName('Leg Extensions'), 'isolation'), true);
      assert.equal(browse.matchesExerciseTypeFilter(byName('Leg Extensions'), 'compound'), false);
    },
  },
  {
    name: 'filters: every unsearched row is under some body-part chip, some equipment chip, or is labelled by what it uses',
    run() {
      const noBodyPart = unsearched.filter(
        (item) => !browse.BODY_PART_FILTERS.some((filter) => filter !== 'all' && browse.matchesBodyPartFilter(item, filter)),
      );
      assert.deepEqual(names(noBodyPart), []);
      const noEquipment = unsearched.filter(
        (item) => !browse.EQUIPMENT_FILTERS.some((filter) => filter !== 'all' && browse.matchesEquipmentFilter(item, filter)),
      );
      assert.deepEqual(names(noEquipment), []);
    },
  },
  {
    name: 'filters: a row\'s meta line never repeats a word, and core rows say compound or isolation',
    run() {
      for (const language of ['fi', 'en']) {
        const repeats = library.filter((item) => {
          const labels = classification.exerciseRowMetaValues(item).map((value) => libraryLabel(value, language));
          return new Set(labels).size !== labels.length;
        });
        assert.deepEqual(names(repeats), [], language);
      }
      // The reported shape: a core bodyweight row.
      const crunch = library.find(
        (item) => item.bodyPart === 'core' && item.equipment === 'bodyweight' && item.sourceMechanic === 'isolation',
      );
      assert.deepEqual(classification.exerciseRowMetaValues(crunch), ['core', 'bodyweight', 'isolation']);
      assert.deepEqual(classification.exerciseRowMetaValues(byName('Leg Extensions')), ['legs', 'machine', 'isolation']);
      assert.deepEqual(classification.exerciseRowMetaValues(byName('Car Deadlift')), ['legs', 'machine', 'specialty']);
      assert.equal(libraryLabel('specialty', 'fi'), 'Erikoisliike');
      assert.equal(libraryLabel('specialty', 'en'), 'Specialty');
      // The equipment slot is the displayed value: kettlebells, not dumbbell.
      const kettlebell = library.find((item) => item.sourceEquipment === 'kettlebells');
      assert.equal(classification.exerciseRowMetaValues(kettlebell)[1], displayEquipmentValue(kettlebell));
    },
  },
  {
    name: 'filters: the source corrections keep each row\'s body part, and only touch the rows they name',
    run() {
      const generated = new Map(GENERATED_EXERCISE_LIBRARY.map((item) => [item.id, item]));
      const changed = library.filter((item) => {
        const source = generated.get(item.id);
        return source && JSON.stringify(source.primaryMuscles) !== JSON.stringify(item.primaryMuscles);
      });
      assert.deepEqual(names(changed).sort(), ['Cable Deadlifts', 'Cable Hip Adduction', 'Lunge Pass Through', 'One-Arm Side Deadlift']);
      for (const item of changed) {
        assert.equal(item.bodyPart, generated.get(item.id).bodyPart, item.name);
      }
    },
  },
  {
    name: 'filters: every picker reads the shared rules, and the specialty chip is labelled in both languages',
    run() {
      const read = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
      const sheet = read('src/components/AddExerciseSheet.tsx');
      assert.match(sheet, /matchesExerciseTypeFilter\(item, category\)/);
      assert.match(sheet, /const categoryOptions = EXERCISE_TYPE_FILTERS;/);
      assert.match(sheet, /specialty: 'facet\.specialty'/);
      assert.doesNotMatch(sheet, /item\.category !== category/);
      assert.doesNotMatch(sheet, /toLabel\(item\.category, language\)/);
      const browser = read('src/components/ExerciseLibraryBrowser.tsx');
      assert.match(browser, /matchesExerciseTypeFilter\(item, categoryFilter\)/);
      assert.match(browser, /passesSpecialtyGate\(item, \{ query, type: categoryFilter \}\)/);
      assert.doesNotMatch(browser, /item\.category !== categoryFilter/);
      const empty = read('src/screens/EmptyWorkoutScreen.tsx');
      assert.match(empty, /filterBrowsableExercises\(items, \{ query: normalizedQuery \}\)/);
      const player = read('src/screens/GuidedPlayerScreen.tsx');
      assert.match(player, /filterBrowsableExercises\(exerciseLibrary, \{ query \}\)/);

      const { t } = require('../../.test-dist/lib/i18n.js');
      assert.equal(t('fi', 'facet.specialty'), 'Erikoisliikkeet');
      assert.equal(t('en', 'facet.specialty'), 'Specialty');
    },
  },
];
