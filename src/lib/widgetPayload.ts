/**
 * The home-screen widget's contents, computed here and handed to Kotlin as
 * finished strings.
 *
 * The widget renders text, coloured date pips and nothing else: no dates, no
 * pluralisation, no translation on the native side. Every one of those has
 * already gone wrong once in this app, and a widget is the worst place to find
 * out — it is drawn by the launcher, in a process with none of the app's
 * context.
 *
 * The week and the session mapping come from `getHomeDayView`, the same
 * function Home renders, so the widget cannot claim a training day the app
 * would call a rest day.
 *
 * SHAPE (v5, "kuukausi" design). The calendar is a real month: the month's
 * name, the weekday letters, and its own numbers — trained days marked green,
 * days still ahead of the reader marked violet. Four widgets read this one
 * payload:
 *
 *   2×2  the month, and nothing else
 *   4×2  the month, with this month's workouts, duration and volume beside it
 *   2×1  the streak
 *   2×1  today's routine
 *
 * The four-week bar strip that came before it is gone: it drew two weeks of
 * marks that nobody could date, and the one number it anchored on ("2/3") said
 * less than a month of green does.
 */
import { localDateKey } from './completedSessions';
import { formatCompactVolume, formatDurationMinutes } from './format';
import { getHomeDayView, getHomeMonthCalendar, getMondayFirstWeekdayLabels, HomeDaySessionSummary } from './homeCalendar';
import { localizeSessionName } from './sessionNameLabel';
import { isScheduleKnown, SessionForecast, TrainingSchedule, trainsOn } from './trainingSchedule';
import { t } from './i18n';
import { AppLanguage } from '../types/models';

/** Bumped whenever the shape changes, so a stale file is ignored, not misread. */
export const HOME_WIDGET_PAYLOAD_VERSION = 9;

/**
 * How many week rows the native layout holds.
 *
 * A month needs four, five or six of them depending on which weekday it starts
 * on, and RemoteViews cannot add a row — so the layout always has six and the
 * provider hides the ones this month does not use.
 */
export const HOME_WIDGET_MONTH_ROWS = 6;

/** How far ahead to look for the next training day before giving up. */
const LOOKAHEAD_DAYS = 14;

/**
 * What a date pip says. "Today" is not a state: it used to be one, which meant
 * a day could not be today *and* done at once — and "you already did it" is
 * the one thing you glance at a home screen to find out. Today is a ring the
 * native side draws around the number.
 *
 * `off` is a rest day and draws in the rest green; `pad` is a cell from the
 * neighbouring month, there to keep the columns honest, and draws as nothing.
 * While rest was transparent the two could share a state — a rest day with a
 * colour cannot be shared with a day that must have none (2026-08-25).
 */
export type HomeWidgetDayState = 'done' | 'plan' | 'off' | 'pad';

/**
 * Where a tap goes. Slugs, not routes: the app resolves them against live
 * state when it opens, because the file the widget reads can be half an hour
 * old and an id baked into a link would be older still.
 */
export type HomeWidgetTarget = 'session' | 'suggestion' | 'calendar' | 'home' | 'programs' | 'schedule';

export interface HomeWidgetDay {
  /** Day of month, e.g. "30" — empty for the days either side of the month. */
  dateLabel: string;
  /**
   * "2026-08-20". The native side compares this against the device's own date
   * to find today.
   *
   * There used to be an `isToday` flag here instead, and it was wrong every
   * morning: the app writes this file when it runs, the widget reads it for as
   * long as it likes, and a flag that says "this day is today" becomes a lie at
   * the next midnight. A date does not go stale — only the reader's idea of
   * what day it is, and the reader has a clock.
   */
  dateKey: string;
  /** False for the leading and trailing days a Monday-first grid drags in. */
  inMonth: boolean;
  state: HomeWidgetDayState;
}

