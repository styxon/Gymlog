/**
 * Spend controls for the coach endpoint (execution-plan A2).
 *
 * What this can and cannot do, stated plainly, because the difference matters:
 *
 * The endpoint is a stateless serverless function. Nothing here survives a
 * cold start, so an in-process counter is a brake, not a ceiling — a burst
 * spread across fresh instances slips past it. The only true ceiling is the
 * spend limit set on the Anthropic Console, which is a manual step and is
 * documented as such in docs/ai-coach-backend.md.
 *
 * What IS enforceable per request, and is enforced here:
 *
 * - A bound on how large a single call can get. This is the real lever: the
 *   response is already capped by max_tokens, but the request carries eight
 *   weeks of training history, and a client can post whatever it likes. An
 *   unbounded prompt is an unbounded bill.
 * - A per-instance budget in tokens, so the brake is denominated in the thing
 *   that actually costs money rather than in request count. Ten enormous
 *   requests should exhaust it faster than ten small ones.
 *
 * Everything here is pure so it can be tested without a network or a clock.
 */

import { PROGRAM_IMAGE_MAX_BASE64_CHARS } from './programImageImport';

/** Rough chars-per-token for budgeting. Deliberately pessimistic. */
const CHARS_PER_TOKEN = 3.5;

/**
 * The longest question the endpoint forwards, in characters — and the chat
 * box's own limit. The box had none, so a pasted paragraph went out, was
 * refused as oversized, and came back as the offline badge (server audit,
 * 2026-09-21). A question the reader can type is one the endpoint takes.
 */
export const AI_COACH_MAX_PROMPT_CHARS = 2000;

/**
 * The most one image can cost as input, in tokens, whatever its size.
 *
 * The API scales a larger picture down before the model reads it — to about
 * 1,600 tokens on models that read 1568 px on the long edge (Haiku 4.5, the
 * default), about 4,800 on the high-resolution ones. The model is a setting,
 * so the budget books the larger. Base64 length says nothing about this: a
 * photo was charged as a third of its characters, ~100,000 "prompt
 * characters" against a 2,000 cap, and every real photo was refused.
 */
export const IMAGE_INPUT_TOKEN_CEILING = 4800;

interface AiCoachBudgetLimits {
  /** Largest prompt the endpoint will forward, in characters. */
  maxPromptChars: number;
  /**
   * Largest open conversation it forwards with a question, in characters.
   * Its own limit, not the question's: three earlier exchanges ride with a
   * follow-up, and counted against the question's cap they pushed a reader
   * mid-conversation offline.
   */
  maxHistoryChars: number;
  /**
   * Largest training context it will forward, in characters: the reader's
   * data as sent, not the endpoint's own fixed rules, which are the same on
   * every request and were eating half of this.
   */
  maxContextChars: number;
  /** Output cap handed to the model. */
  maxOutputTokens: number;
  /** Tokens this instance may spend before it starts refusing. */
  instanceTokenBudget: number;
  /** How long a budget window lasts. */
  windowMs: number;
}

