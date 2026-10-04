const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'screens', 'StartPathScreen.tsx'),
  'utf8',
);

/**
 * The front door offers three answers, and all three are the same kind of
 * thing.
 *
 * "Start empty" was a dashed note under the two cards: a different shape, and
 * a different rule — it fired the moment it was touched, while the two cards
 * above it waited for Continue. One screen, two affordances that looked
 * unrelated and behaved differently (user 2026-09-08).
 */

module.exports = [
  {
    name: 'all three start paths are the same card, answered by the same button',
    run() {
      // Three cards, one component. A second component here is how the shapes
      // drifted apart the first time.
      assert.equal((source.match(/<PathCard/g) ?? []).length, 3);
      assert.doesNotMatch(source, /styles\.emptyRow/, 'the dashed note is back');
      assert.doesNotMatch(source, /emptyTitle|emptyBody/, 'the note kept its own text styles');

      // Each card selects; none of them acts on touch.
      for (const path of ['build', 'ready', 'empty']) {
        assert.match(
          source,
          new RegExp(`selected=\\{selected === '${path}'\\}[\\s\\S]{0,200}?onPress=\\{\\(\\) => setSelected\\('${path}'\\)\\}`),
          `the ${path} card does something other than select`,
        );
      }

      // And Continue is what acts, for all three.
      const cta = source.slice(source.indexOf('onPress={() => {'), source.indexOf('styles.cta,'));
      assert.match(cta, /if \(selected === 'build'\)[\s\S]{0,80}onGuidedOnboarding\(\)/);
      assert.match(cta, /if \(selected === 'empty'\)[\s\S]{0,400}onStartEmpty\?\.\(\)/);
      assert.match(cta, /onBrowsePrograms\(\)/);
    },
  },
  {
    name: 'the empty card is only offered when the screen was given somewhere to go',
    run() {
      // The prop is optional, and a card that selects a path nothing can carry
      // out would leave Continue doing nothing at all.
      assert.match(
        source,
        /\{onStartEmpty \? \(\s*\r?\n\s*<PathCard\s*\r?\n\s*icon="blank"/,
        'the empty card must be rendered behind the same condition that makes it work',
      );
    },
  },
  {
    name: 'the third card has its own glyph rather than borrowing one',
    run() {
      // Two cards wearing the same icon is the catalog-cover bug in miniature:
      // colour and shape are read before a word is.
      assert.match(source, /name: 'sparkle' \| 'grid' \| 'blank'/);
      assert.match(source, /icon: 'sparkle' \| 'grid' \| 'blank';/);
      assert.match(source, /\{name === 'blank' \? \(/);
      for (const icon of ['sparkle', 'grid', 'blank']) {
        assert.equal(
          (source.match(new RegExp(`icon="${icon}"`, 'g')) ?? []).length,
          1,
          `${icon} is on more than one card`,
        );
      }
    },
  },
];
