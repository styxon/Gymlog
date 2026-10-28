const assert = require('node:assert/strict');

const {
  normalizeAlias,
  lookupNameBook,
  rememberName,
  countKnownNames,
} = require('../../src/lib/exerciseNameBook');
const { parseCsvProgram } = require('../../src/lib/csvProgramImport');

/**
 * The reader's own names for lifts.
 *
 * The library is 873 English names; the reader writes alatalja, viparit, RDL
 * KP, pecdec. Fuzzy matching cannot reach those — there is nothing to be fuzzy
 * about — so the app is told once and remembers.
 */

const LIBRARY = [
  { id: 'ex_row', name: 'Seated Cable Row' },
  { id: 'ex_pulldown', name: 'Lat Pulldown' },
  { id: 'ex_rdl', name: 'Romanian Deadlift' },
  { id: 'ex_bench', name: 'Barbell Bench Press' },
];

const at = (iso) => new Date(iso);

module.exports = [
  {
    name: 'name book: one spelling, however it is punctuated',
    run() {
      // The same reader writes their own name three ways across one sheet.
      assert.equal(normalizeAlias('RDL KP'), 'rdl kp');
      assert.equal(normalizeAlias('rdl-kp'), 'rdl kp');
      assert.equal(normalizeAlias('  RDL   KP  '), 'rdl kp');
      // Letters outside ASCII are letters, not punctuation. Stripping them
      // would collapse distinct Finnish names into one key — and reduce a
      // name written entirely in another script to nothing at all.
      assert.equal(normalizeAlias('vipunostot'), 'vipunostot');
      assert.equal(normalizeAlias('Takareiden makuulta'), 'takareiden makuulta');
      assert.notEqual(normalizeAlias('säärikäännöt'), normalizeAlias('saarikaannot'));
      assert.equal(normalizeAlias('   '), '');
      assert.equal(normalizeAlias('!!!'), '');
    },
  },
  {
    name: 'name book: teaching once answers every spelling of it',
    run() {
      let book = [];
      book = rememberName(book, 'alatalja', { name: 'Seated Cable Row', libraryItemId: 'ex_row' }, at('2026-08-24T10:00:00.000Z'));

      assert.equal(lookupNameBook(book, 'alatalja')?.exerciseName, 'Seated Cable Row');
      assert.equal(lookupNameBook(book, 'ALATALJA')?.exerciseName, 'Seated Cable Row');
      assert.equal(lookupNameBook(book, '  Alatalja ')?.exerciseName, 'Seated Cable Row');
      assert.equal(lookupNameBook(book, 'ylätalja'), null, 'a different name is a different name');

      // The reader's own spelling is kept for showing back; the key is not.
      assert.equal(book[0].wrote, 'alatalja');
      assert.equal(book[0].alias, 'alatalja');
      assert.equal(book[0].libraryItemId, 'ex_row');
      assert.equal(book[0].learnedAt, '2026-08-24T10:00:00.000Z');
    },
  },
  {
    name: 'name book: correcting a name replaces the answer, never doubles it',
    run() {
      let book = [];
      book = rememberName(book, 'alatalja', { name: 'Lat Pulldown', libraryItemId: 'ex_pulldown' });
      book = rememberName(book, 'ALATALJA', { name: 'Seated Cable Row', libraryItemId: 'ex_row' });

      // Two entries for one key would make the lookup depend on insertion
      // order — the corrected answer is the answer.
      assert.equal(book.length, 1);
      assert.equal(lookupNameBook(book, 'alatalja')?.exerciseName, 'Seated Cable Row');
    },
  },
  {
    name: 'name book: the newest teaching comes first',
    run() {
      let book = [];
      book = rememberName(book, 'penkki', { name: 'Barbell Bench Press', libraryItemId: 'ex_bench' });
      book = rememberName(book, 'alatalja', { name: 'Seated Cable Row', libraryItemId: 'ex_row' });
      // Most recently taught first: cheapest to find, and the right order for
      // showing the book back to the reader.
      assert.deepEqual(book.map((entry) => entry.wrote), ['alatalja', 'penkki']);
    },
  },
  {
    name: 'name book: an empty or nameless teaching is refused',
    run() {
      const book = [];
      assert.deepEqual(rememberName(book, '   ', { name: 'Seated Cable Row', libraryItemId: 'ex_row' }), []);
      assert.deepEqual(rememberName(book, 'alatalja', { name: '  ', libraryItemId: 'ex_row' }), []);
      assert.equal(lookupNameBook(book, ''), null);
    },
  },
  {
    name: 'name book: the import recognises taught names, and says it did',
    run() {
      const csv = [
        'Day,Exercise,Sets,Reps',
        'Ma,alatalja,3,8-10',
        'Ma,Barbell Bench Press,4,5',
      ].join('\n');

      // Untaught, the reader's own word is simply unmatched — this is the
      // state the feature exists to fix.
      const cold = parseCsvProgram(csv, LIBRARY);
      assert.equal(cold.rows[0].matchedName, null);
      assert.equal(cold.rows[0].viaNameBook, false);
      assert.equal(cold.unmatchedCount, 1);

      // Taught once, the same sheet imports clean.
      const book = rememberName([], 'alatalja', { name: 'Seated Cable Row', libraryItemId: 'ex_row' });
      const warm = parseCsvProgram(csv, LIBRARY, book);
      assert.equal(warm.rows[0].matchedName, 'Seated Cable Row');
      assert.equal(warm.rows[0].libraryItemId, 'ex_row');
      assert.equal(warm.rows[0].viaNameBook, true, 'remembering is not the same as guessing');
      assert.equal(warm.unmatchedCount, 0);
      // A name the library already knows is still matched the ordinary way.
      assert.equal(warm.rows[1].viaNameBook, false);
    },
  },
  {
    name: 'name book: a taught name beats a fuzzy guess',
    run() {
      // Reordered words overlap every token, which the matcher reports as a
      // SUGGESTION rather than a match — it will not adopt a name it only
      // half-recognises. Left alone, the row still imports as nothing.
      const csv = ['Day,Exercise,Sets,Reps', 'Ti,Cable Row Seated,3,10'].join('\n');
      const guessed = parseCsvProgram(csv, LIBRARY);
      assert.equal(guessed.rows[0].matchedName, null);
      assert.equal(guessed.rows[0].suggestion, 'Seated Cable Row');

      // Taught, it is an answer — and the reader's answer wins even when it
      // contradicts what the guess would have proposed. Being told outranks
      // being clever, or the teaching would be pointless.
      const book = rememberName([], 'Cable Row Seated', { name: 'Romanian Deadlift', libraryItemId: 'ex_rdl' });
      const taught = parseCsvProgram(csv, LIBRARY, book);
      assert.equal(taught.rows[0].matchedName, 'Romanian Deadlift');
      assert.equal(taught.rows[0].suggestion, null);
      assert.equal(taught.rows[0].viaNameBook, true);
    },
  },
  {
    name: 'name book: counts distinct spellings it can answer, not occurrences',
    run() {
      let book = [];
      book = rememberName(book, 'alatalja', { name: 'Seated Cable Row', libraryItemId: 'ex_row' });
      book = rememberName(book, 'viparit', { name: 'Lat Pulldown', libraryItemId: 'ex_pulldown' });

      // "alatalja" appears on three days; it was taught once and counts once.
      assert.equal(
        countKnownNames(book, ['alatalja', 'ALATALJA', 'alatalja', 'viparit', 'pecdec']),
        2,
      );
      assert.equal(countKnownNames([], ['alatalja']), 0);
      assert.equal(countKnownNames(book, []), 0);
    },
  },
];
