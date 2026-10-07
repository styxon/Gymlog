#!/usr/bin/env node
/**
 * Runs the coach evaluation set and prints one score (execution-plan A3).
 *
 *   npx tsc -p tsconfig.test.json
 *   node scripts/eval-ai-coach.cjs              # scores the offline preview
 *   node scripts/eval-ai-coach.cjs --live       # scores the deployed endpoint
 *
 * The number is the point: change a prompt, run this, compare. Preview mode
 * needs no network and no key, so the harness is useful before the endpoint
 * is even deployed — it scores whatever answer generator you point it at.
 *
 * --live posts to $AI_COACH_API_URL with $AI_COACH_APP_KEY (the endpoint refuses
 * calls without it) and costs real money, one call per case.
 *
 *   node scripts/eval-ai-coach.cjs --live --only crisis-,heavy-
 *
 * runs the cases whose id starts with one of the prefixes — the crisis set on
 * its own, after a change to the server's crisis rule.
 */
const { AI_COACH_EVAL_CASES } = require('../.test-dist/lib/aiCoachEvalCases.js');
const { scoreCase, scoreRun, formatRunReport } = require('../.test-dist/lib/aiCoachEval.js');
const { buildAiCoachPreviewAnswer } = require('../.test-dist/lib/aiCoachPreview.js');

const live = process.argv.includes('--live');
const endpoint = process.env.AI_COACH_API_URL;

/**
 * `--only a,b` or `--only=a,b`. A flag that is there but says nothing stops
 * the run: ignored, it would spend the whole paid set on a typo.
 */
function readOnlyPrefixes(argv) {
  const at = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
  if (at < 0) return [];
  const value = argv[at].startsWith('--only=') ? argv[at].slice('--only='.length) : argv[at + 1];
  const prefixes = (value ?? '').split(',').map((prefix) => prefix.trim()).filter(Boolean);
  if (prefixes.length === 0 || prefixes.some((prefix) => prefix.startsWith('--'))) {
    throw new Error('--only needs case id prefixes, e.g. --only crisis-,heavy-');
  }
  return prefixes;
}

/**
 * The endpoint allows 12 requests per 10 minutes from one address, and a phone
 * on the same network shares them. The full set (22 cases since the crisis
 * cases, 2026-10-07) never fits one window, and even a nine-case run did not
 * once a slow call was retried: thirteen requests on nine cases, stopped on
 * the tenth.
 *
 * So the runner counts what it spends and waits for the window rather than
 * walking into the wall. One slot is held back for a retry.
 */
