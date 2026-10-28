const assert = require('node:assert/strict');

const {
  exerciseNameLabel,
  PLAIN_EXERCISE_NAMES,
  TRANSLATED_EXERCISE_NAMES,
} = require('../../src/lib/exerciseNameLabel');
const { createSeedExerciseLibrary } = require('../../src/data/seed');
const { findGuidedLibraryIndex } = require('../../src/lib/guidedPlayer');

/**
 * English display names: the same lift, said the way a gym says it.
 *
 * The library ships from a public database that is pedantic where a gym is
 * not — "Barbell Bench Press - Medium Grip" is the bench press. Only the label
 * moves; the English name stays the id that everything matches and swaps on.
 *
 * The one real danger is a rename that lands on a DIFFERENT lift, which is
 * why this file exists and why the table was hand-written instead of inverted
 * out of GUIDED_LIBRARY_ALIASES: that table deliberately maps a catalog name
 * onto the nearest library row it can train with, so inverting it would have
 * relabelled Hanging Leg Raise as "hanging knee raise".
 */

const library = createSeedExerciseLibrary();
const names = library.map((item) => item.name);
const byName = new Map(library.map((item) => [item.name, item]));

module.exports = [
  {
    name: 'plain names: every key is a lift the library actually has',
    run() {
      const invented = Object.keys(PLAIN_EXERCISE_NAMES).filter((name) => !byName.has(name));
      assert.deepEqual(invented, [], `renamed lifts the library does not have: ${invented.join(', ')}`);
      // No magic floor: what matters is that it is not empty and that the
      // last case below still finds every target lift readable.
      assert.ok(Object.keys(PLAIN_EXERCISE_NAMES).length > 0, 'the table is empty');
    },
  },
  {
    /**
     * The rule the table exists to keep: a display name is the same lift said
     * plainly, never a different lift's name. "Bench Press" must resolve back
     * to the row it labels; if it resolves somewhere else, the reader is being
     * shown one exercise under another's name.
     */
    name: 'plain names: no label points at a different lift',
    run() {
      const wrong = [];
      for (const [stored, plain] of Object.entries(PLAIN_EXERCISE_NAMES)) {
        const index = findGuidedLibraryIndex(plain, names);
        if (index === null) {
          // Nothing else claims the plain name — safe, it is a label with no
          // competing row.
          continue;
        }
        if (names[index] !== stored) {
          wrong.push(`${stored} → "${plain}", which resolves to ${names[index]}`);
        }
      }
      assert.deepEqual(wrong, [], `labels that name another lift: ${wrong.join('; ')}`);
    },
  },
  {
    name: 'plain names: no two lifts end up sharing a label',
    run() {
      const byLabel = new Map();
      for (const [stored, plain] of Object.entries(PLAIN_EXERCISE_NAMES)) {
        // Back Squat is the deliberate exception: "Barbell Squat" and "Barbell
        // Full Squat" are the same lift under two database rows, and the
        // library shows both.
        if (plain === 'Back Squat') {
          continue;
        }
        const seen = byLabel.get(plain);
        assert.equal(seen, undefined, `${stored} and ${seen} would both read "${plain}"`);
        byLabel.set(plain, stored);
      }
    },
  },
  {
    name: 'plain names: the label moves, the id does not',
    run() {
      // English goes through the table; Finnish keeps its own.
      assert.equal(exerciseNameLabel('en', 'Barbell Bench Press - Medium Grip'), 'Bench Press');
      assert.equal(exerciseNameLabel('fi', 'Barbell Bench Press - Medium Grip'), 'Penkkipunnerrus');
      // Anything without an entry passes through rather than being guessed at.
      assert.equal(exerciseNameLabel('en', 'Zottman Curl'), 'Zottman Curl');
      assert.equal(exerciseNameLabel('en', '  Barbell Deadlift  '), 'Deadlift', 'keys are trimmed');
      assert.equal(exerciseNameLabel('en', 'No Such Lift'), 'No Such Lift');
    },
  },
  {
    /**
     * The ten lifts a target can be set on are the ones a reader meets as a
     * headline, so none of them may still read as a database row.
     */
    name: 'plain names: no target lift reads like a database entry',
    run() {
      const { STRENGTH_GOAL_PRESETS } = require('../../src/lib/strengthGoalPresets');
      const clumsy = [];
      for (const preset of STRENGTH_GOAL_PRESETS) {
        const shown = exerciseNameLabel('en', preset.exerciseName);
        // The database's qualifier suffix is the thing that reads as a record
        // rather than a lift: "Barbell Bench Press - Medium Grip". A plain
        // compound like "Barbell Squat" or "Upright Barbell Row" is what a gym
        // says, and "Upright Row" on its own belongs to the banded version.
        if (shown.includes(' - ')) {
          clumsy.push(`${preset.exerciseName} still reads "${shown}"`);
        }
        // And Finnish says something of its own for every one of them.
        assert.notEqual(
          TRANSLATED_EXERCISE_NAMES[preset.exerciseName],
          undefined,
          `${preset.exerciseName} has no Finnish name`,
        );
      }
      assert.deepEqual(clumsy, [], clumsy.join('; '));
    },
  },
  {
    /**
     * The ten target lifts are checked by name above. This checks the other
     * 265: every lift a ready week actually prescribes.
     *
     * The table cannot grow by itself, and the suite above only validates the
     * entries that already exist — so a new catalog lift carrying a database
     * suffix would ship green, which is the exact defect this file was written
     * to end. Zero today, pinned at zero.
     */
    name: 'plain names: no lift a programme prescribes reads like a database entry',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
      const prescribed = new Set();
      JSON.stringify(WORKOUT_TEMPLATES_V1).replace(
        /"exerciseName":"([^"]+)"/g,
        (_, name) => {
          prescribed.add(name);
          return '';
        },
      );
      assert.ok(prescribed.size > 200, `only ${prescribed.size} catalog names found — the scrape broke`);
      const clumsy = [];
      for (const name of prescribed) {
        const shown = exerciseNameLabel('en', name);
        if (shown.includes(' - ')) {
          clumsy.push(`${name} reads "${shown}"`);
        }
      }
      assert.deepEqual(clumsy, [], `catalog lifts still reading as database rows: ${clumsy.join('; ')}`);
    },
  },
];
