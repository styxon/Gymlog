const assert = require('node:assert/strict');

const { splitCsvRecords, collapseCellWhitespace } = require('../../src/lib/csvRecords');

/**
 * The one record boundary both CSV importers share: a line break outside an
 * open quote. csvProgramImport.test.cjs and hevyImport.test.cjs each prove
 * this at the importer level (a real row/workout survives); this suite proves
 * the shared primitive itself, including the shape that has no importer of
 * its own yet — a tab-delimited file with a wrapped cell.
 */
module.exports = [
  {
    name: 'splitCsvRecords: a quoted line break stays inside its record',
    run() {
      const text = 'Day,Exercise,Sets,Reps\nDay 1,"Bench\nPress",4,6-10\nDay 2,Back Squat,4,5';
      const { records, unterminatedQuoteRow } = splitCsvRecords(text, ',');
      assert.equal(records.length, 3, 'the wrapped cell must not add a phantom record');
      assert.equal(records[1], 'Day 1,"Bench\nPress",4,6-10');
      assert.equal(unterminatedQuoteRow, null);
    },
  },
  {
    name: 'splitCsvRecords: an unquoted quote does not swallow the rest of the file',
    run() {
      // A stray inch mark ("6\" box jump") must not flip the scanner into
      // "inside quotes" for every record after it.
      const text = 'A,B\nNotes: 6" box,1\nRow two,2';
      const { records, unterminatedQuoteRow } = splitCsvRecords(text, ',');
      assert.deepEqual(records, ['A,B', 'Notes: 6" box,1', 'Row two,2']);
      assert.equal(unterminatedQuoteRow, null);
    },
  },
  {
    name: 'splitCsvRecords: CRLF, bare CR and bare LF all end a record once',
    run() {
      assert.deepEqual(splitCsvRecords('a,1\r\nb,2', ',').records, ['a,1', 'b,2']);
      assert.deepEqual(splitCsvRecords('a,1\rb,2', ',').records, ['a,1', 'b,2']);
      assert.deepEqual(splitCsvRecords('a,1\nb,2', ',').records, ['a,1', 'b,2']);
    },
  },
  {
    name: 'splitCsvRecords: a space before a quoted field still lets the quote open',
    run() {
      const text = 'a, "line one\nline two",1';
      const { records } = splitCsvRecords(text, ',');
      assert.equal(records.length, 1, 'the leading space must not stop the quote from opening');
    },
  },
  {
    name: 'splitCsvRecords: works with the semicolon and tab delimiters the importers detect',
    run() {
      assert.deepEqual(splitCsvRecords('a;"x\ny";1\nb;z;2', ';').records, ['a;"x\ny";1', 'b;z;2']);
      assert.deepEqual(splitCsvRecords('a\t"x\ny"\t1\nb\tz\t2', '\t').records, ['a\t"x\ny"\t1', 'b\tz\t2']);
    },
  },
  {
    // The #228 regression: an opening quote with no matching close used to
    // stay "inside quotes" to EOF, joining every following line into one
    // record — the importers then lost every row after it (recheck round
    // 2026-09-29).
    name: 'splitCsvRecords: an unterminated quote is confined to its own record, not the rest of the file',
    run() {
      const lines = ['Day,Exercise,Sets,Reps'];
      lines.push('Day 1,"Unclosed note,4,6-10'); // row 2: stray opening quote, never closed
      for (let day = 2; day <= 19; day += 1) {
        lines.push(`Day ${day},Back Squat,4,5`);
      }
      const text = lines.join('\n');
      const { records, unterminatedQuoteRow } = splitCsvRecords(text, ',');

      assert.equal(unterminatedQuoteRow, 2, 'names the row where the unclosed quote opens');
      assert.equal(records.length, 20, 'every row, including the broken one, survives as one record each');
      assert.equal(records[1], 'Day 1,"Unclosed note,4,6-10', 'the offending row keeps its own raw text');
      // Rows 3-20 (indices 2-19, "Day 2"-"Day 19") are untouched by the
      // earlier failure.
      for (let index = 2; index < 20; index += 1) {
        assert.equal(records[index], `Day ${index},Back Squat,4,5`);
      }
    },
  },
  {
    // Recovery only fires when the scanner is still "inside quotes" at true
    // EOF — which, by construction, means no quote character of any kind
    // appears anywhere after the stray one (the very next quote, wherever it
    // is, always closes the runaway state, whether it "meant" to or not).
    // A file whose ONLY quoting problem is this one stray, unterminated
    // quote therefore still parses every other quoted cell normally, exactly
    // as the pre-existing "a quoted line break stays inside its record" case
    // above proves for a file with no stray quote at all.
    name: 'splitCsvRecords: recovery leaves ordinary quote handling alone when nothing is actually broken',
    run() {
      const text = 'Day,Exercise,Sets,Reps\nDay 1,"Bench\nPress",4,6-10\nDay 2,Back Squat,4,5';
      const { records, unterminatedQuoteRow } = splitCsvRecords(text, ',');
      assert.equal(unterminatedQuoteRow, null);
      assert.equal(records.length, 3);
      assert.equal(records[1], 'Day 1,"Bench\nPress",4,6-10');
    },
  },
  {
    // Recheck round 2026-09-29: recovery used to re-slice from the START of
    // the record and take only its first raw line as the "recovered" row.
    // When the record holds a legitimate, properly-closed multi-line quoted
    // field BEFORE the later stray quote, that first raw line break is the
    // field's own embedded newline, not the trouble spot — cutting there
    // split one logical row into two garbled records and shifted every
    // later row's number by one.
    name: 'splitCsvRecords: recovery finds the actual unterminated quote, not the earlier field\'s embedded line break',
    run() {
      const text = [
        'Day,Exercise,Notes,Sets,Reps',
        'Day 1,"Bench\nPress","Unclosed note here,4,5',
        'Day 2,Squat,Fine,4,5',
        'Day 3,Deadlift,Fine,4,5',
      ].join('\n');
      const { records, unterminatedQuoteRow } = splitCsvRecords(text, ',');

      assert.equal(unterminatedQuoteRow, 2, 'names the row the stray quote is actually in');
      assert.equal(records.length, 4, 'one logical row recovers as one record, not two');
      assert.equal(
        records[1],
        'Day 1,"Bench\nPress","Unclosed note here,4,5',
        'the earlier legitimate quoted field survives inside the recovered record',
      );
      // Rows 3 and 4 are untouched — no row-number shift from the recovery.
      assert.equal(records[2], 'Day 2,Squat,Fine,4,5');
      assert.equal(records[3], 'Day 3,Deadlift,Fine,4,5');
    },
  },
  {
    name: 'collapseCellWhitespace: a wrapped cell is one name, not two lines of one',
    run() {
      assert.equal(collapseCellWhitespace('Bench\nPress'), 'Bench Press');
      assert.equal(collapseCellWhitespace('  Back   Squat  '), 'Back Squat');
      assert.equal(collapseCellWhitespace('Row\r\nTwo'), 'Row Two');
      assert.equal(collapseCellWhitespace(''), '');
    },
  },
];
