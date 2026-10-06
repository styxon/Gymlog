const assert = require('node:assert/strict');

const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
const browse = require('../../.test-dist/lib/exerciseBrowseFilter.js');
const { rankExerciseMatches } = require('../../.test-dist/lib/exerciseSearch.js');

const library = createSeedExerciseLibrary();
const names = (rows) => rows.map((item) => item.name);

module.exports = [
  {
    /**
     * The sprint-start and running-form drills sat in "Takareidet" among the
     * leg curls (#bugs 2026-10-06). They are drills, not sets — walked
     * through for a few metres, not counted — so they are handled as the
     * stretches are: not offered unasked, in no muscle chip even under a
     * query, and found by search.
     */
    name: 'drills: sprint and running-form drills are in no muscle chip and not offered unasked',
    run() {
      const drills = [
        'Linear 3-Part Start Technique',
        'Linear Acceleration Wall Drill',
        'Moving Claw Series',
        'Kneeling Arm Drill',
        'Carioca Quick Step',
        'Fast Skipping',
        'Double Leg Butt Kick',
        'Single Leg Butt Kick',
      ];
      const unsearched = browse.filterBrowsableExercises(library);
      for (const name of drills) {
        const item = library.find((entry) => entry.name === name);
        assert.ok(item, `${name} missing from the library`);
        assert.equal(unsearched.includes(item), false, `${name} is offered unasked`);
        for (const muscle of browse.LEG_MUSCLE_FILTERS) {
          assert.equal(browse.matchesBodyPartFilter(item, muscle), false, `${name} is under ${muscle}`);
        }
        const found = rankExerciseMatches(browse.filterBrowsableExercises(library, { query: name }), name, 'en', () => undefined);
        assert.ok(found.includes(item), `searching "${name}" does not find it`);
      }
      // The jumps, bounds and hops beside them are sets of reps and stay.
      for (const name of ['Knee Tuck Jump', 'Front Box Jump', 'Lateral Bound', 'Single-Leg Lateral Hop']) {
        const item = library.find((entry) => entry.name === name);
        assert.ok(unsearched.includes(item), `${name} was hidden`);
      }
      const hamstrings = unsearched.filter((item) => browse.matchesBodyPartFilter(item, 'hamstrings'));
      assert.deepEqual(names(hamstrings.filter((item) => /\b(drill|technique|series|skipping|butt kick|carioca)\b/i.test(item.name))), []);
    },
  },
  {
    name: 'drills: a stretch or a drill found by a query is still in no muscle chip',
    run() {
      // Under a query everything comes back, and the chip still has to list
      // training: the stretches never were in it, the drills now are not.
      const searched = browse.filterBrowsableExercises(library, { query: 'x' });
      const noise = searched.filter(
        (item) =>
          browse.LEG_MUSCLE_FILTERS.some((muscle) => browse.matchesBodyPartFilter(item, muscle)) && !browse.isBrowsableExercise(item),
      );
      assert.deepEqual(names(noise), []);
    },
  },
];
