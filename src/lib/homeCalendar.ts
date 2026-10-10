import { SessionFocusKind } from './homeSessionHero';
import { nextStartableSessionIndex } from './programSessionList';
import { forecastSlotOn, SessionForecast, TrainingSchedule } from './trainingSchedule';
import type { SlotDose } from './swapDose';
import { AppLanguage } from '../types/models';

// Sunday-first, matching Date#getDay().
const WEEKDAY_LABELS: Record<AppLanguage, string[]> = {
  en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  fi: ['SU', 'MA', 'TI', 'KE', 'TO', 'PE', 'LA'],
};
const MONTH_LABELS: Record<AppLanguage, string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  // Lowercase, because Finnish writes month names lowercase even as a
  // heading. These read under Finnish labels on Home and in the calendar.
  fi: [
    'tammikuu',
    'helmikuu',
    'maaliskuu',
    'huhtikuu',
    'toukokuu',
    'kesäkuu',
    'heinäkuu',
    'elokuu',
    'syyskuu',
    'lokakuu',
    'marraskuu',
    'joulukuu',
  ],
};
// Month grid runs Monday-first to match weekdayIndex (0 = Monday) elsewhere.
const MONTH_WEEKDAY_LABELS: Record<AppLanguage, string[]> = {
  en: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  fi: ['MA', 'TI', 'KE', 'TO', 'PE', 'LA', 'SU'],
};

/**
 * Monday-first weekday abbreviations, indexed by the `weekdayIndex` convention
 * used across the app (0 = Monday). Shared so the home-screen widget cannot
 * drift into a second set of labels.
 */
export function getMondayFirstWeekdayLabels(language: AppLanguage = 'en') {
  return MONTH_WEEKDAY_LABELS[language] ?? MONTH_WEEKDAY_LABELS.en;
}

function toDayStart(dateInput: Date) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatTwoDigitDatePart(value: number) {
  return String(value).padStart(2, '0');
}

function formatDayMonth(date: Date) {
  return `${formatTwoDigitDatePart(date.getDate())}/${formatTwoDigitDatePart(date.getMonth() + 1)}`;
}

export interface HomeMiniCalendarDay {
  dayStart: number;
  label: string;
  weekdayLabel: string;
  weekdayIndex: number;
  dateLabel: string;
  isToday: boolean;
}

export interface HomeDaySessionSummary {
  id: string;
  title: string;
  /**
   * The day's stored name, as written — what a rename edits. `title` is a
   * presentation: a placeholder name ("Day 2") reads as a focus label
   * derived from the first lift, and prefilling the rename field with
   * that wrote "Lower Focus" into the template as the real name (audit
   * round 4, 2026-09-20).
   */
  name?: string;
  duration: string;
  /**
   * The plan's actual weekday label for this session (e.g. "Tue"), taken from
   * the saved plan entries — weekday truth. Null/absent = no fixed weekday.
   */
  dayLabel?: string | null;
  /** Total working sets across every exercise (Home v4 meta grid). */
  totalSets?: number;
  /**
   * The same number `duration` renders, carried as a number so Home does not
   * have to parse its own label back out of a string.
   */
  durationMinutes?: number;
  /**
   * What "Shorter session" would do, computed where the full session is still
   * in hand. Home only receives the first five exercises, so it cannot work
   * this out itself — and a trim preview built from a truncated list would
   * quote a shorter session than the one that starts.
   */
  trim?: { droppedSets: number; minutes: number } | null;
  /**
   * What the session trains, classified from its exercises — carried for the
   * same reason `trim` is: Home sees five exercises and would classify a
   * different session than the one that starts.
   */
  focusKind?: SessionFocusKind;
  exercises: Array<{
    name: string;
    setsLabel: string;
    /** The number behind `setsLabel`, so a dropped lift can be taken off the header count. */
    targetSets?: number;
    /**
     * The stored template's own exercise id. Removing a lift from the
     * programme is written against this — the slot id below belongs to the
     * runtime and finds nothing in the template.
     */
    exerciseId?: string;
    /** Sets-by-reps scheme, e.g. "4 × 6–8" (Home v3 agenda list). */
    schemeLabel?: string;
    /**
     * Runtime slot this row will become, and the pool it can be swapped
     * within. Present only where both are known — Home offers the swap button
     * on a row exactly when it can identify what the choice would apply to.
     */
    slotId?: string;
    substitutionGroup?: string;
    /**
     * The numbers behind `schemeLabel`, as the session will start on them, so
     * a row swapped for today can print the swapped lift's dose rather than
     * the programme's (lib/swapDose).
     */
    dose?: SlotDose;
  }>;
}

