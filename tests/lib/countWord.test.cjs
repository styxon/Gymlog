const assert = require('node:assert/strict');

const { countWord } = require('../../src/lib/countWord');

module.exports = [
  {
    name: 'countWord: small counts are words at the start of a headline, the rest are numerals',
    run() {
      assert.equal(countWord(5, 'en'), 'Five');
      assert.equal(countWord(5, 'fi'), 'Viisi');
      assert.equal(countWord(1, 'fi'), 'Yksi');
      assert.equal(countWord(10, 'en'), 'Ten');
      assert.equal(countWord(11, 'en'), '11');
      assert.equal(countWord(0, 'en'), 'Zero');
      assert.equal(countWord(2.5, 'en'), '2.5');
      assert.equal(countWord(-1, 'fi'), '-1');
      // Mid-sentence the word stays lower-case; a numeral is a numeral either way.
      assert.equal(countWord(5, 'en', 'inline'), 'five');
      assert.equal(countWord(5, 'fi', 'inline'), 'viisi');
      assert.equal(countWord(11, 'fi', 'inline'), '11');
    },
  },
];
