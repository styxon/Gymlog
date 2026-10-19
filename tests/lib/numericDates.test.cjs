const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formatDayMonthNumeric, formatDateNumeric } = require('../../.test-dist/lib/format.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/**
 * Dates in figures, in the reader's language.
 *
 * Found on the English store screenshots (2026-09-14): the weight chart's axis
 * read "19.7. 28.7." and the records list "12/9/2026" — the first Finnish, the
 * second day-first, which an en-US reader takes for December 9th. The app's
 * English locale is en-US (`localeFor`), and the session analysis already wrote
 * its bars "9/14".
 */
module.exports = [
  {
    name: 'numericDates: Finnish day first with dots, English month first with slashes',
    run() {
      const september12 = new Date(2026, 8, 12, 18, 0);
      assert.equal(formatDayMonthNumeric(september12, 'fi'), '12.9.');
      assert.equal(formatDayMonthNumeric(september12, 'en'), '9/12');
      assert.equal(formatDateNumeric(september12, 'fi'), '12.9.2026');
      assert.equal(formatDateNumeric(september12, 'en'), '9/12/2026');
      // No zero padding in either, matching what Finnish always printed.
      assert.equal(formatDateNumeric(new Date(2026, 0, 5), 'en'), '1/5/2026');
    },
  },
  {
    name: 'numericDates: the set log sheet goes through the shared formatter (Records uses formatListDate since 2026-10-19)',
    run() {
      for (const file of [['src', 'components', 'SetLogSheet.tsx']]) {
        const source = read(...file).replace(/\r\n/g, '\n');
        const start = source.indexOf('function formatDay(');
        assert.notEqual(start, -1, `${file.join('/')}: formatDay missing`);
        const body = source.slice(start, source.indexOf('\n}\n', start));
        assert.match(body, /return formatDateNumeric\(date, language\);/, `${file.join('/')} uses formatDateNumeric`);
        assert.doesNotMatch(body, /getMonth\(\) \+ 1/, `${file.join('/')} builds no date by hand`);
      }
    },
  },
];
