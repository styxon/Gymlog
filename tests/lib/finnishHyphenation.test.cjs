const assert = require('node:assert/strict');

const {
  SOFT_HYPHEN,
  hyphenateFinnish,
  hyphenateFinnishWord,
} = require('../../src/lib/finnishHyphenation');

const stripSoftHyphens = (text) => text.split(SOFT_HYPHEN).join('');

/**
 * Where a long Finnish exercise name may break (device, 2026-09-16: the day
 * screen read "lantionno / stopito", broken wherever the column ran out).
 */

const shown = (text) => hyphenateFinnish(text).split(SOFT_HYPHEN).join('-');

module.exports = [
  {
    name: 'finnish hyphenation: compounds break on their syllables',
    run() {
      assert.equal(shown('Lantionnostopito'), 'Lan-ti-on-nos-to-pi-to');
      assert.equal(shown('Yhden jalan lantionnosto'), 'Yhden jalan lan-ti-on-nos-to');
      assert.equal(shown('Askelnousu'), 'As-kel-nou-su');
      assert.equal(shown('Penkkipunnerrus'), 'Penk-ki-pun-ner-rus');
      assert.equal(shown('Kuolleenpainonnosto'), 'Kuol-leen-pai-non-nos-to');
      // Two vowels that are not a diphthong split; a diphthong does not.
      assert.equal(shown('Bulgarialainen'), 'Bul-ga-ri-a-lai-nen');
      assert.equal(shown('Hiihtoasento'), 'Hiih-to-a-sen-to');
      // Long vowels stay together.
      assert.equal(shown('Vaakapunnerrus'), 'Vaa-ka-pun-ner-rus');
      // ie / uo / yö are diphthongs in the first syllable.
      assert.equal(shown('Ruohonleikkuu'), 'Ruo-hon-leik-kuu');
    },
  },
  {
    name: 'finnish hyphenation: no break leaves a single letter, and short words are left alone',
    run() {
      // "O-jen-ta-ja" is the textbook split, but a lone letter at a line end
      // reads worse than no break at all.
      assert.equal(shown('Ojentajapunnerrus'), 'Ojen-ta-ja-pun-ner-rus');
      assert.equal(hyphenateFinnishWord('Kyykky'), 'Kyykky');
      assert.equal(hyphenateFinnishWord('Tieto'), 'Tieto');
      // Anything that is not a run of letters is untouched.
      assert.equal(shown('Lantionnosto (tanko) 3×10'), 'Lan-ti-on-nos-to (tanko) 3×10');
      assert.equal(shown('Push-up'), 'Push-up');
      assert.equal(hyphenateFinnish(''), '');
    },
  },
  {
    name: 'finnish hyphenation: the marks come off again without a trace',
    run() {
      const names = ['Lantionnostopito', 'Bulgarialainen askelkyykky', 'Bench Press', 'Maastaveto'];
      for (const name of names) {
        assert.equal(stripSoftHyphens(hyphenateFinnish(name)), name);
      }
      // Idempotent enough to be safe on a name that already carries marks.
      const once = hyphenateFinnish('Lantionnostopito');
      assert.equal(stripSoftHyphens(hyphenateFinnish(stripSoftHyphens(once))), 'Lantionnostopito');
    },
  },
  {
    name: 'finnish hyphenation: the day screen shows every name whole, broken on its syllables',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgramDayScreen.tsx'),
        'utf8',
      );
      const name = screen.slice(screen.indexOf('No numbered tile, and no line limit'), screen.indexOf('styles.roleTag'));
      // Broken where Finnish breaks, and only for Finnish text.
      // The shown name is the short one (KP, KK — 2026-09-27); read aloud in full.
      assert.match(name, /\{language === 'fi' \? hyphenateFinnish\(shown\) : shown\}/);
      assert.match(name, /accessibilityLabel=\{name\}/);
      assert.match(name, /android_hyphenationFrequency="normal"/);
      // Read aloud without the marks.
      assert.match(name, /accessibilityLabel=\{name\}/);
      // No line limit — a clipped name is the thing being fixed.
      assert.doesNotMatch(name, /numberOfLines/);
      // And the numbered tile that took the width is gone.
      assert.doesNotMatch(screen, /styles\.exerciseNum/);
    },
  },
];
