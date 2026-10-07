const assert = require('node:assert/strict');

const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { getExerciseInstructions } = require('../../.test-dist/lib/exerciseInstructions.js');
const { getDrillLibraryName } = require('../../.test-dist/lib/drillMedia.js');

/**
 * What a ready programme prescribes, the reader can read about.
 *
 * Three real gaps on 2026-08-31, none visible from any single file:
 *
 *   · "Kettlebell Swing" reached "One-Arm Kettlebell Swings" — a different
 *     movement, shipped with an EMPTY step list. A blank panel, not English.
 *   · "Romanian Deadlift" reached `lib_rdl`, a legacy row with no steps, which
 *     sat in front of the generated entry that has five AND a Finnish
 *     translation already written. Nothing shadowed something.
 *   · "Burpee" reached nothing at all.
 *
 * How this is measured matters as much as what it found. Counting keys with a
 * regex over exerciseInstructions.ts produced two FALSE findings (the file has
 * unquoted keys), and regexing workoutCatalog.ts reported 63 prescribed lifts
 * when there are 274 (a second catalog file is merged in). So every number
 * here comes from the compiled modules, through the same calls the set screen
 * makes — and this suite exists because a hand-rolled measurement was wrong
 * three times in one evening.
 */

const library = createSeedExerciseLibrary();
const libraryNames = library.map((item) => item.name);

/**
 * Prescribed names with no library entry. None since 2026-10-06.
 *
 * Until then it held 79: mobility holds, breathing drills, sprint blocks and
 * a handful of real lifts with no upstream row. Each now has a row of its own
 * in `extraExerciseLibrary.ts`, or an alias to the row that is the same
 * movement ("Sprint 40m" -> "Sprint").
 *
 * Kept as a list, not deleted: the point is that a NEW unresolved name fails
 * this suite, and growing it is a regression made on purpose.
 */
const UNRESOLVED_TODAY = [];

function prescribedExerciseNames() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        names.add(exercise.exerciseName);
      }
    }
  }
  return [...names].sort();
}

/** The set screen's own lookup, drill alias included. */
function resolve(name) {
  const index = findGuidedLibraryIndex(getDrillLibraryName(name) ?? name, libraryNames);
  return index === null ? null : library[index];
}

module.exports = [
  {
    name: 'prescribed lifts: no new exercise goes missing from the library',
    run() {
      const pinned = new Set(UNRESOLVED_TODAY);
      const unresolved = prescribedExerciseNames().filter((name) => resolve(name) === null);

      const appeared = unresolved.filter((name) => !pinned.has(name));
      assert.deepEqual(appeared, [], `prescribed and not in the library: ${appeared.join(', ')}`);

      const fixed = UNRESOLVED_TODAY.filter((name) => !unresolved.includes(name));
      assert.deepEqual(
        fixed,
        [],
        `these resolve now — take them out of UNRESOLVED_TODAY: ${fixed.join(', ')}`,
      );
    },
  },
  {
    name: 'prescribed lifts: none opens a blank panel, none falls back to English',
    run() {
      const blank = [];
      const english = [];

      for (const name of prescribedExerciseNames()) {
        const item = resolve(name);
        if (!item) {
          continue; // owned by the test above
        }
        const fi = getExerciseInstructions(item.name, item.instructions, 'fi');
        const en = getExerciseInstructions(item.name, item.instructions, 'en');

        // Blank is worse than English: it reads as the app having nothing to
        // say about a lift it just told you to do.
        if (fi.length === 0 && en.length === 0) {
          blank.push(`${name} → ${item.name}`);
        } else if (fi.join('|') === en.join('|')) {
          english.push(`${name} → ${item.name}`);
        }
      }

      // Upstream ships "Push Press" with an empty step list, and the existing
      // pairing rule (a Finnish entry has as many steps as the English one)
      // means a translation cannot be written for it alone — there is nothing
      // to pair with. Giving it English steps needs an override layer this app
      // does not have yet, so it is named here rather than silently tolerated.
      const KNOWN_BLANK = ['Push Press → Push Press'];
      const unexpectedBlank = blank.filter((entry) => !KNOWN_BLANK.includes(entry));
      assert.deepEqual(unexpectedBlank, [], `no steps in either language: ${unexpectedBlank.join(', ')}`);
      assert.deepEqual(english, [], `falls back to English: ${english.join(', ')}`);
    },
  },
  {
    /**
     * A translation that merges two steps into one loses a number the reader
     * counts along with — checked across the whole shipped library, not one file.
     */
    name: 'prescribed lifts: a Finnish entry has as many steps as the English one',
    run() {
      const mismatched = library
        .filter((item) => {
          const fi = getExerciseInstructions(item.name, item.instructions, 'fi');
          const en = getExerciseInstructions(item.name, item.instructions, 'en');
          return fi.length > 0 && en.length > 0 && fi.length !== en.length;
        })
        .map((item) => item.name);

      assert.deepEqual(mismatched, []);
    },
  },
  {
    /**
     * The legacy seed rows carry Finnish names and no instructions, which is
     * fine until one is named in English: the matcher is case-insensitive and
     * the legacy list is merged FIRST, so an empty row wins over a full one.
     * `lib_rdl` was exactly that, for every programme prescribing an RDL.
     */
    name: 'prescribed lifts: no empty row shadows an entry that has steps',
    run() {
      const shadowing = [];
      for (const item of library) {
        if ((item.instructions ?? []).length > 0) {
          continue;
        }
        const others = library.filter((other) => other.id !== item.id);
        const index = findGuidedLibraryIndex(item.name, others.map((other) => other.name));
        if (index === null) {
          continue;
        }
        const alternative = others[index];
        if ((alternative.instructions ?? []).length > 0) {
          shadowing.push(`${item.name} hides ${alternative.name}`);
        }
      }

      // These two sit in front of genuinely DIFFERENT movements, so they are
      // upstream gaps rather than shadows. Named, so a new one fails.
      const known = ['Iron Cross hides Cable Iron Cross', 'Push Press hides Double Kettlebell Push Press'];
      const unexpected = shadowing.filter((entry) => !known.includes(entry));
      assert.deepEqual(unexpected, [], unexpected.join('; '));
    },
  },
];
