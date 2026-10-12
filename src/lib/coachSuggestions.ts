import { getRollingWindowStart } from './completedSessions';

/**
 * When the coach may offer something, and when it must stop asking.
 *
 * A coach that proposes things is the point — "shall I put that measurement on
 * your home screen?" is what separates a coach from a search box. A coach that
 * proposes the same thing every conversation is a nag, and the reader learns to
 * ignore the button.
 *
 * So a refusal is treated as an answer, not as a "later": the first no buys a
 * month of silence, the second one buys silence for good. Accepting also ends
 * it — the thing is now on, and offering to turn on what is already on is the
 * sign that explains a sign.
 */

export type CoachSuggestionKind = 'pin_stat_card' | 'set_goal' | 'weigh_in_reminder' | 'log_measurement';

export interface CoachSuggestionRecord {
  /** How many times this kind of offer has been turned down. */
  rejectedCount: number;
  /** ISO date of the most recent refusal, for the cooling-off month. */
  lastRejectedAt: string | null;
  /** ISO date it was taken up. Set once; the offer never returns after it. */
  acceptedAt: string | null;
}

export type CoachSuggestionState = Partial<Record<CoachSuggestionKind, CoachSuggestionRecord>>;

export const COACH_SUGGESTION_KINDS: CoachSuggestionKind[] = [
  'pin_stat_card',
  'set_goal',
  'weigh_in_reminder',
  'log_measurement',
];

/**
 * A month. Long enough that the second offer feels like a new conversation
 * rather than the same one repeated; short enough that a reader who said no
 * while busy is asked again once.
 */
export const SUGGESTION_COOLDOWN_DAYS = 30;

/** Two refusals is an answer. There is no third offer. */
const MAX_REJECTIONS = 2;

export function isSuggestionSilenced(
  state: CoachSuggestionState | null | undefined,
  kind: CoachSuggestionKind,
  now: Date = new Date(),
): boolean {
  const record = state?.[kind];
  if (!record) {
    return false;
  }
  if (record.acceptedAt) {
    return true;
  }
  if (record.rejectedCount >= MAX_REJECTIONS) {
    return true;
  }
  if (record.rejectedCount > 0 && record.lastRejectedAt) {
    // The month in calendar days (getRollingWindowStart), not 720 hours: across
    // a clock change the fixed span ends an hour off the time of day it claims
    // (duplicate sweep, 2026-10-12). A date that does not parse silences
    // nothing, as before.
    return new Date(record.lastRejectedAt).getTime() > getRollingWindowStart(now, SUGGESTION_COOLDOWN_DAYS);
  }
  return false;
}

/**
 * The kinds that must not be offered right now. This travels in the training
 * context so the model never proposes them in the first place — filtering a
 * suggestion out after it arrives would mean paying for an offer that is
 * thrown away.
 */
export function silencedSuggestionKinds(
  state: CoachSuggestionState | null | undefined,
  now: Date = new Date(),
): CoachSuggestionKind[] {
  return COACH_SUGGESTION_KINDS.filter((kind) => isSuggestionSilenced(state, kind, now));
}

export function recordSuggestionRejected(
  state: CoachSuggestionState | null | undefined,
  kind: CoachSuggestionKind,
  now: Date = new Date(),
): CoachSuggestionState {
  const record = state?.[kind];
  return {
    ...(state ?? {}),
    [kind]: {
      rejectedCount: (record?.rejectedCount ?? 0) + 1,
      lastRejectedAt: now.toISOString(),
      acceptedAt: record?.acceptedAt ?? null,
    },
  };
}

export function recordSuggestionAccepted(
  state: CoachSuggestionState | null | undefined,
  kind: CoachSuggestionKind,
  now: Date = new Date(),
): CoachSuggestionState {
  const record = state?.[kind];
  return {
    ...(state ?? {}),
    [kind]: {
      rejectedCount: record?.rejectedCount ?? 0,
      lastRejectedAt: record?.lastRejectedAt ?? null,
      acceptedAt: now.toISOString(),
    },
  };
}
