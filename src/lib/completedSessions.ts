import { isExerciseDone } from './sessionTotals';
import { AppDatabase, CardioSession, WorkoutSession } from '../types/models';

const FI_MONTHS = [
  'tammikuu',
  'helmikuu',
  'maaliskuu',
  'huhtikuu',
  'toukokuu',
  'kesakuu',
  'heinakuu',
  'elokuu',
  'syyskuu',
  'lokakuu',
  'marraskuu',
  'joulukuu',
];
const FI_WEEKDAYS = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
const FI_WEEKDAYS_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

function buildCompletedSessionSignature(session: WorkoutSession) {
  // A date that does not parse is kept as written rather than thrown on:
  // `toISOString` on an invalid date is a RangeError, and this runs from
  // a top-level memo on every render — one bad string in a restored
  // backup was a red screen at every launch (audit round 4, 2026-09-20).
  const stamp = Date.parse(session.performedAt);
  return [
    session.workoutTemplateId,
    session.workoutTemplateSessionId ?? '',
    session.workoutNameSnapshot.trim().toLowerCase(),
    Number.isFinite(stamp) ? new Date(stamp).toISOString() : String(session.performedAt),
  ].join('|');
}

function toDayStart(dateInput: string | Date) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getCalendarDayStartTimestamp(dateInput: string | Date) {
  return toDayStart(dateInput).getTime();
}

/**
 * "2026-09-14" for the day the reader lived it, in the device's timezone.
 *
 * Not `toISOString().slice(0, 10)`, and not a stored ISO string's first ten
 * characters: both are UTC. A Helsinki session between midnight and 02:00
 * (03:00 in summer) is already today on the reader's clock and still yesterday
 * in UTC, so it merged into the previous day's chart point and was exported
 * under the wrong date. Empty for a value that is not a date.
 *
 * Device-side only: on the coach endpoint the process timezone is UTC, which
 * is why dates meant for the coach are resolved on the phone before sending.
 */
export function localDateKey(value: string | number | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getCalendarWeekStartTimestamp(dateInput: string | Date) {
  const date = toDayStart(dateInput);
  const weekday = date.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function getSessionIdsWithCompletedSets(database: Pick<AppDatabase, 'exerciseLogs'>) {
  const completedSessionIds = new Set<string>();

  for (const log of database.exerciseLogs) {
    // A session counts when an exercise in it was done — the same rule that
    // counts the exercises themselves, so a session can never be counted
    // with "0 liikettä" in it.
    if (isExerciseDone(log)) {
      completedSessionIds.add(log.sessionId);
    }
  }

  return completedSessionIds;
}

/**
 * The sessions every activity figure counts: at least one exercise done, and
 * one row per workout however many times it was saved.
 *
 * Only the two arrays are read, so a memo can depend on exactly those.
 */
export function getCanonicalCompletedSessions(database: Pick<AppDatabase, 'workoutSessions' | 'exerciseLogs'>) {
  const completedSessionIds = getSessionIdsWithCompletedSets(database);
  const seenSignatures = new Set<string>();

  return [...database.workoutSessions]
    .filter((session) => completedSessionIds.has(session.id))
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())
    .filter((session) => {
      const signature = buildCompletedSessionSignature(session);
      if (seenSignatures.has(signature)) {
        return false;
      }

      seenSignatures.add(signature);
      return true;
    });
}

/**
 * Cardio sessions count toward the activity counters (sessions this week,
 * streaks, calendars) with equal weight to strength sessions — but they are
 * NOT canonical workout sessions: plan progress and program insights stay
 * strength-only.
 */
export function getCanonicalCardioSessions<T extends Pick<CardioSession, 'id' | 'performedAt'>>(database: {
  cardioSessions?: readonly T[] | null;
}): T[] {
  const seenIds = new Set<string>();
  return [...(database.cardioSessions ?? [])]
    .filter((session) => {
      if (seenIds.has(session.id)) {
        return false;
      }
      seenIds.add(session.id);
      return true;
    })
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime());
}

