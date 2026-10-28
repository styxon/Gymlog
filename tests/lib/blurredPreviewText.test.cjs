const assert = require('node:assert/strict');

const {
  charsPerLine,
  layoutBlurredLines,
  splitIntoLines,
} = require('../../src/lib/blurredPreviewText');

module.exports = [
  {
    name: 'wraps on whole words and never mid-word',
    run() {
      const lines = splitIntoLines('penkkipunnerrus ei ole liikkunut kuuteen treeniin', 20);
      assert.deepEqual(lines, ['penkkipunnerrus ei', 'ole liikkunut', 'kuuteen treeniin']);
      lines.forEach((line) => assert.ok(line.length <= 20, `line too long: ${line}`));
    },
  },
  {
    name: 'hard-breaks a single word that cannot fit, rather than overflowing',
    run() {
      assert.deepEqual(splitIntoLines('penkkipunnerrus', 6), ['penkki', 'punner', 'rus']);
    },
  },
  {
    name: 'a long word after normal text starts its own line',
    run() {
      assert.deepEqual(splitIntoLines('ok penkkipunnerrus', 6), ['ok', 'penkki', 'punner', 'rus']);
    },
  },
  {
    name: 'collapses whitespace and returns nothing for an empty string',
    run() {
      assert.deepEqual(splitIntoLines('  a   b  ', 10), ['a b']);
      assert.deepEqual(splitIntoLines('', 10), []);
      assert.deepEqual(splitIntoLines('   ', 10), []);
    },
  },
  {
    name: 'a nonsense line limit still returns usable output',
    run() {
      assert.deepEqual(splitIntoLines('ab cd', 0), ['a', 'b', 'c', 'd']);
    },
  },
  {
    name: 'characters per line grows with width and shrinks with font size',
    run() {
      const wide = charsPerLine(300, 14);
      const narrow = charsPerLine(150, 14);
      const bigger = charsPerLine(300, 20);
      assert.ok(wide > narrow);
      assert.ok(wide > bigger);
      assert.equal(charsPerLine(0, 14), 1);
      assert.equal(charsPerLine(300, 0), 1);
    },
  },
  {
    name: 'the block never renders more lines than it is tall enough to hold',
    run() {
      const text = 'yksi kaksi kolme neljä viisi kuusi seitsemän kahdeksan yhdeksän kymmenen';
      const lines = layoutBlurredLines({
        text,
        widthPx: 120,
        fontSize: 14,
        lineHeight: 20,
        heightPx: 45,
      });
      assert.equal(lines.length, 2);
    },
  },
  {
    name: 'a block taller than the text keeps every line',
    run() {
      const lines = layoutBlurredLines({
        text: 'yksi kaksi',
        widthPx: 300,
        fontSize: 14,
        lineHeight: 20,
        heightPx: 400,
      });
      assert.deepEqual(lines, ['yksi kaksi']);
    },
  },
];
