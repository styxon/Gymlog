const assert = require('node:assert/strict');

const {
  CANCEL_REASON_KEYS,
  buildCancelSurveyAnswer,
  normalizeCancelSurveyAnswer,
} = require('../../src/lib/cancelSurvey');

const AT = '2026-08-16T10:00:00.000Z';

module.exports = [
  {
    name: 'cancelSurvey: skipping stores nothing, rather than an empty answer',
    run() {
      // A skip and a blank answer are the same action and neither is a
      // response. Storing an empty record would make "reasons given" count
      // people who declined to give one.
      assert.equal(buildCancelSurveyAnswer([], '', AT), null);
      assert.equal(buildCancelSurveyAnswer([], '   ', AT), null);
    },
  },
  {
    name: 'cancelSurvey: reasons are stored as keys, so both languages count together',
    run() {
      // "Liian kallis" and "Too expensive" are the same answer. Storing the
      // display string would split every count down the middle.
      const answer = buildCancelSurveyAnswer(['subs.survey.r1', 'subs.survey.r3'], '', AT);
      assert.deepEqual(answer.reasons, ['subs.survey.r1', 'subs.survey.r3']);
      assert.equal(answer.answeredAt, AT);
      assert.equal(answer.note, '');
    },
  },
  {
    name: 'cancelSurvey: the note belongs to "something else" and nowhere else',
    run() {
      // Typing into the box and then unticking "Muu" is a reader backing out.
      // Keeping the text would store something they removed from the screen.
      const kept = buildCancelSurveyAnswer(['subs.survey.r6'], '  liian hidas  ', AT);
      assert.equal(kept.note, 'liian hidas');

      const dropped = buildCancelSurveyAnswer(['subs.survey.r1'], 'liian hidas', AT);
      assert.equal(dropped.note, '');
    },
  },
  {
    name: 'cancelSurvey: junk out of storage does not become an answer',
    run() {
      assert.equal(normalizeCancelSurveyAnswer(null), null);
      assert.equal(normalizeCancelSurveyAnswer('nope'), null);
      assert.equal(normalizeCancelSurveyAnswer({ reasons: ['subs.survey.r1'] }), null);
      // An unknown reason key is dropped rather than trusted through.
      assert.equal(
        normalizeCancelSurveyAnswer({ answeredAt: AT, reasons: ['made.up.key'], note: '' }),
        null,
      );
      const ok = normalizeCancelSurveyAnswer({
        answeredAt: AT,
        reasons: ['subs.survey.r2', 'made.up.key'],
        note: '',
      });
      assert.deepEqual(ok.reasons, ['subs.survey.r2']);
    },
  },
  {
    name: 'cancelSurvey: every reason key exists in both dictionaries',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const i18n = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'lib', 'i18n.ts'),
        'utf8',
      );
      const lines = i18n.split(String.fromCharCode(10));
      for (const key of CANCEL_REASON_KEYS) {
        const matches = lines.filter((row) => row.includes(`'${key}':`));
        assert.ok(matches.length >= 2, `${key} should exist in both languages`);
      }
    },
  },
];