/**
 * What one weekday is for, for each of the seven.
 *
 * The routine widget used to carry a single line computed for the day the file
 * was written. Thursday's "Rest day" then sat on a Friday training day until
 * something opened the app — which is exactly what it did. All seven travel
 * now, and the native side picks the one the device's clock points at.
 */
/**
 * What a routine day IS, as opposed to what it says.
 *
 * The card used to name the session — "Upper MA (raskas)" — and a 2x1 has no
 * room for a name. Asked for 2026-08-21: one word and a colour, because the
 * only question a home screen answers at a glance is whether today is a rest
 * day. `prompt` is the states that have something to ask instead, and those
 * keep their sentence.
 */
export type HomeWidgetRoutineKind = 'rest' | 'work' | 'done' | 'prompt';

export interface HomeWidgetRoutineDay {
  kind: HomeWidgetRoutineKind;
  /**
   * "2026-08-21". Which day this entry is for, matched against the device's
   * clock by the native side.
   *
   * These used to be seven weekdays, Monday-first, and the native side indexed
   * them by the weekday it was. A weekday is only an address for a rhythm with
   * a period of seven, and a reader training two days on and one off does not
   * have one — the same Tuesday trains on one turn and rests on the next. Dates
   * are an address for any rhythm.
   */
  dateKey: string;
  /** "Friday", already in the app's language. */
  when: string;
  /** The session's name, "Rest day", or what to go and do instead. */
  title: string;
  /** Where the arrow goes on that day. */
  target: HomeWidgetTarget;
}

/** One of the three figures the 4×2 puts beside the calendar. */
export interface HomeWidgetStat {
  /** Pre-translated: "Workouts", "Duration", "Volume". */
  label: string;
  /** Already formatted: "6", "4 h 20 min", "12,4 t". */
  value: string;
}

export interface HomeWidgetPayload {
  version: number;
  updatedAt: string;
  /**
   * Which palette the native side should draw. The widget is rendered by the
   * launcher with none of the app's context, so the *resolved* theme travels
   * in the payload rather than being re-derived there.
   */
  theme: 'light' | 'dark';
  /** "August 2026" / "elokuu 2026" — the calendar's heading. */
  monthLabel: string;
  /** "MA".."SU" — the calendar's axis. */
  weekdayLabels: string[];
  /**
   * The month, Monday-first, four to six rows of seven. Shorter than
   * `HOME_WIDGET_MONTH_ROWS` for most months; the native side hides the rest.
   */
  monthWeeks: HomeWidgetDay[][];
  /** Exactly three, in the order the 4×2 draws them. */
  stats: HomeWidgetStat[];
  /** Every workout ever logged, as the app's own lifetime summary counts them. */
  totalValue: string;
  /** "workouts", pre-translated. */
  totalLabel: string;
  /** Seven days from today onward. The native side reads the one its clock points at. */
  routineDays: HomeWidgetRoutineDay[];
}

