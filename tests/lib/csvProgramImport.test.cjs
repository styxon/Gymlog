const assert = require('node:assert/strict');

const { parseCsvProgram, buildDraftFromCsvPreview } = require('../../.test-dist/lib/csvProgramImport.js');

const LIBRARY = [
  { id: 'lib_bench', name: 'Bench Press' },
  { id: 'lib_incline_db', name: 'Incline Dumbbell Press' },
  { id: 'lib_row', name: 'Barbell Row' },
  { id: 'lib_pulldown', name: 'Lat Pulldown' },
  { id: 'lib_squat', name: 'Back Squat' },
  { id: 'lib_rdl', name: 'Romanian Deadlift' },
];

const SAMPLE = [
  'Day,Exercise,Sets,Reps',
  'Day 1,Bench Press,4,6-10',
  'Day 1,incline dumbbell press,3,8–12',
  'Day 2,Barbell Row,4,6-10',
  'Day 2,Lat Pulldown,3,10',
  'Day 3,Back Squat,4,5',
  'Day 3,Romanian Deadlift,3,8-10',
].join('\n');

module.exports = [
  {
    name: 'csv import parses lenient headers, delimiters, and rep formats',
    run() {
      const preview = parseCsvProgram(SAMPLE, LIBRARY);
      assert.equal(preview.errors.length, 0);
      assert.equal(preview.rows.length, 6);
      assert.equal(preview.matchedCount, 6);
      assert.equal(preview.unmatchedCount, 0);
      assert.equal(preview.dayCount, 3);
      assert.equal(preview.rows[1].matchedName, 'Incline Dumbbell Press');
      assert.equal(preview.rows[1].repMin, 8);
      assert.equal(preview.rows[1].repMax, 12);
      assert.equal(preview.rows[4].repMin, 5);
      assert.equal(preview.rows[4].repMax, 5);

      const semicolon = parseCsvProgram('DAY;EXERCISE;SETS;REPS\nPush;Bench Press;4;6-10', LIBRARY);
      assert.equal(semicolon.rows.length, 1);
      assert.equal(semicolon.rows[0].libraryItemId, 'lib_bench');
    },
  },
  {
    name: 'csv import detects the delimiter past a leading blank line',
    run() {
      // A pasted/uploaded CSV can start with a blank line (or one that is only
      // whitespace) before the header. Delimiter detection must still look at
      // the first non-blank line, not the literal first raw line, or a
      // semicolon file falls back to the comma default and every header cell
      // fails to match (#bugs).
      const leadingBlank = parseCsvProgram(
        '\nDay;Exercise;Sets;Reps\nDay 1;Bench Press;4;6-10',
        LIBRARY,
      );
      assert.equal(leadingBlank.errors.length, 0);
      assert.equal(leadingBlank.rows.length, 1);
      assert.equal(leadingBlank.rows[0].libraryItemId, 'lib_bench');

      const leadingWhitespaceLine = parseCsvProgram(
        '   \nDay;Exercise;Sets;Reps\nDay 1;Bench Press;4;6-10',
        LIBRARY,
      );
      assert.equal(leadingWhitespaceLine.errors.length, 0);
      assert.equal(leadingWhitespaceLine.rows.length, 1);
      assert.equal(leadingWhitespaceLine.rows[0].libraryItemId, 'lib_bench');
    },
  },
  {
    name: 'csv import matches spacing variants and flags near-misses with a suggestion',
    run() {
      const preview = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nDay 1,Romanian Dead Lift,3,8-10\nDay 1,DB Incline Press,3,10\nDay 1,Benchpress Machine XYZ,3,10',
        LIBRARY,
      );
      assert.equal(preview.rows.length, 3);
      // Spacing variant matches outright.
      assert.equal(preview.rows[0].matchedName, 'Romanian Deadlift');
      // Near-miss stays unmatched but carries a suggestion.
      assert.equal(preview.rows[1].matchedName, null);
      assert.equal(preview.rows[1].suggestion, 'Incline Dumbbell Press');
      // Noise stays unmatched with no suggestion.
      assert.equal(preview.rows[2].matchedName, null);
      assert.equal(preview.rows[2].suggestion, null);
      assert.equal(preview.unmatchedCount, 2);
    },
  },
  {
    name: 'csv import reports row-level errors without dropping valid rows',
    run() {
      const preview = parseCsvProgram('Day,Exercise,Sets,Reps\nDay 1,Bench Press,four,10\nDay 1,Back Squat,4,heavy\nDay 2,Barbell Row,4,6-10', LIBRARY);
      assert.equal(preview.rows.length, 1);
      assert.equal(preview.errors.length, 2);
      assert.equal(preview.rows[0].matchedName, 'Barbell Row');

      const badHeader = parseCsvProgram('Foo,Bar\n1,2', LIBRARY);
      assert.equal(badHeader.rows.length, 0);
      assert.match(badHeader.errors[0], /Day, Exercise, Sets and Reps/);
    },
  },
  {
    name: 'csv import builds a draft grouped by day, skipping unmatched rows',
    run() {
      const preview = parseCsvProgram(`${SAMPLE}\nDay 3,Mystery Movement,3,10`, LIBRARY);
      const draft = buildDraftFromCsvPreview(preview, 'Imported plan');
      assert.equal(draft.name, 'Imported plan');
      assert.equal(draft.sessions.length, 3);
      assert.deepEqual(draft.sessions.map((session) => session.name), ['Day 1', 'Day 2', 'Day 3']);
      assert.equal(draft.sessions[0].exercises.length, 2);
      assert.equal(draft.sessions[2].exercises.length, 2);
      assert.equal(draft.sessions[0].exercises[0].name, 'Bench Press');
      assert.equal(draft.sessions[0].exercises[0].targetSets, 4);
      assert.equal(draft.sessions[0].exercises[0].repMin, 6);
      assert.equal(draft.sessions[0].exercises[0].repMax, 10);
      assert.equal(draft.sessions[0].exercises[0].libraryItemId, 'lib_bench');
    },
  },
  {
    name: 'csv import caps a programme at 7 days, with a clear error, so title/chips/rhythm agree',
    run() {
      const lines = ['Day,Exercise,Sets,Reps'];
      for (let day = 1; day <= 8; day += 1) {
        lines.push(`Day ${day},Bench Press,4,6-10`);
      }
      const preview = parseCsvProgram(lines.join('\n'), LIBRARY);

      // Only 7 distinct days survive — the same cap ProgramDetailScreen's
      // week chips and rhythm editor enforce (getTrainingDayIndexes).
      assert.equal(preview.dayCount, 7);
      assert.equal(preview.rows.length, 7);
      assert.equal(preview.rows.every((row) => row.day !== 'Day 8'), true);
      assert.equal(preview.errors.some((error) => error.includes('Day 8')), true);

      const draft = buildDraftFromCsvPreview(preview, 'Eight day plan');
      assert.equal(draft.sessions.length, 7);
    },
  },
  {
    name: 'csv import errors are written in the reader\'s language',
    run() {
      // They are shown as they are; until 2026-09-26 every one was English.
      assert.deepEqual(parseCsvProgram('', LIBRARY, [], 'fi').errors, ['Tiedosto on tyhjä.']);
      assert.match(parseCsvProgram('Foo,Bar\n1,2', LIBRARY, [], 'fi').errors[0], /^Ensimmäisellä rivillä/);
      const rows = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nDay 1,,4,10\nDay 1,Bench Press,four,10\nDay 1,Back Squat,4,heavy',
        LIBRARY,
        [],
        'fi',
      );
      assert.deepEqual(rows.errors, [
        'Rivi 2: päivä tai liikkeen nimi puuttuu.',
        'Rivi 3: sarjojen pitää olla kokonaisluku, vähintään 1.',
        'Rivi 4: toistojen pitää olla luku tai väli, esim. 6-10.',
      ]);
      const lines = ['Day,Exercise,Sets,Reps'];
      for (let day = 1; day <= 8; day += 1) {
        lines.push(`Päivä ${day},Bench Press,4,6-10`);
      }
      assert.deepEqual(parseCsvProgram(lines.join('\n'), LIBRARY, [], 'fi').errors, [
        'Rivi 9: "Päivä 8" jätettiin pois. Ohjelmassa voi olla enintään 7 treenipäivää.',
      ]);

      // And the sheet passes its language in.
      const sheet = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', '..', 'src', 'components', 'NewProgramSheet.tsx'),
        'utf8',
      );
      assert.match(sheet, /parseCsvProgram\(csvText, exerciseLibrary, nameBook, language\)/);
    },
  },
  {
    name: 'csv import: a quoted cell with a line break keeps its row, and errors name the reader\'s actual rows',
    run() {
      // An Excel cell wrapped with Alt+Enter, quoted as CSV requires. Splitting
      // on every raw line break tore this into two lines — the exercise name
      // vanished into "Bench" and a phantom extra row appeared — and every
      // error after it pointed at a row number one too high (#bugs).
      const csv = [
        'Day,Exercise,Sets,Reps',
        'Day 1,"Bench\nPress",4,6-10',
        'Day 1,Back Squat,four,10',
      ].join('\n');
      const preview = parseCsvProgram(csv, LIBRARY);

      // Only the row with the bad set count is an error — not two rows split
      // out of the wrapped cell.
      assert.equal(preview.errors.length, 1);
      // Row 3: header is row 1, the wrapped cell is row 2 (one record, not
      // two), so Back Squat is genuinely the reader's third row.
      assert.match(preview.errors[0], /^Row 3:/);

      assert.equal(preview.rows.length, 1, 'the wrapped-cell row must survive as one row');
      // The embedded line break is collapsed, not left in the name.
      assert.equal(preview.rows[0].exerciseName, 'Bench Press');
      assert.equal(preview.rows[0].matchedName, 'Bench Press');
    },
  },
  {
    name: 'csv import: a generic name ambiguous across the library is left for the reader, not silently guessed',
    run() {
      // "Deadlift" is a whole-word substring of every one of these, and
      // picking whichever came first used to hand back a specific variant the
      // reader never typed (#bugs).
      const DEADLIFTS = [
        { id: 'ex_axle', name: 'Axle Deadlift' },
        { id: 'ex_rdl', name: 'Romanian Deadlift' },
        { id: 'ex_sumo', name: 'Sumo Deadlift' },
      ];
      const ambiguous = parseCsvProgram('Day,Exercise,Sets,Reps\nDay 1,Deadlift,4,5', DEADLIFTS);
      assert.equal(ambiguous.rows[0].matchedName, null);
      assert.equal(ambiguous.unmatchedCount, 1);
      // Left unmatched exactly the way any other near-miss is: with a
      // suggestion to pick from or correct, never silently substituted.
      assert.notEqual(ambiguous.rows[0].suggestion, null);

      // One entry containing the term is a guess too: offered, not taken.
      // "Cable Row" was the only name inside "Upright Cable Row" (bug hunt,
      // 2026-10-07).
      const NARROW = [{ id: 'ex_ohp', name: 'Overhead Press' }];
      const single = parseCsvProgram('Day,Exercise,Sets,Reps\nDay 1,Press,3,5', NARROW);
      assert.equal(single.rows[0].matchedName, null);
      assert.equal(single.rows[0].libraryItemId, null);
      assert.equal(single.rows[0].suggestion, 'Overhead Press');

      // Whole words, not merely a run of the same letters: "Pull Up" is not
      // "Pull Ups" ("up" inside "ups" is not "up").
      const PLURAL_ONLY = [{ id: 'ex_wpu', name: 'Weighted Pull Ups' }];
      const plural = parseCsvProgram('Day,Exercise,Sets,Reps\nDay 1,Pull Up,3,5', PLURAL_ONLY);
      assert.equal(plural.rows[0].matchedName, null);
    },
  },
  {
    name: 'a name written the way the app shows it, in Finnish, is the lift it names',
    run() {
      // #bugs 2026-09-29: a photo of the app's own programme came back as
      // four rows, 0 recognised, though every name was the app's own label.
      const library = [
        { id: 'lib_cable_row', name: 'Seated Cable Row' },
        { id: 'lib_kneeling_row', name: 'Kneeling Single-Arm High Pulley Row' },
        { id: 'lib_curl', name: 'Barbell Curl' },
        { id: 'lib_reverse_curl', name: 'Reverse Cable Curl' },
      ];
      const csv = [
        'Day,Exercise,Sets,Reps',
        'Päivä 1,Istuen taljasoutu,3,10',
        'Päivä 1,Polvillaan yhden käden soutu ylätaljasta,3,12',
        'Päivä 1,hauiskääntö  TANGOLLA,3,8',
        'Päivä 1,Käänteinen hauiskääntö taljassa,3,12',
      ].join('\n');
      const preview = parseCsvProgram(csv, library, [], 'fi');
      assert.equal(preview.matchedCount, 4);
      assert.deepEqual(
        preview.rows.map((row) => row.libraryItemId),
        ['lib_cable_row', 'lib_kneeling_row', 'lib_curl', 'lib_reverse_curl'],
      );
      assert.equal(preview.rows[0].matchedName, 'Seated Cable Row', 'stored under the English id, shown through the label');
    },
  },
  {
    name: 'a Finnish label shared by two different lifts in the real library resolves to the right one',
    run() {
      // Muscle Snatch was labelled Voimatempaus, Power Snatch's name, and
      // came first in the table: a written "Voimatempaus" would have imported
      // as the wrong lift, silently (review of the 2026-09-29 fix).
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const library = GENERATED_EXERCISE_LIBRARY.map((item) => ({ id: item.id, name: item.name }));
      const preview = parseCsvProgram('Day,Exercise,Sets,Reps\nPäivä 1,Voimatempaus,5,3', library, [], 'fi');
      assert.equal(preview.rows[0].matchedName, 'Power Snatch');
    },
  },
  {
    name: "a library name written out exactly is never read as another lift's label",
    run() {
      // "Machine Chest Press" is the plain label the app shows for Leverage
      // Chest Press. A library with a Machine Chest Press of its own keeps it.
      const library = [
        { id: 'lib_leverage', name: 'Leverage Chest Press' },
        { id: 'lib_machine', name: 'Machine Chest Press' },
      ];
      const csv = 'Day,Exercise,Sets,Reps\nDay 1,Machine Chest Press,3,10';
      assert.equal(parseCsvProgram(csv, library).rows[0].libraryItemId, 'lib_machine');
      assert.equal(
        parseCsvProgram(csv, [library[0]]).rows[0].libraryItemId,
        'lib_leverage',
        'with no such entry, the label finds the lift it names',
      );
    },
  },
  {
    // The #228 regression: an opening quote with no matching close used to
    // stay "inside quotes" to EOF, joining every row after it into one
    // record — the whole rest of the programme silently vanished (recheck
    // round 2026-09-29).
    name: 'csv import: an unterminated quote in one row does not lose the rows after it',
    run() {
      const lines = ['Day,Exercise,Sets,Reps'];
      lines.push('Day 1,"Unclosed note,4,6-10'); // row 2: stray opening quote, never closed
      // All on the same day — this proves rows survive the earlier break, not
      // the (separately tested) 7-day cap.
      for (let row = 2; row <= 19; row += 1) {
        lines.push('Day 1,Back Squat,4,5');
      }
      const preview = parseCsvProgram(lines.join('\n'), LIBRARY);

      // Rows 3-20 (the 18 Back Squat rows) all survive and match.
      const squats = preview.rows.filter((row) => row.exerciseName === 'Back Squat');
      assert.equal(squats.length, 18, 'rows 3-20 must all survive the earlier broken row');
      assert.ok(squats.every((row) => row.matchedName === 'Back Squat'));

      // The broken row itself is named, not silently swallowed.
      assert.ok(
        preview.errors.some((error) => /^Row 2:/.test(error)),
        `expected an error naming row 2, got: ${JSON.stringify(preview.errors)}`,
      );
    },
  },
  {
    // Recovery only fires when the file's ONLY quoting problem leaves the
    // scanner "inside quotes" all the way to true EOF (splitCsvRecords.test
    // explains why that means no other quote character exists later in the
    // file). A file whose quoting is otherwise fine keeps parsing its
    // legitimately quoted multi-line cell exactly as
    // "a quoted cell with a line break keeps its row" above already proves.
    name: 'csv import: recovery leaves an ordinary quoted multi-line cell alone when nothing is actually broken',
    run() {
      const csv = [
        'Day,Exercise,Sets,Reps',
        'Day 1,"Bench\nPress",4,6-10',
        'Day 2,Back Squat,4,5',
      ].join('\n');
      const preview = parseCsvProgram(csv, LIBRARY);
      assert.equal(preview.errors.length, 0);
      const bench = preview.rows.find((row) => row.exerciseName === 'Bench Press');
      assert.ok(bench, 'the wrapped cell still parses as one row');
      assert.equal(bench.matchedName, 'Bench Press');
    },
  },
  {
    // Recheck round 2026-09-29: a row that combines a legitimate wrapped
    // cell with a LATER stray, never-closed quote used to be split into two
    // garbled records, dropping the row itself from preview.rows and
    // shifting every following row's reported number by one.
    name: 'csv import: a row with both a legitimate wrapped cell and a later stray quote breaks only that row',
    run() {
      const csv = [
        'Day,Exercise,Notes,Sets,Reps',
        'Day 1,"Bench\nPress","Unclosed note here,4,5',
        'Day 2,Squat,Fine,4,5',
        'Day 3,Deadlift,Fine,4,5',
      ].join('\n');
      const library = [
        { id: 'lib_bench', name: 'Bench Press' },
        { id: 'lib_squat', name: 'Squat' },
        { id: 'lib_deadlift', name: 'Deadlift' },
      ];
      const preview = parseCsvProgram(csv, library);

      // Rows 2 and 3 in the FILE are "Day 2,Squat" and "Day 3,Deadlift" —
      // they must survive with their own physical row numbers, not shifted.
      const squat = preview.rows.find((row) => row.exerciseName === 'Squat');
      const deadlift = preview.rows.find((row) => row.exerciseName === 'Deadlift');
      assert.ok(squat, 'the Squat row must survive');
      assert.ok(deadlift, 'the Deadlift row must survive');
      assert.equal(squat.matchedName, 'Squat');
      assert.equal(deadlift.matchedName, 'Deadlift');
      assert.equal(
        preview.errors.some((error) => /^Row 3:/.test(error)),
        false,
        `no error should be misnumbered onto row 3 (the Squat row), got: ${JSON.stringify(preview.errors)}`,
      );
      assert.ok(
        preview.errors.some((error) => /^Row 2:/.test(error)),
        `expected the broken row to be named as row 2, got: ${JSON.stringify(preview.errors)}`,
      );
    },
  },
  {
    // Recheck round 2026-09-29: the unclosedQuote error was pushed onto
    // `errors` before the header check, but the header-failure branch used
    // to return a brand-new `errors` array, silently discarding it — in
    // exactly the case the surrounding comment says it should survive.
    name: 'csv import: an unusable header does not discard the unclosed-quote error that was already found',
    run() {
      const csv = [
        'Day,Exercise,Sets', // missing the required Reps column
        'Day 1,"Unclosed note,4',
        'Day 2,Squat,4',
      ].join('\n');
      const preview = parseCsvProgram(csv, []);
      assert.ok(
        preview.errors.some((error) => /never closed/i.test(error) || /lainausmerkki/i.test(error)),
        `the unclosed-quote error must still reach the caller, got: ${JSON.stringify(preview.errors)}`,
      );
      assert.ok(
        preview.errors.some((error) => error === 'The first row must name the columns Day, Exercise, Sets and Reps.'),
        `the header error must also be present, got: ${JSON.stringify(preview.errors)}`,
      );
    },
  },
  {
    // Recheck round 2026-09-29: `unterminatedQuoteRow` is 1-based into the
    // UNFILTERED `split.records`, but every other row-numbered error used
    // `index + 1` into `lines` AFTER blank lines were filtered out. A blank
    // line at or before the offending row desynced the two, so the same
    // physical row got two different numbers in two different errors.
    name: 'csv import: a leading blank line does not desync the unclosed-quote row number from other row errors',
    run() {
      const csv = [
        '   ', // row 1: leading blank line
        'Day,Exercise,Sets,Reps', // row 2: header
        'Day 1,"Unclosed note,,', // row 3: stray unclosed quote, also missing sets/reps
        'Day 1,Back Squat,4,5', // row 4
      ].join('\n');
      const library = [{ id: 'lib_squat', name: 'Back Squat' }];
      const preview = parseCsvProgram(csv, library);

      const rowNumbers = preview.errors.map((error) => {
        const match = error.match(/^Row (\d+):/);
        return match ? Number(match[1]) : null;
      });
      assert.ok(rowNumbers.every((row) => row === 3), `both errors must name row 3, got: ${JSON.stringify(preview.errors)}`);
    },
  },
  {
    name: 'a role tag in the day column is not a day',
    run() {
      // #bugs 2026-09-29: every row of a photographed programme had TUKI as
      // its day, and the import made a day called TUKI.
      const library = [
        { id: 'lib_curl', name: 'Barbell Curl' },
        { id: 'lib_row', name: 'Barbell Row' },
      ];
      const tagged = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nTUKI,Barbell Curl,3,8\nankkuri,Barbell Row,3,8',
        library,
        [],
        'fi',
      );
      assert.deepEqual(tagged.rows.map((row) => row.day), ['Päivä 1', 'Päivä 1']);
      assert.equal(tagged.dayCount, 1);
      assert.deepEqual(tagged.errors, []);

      const mixed = parseCsvProgram('Day,Exercise,Sets,Reps\nPush,Barbell Row,3,8\nSUPPORT,Barbell Curl,3,8', library);
      assert.deepEqual(mixed.rows.map((row) => row.day), ['Push', 'Push'], 'a tagged row keeps the day above it');

      assert.equal(parseCsvProgram('Day,Exercise,Sets,Reps\nExtra,Barbell Curl,3,8', library).rows[0].day, 'Day 1');

      // A day that merely contains the word is still a day.
      const named = parseCsvProgram('Day,Exercise,Sets,Reps\nTuki ja liikkuvuus,Barbell Curl,3,8', library, [], 'fi');
      assert.equal(named.rows[0].day, 'Tuki ja liikkuvuus');
    },
  },
  {
    name: 'CSV import: a set count past the editor ceiling is a row to fix, not a programme of 100 000 sets (bug hunt 2026-10-05)',
    run() {
      const text = ['Day,Exercise,Sets,Reps', 'Day 1,Bench Press,100000,8', 'Day 1,Barbell Row,12,8', 'Day 1,Back Squat,13,5'].join('\n');
      const fi = parseCsvProgram(text, LIBRARY, [], 'fi');
      assert.deepEqual(fi.rows.map((row) => [row.exerciseName, row.sets]), [['Barbell Row', 12]]);
      assert.deepEqual(fi.errors, ['Rivi 2: enintään 12 sarjaa.', 'Rivi 4: enintään 12 sarjaa.']);
      const en = parseCsvProgram(text, LIBRARY, [], 'en');
      assert.equal(en.errors[0], 'Row 2: at most 12 sets.');
    },
  },
  {
    // Sets were capped on 2026-10-05; reps went through at any size (M12, 2026-10-06).
    name: 'CSV import: a rep count past any sane prescription is a row to fix, and the big numbers the ready catalog ships still import',
    run() {
      const text = [
        'Day,Exercise,Sets,Reps',
        'Day 1,Bench Press,3,100000',
        'Day 1,Barbell Row,3,8-100000',
        'Day 1,Back Squat,3,500',
        'Day 1,Lat Pulldown,3,501',
        'Day 1,Plank,3,600',
        'Day 1,Plank,3,601',
        'Day 1,Plank,3,30-60',
      ].join('\n');
      const en = parseCsvProgram(text, LIBRARY, [], 'en');
      assert.deepEqual(
        en.rows.map((row) => [row.exerciseName, row.repMin, row.repMax]),
        [['Back Squat', 500, 500], ['Plank', 600, 600], ['Plank', 30, 60]],
      );
      assert.deepEqual(en.errors, [
        'Row 2: at most 500 reps (seconds, for a hold).',
        'Row 3: at most 500 reps (seconds, for a hold).',
        'Row 5: at most 500 reps (seconds, for a hold).',
        'Row 7: at most 600 reps (seconds, for a hold).',
      ]);
      // A hold written by its Finnish name is a hold too (review, 2026-10-06).
      const finnishHold = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nDay 1,Lankku,3,540',
        [...LIBRARY, { id: 'lib_plank', name: 'Plank' }],
        [],
        'fi',
      );
      assert.deepEqual(finnishHold.errors, []);
      assert.equal(finnishHold.rows[0].repMax, 540);
      const fi = parseCsvProgram('Day,Exercise,Sets,Reps\nDay 1,Bench Press,3,100000', LIBRARY, [], 'fi');
      assert.deepEqual(fi.errors, ['Rivi 2: enintään 500 toistoa (pitoliikkeessä sekuntia).']);
      assert.equal(fi.rows.length, 0);

      // What the app ships must survive an export and an import: the 500 m
      // row and the 300 s hold are in the ready catalog.
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const preview = parseCsvProgram(
              `Day,Exercise,Sets,Reps\nD,${exercise.exerciseName.replace(/,/g, ' ')},${exercise.sets},${exercise.repsMin}-${exercise.repsMax}`,
              [],
              [],
              'en',
            );
            if (preview.errors.some((error) => /at most \d+ reps/.test(error))) {
              assert.fail(`${template.id}: ${exercise.exerciseName} ${exercise.repsMin}-${exercise.repsMax} is refused by the importer`);
            }
          }
        }
      }
    },
  },
  {
    name: 'csv import: a name only contained in one library name is offered, never linked as that lift (bug hunt 2026-10-07)',
    run() {
      const library = seedLibrary();
      const parse = (name) => parseCsvProgram(`Day,Exercise,Sets,Reps\nA,"${name}",3,10`, library).rows[0];

      // Each was linked, confidently, to the one library name it contains —
      // the row's photo, history and swaps followed a different lift. In the
      // generated library alone, with no row of their own to be filed under,
      // they are offered for the reader to confirm.
      const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
      const generated = GENERATED_EXERCISE_LIBRARY.map((item) => ({
        id: item.id,
        name: item.name,
        sourceCategory: item.sourceCategory,
      }));
      for (const [written, offered] of [
        ['Plank Jack', 'Plank'],
        ['Air Bike (30s sprint)', 'Air Bike'],
        ['Single-Leg Romanian Deadlift', 'Romanian Deadlift'],
      ]) {
        const row = parseCsvProgram(`Day,Exercise,Sets,Reps\nA,"${written}",3,10`, generated).rows[0];
        assert.equal(row.matchedName, null, `${written} is a guess, left for the reader`);
        assert.equal(row.libraryItemId, null, written);
        assert.equal(row.suggestion, offered, written);
      }

      // The alias table the player files names under answers first: a cable
      // row is the seated one, not "Upright Cable Row"; a fan bike sprint is
      // not the ab exercise "Air Bike"; the one-leg RDL is not the two-leg lift.
      for (const [written, filed] of [
        ['Cable Row', 'Seated Cable Rows'],
        ['Bent-Over Row', 'Bent Over Barbell Row'],
        ['Reverse Lunge', 'Dumbbell Rear Lunge'],
        ['Air Bike (30s sprint)', 'Bike HIIT'],
        ['Single-Leg Romanian Deadlift', 'Single-Leg RDL'],
      ]) {
        assert.equal(parse(written).matchedName, filed, written);
      }

      // Singular and plural are the same lift, written either way — the alias
      // table knows some, and the rest are folded.
      assert.equal(parse('Leg Extension').matchedName, 'Leg Extensions');
      assert.equal(parse('Seated Cable Row').libraryItemId, 'free_seated_cable_rows');
      const plurals = [
        { id: 'lib_sled', name: 'Prowler Sled Pushes' },
        { id: 'lib_yoke', name: 'Yoke Walk Carries' },
        { id: 'lib_curl', name: 'Banded Curl' },
      ];
      const folded = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nA,Prowler Sled Push,3,10\nA,Yoke Walk Carry,3,10\nA,Banded Curls,3,10',
        plurals,
      );
      assert.deepEqual(
        folded.rows.map((row) => [row.libraryItemId, row.suggestion]),
        [['lib_sled', null], ['lib_yoke', null], ['lib_curl', null]],
      );
    },
  },
  {
    name: "csv import: the app's own programme names come back as the lift the player files them under",
    run() {
      const { findFiledLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const library = seedLibrary();
      const names = library.map((entry) => entry.name);
      const written = new Set();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            written.add(exercise.exerciseName);
          }
        }
      }
      const wrong = [];
      for (const name of written) {
        const filed = findFiledLibraryIndex(name, names);
        if (filed === null) {
          continue;
        }
        const quoted = `"${name.replace(/"/g, '""')}"`;
        const row = parseCsvProgram(`Day,Exercise,Sets,Reps\nA,${quoted},3,10`, library).rows[0];
        if (row.libraryItemId !== library[filed].id) {
          wrong.push(`${name} => ${row.matchedName} (filed under ${library[filed].name})`);
        }
      }
      assert.deepEqual(wrong, []);
    },
  },
  {
    name: 'csv import: a multi-set minutes row gets a rest, and a hold written in minutes stays a hold in seconds',
    run() {
      const library = [
        { id: 'lib_plank', name: 'Plank' },
        { id: 'lib_run', name: 'Easy Run Blocks' },
        { id: 'lib_stair', name: 'Stairmaster' },
      ];
      const preview = parseCsvProgram(
        'Day,Exercise,Sets,Reps\nA,Plank,3,1 min\nA,Plank,3,1-2 min\nA,Easy Run Blocks,4,5 min\nA,Stairmaster,1,20 min',
        library,
      );
      assert.deepEqual(preview.errors, []);
      assert.deepEqual(
        preview.rows.map((row) => [row.exerciseName, row.repMin, row.repMax, row.minutes === true]),
        [
          ['Plank', 60, 60, false],
          ['Plank', 60, 120, false],
          ['Easy Run Blocks', 5, 5, true],
          ['Stairmaster', 20, 20, true],
        ],
      );
      const [plank, plankRange, run, stair] = buildDraftFromCsvPreview(preview, 'Imported').sessions[0].exercises;
      assert.equal(plank.trackingMode, undefined, 'a hold is not switched to minutes');
      assert.equal(plank.restSeconds, 90);
      assert.equal(plankRange.repMax, 120);
      assert.equal(run.trackingMode, 'duration_minutes');
      assert.equal(stair.restSeconds, 0, 'one steady bout still has no rest');

      // Four blocks of running get the rest the ready catalogue gives its own
      // multi-set minutes blocks, not 0.
      const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const blocks = WORKOUT_TEMPLATES_V1.flatMap((template) =>
        template.sessions.flatMap((session) =>
          session.exercises.filter((exercise) => exercise.trackingMode === 'duration_minutes' && exercise.sets > 1),
        ),
      );
      assert.ok(blocks.length > 0);
      const low = Math.min(...blocks.map((exercise) => exercise.restSecondsMin));
      const high = Math.max(...blocks.map((exercise) => exercise.restSecondsMax));
      assert.ok(low > 0);
      assert.ok(run.restSeconds >= low && run.restSeconds <= high, `rest ${run.restSeconds} outside ${low}-${high}`);
    },
  },
];

function seedLibrary() {
  const { createSeedExerciseLibrary } = require('../../.test-dist/data/seed.js');
  return createSeedExerciseLibrary().map((item) => ({ id: item.id, name: item.name, sourceCategory: item.sourceCategory }));
}
