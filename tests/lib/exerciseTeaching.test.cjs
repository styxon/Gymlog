const assert = require('node:assert/strict');

const {
  getExerciseTeaching,
  shouldShowTeachingCaution,
  EXERCISE_TEACHING_TABLES,
} = require('../../src/lib/exerciseTeaching');
const { createSeedExerciseLibrary } = require('../../src/data/seed');

/**
 * The teaching layer, kept honest against the library it points at.
 *
 * The failure this suite exists for has happened in this repo before: the
 * programme composer wrote exercise names by hand under a comment claiming
 * they were "grounded in catalog exercise names", and 39% of composed weeks
 * contained lifts that were not lifts. Teaching content has the same shape —
 * hand-written strings naming other exercises — so it gets the same sweep.
 *
 * My first pass produced two of exactly those errors: a "harder" swap on the
 * bench press that pointed at the bench press, and a deadlift swap naming
 * "Barbell Deficit Deadlift", which the library calls "Deficit Deadlift".
 */

const library = createSeedExerciseLibrary();

/**
 * What the screen can actually open.
 *
 * This used to subtract the legacy `lib_*` rows, because the browser filtered
 * them and content keyed to one could never render. Two different "libraries"
 * is exactly what let the key check below pass against the wrong set, and the
 * rows themselves went on 2026-09-01 — so there is one library again and this
 * subtracts nothing. Kept named for what it means rather than inlined.
 */
const reachableNames = new Set(library.map((item) => item.name));

function everyEntry() {
  return Object.entries(EXERCISE_TEACHING_TABLES).flatMap(([language, table]) =>
    Object.entries(table).map(([name, teaching]) => ({ language, name, teaching })),
  );
}

module.exports = [
  {
    name: 'teaching: every exercise written about is one a reader can open',
    run() {
      const orphans = everyEntry()
        .filter(({ name }) => !reachableNames.has(name))
        .map(({ language, name }) => `${language}:${name}`);
      assert.deepEqual(
        orphans,
        [],
        `teaching keyed to lifts no reader can open: ${orphans.join(', ')}`,
      );
    },
  },
  {
    name: 'teaching: every swap names a real lift, and never the lift itself',
    run() {
      const invented = [];
      const selfReferences = [];

      for (const { language, name, teaching } of everyEntry()) {
        for (const swap of teaching.swaps) {
          if (!reachableNames.has(swap.exerciseName)) {
            invented.push(`${language}:${name} → ${swap.exerciseName}`);
          }
          if (swap.exerciseName === name) {
            selfReferences.push(`${language}:${name}`);
          }
        }
      }

      assert.deepEqual(invented, [], `swap targets that are not library lifts: ${invented.join(', ')}`);
      // A swap to the same lift is a row that promises an alternative and
      // opens the page you are already on.
      assert.deepEqual(selfReferences, [], `swaps pointing at themselves: ${selfReferences.join(', ')}`);
    },
  },
  {
    name: 'teaching: each entry offers one easier and one harder',
    run() {
      const wrong = everyEntry()
        .filter(({ teaching }) => {
          const easier = teaching.swaps.filter((s) => s.direction === 'easier').length;
          const harder = teaching.swaps.filter((s) => s.direction === 'harder').length;
          return easier !== 1 || harder !== 1;
        })
        .map(({ language, name }) => `${language}:${name}`);
      assert.deepEqual(wrong, []);
    },
  },
  {
    /**
     * Three cues, not five steps — five is the instruction list again, and the
     * instruction list is already on the screen. Four check statements,
     * because the design's counter says "4 left".
     */
    name: 'teaching: three cues and four check statements, everywhere',
    run() {
      const offCount = everyEntry()
        .filter(({ teaching }) => teaching.cues.length !== 3 || teaching.check.length !== 4)
        .map(({ language, name, teaching }) => `${language}:${name} (${teaching.cues.length}/${teaching.check.length})`);
      assert.deepEqual(offCount, []);
    },
  },
  {
    /**
     * Both languages say the same things about the same lifts. A lift written
     * in Finnish only would fall back to English and show nothing; a lift
     * written in English only is fine (that is the documented fallback), but
     * the tables drifting apart silently is not.
     */
    name: 'teaching: the Finnish table covers the same lifts as the English one',
    run() {
      const en = Object.keys(EXERCISE_TEACHING_TABLES.en).sort();
      const fi = Object.keys(EXERCISE_TEACHING_TABLES.fi).sort();
      assert.deepEqual(fi, en);

      // And the shapes match, or one language quietly loses a section.
      for (const name of en) {
        const a = EXERCISE_TEACHING_TABLES.en[name];
        const b = EXERCISE_TEACHING_TABLES.fi[name];
        assert.equal(b.cues.length, a.cues.length, `${name}: cue count`);
        assert.equal(b.mistakes.length, a.mistakes.length, `${name}: mistake count`);
        assert.equal(b.tempo.length, a.tempo.length, `${name}: tempo count`);
        assert.equal(b.swaps.length, a.swaps.length, `${name}: swap count`);
        assert.equal(b.check.length, a.check.length, `${name}: check count`);
        assert.equal(Boolean(b.caution), Boolean(a.caution), `${name}: caution presence`);
        if (a.caution && b.caution) {
          assert.equal(b.caution.area, a.caution.area, `${name}: caution area`);
        }
        // The swaps have to point at the same lifts, or the two languages
        // recommend different exercises.
        assert.deepEqual(
          b.swaps.map((s) => `${s.direction}:${s.exerciseName}`),
          a.swaps.map((s) => `${s.direction}:${s.exerciseName}`),
          `${name}: swap targets`,
        );
      }
    },
  },
  {
    name: 'teaching: Finnish wins, English is the fallback, nothing written is null',
    run() {
      const fi = getExerciseTeaching('Barbell Squat', 'fi');
      const en = getExerciseTeaching('Barbell Squat', 'en');
      assert.ok(fi && en);
      assert.notEqual(fi.feel, en.feel);
      assert.match(fi.feel, /Rasitusta, ei kipua/);

      // A lift with nothing written opens on its steps alone.
      assert.equal(getExerciseTeaching('Alternate Hammer Curl', 'fi'), null);
      assert.equal(getExerciseTeaching('', 'fi'), null);
      assert.equal(getExerciseTeaching(null, 'fi'), null);

      // Whitespace is not a different exercise.
      assert.ok(getExerciseTeaching('  Barbell Squat  ', 'en'));
    },
  },
  {
    /**
     * A caution is for the reader who flagged that area, and only then. An
     * 'info' note in setup is not a reason to put a warning on a lift.
     */
    name: 'teaching: the caution shows only to the reader who flagged the area',
    run() {
      const squat = getExerciseTeaching('Barbell Squat', 'en');
      const back = (level) => [{ area: 'lower_back', level }];

      assert.equal(shouldShowTeachingCaution(squat.caution, back('careful')), true);
      assert.equal(shouldShowTeachingCaution(squat.caution, back('avoid')), true);
      assert.equal(shouldShowTeachingCaution(squat.caution, back('info')), false);
      assert.equal(shouldShowTeachingCaution(squat.caution, [{ area: 'knees', level: 'careful' }]), false);
      assert.equal(shouldShowTeachingCaution(squat.caution, []), false);
      assert.equal(shouldShowTeachingCaution(squat.caution, null), false);
      assert.equal(shouldShowTeachingCaution(undefined, back('careful')), false);
    },
  },
];
