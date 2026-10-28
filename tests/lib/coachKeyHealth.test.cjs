const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyCoachKeyProbe, coachKeyAlertText } = require('../../src/lib/coachKeyHealth');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/**
 * The daily coach key check (2026-09-14). The production key had been refused
 * by Anthropic for an unknown stretch — every answer the on-device fallback —
 * and nothing told anyone who could fix it.
 */
module.exports = [
  {
    name: 'coachKeyHealth: a refused or missing key alerts, a bad minute does not',
    run() {
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, status: 200 }), { state: 'ok', alert: false });
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, status: 401 }), { state: 'rejected', alert: true });
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, status: 403 }), { state: 'rejected', alert: true });
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: false, status: null }), { state: 'missing', alert: true });
      // Anthropic or the network having a bad minute: tomorrow's run asks again.
      for (const status of [null, 429, 500, 503, 529]) {
        assert.deepEqual(
          classifyCoachKeyProbe({ keyConfigured: true, status }),
          { state: 'unreachable', alert: false },
          `status ${status}`,
        );
      }
    },
  },
  {
    name: 'coachKeyHealth: the note names the status and the fix, and only when there is one',
    run() {
      const rejected = coachKeyAlertText({ state: 'rejected', alert: true }, 401);
      assert.match(rejected, /Anthropic vastasi 401/);
      assert.match(rejected, /ANTHROPIC_API_KEY/);
      assert.match(rejected, /Redeploy/);
      assert.match(coachKeyAlertText({ state: 'missing', alert: true }, null), /puuttuu/);
      assert.equal(coachKeyAlertText({ state: 'ok', alert: false }, 200), null);
      assert.equal(coachKeyAlertText({ state: 'unreachable', alert: false }, 503), null);
    },
  },
  {
    // The check said ok while a deploy without AI_COACH_APP_KEY refused every
    // request the app made, and while a key that could list models was
    // refused every real call (server audit, 2026-09-21).
    name: 'coachKeyHealth: a missing app key, and a call the key cannot make, alert too',
    run() {
      assert.deepEqual(
        classifyCoachKeyProbe({ keyConfigured: true, appKeyConfigured: false, status: 200 }),
        { state: 'app_key_missing', alert: true },
        'the coach refused every app request while its health said ok',
      );
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, appKeyConfigured: true, status: 200 }), { state: 'ok', alert: false });
      // A spend limit reached or credit gone (400), a model name that is no more (404).
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, appKeyConfigured: true, status: 400 }), { state: 'refused', alert: true });
      assert.deepEqual(classifyCoachKeyProbe({ keyConfigured: true, appKeyConfigured: true, status: 404 }), { state: 'refused', alert: true });

      const appKey = coachKeyAlertText({ state: 'app_key_missing', alert: true }, 200);
      assert.match(appKey, /AI_COACH_APP_KEY/);
      assert.match(appKey, /Redeploy/);
      const refused = coachKeyAlertText({ state: 'refused', alert: true }, 400, 'invalid_request_error: Your credit balance is too low');
      assert.match(refused, /400/);
      assert.match(refused, /credit balance is too low/, "Anthropic's own reason is what tells limit from model");
      assert.match(refused, /AI_COACH_CLAUDE_MODEL/);
    },
  },
  {
    name: 'coachKeyHealth: the endpoint asks the coach model for one token and checks the app key, run',
    async run() {
      const { callHandler, loadApiModule, withEnv } = require('../helpers/apiModule.cjs');
      const calls = [];
      let answer = { status: 200, body: { content: [] } };
      const savedFetch = global.fetch;
      const quiet = { log: console.log, error: console.error };
      global.fetch = async (url, init) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
      };
      console.log = () => undefined;
      console.error = () => undefined;
      try {
        await withEnv(
          { ANTHROPIC_API_KEY: 'sk-test', AI_COACH_APP_KEY: 'app-key', CRON_SECRET: 'cron', SLACK_WEBHOOK_BUGS: undefined, AI_COACH_CLAUDE_MODEL: undefined },
          async () => {
            const check = async () => {
              const { default: handler } = loadApiModule('api/coach-health.ts');
              return callHandler(handler, { method: 'GET', headers: { authorization: 'Bearer cron' }, query: { notify: '0' } });
            };
            const healthy = await check();
            assert.equal(healthy.status, 200);
            assert.equal(healthy.body.state, 'ok');
            // The coach's own call, as small as a call gets.
            assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
            assert.equal(calls[0].body.max_tokens, 1);
            assert.equal(calls[0].body.model, 'claude-haiku-4-5-20251001');

            // A spend limit reached: the key lists models, and every call is refused.
            answer = { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' } } };
            const limited = await check();
            assert.equal(limited.status, 503, 'the coach was offline while its health said ok');
            assert.equal(limited.body.state, 'refused');

            answer = { status: 200, body: { content: [] } };
            process.env.AI_COACH_APP_KEY = '   ';
            const noAppKey = await check();
            assert.equal(noAppKey.status, 503);
            assert.equal(noAppKey.body.state, 'app_key_missing');
          },
        );
      } finally {
        global.fetch = savedFetch;
        console.log = quiet.log;
        console.error = quiet.error;
      }
    },
  },
  {
    name: 'coachKeyHealth: the endpoint is scheduled daily, spends one token and never leaks the key',
    run() {
      const config = JSON.parse(read('vercel.json'));
      const cron = (config.crons ?? []).find((entry) => entry.path === '/api/coach-health');
      assert.ok(cron, 'vercel.json must schedule /api/coach-health');
      // The Hobby plan refuses anything more often than daily, at deploy time.
      assert.match(cron.schedule, /^\d{1,2} \d{1,2} \* \* \*$/, `schedule "${cron.schedule}" is not a fixed daily run`);

      const source = read('api', 'coach-health.ts');
      // One token in and out of the coach's own model: a few thousandths of a
      // cent a day, and it sees what the free model list could not — a spend
      // limit, spent credit, a model that is gone (server audit, 2026-09-21).
      assert.match(source, /https:\/\/api\.anthropic\.com\/v1\/messages/);
      assert.match(source, /max_tokens: 1,/);
      assert.doesNotMatch(source, /max_tokens: (?!1,)\d/, 'the daily check must stay a one-token call');
      assert.doesNotMatch(source, /\bsystem:|\btools:/);
      assert.match(source, /classifyCoachKeyProbe\(/);
      assert.match(source, /coachKeyAlertText\(/);
      // The coach and the check resolve the model the same way.
      assert.match(source, /process\.env\.AI_COACH_CLAUDE_MODEL \?\? AI_COACH_DEFAULT_MODEL/);
      assert.match(read('api', 'ai-coach.ts'), /process\.env\.AI_COACH_CLAUDE_MODEL \?\? AI_COACH_DEFAULT_MODEL/);

      // Only the cron or a person with the reader secret may run it.
      assert.match(source, /process\.env\.CRON_SECRET/);
      assert.match(source, /if \(!authorized\(req\)\) \{\s*res\.status\(401\)/);

      // The alert goes where the reader already looks, through the channel's own webhook.
      assert.match(source, /process\.env\.SLACK_WEBHOOK_BUGS/);

      // The key goes into the request header and nowhere else.
      const keyUses = source.match(/\bapiKey\b/g) ?? [];
      assert.ok(keyUses.length > 0);
      for (const line of source.split('\n').filter((l) => /\bapiKey\b/.test(l))) {
        assert.doesNotMatch(line, /console\.|\.json\(|JSON\.stringify|text/, `the key may leak on: ${line.trim()}`);
      }
      assert.doesNotMatch(source, /console\.[a-z]+\([^)]*ANTHROPIC_API_KEY/);
    },
  },
];
