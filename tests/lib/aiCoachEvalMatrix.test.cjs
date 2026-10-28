const assert = require('node:assert/strict');

const {
  AI_COACH_EVAL_MATRIX,
  scoreGeneralRules,
  scoreMatrixCase,
} = require('../../src/lib/aiCoachEvalMatrix');
const { buildAiCoachSystemContext } = require('../../src/lib/aiCoachSystemContext');

function advice(overrides = {}) {
  return {
    takeaway: '',
    why: [],
    nextSteps: [],
    plan: [],
    assumptions: [],
    ...overrides,
  };
}

const byId = (id) => AI_COACH_EVAL_MATRIX.find((entry) => entry.id === id);

module.exports = [
  {
    name: 'eval matrix: ids are unique and every case states its language and a good answer',
    run() {
      const ids = AI_COACH_EVAL_MATRIX.map((entry) => entry.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const entry of AI_COACH_EVAL_MATRIX) {
        assert.ok(entry.language === 'fi' || entry.language === 'en', entry.id);
        assert.ok(entry.goodAnswer.length > 0, entry.id);
      }
    },
  },
  {
    // The live run is paid from the same balance real readers use.
    name: 'eval matrix: stays small enough for one cheap live run',
    run() {
      assert.ok(AI_COACH_EVAL_MATRIX.length <= 40, `${AI_COACH_EVAL_MATRIX.length} cases`);
    },
  },
  {
    name: 'eval matrix: every context serializes, and the fixtures say what their names claim',
    run() {
      for (const entry of AI_COACH_EVAL_MATRIX) {
        assert.ok(buildAiCoachSystemContext(entry.context).length > 0, entry.id);
      }
      // A case named for a figure has to have that figure in its context, or
      // the grounding check fails the coach for reading the log correctly.
      assert.match(buildAiCoachSystemContext(byId('stalled-why').context), /82[.,]5/);
      assert.match(buildAiCoachSystemContext(byId('regression-deadlift').context), /130/);
      assert.match(buildAiCoachSystemContext(byId('beginner-analyse').context), /87[.,]5/);
      assert.match(buildAiCoachSystemContext(byId('cutting-strength').context), /100/);
    },
  },
  {
    name: 'eval matrix: a Finnish case answered in English fails the language check',
    run() {
      const checks = scoreGeneralRules(byId('stalled-why'), advice({ takeaway: 'Your bench has stalled at 82.5 kg.' }));
      assert.equal(checks.find((check) => check.check === 'language:fi').passed, false);
      const ok = scoreGeneralRules(byId('stalled-why'), advice({ takeaway: 'Penkki on junnannut 82,5 kilossa.' }));
      assert.equal(ok.find((check) => check.check === 'language:fi').passed, true);
      // "On" is an English word too: an English takeaway that uses it is not
      // Finnish (break round 2026-09-28).
      for (const takeaway of [
        'Focus on your squat form before adding more weight next session.',
        'Keep the weight on the bar and add a rep.',
        'Stay on 82.5 kg for this week.',
      ]) {
        const english = scoreGeneralRules(byId('stalled-why'), advice({ takeaway }));
        assert.equal(english.find((check) => check.check === 'language:fi').passed, false, takeaway);
      }
    },
  },
  {
    name: 'eval matrix: an English case answered in Finnish fails the language check',
    run() {
      const checks = scoreGeneralRules(byId('beginner-en-progress'), advice({ takeaway: 'Kyykky on noussut hyvin.' }));
      assert.equal(checks.find((check) => check.check === 'language:en').passed, false);
    },
  },
  {
    name: 'eval matrix: three set listings are a dump, two are evidence',
    run() {
      const dump = advice({
        takeaway: 'Treeni meni hyvin.',
        why: ['Kyykky 87,5 kg x 5, 5, 5', 'Penkki 58,75 kg x 5, 5, 5', 'Soutu 53,75 kg × 8, 8, 8'],
      });
      assert.equal(scoreGeneralRules(byId('beginner-analyse'), dump).find((c) => c.check === 'no-set-dump').passed, false);
      const evidence = advice({ takeaway: 'Treeni meni hyvin.', why: ['Kyykky 87,5 kg x 5, 5, 5', 'Penkki 58,75 kg x 5, 5, 5'] });
      assert.equal(scoreGeneralRules(byId('beginner-analyse'), evidence).find((c) => c.check === 'no-set-dump').passed, true);
    },
  },
  {
    name: 'eval matrix: a three-sentence takeaway fails, a decimal comma does not split a sentence',
    run() {
      const long = advice({ takeaway: 'Penkki junnaa. Kyykky nousee. Vaihda penkin toistot.' });
      assert.equal(scoreGeneralRules(byId('stalled-why'), long).find((c) => c.check === 'takeaway-short').passed, false);
      const short = advice({ takeaway: 'Penkki on ollut 82,5 kg kuusi treeniä. Vaihda toistot 8:aan.' });
      assert.equal(scoreGeneralRules(byId('stalled-why'), short).find((c) => c.check === 'takeaway-short').passed, true);
    },
  },
  {
    // Both were copied out of the context into Finnish answers (2026-09-28).
    name: 'eval matrix: an ISO date or an English context label in a Finnish answer fails',
    run() {
      const leaky = advice({
        takeaway: 'Takakyykky on junnannut.',
        why: ['Takakyykky flat 80 kg viidessä sessiossa', 'Viikolla 2026-07-20 tehtiin 1/2'],
      });
      const checks = scoreGeneralRules(byId('inconsistent-why-no-progress'), leaky);
      assert.equal(checks.find((check) => check.check === 'no-iso-date').passed, false);
      assert.equal(checks.find((check) => check.check === 'no-english-labels').passed, false);
      const clean = advice({ takeaway: 'Takakyykky on ollut paikallaan 80 kilossa.', why: ['Viikolla 20.7. tehtiin 1/2'] });
      const ok = scoreGeneralRules(byId('inconsistent-why-no-progress'), clean);
      assert.equal(ok.find((check) => check.check === 'no-iso-date').passed, true);
      assert.equal(ok.find((check) => check.check === 'no-english-labels').passed, true);
      // English answers use those words legitimately.
      const en = scoreGeneralRules(byId('beginner-en-progress'), advice({ takeaway: 'Your latest top set is up.' }));
      assert.equal(en.find((check) => check.check === 'no-english-labels'), undefined);
    },
  },
  {
    // The first live run failed "87,5 kg" for missing "87.5".
    name: 'eval matrix: a cited figure written with a decimal comma still counts as cited',
    run() {
      const result = scoreMatrixCase(
        byId('beginner-analyse'),
        advice({ takeaway: 'Takakyykky nousi 85 kg:sta 87,5 kg:aan.' }),
      );
      assert.equal(result.checks.find((check) => check.check === 'cites:87.5').passed, true);
    },
  },
  {
    name: 'eval matrix: the combined score counts the seed checks and the general ones',
    run() {
      const result = scoreMatrixCase(
        byId('stalled-why'),
        advice({ takeaway: 'Penkki on ollut 82,5 kg kuusi treeniä.', nextSteps: ['Kokeile 3 × 8 75 kilolla.'] }),
      );
      assert.ok(result.checks.some((check) => check.check === 'grounded'));
      assert.ok(result.checks.some((check) => check.check === 'no-set-dump'));
      assert.equal(result.passed, result.total, JSON.stringify(result.checks.filter((c) => !c.passed)));
    },
  },
];
