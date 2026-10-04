const assert = require('node:assert/strict');

const { buildExerciseSearchHaystack, exerciseMatchesQuery, rankExerciseMatches } = require('../../.test-dist/lib/exerciseSearch.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

function search(query, language = 'fi') {
  return library.filter((item) => exerciseMatchesQuery(buildExerciseSearchHaystack(item, language), query));
}

module.exports = [
  {
    name: 'the gym\'s words for the lateral raise find it ("vipunostot tai viparit ei löydy", #bugs 2026-10-01)',
    run() {
      for (const phrasing of ['vipunosto', 'vipunostot', 'viparit', 'vipari', 'sivunostot']) {
        for (const language of ['fi', 'en']) {
          const hits = search(phrasing, language);
          assert.ok(
            hits.some((item) => item.name === 'Side Lateral Raise'),
            `"${phrasing}" (${language}) found ${hits.length} but not the lateral raise`,
          );
        }
      }
      // "vipunosto" still finds the flyes the library itself calls that,
      // and the plural now does too.
      assert.ok(search('vipunostot').some((item) => /fly/i.test(item.name)));
    },
  },
  {
    name: 'a Finnish search finds the lifts the Finnish screen shows',
    run() {
      // Seen on a phone: the library listed "Takakyykky", the search box got
      // "kyykky", and the result was "Ei osumia". The haystack was English only.
      const squats = search('kyykky');
      assert.ok(squats.length >= 5, `"kyykky" found ${squats.length}`);
      assert.ok(squats.some((item) => item.name === 'Barbell Full Squat'), 'the squat the app calls Takakyykky is missing');

      const bench = search('penkkipunnerrus');
      assert.ok(bench.some((item) => item.name === 'Barbell Bench Press - Medium Grip'));
    },
  },
  {
    name: 'the English name still matches, and so do the translated facets',
    run() {
      assert.ok(search('squat', 'fi').length >= 5, 'English term stopped matching under Finnish');
      // "rinta" is what the chip and the row say for chest; the data says
      // "chest". Both have to work.
      const chest = search('rinta');
      assert.ok(chest.length >= 20, `"rinta" found ${chest.length}`);
      assert.ok(chest.every((item) => buildExerciseSearchHaystack(item, 'fi').includes('rinta')));
    },
  },
  {
    name: 'every term has to land, so a two-word query narrows',
    run() {
      const both = search('kyykky tanko');
      const one = search('kyykky');
      assert.ok(both.length > 0 && both.length < one.length, `${both.length} vs ${one.length}`);
      assert.equal(exerciseMatchesQuery('barbell full squat takakyykky', '  '), true);
      assert.equal(exerciseMatchesQuery('barbell full squat', 'kyykky'), false);
    },
  },
  {
    name: 'the lift itself comes before its variants: "ylätal" answers with Ylätalja',
    run() {
      // #bugs 2026-08-28, "haluisin vain ylätalja — huonot suositukset": the
      // matches came in the English name's alphabetical order, so Kapea
      // ylätalja and Soutu ylätaljasta korokkeelta led and the plain lat
      // pulldown was twelfth of thirteen.
      const ranked = rankExerciseMatches(library, 'ylätal', 'fi');
      assert.ok(ranked.length >= 10, `found ${ranked.length}`);
      assert.equal(ranked[0].name, 'Wide-Grip Lat Pulldown');
      assert.equal(exerciseNameLabel('fi', ranked[0].name), 'Ylätalja');
      // Names that BEGIN with the query outrank names that merely carry it
      // in a later word — the biceps curl "Hauiskääntö ylätaljassa" is a
      // real match, but it is not what "ylätal" is asking for.
      const names = ranked.map((item) => exerciseNameLabel('fi', item.name));
      const starts = names.filter((name) => name.toLowerCase().startsWith('ylätal'));
      assert.ok(starts.length >= 3, `expected several names starting with the query, got ${starts.length}`);
      assert.deepEqual(names.slice(0, starts.length), starts);
      assert.ok(names.indexOf('Hauiskääntö ylätaljassa') > names.indexOf('Ylätalja V-kahvalla'));

      // Same rule in English: "lat pull" answers with Lat Pulldown.
      const en = rankExerciseMatches(library, 'lat pull', 'en');
      assert.equal(en[0].name, 'Wide-Grip Lat Pulldown');
      // The exact stored name wins outright, whatever the language.
      assert.equal(rankExerciseMatches(library, 'Barbell Full Squat', 'fi')[0].name, 'Barbell Full Squat');
      // Within a rank, popularity breaks the tie before length: "penkki" is
      // the bench press, not the bench dip that happens to be shorter.
      const { getPopularExerciseLibraryOrder } = require('../../.test-dist/lib/exerciseSuggestions.js');
      const order = getPopularExerciseLibraryOrder(library);
      const penkki = rankExerciseMatches(library, 'penkki', 'fi', (item) => order.get(item.id));
      assert.equal(exerciseNameLabel('fi', penkki[0].name), 'Penkkipunnerrus');
      assert.equal(exerciseNameLabel('fi', rankExerciseMatches(library, 'penkki', 'fi')[0].name), 'Penkkidippi', 'without popularity the shorter name leads');
      // No query: the caller's order, untouched.
      assert.deepEqual(rankExerciseMatches(library.slice(0, 5), '  ', 'fi').map((i) => i.name), library.slice(0, 5).map((i) => i.name));
    },
  },
  {
    name: 'the gym\'s own words for Leg Curl and Leg Extension find them ("jalankoukistus ja ojennus ei löydy", #bugs 2026-09-29)',
    run() {
      // The library calls them Takareisikoukistus and Reiden ojennus; the gym
      // says "jalan koukistus"/"jalan ojennus" — English words with no reason
      // for a Finnish keyboard to know them.
      const curlPhrasings = ['jalankoukistus', 'jalan koukistus', 'jalkakoukistus'];
      for (const phrasing of curlPhrasings) {
        const hits = search(phrasing);
        assert.ok(hits.length > 0, `"${phrasing}" found nothing`);
        assert.ok(
          hits.some((item) => /leg curl/i.test(item.name)),
          `"${phrasing}" found ${hits.length} but none of them a Leg Curl: ${hits.map((h) => h.name).join(', ')}`,
        );
      }

      const extensionPhrasings = ['jalan ojennus', 'jalkaojennus', 'polven ojennus'];
      for (const phrasing of extensionPhrasings) {
        const hits = search(phrasing);
        assert.ok(hits.length > 0, `"${phrasing}" found nothing`);
        assert.ok(
          hits.some((item) => /leg extension/i.test(item.name)),
          `"${phrasing}" found ${hits.length} but none of them a Leg Extension: ${hits.map((h) => h.name).join(', ')}`,
        );
      }

      // The ä/ö fold (#222/#225) still runs first: a typed "jalankoukistus"
      // with an accidental "ä" nowhere near it is unaffected either way, but
      // the phrase alias must not have skipped folding — "polven öjennus"
      // (a stray ä/ö) should still answer.
      assert.ok(search('polven ojennus', 'fi').length > 0);

      // English gym words, not just Finnish ones.
      assert.ok(search('hamstring curl', 'en').some((item) => /leg curl/i.test(item.name)));
      assert.ok(search('quad extension', 'en').some((item) => /leg extension/i.test(item.name)));

      // A plain, unaliased query is unaffected by any of this.
      assert.equal(exerciseMatchesQuery('barbell full squat takakyykky', 'jalan koukistus'), false);
    },
  },
  {
    name:
      'a case-inflected phrase still finds the lift instead of a phrase glued to its suffix ("jalan ojennusta" review, #bugs 2026-09-29)',
    run() {
      // The naive `text.split(phrase).join(target)` treated "jalan ojennus"
      // as a bare substring of "jalan ojennusta" (the partitive case) and
      // glued the target straight onto the leftover "ta", producing "leg
      // extensionta" — a term nothing in the haystack contains, so the
      // search came back empty even though the reader typed a real Finnish
      // word for the machine.
      const inflected = ['jalan ojennusta', 'jalan koukistusta', 'polven ojennuksesta'];
      for (const phrasing of inflected) {
        const hits = search(phrasing);
        assert.ok(hits.length > 0, `"${phrasing}" found nothing`);
      }
      assert.ok(search('jalan ojennusta').some((item) => /leg extension/i.test(item.name)));
      assert.ok(search('jalan koukistusta').some((item) => /leg curl/i.test(item.name)));
      assert.ok(search('polven ojennuksesta').some((item) => /leg extension/i.test(item.name)));

      // The un-listed exact phrasing still works: the boundary check must
      // not have stopped the plain, un-inflected form from matching.
      assert.ok(search('jalan ojennus').some((item) => /leg extension/i.test(item.name)));
    },
  },
  {
    name:
      'a phrase alias matches its target as a whole phrase, not two words checked apart ("Reverse Hyperextension" review, #bugs 2026-09-29)',
    run() {
      // "jalan ojennus" aliases to "leg extension", but the per-term matcher
      // used to check "leg" and "extension" separately once the alias text
      // was split on the space — and "extension" alone is a substring of
      // "Reverse Hyperextension", with bodyPart "legs" supplying the other
      // term. None of these phrasings mean that lift.
      const extensionPhrasings = [
        'jalan ojennus',
        'jalan ojennusta',
        'polven ojennus',
        'polven ojennuksesta',
        'quad extension',
      ];
      for (const phrasing of extensionPhrasings) {
        const names = search(phrasing).map((item) => item.name);
        assert.ok(!names.some((name) => /hyperextension|back extension/i.test(name)), `"${phrasing}" wrongly found: ${names.join(', ')}`);
        // Still finds the lift it is meant to.
        assert.ok(names.some((name) => /leg extension/i.test(name)), `"${phrasing}" found nothing for Leg Extension`);
      }

      const curlPhrasings = ['jalan koukistus', 'jalan koukistusta', 'hamstring curl'];
      for (const phrasing of curlPhrasings) {
        const names = search(phrasing).map((item) => item.name);
        assert.ok(names.every((name) => /leg curl|hamstring curl/i.test(name)), `"${phrasing}" found an unrelated lift: ${names.join(', ')}`);
      }
    },
  },
  {
    name:
      'the alias TARGET typed literally is routed through the same whole-phrase check as its aliases ("leg extension" review, recheck round 2026-09-29)',
    run() {
      // "leg extension" is the right-hand side of several SEARCH_ALIASES /
      // SEARCH_PHRASE_ALIASES entries, but never itself the left-hand side of
      // one — so it never went through applyPhraseAliases's boundary + join,
      // and reached exerciseMatchesQuery as two bare terms: "leg" (matched
      // by bodyPart "legs") and "extension" (matched by the unrelated
      // "Reverse Hyperextension", which also carries bodyPart "legs"). Both
      // terms landed, so the whole query did.
      for (const query of ['leg extension', 'Leg Extension', 'leg extensions']) {
        const names = search(query, 'en').map((item) => item.name);
        assert.ok(names.length > 0, `"${query}" found nothing`);
        assert.ok(
          !names.some((name) => /hyperextension/i.test(name)),
          `"${query}" wrongly found a hyperextension lift: ${names.join(', ')}`,
        );
        assert.ok(
          names.every((name) => /leg extension/i.test(name)),
          `"${query}" found something outside the Leg Extension family: ${names.join(', ')}`,
        );
        assert.ok(names.includes('Leg Extensions'), `"${query}" missed the plain Leg Extensions machine`);
      }

      // The plural must find the whole family the singular finds, not just
      // whichever row's stored name happens to literally contain "s" (recheck
      // of the recheck, 2026-09-29): the singular phrase alias's boundary
      // check (`\bleg\s+extension\b`) never matches "leg extensions" — there
      // is no word boundary between "extension" and its own trailing "s" —
      // so the plural used to skip applyPhraseAliases entirely and fall back
      // to the pre-fix two-bare-terms path. That path happened to surface
      // "Leg Extensions" (its stored name literally contains "extensions"),
      // which made the assertions above pass without ever exercising the
      // plural through the phrase-join machinery, and silently dropped
      // "Single-Leg Leg Extension" — a real, incomplete result the whole-
      // phrase fix exists to prevent.
      assert.deepEqual(
        search('leg extensions', 'en').map((item) => item.name).sort(),
        search('leg extension', 'en').map((item) => item.name).sort(),
        '"leg extensions" must find exactly the same rows as "leg extension"',
      );

      // The other alias target, "leg curl", only had bodyPart "legs" plus a
      // "curl" name to coincide on — no lift in the library actually
      // collides on it today, but the same bare-terms path was live for it
      // too, so it is pinned here rather than left to luck.
      for (const query of ['leg curl', 'Leg Curl']) {
        const names = search(query, 'en').map((item) => item.name);
        assert.ok(names.length > 0, `"${query}" found nothing`);
        assert.ok(
          names.every((name) => /leg curl/i.test(name)),
          `"${query}" found something outside the Leg Curl family: ${names.join(', ')}`,
        );
      }

      // Same completeness check for "leg curls": the pre-fix bare-terms path
      // matched only "Lying Leg Curls" (the one row whose stored name is
      // itself plural) and dropped "Ball Leg Curl", "Seated Leg Curl" and
      // "Standing Leg Curl" — every one of which the singular query finds.
      const curlSingular = search('leg curl', 'en').map((item) => item.name).sort();
      assert.ok(curlSingular.length > 1, 'expected more than one Leg Curl family member to pin this against');
      assert.deepEqual(
        search('leg curls', 'en').map((item) => item.name).sort(),
        curlSingular,
        '"leg curls" must find exactly the same rows as "leg curl"',
      );

      // A query that merely contains the target phrase, not just the exact
      // phrase alone, is joined too — the boundary check runs the same way
      // applyPhraseAliases already runs it for every gym-phrase alias above.
      assert.ok(exerciseMatchesQuery('single leg leg extension machine', 'leg extension'));
    },
  },
  {
    name: 'routing the alias targets through the phrase check leaves every other multi-word query exactly as it was',
    run() {
      // A frozen top-3 (and count) for 30 everyday multi-word queries that
      // have nothing to do with "leg extension"/"leg curl" — captured from
      // this same file before the phrase-target fix and diffed against the
      // fixed code with a throwaway script; identical both times. Recorded
      // here so a future change to the phrase/alias machinery has to answer
      // to them too (recheck round 2026-09-29).
      const baseline = [
        ['bench press', 'en', 21, ['Barbell Bench Press - Medium Grip', 'Bench Press with Chains', 'Bench Press - With Bands']],
        ['squat barbell', 'en', 32, ['Barbell Full Squat', 'Front Barbell Squat', 'Barbell Squat']],
        ['bicep curl', 'en', 64, ['Machine Bicep Curl', 'Dumbbell Bicep Curl', 'Incline Inner Biceps Curl']],
        ['shoulder press', 'en', 87, ['Shoulder Press - With Bands', 'Cable Shoulder Press', 'Barbell Shoulder Press']],
        ['leg press', 'en', 6, ['Leg Press', 'Leg-Over Floor Press', 'Narrow Stance Leg Press']],
        ['hip thrust', 'en', 1, ['Barbell Hip Thrust']],
        ['cable row', 'en', 9, ['Seated Cable Rows', 'Upright Cable Row', 'Elevated Cable Rows']],
        ['lat pulldown', 'en', 10, ['Wide-Grip Lat Pulldown', 'One Arm Lat Pulldown', 'Close-Grip Front Lat Pulldown']],
        ['tricep extension', 'en', 28, ['Machine Triceps Extension', 'Low Cable Triceps Extension', 'Cable Lying Triceps Extension']],
        ['overhead press', 'en', 2, ['Standing Military Press', 'Smith Machine Overhead Shoulder Press']],
        ['front squat', 'en', 4, ['Front Barbell Squat', 'Front Squat (Clean Grip)', 'Front Squats With Two Kettlebells']],
        ['back squat', 'en', 22, ['Barbell Full Squat', 'Box Squat', 'Speed Squats']],
        ['seated row', 'en', 2, ['Seated Cable Rows', 'Seated One-arm Cable Pulley Rows']],
        ['chest fly', 'en', 9, ['Butterfly', 'Dumbbell Flyes', 'Bodyweight Flyes']],
        ['calf raise', 'en', 12, ['Calf Raise On A Dumbbell', 'Calf Raises - With Bands', 'Seated Calf Raise']],
        ['face pull', 'en', 1, ['Face Pull']],
        ['goblet squat', 'en', 1, ['Goblet Squat']],
        ['romanian deadlift', 'en', 2, ['Romanian Deadlift', 'Romanian Deadlift from Deficit']],
        ['incline press', 'en', 6, ['Barbell Incline Bench Press - Medium Grip', 'Incline Dumbbell Press', 'Incline Cable Chest Press']],
        ['decline press', 'en', 6, ['Decline Smith Press', 'Decline Barbell Bench Press', 'Smith Machine Decline Press']],
        ['hack squat', 'en', 3, ['Hack Squat', 'Barbell Hack Squat', 'Narrow Stance Hack Squats']],
        // The floor bridge leads since the alias moved to it (2026-10-04):
        // "glute bridge" in a programme is the one done without a bar.
        ['glute bridge', 'en', 4, ['Butt Lift (Bridge)', 'Barbell Glute Bridge', 'Single Leg Glute Bridge']],
        ['wrist curl', 'en', 13, ['Cable Wrist Curl', 'Seated Palm-Up Barbell Wrist Curl', 'Palms-Down Wrist Curl Over A Bench']],
        ['preacher curl', 'en', 8, ['Preacher Curl', 'Cable Preacher Curl', 'Zottman Preacher Curl']],
        ['hammer curl', 'en', 6, ['Hammer Curls', 'Incline Hammer Curls', 'Alternate Hammer Curl']],
        ['sumo deadlift', 'en', 4, ['Sumo Deadlift', 'Sumo Deadlift with Bands', 'Sumo Deadlift with Chains']],
        ['trap bar', 'en', 45, ['Trap Bar Deadlift', 'Clean', 'Snatch']],
        ['kyykky tanko', 'fi', 34, ['Overhead Squat', 'Barbell Full Squat', 'Barbell Squat']],
        // 29, not 30: the label sweep of the same round renamed Chain Press
        // (cable chain handles, not a bench press) to "Punnerrus ketjukahvoilla".
        ['penkki punnerrus', 'fi', 29, ['Barbell Bench Press - Medium Grip', 'Barbell Incline Bench Press - Medium Grip', 'Board Press']],
        ['leg raise', 'en', 20, ['Rear Leg Raises', 'Side Leg Raises', 'Front Leg Raises']],
        ['reverse hyperextension', 'en', 1, ['Reverse Hyperextension']],
      ];
      for (const [query, language, count, top3] of baseline) {
        const ranked = rankExerciseMatches(library, query, language);
        assert.equal(ranked.length, count, `"${query}" (${language}) found ${ranked.length}, expected ${count}`);
        assert.deepEqual(
          ranked.slice(0, 3).map((item) => item.name),
          top3,
          `"${query}" (${language}) top results changed`,
        );
      }
    },
  },
];