/** performedAt timestamps of every activity that counts toward streaks. */
function getAllActivityTimestamps(database: AppDatabase) {
  return [
    ...getCanonicalCompletedSessions(database).map((session) => session.performedAt),
    ...getCanonicalCardioSessions(database).map((session) => session.performedAt),
  ];
}

export function getSessionsThisWeek(database: AppDatabase, now = new Date()) {
  const currentWeekStart = getCalendarWeekStartTimestamp(now);

  return getAllActivityTimestamps(database).filter(
    (performedAt) => getCalendarWeekStartTimestamp(performedAt) === currentWeekStart,
  ).length;
}

/**
 * Newest activity timestamp (workout or cardio) in epoch ms, or null when
 * nothing has been logged yet. Drives the comeback nudge and the "already
 * trained today" check in the notification planner.
 */
export function getLastActivityTimestamp(database: AppDatabase): number | null {
  return newestTimestamp(getAllActivityTimestamps(database));
}

/**
 * Newest completed *workout* timestamp, cardio left out. For the one question a
 * run does not answer: is the day's planned training behind you. A run marks
 * the day without doing the workout planned for it (the widget's rule too), so
 * a morning run must not cancel that evening's reminder.
 */
export function getLastWorkoutTimestamp(database: AppDatabase): number | null {
  return newestTimestamp(getCanonicalCompletedSessions(database).map((session) => session.performedAt));
}

function newestTimestamp(isoStamps: string[]): number | null {
  let newest: number | null = null;
  isoStamps.forEach((performedAtIso) => {
    const performedAt = new Date(performedAtIso).getTime();
    if (!Number.isFinite(performedAt)) {
      return;
    }
    if (newest === null || performedAt > newest) {
      newest = performedAt;
    }
  });
  return newest;
}

/**
 * Lifted volume of the current calendar week in kg. Sums the session volume,
 * the same source the lifetime summary uses, so the weekly-summary
 * notification can never quote a number the app itself would contradict. The
 * loader reads that volume off the logs (lib/sessionTotals), so it is also
 * what History shows.
 */
export function getVolumeThisWeekKg(database: AppDatabase, now = new Date()) {
  const currentWeekStart = getCalendarWeekStartTimestamp(now);

  return getCanonicalCompletedSessions(database)
    .filter((session) => getCalendarWeekStartTimestamp(session.performedAt) === currentWeekStart)
    .reduce((total, session) => {
      const volume = session.totalVolumeKg;
      return total + (typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, volume) : 0);
    }, 0);
}

/**
 * Where a rolling window of `days` calendar days back from `now` begins.
 *
 * Calendar stepping, not a count of fixed 24-hour chunks. A window spanning a
 * clock change contains a 23- or 25-hour day, so subtracting `days * DAY_MS`
 * puts the edge an hour off the same time of day that many days back — wide
 * enough to count something older than the window claims to cover, or narrow
 * enough to drop something inside it.
 *
 * One case the Date constructor decides rather than this function: on the hour
 * that spring-forward skips, a wall-clock time that never happens normalizes
 * forward. A window ending 03:30 on such a day therefore starts at 04:30, an
 * hour short. Bounded, twice a year, and better than the alternative of landing
 * an hour off every day of the six months following each change.
 *
 * Exported because more than one surface asks the same question, and two
 * copies of this arithmetic drift apart at exactly the moment it matters.
 */
export function getRollingWindowStart(now: Date | string | number, days: number) {
  return addCalendarDays(now, -days);
}

/**
 * `reference` shifted by whole calendar days, keeping its time of day.
 *
 * The primitive under every window and week helper here. Adding or subtracting
 * `days * DAY_MS` instead drifts an hour whenever the span crosses a clock
 * change, and an hour is the whole distance between a timestamp that matches a
 * stored day or week start and one that matches nothing.
 *
 * One case the Date constructor decides rather than this function: a wall-clock
 * time that spring-forward skips normalizes forward an hour. Under Helsinki's
 * 03:00 transitions only times in that hour are affected, which is why the week
 * helpers below — always at local midnight — are exact.
 */
