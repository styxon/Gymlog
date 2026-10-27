import { SessionFeel, WorkoutSession } from '../types/models';
// Type-only: a real import here would put i18n in a cycle with every module
// that formats one of its own labels.
import type { I18nKey } from './i18n';

/**
 * Reading back the one-word verdict the completion screen collects.
 *
 * The answer is shown, not acted on (user decision 2026-08-24: colour the
 * history and say how demanding the training has been, before anything starts
 * adjusting the programme off it). So everything here describes; nothing
 * decides.
 */

/** Easiest to hardest. The order the completion sheet offers them in. */
export const SESSION_FEEL_SCALE: readonly SessionFeel[] = ['easy', 'right', 'hard', 'too_hard'];

export const SESSION_FEEL_LABEL_KEY: Record<SessionFeel, I18nKey> = {
  easy: 'complete.feel.easy',
  right: 'complete.feel.right',
  hard: 'complete.feel.hard',
  too_hard: 'complete.feel.tooHard',
};

/**
 * The hard end of the scale, which the theme has no token for.
 *
 * `amber` means "check this" and `danger` means "this deletes something";
 * neither is what a demanding session is. A scale is also not four semantic
 * tokens standing next to each other — it has to read as one ramp from green
 * to red, so the two ends that are not already theme colours are named here
 * and nowhere else.
 */
export const SESSION_FEEL_HARD_COLOR = '#E0922F';
export const SESSION_FEEL_TOO_HARD_COLOR = '#D64545';

/**
 * Takes the two theme colours it needs rather than the whole Theme, so this
 * module stays free of the theming layer and any palette can be passed in.
 */
export function sessionFeelColor(
  palette: { green: string; purple: string },
  feel: SessionFeel,
): string {
  switch (feel) {
    case 'easy':
      return palette.green;
    case 'right':
      return palette.purple;
    case 'hard':
      return SESSION_FEEL_HARD_COLOR;
    case 'too_hard':
      return SESSION_FEEL_TOO_HARD_COLOR;
  }
}

/**
 * How the recent stretch of training has felt, as a whole.
 *
 * `steady` is a run that mostly felt about right; `mixed` is one where no
 * answer dominates. They used to share one label ("Mixed"), so twelve answers
 * of "Just right" read back as mixed — which they are not.
 */
export type SessionFeelRead = 'light' | 'steady' | 'demanding' | 'mixed';

export interface SessionFeelSummary {
  /** Sessions looked at — answered or not. */
  considered: number;
  /** Of those, how many carry an answer. */
  answered: number;
  /**
   * The read, or null when there is not enough to say.
   *
   * Null is a real answer and the screen must print it as one. Two answers out
   * of twelve sessions describe two evenings, not a training block, and a
   * confident-sounding label built on them would be the app inventing a
   * conclusion the reader never gave it.
   */
  read: SessionFeelRead | null;
  /**
   * Sessions answered "too hard", counted on their own.
   *
   * It does not average. Two brutal sessions among ten comfortable ones is
   * worth seeing, and a mean would file them under "mixed" and hide them.
   */
  tooHardCount: number;
}

/** Sessions to look back over. Roughly a month at three a week. */
export const SESSION_FEEL_WINDOW = 12;

/**
 * Answers needed before the summary says anything at all.
 *
 * Three is not statistics; it is the point below which a label would be
 * describing individual evenings while sounding like it describes a block.
 */
const MIN_ANSWERED = 3;

/** How lopsided the answers must be before the read stops being "mixed". */
const LEAN_SHARE = 0.6;

/**
 * Newest first, as the history stores them. Only the window is read; sessions
 * without an answer stay in `considered` because "you have not been answering"
 * is itself part of what the screen has to be able to say.
 */
export function summariseSessionFeel(
  sessions: Pick<WorkoutSession, 'feel'>[],
  window: number = SESSION_FEEL_WINDOW,
): SessionFeelSummary {
  const considered = sessions.slice(0, Math.max(0, window));
  const answers = considered
    .map((session) => session.feel)
    .filter((feel): feel is SessionFeel => Boolean(feel));

  const tooHardCount = answers.filter((feel) => feel === 'too_hard').length;
  const base: SessionFeelSummary = {
    considered: considered.length,
    answered: answers.length,
    read: null,
    tooHardCount,
  };

  if (answers.length < MIN_ANSWERED) {
    return base;
  }

  const hardShare = answers.filter((feel) => feel === 'hard' || feel === 'too_hard').length / answers.length;
  const easyShare = answers.filter((feel) => feel === 'easy').length / answers.length;
  const rightShare = answers.filter((feel) => feel === 'right').length / answers.length;

  if (hardShare >= LEAN_SHARE) {
    return { ...base, read: 'demanding' };
  }
  if (easyShare >= LEAN_SHARE) {
    return { ...base, read: 'light' };
  }
  if (rightShare >= LEAN_SHARE) {
    return { ...base, read: 'steady' };
  }
  // Nothing dominates — including a split between easy and too hard, which is
  // genuinely mixed rather than average.
  return { ...base, read: 'mixed' };
}