export interface HomeDayView {
  kind: 'training' | 'recovery';
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaEyebrow: string;
  ctaTitle: string;
  session: HomeDaySessionSummary | null;
}

export function getHomeMiniCalendarDays(now = new Date(), language: AppLanguage = 'en'): HomeMiniCalendarDay[] {
  return getHomeCarouselCalendarDays(now, { daysBefore: 2, daysAfter: 4, language });
}

export function getHomeCarouselCalendarDays(
  now = new Date(),
  {
    daysBefore = 7,
    daysAfter = 14,
    language = 'en',
  }: { daysBefore?: number; daysAfter?: number; language?: AppLanguage } = {},
): HomeMiniCalendarDay[] {
  const todayStart = toDayStart(now);
  const todayTimestamp = todayStart.getTime();
  const totalDays = Math.max(1, daysBefore + daysAfter + 1);

  return Array.from({ length: totalDays }, (_, index) => {
    const offset = index - daysBefore;
    // Calendar-arithmetic construction, like the month grid below. Stepped by
    // DAY_MS this row crossed the October clock change and drew Sunday twice,
    // dropping the Monday after it — and every day past the change carried the
    // weekday before it, so the row offered the wrong session for a whole day.
    const date = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + offset);
    const weekdayLabel = WEEKDAY_LABELS[language][date.getDay()] ?? '';
    const isToday = date.getTime() === todayTimestamp;

    return {
      dayStart: date.getTime(),
      label: isToday ? formatDayMonth(date) : weekdayLabel,
      weekdayLabel,
      weekdayIndex: date.getDay() === 0 ? 6 : date.getDay() - 1,
      dateLabel: isToday ? formatDayMonth(date) : '',
      isToday,
    };
  });
}

export interface HomeMonthCalendarDay {
  dayStart: number;
  dayOfMonth: number;
  weekdayIndex: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface HomeMonthCalendar {
  monthLabel: string;
  weekdayLabels: string[];
  weeks: HomeMonthCalendarDay[][];
}

/**
 * @param monthOffset months away from the one containing `now` — negative goes
 *   back, positive forward. Only `isToday` is anchored to the real date, so a
 *   paged month never claims a day is today.
 */
export function getHomeMonthCalendar(
  now = new Date(),
  language: AppLanguage = 'en',
  monthOffset = 0,
): HomeMonthCalendar {
  const todayStart = toDayStart(now);
  // Normalising through day 1 avoids the month-end overflow that would turn
  // 31 January + 1 month into 3 March.
  const shifted = new Date(todayStart.getFullYear(), todayStart.getMonth() + monthOffset, 1);
  const year = shifted.getFullYear();
  const month = shifted.getMonth();
  const monthStart = new Date(year, month, 1);
  // Offset from the Monday that starts the grid to the 1st of the month.
  const gridStartOffset = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((gridStartOffset + daysInMonth) / 7);

  return {
    monthLabel: `${MONTH_LABELS[language][month]} ${year}`,
    weekdayLabels: [...MONTH_WEEKDAY_LABELS[language]],
    weeks: Array.from({ length: weekCount }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, weekdayIndex) => {
        // Calendar-arithmetic construction keeps day starts DST-safe.
        const date = new Date(year, month, 1 - gridStartOffset + weekIndex * 7 + weekdayIndex);

        return {
          dayStart: date.getTime(),
          dayOfMonth: date.getDate(),
          weekdayIndex,
          inMonth: date.getMonth() === month,
          isToday: date.getTime() === todayStart.getTime(),
        };
      }),
    ),
  };
}