export function addCalendarDays(reference: Date | string | number, days: number) {
  const date = new Date(reference);

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  ).getTime();
}

/**
 * `reference` shifted by whole calendar months, keeping its day of the month
 * where that day exists — and the last day of the target month where it does
 * not.
 *
 * `setMonth(getMonth() - 1)` on 31 March asks for 31 February, and JavaScript
 * answers 3 March: the "last month" range on the Progress tab started three
 * days ago instead of a month ago, and the chart quietly lost four weeks of
 * its own window (2026-09-16). Clamping to the month's last day is what a
 * reader means by "a month back" from the 31st.
 */
export function subtractCalendarMonths(reference: Date | string | number, months: number) {
  const date = new Date(reference);
  const targetMonthStart = new Date(date.getFullYear(), date.getMonth() - months, 1);
  // Day 0 of the next month is the last day of this one, which is where 31
  // February has to land.
  const lastDayOfTarget = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate();

  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(date.getDate(), lastDayOfTarget),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

/**
 * The start of the calendar week `weeks` before `weekStart`.
 *
 * `weekStart` is expected to be a local week start, as
 * `getCalendarWeekStartTimestamp` returns. Stepping back by a fixed
 * `weeks * WEEK_MS` lands at 23:00 or 01:00 whenever the span crosses a clock
 * change, and no real week start ever equals that, so every lookup and equality
 * check against a set of week starts silently misses. Under Helsinki's 03:00 transitions local
 * midnight always exists, so this is exact; a zone that moves its clocks at
 * midnight would need the result snapped back through
 * `getCalendarWeekStartTimestamp`.
 */
/**
 * Whole calendar days between two instants, counted from their local day
 * starts.
 *
 * For reporting a span, never for gating one: "N days apart" is a count, and a
 * count rounds, which is exactly the looseness a threshold must not have. Gate
 * with `getRollingWindowStart` instead, then report with this.
 */
export function calendarDaysBetween(from: Date | string | number, to: Date | string | number) {
  return Math.round(
    (getCalendarDayStartTimestamp(new Date(to)) - getCalendarDayStartTimestamp(new Date(from))) /
      (24 * 60 * 60 * 1000),
  );
}

export function getCalendarWeekStartBefore(weekStart: number, weeks = 1) {
  return addCalendarDays(weekStart, -weeks * 7);
}

/**
 * The start of the calendar week `weeks` after `weekStart`. Same reasoning as
 * `getCalendarWeekStartBefore`, for loops that walk forwards.
 */
/**
 * How long the run of consecutive active weeks is AT each week.
 *
 * `weekStarts` must be the distinct active week starts, ascending. The
 * lifetime summary takes the maximum of these (the best run ever) and the
 * milestone ladder takes them one by one (the run as it stood that week) —
 * they used to walk the same loop separately, so a change to what "consecutive"
 * means could land in one and not the other.
 */
export function getActiveWeekRuns(weekStarts: readonly number[]): number[] {
  const runs: number[] = [];
  for (let index = 0; index < weekStarts.length; index += 1) {
    const followsPrevious =
      index > 0 && getCalendarWeekStartBefore(weekStarts[index]) === weekStarts[index - 1];
    runs.push(followsPrevious ? runs[index - 1] + 1 : 1);
  }
  return runs;
}

export function getCalendarWeekStartAfter(weekStart: number, weeks = 1) {
  return addCalendarDays(weekStart, weeks * 7);
}

export function getSessionsLast30Days(database: AppDatabase, now = new Date()) {
  const nowTimestamp = new Date(now).getTime();
  const windowStart = getRollingWindowStart(now, 30);

  return getAllActivityTimestamps(database).filter((performedAtIso) => {
    const performedAt = new Date(performedAtIso).getTime();
    return performedAt >= windowStart && performedAt <= nowTimestamp;
  }).length;
}

export function getRecentActivityStrip(database: AppDatabase, now = new Date(), days = 16) {
  const today = toDayStart(now);
  const todayStart = today.getTime();
  const activeDays = new Set(
    getAllActivityTimestamps(database).map((performedAt) => getCalendarDayStartTimestamp(performedAt)),
  );
  const items = [];

  for (let index = days - 1; index >= 0; index -= 1) {
    // Calendar stepping, not fixed 24-hour chunks. The day a clock changes is
    // 23 or 25 hours long, so subtracting DAY_MS across one lands at 01:00 or
    // 23:00 — a timestamp no logged day can equal, because `activeDays` holds
    // real local midnights. Every bar before the change would read free, however
    // much was trained.
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - index);
    const dayStart = date.getTime();

    items.push({
      dayStart,
      dayNumber: date.getDate(),
      weekdayLabel: FI_WEEKDAYS_SHORT[date.getDay()],
      active: activeDays.has(dayStart),
      isToday: dayStart === todayStart,
    });
  }

  return items;
}

