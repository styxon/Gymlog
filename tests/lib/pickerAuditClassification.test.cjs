const assert = require('node:assert/strict');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { rankExerciseMatches } = require('../../.test-dist/lib/exerciseSearch.js');

/**
 * Three findings of the picker audit (2026-10-06), each a classification the
 * pickers only repeat.
 */
const library = createSeedExerciseLibrary();
const libraryNames = library.map((item) => item.name);
const unsearched = browse.filterBrowsableExercises(library);
const names = (rows) => rows.map((item) => item.name);

module.exports = [
  {
    name: 'picker audit: no row the source files as stretching is offered unasked as a set — and a prescribed one is still found',
    run() {
      // Less the one set the source files as stretching: the crossover reverse
      // lunge, the single-leg pool's curtsy lunge (exerciseClassification).
      const SET_FILED_AS_STRETCHING = 'Crossover Reverse Lunge';
      assert.deepEqual(
        names(unsearched.filter((item) => item.sourceCategory === 'stretching' && item.name !== SET_FILED_AS_STRETCHING)),
        [],
      );
      for (const name of ["Child's Pose", 'Arm Circles', '90/90 Hamstring', 'Calves-SMR', 'Adductor']) {
        const item = library.find((entry) => entry.name === name);
        assert.ok(item, name);
        assert.equal(unsearched.includes(item), false, `${name} is offered unasked`);
      }
      // Everything a ready programme prescribes from them still resolves to
      // its row by name (the day, the player and the demo read names) and is
      // found by a query.
      const prescribed = new Map();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const index = findGuidedLibraryIndex(exercise.exerciseName, libraryNames);
            if (index !== null && library[index].sourceCategory === 'stretching') {
              prescribed.set(exercise.exerciseName, library[index]);
            }
          }
        }
      }
      assert.ok(prescribed.size >= 10, `${prescribed.size} prescribed mobility rows`);
      for (const [prescribedName, item] of prescribed) {
        const query = item.name;
        const found = rankExerciseMatches(browse.filterBrowsableExercises(library, { query }), query, 'en', () => undefined);
        assert.ok(found.includes(item), `${prescribedName} (${item.name}) cannot be found`);
      }
    },
  },
  {
    /**
     * Stretches are a type of their own, built like the specialty one (user,
     * 2026-10-06): hidden from every unsearched set list, listed by their own
     * chip and by search, and still listed by the library screen.
     */
    name: 'picker audit: every stretch is type "stretch", in no unsearched set list, and all of them under "Venytykset"',
    run() {
      const classification = require('../../.test-dist/lib/exerciseClassification.js');
      const { libraryLabel } = require('../../.test-dist/lib/libraryLabel.js');
      const { t } = require('../../.test-dist/lib/i18n.js');
      // Judged by the suite's own reading of a row, over the whole library.
      const stretches = library.filter(
        (item) =>
          (item.sourceCategory === 'stretching' || /\bstretch(es|ing)?\b|-smr\b/i.test(item.name)) &&
          // A lunge, whatever the source files it as (exerciseClassification).
          item.name !== 'Crossover Reverse Lunge',
      );
      assert.ok(stretches.length >= 123, `${stretches.length} stretch rows`);
      assert.deepEqual(names(stretches.filter((item) => classification.exerciseTypeOf(item) !== 'stretch')), []);
      assert.deepEqual(
        names(library.filter((item) => classification.exerciseTypeOf(item) === 'stretch' && !stretches.includes(item))),
        [],
      );
      // No set list offers one unasked, under any other type chip.
      for (const type of browse.EXERCISE_TYPE_FILTERS.filter((value) => value !== 'stretch')) {
        const offered = browse.filterBrowsableExercises(library, { type }).filter((item) => browse.matchesExerciseTypeFilter(item, type));
        assert.deepEqual(names(offered.filter((item) => stretches.includes(item))), [], type);
      }
      // The chip lists every one of them, and nothing else.
      const chip = browse
        .filterBrowsableExercises(library, { type: 'stretch' })
        .filter((item) => browse.matchesExerciseTypeFilter(item, 'stretch'));
      assert.deepEqual(names(chip).sort(), names(stretches).sort());
      // With a muscle chip beside it, the stretches for that muscle.
      const hamstringStretches = chip.filter((item) => browse.matchesBodyPartFilter(item, 'hamstrings', 'stretch'));
      assert.ok(hamstringStretches.some((item) => item.name === 'Seated Floor Hamstring Stretch'), names(hamstringStretches).join(', '));
      assert.equal(browse.matchesBodyPartFilter(library.find((item) => item.name === 'Seated Floor Hamstring Stretch'), 'hamstrings'), false);
      // The library screen still lists them (its gate is the specialty one).
      assert.deepEqual(names(stretches.filter((item) => !browse.passesSpecialtyGate(item, { query: '', type: 'all' }))), []);
      // Labelled in both languages, chip and row.
      assert.equal(t('fi', 'facet.stretch'), 'Venytykset');
      assert.equal(t('en', 'facet.stretch'), 'Stretches');
      assert.equal(libraryLabel('stretch', 'fi'), 'Venytys');
      assert.equal(libraryLabel('stretch', 'en'), 'Stretch');
      assert.deepEqual(browse.EXERCISE_TYPE_FILTERS, ['all', 'compound', 'isolation', 'cardio', 'core', 'stretch', 'specialty']);
    },
  },
  {
    name: 'picker audit: "Koko keho" lists whole-body work, and the neck lifts are with the back',
    run() {
      const neck = library.filter((item) => (item.primaryMuscles ?? []).length > 0 && item.primaryMuscles.every((muscle) => muscle === 'neck'));
      assert.equal(neck.length, 8);
      assert.deepEqual(names(neck.filter((item) => item.bodyPart !== 'back')), []);
      const fullBody = unsearched.filter((item) => browse.matchesBodyPartFilter(item, 'full body'));
      assert.deepEqual(names(fullBody.filter((item) => (item.primaryMuscles ?? []).includes('neck'))), []);
      // The neck lifts are reachable under a chip.
      const plate = library.find((item) => item.name === 'Lying Face Down Plate Neck Resistance');
      assert.equal(browse.matchesBodyPartFilter(plate, 'back'), true);
    },
  },
  {
    name: 'picker audit: two library rows share a displayed name only when they are the same lift',
    run() {
      // Pairs the source carries twice under two spellings: one name is the
      // truth, and a one-row-per-name list showing one of them is right.
      const SAME_LIFT = [
        ['Decline Smith Press', 'Smith Machine Decline Press'],
        ['Double Kettlebell Jerk', 'Two-Arm Kettlebell Jerk'],
        ['Hammer Grip Incline DB Bench Press', 'Incline Dumbbell Bench With Palms Facing In'],
        ['Alternating Kettlebell Press', 'Kettlebell Seesaw Press'],
        // One lift by the app's identity (liftIdentity, the alias table and
        // tests/lib/liftHistoryIdentity.test.cjs), one name with it.
        ['Barbell Full Squat', 'Barbell Squat'],
        // The library's own row and the extra row the ready programmes'
        // name opens (catalog audit, 2026-10-06): one movement each.
        ['Side Bridge', 'Side Plank'],
        ['Body-Up', 'Plank-Up'],
      ].map((pair) => pair.join(' | '));
      for (const language of ['fi', 'en']) {
        const byLabel = new Map();
        for (const item of library) {
          const label = exerciseNameLabel(language, item.name).toLowerCase();
          byLabel.set(label, [...(byLabel.get(label) ?? []), item.name]);
        }
        const shared = [...byLabel.values()].filter((rows) => rows.length > 1).map((rows) => rows.sort().join(' | '));
        assert.deepEqual(shared.filter((pair) => !SAME_LIFT.includes(pair)), [], language);
      }
      // The clean and the power clean are two lifts (no lift group holds
      // both) and read as one, "Rinnalleveto".
      assert.notEqual(exerciseNameLabel('fi', 'Clean'), exerciseNameLabel('fi', 'Power Clean'));
    },
  },
];
