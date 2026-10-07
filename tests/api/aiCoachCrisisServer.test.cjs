const assert = require('node:assert/strict');

const { callHandler, loadApiModule, withEnv } = require('../helpers/apiModule.cjs');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * The server's crisis check, run rather than read (F1 crisis hunt, 2026-10-08).
 *
 * The check read only the new question. A crisis it caught came back on the
 * next request as `history` — every build appended the answered turn — and
 * went to the model as a user message for up to three turns. And a compose
 * brief skipped the check entirely, so the intake's free-text answer reached
 * the composer from any build whose own filter missed it. Both are the older
 * installs the server check exists for. Run against the endpoint with
 * Anthropic replaced by a fake that counts its calls.
 */
async function withCoach(scenario) {
  const upstream = [];
  const savedFetch = global.fetch;
  global.fetch = async (url, init) => {
    upstream.push({ url, body: JSON.parse(init.body) });
    return { ok: false, status: 500, text: async () => 'stub', json: async () => ({}) };
  };
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    await withEnv({ AI_COACH_APP_KEY: 'app-key', ANTHROPIC_API_KEY: 'sk-test' }, async () => {
      const blob = { async put() { return {}; }, async list() { return { blobs: [], hasMore: false }; }, async del() {} };
      const { default: handler } = loadApiModule('api/ai-coach.ts', { '@vercel/blob': blob });
      const post = (body) => callHandler(handler, { method: 'POST', headers: { 'x-vinha-app-key': 'app-key' }, body });
      await scenario({ post, upstream });
    });
  } finally {
    global.fetch = savedFetch;
    console.warn = quiet.warn;
    console.error = quiet.error;
  }
}

function assertCrisisAnswer(response, language) {
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.source, 'preview', 'no model wrote it, so nothing is charged for it');
  assert.equal(response.body.answer.takeaway, t(language, 'coachPreview.crisis.takeaway'));
}

module.exports = [
  {
    name: 'crisis server: a crisis in the history is answered as one, and the model is not called',
    async run() {
      await withCoach(async ({ post, upstream }) => {
        // Turn one, as an older build sends it: the server catches it.
        const first = await post({ prompt: 'I want to die', context: {}, language: 'en' });
        assertCrisisAnswer(first, 'en');
        assert.equal(upstream.length, 0);

        // Turn two carries turn one back, the way every build appended it.
        const history = [{ question: 'I want to die', takeaway: first.body.answer.takeaway }];
        const second = await post({ prompt: 'how many sets for chest?', context: {}, language: 'en', history });
        assertCrisisAnswer(second, 'en');
        assert.equal(upstream.length, 0, 'a crisis in the history reached the model');

        // Anywhere in the three turns kept, and in Finnish.
        const deeper = await post({
          prompt: 'entä jalat?',
          context: {},
          language: 'fi',
          history: [
            { question: 'halusin kuolla', takeaway: 'x' },
            { question: 'paljonko sarjoja rintaan?', takeaway: 'Kymmenen viikossa.' },
            { question: 'entä selkä?', takeaway: 'Saman verran.' },
          ],
        });
        assertCrisisAnswer(deeper, 'fi');
        assert.equal(upstream.length, 0);
      });
    },
  },
  {
    name: 'crisis server: the history check stands before the rate limit',
    async run() {
      await withCoach(async ({ post, upstream }) => {
        // Spend the window on ordinary questions until the limit answers.
        let limited = null;
        for (let index = 0; index < 100 && !limited; index += 1) {
          const answer = await post({ prompt: `how many sets for chest? ${index}`, context: {}, language: 'en' });
          if (answer.status === 429) {
            limited = answer;
          }
        }
        assert.ok(limited, 'the rate limit never answered');
        const calls = upstream.length;
        const crisis = await post({
          prompt: 'and legs?',
          context: {},
          language: 'en',
          history: [{ question: 'I wanted to die', takeaway: 'x' }],
        });
        assertCrisisAnswer(crisis, 'en');
        assert.equal(upstream.length, calls);
      });
    },
  },
  {
    name: 'crisis server: an ordinary history still reaches the model',
    async run() {
      await withCoach(async ({ post, upstream }) => {
        await post({
          prompt: 'and legs?',
          context: {},
          language: 'en',
          history: [{ question: 'how many sets for chest?', takeaway: 'Ten a week.' }],
        });
        assert.equal(upstream.length, 1, 'the check refused a conversation with no crisis in it');
        assert.equal(upstream[0].body.messages[0].content, 'how many sets for chest?');
      });
    },
  },
  {
    name: 'crisis server: a compose brief with a crisis in it is answered as one, and the composer is not called',
    async run() {
      await withCoach(async ({ post, upstream }) => {
        // The intake brief, with the free-text answer last.
        const en = await post({
          mode: 'compose',
          prompt: 'Goal: muscle. 3 days a week. 45 minutes. Full gym. Intermediate. I took all my pills and want to die.',
          context: {},
          language: 'en',
          keepConsent: true,
          logId: '0123abcd-0000-4000-8000-00000000000a',
        });
        assertCrisisAnswer(en, 'en');
        // An older build reads no proposal here and composes on the device.
        assert.equal(en.body.proposal, undefined);
        const fi = await post({
          mode: 'compose',
          prompt: 'Tavoite: lihas. 3 päivää viikossa. 45 minuuttia. Kuntosali. Keskitaso. Halusin kuolla.',
          context: {},
          language: 'fi',
        });
        assertCrisisAnswer(fi, 'fi');
        assert.equal(upstream.length, 0, 'a crisis brief reached the composer');

        // An ordinary brief still does.
        await post({ mode: 'compose', prompt: 'Goal: muscle. 3 days a week.', context: {}, language: 'en' });
        assert.equal(upstream.length, 1);
      });
    },
  },
];
