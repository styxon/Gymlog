/**
 * How many programs of your own you may keep on the free tier.
 *
 * The cap is on AUTHORING, never on the log and never on the catalog. Both
 * leaders in this category cap saved routines — Hevy at 4, Strong at 3 — and
 * their paying users say almost unanimously that this is what they paid for,
 * in those words: "I upgraded purely just so I can create multiple workouts."
 * Nobody cites the charts.
 *
 * Three things this cap deliberately does NOT touch:
 *
 * - Ready programs. All 61 stay free and switchable, because the catalog's own
 *   copy invites you to browse and swap, and a cap on choosing would punish
 *   exploring rather than authoring. The funnel is the moment you want a ready
 *   program changed: that duplicates into one of your own, and THAT is the
 *   slot. "I want it my way" is the documented buying moment; "let me see what
 *   else there is" is not.
 * - Your log. Sessions, sets and history are never capped in either tier.
 * - What you already made. See `canCreate` below.
 */

export const FREE_CUSTOM_PROGRAM_LIMIT = 3;

/**
 * How many of these templates the cap should count.
 *
 * A freestyle session has to be stored against a template, so every "empty
 * workout" logged left one behind — and the cap counted it. Three ad-hoc
 * sessions filled the free tier without the user authoring anything, and then
 * the limit sheet said "this is a limit on building, not on training" while
 * being, in that exact state, a limit on training. Worse: the check throws, so
 * the fourth freestyle session could not be saved at all and its sets were
 * lost.
 *
 * So the count is of AUTHORED programs, which is what the copy has always
 * claimed and what the market evidence is actually about.
 */
export function countAuthoredPrograms(
  templates: readonly { origin?: 'authored' | 'freestyle' }[],
): number {
  return templates.filter((template) => template.origin !== 'freestyle').length;
}

export interface ProgramSlots {
  used: number;
  /** Null when there is no limit — a Pro account. */
  limit: number | null;
  /** False only when a NEW program would exceed the limit. */
  canCreate: boolean;
  /** True when the user is already over the limit and nothing was taken away. */
  overLimit: boolean;
}

/**
 * Hevy's rule, deliberately: a user who is over the cap keeps everything they
 * built and can still edit it — only creating another is blocked.
 *
 * Taking something back is the one move that turns a pricing change into a
 * grievance. Hevy removed a shipped feature once and had to restore it after
 * the backlash ("we realized we made a mistake in calibrating the impact of
 * its removal"), and their own community documents the workaround where a
 * lapsed subscriber keeps the routines they made while paying. So: the cap
 * gates the next one, never the ones you have.
 */
export function resolveProgramSlots(customProgramCount: number, proUnlocked: boolean): ProgramSlots {
  const used = Math.max(0, customProgramCount);
  if (proUnlocked) {
    return { used, limit: null, canCreate: true, overLimit: false };
  }
  return {
    used,
    limit: FREE_CUSTOM_PROGRAM_LIMIT,
    canCreate: used < FREE_CUSTOM_PROGRAM_LIMIT,
    overLimit: used > FREE_CUSTOM_PROGRAM_LIMIT,
  };
}

/** Thrown when a create is attempted past the cap, so no caller can miss it. */
export class ProgramLimitReachedError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`Free programs are limited to ${limit}`);
    this.name = 'ProgramLimitReachedError';
    this.limit = limit;
  }
}

/**
 * The line above "your programmes", or null when there is nothing worth saying.
 *
 * Same rule as the running-programme line on Home (lib/programCapNotice): a
 * count nobody is near is a sign about nothing, so it appears only with one
 * place left and at the wall. The point is that the limit sheet never arrives
 * as news. Pro has no limit and no line.
 */
export function programSlotsLineKey(slots: ProgramSlots): 'lastPlace' | 'atCap' | null {
  if (slots.limit === null) {
    return null;
  }
  if (slots.used >= slots.limit) {
    return 'atCap';
  }
  return slots.used === slots.limit - 1 ? 'lastPlace' : null;
}
