const assert = require('node:assert/strict');

const {
  DEFAULT_BUDGET_LIMITS,
  IMAGE_INPUT_TOKEN_CEILING,
  checkBudget,
  checkImageBudget,
  createBudgetState,
  estimateTokens,
  readBudgetLimitsFromEnv,
  recordSpend,
} = require('../../src/lib/aiCoachBudget');
const { PROGRAM_IMAGE_MAX_BASE64_CHARS } = require('../../src/lib/programImageImport');

const NOW = 1_700_000_000_000;

function state(overrides = {}) {
  return { ...createBudgetState(NOW), ...overrides };
}

module.exports = [
  {
    name: 'budget: an oversized prompt is refused, not charged',
    run() {
      const decision = checkBudget(
        { promptChars: DEFAULT_BUDGET_LIMITS.maxPromptChars + 1, contextChars: 100 },
        state(),
        NOW,
      );

      assert.equal(decision.allowed, false);
      assert.equal(decision.rejection.reason, 'prompt_too_large');
      // Refused before costing anything — one bad client must not be able to
      // drain the shared budget by posting garbage.
      assert.equal(decision.estimatedTokens, 0);
    },
  },
  {
    name: 'budget: an oversized context is refused — this is the real lever',
    run() {
      const decision = checkBudget(
        { promptChars: 50, contextChars: DEFAULT_BUDGET_LIMITS.maxContextChars + 1 },
        state(),
        NOW,
      );

      assert.equal(decision.allowed, false);
      assert.equal(decision.rejection.reason, 'context_too_large');
      assert.equal(decision.estimatedTokens, 0);
    },
  },
  {
    name: "budget: the app's own worst-case payload still fits",
    run() {
      // The history block caps near 5 KB and the whole prompt text measured
      // ~3.1 KB on eight weeks of real training. A limit that rejected honest
      // traffic would just push everyone to the preview fallback.
      const decision = checkBudget({ promptChars: 400, contextChars: 8000 }, state(), NOW);
      assert.equal(decision.allowed, true);
      assert.equal(decision.rejection, null);
    },
  },
  {
    name: 'budget: cost is denominated in tokens, not requests',
    run() {
      const small = checkBudget({ promptChars: 100, contextChars: 500 }, state(), NOW);
      const large = checkBudget({ promptChars: 1900, contextChars: 20000 }, state(), NOW);

      assert.ok(large.estimatedTokens > small.estimatedTokens * 5);
      // Output is always part of the estimate; a request is never free.
      assert.ok(small.estimatedTokens >= DEFAULT_BUDGET_LIMITS.maxOutputTokens);
    },
  },
  {
    name: 'budget: the window refuses once exhausted and reopens after it elapses',
    run() {
      const nearlySpent = state({
        spentTokens: DEFAULT_BUDGET_LIMITS.instanceTokenBudget - 10,
      });

      const blocked = checkBudget({ promptChars: 100, contextChars: 500 }, nearlySpent, NOW);
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.rejection.reason, 'budget_exhausted');
      assert.equal(blocked.rejection.resetAt, nearlySpent.windowResetAt);

      // Past the reset the same call is fine again.
      const afterReset = checkBudget(
        { promptChars: 100, contextChars: 500 },
        nearlySpent,
        nearlySpent.windowResetAt + 1,
      );
      assert.equal(afterReset.allowed, true);
    },
  },
  {
    name: 'budget: spend accumulates within a window and rolls over past it',
    run() {
      let current = state();
      current = recordSpend(current, 1000, NOW);
      current = recordSpend(current, 500, NOW + 1000);
      assert.equal(current.spentTokens, 1500);
      assert.equal(current.windowResetAt, NOW + DEFAULT_BUDGET_LIMITS.windowMs);

      const rolled = recordSpend(current, 200, current.windowResetAt + 1);
      assert.equal(rolled.spentTokens, 200, 'a new window starts from this call alone');
      assert.ok(rolled.windowResetAt > current.windowResetAt);
    },
  },
  {
    name: 'budget: limits come from the environment, and junk values fall back',
    run() {
      const configured = readBudgetLimitsFromEnv({
        AI_COACH_MAX_PROMPT_CHARS: '500',
        AI_COACH_TOKEN_BUDGET: '250000',
      });
      assert.equal(configured.maxPromptChars, 500);
      assert.equal(configured.instanceTokenBudget, 250000);
      assert.equal(configured.maxContextChars, DEFAULT_BUDGET_LIMITS.maxContextChars);

      // A misconfigured deploy must not silently disable the ceiling.
      for (const bad of ['0', '-1', 'lots', '', undefined]) {
        const limits = readBudgetLimitsFromEnv({ AI_COACH_TOKEN_BUDGET: bad });
        assert.equal(limits.instanceTokenBudget, DEFAULT_BUDGET_LIMITS.instanceTokenBudget, `bad value: ${bad}`);
      }
    },
  },
  {
    // Every photo import was refused (server audit, 2026-09-21): a third of
    // its base64 length was checked as prompt text against the 2,000-character
    // question cap, and a 1600 px JPEG is 200–500 thousand characters.
    name: 'budget: a real photo is charged what the model charges for it, not refused as text',
    run() {
      const photo = checkImageBudget({ imageBase64Chars: 450_000, fixedChars: 3000 }, state(), NOW);
      assert.equal(photo.allowed, true, `a real photo was refused: ${JSON.stringify(photo.rejection)}`);
      // The API scales a large picture down, so its cost has a ceiling.
      assert.equal(photo.estimatedTokens, IMAGE_INPUT_TOKEN_CEILING + Math.ceil(3000 / 3.5) + DEFAULT_BUDGET_LIMITS.maxOutputTokens);
      assert.equal(checkImageBudget({ imageBase64Chars: 2_000_000, fixedChars: 3000 }, state(), NOW).estimatedTokens, photo.estimatedTokens);

      // Its own size limit — the import's — refused before anything is charged.
      const huge = checkImageBudget({ imageBase64Chars: PROGRAM_IMAGE_MAX_BASE64_CHARS + 1, fixedChars: 3000 }, state(), NOW);
      assert.equal(huge.allowed, false);
      assert.equal(huge.rejection.reason, 'image_too_large');
      assert.equal(huge.estimatedTokens, 0);

      // And the window still brakes it.
      const spent = checkImageBudget(
        { imageBase64Chars: 450_000, fixedChars: 3000 },
        state({ spentTokens: DEFAULT_BUDGET_LIMITS.instanceTokenBudget - 100 }),
        NOW,
      );
      assert.equal(spent.rejection.reason, 'budget_exhausted');
    },
  },
  {
    // The endpoint's ~11 KB of rules were counted against the reader's 24 KB
    // context cap, and three earlier exchanges against the question's 2,000
    // characters: a heavy reader, or one mid-conversation, went offline
    // (server audit, 2026-09-21).
    name: 'budget: fixed rules are charged but never refused, and the conversation has its own limit',
    run() {
      const full = checkBudget(
        {
          promptChars: DEFAULT_BUDGET_LIMITS.maxPromptChars,
          historyChars: DEFAULT_BUDGET_LIMITS.maxHistoryChars,
          contextChars: DEFAULT_BUDGET_LIMITS.maxContextChars,
          fixedChars: 12_000,
        },
        state(),
        NOW,
      );
      assert.equal(full.allowed, true, `refused: ${JSON.stringify(full.rejection)}`);
      const withoutRules = checkBudget(
        { promptChars: DEFAULT_BUDGET_LIMITS.maxPromptChars, historyChars: DEFAULT_BUDGET_LIMITS.maxHistoryChars, contextChars: DEFAULT_BUDGET_LIMITS.maxContextChars },
        state(),
        NOW,
      );
      assert.ok(full.estimatedTokens - withoutRules.estimatedTokens >= Math.floor(12_000 / 3.5), 'the rules must still be paid for');

      const longThread = checkBudget(
        { promptChars: 100, historyChars: DEFAULT_BUDGET_LIMITS.maxHistoryChars + 1, contextChars: 500 },
        state(),
        NOW,
      );
      assert.equal(longThread.rejection.reason, 'history_too_large');
      assert.equal(longThread.estimatedTokens, 0);

      assert.equal(readBudgetLimitsFromEnv({ AI_COACH_MAX_HISTORY_CHARS: '900' }).maxHistoryChars, 900);
      assert.equal(readBudgetLimitsFromEnv({}).maxHistoryChars, DEFAULT_BUDGET_LIMITS.maxHistoryChars);
    },
  },
  {
    name: 'budget: the token estimate is pessimistic rather than flattering',
    run() {
      // Under-estimating is what lets a bill escape, so the ratio must not be
      // generous. 100 chars of English is ~25 real tokens; we count ~29.
      assert.ok(estimateTokens('x'.repeat(100)) >= 28);
      assert.equal(estimateTokens(''), 0);
    },
  },
];
