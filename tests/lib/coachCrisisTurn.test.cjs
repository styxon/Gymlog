const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  coachHistoryAfterAnswer,
  coachHistoryBeforeCrisis,
  isCoachCrisisReply,
  isCoachCrisisTakeaway,
  withoutCoachCrisisTurns,
} = require('../../.test-dist/lib/coachCrisisTurn.js');
const { resumeCoachChat } = require('../../.test-dist/lib/coachChatMemory.js');
const { buildAiCoachPreviewAnswer } = require('../../.test-dist/lib/aiCoachPreview.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * A crisis exchange never becomes history (F1 crisis hunt, 2026-10-08).
 *
 * The server answers a crisis its newer filter catches with the crisis answer,
 * marked 'preview'. The chat appended that turn like any other, so the
 * message went to the model with the next question. The review of that fix
 * (2026-10-08) found the other half: a server whose filter caught something in
 * the HISTORY answered every following question with the crisis line, because
 * the turn it caught was never taken out — for the eight hours a thread lives.
 */
const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const CONTEXT = {
  unitPreference: 'kg',
  activeSession: null,
  recentCompletedSessions: [],
  trackedLifts: [],
  latestTopSets: [],
  sessionsThisWeek: 0,
  sessionsLast30Days: 0,
  rhythm: [],
  readyProgramCount: 0,
  recommendedProgramId: null,
  recommendedProgramTitle: null,
  customProgramTitle: null,
  plateaus: [],
  fatigue: { acwr: 1, recoveryScore: 90, signal: 'optimal', sessionCount7d: 0, confident: false },
  history: { windowDays: 56, sessionCount: 0, totalVolumeKg: 0, sessions: [], lifts: [], weeks: [], schedule: null, truncated: false },
};

/** The client module, loaded fresh with a server and a key. */
function loadLiveClient() {
  const saved = {};
  const env = {
    EXPO_PUBLIC_AI_COACH_API_URL: 'https://example.test/api/ai-coach',
    EXPO_PUBLIC_AI_COACH_APP_KEY: 'k-1234567890',
    NODE_ENV: 'test',
  };
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const modulePath = path.join(root, '.test-dist', 'lib', 'aiCoachClient.js');
  delete require.cache[modulePath];
  delete require.cache[path.join(root, '.test-dist', 'lib', 'aiCoachLiveGate.js')];
  try {
    return require(modulePath);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    delete require.cache[modulePath];
  }
}

async function withFetch(status, payload, body) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

module.exports = [
  {
    name: 'crisis turn: an answer is a crisis answer by its marker, or by its words from a server without one',
    run() {
      for (const language of ['fi', 'en']) {
        const answer = buildAiCoachPreviewAnswer('I want to die', {}, language);
        assert.equal(answer.takeaway, t(language, 'coachPreview.crisis.takeaway'));
        assert.equal(isCoachCrisisTakeaway(answer.takeaway), true);
        assert.equal(isCoachCrisisTakeaway(` ${answer.takeaway} `), true);
        // An older server sends no marker: the words are the only sign.
        assert.equal(isCoachCrisisReply({ takeaway: answer.takeaway }), true);
      }
      // A newer server marks it, whatever the words.
      assert.equal(isCoachCrisisReply({ crisis: true, takeaway: 'anything at all' }), true);
      assert.equal(isCoachCrisisReply({ crisis: 'yes', takeaway: 'Ten a week.' }), false);
      assert.equal(isCoachCrisisReply({ takeaway: 'Ten a week.' }), false);
      // Malformed is not a crisis, and does not throw.
      assert.equal(isCoachCrisisReply(null), false);
      assert.equal(isCoachCrisisReply({ takeaway: 42 }), false);
      assert.equal(isCoachCrisisTakeaway(undefined), false);
    },
  },
  {
    name: 'crisis turn: a crisis answer to a question this build passed empties the history, so the next question is answered (review, 2026-10-08)',
    run() {
      const crisisTakeaway = t('en', 'coachPreview.crisis.takeaway');
      // A turn a widened server filter now reads as a crisis, answered live
      // before the widening.
      const history = [
        { question: 'how many sets for chest?', takeaway: 'Ten a week.' },
        { question: 'something a newer filter catches', takeaway: 'Rest a day.' },
      ];
      // This build reads the new question as training; the server answered
      // with the crisis line, so what it caught is somewhere this build cannot
      // see. Every turn goes, or every question after this gets the line.
      const next = coachHistoryAfterAnswer(history, 'and legs?', { takeaway: crisisTakeaway }, true);
      assert.deepEqual(next, []);
      // A question this build reads as a crisis itself is not appended, and
      // the history before it stays.
      assert.deepEqual(coachHistoryAfterAnswer(history, 'I want to die', { takeaway: crisisTakeaway }, true), history);
      // An ordinary answer is appended, as before.
      assert.deepEqual(coachHistoryAfterAnswer(history, 'and legs?', { takeaway: 'The same.' }, false), [
        ...history,
        { question: 'and legs?', takeaway: 'The same.' },
      ]);
      // Never the array it was given.
      assert.notEqual(coachHistoryAfterAnswer(history, 'I want to die', { takeaway: crisisTakeaway }, true), history);
    },
  },
  {
    name: 'crisis turn: a thread reopened from memory drops the crisis exchanges it holds, and only those (review, 2026-10-08)',
    run() {
      const crisisTakeaway = t('en', 'coachPreview.crisis.takeaway');
      const messages = [
        { id: 'me:1', fromCoach: false, text: 'I wanted to die' },
        { id: 'coach:1', fromCoach: true, text: crisisTakeaway },
      ];
      const turns = [
        { question: 'how many sets for chest?', takeaway: 'Ten a week.' },
        { question: 'I wanted to die', takeaway: crisisTakeaway },
        // Read as a crisis by this build's widened filter, but answered live
        // by the coach before it: dropping it would lose what "and legs?"
        // refers to. The server takes it out if it must.
        { question: 'how many reps till I die lol', takeaway: 'Eight to twelve, two short of failure.' },
        { question: 'and legs?', takeaway: 'The same.' },
      ];
      const resumed = resumeCoachChat({ lastActiveAt: '2026-10-08T07:00:00.000Z', messages, turns }, '2026-10-08T07:05:00.000Z');
      assert.ok(resumed);
      assert.deepEqual(resumed.turns.map((turn) => turn.question), [
        'how many sets for chest?',
        'how many reps till I die lol',
        'and legs?',
      ]);
      // The thread is drawn as it was.
      assert.deepEqual(resumed.messages, messages);
      assert.deepEqual(withoutCoachCrisisTurns(turns), resumed.turns);
      // A malformed turn is kept as it was, not thrown on.
      assert.deepEqual(withoutCoachCrisisTurns([{ question: 'q' }]), [{ question: 'q' }]);
    },
  },
  {
    name: 'crisis turn: the history the model may read ends before the first crisis turn',
    run() {
      const crisisTakeaway = t('fi', 'coachPreview.crisis.takeaway');
      const history = [
        { question: 'paljonko sarjoja rintaan?', takeaway: 'Kymmenen viikossa.' },
        { question: 'halusin kuolla', takeaway: 'Raskasta.' },
        { question: 'entä selkä?', takeaway: 'Saman verran.' },
      ];
      // The crisis turn and everything said after it: a later turn may answer it.
      assert.deepEqual(coachHistoryBeforeCrisis(history), [history[0]]);
      // A turn the crisis answer closed, whatever its question reads as now.
      assert.deepEqual(
        coachHistoryBeforeCrisis([history[0], { question: 'x', takeaway: crisisTakeaway }, history[2]]),
        [history[0]],
      );
      assert.deepEqual(coachHistoryBeforeCrisis([history[0], history[2]]), [history[0], history[2]]);
      assert.deepEqual(coachHistoryBeforeCrisis([]), []);
    },
  },
  {
    name: 'crisis turn: the client marks a crisis answer, by the server\'s marker or its words, and an ordinary one not',
    async run() {
      const client = loadLiveClient();
      const takeaway = t('en', 'coachPreview.crisis.takeaway');
      const crisisAnswer = buildAiCoachPreviewAnswer('I want to die', CONTEXT, 'en');
      // This build's own filter: answered on the phone, marked.
      await withFetch(200, {}, async (calls) => {
        const local = await client.requestAiCoachAdvice({ prompt: 'I want to die', context: CONTEXT, language: 'en' });
        assert.equal(local.crisis, true);
        assert.equal(calls.length, 0);
      });
      // A newer server, with the marker.
      await withFetch(200, { ok: true, source: 'preview', crisis: true, answer: crisisAnswer }, async () => {
        const marked = await client.requestAiCoachAdvice({ prompt: 'and legs?', context: CONTEXT, language: 'en' });
        assert.equal(marked.crisis, true);
        assert.equal(marked.answer.takeaway, takeaway);
      });
      // An older server, without it: the words.
      await withFetch(200, { ok: true, source: 'preview', answer: crisisAnswer }, async () => {
        const unmarked = await client.requestAiCoachAdvice({ prompt: 'and legs?', context: CONTEXT, language: 'en' });
        assert.equal(unmarked.crisis, true);
      });
      await withFetch(200, { ok: true, source: 'live', answer: { takeaway: 'The same.' } }, async () => {
        const ordinary = await client.requestAiCoachAdvice({ prompt: 'and legs?', context: CONTEXT, language: 'en' });
        assert.equal(ordinary.crisis, undefined);
      });
    },
  },
  {
    name: 'crisis turn: a compose answered with the crisis line comes back as one, never as no week to build on the device',
    async run() {
      const client = loadLiveClient();
      const crisisAnswer = buildAiCoachPreviewAnswer('I want to die', CONTEXT, 'en');
      const brief = { brief: 'Goal: muscle. 3 days a week.', context: CONTEXT, language: 'en' };
      for (const payload of [
        { ok: true, source: 'preview', crisis: true, answer: crisisAnswer },
        { ok: true, source: 'preview', answer: crisisAnswer },
      ]) {
        await withFetch(200, payload, async () => {
          const composed = await client.requestProgrammeComposition(brief);
          assert.ok(composed && composed.crisis === true, 'a crisis answer read as a failed compose');
          assert.equal(composed.answer.takeaway, crisisAnswer.takeaway);
          assert.equal(client.isProgrammeCompositionCrisis(composed), true);
        });
      }
      // This build's filter reads the brief before it goes anywhere.
      await withFetch(200, {}, async (calls) => {
        const local = await client.requestProgrammeComposition({ ...brief, brief: 'Goal: muscle. I want to die.' });
        assert.equal(client.isProgrammeCompositionCrisis(local), true);
        assert.equal(calls.length, 0, 'a crisis brief left the phone');
      });
      // A week is still a week.
      const week = { title: 'W', sessions: [{ name: 'A', exercises: [] }] };
      await withFetch(200, { ok: true, proposal: week }, async () => {
        const composed = await client.requestProgrammeComposition(brief);
        assert.deepEqual(composed, week);
        assert.equal(client.isProgrammeCompositionCrisis(composed), false);
      });
    },
  },
  {
    name: 'crisis turn: the chat draws a server crisis answer as a crisis message, resets the history, and never calls it offline',
    run() {
      const code = strip(read('src', 'screens', 'AICoachChatScreen.tsx'));
      const send = code.slice(code.indexOf('const result = await requestAiCoachAdvice('), code.indexOf('const reply = answer.takeaway;'));
      const crisisAt = send.indexOf('if (result.crisis) {');
      assert.ok(crisisAt > 0, 'the answer is asked whether it was a crisis answer');
      const branch = send.slice(crisisAt, send.indexOf('return;', crisisAt));
      // Before the badge and the charges, which a crisis answer touches neither of.
      assert.ok(crisisAt < send.indexOf('setAnsweredOffline('), 'the crisis answer is read before the offline badge');
      assert.doesNotMatch(branch, /setAnsweredOffline|offlineAnswer|onQuestionUsed|onAdviceGiven|evidence/);
      // The history, through the one rule that empties it.
      assert.match(branch, /conversation\.current = coachHistoryAfterAnswer\(conversation\.current, trimmed, answer, true\);/);
      assert.ok(branch.indexOf('conversation.current =') < branch.indexOf('setMessages('), 'the history is reset before the thread is published');
      // Drawn under the online notice, the question with it.
      assert.match(branch, /crisis: true/);
      assert.match(branch, /`me:\$\{token\}` \? \{ \.\.\.message, crisis: true( as const)? \}/);
      // And every other answer goes through the same rule.
      assert.match(send, /conversation\.current = coachHistoryAfterAnswer\(conversation\.current, trimmed, answer, false\);/);
      assert.doesNotMatch(code, /appendCoachTurn\(/, 'a second path appends turns without the rule');
    },
  },
  {
    name: 'crisis turn: a compose answered with the crisis line draws the line in the chat, not a week',
    run() {
      const code = strip(read('src', 'screens', 'AICoachChatScreen.tsx'));
      const compose = code.slice(code.indexOf('composed = await onComposeProgramme(offer.brief, controller.signal);'));
      const crisisAt = compose.indexOf('if (isProgrammeCompositionCrisis(composed)) {');
      assert.ok(crisisAt > 0, 'the compose answer is asked whether it was a crisis answer');
      const branch = compose.slice(crisisAt, compose.indexOf('return;', crisisAt));
      assert.match(branch, /text: composed\.answer\.takeaway, advice: composed\.answer, crisis: true/);
      const home = strip(read('src', 'app', 'renderHomeScreens.tsx'));
      const builder = home.slice(home.indexOf('async function composeProgramme('), home.indexOf('async function saveProgramme('));
      const handedOn = builder.indexOf('if (isProgrammeCompositionCrisis(live)) {');
      assert.ok(handedOn > 0 && handedOn < builder.indexOf('composeProgrammePreview('), 'a crisis answer fell through to the device composer');
    },
  },
];
