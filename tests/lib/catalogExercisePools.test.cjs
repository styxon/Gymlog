const assert = require('node:assert/strict');

const {
  FOCUS_ACCESSORY_POOL,
  SUPPLEMENTAL_DAY_POOL,
  isCatalogExercise,
  getCatalogBodyPart,
  getCatalogTrackingMode,
  resolveCatalogBodyPart,
  sessionFocusAffinity,
  pickPoolVariant,
} = require('../../.test-dist/lib/catalogExercisePools.js');
const { EQUIPMENT_FALLBACKS } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { getFocusEmphasisCount } = require('../../.test-dist/lib/focusEmphasis.js');

/**
 * The guard for a bug family that appeared in three separate tables: exercise
 * names written by hand that exist in no catalog. A user got "Arms" and
 * "Glute Bridge" on a saved plan — no demo, no instructions, nothing to swap.
 */
module.exports = [
  {
    name: 'every focus accessory is a real catalog exercise',
    run() {
      const missing = [];
      for (const [area, pool] of Object.entries(FOCUS_ACCESSORY_POOL)) {
        for (const variant of ['bodyweight', 'loaded']) {
          for (const name of pool[variant]) {
            if (!isCatalogExercise(name)) {
              missing.push(`${area}.${variant}: ${name}`);
            }
          }
        }
      }
      assert.deepEqual(missing, [], 'these names would reach a plan with no demo and no instructions');
    },
  },
  {
    name: 'every supplemental-day exercise is a real catalog exercise',
    run() {
      const missing = [];
      for (const [kind, pool] of Object.entries(SUPPLEMENTAL_DAY_POOL)) {
        for (const variant of ['bodyweight', 'loaded']) {
          for (const name of pool[variant]) {
            if (!isCatalogExercise(name)) {
              missing.push(`${kind}.${variant}: ${name}`);
            }
          }
        }
      }
      assert.deepEqual(missing, []);
    },
  },
  {
    name: 'every equipment fallback is a real catalog exercise',
    run() {
      const missing = [];
      for (const [pattern, candidates] of EQUIPMENT_FALLBACKS) {
        for (const name of candidates) {
          if (!isCatalogExercise(name)) {
            missing.push(`${pattern} → ${name}`);
          }
        }
      }
      // A swap onto an unknown name strips the very demo it was rescuing.
      assert.deepEqual(missing, []);
    },
  },
  {
    name: 'a focus area always has enough accessories for the emphasis it promises',
    run() {
      for (const [area, pool] of Object.entries(FOCUS_ACCESSORY_POOL)) {
        const needed = getFocusEmphasisCount(area);
        for (const variant of ['bodyweight', 'loaded']) {
          assert.ok(
            pool[variant].length >= needed,
            `${area}.${variant} promises ${needed} accessories but offers ${pool[variant].length}`,
          );
        }
      }
    },
  },
  {
    name: 'tracking mode comes from the catalog, not from the name',
    run() {
      // Neither of these matches the keyword lists that used to decide this.
      assert.equal(getCatalogTrackingMode('Butt Lift (Bridge)'), 'bodyweight');
      assert.equal(getCatalogTrackingMode('Bench Dips'), 'bodyweight');
      assert.equal(getCatalogTrackingMode('Leg Press'), 'load_and_reps');
      assert.equal(getCatalogTrackingMode('Barbell Hip Thrust'), 'load_and_reps');
      // An unknown name must not claim to be bodyweight.
      assert.equal(getCatalogTrackingMode('Arms'), 'load_and_reps');
    },
  },
  {
    name: 'body parts resolve for names the templates spell differently',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const names = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);

      // The ready templates say "Bench Press"; the library says "Barbell Bench
      // Press - Medium Grip". Exact lookup finds nothing for most of the catalog.
      assert.equal(getCatalogBodyPart('Bench Press'), null);
      assert.equal(resolveCatalogBodyPart('Bench Press'), 'chest');
      assert.equal(resolveCatalogBodyPart('Back Squat'), 'legs');
      assert.equal(resolveCatalogBodyPart('Lat Pulldown'), 'back');
      assert.equal(resolveCatalogBodyPart('Arms'), null, 'a category word is still not an exercise');

      // Must agree with the matcher the media zone uses, or a day could show a
      // photo of one muscle group while emphasis treats it as another.
      for (const name of ['Bench Press', 'Back Squat', 'Lat Pulldown', 'Barbell Row', 'Hip Thrust']) {
        const index = findGuidedLibraryIndex(name, names);
        assert.ok(index !== null);
        assert.equal(resolveCatalogBodyPart(name), GENERATED_EXERCISE_LIBRARY[index].bodyPart, name);
      }
    },
  },
  {
    name: 'a coaching qualifier in brackets does not hide an exercise from the library',
    run() {
      // "(Wide)", "(Light)", "(Banded)", "(or Knee Push-Up)" are cues, not
      // different exercises, but the library never spells them — so every one
      // of these reached the user with no photo, no demo and no swap pool.
      assert.equal(resolveCatalogBodyPart('Seated Cable Row (Wide)'), 'back');
      assert.equal(resolveCatalogBodyPart('Goblet Squat (Light)'), 'legs');
      assert.equal(resolveCatalogBodyPart('Push-Up (or Knee Push-Up)'), 'chest');
      assert.equal(resolveCatalogBodyPart('Dead Bug (Modified)'), 'core');
      assert.equal(resolveCatalogBodyPart('Vacuum (Stomach)'), 'core');
      // The qualifier is only dropped for matching; unqualified names are
      // unaffected either way.
      assert.equal(resolveCatalogBodyPart('Goblet Squat'), 'legs');
    },
  },
  {
    name: 'a bracket carrying a prescription is never stripped, and a stripped name never guesses',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const names = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);
      const resolved = (name) => {
        const index = findGuidedLibraryIndex(name, names);
        return index === null ? null : GENERATED_EXERCISE_LIBRARY[index].name;
      };

      // "Air Bike" in this library is the ab exercise, not a fan bike. Drop the
      // prescription and the conditioning row gets a photo of a crunch — a
      // confidently wrong photo, which is worse than none.
      assert.equal(resolved('Air Bike (30s sprint)'), null);
      // Nor may the strip reach anything else by itself: the library has no
      // burpee at all, and a stripped name that finds nothing must stay found
      // nothing.
      assert.equal(resolved('Burpee (20s on / 10s off)'), null);

      // What the strip refuses, the alias table may still name by hand — which
      // is what its own comment asks for. A push-up done in 20-second bursts is
      // a push-up, and the photo and instructions are right; only the dosage
      // lives in the bracket.
      assert.equal(resolved('Push-Up (20s on / 10s off)'), 'Pushups');
      assert.equal(resolved('Pistol Squat (each leg)'), 'Kettlebell Pistol Squat');

      // A stripped name gets exact and alias lookups only. Containment on a
      // shortened name is where it went wrong: "rows" sits inside "seated
      // cable rows", "side plank" inside "push up to side plank".
      assert.equal(resolved('Side Plank (Knees Down)'), null, 'the library has no side plank');
      assert.equal(resolved('Rows (Bar or Rings)'), 'Inverted Row', 'a ring row is not a cable row');
    },
  },
  {
    name: 'no program prescribes a block name in place of an exercise',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

      // "Mobility Flow", "Sun Salutation Flow", "Breath Reset" were rows in
      // RESET, RESET Yoga and RUN's recovery day. They name a block, not a
      // movement: nothing in the library matches them, so those sessions were
      // four blank lines with no photo and nothing to swap. A session is
      // allowed to be called "Day 1: Mobility Flow"; an exercise is not.
      const blockName = /\b(flow|reset|circuit|blocks?|finishers?)\b/i;
      const offenders = [];

      WORKOUT_TEMPLATES_V1.forEach((template) => {
        template.sessions.forEach((session) => {
          session.exercises.forEach((exercise) => {
            if (blockName.test(exercise.exerciseName) && resolveCatalogBodyPart(exercise.exerciseName) === null) {
              offenders.push(`${template.name} / ${session.name}: ${exercise.exerciseName}`);
            }
          });
        });
      });

      // "Easy Run Blocks" / "Tempo Run Blocks" / "Stride Finishers" are the
      // known remainder: running prescriptions the library has no entry for at
      // all. RUN uses all three, and the summer season programme uses them
      // too, because putting a run block in every session is the whole point
      // of it. Pinned so the number cannot grow quietly.
      assert.deepEqual(offenders.sort(), [
        'RUN / Day 1: Easy Run: Easy Run Blocks',
        'RUN / Day 2: Tempo Run: Stride Finishers',
        'RUN / Day 2: Tempo Run: Tempo Run Blocks',
        'Summer Conditioning / Day 1: Push and Easy Run: Easy Run Blocks',
        'Summer Conditioning / Day 2: Strength and Tempo Run: Tempo Run Blocks',
        'Summer Conditioning / Day 3: Legs and Strides: Stride Finishers',
      ]);
    },
  },
  {
    name: 'the number of prescribed names that resolve to nothing does not grow',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const libraryNames = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);

      const prescribed = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            prescribed.add(exercise.exerciseName);
          }
        }
      }

      const unresolved = [...prescribed].filter((name) => {
        const index = findGuidedLibraryIndex(name, libraryNames);
        return index === null || index === undefined || index < 0;
      });

      // A name that resolves to nothing reaches the reader with no photo, no
      // demo, no swap pool and no instructions in any language — and it does it
      // silently. 113 of 274 did, until the alias table learned the catalogs'
      // own spellings for lifts the library files differently.
      //
      // What is left is two kinds: cardio prescriptions with no library entry
      // to point at ("Treadmill HIIT"), and movements the library genuinely
      // lacks ("Burpee", "Bird Dog"). Both need content, not a mapping.
      //
      // Lower this number, never raise it. A program that adds an unresolvable
      // name should have to argue for it here.
      assert.ok(
        unresolved.length <= 84,
        `${unresolved.length} prescribed names resolve to nothing (was 84):\n  ${unresolved.sort().join('\n  ')}`,
      );
    },
  },
  {
    name: 'every alias points at an exercise that actually exists',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { GUIDED_LIBRARY_ALIASES } = require('../../.test-dist/lib/guidedPlayer.js');
      // An alias may point at one of the app's own extras ("bodyweight calf
      // raise"): the shipped library is generated + extras (bug hunt, 2026-10-04).
      const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');
      const libraryNames = new Set(
        [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY].map((entry) => entry.name.trim().toLowerCase()),
      );

      // A misspelled target is the worst kind of entry: the alias silently
      // does nothing, the name goes on resolving to nothing, and the table
      // reads as if the problem were handled.
      const broken = Object.entries(GUIDED_LIBRARY_ALIASES)
        .filter(([, target]) => !libraryNames.has(target))
        .map(([source, target]) => `${source} -> ${target}`);

      assert.deepEqual(broken, []);
    },
  },
  {
    name: 'an alias beats the containment guess, so a near-miss cannot win',
    run() {
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const names = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);
      const resolved = (name) => GENERATED_EXERCISE_LIBRARY[findGuidedLibraryIndex(name, names)].name;

      // "Reverse Lunge" used to reach "Crossover Reverse Lunge" by
      // containment — a different movement, filed under 'back', so every leg
      // day running one quietly picked up a pull vote.
      assert.equal(resolved('Reverse Lunge'), 'Dumbbell Rear Lunge');
      assert.equal(resolveCatalogBodyPart('Reverse Lunge'), 'legs');
      // The biggest single miss in the catalogs: 24 prescriptions.
      assert.equal(resolved('Chest-Supported Row'), 'Dumbbell Incline Row');
      assert.equal(resolveCatalogBodyPart('Chest-Supported Row'), 'back');
    },
  },
  {
    name: 'the share of catalog names the library cannot place only goes down',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

      // A ratchet, not a target. An unresolvable name fails silently — the
      // exercise still renders, just with no photo, no instructions and no
      // swap pool — so only a count catches it drifting back up. Lower the
      // ceiling whenever a batch of names is fixed.
      const names = new Set();
      WORKOUT_TEMPLATES_V1.forEach((template) =>
        template.sessions.forEach((session) =>
          session.exercises.forEach((exercise) => names.add(exercise.exerciseName)),
        ),
      );
      const unresolved = [...names].filter((name) => resolveCatalogBodyPart(name) === null);

      assert.ok(
        unresolved.length <= 113,
        `${unresolved.length}/${names.size} catalog names resolve to nothing (ceiling 113). ` +
          `New ones: ${unresolved.slice(0, 8).join(', ')}`,
      );
    },
  },
  {
    name: 'affinity finds the day that already trains the area',
    run() {
      const upper = ['Barbell Bench Press - Medium Grip', 'Bent Over Two-Dumbbell Row', 'Triceps Pushdown'];
      const lower = ['Barbell Squat', 'Romanian Deadlift', 'Leg Press'];

      assert.ok(sessionFocusAffinity(lower, 'glutes') > sessionFocusAffinity(upper, 'glutes'));
      assert.ok(sessionFocusAffinity(upper, 'chest') > sessionFocusAffinity(lower, 'chest'));

      // Mobility matches nothing on purpose — it may go anywhere.
      assert.equal(sessionFocusAffinity(lower, 'mobility'), 0);
      assert.equal(sessionFocusAffinity(upper, 'mobility'), 0);
    },
  },
  {
    name: 'a user with no equipment gets the bodyweight variant',
    run() {
      const pool = FOCUS_ACCESSORY_POOL.glutes;
      assert.deepEqual(pickPoolVariant(pool, []), pool.bodyweight);
      assert.deepEqual(pickPoolVariant(pool, ['Barbells', 'Bench', 'Cables']), pool.loaded);
      // Some gear is not all gear: the cable kickback needs a cable, so a
      // barbell and a bench keep the hip thrust and take the bodyweight
      // kickback in its place (coverage sweep, 2026-10-04).
      // The reserves beyond the two the emphasis promises swap place for place.
      assert.deepEqual(pickPoolVariant(pool, ['Barbells', 'Bench']), [
        'Barbell Hip Thrust',
        'Glute Kickback',
        'Standing Hip Abduction',
        'Barbell Glute Bridge',
      ]);
      // null means the setup never said, so nothing is assumed missing.
      assert.deepEqual(pickPoolVariant(pool, null), pool.loaded);
    },
  },
];