export interface HomeWidgetInput {
  nowMs: number;
  language: AppLanguage;
  /** The theme the app actually resolved — already through the Pro gate. */
  theme: 'light' | 'dark';
  planName: string | null;
  /**
   * The programme the app would recommend, already presented — the curated
   * title, resolved by the caller because the catalog and its presentation
   * dictionary are not this function's business.
   *
   * Null when onboarding never produced a recommendation, and the empty state
   * falls back to asking rather than naming something it does not have.
   */
  suggestion?: { title: string } | null;
  /**
   * Which days train. Weekdays from setupAvailableDays, or a cycle when the
   * reader keeps a rhythm that does not fit inside a week.
   */
  schedule: TrainingSchedule;
  /**
   * Day-start timestamps of every logged activity, workouts and cardio alike —
   * the same set the app's own activity strip counts, so the calendar cannot
   * mark a day free that the app calls trained.
   */
  completedDayStarts?: number[];
  /**
   * Day-start timestamps of completed *workouts* only. Narrower than the set
   * above on purpose: the pips answer "did anything happen that day", and a run
   * is an answer to that. Whether today's session is behind you is a different
   * question, and a run is not an answer to it — counted there, a morning of
   * cardio would make the widget name tomorrow's workout while Home still
   * offers today's.
   */
  completedWorkoutDayStarts?: number[];
  sessions: HomeDaySessionSummary[];
  /**
   * Where the rotation stands (App's plan card). From today on the widget
   * names days by it, as Home's week strip does — a count of calendar days
   * drifted one session off after any missed day (break round, 2026-09-28).
   * Absent: the calendar's own mapping.
   */
  sessionForecast?: SessionForecast | null;
  /**
   * This month's totals, from `getMonthTrainingTotals`. Absent means zeroes:
   * the stats are drawn either way, because a month with nothing in it is a
   * true answer and a blank column is not.
   */
  monthTotals?: { workouts: number; durationMinutes: number; volumeKg: number };
  /**
   * Every workout ever logged, from `getLifetimeTrainingSummary`. Absent
   * counts as none.
   */
  totalWorkouts?: number;
  /**
   * The session the reader picked for today by hand, when they picked one.
   *
   * Home lets the title be tapped to say "today is legs, not upper", and that
   * answer overrides the rotation. Without it here the widget went on naming
   * what the rotation would have offered, so the home screen and the launcher
   * disagreed about the same day — reported within the hour of the picker
   * shipping.
   */
  todaySessionId?: string | null;
}

