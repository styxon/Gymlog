const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildSwapLibraryMatches, buildSwapShortlist, movementHead } = require('../../.test-dist/lib/swapShortlist.js');
const { buildSwapOptionsForSlot } = require('../../.test-dist/lib/tailoringFit.js');

// Line endings normalised: a Windows checkout is CRLF, and the App.tsx anchor
// below spans a line break.
const read = (relative) =>
  fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8').split('\r\n').join('\n');

module.exports = [
  {
    name: 'shortlist: the hip thrust pool becomes a choice instead of a catalogue',
    run() {
      // Nine options, all of them some hip thrust or glute bridge, ranked
      // together — so the machine version could sit fourth behind three
      // bridges, and the actions under the list fell off the sheet
      // (user 2026-08-26).
      const options = buildSwapOptionsForSlot('hip_thrust_bridge', 'Barbell Hip Thrust', null);
      assert.ok(options.length >= 8, `the pool itself is still large: ${options.length}`);

      const shortlist = buildSwapShortlist('Barbell Hip Thrust', options);
      assert.ok(shortlist.total <= options.length);
      assert.ok(shortlist.variations.length <= 3);
      assert.ok(shortlist.related.length <= 3);
      assert.ok(shortlist.variations.length + shortlist.related.length <= 6, 'six rows at the very most');

      // Same movement, different kit.
      for (const option of shortlist.variations) {
        assert.match(option.exerciseName, /Hip Thrust/i, `${option.exerciseName} is not a hip thrust`);
      }
      // Same area, different movement.
      for (const option of shortlist.related) {
        assert.doesNotMatch(option.exerciseName, /Hip Thrust/i);
      }
      // The one the reader went looking for is in the half where they would
      // look for it.
      assert.ok(
        shortlist.variations.some((option) => option.exerciseName === 'Machine Hip Thrust'),
        shortlist.variations.map((option) => option.exerciseName).join(', '),
      );
    },
  },
  {
    name: 'shortlist: the head is the movement, and the qualifiers are the kit',
    run() {
      assert.equal(movementHead('Barbell Hip Thrust'), 'hip thrust');
      assert.equal(movementHead('Machine Hip Thrust'), 'hip thrust');
      assert.equal(movementHead('Single-Leg Hip Thrust'), 'hip thrust');
      assert.equal(movementHead('Hip Thrust (Bodyweight or Light Bar)'), 'hip thrust');
      // A different movement stays different, however similar the area.
      assert.equal(movementHead('Glute Bridge Hold'), 'glute bridge hold');
      assert.notEqual(movementHead('Banded Glute Bridge'), movementHead('Banded Hip Thrust'));
    },
  },
  {
    name: 'shortlist: the same lift written two ways is one row',
    run() {
      // The pool carries both spellings because the catalogs were imported
      // separately; two rows that do the same thing is not a choice.
      const shortlist = buildSwapShortlist('Barbell Hip Thrust', [
        { exerciseName: 'Glute Bridge (Banded)', reason: null, score: 5 },
        { exerciseName: 'Banded Glute Bridge', reason: null, score: 4 },
        { exerciseName: 'Glute Bridge Hold', reason: null, score: 3 },
      ]);
      assert.deepEqual(
        shortlist.related.map((option) => option.exerciseName),
        // First wins, so the tailoring pass's ranking picks the spelling.
        ['Glute Bridge (Banded)', 'Glute Bridge Hold'],
      );
      // A word the others do not have makes it a different lift, not a respelling.
      assert.equal(shortlist.total, 2);
    },
  },
  {
    name: 'shortlist: a lift the session already holds is not offered as a change',
    run() {
      // The pool offered "taljapotku" for a slot in a session that already had
      // taljapotku two rows down (#bugs 2026-08-26). Swapping to it means doing
      // the same exercise twice and calling it a change.
      const options = [
        { exerciseName: 'Cable Kickback', reason: null, score: 5 },
        { exerciseName: 'Frog Pump', reason: null, score: 4 },
      ];
      const shortlist = buildSwapShortlist('Barbell Hip Thrust', options, {
        // Matched on identity, so the other spelling counts too.
        alreadyInSession: ['Kickback Cable'],
      });
      const names = [...shortlist.variations, ...shortlist.related].map((o) => o.exerciseName);
      assert.deepEqual(names, ['Frog Pump']);
    },
  },
  {
    name: 'shortlist: search reaches past the six rows, in the language the reader types',
    run() {
      // The shortlist is deliberately short and the pool behind it is not. A
      // reader who knows what they want should not have to be offered it.
      const options = [
        { exerciseName: 'Cable Kickback', searchLabel: 'Taljapotku', reason: null, score: 5 },
        { exerciseName: 'Frog Pump', searchLabel: 'Sammakkopumppu', reason: null, score: 4 },
      ];
      const byFinnish = buildSwapShortlist('Barbell Hip Thrust', options, { query: 'talja' });
      assert.deepEqual(byFinnish.related.map((o) => o.exerciseName), ['Cable Kickback']);
      // The English name still matches, since that is what the pool stores.
      const byEnglish = buildSwapShortlist('Barbell Hip Thrust', options, { query: 'frog' });
      assert.deepEqual(byEnglish.related.map((o) => o.exerciseName), ['Frog Pump']);
      // An empty query changes nothing.
      assert.equal(buildSwapShortlist('Barbell Hip Thrust', options, { query: '  ' }).total, 2);
    },
  },
  {
    name: 'shortlist: a movement with no siblings still offers a full list',
    run() {
      // Cutting related lifts to three when there are no variations to pair
      // them with would hide choices for the sake of symmetry.
      const options = [
        { exerciseName: 'Romanian Deadlift', reason: null, score: 5 },
        { exerciseName: 'Trap Bar Deadlift', reason: null, score: 4 },
        { exerciseName: 'Hip Thrust', reason: null, score: 3 },
        { exerciseName: 'Cable Pull-Through', reason: null, score: 2 },
        { exerciseName: 'Single-Leg RDL', reason: null, score: 1 },
      ];
      const shortlist = buildSwapShortlist('Good Morning', options);
      assert.equal(shortlist.variations.length, 0);
      assert.equal(shortlist.related.length, 5);
      // Ranking is left exactly as the tailoring pass made it — re-sorting here
      // would be a second opinion competing with the one that weighs equipment
      // and joints.
      assert.deepEqual(
        shortlist.related.map((option) => option.exerciseName),
        options.map((option) => option.exerciseName),
      );
    },
  },
  {
    name: 'sheets: the list scrolls under a ceiling so the actions stay reachable',
    run() {
      const home = read('src/screens/HomeScreen.tsx');
      const day = read('src/screens/ProgramDayScreen.tsx');

      // With nine rows the sheet grew past the screen and "Poista ohjelmasta"
      // could not be pressed at all. The ceiling lives on the kit's shell now
      // (a sheet never takes the whole screen) plus the sheet's own capped
      // scroller — the actions scroll WITH the list, reachable at its end.
      // Home's swap is the picker sheet (2026-10-07): its actions are the
      // list's footer, so they scroll with the cards and land at the end.
      assert.match(home, /listFooter=\{\s*<View style=\{styles\.swapActions\}>/);
      assert.match(read('src/components/AddExerciseSheet.tsx'), /\{listFooter\}/);
      assert.match(home, /buildSwapShortlist\(/);
      assert.match(read('src/components/sheetKit.tsx'), /maxHeight: '86%'/);
      for (const source of [day]) {
        assert.match(source, /buildSwapShortlist\(/);
        // Headings only when both halves exist: one heading over the whole
        // list labels nothing.
        assert.match(source, /shortlist\.variations\.length[\s\S]{0,80}shortlist\.related\.length/);
      }
    },
  },
  {
    name: 'sheets: the two answers are told apart by colour, and by the right two colours',
    run() {
      const home = read('src/screens/HomeScreen.tsx');
      const day = read('src/screens/ProgramDayScreen.tsx');
      // Orange is the app's "you can press this"; red is the one that does not
      // come back. Using theme tokens, never literals — the app has two themes.
      assert.match(home, /adaptDropTextToday: \{ color: theme\.highlight \}/);
      assert.match(home, /adaptDropTextRemove: \{ color: theme\.danger \}/);
      assert.match(day, /styles\.swapRemoveText, \{ color: theme\.danger \}/);
      for (const source of [home, day]) {
        assert.doesNotMatch(source, /color: '#(?:ff0000|f00)'/i, 'a literal red would ignore the dark theme');
      }
    },
  },
  {
    /**
     * The swap search reaches the whole library, on Home as well.
     *
     * "haluisin penkkipunnerruksen tähän mutta sitä ei saa" (#bugs
     * 2026-09-23): Home's swap sheet searched only the slot's substitution
     * group, so a lift from another area could not be named at all. The
     * programme day had been fixed for the same report a month earlier, in its
     * own copy of the code, and Home never got it.
     */
    name: 'swap search: a typed name reaches the whole library, best answer first',
    run() {
      const { GENERATED_EXERCISE_LIBRARY: library } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const { getPopularExerciseLibraryOrder } = require('../../.test-dist/lib/exerciseSuggestions.js');
      const popularOrder = getPopularExerciseLibraryOrder(library);

      // Nothing typed, nothing added: the shortlist is the answer.
      assert.deepEqual(buildSwapLibraryMatches(library, '   ', 'fi', { popularOrder }), []);

      // The report's own case: a row being swapped, "penkki" typed.
      const matches = buildSwapLibraryMatches(library, 'penkki', 'fi', {
        exclude: ['Seated Cable Rows'],
        popularOrder,
      });
      assert.equal(matches[0]?.name, 'Barbell Bench Press - Medium Grip', 'the bench press is not the first answer');
      assert.ok(matches.length <= 12, 'the list is a search result, not the library');

      // What is already on screen or in the session is not offered twice —
      // matched on identity, so the other spelling of it is left out too.
      const excluded = buildSwapLibraryMatches(library, 'penkki', 'fi', {
        exclude: ['medium grip bench press - barbell'],
        popularOrder,
      });
      assert.ok(!excluded.some((item) => item.name === 'Barbell Bench Press - Medium Grip'));

      // English works too: the library is English underneath.
      assert.equal(
        buildSwapLibraryMatches(library, 'bench press', 'en', { popularOrder })[0]?.name,
        'Barbell Bench Press - Medium Grip',
      );
    },
  },
  {
    // Both swap sheets draw the library section, and both are handed a
    // library to draw it from. Anchored on the <HomeScreen …/> element in
    // the shell: the prop name appears all over it, and a guard that counted
    // it anywhere would pass without Home ever receiving it. The element moved
    // from App.tsx to src/app/renderHomeDashboard.tsx (phase C), so it is
    // looked up in whichever ONE shell file renders it, and its prop and
    // closing lines are matched at the element's own indentation, whatever
    // that is.
    name: 'swap search: Home and the programme day both search the library',
    run() {
      const shellFiles = [
        'App.tsx',
        ...fs
          .readdirSync(path.join(__dirname, '../..', 'src', 'app'))
          .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
          .sort()
          .map((name) => `src/app/${name}`),
      ];
      const opening = /<HomeScreen\s/g;
      const renderers = shellFiles.map(read).filter((source) => (source.match(opening) || []).length > 0);
      assert.equal(renderers.length, 1, 'HomeScreen is no longer rendered from exactly one shell file — recheck by hand');
      const app = renderers[0];
      assert.equal((app.match(opening) || []).length, 1, 'HomeScreen is rendered twice — recheck by hand');
      const homeAt = app.search(/<HomeScreen\s/);
      const indent = app.slice(app.lastIndexOf('\n', homeAt) + 1, homeAt);
      assert.match(indent, /^[ \t]*$/, 'the HomeScreen element does not open its own line — recheck by hand');
      const homeEnd = app.indexOf(`\n${indent}/>`, homeAt);
      assert.ok(homeEnd > homeAt, 'the HomeScreen element was restructured — recheck by hand');
      assert.ok(
        app.slice(homeAt, homeEnd).includes(`\n${indent}  exerciseLibrary={exerciseBrowserItems}`),
        'Home is not handed the library',
      );

      // Home lists the library under its cards through the player's list
      // (2026-10-07), which a query searches whole.
      assert.match(
        read('src/screens/HomeScreen.tsx'),
        /buildSwapPickerLibrary\(exerciseLibrary, \{\s*query: swapQuery,/,
        'Home does not search the library',
      );
      for (const screen of ['src/screens/ProgramDayScreen.tsx']) {
        const source = read(screen);
        assert.match(source, /buildSwapLibraryMatches\(exerciseLibrary, swapQuery, language,/, `${screen} does not search the library`);
        assert.match(source, /'home\.swapSheet\.library'/, `${screen} does not draw the library section`);
        assert.match(source, /'home\.swapSheet\.noMatches'/, `${screen} says nothing when nothing matches`);
      }
    },
  },
];
