import { AppDatabase, CardioSession, UnitPreference, WorkoutPlan, WorkoutPlanEntry } from '../types/models';
import {
  getCalendarWeekStartBefore,
  getCalendarWeekStartTimestamp,
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
import { getActivePlan, getBodyweightProgress, getMostRecentSessionSummary, getRecentLogsForExercise } from './progression';

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
  nextWorkout: ReturnType<typeof getNextWorkoutCandidate>;
  lastSession: ReturnType<typeof getMostRecentSessionSummary>;
  lastSessionDelta: HomeLastSessionDeltaSummary | null;
  bodyweight: ReturnType<typeof getBodyweightProgress>;
  weeklySnapshot: {
    workoutsCurrent: number;
    workoutsPrevious: number;
    durationCurrentMinutes: number;
    durationPreviousMinutes: number;
    volumeCurrentKg: number;
    volumePreviousKg: number;
  };
  sessionsThisWeek: number;
  streak: HomeStreakSummary;
}

function normalizeWeekday(label: string) {
  const normalized = label.trim().toLowerCase();
  const map: Record<string, number> = {
    monday: 1,
    maanantai: 1,
    tuesday: 2,
    tiistai: 2,
    wednesday: 3,
    keskiviikko: 3,
    thursday: 4,
    torstai: 4,
    friday: 5,
    perjantai: 5,
    saturday: 6,
    lauantai: 6,
    sunday: 0,
    sunnuntai: 0,
  };

  return map[normalized];
}

function getDayDistance(fromDay: number, toDay: number) {
  return (toDay - fromDay + 7) % 7;
}

function sortPlanEntries(plan: WorkoutPlan) {
  return [...plan.entries].sort((left, right) => left.orderIndex - right.orderIndex);
}

function planEntryMatchesSession(entry: WorkoutPlanEntry, session: AppDatabase['workoutSessions'][number]) {
  if (entry.workoutTemplateId !== session.workoutTemplateId) {
    return false;
  }

  return entry.workoutTemplateSessionId
    ? entry.workoutTemplateSessionId === session.workoutTemplateSessionId
    : true;
}

export function getWorkoutMap(database: AppDatabase) {
  return Object.fromEntries(database.workoutTemplates.map((template) => [template.id, template] as const));
}

export function getNextWorkoutCandidate(database: AppDatabase) {
  const workoutsById = getWorkoutMap(database);
  const activePlan = getActivePlan(database);

  if (activePlan && activePlan.entries.length) {
    const entries = sortPlanEntries(activePlan);

    if (activePlan.mode === 'rotation') {
      const latestPlanSession = getCanonicalCompletedSessions(database)
        .filter((session) => entries.some((entry) => planEntryMatchesSession(entry, session)))
        .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())[0];

      const latestIndex = latestPlanSession
        ? entries.findIndex((entry) => planEntryMatchesSession(entry, latestPlanSession))
        : -1;
      const entry = entries[(latestIndex + 1 + entries.length) % entries.length];
      const workout = workoutsById[entry.workoutTemplateId];

      if (workout) {
        return {
          workout,
          plan: activePlan,
          entry,
          subtitle: `${activePlan.name} - Next in rotation`,
        };
      }
    }

    const today = new Date().getDay();
    const datedEntries = entries
      .map((entry) => ({ entry, day: normalizeWeekday(entry.label) }))
      .filter((item): item is { entry: WorkoutPlanEntry; day: number } => typeof item.day === 'number')
      .sort((left, right) => {
        const distanceLeft = getDayDistance(today, left.day);
        const distanceRight = getDayDistance(today, right.day);
        return distanceLeft - distanceRight || left.entry.orderIndex - right.entry.orderIndex;
      });

    const weekdayEntry = datedEntries[0]?.entry ?? entries[0];
    const workout = workoutsById[weekdayEntry.workoutTemplateId];
    if (workout) {
      return {
        workout,
        plan: activePlan,
        entry: weekdayEntry,
        subtitle: `${activePlan.name} - ${weekdayEntry.label}`,
      };
    }
  }

  const fallback = [...database.workoutTemplates].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];

  if (!fallback) {
    return null;
  }

  return {
    workout: fallback,
    plan: null,
    entry: null,
    subtitle: 'Quick start',
  };
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

function getHomeWeeklySnapshot(database: AppDatabase, now = new Date()) {
  const currentWeekStart = getCalendarWeekStartTimestamp(now);
  const previousWeekStart = getCalendarWeekStartBefore(currentWeekStart);
  const sessions = getCanonicalCompletedSessions(database);

  const currentWeekSessions = sessions.filter(
    (session) => getCalendarWeekStartTimestamp(session.performedAt) === currentWeekStart,
  );
  const previousWeekSessions = sessions.filter(
    (session) => getCalendarWeekStartTimestamp(session.performedAt) === previousWeekStart,
  );

  return {
    workoutsCurrent: currentWeekSessions.length,
    workoutsPrevious: previousWeekSessions.length,
    durationCurrentMinutes: currentWeekSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
    durationPreviousMinutes: previousWeekSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
    volumeCurrentKg: currentWeekSessions.reduce((sum, session) => sum + getSessionVolumeKg(session), 0),
    volumePreviousKg: previousWeekSessions.reduce((sum, session) => sum + getSessionVolumeKg(session), 0),
  };
}

/**
 * `now` is threaded rather than left to each helper's own `new Date()` so the
 * date-dependent figures can be asked for at a fixed date. Every date bug found
 * in here so far has been invisible to the tests for want of exactly that.
 *
 * `getNextWorkoutCandidate` is the exception and still reads the wall clock
 * internally to order weekday plan entries, so `nextWorkout` is not pinned by
 * this parameter.
 */
export function getHomeSummary(
  database: AppDatabase,
  unitPreference: UnitPreference,
  now = new Date(),
): HomeSummary {
  const sessionsThisWeek = getSessionsThisWeek(database, now);

  return {
    nextWorkout: getNextWorkoutCandidate(database),
    lastSession: getMostRecentSessionSummary(database),
    lastSessionDelta: getLastSessionDelta(database, unitPreference),
    bodyweight: getBodyweightProgress(database),
    weeklySnapshot: getHomeWeeklySnapshot(database, now),
    sessionsThisWeek,
    streak: getHomeStreak(database, now),
  };
}
