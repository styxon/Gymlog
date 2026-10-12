import { AppDatabase, CardioSession, UnitPreference } from '../types/models';
import {
  getCanonicalCardioSessions,
  getCanonicalCompletedSessions,
  getCurrentWeekStreak,
  getMonthlyActivityCalendar,
  getRecentActivityStrip,
  getSessionsLast30Days,
  getSessionsThisWeek,
  localDateKey,
} from './completedSessions';
import { getCardioMinutes, getCombinedActivityMinutes } from './cardio';
import { getComparableLogSets } from './exerciseLog';
import { convertWeightFromKg, formatLogSetSummary, formatVolume, removeTrailingZeros } from './format';
import { getBodyweightProgress, getMostRecentSessionSummary, getRecentLogsForExercise } from './progression';

export interface HomeLastSessionDeltaSummary {
  sessionId: string;
  title: string;
  value: string;
  detail: string;
}

export interface HomeStreakSummary {
  currentWeekStreak: number;
  sessionsThisWeek: number;
  sessionsLast30Days: number;
  totalDurationMinutes: number;
  calendar: {
    monthLabel: string;
    weekdayLabels: string[];
    weeks: Array<
      Array<{
        dayStart: number;
        dayNumber: number;
        active: boolean;
        isToday: boolean;
        inCurrentMonth: boolean;
      }>
    >;
  };
  activity: {
    days: Array<{
      dayStart: number;
      dayNumber: number;
      weekdayLabel: string;
      active: boolean;
      isToday: boolean;
    }>;
  };
  value: string;
  label: string;
  detail: string;
}

export interface HomeSummary {
  lastSession: ReturnType<typeof getMostRecentSessionSummary>;
  lastSessionDelta: HomeLastSessionDeltaSummary | null;
  bodyweight: ReturnType<typeof getBodyweightProgress>;
  sessionsThisWeek: number;
  streak: HomeStreakSummary;
}

function getLastSessionDelta(database: AppDatabase, unitPreference: UnitPreference): HomeLastSessionDeltaSummary | null {
  const latestSession = getMostRecentSessionSummary(database);
  if (!latestSession) {
    return null;
  }

  for (const log of latestSession.logs) {
    if (log.skipped || !log.tracked) {
      continue;
    }

    const exerciseName = log.exerciseNameSnapshot.trim();
    const recentLogs = getRecentLogsForExercise(database, exerciseName, 4);
    const latestLog = recentLogs.find((entry) => entry.sessionId === latestSession.session.id);
    const previousLog = recentLogs.find((entry) => entry.sessionId !== latestSession.session.id);

    if (!latestLog || !previousLog) {
      continue;
    }

    const latestSets = getComparableLogSets(latestLog);
    const previousSets = getComparableLogSets(previousLog);
    const latestTopWeight = latestSets.reduce<number | null>(
      (best, set) => (best === null ? set.weight : Math.max(best, set.weight)),
      null,
    );
    const previousTopWeight = previousSets.reduce<number | null>(
      (best, set) => (best === null ? set.weight : Math.max(best, set.weight)),
      null,
    );

    if (latestTopWeight !== null && previousTopWeight !== null) {
      const delta = convertWeightFromKg(latestTopWeight - previousTopWeight, unitPreference);
      if (Math.abs(delta) >= 0.05) {
        const sign = delta > 0 ? '+' : '';
        return {
          sessionId: latestSession.session.id,
          title: exerciseName,
          value: `${sign}${removeTrailingZeros(delta)} ${unitPreference}`,
          detail: `Vs ${formatLogSetSummary(previousLog, unitPreference)}`,
        };
      }
    }

    return {
      sessionId: latestSession.session.id,
      title: exerciseName,
      value: formatLogSetSummary(latestLog, unitPreference),
      detail: `Vs ${formatLogSetSummary(previousLog, unitPreference)}`,
    };
  }

  return {
    sessionId: latestSession.session.id,
    title: latestSession.session.workoutNameSnapshot,
    value: formatVolume(latestSession.totalVolume, unitPreference),
    detail: `${latestSession.setsCompleted} sets completed`,
  };
}

function getHomeStreak(database: AppDatabase, now = new Date()): HomeStreakSummary {
  const sessionsThisWeek = getSessionsThisWeek(database, now);
  const sessionsLast30Days = getSessionsLast30Days(database, now);
  const currentWeekStreak = getCurrentWeekStreak(database, now);
  const calendar = getMonthlyActivityCalendar(database, now);
  const activity = getRecentActivityStrip(database, now);
  const totalDurationMinutes = getCanonicalCompletedSessions(database).reduce(
    (sum, session) => sum + getSessionDurationMinutes(session),
    0,
  );

  return {
    currentWeekStreak,
    sessionsThisWeek,
    sessionsLast30Days,
    totalDurationMinutes,
    calendar,
    activity: {
      days: activity,
    },
    value: `${currentWeekStreak}`,
    label: currentWeekStreak === 1 ? 'active week' : 'active weeks',
    detail: `${sessionsLast30Days} ${sessionsLast30Days === 1 ? 'workout' : 'workouts'} in 30 days`,
  };
}

/**
 * A session's length in minutes: the stored figure, else the span from
 * startedAt to performedAt for sessions saved before it was stored, else 0.
 * Shared with the milestone ladder so Home's training time and the hours
 * rung read the same sessions the same way.
 */
