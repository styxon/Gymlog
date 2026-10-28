const assert = require('node:assert/strict');

const {
  exerciseNameLabel,
  TRANSLATED_EXERCISE_NAMES,
  PLAIN_EXERCISE_NAMES,
} = require('../../src/lib/exerciseNameLabel');
const {
  WORKOUT_TEMPLATES_V1,
  WORKOUT_SUBSTITUTION_GROUPS,
} = require('../../src/features/workout/workoutCatalog');
const {
  FOCUS_ACCESSORY_POOL,
  SUPPLEMENTAL_DAY_POOL,
} = require('../../src/lib/catalogExercisePools');
const {
  GENERATED_EXERCISE_LIBRARY,
} = require('../../src/data/generatedExerciseLibrary');

function collectStrings(value, into) {
  if (typeof value === 'string') {
    into.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, into));
  }
}

/**
 * Every exercise name a reader can actually meet.
 *
 * This used to walk WORKOUT_TEMPLATES_V1 alone, which is what the ready
 * programs prescribe — about a quarter of the reachable names. The other
 * three quarters arrive through the swap sheet (the substitution groups)
 * and through the plan composer (the focus and supplemental pools), and
 * they were all still in English.
 */
function reachableExerciseNames() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions ?? []) {
      for (const exercise of session.exercises ?? []) {
        if (exercise.name) {
          names.add(exercise.name);
        }
      }
    }
  }
  for (const group of WORKOUT_SUBSTITUTION_GROUPS) {
    for (const name of group.allowedExerciseNames ?? []) {
      names.add(name);
    }
  }
  collectStrings(FOCUS_ACCESSORY_POOL, names);
  collectStrings(SUPPLEMENTAL_DAY_POOL, names);
  return [...names];
}

