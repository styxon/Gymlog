#!/usr/bin/env node
/**
 * Runs the coach scenario matrix against the live endpoint and saves every
 * answer for a person to read.
 *
 *   node scripts/eval-ai-coach-matrix.cjs --out coach-eval.jsonl
 *   node scripts/eval-ai-coach-matrix.cjs --out coach-eval.jsonl --report   # score saved answers, no calls
 *
 * Money first. Every case is one paid model call (~$0.03-0.05 on Sonnet 5),
 * taken from the same balance that answers real readers. So:
 *
 * - --max-calls caps the run (default 40); the runner never spends past it.
 * - Each answer is appended to --out the moment it arrives, and a rerun skips
 *   cases already in the file — a run that stops halfway has lost nothing,
 *   and continuing it costs only the cases still missing.
 * - An upstream failure that repeats stops the run instead of retrying down
 *   the list. An empty balance looks exactly like that, and every further
 *   call would fail the same way.
 *
 * Needs AI_COACH_API_URL and AI_COACH_APP_KEY; falls back to the
 * EXPO_PUBLIC_ pair in .env.local at the repo root.
 */
require('./registerTs.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { AI_COACH_EVAL_MATRIX, scoreMatrixCase } = require('../src/lib/aiCoachEvalMatrix');
const { scoreRun, formatRunReport } = require('../src/lib/aiCoachEval');

const COST_PER_CALL_USD = 0.04;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function readEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

const outFile = arg('out', null);
const maxCalls = Number(arg('max-calls', 40));
// NaN would make the cap compare false forever, and this script spends money.
if (!Number.isInteger(maxCalls) || maxCalls < 0) {
  console.error('--max-calls needs a whole number, e.g. --max-calls 10');
  process.exit(1);
}
const only = arg('only', null)?.split(',');
const reportOnly = process.argv.includes('--report');

if (!outFile) {
  console.error('--out <file.jsonl> is required: the answers are the point of the run.');
  process.exit(1);
}

const envLocal = readEnvLocal();
const endpoint = process.env.AI_COACH_API_URL ?? envLocal.EXPO_PUBLIC_AI_COACH_API_URL;
const appKey = process.env.AI_COACH_APP_KEY ?? envLocal.EXPO_PUBLIC_AI_COACH_APP_KEY ?? '';

const RATE_LIMIT_MAX = Number(process.env.AI_COACH_RATE_LIMIT_MAX ?? 12);
const RATE_WINDOW_MS = Number(process.env.AI_COACH_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);
const budget = { windowStartedAt: 0, used: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveRequestSlot() {
  const now = Date.now();
  if (budget.windowStartedAt === 0 || now - budget.windowStartedAt >= RATE_WINDOW_MS) {
    budget.windowStartedAt = now;
    budget.used = 0;
  }
  if (budget.used >= RATE_LIMIT_MAX - 1) {
    const waitMs = budget.windowStartedAt + RATE_WINDOW_MS - now + 2000;
    console.log(`  rate window full — waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    budget.windowStartedAt = Date.now();
    budget.used = 0;
  }
  budget.used += 1;
}

function savedAnswers() {
  if (!fs.existsSync(outFile)) return new Map();
  const saved = new Map();
  for (const line of fs.readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    saved.set(entry.id, entry);
  }
  return saved;
}

let callsMade = 0;

/** One case: the answer, or a reason the run has to stop. */
async function ask(evalCase) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (callsMade >= maxCalls) return { stop: `reached --max-calls ${maxCalls}` };
    await reserveRequestSlot();
    callsMade += 1;
    const startedAt = Date.now();
    let response;
    let payload;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vinha-app-key': appKey },
        body: JSON.stringify({
          prompt: evalCase.prompt,
          context: evalCase.context,
          ...(evalCase.history ? { history: evalCase.history } : {}),
          language: evalCase.language,
        }),
      });
      payload = await response.json();
    } catch (error) {
      payload = { ok: false, error: { code: 'NETWORK', message: String(error) } };
    }
    const ms = Date.now() - startedAt;
    if (response?.status === 401) return { stop: 'the endpoint refused the app key' };
    if (payload.ok) return { answer: payload.answer, ms };

    const code = payload.error?.code ?? 'UNKNOWN';
    const message = payload.error?.message ?? '';
    if (code === 'RATE_LIMIT' && attempt === 1) {
      console.log(`  ${evalCase.id}: rate limited — waiting out the window`);
      await sleep(RATE_WINDOW_MS + 2000);
      budget.windowStartedAt = Date.now();
      budget.used = 0;
      continue;
    }
    if (attempt === 1) {
      console.warn(`  ${evalCase.id}: ${code} ${message} — retrying once`);
      continue;
    }
    return { stop: `${evalCase.id}: ${code} twice (${message}). An empty balance looks like this.` };
  }
  return { stop: 'unreachable' };
}

function writeReview(saved) {
  const results = [];
  const lines = ['# Coach scenario matrix — answers', ''];
  for (const evalCase of AI_COACH_EVAL_MATRIX) {
    const entry = saved.get(evalCase.id);
    if (!entry) continue;
    const result = scoreMatrixCase(evalCase, entry.answer);
    results.push(result);
    const a = entry.answer;
    lines.push(`## ${evalCase.id} (${evalCase.profile}) — ${result.passed}/${result.total}`);
    lines.push('');
    lines.push(`**Q:** ${evalCase.prompt}`);
    if (evalCase.history) lines.push(`**Previous:** ${evalCase.history.map((h) => `${h.question} → ${h.takeaway}`).join(' / ')}`);
    lines.push(`**Good answer:** ${evalCase.goodAnswer}`);
    lines.push('');
    lines.push(`> ${a.takeaway}`);
    for (const [label, list] of [['why', a.why], ['next', a.nextSteps], ['plan', a.plan], ['assumptions', a.assumptions]]) {
      if (list && list.length > 0) lines.push(`- _${label}:_ ${list.join(' · ')}`);
    }
    if (a.unanswered) lines.push('- _unanswered:_ true');
    const failed = result.checks.filter((check) => !check.passed);
    if (failed.length > 0) lines.push(`- **failed:** ${failed.map((c) => `${c.check} (${c.detail})`).join('; ')}`);
    lines.push(`- _latency:_ ${Math.round(entry.ms / 100) / 10}s`);
    lines.push('');
  }
  const reviewFile = outFile.replace(/\.jsonl$/, '') + '.review.md';
  fs.writeFileSync(reviewFile, lines.join('\n'));
  return { run: scoreRun(results), reviewFile };
}

async function main() {
  const saved = savedAnswers();
  const cases = AI_COACH_EVAL_MATRIX.filter((entry) => !only || only.includes(entry.id));
  const todo = cases.filter((entry) => !saved.has(entry.id));

  if (!reportOnly) {
    if (!endpoint) throw new Error('No endpoint: set AI_COACH_API_URL or EXPO_PUBLIC_AI_COACH_API_URL in .env.local');
    const planned = Math.min(todo.length, maxCalls);
    console.log(
      `${cases.length} cases, ${saved.size} already saved, ${todo.length} to ask. ` +
        `Cap ${maxCalls} calls ≈ $${(planned * COST_PER_CALL_USD).toFixed(2)} at most without retries.`,
    );
    for (const evalCase of todo) {
      const result = await ask(evalCase);
      if (result.stop) {
        console.log(`\nSTOPPED: ${result.stop}`);
        break;
      }
      const entry = { id: evalCase.id, at: new Date().toISOString(), ms: result.ms, answer: result.answer };
      fs.appendFileSync(outFile, JSON.stringify(entry) + '\n');
      saved.set(evalCase.id, entry);
      console.log(`  ${evalCase.id}  ${Math.round(result.ms / 100) / 10}s  (${callsMade} calls)`);
    }
    console.log(`\n${callsMade} paid calls this run ≈ $${(callsMade * COST_PER_CALL_USD).toFixed(2)}`);
  }

  const { run, reviewFile } = writeReview(saved);
  console.log(`\nVinha Coach scenario matrix — ${run.cases.length}/${cases.length} answered\n`);
  console.log(formatRunReport(run));
  console.log(`\nAnswers for reading: ${reviewFile}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
