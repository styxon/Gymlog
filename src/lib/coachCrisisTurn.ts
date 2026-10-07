/**
 * A crisis exchange, which never becomes conversation history.
 *
 * The chat's own crisis branch never appended its turn, but an answer the
 * server gave instead was appended like any other: an installed build whose
 * filter is older than the server's sends the message, the server answers it
 * with the crisis answer, and the next question carried that message back to
 * the model as history (F1 crisis hunt, 2026-10-08). So a turn is a crisis
 * turn by either side — a question this build's filter reads as one, or the
 * crisis answer in either language, which is how a server with a newer filter
 * says it caught something this build did not.
 */
import { classifyCoachScope } from './aiCoachScope';
import { t } from './i18n';
import type { AICoachConversationTurn } from '../types/aiCoach';

const CRISIS_TAKEAWAYS = new Set([
  t('fi', 'coachPreview.crisis.takeaway').trim(),
  t('en', 'coachPreview.crisis.takeaway').trim(),
]);

export function isCoachCrisisTurn(turn: Partial<AICoachConversationTurn> | null | undefined): boolean {
  if (!turn || typeof turn !== 'object') {
    return false;
  }
  if (typeof turn.takeaway === 'string' && CRISIS_TAKEAWAYS.has(turn.takeaway.trim())) {
    return true;
  }
  return typeof turn.question === 'string' && classifyCoachScope(turn.question) === 'crisis';
}

/** The history with every crisis turn taken out, for a thread reopened from memory. */
export function withoutCoachCrisisTurns<TTurn extends Partial<AICoachConversationTurn>>(turns: readonly TTurn[]): TTurn[] {
  return turns.filter((turn) => !isCoachCrisisTurn(turn));
}
