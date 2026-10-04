import { I18nKey } from './i18n';

/**
 * The one-tap questions under the coach chat, chosen by how far the reader is.
 *
 * One fixed set asked "analyse my last workout" of someone who had never
 * logged one, and "adjust my program" of someone still choosing their first
 * (user, 2026-10-04). Before the first session the useful questions are about
 * starting; after a few, about the next step; with a history, about the week.
 */
export const COACH_QUICK_ASKS_FIRST: I18nKey[] = [
  'coach.chip.start',
  'coach.chip.whichProgram',
  'coach.chip.startingWeights',
];

export const COACH_QUICK_ASKS_EARLY: I18nKey[] = [
  'coach.chip.analyze',
  'coach.chip.whenAddWeight',
  'coach.chip.program',
];

export const COACH_QUICK_ASKS_ESTABLISHED: I18nKey[] = [
  'coach.chip.analyze',
  'coach.chip.program',
  'coach.chip.week',
];

/** From this many logged workouts on, the reader has a week worth reading. */
export const ESTABLISHED_SESSION_COUNT = 5;

export function coachQuickAskKeys(sessionCount: number): I18nKey[] {
  if (!Number.isFinite(sessionCount) || sessionCount <= 0) {
    return COACH_QUICK_ASKS_FIRST;
  }
  if (sessionCount < ESTABLISHED_SESSION_COUNT) {
    return COACH_QUICK_ASKS_EARLY;
  }
  return COACH_QUICK_ASKS_ESTABLISHED;
}
