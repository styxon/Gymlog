/**
 * A crisis exchange, which never becomes conversation history.
 *
 * The chat's own crisis branch never appended its turn, but an answer the
 * server gave instead was appended like any other: an installed build whose
 * filter is older than the server's sends the message, the server answers it
 * with the crisis answer, and the next question carried that message back to
 * the model as history (F1 crisis hunt, 2026-10-08).
 *
 * The server says it caught something with `crisis: true` on the answer, and
 * an older server only with the words of the crisis answer, so both count.
 * What it caught may be the new question or a turn of the history, and only
 * the server knows which: so a crisis answer to a question this build passes
 * empties the history. Skipping the append alone left the turn the server
 * caught in the thread, and every question after it got the crisis line for
 * the eight hours a thread lives (review, 2026-10-08).
 */
import { classifyCoachScope } from './aiCoachScope';
import { appendCoachTurn } from './coachConversation';
import { t } from './i18n';
import type { AICoachConversationTurn } from '../types/aiCoach';

const CRISIS_TAKEAWAYS = new Set([
  t('fi', 'coachPreview.crisis.takeaway').trim(),
  t('en', 'coachPreview.crisis.takeaway').trim(),
]);

/** The crisis answer's own sentence, in either language. */
export function isCoachCrisisTakeaway(takeaway: unknown): boolean {
  return typeof takeaway === 'string' && CRISIS_TAKEAWAYS.has(takeaway.trim());
}

/**
 * Whether an answer is the crisis answer: marked so by the server, or, from a
 * server older than the marker, in its words.
 */
export function isCoachCrisisReply(reply: { crisis?: unknown; takeaway?: unknown } | null | undefined): boolean {
  if (!reply || typeof reply !== 'object') {
    return false;
  }
  return reply.crisis === true || isCoachCrisisTakeaway(reply.takeaway);
}

/**
 * The history to send with the next question, after this one was answered.
 *
 * An ordinary answer is appended. A crisis answer never is; and when this
 * build's filter passed the question, what the server caught may be in any
 * turn this thread would send again, so none of them is kept.
 */
export function coachHistoryAfterAnswer(
  history: readonly AICoachConversationTurn[],
  question: string,
  answer: { takeaway: string },
  crisis: boolean,
): AICoachConversationTurn[] {
  if (!crisis) {
    return appendCoachTurn([...history], { question, takeaway: answer.takeaway });
  }
  return classifyCoachScope(question) === 'crisis' ? [...history] : [];
}

/**
 * A thread reopened from memory, without the crisis exchanges it holds.
 *
 * Read by the stored answer, not by today's filter: a turn the coach answered
 * live is kept even when a widened filter now reads its question as a crisis.
 * Dropping it would leave the next question with no antecedent, and the
 * server takes it out before the model if it must (coachHistoryBeforeCrisis).
 */
export function withoutCoachCrisisTurns<TTurn extends Partial<AICoachConversationTurn>>(turns: readonly TTurn[]): TTurn[] {
  return turns.filter((turn) => !(turn && typeof turn === 'object' && isCoachCrisisTakeaway(turn.takeaway)));
}

/**
 * The history the model may read: the turns before the first crisis turn.
 *
 * A crisis turn is a question this filter reads as one, or a turn the crisis
 * answer closed. Everything after it goes too, since a later turn may answer
 * it; the new question is then answered without them rather than with the
 * crisis line, which would answer every question after it the same way.
 */
export function coachHistoryBeforeCrisis<TTurn extends Partial<AICoachConversationTurn>>(history: readonly TTurn[]): TTurn[] {
  const crisisAt = history.findIndex(
    (turn) =>
      isCoachCrisisTakeaway(turn.takeaway) || (typeof turn.question === 'string' && classifyCoachScope(turn.question) === 'crisis'),
  );
  return crisisAt < 0 ? [...history] : history.slice(0, crisisAt);
}
