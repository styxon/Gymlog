/**
 * How long the coach remembers the conversation you were having.
 *
 * The thread used to live in the chat screen's own state, so it existed only
 * while that screen was mounted. Tapping through to the workout the coach had
 * just proposed — the one action its answer invites — unmounted the screen and
 * threw the conversation away, and so did the phone's back button. The reader
 * had built a five-turn brief and then had to start from "säädä ohjelmaani"
 * again (#bugs 2026-08-27, twice in three minutes).
 *
 * Two rules, and the second is the reader's own (#bugs 07.25): the thread
 * survives leaving the screen, and it does not survive forever. Eight hours is
 * a training day: come back in the evening and yesterday morning's questions
 * are not still sitting there pretending to be context.
 *
 * Deliberately in memory only. Closing the app ends the conversation too,
 * which is the other half of what was asked for ("häviää vaikka lopetukseen"),
 * and it keeps a transcript of what someone asked their coach off the disk.
 */

import { AICoachConversationTurn } from '../types/aiCoach';
import { withoutCoachCrisisTurns } from './coachCrisisTurn';

/** A training day. Come back tomorrow and the coach starts fresh. */
export const COACH_CHAT_MEMORY_MS = 8 * 60 * 60 * 1000;

export interface CoachChatMemory<TMessage> {
  /** When the reader last said something or the coach last answered. */
  lastActiveAt: string;
  /** What is drawn in the thread. */
  messages: TMessage[];
  /** What is sent to the model as history. */
  turns: AICoachConversationTurn[];
}

/**
 * The thread to reopen with, or null to start a new one.
 *
 * Null for anything that is not a live conversation: nothing stored, an empty
 * thread, an unreadable timestamp, or one older than the window.
 */
export function resumeCoachChat<TMessage>(
  memory: CoachChatMemory<TMessage> | null | undefined,
  nowIso: string,
  maxAgeMs: number = COACH_CHAT_MEMORY_MS,
): CoachChatMemory<TMessage> | null {
  if (!memory || memory.messages.length === 0) {
    return null;
  }

  const lastActive = Date.parse(memory.lastActiveAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(lastActive) || !Number.isFinite(now)) {
    return null;
  }

  // A last-active stamp in the future is a clock that moved, not a stale
  // thread. Keeping the conversation is the safe direction: the cost of being
  // wrong here is one extra thread, and the cost of being wrong the other way
  // is the bug this module exists to fix.
  if (now - lastActive > maxAgeMs) {
    return null;
  }

  // The thread is drawn as it was, crisis answer included, but no crisis turn
  // goes back to the model as history. The chat does not append them, and
  // this is the second check: a kept turn rides along with every question
  // for as long as the thread is open (F1 crisis hunt, 2026-10-08). Only the
  // turns the crisis answer closed: one the coach answered live stays, even
  // when today's filter reads its question as a crisis (review, 2026-10-08).
  return { ...memory, turns: withoutCoachCrisisTurns(Array.isArray(memory.turns) ? memory.turns : []) };
}
