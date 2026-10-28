const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

/**
 * Numbers in the coach's answers in the reader's own format (#bugs,
 * 2026-09-30): a live Finnish answer carried "72.5 → 75 → 80" copied from the
 * context's English data, and the offline answer built on the server wrote
 * "ACWR 3,02" into an English one.
 */
module.exports = [
  {
    name: 'coach decimals: a Finnish answer takes the comma, and dates, times and versions keep their dots',
    run() {
      const { finnishDecimals } = require('../../src/lib/aiCoachAnswerDecimals');
      const cases = [
        ['Top-sarjat 72.5 → 75 → 77.5 → 80 kg', 'Top-sarjat 72,5 → 75 → 77,5 → 80 kg'],
        ['Nousu 2.5 kg.', 'Nousu 2,5 kg.'],
        ['1.25 kg levyt', '1,25 kg levyt'],
        ['Paras oli 77.5.', 'Paras oli 77,5.'],
        ['turva-alue 0.8–1.3.', 'turva-alue 0,8–1,3.'],
        ['ACWR 3.02 (korkea)', 'ACWR 3,02 (korkea)'],
        // Left alone.
        ['26.9. Alavartalon treenissä', '26.9. Alavartalon treenissä'],
        ['Edellinen kerta 17.9. oli 150 kg', 'Edellinen kerta 17.9. oli 150 kg'],
        ['1.5.–3.5. välillä', '1.5.–3.5. välillä'],
        ['3.8.2026 alkaen', '3.8.2026 alkaen'],
        ['klo 17.30 treeni', 'klo 17.30 treeni'],
        ['versio 1.2.3', 'versio 1.2.3'],
        ['72,5 kg jo pilkulla', '72,5 kg jo pilkulla'],
      ];
      for (const [input, expected] of cases) {
        assert.equal(finnishDecimals(input), expected, input);
      }
    },
  },
  {
    name: 'coach decimals: every text field of a Finnish answer is localized, English and the brief pass through',
    run() {
      const { localizeAdviceDecimals } = require('../../src/lib/aiCoachAnswerDecimals');
      const advice = {
        takeaway: 'Nousi 72.5 kg:sta',
        why: ['Top-sarjat 72.5 → 75'],
        nextSteps: ['Lisää 2.5 kg'],
        plan: ['Viikko 1: 77.5 kg'],
        assumptions: ['Paino 82.5 kg'],
        attention: 'Sarja 3 putosi 7.5 %',
        example: 'Tavoittele 80 kg x 8',
        suggestion: { kind: 'compose_programme', brief: 'penkki 72.5 kg' },
      };
      const fi = localizeAdviceDecimals(advice, 'fi');
      assert.equal(fi.takeaway, 'Nousi 72,5 kg:sta');
      assert.deepEqual(fi.why, ['Top-sarjat 72,5 → 75']);
      assert.deepEqual(fi.nextSteps, ['Lisää 2,5 kg']);
      assert.deepEqual(fi.plan, ['Viikko 1: 77,5 kg']);
      assert.deepEqual(fi.assumptions, ['Paino 82,5 kg']);
      assert.equal(fi.attention, 'Sarja 3 putosi 7,5 %');
      // The reader's own words are quoted back as they wrote them.
      assert.equal(fi.suggestion.brief, 'penkki 72.5 kg');
      assert.equal(localizeAdviceDecimals(advice, 'en'), advice);
      assert.equal(localizeAdviceDecimals(advice, undefined), advice);
      // No extra field appears where there was none.
      const bare = localizeAdviceDecimals({ takeaway: '1.5', why: [], nextSteps: [], plan: [], assumptions: [] }, 'fi');
      assert.ok(!('attention' in bare) && !('example' in bare));

      const endpoint = fs.readFileSync(path.join(root, 'api', 'ai-coach.ts'), 'utf8');
      assert.match(endpoint, /return createSuccess\(localizeAdviceDecimals\(parsed, input\.language\), 'live'\);/);
      assert.doesNotMatch(endpoint, /return createSuccess\(parsed, 'live'\);/);
    },
  },
  {
    name: 'coach decimals: the offline answer writes numbers in its own language, and the app\'s setting survives it',
    run() {
      const format = require('../../src/lib/format');
      const { withNumberLanguage } = format;
      assert.equal(typeof withNumberLanguage, 'function');
      format.setNumberLanguage('fi');
      try {
        const inside = withNumberLanguage('en', () => format.applyDecimalSeparator('3.02'));
        assert.equal(inside, '3.02');
        assert.equal(format.applyDecimalSeparator('3.02'), '3,02', 'the app\'s own separator was not put back');
        format.setNumberLanguage('en');
        assert.equal(withNumberLanguage('fi', () => format.applyDecimalSeparator('0.8')), '0,8');
        assert.equal(format.applyDecimalSeparator('0.8'), '0.8');
        // Put back after a throw too.
        assert.throws(() => withNumberLanguage('fi', () => { throw new Error('x'); }));
        assert.equal(format.applyDecimalSeparator('0.8'), '0.8');
      } finally {
        format.setNumberLanguage('fi');
      }
      const preview = fs.readFileSync(path.join(root, 'src', 'lib', 'aiCoachPreview.ts'), 'utf8');
      assert.match(preview, /return withNumberLanguage\(language, \(\) => buildPreviewAnswer\(prompt, context, language\)\);/);
    },
  },
];