const RATE_LIMIT_MAX = Number(process.env.AI_COACH_RATE_LIMIT_MAX ?? 12);
const RATE_WINDOW_MS = Number(process.env.AI_COACH_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);
const budget = { windowStartedAt: 0, used: 0 };
/** Slowest call of the run, so a timeout is a measurement rather than a surprise. */
const timings = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reserveRequestSlot() {
  const now = Date.now();
  if (budget.windowStartedAt === 0 || now - budget.windowStartedAt >= RATE_WINDOW_MS) {
    budget.windowStartedAt = now;
    budget.used = 0;
  }
  // One held back: a retry must not be the request that trips the limit.
  if (budget.used >= RATE_LIMIT_MAX - 1) {
    const waitMs = budget.windowStartedAt + RATE_WINDOW_MS - now + 2000;
    console.log(`  rate window full (${budget.used} used) — waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    budget.windowStartedAt = Date.now();
    budget.used = 0;
  }
  budget.used += 1;
}

async function answerFor(evalCase, retry = false) {
  if (!live) {
    return buildAiCoachPreviewAnswer(evalCase.prompt, evalCase.context, evalCase.language);
  }

  if (!endpoint) {
    throw new Error('--live needs AI_COACH_API_URL');
  }

  await reserveRequestSlot();
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vinha-app-key': process.env.AI_COACH_APP_KEY ?? '' },
    body: JSON.stringify({
      prompt: evalCase.prompt,
      context: evalCase.context,
      // A follow-up case is only a follow-up if the exchange goes with it.
      ...(evalCase.history ? { history: evalCase.history } : {}),
      ...(evalCase.language ? { language: evalCase.language } : {}),
    }),
  });
  const payload = await response.json();
  timings.push({ id: evalCase.id, ms: Date.now() - startedAt });
  if (response.status === 401) {
    // Not transient and not the prompt's fault: the run cannot start.
    throw new Error('the endpoint refused the app key — set AI_COACH_APP_KEY to the server\'s value');
  }

  // A fallback answer is not the live coach; scoring it would quietly report
  // the preview's number as if the endpoint had produced it.
  if (!payload.ok) {
    const code = payload.error?.code ?? 'an error';
    // A cold function or a slow model call is not a verdict on the prompt.
    // One blip used to discard the whole run — the cases already answered,
    // and the money they cost — so a transient failure gets one retry.
    // A rate limit is not transient on that timescale: retrying immediately
    // just spends another slot, so it stops the run and says why.
    if (code === 'RATE_LIMIT') {
      // The runner's own count can start mid-window — the server has been
      // answering somebody else, a phone on the same address most likely. So
      // this waits the window out and tries once more rather than throwing
      // away the cases already answered.
      if (retry) {
        throw new Error(
          `${evalCase.id}: still rate limited after waiting. Something else on this address is ` +
            'using the endpoint; stop it, or wait ten minutes and run again.',
        );
      }
      console.log(`  ${evalCase.id}: rate limited — waiting ${Math.ceil(RATE_WINDOW_MS / 1000)}s for the window`);
      await sleep(RATE_WINDOW_MS + 2000);
      budget.windowStartedAt = Date.now();
      budget.used = 0;
      return answerFor(evalCase, true);
    }
    if (retry) {
      throw new Error(`${evalCase.id}: endpoint returned ${code} twice`);
    }
    console.warn(`  ${evalCase.id}: ${code}, retrying once`);
    return answerFor(evalCase, true);
  }
  return payload.answer;
}

async function main() {
  const onlyPrefixes = readOnlyPrefixes(process.argv);
  const results = [];
  const skipped = [];
  for (const evalCase of AI_COACH_EVAL_CASES) {
    if (onlyPrefixes.length > 0 && !onlyPrefixes.some((prefix) => evalCase.id.startsWith(prefix))) {
      continue;
    }
    // The preview is a keyword mock with no branch for a goal or a body
    // measurement. Scoring those cases offline would move the number for
    // reasons that have nothing to do with the prompt.
    if (!live && evalCase.liveOnly) {
      skipped.push(evalCase.id);
      continue;
    }
    const answer = await answerFor(evalCase);
    results.push(scoreCase(evalCase, answer));
  }

  // Nothing scored is not a pass. A prefix that matches nothing, or a live-only
  // set run offline, used to print SCORE 100% (0/0) and exit 0.
  if (results.length === 0) {
    throw new Error(
      `no case was scored${onlyPrefixes.length > 0 ? ` for --only ${onlyPrefixes.join(',')}` : ''}` +
        (skipped.length > 0 ? ` (${skipped.length} live only — add --live)` : ''),
    );
  }

  const run = scoreRun(results);
  console.log(`\nVinha Coach eval — ${live ? 'LIVE endpoint' : 'offline preview'}\n`);
  console.log(formatRunReport(run));
  if (timings.length > 0) {
    const slowest = [...timings].sort((left, right) => right.ms - left.ms)[0];
    const total = timings.reduce((sum, entry) => sum + entry.ms, 0);
    console.log(
      `
latency: ${Math.round(total / timings.length / 100) / 10}s average, ` +
        `slowest ${Math.round(slowest.ms / 100) / 10}s (${slowest.id}), ${timings.length} requests`,
    );
  }
  if (skipped.length > 0) {
    // Said out loud: a set that quietly shrinks reads as full coverage.
    console.log(`\n${skipped.length} case(s) skipped, live only: ${skipped.join(', ')}`);
  }
  console.log('');

  // Non-zero exit on any failure so this can gate a prompt change in CI.
  process.exitCode = run.failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
