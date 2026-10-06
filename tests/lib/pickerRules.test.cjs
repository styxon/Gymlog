const assert = require('node:assert/strict');

const { createSeedExerciseLibrary, createEmptyDatabase } = require('../../.test-dist/data/seed.js');
const { WORKOUT_TEMPLATES_V1, WORKOUT_SUBSTITUTION_GROUPS } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const classification = require('../../.test-dist/lib/exerciseClassification.js');
const picker = require('../../.test-dist/lib/exercisePicker.js');
const { libraryLabel } = require('../../.test-dist/lib/libraryLabel.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { buildSwapLibraryMatches } = require('../../.test-dist/lib/swapShortlist.js');
const {
  getPopularExerciseLibraryItems,
  getSuggestedExerciseLibraryItems,
} = require('../../.test-dist/lib/exerciseSuggestions.js');
const { buildAiCoachPlanSchema } = require('../../.test-dist/lib/aiCoachPlan.js');
const { parseCsvProgram } = require('../../.test-dist/lib/csvProgramImport.js');
const { STRENGTH_GOAL_PRESETS } = require('../../.test-dist/lib/strengthGoalPresets.js');

/**
 * The user's rules for every place the app offers exercises (#bugs
 * 2026-10-06, "kaikki filtterit uusiksi"), checked over the whole library
 * through each picker's own configuration — not through the classifier
 * functions alone, which exerciseFilterInvariants already covers:
 *
 * 1. a specialty (strongman) movement is never offered unsearched or as a
 *    suggestion — only under its own chip or a query;
 * 2. a stretch or drill is never offered as a set unsearched;
 * 3. the leg extension is in "Etureidet" in every picker that has muscle chips;
 * 4. its Finnish and English names both find it, and so does "autonnosto";
 * 5. a row prints the same body part, type and equipment words in every picker.
 *
 * Each picker composes its list with `listPickerExercises`; the wiring that
 * makes each screen call it is pinned in tests/screens/pickerWiring.test.cjs.
 */
const library = createSeedExerciseLibrary();
const names = (rows) => rows.map((item) => item.name);
const isNotASet = (item) => !browse.isBrowsableExercise(item);
const isSpecialty = (item) => classification.isSpecialtyExercise(item);
const byName = (name) => {
  const item = library.find((entry) => entry.name === name);
  assert.ok(item, `${name} missing from the library`);
  return item;
};

/** Each picker as it calls the shared list: which chips it has, and whether it lists stretches. */
const PICKERS = [
  // The add sheet — programme builder, programme day and the guided player's add.
  { name: 'add sheet', chips: ['category', 'bodyPart', 'equipment'], listsStretches: false },
  // The guided player's swap: the same sheet in swap mode.
  { name: 'guided swap', chips: ['category', 'bodyPart', 'equipment'], listsStretches: false },
  // The empty workout's add sheet: one body-part row.
  { name: 'empty workout', chips: ['bodyPart'], listsStretches: false },
  // The exercise library screen: where a stretch is learnt, so it lists them.
  { name: 'library screen', chips: ['category', 'bodyPart', 'equipment'], listsStretches: true },
  // The import's "which lift did you mean": search only.
  { name: 'import teach list', chips: [], listsStretches: false },
];

const CHIP_VALUES = {
  category: browse.EXERCISE_TYPE_FILTERS,
  bodyPart: browse.BODY_PART_FILTERS,
  equipment: browse.EQUIPMENT_FILTERS,
};

/** Every single-chip setting a picker can be in, plus no chip at all. */
function chipSettings(chips) {
  const settings = [{}];
  for (const group of chips) {
    for (const value of CHIP_VALUES[group]) {
      if (value !== 'all') settings.push({ [group]: value });
    }
  }
  return settings;
}

module.exports = [
  {
    name: 'pickers: no picker lists a specialty movement unsearched, except under the specialty chip',
    run() {
      let lists = 0;
      for (const config of PICKERS) {
        for (const filters of chipSettings(config.chips)) {
          const rows = picker.listPickerExercises(library, { filters, language: 'fi', listsStretches: config.listsStretches });
          lists += 1;
          if (filters.category === 'specialty') {
            assert.ok(rows.length > 0, `${config.name}: the specialty chip lists nothing`);
            assert.deepEqual(names(rows.filter((item) => !isSpecialty(item))), [], `${config.name}: specialty chip`);
            continue;
          }
          assert.deepEqual(names(rows.filter(isSpecialty)), [], `${config.name} ${JSON.stringify(filters)}`);
        }
      }
      assert.ok(lists > 40, `only ${lists} chip settings checked`);
    },
  },
  {
    name: 'pickers: no picker that adds or swaps a set lists a stretch or drill unsearched',
    run() {
      for (const config of PICKERS.filter((entry) => !entry.listsStretches)) {
        for (const filters of chipSettings(config.chips)) {
          // "Venytykset" is where a stretch is asked for, like a query.
          if (filters.category === 'stretch') continue;
          const rows = picker.listPickerExercises(library, { filters, language: 'fi' });
          assert.deepEqual(names(rows.filter(isNotASet)), [], `${config.name} ${JSON.stringify(filters)}`);
        }
      }
      // A query finds them: "venytys" names what it wants.
      const searched = picker.listPickerExercises(library, { query: 'venytys', language: 'fi' });
      assert.ok(searched.some(isNotASet), 'a query no longer reaches the stretches');
    },
  },
  {
    name: 'pickers: the leg extension is under "Etureidet" in every picker with muscle chips',
    run() {
      const withMuscles = PICKERS.filter((config) => config.chips.includes('bodyPart'));
      assert.ok(withMuscles.length >= 4);
      for (const config of withMuscles) {
        const quads = picker.listPickerExercises(library, {
          filters: { bodyPart: 'quadriceps' },
          language: 'fi',
          listsStretches: config.listsStretches,
        });
        assert.ok(quads.some((item) => item.name === 'Leg Extensions'), `${config.name}: no leg extension in Etureidet`);
        // And the muscle chip lists the muscle's training, not a hip adduction.
        assert.equal(quads.some((item) => item.name === 'Cable Hip Adduction'), false, config.name);
      }
      // Through the type chip too: it is an isolation lift.
      const isolation = picker.listPickerExercises(library, {
        filters: { bodyPart: 'quadriceps', category: 'isolation' },
        language: 'fi',
      });
      assert.ok(isolation.some((item) => item.name === 'Leg Extensions'));
    },
  },
  {
    name: 'pickers: Finnish and English names find the lift, in either app language',
    run() {
      const cases = [
        ['reiden ojennus', 'Leg Extensions'],
        ['leg extension', 'Leg Extensions'],
        ['leg extensions', 'Leg Extensions'],
        ['jalan ojennus', 'Leg Extensions'],
        ['autonnosto', 'Car Deadlift'],
        ['car deadlift', 'Car Deadlift'],
        ['takakyykky', 'Barbell Squat'],
        ['penkkipunnerrus', 'Barbell Bench Press - Medium Grip'],
      ];
      for (const language of ['fi', 'en']) {
        // By the name on screen: the swap list keeps one row per shown name,
        // and Barbell Full Squat reads "Takakyykky" as Barbell Squat does.
        const shown = (item) => exerciseNameLabel(language, item.name);
        for (const [query, expected] of cases) {
          const wanted = exerciseNameLabel(language, expected);
          // Every searching picker lists through the same function.
          const found = picker.listPickerExercises(library, { query, language });
          assert.ok(
            found.slice(0, 5).some((item) => shown(item) === wanted),
            `${language} "${query}": ${names(found.slice(0, 5)).join(', ')}`,
          );
          // The programme day's and Home's swap search.
          const swapFound = buildSwapLibraryMatches(library, query, language);
          assert.ok(swapFound.some((item) => shown(item) === wanted), `swap ${language} "${query}"`);
        }
      }
    },
  },
  {
    name: 'pickers: a row prints the same body part, type and equipment words as its chips, in every picker',
    run() {
      for (const language of ['fi', 'en']) {
        for (const item of library) {
          const meta = picker.exercisePickerRowMeta(item, language);
          const words = classification.exerciseRowMetaValues(item).map((value) => libraryLabel(value, language));
          assert.equal(meta, words.join(' · '), item.name);
          // The body part opens the line, as the chip names it.
          assert.ok(meta.startsWith(picker.exercisePickerLabel(item.bodyPart, language)), item.name);
        }
        // A chip and the row it selects say the same word.
        for (const value of [...browse.BODY_PART_FILTERS, ...browse.EQUIPMENT_FILTERS, ...browse.EXERCISE_TYPE_FILTERS]) {
          assert.equal(picker.exercisePickerLabel(value, language), libraryLabel(value, language), value);
        }
      }
      // The Finnish words: the add sheet's, kept everywhere (user, 2026-10-06).
      const curl = byName('Alternate Hammer Curl');
      assert.equal(picker.exercisePickerRowMeta(curl, 'fi'), 'Hauis · Käsipaino · Eristävä');
      const words = (values) => values.map((value) => picker.exercisePickerLabel(value, 'fi'));
      assert.deepEqual(words(['compound', 'isolation', 'cardio', 'dumbbell', 'cable', 'machine', 'barbell']), [
        'Perusliike', 'Eristävä', 'Cardio', 'Käsipaino', 'Talja', 'Laite', 'Tanko',
      ]);
      // A chip names a group, a row one lift.
      assert.equal(picker.exercisePickerChipLabel('specialty', 'fi'), 'Erikoisliikkeet');
      assert.equal(picker.exercisePickerLabel('specialty', 'fi'), 'Erikoisliike');
    },
  },
  {
    name: 'pickers: an unsearched list is in the alphabet of the name on screen',
    run() {
      const rows = picker
        .listPickerExercises(library, { filters: { bodyPart: 'quadriceps' }, language: 'fi' })
        .sort(picker.compareByShownName('fi'));
      const labels = rows.map((item) => exerciseNameLabel('fi', item.name));
      assert.deepEqual(labels, [...labels].sort((left, right) => left.localeCompare(right)));
    },
  },
  {
    name: 'suggestions: popular and suggested lifts are sets among normal exercises',
    run() {
      const offered = [
        ...getPopularExerciseLibraryItems(library, 20),
        ...getSuggestedExerciseLibraryItems({ exerciseLibrary: library, currentItemIds: ['free_leg_press'], limit: 40 }),
        ...getSuggestedExerciseLibraryItems({ exerciseLibrary: library, currentItemIds: [], limit: 40 }),
      ];
      assert.deepEqual(names(offered.filter((item) => isSpecialty(item) || isNotASet(item))), []);
    },
  },
  {
    name: 'suggestions: a lifting slot\'s swap pool holds no specialty movement and no stretch',
    run() {
      const libraryNames = names(library);
      const offenders = [];
      for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
        // Mobility and yoga slots are stretches by design; a stretch is the swap for a stretch.
        // Interval and agility slots are drills the same way: a sprint is the swap for a sprint.
        const mobility = /mobility|yoga|stretch|interval|agility|drill|breathing|activation/.test(group.id);
        for (const exerciseName of group.allowedExerciseNames) {
          const index = findGuidedLibraryIndex(exerciseName, libraryNames);
          if (index === null) continue;
          const item = library[index];
          if (isSpecialty(item) || (!mobility && isNotASet(item))) {
            offenders.push(`${group.id}: ${exerciseName} -> ${item.name}`);
          }
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
  {
    /**
     * The AI coach's own plan: a slot that names no stretch must not land on
     * one. A mobility focus searched "world greatest stretch", which no row
     * spells (the library writes "World's"), so the slot fell back to the
     * first full-body row — Chin To Chest Stretch, in 45 of 2,025 plans.
     */
    name: 'AI coach: a plan never fills a slot with a stretch or a specialty movement the slot did not name',
    run() {
      const base = createEmptyDatabase('fi').preferences;
      const offenders = new Map();
      let plans = 0;
      for (const setupGoal of ['strength', 'muscle', 'general_fitness', 'lean_athletic', 'run_mobility'])
        for (const setupDaysPerWeek of [1, 2, 3, 4, 5])
          for (const setupEquipment of ['gym', 'home', 'minimal'])
            for (const focus of [[], ['glutes'], ['legs'], ['chest'], ['back'], ['shoulders'], ['arms'], ['core'], ['mobility']])
              for (const setupLevel of ['beginner', 'advanced', 'pro']) {
                const preferences = { ...base, setupGoal, setupDaysPerWeek, setupEquipment, setupFocusAreas: focus, setupLevel };
                const plan = buildAiCoachPlanSchema(preferences, library);
                plans += 1;
                for (const session of plan.sessions) {
                  for (const exercise of session.exercises) {
                    const item = library.find((entry) => entry.id === exercise.libraryItemId);
                    if (!item) continue;
                    // The mobility slot names World's Greatest Stretch on purpose.
                    const named = item.name === "World's Greatest Stretch" && focus[0] === 'mobility';
                    if (isSpecialty(item) || (isNotASet(item) && !named)) {
                      offenders.set(item.name, (offenders.get(item.name) ?? 0) + 1);
                    }
                  }
                }
              }
      assert.equal(plans, 2025);
      assert.deepEqual([...offenders.entries()], []);
      // And the mobility focus gets the mobility work its slot names, not
      // the first full-body row (an isometric neck exercise).
      const mobility = buildAiCoachPlanSchema({ ...base, setupDaysPerWeek: 1, setupFocusAreas: ['mobility'] }, library);
      const names1 = mobility.sessions.flatMap((session) => session.exercises).map((exercise) => exercise.name);
      assert.ok(names1.includes("World's Greatest Stretch"), names1.join(' | '));
    },
  },
  {
    name: 'AI coach: the fallback, when no search word lands, is a set — never a stretch',
    run() {
      const base = createEmptyDatabase('fi').preferences;
      // No World's Greatest Stretch, no lunge, no plank: the mobility slot's
      // three words all miss and the fallback decides.
      const thinned = library.filter((item) => !/world's greatest|walking lunge|plank/i.test(item.name));
      // One day a week is the full-body session, the one with a focus slot.
      const plan = buildAiCoachPlanSchema({ ...base, setupDaysPerWeek: 1, setupFocusAreas: ['mobility'] }, thinned);
      const picked = plan.sessions
        .flatMap((session) => session.exercises)
        .map((exercise) => thinned.find((item) => item.id === exercise.libraryItemId))
        .filter(Boolean);
      assert.ok(picked.length > 0);
      assert.deepEqual(names(picked.filter((item) => isNotASet(item) || isSpecialty(item))), []);
    },
  },
  {
    /**
     * The import's guess when a name is not the library's: "Conventional
     * Deadlift" was offered as Axle Deadlift, "Quad Extension" as Quad
     * Stretch. An exact name or the app's own label still reaches every row;
     * a guess reaches what a picker offers unasked, unless the written name
     * itself says stretch.
     */
    name: 'CSV import: a guessed match is never a specialty movement or a stretch the name did not ask for',
    run() {
      const guess = (written) => {
        const preview = parseCsvProgram(`Day,Exercise,Sets,Reps\nA,"${written}",3,10`, library, [], 'fi');
        const row = preview.rows[0];
        return row ? row.matchedName ?? row.suggestion : null;
      };
      for (const written of ['Conventional Deadlift', 'Competition Deadlift', 'Quad Extension', 'Drag', 'Flip', 'Carry']) {
        const name = guess(written);
        if (name === null) continue;
        const item = byName(name);
        assert.equal(isSpecialty(item) || isNotASet(item), false, `"${written}" -> ${name}`);
      }
      // Written out, they are still theirs.
      assert.equal(guess('Car Deadlift'), 'Car Deadlift');
      assert.equal(guess('Tire Flip'), 'Tire Flip');
      assert.equal(guess('Autonnosto'), 'Car Deadlift');
      assert.equal(guess('Quad Stretch'), 'Quad Stretch');
    },
  },
  {
    name: 'strength goals: the target lifts are normal exercises the library holds, each with a Finnish name',
    run() {
      for (const preset of STRENGTH_GOAL_PRESETS) {
        const item = byName(preset.exerciseName);
        assert.equal(isSpecialty(item) || isNotASet(item), false, preset.exerciseName);
        assert.notEqual(exerciseNameLabel('fi', item.name), item.name, `${item.name} has no Finnish name`);
      }
    },
  },
  {
    name: 'ready programmes: every prescribed lift that resolves is a normal exercise (mobility work aside)',
    run() {
      const libraryNames = names(library);
      const specialty = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const index = findGuidedLibraryIndex(exercise.exerciseName, libraryNames);
            if (index !== null && isSpecialty(library[index])) specialty.push(`${template.id}: ${exercise.exerciseName}`);
          }
        }
      }
      assert.deepEqual(specialty, []);
    },
  },
];
