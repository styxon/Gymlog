const assert = require('node:assert/strict');

/**
 * The Finnish instruction layer, kept paired with the English library.
 *
 * The library is a generated English dataset — `npm run exercise:sync` rewrites
 * it — so the Finnish steps live in their own file keyed by the English name.
 * That arrangement has exactly one failure mode worth automating: the two
 * drifting apart. A renamed library entry orphans its translation silently, and
 * a translation that merges two steps into one loses a number the reader is
 * counting along with.
 */
const {
  getExerciseInstructions,
  EXERCISE_INSTRUCTIONS_FI_TABLE,
} = require('../../.test-dist/lib/exerciseInstructions.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { EQUIPMENT_FALLBACKS } = require('../../.test-dist/lib/equipmentExerciseFilter.js');

// The extras are library entries too — they exist because the generated file
// lacks them and `exercise:sync` would erase them. Reading only the generated
// half made a hand-added exercise look like a translation of nothing.
const FULL_LIBRARY = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY];
const BY_NAME = new Map(FULL_LIBRARY.map((item) => [item.name, item]));
const LIBRARY_NAMES = FULL_LIBRARY.map((item) => item.name);

/** Every library entry a ready program can actually put in front of a reader. */
function reachableLibraryEntries() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        names.add(exercise.exerciseName);
      }
    }
  }
  // A plan swaps onto these when the reader lacks the gear, so they are
  // prescribed as surely as the rows above — and five of them were English.
  for (const [, candidates] of EQUIPMENT_FALLBACKS) {
    for (const name of candidates) {
      names.add(name);
    }
  }

  const entries = new Map();
  for (const name of names) {
    const index = findGuidedLibraryIndex(name, LIBRARY_NAMES);
    if (index === null || index === undefined || index < 0) {
      continue;
    }
    // FULL_LIBRARY, because that is the array LIBRARY_NAMES was built from.
    // Indexing the generated half with an index that can land in the extras
    // returned `undefined` and threw — latent since the extras existed, and
    // only reached once a ready programme actually prescribed one of them.
    const item = FULL_LIBRARY[index];
    // A handful of library entries carry no instructions at all. There is
    // nothing to translate there, and inventing steps would be worse.
    if ((item.instructions ?? []).length > 0) {
      entries.set(item.name, item);
    }
  }
  return entries;
}

module.exports = [
  {
    name: 'instructions: every translated exercise still exists in the library',
    run() {
      const orphans = Object.keys(EXERCISE_INSTRUCTIONS_FI_TABLE).filter((name) => !BY_NAME.has(name));
      assert.deepEqual(
        orphans,
        [],
        `translations keyed to exercises the library no longer has: ${orphans.join(', ')}`,
      );
    },
  },
  {
    name: 'instructions: a Finnish entry has exactly as many steps as the English one',
    run() {
      const mismatched = [];
      for (const [name, steps] of Object.entries(EXERCISE_INSTRUCTIONS_FI_TABLE)) {
        const english = BY_NAME.get(name)?.instructions ?? [];
        if (english.length !== steps.length) {
          mismatched.push(`${name} (${english.length} → ${steps.length})`);
        }
      }
      assert.deepEqual(mismatched, [], `step counts drifted: ${mismatched.join(', ')}`);
    },
  },
  {
    name: 'instructions: no step is blank, and none is the English left in place',
    run() {
      for (const [name, steps] of Object.entries(EXERCISE_INSTRUCTIONS_FI_TABLE)) {
        const english = BY_NAME.get(name)?.instructions ?? [];
        steps.forEach((step, index) => {
          assert.ok(step.trim().length > 0, `${name} step ${index + 1} is empty`);
          assert.notEqual(
            step.trim(),
            (english[index] ?? '').trim(),
            `${name} step ${index + 1} is still the English sentence`,
          );
        });
      }
    },
  },
  {
    name: 'instructions: every exercise a program can prescribe is translated',
    run() {
      // The coverage the file claims. Anything else in the 873-entry library
      // falls back to English on purpose — this is the set a reader meets
      // inside a program rather than while browsing.
      const missing = [...reachableLibraryEntries().keys()].filter(
        (name) => !EXERCISE_INSTRUCTIONS_FI_TABLE[name],
      );
      assert.deepEqual(
        missing,
        [],
        `exercises a program prescribes with no Finnish steps: ${missing.join(', ')}`,
      );
    },
  },
  {
    name: 'instructions: a missing translation falls back to English, never to nothing',
    run() {
      // The rule the name layer already follows: an English instruction beats a
      // missing one.
      const untranslated = GENERATED_EXERCISE_LIBRARY.find(
        (item) => (item.instructions ?? []).length > 0 && !EXERCISE_INSTRUCTIONS_FI_TABLE[item.name],
      );
      assert.ok(untranslated, 'the library is fully translated — this case can go');
      assert.deepEqual(
        getExerciseInstructions(untranslated.name, untranslated.instructions, 'fi'),
        untranslated.instructions,
      );

      // English asks for English even where a translation exists.
      const translated = BY_NAME.get(Object.keys(EXERCISE_INSTRUCTIONS_FI_TABLE)[0]);
      assert.deepEqual(
        getExerciseInstructions(translated.name, translated.instructions, 'en'),
        translated.instructions,
      );
      assert.deepEqual(
        getExerciseInstructions(translated.name, translated.instructions, 'fi'),
        EXERCISE_INSTRUCTIONS_FI_TABLE[translated.name],
      );
    },
  },
  {
    name: 'instructions: nothing to draw returns nothing, in either language',
    run() {
      for (const language of ['en', 'fi']) {
        assert.deepEqual(getExerciseInstructions('Bench Press', [], language), []);
        assert.deepEqual(getExerciseInstructions('Bench Press', null, language), []);
        assert.deepEqual(getExerciseInstructions(null, null, language), []);
        // A blank step in the source is not a step.
        assert.deepEqual(getExerciseInstructions('Nothing At All', ['', 'Do it.'], language), ['Do it.']);
      }
    },
  },
];
