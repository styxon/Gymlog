const assert = require('node:assert/strict');

const { callHandler, loadApiModule, withEnv } = require('../helpers/apiModule.cjs');
const { heavyCoachContext } = require('../helpers/coachContextFixture.cjs');
const { PROGRAM_IMAGE_MAX_BASE64_CHARS, PROGRAM_TABLE_TOOL_NAME } = require('../../src/lib/programImageImport');

/**
 * The coach endpoint's size limits, run (server audit, 2026-09-21).
 *
 * Three ways an honest request was refused before it reached the model, each
 * answered with the offline reply: every photo import (measured as prompt
 * text), a heavy reader's context (measured together with the endpoint's own
 * rules), and a follow-up question (measured together with the conversation).
 * And a refused photo was filed as a kept copy all the same. Run against the
 * endpoint with Anthropic and the blob store replaced by fakes.
 */

const LOG_ID = '0123abcd-0000-4000-8000-00000000000a';

/**
 * Copies are off in the product (aiCoachLogId COACH_COPIES_KEPT, 2026-09-30),
 * but the write path stays tested for the day they come back: these cases
 * switch it on for their run unless they say otherwise.
 */
async function withCoach(env, scenario, { copiesKept = true } = {}) {
  const logIdModule = require('../../src/lib/aiCoachLogId');
  const savedCopies = logIdModule.COACH_COPIES_KEPT;
  logIdModule.COACH_COPIES_KEPT = copiesKept;
  const kept = [];
  const upstream = [];
  const blob = {
    async put(pathname, body) {
      kept.push({ pathname, record: JSON.parse(body) });
      return { etag: '"t"' };
    },
    async list() {
      return { blobs: [], hasMore: false };
    },
    async del() {},
  };
  const savedFetch = global.fetch;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    upstream.push({ url, body });
    const tool = body.tool_choice.name;
    const input =
      tool === PROGRAM_TABLE_TOOL_NAME
        ? { rows: [{ day: 'Day 1', exercise: 'Bench Press', sets: 3, reps: '8' }] }
        : { takeaway: 'Keep going.', why: [], nextSteps: [], plan: [], assumptions: [] };
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: tool, input }] }) };
  };
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    await withEnv({ AI_COACH_APP_KEY: 'app-key', ANTHROPIC_API_KEY: 'sk-test', ...env }, async () => {
      const { default: handler } = loadApiModule('api/ai-coach.ts', { '@vercel/blob': blob });
      const post = (body) => callHandler(handler, { method: 'POST', headers: { 'x-vinha-app-key': 'app-key' }, body });
      await scenario({ post, kept, upstream });
    });
  } finally {
    logIdModule.COACH_COPIES_KEPT = savedCopies;
    global.fetch = savedFetch;
    console.warn = quiet.warn;
    console.error = quiet.error;
  }
}

/** A photo's worth of base64: a 1600 px JPEG at quality 0.7 is 200–500 thousand characters. */
const photo = (chars) => ({
  mode: 'table',
  mediaType: 'image/jpeg',
  dataBase64: 'A'.repeat(chars),
  keepConsent: true,
  logId: LOG_ID,
});

module.exports = [
  {
    name: 'coach endpoint: with copies off nothing is kept, whatever an older app sends',
    async run() {
      assert.equal(require('../../src/lib/aiCoachLogId').COACH_COPIES_KEPT, false);
      await withCoach({}, async ({ post, kept, upstream }) => {
        const read = await post(photo(300_000));
        assert.equal(read.status, 200);
        const asked = await post({ prompt: 'How is my bench going?', context: heavyCoachContext(), keepConsent: true, logId: LOG_ID });
        assert.equal(asked.status, 200);
        assert.equal(upstream.length, 2, 'both reached the model');
        assert.deepEqual(kept, [], 'a copy was kept with copies off');
      }, { copiesKept: false });
    },
  },
  {
    name: 'coach endpoint: a real photo is read, and one over the import limit is refused and not kept',
    async run() {
      await withCoach({}, async ({ post, kept, upstream }) => {
        const read = await post(photo(450_000));
        assert.equal(read.status, 200, `a real photo was refused: ${JSON.stringify(read.body?.error)}`);
        assert.equal(read.body.rows.length, 1);
        assert.equal(upstream.length, 1);
        assert.equal(upstream[0].body.messages[0].content[0].type, 'image');
        // The reader allowed photos to be kept, and this one reached the model.
        assert.equal(kept.length, 1);
        assert.equal(kept[0].record.kind, 'photo');

        const tooBig = await post(photo(PROGRAM_IMAGE_MAX_BASE64_CHARS + 1));
        assert.equal(tooBig.status, 400);
        assert.equal(upstream.length, 1, 'an oversized photo was sent upstream');
        assert.equal(kept.length, 1, 'a refused photo was kept');
      });
    },
  },
  {
    name: 'coach endpoint: a request the budget refuses is not kept, photo or question',
    async run() {
      // A budget smaller than any one call: everything is refused before the model.
      await withCoach({ AI_COACH_TOKEN_BUDGET: '500' }, async ({ post, kept, upstream }) => {
        const refusedPhoto = await post(photo(300_000));
        const refusedQuestion = await post({
          prompt: 'How is my bench going?',
          context: heavyCoachContext(),
          keepConsent: true,
          logId: LOG_ID,
        });
        assert.equal(upstream.length, 0);
        assert.deepEqual(kept.map((entry) => entry.record.kind), [], 'a request the model never saw was filed as a kept copy');
        assert.equal(refusedPhoto.status, 429);
        assert.equal(refusedQuestion.body.error.code, 'RATE_LIMIT');
      });
    },
  },
  {
    name: 'coach endpoint: a heavy reader mid-conversation is answered by the model',
    async run() {
      await withCoach({}, async ({ post, upstream }) => {
        const turn = (index) => ({ question: `${'q'.repeat(598)}${index}?`, takeaway: `${'a'.repeat(598)}${index}.` });
        const answer = await post({
          prompt: `${'Why has my bench stalled '.repeat(76)}?`,
          context: heavyCoachContext(),
          history: [turn(1), turn(2), turn(3)],
          language: 'en',
        });
        assert.equal(answer.status, 200, `refused before the model: ${JSON.stringify(answer.body?.error)}`);
        assert.equal(answer.body.source, 'live');
        assert.equal(upstream.length, 1);
        // The whole conversation went with it.
        assert.equal(upstream[0].body.messages.length, 7);
      });
    },
  },
];
