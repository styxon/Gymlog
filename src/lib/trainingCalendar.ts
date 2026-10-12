import type { WorkoutSession } from '../types/models';
import { getCalendarWeekStartTimestamp, streakFromWeekStarts } from './completedSessions';

/**
 * The weekly training streak.
 *
 * This file once built a whole month grid for a standalone calendar screen;
 * that screen was retired as a duplicate of Progress → Activity (2026-08-25),
 * and the streak is the one thing the activity section still asks for.
 */

/**
 * Consecutive weeks with at least one session, counting back from this one.
 *
 * The CURRENT week never breaks the streak when it is empty — it is not over
 * yet, and a counter that resets every Monday morning is a counter nobody
 * trusts. It only counts once it has a session in it. The walk is
 * completedSessions' streakFromWeekStarts, the one Home's streak and Profile's
 * lifetime summary take, so the three cannot drift apart again (duplicate
 * sweep 13, 2026-10-12).
 */
export function weeklyTrainingStreak(
  sessions: readonly WorkoutSession[],
  /**
   * The runs, which are training weeks too.
   *
   * Left out, the streak under the Progress calendar read 0 for a reader whose
   * calendar above it marked three days that week — the calendar counts every
   * activity, Home's own streak counts every activity, and this one counted
   * lifted sessions alone (audit 3, 2026-09-19). One policy over two different
   * activity sets was the bug.
   */
  cardioSessions: ReadonlyArray<{ performedAt: string }> = [],
  now: Date = new Date(),
): number {
  const trainedWeeks = new Set<number>();
  for (const performedAt of [
    ...sessions.map((session) => session.performedAt),
    ...cardioSessions.map((session) => session.performedAt),
  ]) {
    // A date that does not parse has no week.
    if (Number.isFinite(Date.parse(performedAt))) {
      trainedWeeks.add(getCalendarWeekStartTimestamp(performedAt));
    }
  }
  return streakFromWeekStarts(trainedWeeks, now);
}