module.exports = [
  {
    name: 'every exercise a reader can reach has a Finnish name',
    run() {
      const reachable = reachableExerciseNames();
      // The swap sheet alone offers four times what the catalog prescribes;
      // if this number collapses, the walk above stopped finding a source.
      assert.ok(reachable.length > 300, `only ${reachable.length} names reachable`);
      const missing = reachable.filter((name) => !TRANSLATED_EXERCISE_NAMES[name]);
      assert.deepEqual(
        missing,
        [],
        `these exercises would still read in English: ${missing.join(', ')}`,
      );
    },
  },
  {
    name: 'a lift spelled two ways is translated under both spellings',
    run() {
      // The catalog, the swap pools and the generated library do not agree on
      // singular vs plural, and the lookup is exact — so "Dumbbell Flyes"
      // reached the screen in English while "Dumbbell Fly" was translated.
      // Same lift, same Finnish, both keys.
      for (const [a, b] of [
        ['Dumbbell Fly', 'Dumbbell Flyes'],
        ['Bench Dip', 'Bench Dips'],
        ['Mountain Climbers', 'Mountain Climber'],
      ]) {
        assert.equal(exerciseNameLabel('fi', a), exerciseNameLabel('fi', b));
        assert.notEqual(exerciseNameLabel('fi', b), b, `${b} still reads in English`);
      }
    },
  },
  {
    name: 'English is returned untouched and unknown names pass through',
    run() {
      assert.equal(exerciseNameLabel('en', 'Back Squat'), 'Back Squat');
      assert.equal(exerciseNameLabel('fi', 'Back Squat'), 'Takakyykky');
      // A name with no entry keeps its own rather than guessing. Every name
      // IN the library has one now, so this has to be something invented.
      assert.equal(exerciseNameLabel('fi', 'Quantum Deadlift'), 'Quantum Deadlift');
      assert.equal(exerciseNameLabel('fi', '  Plank  '), 'Lankku');
    },
  },
  {
    // The browsable library is 873 exercises. The reachable-names walk above
    // covers what the catalogs and the composer prescribe; this covers what a
    // user can simply scroll past in Liikekirjasto, which was 771 of them.
    name: 'every exercise in the browsable library has a Finnish name',
    run() {
      const missing = GENERATED_EXERCISE_LIBRARY
        .map((item) => item.name)
        .filter((name) => !TRANSLATED_EXERCISE_NAMES[name.trim()]);

      assert.deepEqual(
        missing,
        [],
        `${missing.length} library exercises would read in English: ${missing.slice(0, 8).join(', ')}`,
      );
    },
  },
  {
    name: 'no Finnish name is left as its English source',
    run() {
      // Case-insensitive on purpose: "Muscle Up" → "Muscle up" is a copy, not
      // a translation, and a case-sensitive check waves it through. Tightening
      // it surfaced three entries that had been sitting here since before the
      // library sweep.
      //
      // Which is why the loan words have to be listed: for these, the
      // lower-cased form IS the Finnish one. Finnish gyms say "dead bug" and
      // "muscle up"; inventing a Finnish word for them would be worse than
      // the English, which is the same rule the module doc states.
      const FINNISH_LOAN_WORDS = [
        'Burpee',
        'Hack Squat',
        'Pec Deck',
        'Dead Bug',
        'Bird Dog',
        'Dragon Flag',
        'Muscle Up',
        'London Bridges',
        // Was "Voimatempaus", which is Power Snatch — a different lift, and
        // since the CSV import reads the app's own labels back (2026-09-29) a
        // written "Voimatempaus" would have imported as this one.
        'Muscle Snatch',
      ];
      const unchanged = Object.entries(TRANSLATED_EXERCISE_NAMES)
        .filter(([english, finnish]) => english.toLowerCase() === finnish.toLowerCase())
        .filter(([english]) => !FINNISH_LOAN_WORDS.includes(english))
        .map(([english]) => english);

      assert.deepEqual(unchanged, [], `left in English: ${unchanged.join(', ')}`);
    },
  },
  {
    // #231's label matcher (matchAppLabel in csvProgramImport.ts) resolves a
    // written-out Finnish name straight to the FIRST stored name that shares
    // its label. Two entries sharing a label is only safe when they are the
    // same lift — otherwise the matcher silently imports the wrong one, the
    // way 'Lower Back-SMR' (a foam-roller drill) used to steal every import
    // of 'Lower Back Curl' (a floor back extension), and 'Chain Press' (a
    // cable exercise) used to steal every import of 'Bench Press with
    // Chains' (a barbell one) (recheck round 2026-09-29).
    //
    // "Same lift" here means the library agrees: same bodyPart, category and
    // primary muscles. A pair that shares a label without sharing those is a
    // bug to fix (split the label), not a coincidence to ignore. A pair that
    // DOES share all of those but is still, in the real world, two different
    // exercises has to be named here explicitly, with the reason it is kept
    // — so a future reviewer can tell "reviewed and accepted" apart from
    // "nobody has looked at this yet".
    name: 'a Finnish or plain-English label shared by more than one stored name always names one lift',
    run() {
      function foldLabel(value) {
        return value.normalize('NFC').toLocaleLowerCase('fi').replace(/\s+/g, ' ').trim();
      }

      const byName = new Map(GENERATED_EXERCISE_LIBRARY.map((item) => [item.name, item]));

      function signature(item) {
        return JSON.stringify([
          item.bodyPart,
          item.category,
          (item.primaryMuscles ?? []).slice().sort(),
        ]);
      }

      // Present in the real library, sharing a label, and — checked below —
      // genuinely the same lift by bodyPart/category/primary muscles: kept
      // deliberately, not by accident. Keyed by the pair's stored names,
      // sorted, so the assertion below can tell "this exact known pair" from
      // "a new pair that happens to share a label".
      const SAME_LIFT_EXCEPTIONS = {
        'Barbell Full Squat|Barbell Squat':
          'the same barbell back squat under the library\'s two names for it (already noted where the plain-English table keeps "Barbell Squat" rather than relabelling it "Back Squat")',
        'Clean|Power Clean':
          "the library's own instructions differ only in catch depth (a full-squat catch vs. a quarter-squat catch); this app does not train or track that distinction separately, and both are 'rinnalleveto' in ordinary Finnish gym use",
        'Alternating Kettlebell Press|Kettlebell Seesaw Press':
          '"seesaw press" is kettlebell training\'s own name for the alternating overhead press — same movement, not a variant',
        'Double Kettlebell Jerk|Two-Arm Kettlebell Jerk':
          '"double" and "two-arm" name the same count of kettlebells jerked overhead together',
        'Decline Smith Press|Smith Machine Decline Press':
          'the same decline press in a Smith machine, described by two contributors to the source database',
        'Hammer Grip Incline DB Bench Press|Incline Dumbbell Bench With Palms Facing In':
          "the source database's own instructions for these two are verbatim identical — a hammer grip IS palms facing in",
      };

      function sweep(tableName, table) {
        const byLabel = new Map();
        for (const [stored, label] of Object.entries(table)) {
          const key = foldLabel(label);
          const list = byLabel.get(key) ?? [];
          if (!list.includes(stored)) {
            list.push(stored);
          }
          byLabel.set(key, list);
        }

        const problems = [];
        for (const [label, storedNames] of byLabel.entries()) {
          if (storedNames.length < 2) {
            continue;
          }
          // Only names the reader can actually be shown matter — a label
          // shared with a name that never made it into the generated
          // library cannot resolve to the wrong lift.
          const present = storedNames.filter((n) => byName.has(n));
          if (present.length < 2) {
            continue;
          }
          const sigs = new Set(present.map((n) => signature(byName.get(n))));
          const pairKey = present.slice().sort().join('|');
          if (sigs.size > 1) {
            problems.push(
              `[${tableName}] "${label}" resolves to different lifts: ${present.join(' vs ')}`,
            );
            continue;
          }
          // Same signature, still needs a reviewed reason on file — an
          // unreviewed collision is exactly the bug this test exists to catch.
          if (present.length > 2 || !SAME_LIFT_EXCEPTIONS[pairKey]) {
            problems.push(
              `[${tableName}] "${label}" is shared by ${present.join(', ')} with no reviewed reason on file — `
              + 'add it to SAME_LIFT_EXCEPTIONS if it is genuinely one lift, or give one of them its own label if not',
            );
          }
        }
        return problems;
      }

      const problems = [
        ...sweep('TRANSLATED_EXERCISE_NAMES', TRANSLATED_EXERCISE_NAMES),
        ...sweep('PLAIN_EXERCISE_NAMES', PLAIN_EXERCISE_NAMES),
      ];
      assert.deepEqual(problems, []);
    },
  },
];
