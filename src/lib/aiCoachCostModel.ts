/**
 * What the coach endpoint actually costs to run.
 *
 * The inputs that matter are not guesses: `scripts/simulate-coach-cost.cjs`
 * builds real training contexts with the same buildAiCoachSystemContext the
 * endpoint sends, measures them, and feeds the token counts through this
 * model. Nothing here estimates a payload size — it prices one.
 *
 * PRICES ARE A CONSTANT, NOT A FACT. Verify HAIKU_4_5_PRICING against
 * anthropic.com/pricing before trusting a number this produces; a model or
 * tier change moves every figure downstream.
 */

interface ModelPricing {
  /** USD per million uncached input tokens. */
  inputPerMTok: number;
  /** USD per million tokens written to the prompt cache. */
  cacheWritePerMTok: number;
  /** USD per million tokens read from the prompt cache. */
  cacheReadPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/** Claude Haiku 4.5, the model api/ai-coach.ts defaults to. */
export const HAIKU_4_5_PRICING: ModelPricing = {
  inputPerMTok: 1,
  // 5-minute ephemeral cache: writes cost 1.25x input, reads 0.1x.
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
  outputPerMTok: 5,
};

/**
 * Claude Sonnet 5 — what production actually runs.
 *
 * `AI_COACH_CLAUDE_MODEL` overrides the Haiku default in the deployed
 * environment, because Haiku's answers were not good enough to ship (user
 * decision 2026-08-23). Every rate is exactly 2x Haiku's, verified against
 * platform.claude.com/docs/en/about-claude/pricing on 2026-08-26.
 */
export const SONNET_5_PRICING: ModelPricing = {
  inputPerMTok: 2,
  cacheWritePerMTok: 2.5,
  cacheReadPerMTok: 0.2,
  outputPerMTok: 10,
};

/**
 * How many tokens the same text costs on this model, relative to Haiku 4.5.
 *
 * Price per token is only half of a model switch. Claude 4.7 and later ship a
 * different tokenizer that produces roughly 30% more tokens for identical
 * text, so a context measured in Haiku tokens understates Sonnet 5's bill even
 * before the per-token rate is applied. Sonnet 4.6 and earlier use the old
 * tokenizer and sit at 1.0.
 *
 * Approximate by construction: the real figure depends on the text. Vinha's
 * payload is mostly exercise names, numbers and Finnish, which the old
 * tokenizer already split badly, so 1.3 is the conservative end.
 */
export const TOKENIZER_FACTOR_VS_HAIKU_4_5: Record<'haiku-4-5' | 'sonnet-5', number> = {
  'haiku-4-5': 1,
  'sonnet-5': 1.3,
};

interface CoachUsageProfile {
  label: string;
  /**
   * Tokens in the cacheable prefix — tool schema, coach rules, and this user's
   * serialized training context. Everything before the cache breakpoint.
   */
  prefixTokens: number;
  /** Tokens in one typed question. */
  promptTokens: number;
  /** Tokens the model returns. Bounded by maxOutputTokens. */
  outputTokens: number;
  /**
   * Questions asked before the cache entry expires. The first one always pays
   * a miss; the rest hit. 1 means the user asks once and closes the sheet.
   */
  questionsPerConversation: number;
  /** Conversations a Pro user starts per month. */
  conversationsPerMonth: number;
}

interface ConversationCost {
  /** USD for one conversation, with the endpoint's cache_control in place. */
  cachedUsd: number;
  /** USD for the same conversation with no prompt caching at all. */
  uncachedUsd: number;
}

const PER_MTOK = 1_000_000;

/**
 * One conversation, priced both ways.
 *
 * Caching is not free: a write costs 1.25x what the same tokens cost uncached,
 * so a user who asks exactly one question and leaves pays MORE with caching
 * on. It only wins once a conversation has follow-ups, which is why this
 * returns both numbers rather than assuming the answer.
 */
export function conversationCost(
  profile: CoachUsageProfile,
  pricing: ModelPricing = HAIKU_4_5_PRICING,
): ConversationCost {
  const questions = Math.max(1, Math.round(profile.questionsPerConversation));
  const followUps = questions - 1;

  const promptUsd = (profile.promptTokens * questions * pricing.inputPerMTok) / PER_MTOK;
  const outputUsd = (profile.outputTokens * questions * pricing.outputPerMTok) / PER_MTOK;

  const cachedPrefixUsd =
    (profile.prefixTokens * pricing.cacheWritePerMTok) / PER_MTOK +
    (profile.prefixTokens * followUps * pricing.cacheReadPerMTok) / PER_MTOK;

  const uncachedPrefixUsd = (profile.prefixTokens * questions * pricing.inputPerMTok) / PER_MTOK;

  return {
    cachedUsd: cachedPrefixUsd + promptUsd + outputUsd,
    uncachedUsd: uncachedPrefixUsd + promptUsd + outputUsd,
  };
}

/**
 * How many questions a conversation needs before caching is cheaper.
 *
 * Below this, the endpoint's cache_control is costing money rather than saving
 * it. Returns Infinity when reads are not cheaper than input, which would make
 * caching never pay.
 */
export function cacheBreakEvenQuestions(pricing: ModelPricing = HAIKU_4_5_PRICING): number {
  const savedPerHit = pricing.inputPerMTok - pricing.cacheReadPerMTok;
  if (savedPerHit <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const writePremium = pricing.cacheWritePerMTok - pricing.inputPerMTok;
  // First question pays the premium; each later one saves. Break even is the
  // first whole question count where the savings cover it.
  return 1 + Math.ceil(writePremium / savedPerHit);
}

interface MonthlyCost {
  perUserUsd: number;
  perUserCentsRounded: number;
  /** Cost for a fleet of Pro users, USD/month. */
  fleetUsd: (users: number) => number;
}

export function monthlyCost(
  profile: CoachUsageProfile,
  pricing: ModelPricing = HAIKU_4_5_PRICING,
  useCaching = true,
): MonthlyCost {
  const cost = conversationCost(profile, pricing);
  const perConversation = useCaching ? cost.cachedUsd : cost.uncachedUsd;
  const perUserUsd = perConversation * profile.conversationsPerMonth;

  return {
    perUserUsd,
    perUserCentsRounded: Math.round(perUserUsd * 100 * 10) / 10,
    fleetUsd: (users: number) => perUserUsd * users,
  };
}

/**
 * The share of a subscription price that goes to the model.
 *
 * This is the number that decides whether the tier is viable, and the one that
 * has to survive the worst-behaved user rather than the average one.
 */
export function grossMarginShare(perUserUsd: number, subscriptionUsd: number): number {
  if (subscriptionUsd <= 0) {
    return 1;
  }
  return perUserUsd / subscriptionUsd;
}