/**
 * The session a training slot holds.
 *
 * Modulo keeps a cycle longer than the programme walking round it: a
 * three-session plan on a six-day rhythm returns to session 1, rather than
 * running off the end of the list into a rest day it never meant (the walk
 * handles a cycle running backwards from its anchor, and an empty list).
 *
 * A day with no exercises hands its slot to the next day that has some, the
 * rule Home's hero uses (`nextStartableSessionIndex`). The week strip and the
 * widget indexed the list straight, so a day added empty ("Lisää päivä")
 * read as today's workout, "0 exercises", while the hero above it offered
 * the next filled day (audit 8, 2026-09-26). Null when no day has anything.
 */
export function sessionForSlot<T extends { exercises: ReadonlyArray<unknown> }>(
  sessions: ReadonlyArray<T>,
  slot: number | null,
): T | null {
  if (slot === null) {
    return null;
  }
  const index = nextStartableSessionIndex(
    sessions.map((session) => session.exercises.length),
    slot,
  );
  return index === null ? null : sessions[index] ?? null;
}

/**
 * The session a date is shown with: the rhythm decides whether it trains, the
 * forecast (when there is one) which session.
 *
 * From today on the forecast counts turns, and a day with nothing in it takes
 * none: `forecastSlotOn` alone counts raw slots and `sessionForSlot` hands an
 * empty one on at lookup, so with A, an empty B, C, D after A was trained,
 * today and the next training day both landed on C and every chip after them
 * was one session off what the hero then walked (bug hunt 10, 2026-10-09).
 * The walk here starts at the first day that can be trained and steps through
 * the filled days only. Days before today, a call with no forecast, and a
 * session already trained today keep `forecastSlotOn`'s own answer.
 */
export function sessionForForecastDay<T extends { exercises: ReadonlyArray<unknown> }>(
  sessions: ReadonlyArray<T>,
  schedule: TrainingSchedule,
  date: Date,
  forecast: SessionForecast | null,
): T | null {
  const slot = forecastSlotOn(schedule, date, forecast);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (slot === null || !forecast || dayStart < forecast.fromDayStart) {
    return sessionForSlot(sessions, slot);
  }
  if (forecast.trainedToday && dayStart === forecast.fromDayStart) {
    return sessionForSlot(sessions, slot);
  }
  const filled: number[] = [];
  sessions.forEach((session, index) => {
    if (session.exercises.length > 0) {
      filled.push(index);
    }
  });
  const start = nextStartableSessionIndex(
    sessions.map((session) => session.exercises.length),
    forecast.nextSlot,
  );
  if (start === null) {
    return null;
  }
  // forecastSlotOn answers nextSlot + turn, turn counted from zero.
  const turn = slot - forecast.nextSlot;
  return sessions[filled[(filled.indexOf(start) + turn) % filled.length]] ?? null;
}

/**
 * What one day is for.
 *
 * The schedule decides whether the day trains and which slot of the programme
 * it gets; this only turns that into copy. It takes a `TrainingSchedule` rather
 * than a list of weekdays because a rhythm need not have a period of seven —
 * two days on and one off is one the app could not previously express at all.
 */
export function getHomeDayView(
  day: Pick<HomeMiniCalendarDay, 'dayStart' | 'weekdayIndex' | 'weekdayLabel' | 'dateLabel' | 'label' | 'isToday'>,
  schedule: TrainingSchedule,
  sessions: HomeDaySessionSummary[],
  /** Where the rotation stands; from today on, days are named by it (forecastSlotOn). */
  forecast: SessionForecast | null = null,
): HomeDayView {
  const session = sessionForForecastDay(sessions, schedule, new Date(day.dayStart), forecast);

  if (session) {
    return {
      kind: 'training',
      eyebrow: day.dateLabel || day.weekdayLabel,
      title: session.title,
      subtitle: `${session.duration} - ${session.exercises.length} ${session.exercises.length === 1 ? 'exercise' : 'exercises'}`,
      ctaEyebrow: day.isToday ? 'NO EXCUSES' : 'TRAINING',
      ctaTitle: day.isToday ? 'JUST RESULTS' : 'TODAY',
      session,
    };
  }

  return {
    kind: 'recovery',
    eyebrow: day.dateLabel || day.weekdayLabel,
    title: 'Recovery day',
    subtitle: 'Keep it easy: walk, mobility, light stretching, or full rest.',
    ctaEyebrow: 'RECOVERY',
    ctaTitle: 'MOVE EASY',
    session: null,
  };
}