function toDayStartMs(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "2026-08-20", in the device's own timezone.
 *
 * Not `toISOString().slice(0, 10)`: that is UTC, and for a reader east of
 * Greenwich the evening's date is already tomorrow's. The widget compares this
 * against a date the launcher formats locally, so both sides have to mean the
 * same midnight.
 */
function toDateKey(date: Date) {
  return localDateKey(date);
}

/**
 * The seven days when they all say the same thing — every state where there is
 * no rhythm to describe, only an instruction.
 */
function everyDay(nowMs: number, when: string, title: string, target: HomeWidgetTarget): HomeWidgetRoutineDay[] {
  // Always a prompt: these are the states with something to ask, and a question
  // does not fit in one word.
  return nextSevenDays(nowMs).map((date) => ({
    kind: 'prompt' as const,
    dateKey: toDateKey(date),
    when,
    title,
    target,
  }));
}

/**
 * Today and the six days after it.
 *
 * Seven is not a week here — it is how long the widget may go without the app
 * running, which is the whole reason every day travels instead of one.
 * Constructed by calendar arithmetic rather than by adding milliseconds, so the
 * two days a year the clock changes do not lose or repeat a date.
 */
function nextSevenDays(nowMs: number): Date[] {
  const now = new Date(nowMs);
  return Array.from(
    { length: 7 },
    (_, offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
}

/**
 * What the routine widget writes for a session.
 *
 * Two things happen here, and both were reported from a home screen. The name
 * arrives as catalog data — English — and went to the widget raw while every
 * screen in the app runs it through `localizeSessionName` first. And "Päivä 3:
 * Kyykky & Soutu" does not fit a 2×1 card: it arrived as "Day 3: squ". The
 * weekday is already the line above, so the day number is the half that can go.
 */
function routineTitleOf(title: string, language: AppLanguage) {
  const localized = localizeSessionName(title, language);
  return localized.replace(/^(päivä|day)\s*\d+\s*[:\-–]\s*/i, '').trim() || localized;
}

function weekdayIndexOf(date: Date) {
  // 0 = Monday, matching the rest of the app.
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

export interface HomeWidgetNextSession {
  session: HomeDaySessionSummary;
  /** Days from today. 0 only when today is a training day still to be done. */
  offset: number;
  weekdayIndex: number;
}

/**
 * The session the widget names, and how far away it is.
 *
 * Shared with the app so a tap on the widget opens the same workout the widget
 * was showing: the link says "the session you named", and this is what names
 * it. Today is skipped once its workout has been logged — pointing at a session
 * that is already done is worse than pointing at the next one. Workouts only:
 * cardio marks the day on the calendar without finishing what was planned for
 * it.
 */
export function findHomeWidgetNextSession(input: {
  nowMs: number;
  schedule: TrainingSchedule;
  sessions: HomeDaySessionSummary[];
  completedWorkoutDayStarts?: number[];
  sessionForecast?: SessionForecast | null;
}): HomeWidgetNextSession | null {
  const { nowMs, schedule, sessions } = input;
  if (!isScheduleKnown(schedule) || sessions.length === 0) {
    return null;
  }

  const now = new Date(nowMs);
  const doneDays = new Set((input.completedWorkoutDayStarts ?? []).map((ms) => toDayStartMs(new Date(ms))));
  const labels = getMondayFirstWeekdayLabels();
  // The forecast speaks for this plan alone; the logged days are every
  // programme's and freestyle's too. Skipping today on a freestyle workout
  // while the forecast still owes today's slot named every later day one
  // session ahead of what Home offers. The logged days only decide when there
  // is no forecast to ask.
  const todayDone = input.sessionForecast
    ? input.sessionForecast.trainedToday
    : doneDays.has(toDayStartMs(now));

  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const weekdayIndex = weekdayIndexOf(date);
    if (!trainsOn(schedule, date)) {
      continue;
    }
    if (offset === 0 && todayDone) {
      continue;
    }

    const view = getHomeDayView(
      {
        dayStart: toDayStartMs(date),
        weekdayIndex,
        weekdayLabel: labels[weekdayIndex] ?? '',
        dateLabel: '',
        label: '',
        isToday: offset === 0,
      },
      schedule,
      sessions,
      input.sessionForecast ?? null,
    );

    if (view.kind !== 'training' || !view.session) {
      continue;
    }

    return { session: view.session, offset, weekdayIndex };
  }

  return null;
}

/**
 * One date's session, or null when that date is a rest day. The same mapping
 * Home draws, so the two cannot disagree about what a day is for.
 */
function sessionForDate(
  date: Date,
  schedule: TrainingSchedule,
  sessions: HomeDaySessionSummary[],
  forecast: SessionForecast | null,
): HomeDaySessionSummary | null {
  if (!isScheduleKnown(schedule) || sessions.length === 0) {
    return null;
  }

  const weekdayIndex = weekdayIndexOf(date);
  const view = getHomeDayView(
    {
      dayStart: toDayStartMs(date),
      weekdayIndex,
      weekdayLabel: getMondayFirstWeekdayLabels()[weekdayIndex] ?? '',
      dateLabel: '',
      label: '',
      // Only the CTA copy reads this, and the widget draws none of it.
      isToday: false,
    },
    schedule,
    sessions,
    forecast,
  );

  return view.kind === 'training' ? view.session : null;
}

function buildStats(language: AppLanguage, totals: HomeWidgetInput['monthTotals']): HomeWidgetStat[] {
  const workouts = totals?.workouts ?? 0;
  const minutes = totals?.durationMinutes ?? 0;
  const volume = totals?.volumeKg ?? 0;

  return [
    { label: t(language, 'widget.stat.workouts'), value: `${workouts}` },
    { label: t(language, 'widget.stat.duration'), value: formatDurationMinutes(minutes) },
    { label: t(language, 'widget.stat.volume'), value: formatCompactVolume(volume) },
  ];
}


/**
 * Where a tap on the widget's session tile actually goes.
 *
 * `resume` — a workout is running, so the tile is a way back into it. This
 * outranks everything: the tile means "my training", and a reader who left a
 * set half-logged to check something on Home is asking for the set, not for a
 * schedule lookup.
 *
 * `open` — nothing running, so the next scheduled session, as before.
 *
 * `home` — nothing running and nothing scheduled to open.
 *
 * Reported from the device 2026-09-01: with a session in progress the tap
 * landed on Home. findHomeWidgetNextSession answers "the next SCHEDULED
 * session" and has no idea one is already open — and it skips today once
 * today's workout is logged, so mid-session there can be nothing left for it
 * to name and the tap fell through to Home. The reader got back in through
 * Home's own "continue" button, which is the button this tile should have
 * been.
 */
export type HomeWidgetSessionTap =
  | { kind: 'resume' }
  | { kind: 'open'; next: HomeWidgetNextSession }
  | { kind: 'home' };

export function resolveHomeWidgetSessionTap(input: {
  /** Whether a workout is open right now, running or paused. */
  hasActiveSession: boolean;
  /** Whether there is a plan whose session could be opened. */
  hasActivePlan: boolean;
  nowMs: number;
  schedule: TrainingSchedule;
  sessions: HomeDaySessionSummary[];
  completedWorkoutDayStarts?: number[];
  /**
   * The session Home's hero offers: the reader's pick for today, or the
   * rotation's next. Absent = the calendar's own mapping, as before.
   */
  homeSessionId?: string | null;
  /** Whether `homeSessionId` is a pick the reader made for today. */
  todayPicked?: boolean;
  /**
   * Where the rotation stands. Without it a tap on a later day opened the
   * calendar's session while the tile, drawn with it, showed the rotation's
   * (review of the forecast, 2026-09-28).
   */
  sessionForecast?: SessionForecast | null;
}): HomeWidgetSessionTap {
  if (input.hasActiveSession) {
    return { kind: 'resume' };
  }
  if (!input.hasActivePlan) {
    return { kind: 'home' };
  }
  const homeSession = input.homeSessionId
    ? input.sessions.find((session) => session.id === input.homeSessionId) ?? null
    : null;
  const today = new Date(input.nowMs);
  // A pick makes today a training day whatever the calendar says — the 2x1
  // reads it that way, so its tap has to open it.
  if (homeSession && input.todayPicked) {
    return { kind: 'open', next: { session: homeSession, offset: 0, weekdayIndex: weekdayIndexOf(today) } };
  }
  const next = findHomeWidgetNextSession(input);
  if (!next) {
    return { kind: 'home' };
  }
  // Today, the tile means "the workout Home is offering me". The calendar maps
  // a date to a slot, the rotation knows which session comes next, and on any
  // day the two disagree the tap opened a workout Home was not showing. Later
  // days follow the rotation forecast the tile was drawn with.
  if (next.offset === 0 && homeSession) {
    return { kind: 'open', next: { ...next, session: homeSession } };
  }
  return { kind: 'open', next };
}

export function buildHomeWidgetPayload(input: HomeWidgetInput): HomeWidgetPayload {
  const { nowMs, language, theme, schedule, sessions } = input;
  const now = new Date(nowMs);
  const todayStart = toDayStartMs(now);
  const doneDays = new Set((input.completedDayStarts ?? []).map((ms) => toDayStartMs(new Date(ms))));
  // Workouts only, like the next-session lookup: a morning run marks the
  // calendar but does not finish what was planned for the day.
  const workoutDoneDays = new Set(
    (input.completedWorkoutDayStarts ?? []).map((ms) => toDayStartMs(new Date(ms))),
  );

  // A rhythm is only real when there is something to do on those days. Without
  // sessions, a "planned" pip would promise a workout that does not exist.
  const scheduleKnown = isScheduleKnown(schedule) && sessions.length > 0;

  // The month the reader is in, built by the same function the app's own
  // calendar screen uses — including which days belong to the neighbouring
  // months, which a Monday-first grid always drags in.
  const month = getHomeMonthCalendar(now, language);
  const monthWeeks: HomeWidgetDay[][] = month.weeks.map((week) =>
    week.map((day) => {
      const isPast = day.dayStart < todayStart;
      const isTraining = scheduleKnown && trainsOn(schedule, new Date(day.dayStart));

      // A past training day that was never logged draws as free. The history is
      // a record of what happened, and the home screen is no place to be
      // reminded of what did not.
      const state: HomeWidgetDayState = doneDays.has(day.dayStart)
        ? 'done'
        : !isPast && isTraining
          ? 'plan'
          : 'off';

      // The days either side of the month are drawn as nothing at all. They are
      // there to keep the columns honest, not to be read.
      return {
        dateLabel: day.inMonth ? `${day.dayOfMonth}` : '',
        dateKey: toDateKey(new Date(day.dayStart)),
        inMonth: day.inMonth,
        state: day.inMonth ? state : 'pad',
      };
    }),
  );

  const total = Math.max(0, Math.round(input.totalWorkouts ?? 0));

  const base = {
    version: HOME_WIDGET_PAYLOAD_VERSION,
    updatedAt: new Date(nowMs).toISOString(),
    theme,
    monthLabel: month.monthLabel,
    weekdayLabels: [...month.weekdayLabels],
    monthWeeks,
    stats: buildStats(language, input.monthTotals),
    totalValue: `${total}`,
    totalLabel: t(language, 'aboutYou.stat.workouts'),
  };
  const planName = input.planName?.trim() ?? '';

  // No program. The widget knows which one the app would recommend, so it names
  // that instead of asking an empty question — and the tap opens that programme
  // rather than the catalog it came from.
  const suggestion = input.suggestion?.title.trim() ? input.suggestion : null;
  if (sessions.length === 0 && !planName) {
    if (suggestion) {
      return {
        ...base,
        routineDays: everyDay(nowMs, t(language, 'widget.suggested'), suggestion.title, 'suggestion'),
      };
    }

    return {
      ...base,
      routineDays: everyDay(nowMs, t(language, 'widget.noPlan'), t(language, 'widget.pickPlan'), 'programs'),
    };
  }

  // A named plan with nothing in it: the name is true, the rhythm is not.
  if (sessions.length === 0) {
    return {
      ...base,
      routineDays: everyDay(nowMs, planName, t(language, 'widget.noSessions'), 'programs'),
    };
  }

  // A program, but no days picked. The plan name borrows the eyebrow — the only
  // place in the family it appears — and the prompt points at the editor.
  if (!isScheduleKnown(schedule)) {
    return {
      ...base,
      routineDays: everyDay(nowMs, planName || t(language, 'widget.noPlan'), t(language, 'widget.noDays'), 'schedule'),
    };
  }

  // The ordinary rhythm. A week of days travels, because the native side is the
  // only one of the two that knows what day it is when the card is drawn.
  return {
    ...base,
    routineDays: nextSevenDays(nowMs).map((date, offset) => {
      // Today only: the reader's own answer, exactly as Home reads it. Later
      // days have no answer yet, and the rotation is the honest guess for them.
      const picked =
        offset === 0 && input.todaySessionId
          ? sessions.find((entry) => entry.id === input.todaySessionId) ?? null
          : null;
      const session = picked ?? sessionForDate(date, schedule, sessions, input.sessionForecast ?? null);
      // "Is today a training day" stops being the question the moment the
      // training is done. The card said "Treeni" on an afternoon when the
      // calendar beside it had already gone green.
      const done = session !== null && workoutDoneDays.has(toDayStartMs(date));
      return {
        kind: done ? ('done' as const) : session ? ('work' as const) : ('rest' as const),
        dateKey: toDateKey(date),
        // The weekday still travels for the accessibility label, but the card
        // no longer draws it: one word is the whole point of this size.
        when: t(language, `widget.weekday.${weekdayIndexOf(date)}` as 'widget.weekday.0'),
        title: t(language, done ? 'widget.doneDay' : session ? 'widget.workoutDay' : 'widget.restDay'),
        // Nothing to start on a rest day, and the next session is two days of
        // rest away as often as not — so the arrow opens Home rather than a
        // workout the reader is not doing today.
        target: session ? ('session' as const) : ('home' as const),
      };
    }),
  };
}