export const DEFAULT_BUDGET_LIMITS: AiCoachBudgetLimits = {
  maxPromptChars: AI_COACH_MAX_PROMPT_CHARS,
  // Three exchanges of up to 600 characters a side: what the endpoint's own
  // sanitizeHistory keeps, so a history it has trimmed always fits.
  maxHistoryChars: 3 * 2 * 600,
  // The reader's context alone. A heavy one at every client cap renders near
  // 20 KB (tests/lib/aiCoachContextCap); the client sheds past this
  // (fitAiCoachContextToCap), and a crafted payload still cannot run away.
  maxContextChars: 24000,
  // 700 cut Finnish answers off mid-JSON (a takeaway, reasons, steps and a
  // plan run long in an inflected language) and the app fell back to
  // preview. Still a hard cap on the expensive half of the call.
  maxOutputTokens: 1200,
  // ~1.5M tokens per window per instance. Generous for real use, and still a
  // bound rather than an open tap.
  instanceTokenBudget: 1_500_000,
  windowMs: 60 * 60 * 1000,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type BudgetRejection =
  | { reason: 'prompt_too_large'; limit: number; actual: number }
  | { reason: 'history_too_large'; limit: number; actual: number }
  | { reason: 'context_too_large'; limit: number; actual: number }
  | { reason: 'image_too_large'; limit: number; actual: number }
  | { reason: 'budget_exhausted'; resetAt: number };

interface BudgetDecision {
  allowed: boolean;
  rejection: BudgetRejection | null;
  /** Tokens this call is expected to cost, input + capped output. */
  estimatedTokens: number;
}

export interface BudgetState {
  spentTokens: number;
  windowResetAt: number;
}

export function createBudgetState(now: number, limits = DEFAULT_BUDGET_LIMITS): BudgetState {
  return { spentTokens: 0, windowResetAt: now + limits.windowMs };
}

/**
 * Decides whether a call may proceed and what it is expected to cost.
 *
 * Size checks come first: an oversized request is refused outright rather than
 * charged against the budget, so one bad client cannot starve everyone else.
 *
 * Each part is measured against its own limit (server audit, 2026-09-21). The
 * question, the open conversation and the reader's context are what a client
 * sends and can inflate. `fixedChars` is the endpoint's own rules text — the
 * same on every request, and nothing a client controls — so it is charged in
 * tokens and never refused: counted against the context cap, it left the
 * reader under half of it, and a heavy but honest reader answered offline.
 */
export function checkBudget(
  input: { promptChars: number; contextChars: number; historyChars?: number; fixedChars?: number },
  state: BudgetState,
  now: number,
  limits: AiCoachBudgetLimits = DEFAULT_BUDGET_LIMITS,
): BudgetDecision {
  const historyChars = input.historyChars ?? 0;
  const fixedChars = input.fixedChars ?? 0;
  if (input.promptChars > limits.maxPromptChars) {
    return {
      allowed: false,
      rejection: { reason: 'prompt_too_large', limit: limits.maxPromptChars, actual: input.promptChars },
      estimatedTokens: 0,
    };
  }

  if (historyChars > limits.maxHistoryChars) {
    return {
      allowed: false,
      rejection: { reason: 'history_too_large', limit: limits.maxHistoryChars, actual: historyChars },
      estimatedTokens: 0,
    };
  }

  if (input.contextChars > limits.maxContextChars) {
    return {
      allowed: false,
      rejection: { reason: 'context_too_large', limit: limits.maxContextChars, actual: input.contextChars },
      estimatedTokens: 0,
    };
  }

  const estimatedTokens =
    Math.ceil((input.promptChars + historyChars + input.contextChars + fixedChars) / CHARS_PER_TOKEN) +
    limits.maxOutputTokens;
  return withinWindow(estimatedTokens, state, now, limits);
}

/**
 * The same decision for a photo: its own size check, and a charge in tokens.
 *
 * A picture is not prompt text, and measuring it as text refused every real
 * photo — a phone photo downscaled to 1600 px is 200–500 thousand base64
 * characters, and it was checked against the 2,000-character question cap
 * (server audit, 2026-09-21). Its size is checked against the import's own
 * limit, and it is charged what the model is charged for it at most.
 */
export function checkImageBudget(
  input: { imageBase64Chars: number; fixedChars: number },
  state: BudgetState,
  now: number,
  limits: AiCoachBudgetLimits = DEFAULT_BUDGET_LIMITS,
): BudgetDecision {
  if (input.imageBase64Chars > PROGRAM_IMAGE_MAX_BASE64_CHARS) {
    return {
      allowed: false,
      rejection: { reason: 'image_too_large', limit: PROGRAM_IMAGE_MAX_BASE64_CHARS, actual: input.imageBase64Chars },
      estimatedTokens: 0,
    };
  }
  const estimatedTokens =
    IMAGE_INPUT_TOKEN_CEILING + Math.ceil(input.fixedChars / CHARS_PER_TOKEN) + limits.maxOutputTokens;
  return withinWindow(estimatedTokens, state, now, limits);
}

function withinWindow(
  estimatedTokens: number,
  state: BudgetState,
  now: number,
  limits: AiCoachBudgetLimits,
): BudgetDecision {
  // A window that has elapsed is treated as empty; the caller rolls it over.
  const spent = now >= state.windowResetAt ? 0 : state.spentTokens;
  if (spent + estimatedTokens > limits.instanceTokenBudget) {
    return {
      allowed: false,
      rejection: { reason: 'budget_exhausted', resetAt: state.windowResetAt },
      estimatedTokens,
    };
  }

  return { allowed: true, rejection: null, estimatedTokens };
}

/** Rolls the window when it has elapsed, then books the spend. */
export function recordSpend(
  state: BudgetState,
  tokens: number,
  now: number,
  limits: AiCoachBudgetLimits = DEFAULT_BUDGET_LIMITS,
): BudgetState {
  if (now >= state.windowResetAt) {
    return { spentTokens: tokens, windowResetAt: now + limits.windowMs };
  }
  return { spentTokens: state.spentTokens + tokens, windowResetAt: state.windowResetAt };
}

export function readBudgetLimitsFromEnv(
  env: Record<string, string | undefined>,
  base: AiCoachBudgetLimits = DEFAULT_BUDGET_LIMITS,
): AiCoachBudgetLimits {
  const num = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    maxPromptChars: num(env.AI_COACH_MAX_PROMPT_CHARS, base.maxPromptChars),
    maxHistoryChars: num(env.AI_COACH_MAX_HISTORY_CHARS, base.maxHistoryChars),
    maxContextChars: num(env.AI_COACH_MAX_CONTEXT_CHARS, base.maxContextChars),
    maxOutputTokens: num(env.AI_COACH_CLAUDE_MAX_TOKENS, base.maxOutputTokens),
    instanceTokenBudget: num(env.AI_COACH_TOKEN_BUDGET, base.instanceTokenBudget),
    windowMs: num(env.AI_COACH_BUDGET_WINDOW_MS, base.windowMs),
  };
}
