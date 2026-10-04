import { AppDatabase } from '../types/models';
import {
  getActiveWeekRuns,
  getCalendarWeekStartBefore,
  getCalendarWeekStartTimestamp,
  getCanonicalCardioSessions,
  getCanonicalCompletedSessions,
} from './completedSessions';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface LifetimeTrainingSummary {
  /** Deduplicated completed-session count (same rule as the streak/calendar). */
  sessionCount: number;
  /** Sum of stored session volume in kg across all completed sessions. */
  totalVolumeKg: number;
  /** Distinct calendar weeks that contain at least one completed session. */
  weeksActive: number;
  /** Calendar weeks from the first completed session's week to the current week, inclusive. */
  weeksSinceStart: number;
  /** Longest run of consecutive active weeks ever recorded. */
  bestWeekStreak: number;
  /**
   * The run that is still alive: consecutive active weeks ending this week
   * or last week. Last week counts, because a streak is not broken on Monday
   * morning by a week that has only just begun.
   */
  currentWeekStreak: number;
  /** ISO timestamp of the earliest completed session, or null when none exist. */
  firstSessionAt: string | null;
}

function getSessionVolumeKg(totalVolumeKg: number | null | undefined) {
  if (typeof totalVolumeKg === 'number' && Number.isFinite(totalVolumeKg)) {
    return Math.max(0, totalVolumeKg);
  }
  return 0;
}

/**
 * Lifetime training totals for the Profile screen. Reuses the canonical
 * completed-session set and calendar-week math that the Progress/Home streak
 * and activity calendar already rely on, so the numbers stay consistent.
 */
export function getLifetimeTrainingSummary(
  database: AppDatabase,
  now: Date = new Date(),
): LifetimeTrainingSummary {
  const sessions = getCanonicalCompletedSessions(database);
  const cardioSessions = getCanonicalCardioSessions(database);

  if (sessions.length === 0 && cardioSessions.length === 0) {
    return {
      sessionCount: 0,
      totalVolumeKg: 0,
      weeksActive: 0,
      weeksSinceStart: 0,
      bestWeekStreak: 0,
      currentWeekStreak: 0,
      firstSessionAt: null,
    };
  }

  const totalVolumeKg = sessions.reduce((total, session) => total + getSessionVolumeKg(session.totalVolumeKg), 0);

  // Cardio marks a week active too: Home's streak and the training calendar
  // count every activity, so a lift-only week set made Profile and the
  // milestones read 1 where Home read 2 (bug hunt, 2026-10-04). Counts and
  // volume stay lifting-only.
  const activeWeekStarts = [
    ...new Set(
      [...sessions, ...cardioSessions].map((session) => getCalendarWeekStartTimestamp(session.performedAt)),
    ),
  ].sort((left, right) => left - right);

  // The longest run of consecutive active weeks, from the shared walk the
  // milestone ladder also reads.
  const bestWeekStreak = Math.max(1, ...getActiveWeekRuns(activeWeekStarts));

  const firstWeekStart = activeWeekStarts[0];
  const currentWeekStart = getCalendarWeekStartTimestamp(now);

  // Walk back from this week (or last week, if this one has not started)
  // through consecutive active weeks.
  const activeSet = new Set(activeWeekStarts);
  let cursor = activeSet.has(currentWeekStart) ? currentWeekStart : getCalendarWeekStartBefore(currentWeekStart);
  let currentWeekStreak = 0;
  while (activeSet.has(cursor)) {
    currentWeekStreak += 1;
    cursor = getCalendarWeekStartBefore(cursor);
  }
  // WEEK_MS survives here on purpose: a span of N weeks is N * 168 hours give or
  // take the one hour a clock change adds or removes, and Math.round absorbs
  // 1/168 of a week. It is a count of weeks elapsed, not a week start to look
  // up, so calendar stepping buys nothing — but the rounding is what makes it
  // safe, and floor would be off by one after every change.
  const weeksSinceStart = Math.max(1, Math.round((currentWeekStart - firstWeekStart) / WEEK_MS) + 1);

  // sessions are sorted newest-first, so the earliest is the last entry.
  const firstSessionAt = sessions.length > 0 ? sessions[sessions.length - 1].performedAt : null;

  return {
    sessionCount: sessions.length,
    totalVolumeKg,
    weeksActive: activeWeekStarts.length,
    weeksSinceStart,
    bestWeekStreak,
    currentWeekStreak,
    firstSessionAt,
  };
}

/**
 * Every workout ever logged, lifting and cardio. getMonthTrainingTotals counts
 * a run as a workout, so a widget total that left cardio out read "Workouts 12"
 * for the month beside "Total 0" for all time (bug hunt, 2026-10-04). Profile's
 * lifetime `sessionCount` stays lifting-only: it sits beside lifting volume and
 * active weeks and is labelled "Sessions".
 */
export function getLifetimeWorkoutCount(database: AppDatabase): number {
  return getCanonicalCompletedSessions(database).length + getCanonicalCardioSessions(database).length;
}
