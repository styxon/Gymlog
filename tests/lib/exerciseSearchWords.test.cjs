const assert = require('node:assert/strict');

const {
  buildExerciseSearchHaystack,
  exerciseMatchesQuery,
  normalizeSearchText,
  rankExerciseMatch,
  rankExerciseMatches,
} = require('../../.test-dist/lib/exerciseSearch.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { buildSwapShortlist, sessionLiftsMatchingQuery } = require('../../.test-dist/lib/swapShortlist.js');
const { buildSwapPickerLibrary } = require('../../.test-dist/lib/swapPickerLists.js');
// Every swap sheet's library search since 2026-10-07: no chips, nothing being swapped.
const swapSearch = (items, query, language, { excludeNames = [], popularOrder = new Map() } = {}) =>
  buildSwapPickerLibrary(items, {
    query,
    filters: { category: 'all', bodyPart: 'all', equipment: 'all' },
    language,
    currentName: null,
    currentItem: null,
    excludeNames,
    popularOrder,
  });
const { getPopularExerciseLibraryOrder } = require('../../.test-dist/lib/exerciseSuggestions.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

// The phone, 2026-09-27 (#bugs): "Eikö ole yläpenkkiä?", "jokainen väli pitää
// olla oikein muuten ei löydä", "voisiko lihasryhmittäin hakea",
// "Penkkipunnerrus ketjuilla" listed twice, and "miksi penkkipunnerrus ei ole
// liike?" — it was already in the session.

const popular = getPopularExerciseLibraryOrder(library);
const labels = (query) =>
  swapSearch(library, query, 'fi', { popularOrder: popular }).map((item) => exerciseNameLabel('fi', item.name));
const matches = (query) =>
  library.filter((item) => exerciseMatchesQuery(buildExerciseSearchHaystack(item, 'fi'), query));

module.exports = [
  {
    name: 'search text folds case, ä/ö and punctuation, so spacing and dashes stop mattering',
    run() {
      assert.equal(normalizeSearchText('  Trap bar -maastaveto '), 'trap bar maastaveto');
      assert.equal(normalizeSearchText('Ylä–Penkki (KP)'), 'yla penkki kp');
      assert.equal(normalizeSearchText('Olkapää'), 'olkapaa');
      // A keyboard without ä still finds "Ylätalja".
      assert.equal(labels('ylatalja')[0], 'Ylätalja');
      // The query's own spaces are optional…
      assert.ok(labels('penkki punnerrus').includes('Penkkipunnerrus'));
      assert.ok(labels('trap bar').includes('Trap bar -maastaveto'));
      // …but the haystack's are not joined: a term never matches across two
      // of its words ("…bar in ta…" is not "rinta").
      assert.ok(matches('rinta').every((item) => normalizeSearchText(buildExerciseSearchHaystack(item, 'fi')).includes('rinta')));
    },
  },
  {
    name: 'the gym\'s own words find the lifts the library names otherwise',
    run() {
      assert.equal(labels('Yläpenkki')[0], 'Vinopenkkipunnerrus');
      assert.ok(labels('yläpenkki kp').includes('Vinopenkkipunnerrus käsipainoilla'));
      // …and ranks as a name match, word by word (PR review): the dumbbell
      // incline press leads a two-word alias query, not a muscle-only row.
      // Each word read as what it stands for: "romanialainen mave" is the
      // name exactly, so it ranks as the name.
      const rdl = library.find((item) => exerciseNameLabel('fi', item.name) === 'Romanialainen maastaveto');
      assert.equal(rankExerciseMatch(rdl, 'romanialainen mave', 'fi'), 0);
      // Every word in the name, in whatever order, is at least a name match.
      const incline = library.find((item) => item.name === 'Incline Dumbbell Press');
      assert.ok(rankExerciseMatch(incline, 'kp yläpenkki', 'fi') <= 3);
      assert.ok(labels('alapenkki').some((label) => label.startsWith('Laskeva penkkipunnerrus')));
      assert.equal(labels('mave')[0], 'Maastaveto');
      assert.ok(labels('leuka').includes('Leuanveto'));
      // An alias widens a term; it does not replace the plain match.
      assert.ok(labels('vinopenkki').includes('Vinopenkkipunnerrus'));
    },
  },
  {
    name: 'a muscle named by the start of its word brings its main lifts first, and names beat muscles after that',
    run() {
      assert.equal(labels('Olkap')[0], 'Pystypunnerrus');
      assert.equal(labels('rinta')[0], 'Penkkipunnerrus');
      // "hauis" is the curls before a forearm roller that happens to train it.
      const curls = labels('hauis');
      assert.ok(curls.slice(0, 5).every((label) => /hauis|kääntö/i.test(label)), curls.join(' | '));
    },
  },
  {
    name: 'the swap list shows one row per name the reader sees; the library keeps both rows',
    run() {
      // The chains pair no longer shares a label (label sweep, recheck round
      // 2026-09-29), so the collision this checks is one that still exists:
      // two library rows shown as "Takakyykky".
      const shared = library.filter((item) => exerciseNameLabel('fi', item.name) === 'Takakyykky');
      assert.ok(shared.length >= 2, 'the collision this case needs is gone; pick another shared label');
      const squats = labels('takakyykky').filter((label) => label === 'Takakyykky');
      assert.equal(squats.length, 1);
      const swap = labels('penkkipunnerrus');
      assert.equal(new Set(swap).size, swap.length, 'a label repeated in the swap list');
      // Browsing is not choosing a replacement: both rows, each with its own
      // pictures and steps, stay findable (review, 2026-09-27). They no
      // longer share one label ('Chain Press' — a cable exercise — got its
      // own distinct label from 'Bench Press with Chains' — a barbell one —
      // in the label sweep, recheck round 2026-09-29), so the shared term
      // both their labels still carry is "ketju", not the exact old label.
      const browsed = rankExerciseMatches(library, 'ketju', 'fi').map((item) => item.name);
      assert.ok(browsed.includes('Bench Press with Chains') && browsed.includes('Chain Press'));
    },
  },
  {
    name: 'one or two letters spell a name, not a muscle',
    run() {
      // "s" on the way to "sivunosto" must not rank every lift whose muscle
      // starts with s alongside the names (review, 2026-09-27).
      const top = rankExerciseMatches(library, 'si', 'fi').slice(0, 5).map((item) => exerciseNameLabel('fi', item.name));
      assert.ok(top.every((label) => /^si/i.test(label)), top.join(' | '));
    },
  },
  {
    name: 'the slot\'s own shortlist searches the same way as the library',
    run() {
      const options = [
        { exerciseName: 'Incline Dumbbell Press', searchLabel: 'Vinopenkkipunnerrus käsipainoilla', score: 1, reason: null },
        { exerciseName: 'Dumbbell Bench Press', searchLabel: 'Penkkipunnerrus käsipainoilla', score: 1, reason: null },
      ];
      // Two words, any order: this list took the query as one exact run.
      const found = buildSwapShortlist('Barbell Bench Press - Medium Grip', options, { query: 'käsipainoilla vinopenkki' });
      assert.deepEqual(
        [...found.variations, ...found.related].map((option) => option.exerciseName),
        ['Incline Dumbbell Press'],
      );
      const alias = buildSwapShortlist('Barbell Bench Press - Medium Grip', options, { query: 'yläpenkki kp' });
      assert.equal([...alias.variations, ...alias.related].length, 1);
    },
  },
  {
    name: 'a lift the search hits but the session already holds is named, never silently missing',
    run() {
      const session = ['Barbell Bench Press - Medium Grip', 'Smith Machine Bench Press', 'Standing Military Press'];
      assert.deepEqual(
        sessionLiftsMatchingQuery(session, 'Smith Machine Bench Press', 'penkkipunnerrus', 'fi'),
        [exerciseNameLabel('fi', 'Barbell Bench Press - Medium Grip')],
      );
      // The lift being swapped is the sheet's own title, not a hit — under
      // another stored spelling too.
      assert.deepEqual(sessionLiftsMatchingQuery(session, 'Standing Military Press', 'pysty', 'fi'), []);
      assert.deepEqual(sessionLiftsMatchingQuery(session, 'Bench Press', 'penkkipunnerrus', 'fi'), [
        exerciseNameLabel('fi', 'Smith Machine Bench Press'),
      ]);
      // Nothing typed, nothing named; a row with no name is skipped, not thrown on.
      assert.deepEqual(sessionLiftsMatchingQuery(session, 'Smith Machine Bench Press', '  ', 'fi'), []);
      assert.deepEqual(sessionLiftsMatchingQuery([undefined, 'Deadlift'], 'Deadlift', 'mave', 'fi'), []);
    },
  },
  {
    name: 'a session lift is left out of the library by the name the reader sees, not only by its stored words',
    run() {
      // The session stores "Bench Press"; the library row is "Barbell Bench
      // Press - Medium Grip". Both read "Penkkipunnerrus".
      assert.equal(exerciseNameLabel('fi', 'Bench Press'), exerciseNameLabel('fi', 'Barbell Bench Press - Medium Grip'));
      const found = swapSearch(library, 'penkkipunnerrus', 'fi', {
        excludeNames: ['Chest-Supported Row', 'Bench Press'],
        popularOrder: popular,
      }).map((item) => exerciseNameLabel('fi', item.name));
      assert.ok(!found.includes('Penkkipunnerrus'), found.join(' | '));
      assert.ok(found.includes('Penkkipunnerrus käsipainoilla'));
    },
  },
  {
    name: 'the slot\'s shortlist leaves out a session lift and a repeat by the name on screen too',
    run() {
      const options = [
        { exerciseName: 'Barbell Bench Press - Medium Grip', searchLabel: 'Penkkipunnerrus', score: 1, reason: null },
        { exerciseName: 'Bench Press', searchLabel: 'Penkkipunnerrus', score: 1, reason: null },
        { exerciseName: 'Dumbbell Bench Press', searchLabel: 'Penkkipunnerrus käsipainoilla', score: 1, reason: null },
      ];
      const names = (list) => [...list.variations, ...list.related].map((option) => option.exerciseName).sort();
      // Two spellings of one lift: one row (PR review).
      const plain = buildSwapShortlist('Smith Machine Bench Press', options, { language: 'fi' });
      assert.deepEqual(names(plain), ['Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press']);
      // The session holds "Bench Press": its other spelling is not offered either.
      const held = buildSwapShortlist('Smith Machine Bench Press', options, { alreadyInSession: ['Bench Press'], language: 'fi' });
      assert.deepEqual(names(held), ['Dumbbell Bench Press']);
    },
  },
  {
    name: 'two spellings of one session lift are named once',
    run() {
      // "Bench Press" and "Barbell Bench Press - Medium Grip" — different
      // words, one name on screen (PR review, 2026-09-27).
      assert.deepEqual(
        sessionLiftsMatchingQuery(['Bench Press', 'Barbell Bench Press - Medium Grip'], 'Chest-Supported Row', 'penkkipunnerrus', 'fi'),
        ['Penkkipunnerrus'],
      );
    },
  },
  {
    name: 'a row with no name renders as nothing instead of throwing mid-search',
    run() {
      assert.equal(exerciseNameLabel('fi', undefined), '');
      assert.equal(exerciseNameLabel('en', null), '');
      assert.equal(normalizeSearchText(undefined), '');
      // A malformed library row does not take the whole search down with it.
      const withBroken = [...library.slice(0, 50), { id: 'broken', name: undefined, bodyPart: 'chest' }];
      assert.doesNotThrow(() => rankExerciseMatches(withBroken, 'penkki', 'fi'));
    },
  },
];
