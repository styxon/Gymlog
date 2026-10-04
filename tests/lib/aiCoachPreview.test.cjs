const assert = require('node:assert/strict');

const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');

function baseContext(overrides = {}) {
  return {
    unitPreference: 'kg',
    activeSession: null,
    recentCompletedSessions: [],
    trackedLifts: [],
    latestTopSets: [],
    sessionsThisWeek: 3,
    sessionsLast30Days: 10,
    rhythm: [],
    readyProgramCount: 5,
    recommendedProgramId: null,
    recommendedProgramTitle: null,
    customProgramTitle: null,
    plateaus: [],
    fatigue: { acwr: 1.05, recoveryScore: 98, signal: 'optimal', sessionCount7d: 3, confident: true },
    ...overrides,
  };
}

const GENERIC_PROMPT = 'mitä pitäisi tehdä tällä viikolla';

// --- Scenario 1: plateau only ---

module.exports = [
  {
    name: 'preview plateau only: names the stuck lift and suggests concrete fix',
    run() {
      const ctx = baseContext({
        plateaus: [{ exerciseKey: 'bench press', name: 'Bench Press', stagnantSessions: 4, topWeightKg: 100 }],
        fatigue: { acwr: 1.0, recoveryScore: 95, signal: 'optimal', sessionCount7d: 3, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);

      assert.ok(answer.takeaway.includes('Bench Press'), `takeaway should name the lift, got: "${answer.takeaway}"`);
      assert.ok(answer.takeaway.includes('4'), `takeaway should mention stagnant sessions, got: "${answer.takeaway}"`);

      const allText = [answer.takeaway, ...answer.why, ...answer.nextSteps, ...answer.plan].join(' ');
      assert.ok(allText.includes('100 kg'), 'response should reference the actual weight');
      assert.ok(
        allText.toLowerCase().includes('deload') || allText.toLowerCase().includes('variation') || allText.toLowerCase().includes('80%'),
        'response should suggest a concrete action',
      );
    },
  },
  {
    name: 'preview plateau only: second plateau exercise is also mentioned when multiple',
    run() {
      const ctx = baseContext({
        plateaus: [
          { exerciseKey: 'bench press', name: 'Bench Press', stagnantSessions: 4, topWeightKg: 100 },
          { exerciseKey: 'squat', name: 'Squat', stagnantSessions: 3, topWeightKg: 120 },
        ],
        fatigue: { acwr: 1.0, recoveryScore: 95, signal: 'optimal', sessionCount7d: 3, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);
      const allText = [answer.takeaway, ...answer.why].join(' ');
      assert.ok(allText.includes('1 more lift') || allText.includes('2 more'), `should mention extra plateaus, got: "${allText}"`);
    },
  },

  // --- Scenario 2: high fatigue only ---

  {
    name: 'preview high fatigue only: references ACWR and suggests lighter week',
    run() {
      const ctx = baseContext({
        plateaus: [],
        fatigue: { acwr: 1.7, recoveryScore: 35, signal: 'high', sessionCount7d: 6, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);

      const allText = [answer.takeaway, ...answer.why, ...answer.nextSteps, ...answer.plan].join(' ');
      assert.ok(allText.includes('1.7'), `response should reference the actual ACWR, got: "${allText}"`);
      assert.ok(allText.includes('35'), `response should reference the recovery score, got: "${allText}"`);
      assert.ok(
        answer.takeaway.toLowerCase().includes('pull back') || answer.takeaway.toLowerCase().includes('creeping'),
        `takeaway should suggest backing off, got: "${answer.takeaway}"`,
      );
      assert.ok(
        allText.toLowerCase().includes('volume') || allText.toLowerCase().includes('sets'),
        'response should mention volume reduction',
      );
    },
  },
  {
    name: 'preview elevated fatigue (not high): still suggests lighter approach',
    run() {
      const ctx = baseContext({
        plateaus: [],
        fatigue: { acwr: 1.4, recoveryScore: 62, signal: 'elevated', sessionCount7d: 5, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);
      const allText = [answer.takeaway, ...answer.why].join(' ');
      assert.ok(allText.includes('1.4'), `should reference ACWR, got: "${allText}"`);
      assert.ok(allText.includes('elevated'), `should name the signal, got: "${allText}"`);
    },
  },

  // --- Scenario 3: both plateau AND high fatigue → recovery first ---

  {
    name: 'preview both plateau and high fatigue: recovery is prioritised first',
    run() {
      const ctx = baseContext({
        plateaus: [{ exerciseKey: 'deadlift', name: 'Deadlift', stagnantSessions: 5, topWeightKg: 150 }],
        fatigue: { acwr: 1.8, recoveryScore: 28, signal: 'high', sessionCount7d: 7, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);

      assert.ok(
        answer.takeaway.toLowerCase().includes('recover') || answer.takeaway.toLowerCase().includes('wait'),
        `takeaway should prioritise recovery, got: "${answer.takeaway}"`,
      );
      const allText = [answer.takeaway, ...answer.why, ...answer.nextSteps, ...answer.plan].join(' ');
      assert.ok(allText.includes('Deadlift'), 'plateau lift should still be named');
      assert.ok(allText.includes('1.8') || allText.includes('28'), 'fatigue data should be referenced');
      assert.ok(allText.includes('150 kg'), 'plateau weight should be referenced');
    },
  },
  {
    name: 'preview both: deload comes before plateau-fix in the plan',
    run() {
      const ctx = baseContext({
        plateaus: [{ exerciseKey: 'squat', name: 'Squat', stagnantSessions: 3, topWeightKg: 120 }],
        fatigue: { acwr: 1.55, recoveryScore: 42, signal: 'high', sessionCount7d: 5, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);
      const planText = answer.plan.join(' ').toLowerCase();
      const deloadIndex = planText.indexOf('deload');
      const variationIndex = planText.indexOf('variation');
      assert.ok(deloadIndex !== -1, 'plan should mention deload');
      assert.ok(variationIndex !== -1, 'plan should mention variation');
      assert.ok(deloadIndex < variationIndex, 'deload should come before variation in the plan');
    },
  },

  // --- Scenario 4: neither plateau nor high fatigue → normal response ---

  {
    name: 'preview neither condition: returns generic advice without plateau/fatigue framing',
    run() {
      const ctx = baseContext({
        plateaus: [],
        fatigue: { acwr: 1.05, recoveryScore: 98, signal: 'optimal', sessionCount7d: 3, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer(GENERIC_PROMPT, ctx);
      const allText = [answer.takeaway, ...answer.why].join(' ');
      assert.ok(!allText.toLowerCase().includes('plateau'), `normal response should not mention plateaus, got: "${allText}"`);
      assert.ok(!allText.toLowerCase().includes('acwr'), `normal response should not mention ACWR, got: "${allText}"`);
    },
  },
  {
    name: 'preview neither condition: specific lift question returns lift advice',
    run() {
      const ctx = baseContext({
        plateaus: [],
        fatigue: { acwr: 1.05, recoveryScore: 98, signal: 'optimal', sessionCount7d: 3, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer('bench painoo ei nouse', ctx);
      assert.ok(
        answer.takeaway.toLowerCase().includes('twice') || answer.takeaway.toLowerCase().includes('train'),
        `lift question without plateau should get generic lift advice, got: "${answer.takeaway}"`,
      );
    },
  },

  // --- Specific lift + matching plateau ---

  {
    name: 'preview lift keyword + matching plateau: names that specific lift',
    run() {
      const ctx = baseContext({
        plateaus: [{ exerciseKey: 'bench press', name: 'Bench Press', stagnantSessions: 3, topWeightKg: 95 }],
        fatigue: { acwr: 1.0, recoveryScore: 92, signal: 'optimal', sessionCount7d: 3, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer('bench jumissa', ctx);
      assert.ok(answer.takeaway.includes('Bench Press'), `should name the specific lift, got: "${answer.takeaway}"`);
    },
  },
  {
    name: 'preview lift keyword + matching plateau + high fatigue: combined response',
    run() {
      const ctx = baseContext({
        plateaus: [{ exerciseKey: 'bench press', name: 'Bench Press', stagnantSessions: 3, topWeightKg: 95 }],
        fatigue: { acwr: 1.6, recoveryScore: 45, signal: 'high', sessionCount7d: 6, confident: true },
      });
      const answer = buildAiCoachPreviewAnswer('bench jumissa', ctx);
      const allText = [answer.takeaway, ...answer.why].join(' ');
      assert.ok(
        answer.takeaway.toLowerCase().includes('recover') || answer.takeaway.toLowerCase().includes('wait'),
        `combined response should prioritise recovery, got: "${answer.takeaway}"`,
      );
      assert.ok(allText.includes('Bench Press'), 'should still name the plateau lift');
    },
  },
];

// --- Language: every install answers from here, so it must speak Finnish ---

const LANG_CASES = [
  ['a plateau question', 'miksi penkki on jumissa', { plateaus: [{ exerciseKey: 'penkkipunnerrus', name: 'Penkkipunnerrus', stagnantSessions: 4, topWeightKg: 82.5 }] }],
  ['a recovery question', 'olenko palautunut', {}],
  ['a running question', 'haluan juosta 20 km', {}],
  ['a program question', 'korjaa treenijakoni', {}],
  ['an unmatched question', 'moikka', {}],
];

module.exports.push(
  {
    name: 'preview: every branch answers in Finnish when asked to',
    run() {
      for (const [label, prompt, overrides] of LANG_CASES) {
        const answer = buildAiCoachPreviewAnswer(prompt, baseContext(overrides), 'fi');
        const text = [answer.takeaway, ...answer.why, ...answer.nextSteps, ...answer.plan, ...answer.assumptions].join(' ');
        // The tell for untranslated copy: these words only exist in the
        // English strings this generator used to hardcode.
        assert.doesNotMatch(text, /(week|session|sessions|Preview answer|Recovery score|reps|load)/i, label);
        assert.match(answer.assumptions.join(' '), /Esikatseluvastaus/, label);
      }
    },
  },
  {
    name: 'preview: English is still English, and is the default',
    run() {
      const explicit = buildAiCoachPreviewAnswer('moikka', baseContext(), 'en');
      const implicit = buildAiCoachPreviewAnswer('moikka', baseContext());
      assert.equal(explicit.takeaway, 'Ask one clear question.');
      assert.equal(implicit.takeaway, explicit.takeaway, 'an older caller with no language still gets English');
    },
  },
  {
    name: 'preview: Finnish gets its own singular for one session',
    run() {
      const one = buildAiCoachPreviewAnswer('olenko palautunut', baseContext({
        fatigue: { acwr: 1.05, recoveryScore: 90, signal: 'optimal', sessionCount7d: 1, confident: true },
      }), 'fi');
      // A rolling seven days, said as one: "tällä viikolla" was a count that
      // started last Thursday.
      assert.match(one.why.join(' '), /1 treeni viimeisen 7 päivän aikana/);

      const many = buildAiCoachPreviewAnswer('olenko palautunut', baseContext({
        fatigue: { acwr: 1.05, recoveryScore: 90, signal: 'optimal', sessionCount7d: 4, confident: true },
      }), 'fi');
      assert.match(many.why.join(' '), /4 treeniä viimeisen 7 päivän aikana/);
    },
  },
  {
    name: 'preview routing: a word is matched as a word, never inside another one',
    run() {
      const running = buildAiCoachPreviewAnswer('haluan juosta 20 km', baseContext(), 'en').takeaway;
      for (const prompt of [
        'How many crunches should I do?',
        'Syönkö runsaasti proteiinia?',
        'Miten vahvistan rungon lihaksia?',
        'Kirjoita minulle runo',
        'Syönkö perunaa illalla?',
        'Brunssin jälkeen treeni?',
        'Analysoi viime treenini, tein runsaasti sarjoja',
      ]) {
        assert.notEqual(buildAiCoachPreviewAnswer(prompt, baseContext(), 'en').takeaway, running, prompt);
      }
      assert.equal(buildAiCoachPreviewAnswer('I want to run a 10k', baseContext(), 'en').takeaway, running);
      assert.equal(buildAiCoachPreviewAnswer('Running twice a week?', baseContext(), 'en').takeaway, running);
    },
  },
  {
    name: 'preview routing: the app’s own chips get their own answers, whatever the signals',
    run() {
      const plateau = { plateaus: [{ exerciseKey: 'bench press', name: 'Bench Press', stagnantSessions: 4, topWeightKg: 100 }] };
      const load = { fatigue: { acwr: 1.7, recoveryScore: 35, signal: 'high', sessionCount7d: 6, confident: true } };
      const session = { recentCompletedSessions: [{ title: 'Push', setsCompleted: 12, durationMinutes: 50, swappedExercises: 0 }] };

      const protein = buildAiCoachPreviewAnswer('Paljonko proteiinia tavoitteeseeni?', baseContext(plateau), 'en');
      assert.equal(protein.takeaway, buildAiCoachPreviewAnswer('How much protein?', baseContext(), 'en').takeaway);
      // "Protein for recovery" is a food question.
      assert.equal(buildAiCoachPreviewAnswer('How much protein do I need for recovery?', baseContext(), 'en').takeaway, protein.takeaway);

      const analysis = buildAiCoachPreviewAnswer('Analyze my last workout', baseContext({ ...load, ...session }), 'en');
      assert.match(analysis.takeaway, /Push/);
      const analysisWithPlateau = buildAiCoachPreviewAnswer('Analysoi viime treenini', baseContext({ ...plateau, ...session }), 'en');
      assert.match(analysisWithPlateau.takeaway, /Push/);
      // "Analyse" on its own still reads the last session.
      assert.match(buildAiCoachPreviewAnswer('Analysoi', baseContext(session), 'fi').takeaway, /Push/);

      // "Analyse my programme" and "analyse my bench" name something else,
      // and get that thing's answer — not a summary of the last session.
      const programme = buildAiCoachPreviewAnswer('Säädä ohjelmaani', baseContext(session), 'fi').takeaway;
      assert.equal(buildAiCoachPreviewAnswer('Analysoi ohjelmani', baseContext(session), 'fi').takeaway, programme);
      assert.equal(buildAiCoachPreviewAnswer('Analyze my program', baseContext(session), 'fi').takeaway, programme);
      const lift = buildAiCoachPreviewAnswer('penkki', baseContext(session), 'fi').takeaway;
      assert.equal(buildAiCoachPreviewAnswer('analysoi penkki', baseContext(session), 'fi').takeaway, lift);
      assert.doesNotMatch(lift, /Push/);
      assert.doesNotMatch(programme, /Push/);
    },
  },
  {
    name: 'preview routing: recovery needs history, rest between sets is not recovery, and "recovered" is',
    run() {
      const thin = { fatigue: { acwr: 4, recoveryScore: 0, signal: 'high', sessionCount7d: 1, confident: false } };
      const answer = buildAiCoachPreviewAnswer('Olenko palautunut?', baseContext(thin), 'fi');
      const text = [answer.takeaway, ...answer.why, ...answer.nextSteps].join(' ');
      assert.doesNotMatch(text, /ACWR|Kevennä|30–40/);
      assert.equal(answer.unanswered, true);

      const ok = baseContext();
      const recovered = buildAiCoachPreviewAnswer('Am I recovered?', ok, 'en');
      assert.equal(recovered.takeaway, buildAiCoachPreviewAnswer('recovery?', ok, 'en').takeaway);
      assert.equal(buildAiCoachPreviewAnswer('Am I overtrained?', ok, 'en').takeaway, recovered.takeaway);
      assert.notEqual(buildAiCoachPreviewAnswer('Kuinka pitkä palautus sarjojen välissä?', ok, 'fi').takeaway, buildAiCoachPreviewAnswer('olenko palautunut', ok, 'fi').takeaway);

      // And the level is said in the reader's language.
      const load = baseContext({ fatigue: { acwr: 1.4, recoveryScore: 62, signal: 'elevated', sessionCount7d: 5, confident: true } });
      const finnish = buildAiCoachPreviewAnswer('mitä pitäisi tehdä tällä viikolla', load, 'fi');
      assert.doesNotMatch([finnish.takeaway, ...finnish.why].join(' '), /elevated|high\b/);
    },
  },
  {
    name: 'preview routing: a lift question finds its own plateau, in Finnish too, and not by a shared word',
    run() {
      const squat = { plateaus: [{ exerciseKey: 'back squat', name: 'Back Squat', stagnantSessions: 3, topWeightKg: 120 }] };
      assert.match(buildAiCoachPreviewAnswer('Kyykky jumissa', baseContext(squat), 'en').takeaway, /Back Squat|squat/i);

      const row = { plateaus: [{ exerciseKey: 'barbell row', name: 'Barbell Row', stagnantSessions: 3, topWeightKg: 70 }] };
      assert.doesNotMatch(buildAiCoachPreviewAnswer('My barbell bench is not moving', baseContext(row), 'en').takeaway, /Row/);
    },
  },
  {
    name: 'preview routing: a stage chip question that carries a complaint is not answered as the chip',
    run() {
      const ctx = baseContext();
      const start = buildAiCoachPreviewAnswer('Where should I start?', ctx, 'en').takeaway;
      const addWeight = buildAiCoachPreviewAnswer('Milloin lisään painoa?', ctx, 'fi').takeaway;
      // The chips themselves still land ("painoa" is not "pain").
      for (const [prompt, language, chip] of [
        ['Where should I start? my knee hurts', 'en', start],
        ['How do I start squatting with a bad back', 'en', start],
        ['Where do I start my recovery?', 'en', start],
        ['Mistä kannattaa aloittaa, polveen sattuu', 'fi', start],
        ['When should I add weight, my shoulder is painful', 'en', addWeight],
        ['Milloin lisään painoa, olkapää on kipeä', 'fi', addWeight],
      ]) {
        assert.notEqual(buildAiCoachPreviewAnswer(prompt, ctx, language).takeaway, chip, prompt);
      }
      assert.equal(buildAiCoachPreviewAnswer('Milloin lisään painoa?', ctx, 'fi').takeaway, addWeight);
      assert.notEqual(buildAiCoachPreviewAnswer('mitä pitäisi tehdä tällä viikolla', ctx, 'fi').takeaway, addWeight);
    },
  },
);
