const assert = require('node:assert/strict');

const {
  HAIKU_4_5_PRICING,
  SONNET_5_PRICING,
  TOKENIZER_FACTOR_VS_HAIKU_4_5,
  conversationCost,
  cacheBreakEvenQuestions,
  monthlyCost,
  grossMarginShare,
} = require('../../src/lib/aiCoachCostModel');

function profile(overrides) {
  return {
    label: 'test',
    prefixTokens: 2000,
    promptTokens: 50,
    outputTokens: 350,
    questionsPerConversation: 1,
    conversationsPerMonth: 10,
    ...overrides,
  };
}

module.exports = [
  {
    name: 'a single-question conversation costs more with caching than without',
    run() {
      // The finding the simulation exists to surface: a cache write is 1.25x
      // input, so the endpoint's cache_control is a surcharge until someone
      // asks a follow-up.
      const cost = conversationCost(profile({ questionsPerConversation: 1 }), HAIKU_4_5_PRICING);
      assert.ok(cost.cachedUsd > cost.uncachedUsd, 'one question should not benefit from a cache write');
    },
  },
  {
    name: 'caching wins from the second question onward',
    run() {
      const cost = conversationCost(profile({ questionsPerConversation: 2 }), HAIKU_4_5_PRICING);
      assert.ok(cost.cachedUsd < cost.uncachedUsd);
      assert.equal(cacheBreakEvenQuestions(HAIKU_4_5_PRICING), 2);
    },
  },
  {
    name: 'cache reads that are not cheaper than input make caching never pay',
    run() {
      const flat = { inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 1, outputPerMTok: 5 };
      assert.equal(cacheBreakEvenQuestions(flat), Number.POSITIVE_INFINITY);
    },
  },
  {
    name: 'prices come out of the model arithmetic, not a rounded guess',
    run() {
      const pricing = { inputPerMTok: 1, cacheWritePerMTok: 1, cacheReadPerMTok: 1, outputPerMTok: 1 };
      // With every rate at $1/MTok, one question costs (2000 + 50 + 350)/1e6.
      const cost = conversationCost(profile({ questionsPerConversation: 1 }), pricing);
      assert.equal(cost.uncachedUsd.toFixed(6), (2400 / 1e6).toFixed(6));
      assert.equal(cost.cachedUsd.toFixed(6), cost.uncachedUsd.toFixed(6));
    },
  },
  {
    name: 'a zero or negative question count is still charged as one call',
    run() {
      const cost = conversationCost(profile({ questionsPerConversation: 0 }), HAIKU_4_5_PRICING);
      const single = conversationCost(profile({ questionsPerConversation: 1 }), HAIKU_4_5_PRICING);
      assert.equal(cost.cachedUsd, single.cachedUsd);
    },
  },
  {
    name: 'monthly cost scales linearly and a fleet is just multiplication',
    run() {
      const monthly = monthlyCost(profile({ conversationsPerMonth: 10 }), HAIKU_4_5_PRICING);
      const double = monthlyCost(profile({ conversationsPerMonth: 20 }), HAIKU_4_5_PRICING);
      assert.ok(Math.abs(double.perUserUsd - monthly.perUserUsd * 2) < 1e-9);
      assert.ok(Math.abs(monthly.fleetUsd(1000) - monthly.perUserUsd * 1000) < 1e-6);
    },
  },
  {
    name: 'sonnet 5 is priced at exactly twice haiku, and costs more than twice as much',
    run() {
      // Production runs Sonnet 5 via AI_COACH_CLAUDE_MODEL, because Haiku's
      // answers were not good enough to ship (user decision 2026-08-23). The
      // rates are 2x Haiku's across every category — verified against
      // platform.claude.com pricing 2026-08-26.
      for (const key of ['inputPerMTok', 'cacheWritePerMTok', 'cacheReadPerMTok', 'outputPerMTok']) {
        assert.equal(
          SONNET_5_PRICING[key],
          HAIKU_4_5_PRICING[key] * 2,
          `${key} is no longer exactly 2x Haiku — re-read the pricing page`,
        );
      }

      // But 2x the rate is not 2x the bill. Claude 4.7 and later tokenize the
      // same text into about 30% more tokens, so the real multiplier is ~2.6x
      // and a comparison that skips this understates it by a quarter.
      assert.equal(TOKENIZER_FACTOR_VS_HAIKU_4_5['haiku-4-5'], 1);
      assert.ok(TOKENIZER_FACTOR_VS_HAIKU_4_5['sonnet-5'] > 1);

      const base = profile({ questionsPerConversation: 2 });
      const haiku = conversationCost(base, HAIKU_4_5_PRICING).cachedUsd;
      const factor = TOKENIZER_FACTOR_VS_HAIKU_4_5['sonnet-5'];
      const sonnet = conversationCost(
        {
          ...base,
          prefixTokens: Math.round(base.prefixTokens * factor),
          promptTokens: Math.round(base.promptTokens * factor),
          outputTokens: Math.round(base.outputTokens * factor),
        },
        SONNET_5_PRICING,
      ).cachedUsd;

      const ratio = sonnet / haiku;
      assert.ok(ratio > 2.5 && ratio < 2.7, `expected ~2.6x, got ${ratio.toFixed(2)}x`);
    },
  },
  {
    name: 'margin share treats a free tier as fully consumed rather than dividing by zero',
    run() {
      assert.equal(grossMarginShare(0.5, 0), 1);
      assert.equal(grossMarginShare(1, 10), 0.1);
    },
  },
];
