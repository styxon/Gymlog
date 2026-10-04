const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');
const { t } = require('../../.test-dist/lib/i18n.js');

function context(overrides = {}) {
  return {
    unitPreference: 'kg',
    sessionsThisWeek: 2,
    sessionsLast30Days: 7,
    recentCompletedSessions: [
      {
        sessionId: 's1',
        title: 'Kyykky & Penkki',
        performedAt: new Date(2026, 7, 6, 12).toISOString(),
        durationMinutes: 48,
        setsCompleted: 14,
        swappedExercises: 0,
        noteCount: 0,
      },
    ],
    trackedLifts: [{ name: 'Penkkipunnerrus', latestWeight: 80, latestReps: '5' }],
    latestTopSets: [{ exerciseName: 'Penkkipunnerrus', weight: 80, reps: 5 }],
    plateaus: [],
    fatigue: { signal: 'steady', confident: true, acwr: 1, recoveryScore: 70, sessionCount7d: 2 },
    activeProgram: null,
    ...overrides,
  };
}

const {
  COACH_QUICK_ASKS_FIRST,
  COACH_QUICK_ASKS_EARLY,
  COACH_QUICK_ASKS_ESTABLISHED,
  coachQuickAskKeys,
} = require('../../.test-dist/lib/coachQuickAsks.js');

/** A reader who has logged nothing — the one the first chips are for. */
function emptyContext() {
  return context({
    sessionsThisWeek: 0,
    sessionsLast30Days: 0,
    recentCompletedSessions: [],
    trackedLifts: [],
    latestTopSets: [],
    fatigue: { signal: 'steady', confident: false, acwr: null, recoveryScore: null, sessionCount7d: 0 },
  });
}

