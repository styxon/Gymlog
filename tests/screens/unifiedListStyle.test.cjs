const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/**
 * The unified list style (owner, 2026-10-19): a list is one rounded card, a
 * row is a ListRow, the label is the shared SectionLabel.
 */
const LIST_SCREENS = [
  ['src', 'screens', 'HistoryScreen.tsx'],
  ['src', 'screens', 'RecordsScreen.tsx'],
];

module.exports = [
  {
    name: 'unifiedListStyle: list screens carry no hardcoded light-only hairline',
    run() {
      for (const file of LIST_SCREENS) {
        assert.doesNotMatch(read(...file), /#EEEAF7/i, `${file.join('/')} hardcodes the light hairline`);
      }
    },
  },
  {
    name: 'unifiedListStyle: Records renders no fresh badge and no purple row border',
    run() {
      const source = read('src', 'screens', 'RecordsScreen.tsx');
      assert.doesNotMatch(source, /freshTag|rowFresh|pr\.new|record\.fresh\s*&&/);
      assert.doesNotMatch(source, /formatDateNumeric/);
      assert.match(source, /splitLastSessionRecords/);
      assert.match(source, /pr\.lastSession/);
    },
  },
  {
    name: 'unifiedListStyle: History uses the shared label, rows and header, with no subtitle or stripe',
    run() {
      const source = read('src', 'screens', 'HistoryScreen.tsx');
      assert.doesNotMatch(source, /function SectionLabel/);
      assert.doesNotMatch(source, /history\.subtitle|sessionFeelStripe/);
      assert.match(source, /<PageHeader/);
      assert.match(source, /<ListCard>/);
      assert.match(source, /metaDot=/);
      assert.match(source, /formatListDate\(/);
    },
  },
  {
    name: 'unifiedListStyle: the shared card is rounded 18, hairlined and clipped',
    run() {
      const source = read('src', 'components', 'ListCard.tsx');
      assert.match(source, /borderRadius: 18/);
      assert.match(source, /overflow: 'hidden'/);
      assert.match(source, /minHeight: 56/);
      assert.doesNotMatch(source, /CutSurface/);
      const back = read('src', 'components', 'BackButton.tsx');
      assert.match(back, /width: 40/);
      assert.match(back, /borderRadius: 999/);
      assert.match(back, /theme\.surfaceSoft/);
    },
  },
];
