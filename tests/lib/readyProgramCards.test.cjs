const assert = require('node:assert/strict');

/**
 * The catalog card every ready program shows: a name, one line, three chips.
 *
 * Written after 43 of the 57 programs turned out to have no card of their own.
 * Nothing was broken — `getReadyTemplatePresentation` has a fallback, and the
 * fallback is what made the omission invisible: it takes the template's internal
 * name (English) and the program's whole description paragraph, so those cards
 * were three times the height of the others and their chips were guessed from
 * the data rather than chosen.
 *
 * That is what this file makes impossible to repeat. A new ready program with
 * no card fails here rather than shipping a card that looks almost right.
 */
const { getReadyTemplatePresentation } = require('../../src/lib/templatePresentation');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
const { t } = require('../../src/lib/i18n');

const LANGUAGES = ['en', 'fi'];
/**
 * A card's line has to fit under a title in a two-column grid. The longest one
 * written by hand is 78 characters; a paragraph starts at about twice that, and
 * that is the failure this number is aimed at.
 */
const SUBTITLE_LIMIT = 100;

module.exports = [
  {
    name: 'cards: every ready program has a card of its own, in both languages',
    run() {
      const missing = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const language of LANGUAGES) {
          const key = `prog.sub.${template.id}`;
          // The dictionary returns the key itself when nothing is written for
          // it, which is exactly the state this test exists to catch.
          if (t(language, key) === key) {
            missing.push(`${language}: ${template.id}`);
          }
        }
      }
      assert.deepEqual(missing, [], `programs with no card line: ${missing.join(', ')}`);
    },
  },
  {
    name: 'cards: the line is a line, not the description paragraph',
    run() {
      const tooLong = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const language of LANGUAGES) {
          const { subtitle } = getReadyTemplatePresentation(template, language);
          assert.ok(subtitle.length > 0, `${template.id} (${language}) has an empty line`);
          if (subtitle.length > SUBTITLE_LIMIT) {
            tooLong.push(`${language}: ${template.id} (${subtitle.length})`);
          }
        }
      }
      assert.deepEqual(tooLong, [], `card lines that read as paragraphs: ${tooLong.join(', ')}`);
    },
  },
  {
    name: 'cards: three chips, and the last one is the day count',
    run() {
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const language of LANGUAGES) {
          const { tags } = getReadyTemplatePresentation(template, language);
          // Two chosen chips plus the days chip. A third chosen one would push
          // the day count off the card, because the row holds three.
          assert.equal(tags.length, 3, `${template.id} (${language}) shows ${tags.length} chips`);
          assert.ok(
            tags[2].includes(String(template.daysPerWeek)),
            `${template.id} (${language}) does not end on its day count: ${tags.join(' / ')}`,
          );
          for (const tag of tags) {
            // An unresolved key arrives as the key. Chips are three words at
            // most, so a dotted string is never legitimate copy.
            assert.ok(!tag.startsWith('prog.'), `${template.id} (${language}) shows a raw key: ${tag}`);
          }
        }
      }
    },
  },
  {
    name: 'cards: one day reads as one day',
    run() {
      // English pluralises the chip, and the single-session focus workouts are
      // the only programs in the catalog that run for one day — they read
      // "1 Days" without a singular of their own.
      const singleDay = WORKOUT_TEMPLATES_V1.filter((template) => template.daysPerWeek === 1);
      assert.ok(singleDay.length > 0, 'no single-day program left to check');
      for (const template of singleDay) {
        assert.equal(getReadyTemplatePresentation(template, 'en').tags[2], '1 Day');
        assert.equal(getReadyTemplatePresentation(template, 'fi').tags[2], '1 pv');
      }
    },
  },
  {
    name: 'cards: the name is the program name, untouched',
    run() {
      // The family names (HUGE, STRONG, FIT…) are the product's own and are not
      // translated. Curating a program must not quietly rename it either: the
      // card carries the same name in both languages.
      for (const template of WORKOUT_TEMPLATES_V1) {
        const english = getReadyTemplatePresentation(template, 'en').title;
        const finnish = getReadyTemplatePresentation(template, 'fi').title;
        assert.equal(english, finnish, `${template.id} is named differently per language`);
        assert.ok(english.length > 0, `${template.id} has no name`);
      }
    },
  },
];