export function getMonthlyActivityCalendar(database: AppDatabase, now = new Date()) {
  const todayStart = getCalendarDayStartTimestamp(now);
  const activeDays = new Set(
    getAllActivityTimestamps(database).map((performedAt) => getCalendarDayStartTimestamp(performedAt)),
  );

  const referenceDate = toDayStart(now);
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
  const gridStart = new Date(getCalendarWeekStartTimestamp(monthStart));
  const gridEnd = new Date(getCalendarWeekStartTimestamp(monthEnd));
  gridEnd.setDate(gridEnd.getDate() + 6);
  gridEnd.setHours(0, 0, 0, 0);

  const weeks = [];
  let currentWeek = [];
  const cursor = new Date(gridStart);

  while (cursor.getTime() <= gridEnd.getTime()) {
    const dayStart = cursor.getTime();
    currentWeek.push({
      dayStart,
      dayNumber: cursor.getDate(),
      active: activeDays.has(dayStart),
      isToday: dayStart === todayStart,
      inCurrentMonth: cursor.getMonth() === referenceDate.getMonth(),
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return {
    monthLabel: `${FI_MONTHS[referenceDate.getMonth()]} ${referenceDate.getFullYear()}`,
    weekdayLabels: FI_WEEKDAYS,
    weeks,
  };
}

/**
 * Consecutive active weeks ending now, from the active weeks' local Monday
 * starts (`getCalendarWeekStartTimestamp`).
 *
 * An empty current week does not break the run: it is not over yet, and a
 * counter that reads 0 every Monday morning until the first session is a
 * counter nobody trusts. So the walk starts at this week when it has
 * activity, else at last week, and steps back by calendar week (a week with a
 * clock change is 167 or 169 hours long, so a fixed step lands off Monday
 * midnight and matches nothing).
 *
 * The one walk. Home's streak, Profile's lifetime summary and the Progress
 * calendar each carried a copy, and three audits had to make them match by
 * hand — once because Home started from this week and the other two did not
 * (audit round 4, 2026-09-20; duplicate sweep 13, 2026-10-12).
 */
export function streakFromWeekStarts(weekStarts: Iterable<number>, now: Date = new Date()): number {
  const activeWeeks = new Set(weekStarts);
  const currentWeekStart = getCalendarWeekStartTimestamp(now);
  let cursor = activeWeeks.has(currentWeekStart) ? currentWeekStart : getCalendarWeekStartBefore(currentWeekStart);
  let streak = 0;
  while (activeWeeks.has(cursor)) {
    streak += 1;
    cursor = getCalendarWeekStartBefore(cursor);
  }
  return streak;
}

export function getCurrentWeekStreak(database: AppDatabase, now = new Date()) {
  return streakFromWeekStarts(
    getAllActivityTimestamps(database).map((performedAt) => getCalendarWeekStartTimestamp(performedAt)),
    now,
  );
}
