const assert = require('node:assert/strict');

const { findFiledLibraryIndex, findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

/**
 * The library lookups remember their answers per library array.
 *
 * Both used to lowercase all ~900 library names on every call, and the
 * recommender calls them thousands of times per pass. On the phone that was
 * 1.6 s of the render the native splash waits for, and cold start went from
 * 5.2 s to 2.8 s when it stopped (startup trace, 2026-10-06).
 */
const libraryNames = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);

function probeNames() {
  const names = new Set();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        names.add(exercise.exerciseName);
      }
    }
  }
  // Qualified, padded and partial spellings take the strip, alias and
  // containment branches; an empty name and a nonsense one take the misses.
  for (const name of ['Seated Cable Row (Wide)', '  BENCH press ', 'curl', 'Plank (30 s)', '', 'zzz no such lift']) {
    names.add(name);
  }
  return [...names];
}

/** A library array that counts how often its names are copied out. */
function countingLibrary(names) {
  const counter = { maps: 0 };
  const array = [...names];
  const originalMap = array.map.bind(array);
  array.map = (...args) => {
    counter.maps += 1;
    return originalMap(...args);
  };
  return { array, counter };
}

module.exports = [
  {
    name: 'library lookups: a remembered answer is the answer a fresh lookup gives',
    run() {
      const names = probeNames();
      assert.ok(names.length > 200, `expected the catalogue's names, got ${names.length}`);
      for (const pass of [1, 2]) {
        for (const name of names) {
          // A copy of the array is a library the cache has never seen.
          assert.equal(
            findGuidedLibraryIndex(name, libraryNames),
            findGuidedLibraryIndex(name, [...libraryNames]),
            `guided lookup of "${name}", pass ${pass}`,
          );
          assert.equal(
            findFiledLibraryIndex(name, libraryNames),
            findFiledLibraryIndex(name, [...libraryNames]),
            `filed lookup of "${name}", pass ${pass}`,
          );
        }
      }
    },
  },
  {
    name: 'library lookups: the names are lowercased once per library, not once per call',
    run() {
      const { array, counter } = countingLibrary(libraryNames);
      for (const name of probeNames()) {
        findGuidedLibraryIndex(name, array);
        findFiledLibraryIndex(name, array);
      }
      assert.equal(counter.maps, 1);
    },
  },
  {
    name: 'library lookups: an array that grows is read again',
    run() {
      const names = ['Bench Press'];
      assert.equal(findGuidedLibraryIndex('Back Squat', names), null);
      assert.equal(findFiledLibraryIndex('Back Squat', names), null);
      names.push('Back Squat');
      assert.equal(findGuidedLibraryIndex('Back Squat', names), 1);
      assert.equal(findFiledLibraryIndex('Back Squat', names), 1);
    },
  },
  {
    name: 'library lookups: two arrays keep separate answers',
    run() {
      const first = ['Back Squat', 'Bench Press'];
      const second = ['Bench Press', 'Back Squat'];
      assert.equal(findGuidedLibraryIndex('Back Squat', first), 0);
      assert.equal(findGuidedLibraryIndex('Back Squat', second), 1);
      assert.equal(findFiledLibraryIndex('Bench Press', first), 1);
      assert.equal(findFiledLibraryIndex('Bench Press', second), 0);
    },
  },
];
