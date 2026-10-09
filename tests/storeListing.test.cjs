const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.test-dist');

/**
 * The Play listing in docs/store-listing.md is pasted into Play Console by
 * hand. Each field sits under a `<!-- field:<lang>.<name> -->` marker, so the
 * limits and the numbers in it can be checked here instead of in the Console
 * form, which only counts characters.
 */
function readFields() {
  const doc = fs.readFileSync(path.join(root, 'docs/store-listing.md'), 'utf8').replace(/\r\n/g, '\n');
  const fields = {};
  const marker = /<!-- field:([a-z]{2})\.(title|short|full) -->\n```text\n([\s\S]*?)\n```/g;
  let match;
  while ((match = marker.exec(doc))) {
    fields[`${match[1]}.${match[2]}`] = match[3];
  }
  return fields;
}

const LIMITS = { title: 30, short: 80, full: 4000 };
const LANGS = ['fi', 'en'];

module.exports = [
  {
    name: 'store listing: every field exists in both languages and fits Play\'s limits',
    run() {
      const fields = readFields();
      for (const lang of LANGS) {
        for (const [name, limit] of Object.entries(LIMITS)) {
          const text = fields[`${lang}.${name}`];
          assert.ok(text, `docs/store-listing.md has no ${lang}.${name} field`);
          // Play counts characters, not UTF-16 units; "ä" is one.
          const length = [...text].length;
          assert.ok(length <= limit, `${lang}.${name} is ${length} characters, Play allows ${limit}`);
        }
        assert.ok(!fields[`${lang}.full`].includes(fields[`${lang}.short`]),
          `${lang}: Google asks that the short description is not repeated in the full one`);
      }
    },
  },
  {
    name: 'store listing: title and short description carry no price, deal or ranking words',
    run() {
      // Google's metadata policy: no price or promotion, no "free" or "no ads"
      // as deal words, no ranking, no emoji in the title.
      const banned = /\bfree\b|\bno ads\b|\bbest\b|#1|\btop\b|€|\$|ilmai|mainok|paras|alennus|\bsale\b|discount/i;
      const emoji = /\p{Extended_Pictographic}/u;
      const fields = readFields();
      for (const lang of LANGS) {
        for (const name of ['title', 'short']) {
          const text = fields[`${lang}.${name}`];
          assert.ok(!banned.test(text), `${lang}.${name} has a price, deal or ranking word: "${text}"`);
          assert.ok(!emoji.test(text), `${lang}.${name} has an emoji`);
        }
      }
    },
  },
  {
    name: 'store listing: no promised result and no price before billing is live',
    run() {
      const fields = readFields();
      for (const lang of LANGS) {
        const full = fields[`${lang}.full`];
        // "50 kg → 80 kg" style outcomes, and a price or trial length that
        // Play shows by itself once the products exist (docs/store-billing.md).
        assert.ok(!/\d+\s*kg\s*(→|->|to|➜)/i.test(full), `${lang}.full promises a result`);
        assert.ok(!/\d+(?:[,.]\d{2})?\s*[€$]|[€$]\s*\d/.test(full), `${lang}.full names a price`);
        const length = /(\d+|one|two|three|seven|yhden|kahden|kolmen|seitsemän)[- ]?(days?|weeks?|months?|päivän|viikon|kuukauden)\b[^.\n]*(trial|kokeilu)/i;
        assert.ok(!length.test(full), `${lang}.full names a trial length`);
      }
    },
  },
  {
    name: 'store listing: the numbers in the text are still true in the code',
    run() {
      const { WORKOUT_TEMPLATES_V1 } = require(path.join(dist, 'features/workout/workoutCatalog.js'));
      const { createSeedExerciseLibrary } = require(path.join(dist, 'data/seed.js'));
      const { PRO_COACH_QUESTIONS_PER_MONTH } = require(path.join(dist, 'lib/aiCoachQuota.js'));
      const { FREE_CUSTOM_PROGRAM_LIMIT } = require(path.join(dist, 'lib/programSlots.js'));
      const { FREE_TREND_MONTHS } = require(path.join(dist, 'lib/historyWindow.js'));
      const { PRO_ACTIVE_PROGRAM_CAP } = require(path.join(dist, 'lib/activeProgramSet.js'));
      const fields = readFields();
      const both = `${fields['fi.full']}\n${fields['en.full']}\n${fields['fi.short']}\n${fields['en.short']}`;

      // Floors ("50+", "900+") so the text does not age with every addition;
      // a floor above the real count is a false claim. The noun after the
      // number says which count it is; a floor of anything else fails until
      // it is added here.
      const counts = [
        [/^(valmi|ohjelm|ready|program)/i, WORKOUT_TEMPLATES_V1.length],
        [/^(liik|exercis)/i, createSeedExerciseLibrary().length],
      ];
      const realCount = (noun, said) => {
        const hit = counts.find(([pattern]) => pattern.test(noun));
        assert.ok(hit, `the listing says "${said}"; tests/storeListing.test.cjs does not know what to count`);
        return hit[1];
      };
      for (const [said, floor, noun] of both.matchAll(/\b(\d+)\+ (\S+)/g)) {
        const real = realCount(noun, said);
        assert.ok(real >= Number(floor), `the listing says "${said}" but the code has ${real}`);
      }
      for (const [said, floor, noun] of both.matchAll(/(?:Yli|More than) (\d+) (\S+)/g)) {
        const real = realCount(noun, said);
        assert.ok(real > Number(floor), `the listing says "${said}" but the code has ${real}`);
      }

      assert.equal(PRO_COACH_QUESTIONS_PER_MONTH, 25, 'the listing says 25 coach questions a month');
      assert.match(fields['fi.full'], /25 kysymystä kuukaudessa/);
      assert.match(fields['en.full'], /25 questions a month/);

      assert.equal(FREE_CUSTOM_PROGRAM_LIMIT, 3, 'the listing says three programs of your own on the free plan');
      assert.equal(FREE_TREND_MONTHS, 3, 'the listing says three months of charts on the free plan');
      assert.equal(PRO_ACTIVE_PROGRAM_CAP, 5, 'the listing says five programs running at once with Pro');
    },
  },
];
