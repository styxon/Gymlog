const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The coach endpoint opens only to the app's key, and the app never calls it
 * without one (security review, 2026-09-14).
 *
 * The endpoint had no caller check: a public URL, `Access-Control-Allow-
 * Origin: *`, and a per-instance rate limit between any web page and the
 * Anthropic bill. The server side is pinned at the source, like the other
 * endpoint tests, because api/ is not compiled for Node; the client side is
 * exercised with a fake fetch.
 */

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The client module, loaded fresh under the given environment. */
function loadClient(env) {
  const saved = {};
  for (const key of ['EXPO_PUBLIC_AI_COACH_API_URL', 'EXPO_PUBLIC_AI_COACH_APP_KEY', 'NODE_ENV']) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  const modulePath = require.resolve(path.join(root, 'src', 'features', 'aiCoach', 'aiCoachClient.js'));
  delete require.cache[modulePath];
  delete require.cache[require.resolve(path.join(root, 'src', 'lib', 'aiCoachLiveGate.js'))];
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

/** A fetch that records what it was asked and answers as the endpoint would. */
function fakeFetch(status, payload) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { calls, fetch };
}

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

module.exports = [
  {
    name: 'coach key: the endpoint refuses every request without the key, and everyone when the key is unset',
    run() {
      const source = read('api', 'ai-coach.ts');
      const code = strip(source);
      assert.doesNotMatch(code, /Access-Control-Allow-Origin/, 'a web page can call the endpoint again');
      assert.doesNotMatch(code, /req\.method === 'OPTIONS'/);

      const check = code.slice(code.indexOf('function hasAppKey('), code.indexOf('function checkRateLimit('));
      assert.match(check, /const expected = process\.env\.AI_COACH_APP_KEY\?\.trim\(\);\s*if \(!expected\) \{\s*return false;/, 'an unset key opens the endpoint to everyone, or a pasted newline shuts it to everyone');
      assert.match(check, /\)\?\.trim\(\);/, 'the presented key is compared with its whitespace');
      assert.match(check, /req\.headers\[APP_KEY_HEADER\]/);
      assert.match(check, /a\.length === b\.length && timingSafeEqual\(a, b\)/, 'the comparison is not constant-time');
      assert.match(code, /const APP_KEY_HEADER = 'x-vinha-app-key';/);

      // Refused before the forget route, the image parser, the body parser and
      // the rate limit: a stranger's request costs one comparison.
      const handler = code.slice(code.indexOf('export default async function handler('));
      const refusal = handler.indexOf("res.status(401).json(createError({ code: 'UNAUTHORIZED'");
      // A stranger costs one comparison and no log line; only the server's own
      // misconfiguration is written down.
      const refusalBlock = handler.slice(handler.indexOf('if (!hasAppKey(req)) {'), refusal);
      assert.match(refusalBlock, /if \(!process\.env\.AI_COACH_APP_KEY\?\.trim\(\)\) \{\s*console\.error/);
      assert.ok(refusal > 0, 'no refusal');
      for (const later of ['readForgetLogId(req.body)', 'parseImageBody(req.body)', 'checkRateLimit(']) {
        assert.ok(handler.indexOf(later) > refusal, `${later} runs before the key is checked`);
      }
      assert.match(handler, /if \(!hasAppKey\(req\)\) \{/);
    },
  },
  {
    name: 'coach key: the app sends the key on every call, and never calls without one',
    async run() {
      const withKey = loadClient({
        EXPO_PUBLIC_AI_COACH_API_URL: 'https://example.test/api/ai-coach',
        EXPO_PUBLIC_AI_COACH_APP_KEY: 'k-1234567890',
        NODE_ENV: 'test',
      });
      assert.equal(withKey.isAiCoachLiveConfigured(), true);
      const live = fakeFetch(200, { ok: true, source: 'live', answer: { takeaway: 'ok' } });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = live.fetch;
      try {
        const answer = await withKey.requestAiCoachAdvice({ prompt: 'hei', context: CONTEXT, language: 'fi' });
        assert.equal(answer.source, 'live');
        const forget = await withKey.forgetAiCoachLog('0123456789abcdef');
        assert.equal(forget.ok, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(live.calls.length, 2);
      for (const call of live.calls) {
        assert.equal(call.init.headers['x-vinha-app-key'], 'k-1234567890', 'a call went out without the key');
      }

      // A build without the key is a preview build: no round trip at all, so
      // nothing is ever sent unauthenticated and nothing waits on a refusal.
      const withoutKey = loadClient({
        EXPO_PUBLIC_AI_COACH_API_URL: 'https://example.test/api/ai-coach',
        NODE_ENV: 'test',
      });
      assert.equal(withoutKey.isAiCoachLiveConfigured(), false);
      const untouched = fakeFetch(200, { ok: true });
      globalThis.fetch = untouched.fetch;
      try {
        const answer = await withoutKey.requestAiCoachAdvice({ prompt: 'hei', context: CONTEXT, language: 'fi' });
        assert.equal(answer.source, 'preview');
        // But a server it cannot open is not a server with nothing on it: an
        // earlier build may have kept copies there, so a withdrawal is not
        // done and the label has to stay.
        assert.deepEqual(await withoutKey.forgetAiCoachLog('0123456789abcdef'), { ok: false, removed: 0 });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(untouched.calls.length, 0, 'the app called the endpoint without a key');

      // No server at all: nothing was ever kept, and saying so is not a failure.
      const noServer = loadClient({ NODE_ENV: 'test' });
      assert.deepEqual(await noServer.forgetAiCoachLog('0123456789abcdef'), { ok: true, removed: 0 });
    },
  },
  {
    name: 'coach key: a refusal comes back as an offline answer, not an error on screen',
    async run() {
      const client = loadClient({
        EXPO_PUBLIC_AI_COACH_API_URL: 'https://example.test/api/ai-coach',
        EXPO_PUBLIC_AI_COACH_APP_KEY: 'stale-key',
        NODE_ENV: 'test',
      });
      const refused = fakeFetch(401, { ok: false, source: 'preview', error: { code: 'UNAUTHORIZED', message: 'Missing or wrong app key.' } });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = refused.fetch;
      try {
        const answer = await client.requestAiCoachAdvice({ prompt: 'hei', context: CONTEXT, language: 'fi' });
        assert.equal(answer.source, 'preview');
        assert.ok(answer.answer, 'no answer at all');
        const forget = await client.forgetAiCoachLog('0123456789abcdef');
        assert.deepEqual(forget, { ok: false, removed: 0 }, 'a refused withdrawal must not report the copies gone');
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  },
  {
    name: 'coach key: the consent label comes from the platform random source when there is one',
    run() {
      const { randomHex, randomLogId } = require('../../src/lib/aiCoachLogId');
      assert.match(randomLogId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      let asked = 0;
      const source = {
        getRandomValues(array) {
          asked += 1;
          for (let index = 0; index < array.length; index += 1) {
            array[index] = 0xab;
          }
          return array;
        },
      };
      assert.equal(randomHex(7, source), 'abababa');
      assert.equal(asked, 1, 'the strong source was there and was not used');
      // Only where there is none does Math.random stand in.
      assert.match(randomHex(12, undefined), /^[0-9a-f]{12}$/);
      assert.match(randomHex(12, {}), /^[0-9a-f]{12}$/);
      // Node has the strong source, so the default path takes it.
      assert.ok(typeof globalThis.crypto?.getRandomValues === 'function');
    },
  },
];
