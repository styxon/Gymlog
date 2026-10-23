/**
 * Two rules about the coach thread that the chat screen applies to its own
 * list of bubbles. Pure, so a test can hold them.
 */

interface Bubble {
  id: string;
}

/**
 * The thread and the field after a question was turned away for rate.
 *
 * Nothing was charged and nothing was answered, so the question goes back into
 * the field to be sent again, and its bubble is lifted out so sending it
 * again does not show it twice. If the reader has already typed something else
 * meanwhile, that draft is theirs and stays untouched; the old question then
 * stays in the thread, with its log offer, because lifting it out would lose
 * it - out of the thread and never in the field.
 */
export function afterRateLimitedQuestion<M extends Bubble>(
  messages: readonly M[],
  token: number,
  question: string,
  currentDraft: string,
  rateLimitedReply: M,
): { messages: M[]; draft: string } {
  const draftIsFree = currentDraft.trim() === '';
  // The question's log offer goes with its bubble: a bubble left in the
  // thread keeps its offer, and one lifted out takes it along (sending again
  // makes a new one).
  const kept = draftIsFree
    ? messages.filter((message) => message.id !== `offer:${token}` && message.id !== `me:${token}`)
    : [...messages];
  return {
    messages: [...kept, rateLimitedReply],
    draft: draftIsFree ? question : currentDraft,
  };
}

/**
 * Adds a notice with a fixed id, or replaces the one already there. Appending
 * on every tap gave duplicate React keys and a stack of identical lines.
 */
export function withNotice<M extends Bubble>(messages: readonly M[], notice: M): M[] {
  return messages.some((message) => message.id === notice.id)
    ? messages.map((message) => (message.id === notice.id ? notice : message))
    : [...messages, notice];
}