module.exports = [
  {
    name: 'every quick-ask chip gets a real answer, in both languages, at the stage it is offered',
    run() {
      // Each set is answered against the reader it is shown to: the first
      // chips to someone with nothing logged, the later ones to someone with
      // a session on record.
      const stages = [
        [COACH_QUICK_ASKS_FIRST, emptyContext()],
        [COACH_QUICK_ASKS_EARLY, context()],
        [COACH_QUICK_ASKS_ESTABLISHED, context()],
      ];
      for (const [keys, stageContext] of stages) for (const key of keys) {
        for (const language of ['en', 'fi']) {
          const prompt = t(language, key);
          assert.ok(prompt && prompt !== key, `${key} missing from ${language}`);
          const answer = buildAiCoachPreviewAnswer(prompt, stageContext, language);
          // The app offering a question it cannot answer, and charging one of
          // three weekly questions for the privilege, is the bug this pins.
          assert.notEqual(
            answer.unanswered,
            true,
            `"${prompt}" fell through to the default "ask a clearer question"`,
          );
          assert.ok(answer.takeaway.length > 0);
        }
      }
    },
  },
  {
    name: 'the last-workout answer is read from the session, not invented',
    run() {
      const answer = buildAiCoachPreviewAnswer('Analysoi viime treenini', context(), 'fi');
      assert.match(answer.takeaway, /Kyykky & Penkki/);
      assert.ok(answer.why.some((line) => line.includes('14')), 'the set count it recorded');
      assert.ok(answer.why.some((line) => line.includes('48')), 'the duration it recorded');
      assert.ok(answer.why.some((line) => line.includes('80')), 'the top set it recorded');

      // Nothing logged: it says so rather than describing a session.
      const empty = buildAiCoachPreviewAnswer(
        'Analysoi viime treenini',
        context({ recentCompletedSessions: [] }),
        'fi',
      );
      assert.equal(empty.unanswered, true, 'and it costs nothing');
    },
  },
  {
    name: 'an unanswerable question is still flagged, and the quota respects it',
    run() {
      const answer = buildAiCoachPreviewAnswer('asdfgh', context(), 'fi');
      assert.equal(answer.unanswered, true);

      // The screen charges on answer, and skips the charge when the coach
      // could only ask for a clearer question — or when the reply fell back
      // to preview text, which is not the product the counter meters.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'AICoachChatScreen.tsx'),
        'utf8',
      );
      assert.match(
        screen,
        /if \(proUnlocked && !answer\.unanswered && result\.source !== 'preview'\) \{\s*onQuestionUsed\(\);/,
      );
    },
  },
  {
    name: 'the quick asks follow the reader: starting, then the next step, then the week',
    run() {
      assert.deepEqual(coachQuickAskKeys(0), COACH_QUICK_ASKS_FIRST);
      assert.deepEqual(coachQuickAskKeys(Number.NaN), COACH_QUICK_ASKS_FIRST);
      assert.deepEqual(coachQuickAskKeys(1), COACH_QUICK_ASKS_EARLY);
      assert.deepEqual(coachQuickAskKeys(4), COACH_QUICK_ASKS_EARLY);
      assert.deepEqual(coachQuickAskKeys(5), COACH_QUICK_ASKS_ESTABLISHED);
      assert.deepEqual(coachQuickAskKeys(300), COACH_QUICK_ASKS_ESTABLISHED);
      // Nothing logged, nothing to analyse: the chip that reads the last
      // session is never offered before there is one.
      assert.ok(!COACH_QUICK_ASKS_FIRST.includes('coach.chip.analyze'));
      // Taken out on 2026-10-04 (user): a food question the app cannot read.
      for (const keys of [COACH_QUICK_ASKS_FIRST, COACH_QUICK_ASKS_EARLY, COACH_QUICK_ASKS_ESTABLISHED]) {
        assert.ok(!keys.includes('coach.chip.protein'));
      }
      // The screen takes them from the stage, not from a fixed list.
      const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderHomeScreens.tsx'), 'utf8');
      assert.match(shell, /quickAskKeys=\{coachQuickAskKeys\(database\.workoutSessions\.length\)\}/);
    },
  },
  {
    name: 'the week answer reads the logged week and says when there is none',
    run() {
      const answer = buildAiCoachPreviewAnswer('Miten viikkoni meni?', context(), 'fi');
      assert.match(answer.takeaway, /2 treeniä/);
      assert.ok(answer.why.some((line) => line.includes('7 treeniä')), 'the 30-day count it was given');
      const none = buildAiCoachPreviewAnswer('Miten viikkoni meni?', emptyContext(), 'fi');
      assert.equal(none.unanswered, true, 'nothing to read costs nothing');
    },
  },
  {
    name: 'the which-programme answer is for programme questions, not every "suits me"',
    run() {
      const programme = buildAiCoachPreviewAnswer('Mikä ohjelma sopii minulle?', emptyContext(), 'fi');
      assert.equal(programme.takeaway, t('fi', 'coachPreview.whichProgram.takeaway'));
      for (const [prompt, language] of [
        ['Mikä liike sopii minulle polvivaivan kanssa?', 'fi'],
        ['Does the deadlift suit me?', 'en'],
      ]) {
        const answer = buildAiCoachPreviewAnswer(prompt, context(), language);
        assert.notEqual(answer.takeaway, t(language, 'coachPreview.whichProgram.takeaway'), prompt);
      }
    },
  },
  {
    name: 'the add-weight steps follow the unit and the decimal comma',
    run() {
      const fi = buildAiCoachPreviewAnswer('Milloin lisään painoa?', context(), 'fi');
      assert.ok(fi.nextSteps.some((line) => line.includes('1–2,5 kg')));
      const lb = buildAiCoachPreviewAnswer('When do I add weight?', context({ unitPreference: 'lb' }), 'en');
      assert.ok(lb.nextSteps.some((line) => line.includes('5–10 lb')));
      assert.ok(!lb.nextSteps.some((line) => line.includes('kg')));
    },
  },
  {
    name: 'the protein answer says Vinha cannot see what you eat',
    run() {
      const answer = buildAiCoachPreviewAnswer('Paljonko proteiinia?', context(), 'fi');
      assert.match(answer.takeaway, /1,6/);
      // The app tracks no food, and an answer that implied otherwise would be
      // the coach claiming a reading it does not have.
      assert.ok(
        [...answer.why, ...answer.assumptions].some((line) => /ei seuraa|yleinen haarukka/i.test(line)),
      );
    },
  },
];