export function getSessionDurationMinutes(session: AppDatabase['workoutSessions'][number]) {
  if (typeof session.durationMinutes === 'number' && Number.isFinite(session.durationMinutes)) {
    return session.durationMinutes;
  }

  if (session.startedAt) {
    const duration = Math.round((new Date(session.performedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  }

  return 0;
}

function getSessionVolumeKg(session: AppDatabase['workoutSessions'][number]) {
  if (typeof session.totalVolumeKg === 'number' && Number.isFinite(session.totalVolumeKg)) {
    return session.totalVolumeKg;
  }

  return 0;
}

/**
 * Workouts, minutes and volume inside the calendar month `now` falls in.
 *
 * The home-screen widget's 4x2 draws these beside a calendar of that same
 * month, so the window is the month rather than the rolling 30 days the rest
 * of the app prefers: a figure next to a grid is read as belonging to it.
 */
export function getMonthTrainingTotals(database: AppDatabase, now = new Date()) {
  return sumMonthTrainingTotals(
    getCanonicalCompletedSessions(database),
    getCanonicalCardioSessions(database),
    now,
  );
}

/**
 * The same month's totals from lists the caller has already made canonical
 * (getCanonicalCompletedSessions, getCanonicalCardioSessions). The Progress
 * tab's month card holds those lists and not the database, and it kept its
 * own copy of this sum — each copy carrying its own fix for the same
 * cardio bug (audit 3, 2026-09-19). One sum now, for the widget and the card.
 */
export function sumMonthTrainingTotals(
  sessions: AppDatabase['workoutSessions'],
  cardioSessions: Array<Pick<CardioSession, 'performedAt' | 'durationSec'>>,
  now: Date,
) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const inMonth = (performedAtIso: string) => {
    const performedAt = new Date(performedAtIso).getTime();
    return performedAt >= monthStart && performedAt < nextMonthStart;
  };
  const monthSessions = sessions.filter((session) => inMonth(session.performedAt));
  // The calendar beside these figures marks cardio days, so the runs belong in
  // the figures too — a month of runs read "0 min" next to a grid full of
  // marked days. In the count as well as the minutes: the app calls a run a
  // cardio workout, and "Workouts 0 · Duration 3 h" is a contradiction.
  // Volume stays strength-only: a run has no tonnage.
  const cardio = cardioSessions.filter((session) => inMonth(session.performedAt));
  const workouts = monthSessions.length + cardio.length;
  // The runs' minutes rounded once over the total, not per run.
  const durationMinutes = getCombinedActivityMinutes(
    monthSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
    cardio,
  );

  return {
    workouts,
    durationMinutes,
    volumeKg: monthSessions.reduce((sum, session) => sum + getSessionVolumeKg(session), 0),
    /** Minutes per workout, runs included; 0 for an empty month. */
    averageDurationMinutes: workouts ? Math.round(durationMinutes / workouts) : 0,
  };
}

/**
 * Training minutes per local day, cardio added to the workout days it shares
 * and given days of its own. Progress's duration chart summed workouts only,
 * while the activity calendar below it marks cardio days — a month of runs
 * drew no time at all beside a grid full of marks.
 *
 * `days` is one entry per local day; the result keeps that, sorted oldest
 * first. Cardio before `startMs` (the chart's range) is left out.
 */
export function addCardioMinutesByDay(
  days: Array<{ performedAt: string; minutes: number }>,
  cardioSessions: Array<Pick<CardioSession, 'performedAt' | 'durationSec'>>,
  startMs: number | null,
): Array<{ performedAt: string; minutes: number }> {
  const byDay = new Map<string, { performedAt: string; minutes: number; cardio: Array<Pick<CardioSession, 'durationSec'>> }>();
  for (const day of days) {
    byDay.set(localDateKey(day.performedAt), { performedAt: day.performedAt, minutes: day.minutes, cardio: [] });
  }
  for (const session of cardioSessions) {
    const performedAt = new Date(session.performedAt).getTime();
    if (!Number.isFinite(performedAt) || (startMs !== null && performedAt < startMs)) {
      continue;
    }
    const key = localDateKey(session.performedAt);
    const day = byDay.get(key) ?? { performedAt: session.performedAt, minutes: 0, cardio: [] };
    day.cardio.push(session);
    byDay.set(key, day);
  }
  return [...byDay.values()]
    .map((day) => ({ performedAt: day.performedAt, minutes: day.minutes + getCardioMinutes(day.cardio) }))
    .sort((left, right) => new Date(left.performedAt).getTime() - new Date(right.performedAt).getTime());
}

/**
 * `now` is threaded rather than left to each helper's own `new Date()` so the
 * date-dependent figures can be asked for at a fixed date. Every date bug found
 * in here so far has been invisible to the tests for want of exactly that.
 *
 * It held a rotation of its own (`nextWorkout`, which offered entry 2 for ever
 * on a plan whose entries name no session) and a lifting-only week snapshot,
 * and nothing read either; the rotation is lib/planRotation's alone
 * (duplicate sweep 13, 2026-10-12).
 */
export function getHomeSummary(
  database: AppDatabase,
  unitPreference: UnitPreference,
  now = new Date(),
): HomeSummary {
  const sessionsThisWeek = getSessionsThisWeek(database, now);

  return {
    lastSession: getMostRecentSessionSummary(database),
    lastSessionDelta: getLastSessionDelta(database, unitPreference),
    bodyweight: getBodyweightProgress(database),
    sessionsThisWeek,
    streak: getHomeStreak(database, now),
  };
}
