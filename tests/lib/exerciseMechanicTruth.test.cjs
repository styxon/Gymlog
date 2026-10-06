const assert = require('node:assert/strict');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { getExerciseTemplateDefaults, getSuggestedExerciseLibraryItems } = require('../../.test-dist/lib/exerciseSuggestions.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
const { withLibraryCorrections, exerciseMechanic } = require('../../.test-dist/lib/exerciseClassification.js');
const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

/**
 * One truth for compound / isolation (#bugs 2026-10-06, "eristävät liikkeet
 * moniniveliksi"). The generator stored 214 isolation lifts — the leg
 * extension, every curl, raise and fly — as `category: 'compound'`. The chips
 * read the source mechanic since the filter fix; custom programmes still read
 * the category for their rep defaults, role and progression priority. The
 * category itself is corrected where the library is seeded, so every reader
 * agrees.
 */
const library = createSeedExerciseLibrary();
const byName = (name) => {
  const item = library.find((entry) => entry.name === name);
  assert.ok(item, `${name} missing from the library`);
  return item;
};

function runtimeRow(item, stored) {
  const exercise = {
    id: 'e',
    workoutTemplateId: 't',
    workoutTemplateSessionId: 's',
    name: item.name,
    orderIndex: 0,
    libraryItemId: item.id,
    trackingMode: null,
    ...stored,
  };
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(
    { id: 't', name: 'T' },
    [{ id: 's', name: 'S', orderIndex: 0, exercises: [exercise] }],
    library,
    120,
  );
  return runtime.sessions[0].exercises[0];
}

module.exports = [
  {
    name: 'mechanic truth: the seeded category is the source mechanic for every compound / isolation row',
    run() {
      const disagree = library.filter((item) => {
        const source = item.sourceMechanic?.trim().toLowerCase();
        return (
          (item.category === 'compound' || item.category === 'isolation') &&
          (source === 'compound' || source === 'isolation') &&
          item.category !== source
        );
      });
      assert.deepEqual(disagree.map((item) => item.name), []);
      // The count the generator gets wrong, so a regeneration that fixes it at
      // the source is noticed rather than assumed.
      const generatedWrong = GENERATED_EXERCISE_LIBRARY.filter(
        (item) => item.category === 'compound' && item.sourceMechanic === 'isolation',
      );
      assert.equal(generatedWrong.length, 214);
      for (const name of ['Leg Extensions', 'Dumbbell Bicep Curl', 'Side Lateral Raise', 'Dumbbell Flyes', 'Standing Calf Raises']) {
        assert.equal(byName(name).category, 'isolation', name);
        assert.equal(exerciseMechanic(byName(name)), 'isolation', name);
      }
      for (const name of ['Barbell Squat', 'Barbell Deadlift', 'Pullups']) {
        assert.equal(byName(name).category, 'compound', name);
      }
      // Core and cardio are not the mechanic's to overrule.
      const coreWithMechanic = GENERATED_EXERCISE_LIBRARY.filter((item) => item.category === 'core' && item.sourceMechanic);
      assert.ok(coreWithMechanic.length > 50);
      const seeded = new Map(library.map((item) => [item.id, item]));
      assert.deepEqual(
        coreWithMechanic.filter((item) => seeded.get(item.id).category !== 'core').map((item) => item.name),
        [],
      );
      // Idempotent: a second pass changes nothing.
      assert.deepEqual(withLibraryCorrections(library), library);
    },
  },
  {
    name: 'mechanic truth: a leg extension added to your own programme starts on isolation defaults',
    run() {
      const legExtension = getExerciseTemplateDefaults(byName('Leg Extensions'), 120);
      assert.deepEqual(
        { sets: legExtension.targetSets, repMin: legExtension.repMin, repMax: legExtension.repMax, rest: legExtension.restSeconds, tracked: legExtension.trackedDefault },
        { sets: 3, repMin: 10, repMax: 12, rest: 75, tracked: false },
      );
      // A squat keeps the compound defaults.
      const squat = getExerciseTemplateDefaults(byName('Barbell Squat'), 120);
      assert.deepEqual([squat.repMin, squat.repMax, squat.restSeconds, squat.trackedDefault], [6, 8, 120, true]);
    },
  },
  {
    name: 'mechanic truth: a custom programme reads role and priority from the corrected mechanic, and stored values decide the rest',
    run() {
      const legExtension = byName('Leg Extensions');
      const stored = { targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120 };
      // Written by the template editor before the fix: the old defaults stored
      // trackedDefault true, which still holds it in the progression.
      const before = runtimeRow(legExtension, { ...stored, trackedDefault: true });
      assert.equal(before.role, 'secondary');
      assert.equal(before.progressionPriority, 'medium');
      // The stored prescription is the programme's own and is never rewritten.
      assert.deepEqual([before.sets, before.repsMin, before.repsMax, before.restSecondsMin], [3, 6, 8, 120]);
      // A copy of a ready programme or a coach brief stores trackedDefault
      // false; the leg extension there is an accessory, as in the catalogue.
      const copied = runtimeRow(legExtension, { ...stored, trackedDefault: false });
      assert.equal(copied.role, 'accessory');
      assert.equal(copied.progressionPriority, 'low');
      // A compound lift is unchanged either way.
      const squat = runtimeRow(byName('Barbell Squat'), { ...stored, trackedDefault: false });
      assert.equal(squat.role, 'secondary');
      assert.equal(squat.progressionPriority, 'medium');
    },
  },
  {
    name: 'mechanic truth: a copied ready programme keeps the catalogue\'s tracking, so its primary curl stays in the progression',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const source = fs.readFileSync(path.join(__dirname, '../../src/app/useProgramExerciseEdit.tsx'), 'utf8');
      // The copy writer reads the catalogue row's priority, not a flat false.
      assert.match(source, /trackedDefault: exercise\.progressionPriority !== 'low',/);
      assert.doesNotMatch(source, /trackedDefault: false,\s*\n\s*orderIndex: exerciseIndex/);
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const primaryCurls = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const item = library.find((entry) => entry.name === exercise.exerciseName);
            if (item && item.category === 'isolation' && exercise.progressionPriority !== 'low') {
              primaryCurls.push({ item, exercise });
            }
          }
        }
      }
      assert.ok(primaryCurls.length > 0, 'the catalogue tracks some isolation lift by its library name');
      for (const { item, exercise } of primaryCurls) {
        const copied = runtimeRow(item, {
          targetSets: exercise.sets,
          repMin: exercise.repsMin,
          repMax: exercise.repsMax,
          restSeconds: exercise.restSecondsMin,
          trackedDefault: exercise.progressionPriority !== 'low',
        });
        assert.notEqual(copied.progressionPriority, 'low', `${exercise.id} drops out of the trend when copied`);
      }
    },
  },
  {
    name: 'mechanic truth: suggestions score the corrected mechanic (a leg day is offered compound lifts before curls)',
    run() {
      // Read off the source mechanic, which the stored category used to
      // contradict: the leg extension and the leg curls scored as compound.
      const suggested = getSuggestedExerciseLibraryItems({ exerciseLibrary: library, currentItemIds: ['free_leg_press'], limit: 5 });
      assert.deepEqual(suggested.filter((item) => exerciseMechanic(item) !== 'compound').map((item) => item.name), []);
    },
  },
  {
    name: 'mechanic truth: an old stored library row cannot put the wrong category back on load',
    run() {
      const fake = createFakeAsyncStorage();
      const { normalizeDatabase } = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const legExtension = GENERATED_EXERCISE_LIBRARY.find((item) => item.name === 'Leg Extensions');
      // A blob from before the library was stripped on save: whole rows, and
      // an old row with no source fields at all.
      const loaded = normalizeDatabase({
        exerciseLibrary: [
          { ...legExtension, category: 'compound' },
          { id: 'free_cable_hip_adduction', name: 'Cable Hip Adduction', category: 'compound', bodyPart: 'legs', equipment: 'cable', primaryMuscles: ['quadriceps'] },
        ],
        exerciseTemplates: [
          { id: 'e', workoutTemplateId: 't', workoutTemplateSessionId: 's', name: 'Leg Extensions', targetSets: 3, repMin: 6, repMax: 8, restSeconds: 120, trackedDefault: true, orderIndex: 0, libraryItemId: legExtension.id },
        ],
      });
      const row = loaded.exerciseLibrary.find((item) => item.id === legExtension.id);
      assert.equal(row.category, 'isolation');
      const adduction = loaded.exerciseLibrary.find((item) => item.name === 'Cable Hip Adduction');
      assert.deepEqual(adduction.primaryMuscles, ['adductors']);
      assert.equal(adduction.category, 'isolation');
      // The stored programme row loads with what it stored: the fix reads the
      // library differently, it does not rewrite a saved prescription.
      const stored = loaded.exerciseTemplates.find((entry) => entry.id === 'e');
      assert.ok(stored, 'the stored exercise loads');
      assert.equal(stored.targetSets, 3);
      assert.equal(stored.restSeconds, 120);
      assert.equal(stored.trackedDefault, true);
      assert.equal(stored.libraryItemId, legExtension.id);
    },
  },
];
