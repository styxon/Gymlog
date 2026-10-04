/**
 * Turns the user's notification preferences plus what the app actually knows
 * about their training into a concrete list of local notifications to schedule.
 *
 * Everything here is local-only. There is no server and no push token, so every
 * message has to be written and dated in advance — which means a notification
 * may only ever say something that is still true when it fires:
 *
 * - The weekly summary quotes real numbers and is scheduled for *this* week's
 *   Sunday only. Sessions can only enter the app through the app, so every new
 *   session re-runs this planner and the numbers stay current.
 * - The personal-record note fires the morning after the session, when "you set
 *   a new best yesterday" is a fact rather than a duplicate of what is already
 *   on screen.
 * - The comeback nudge is anchored to the last session and nothing else, so a
 *   long gap produces exactly one ping instead of a daily drip.
 * - A declared training break silences everything. Somebody who told us they
 *   are injured or away does not need reminding.
 *
 * The level (quiet / normal / motivating) is a real per-day cap, matching what
 * the settings screen promises. When a day is over its cap the rarest message
 * wins: a record beats a comeback nudge beats a reminder beats a summary.
 */
import { getCalendarWeekStartTimestamp } from './completedSessions';
import { formatCompactVolume, formatVolume } from './format';
import { t } from './i18n';
import { AppLanguage, NotificationLevel, NotificationPrefs, SetupWeekday } from '../types/models';
import { exerciseNameLabel } from './exerciseNameLabel';
import { MEASUREMENT_LABEL_KEYS } from './homeStatCards';
import { isMeasurementReminderKind } from './measurementReminder';
import { isScheduleKnown, TrainingSchedule, trainsOn } from './trainingSchedule';

export type NotificationCategory =
  | 'record'
  | 'comeback'
  | 'reminder'
  | 'weekly'
  | 'weighIn'
  | 'measure'
  /** The Pro trial is nearly over. Promised in words on the hand-off row. */
  | 'trial';

export interface PlannedNotification {
  /** Stable across re-plans, so an unchanged plan re-schedules identically. */
  key: string;
  category: NotificationCategory;
  title: string;
  body: string;
  fireAtMs: number;
  /**
   * Which measurement a 'measure' reminder names, so its tap can open the
   * measures list ON that kind instead of on whatever was selected last.
   * Undefined on every other category.
   */
  measureKind?: string;
}

export interface LatestPrSignal {
  exerciseName: string;
  weightKg: number;
  reps: number;
  achievedAtMs: number;
}

export interface NotificationPlanInput {
  nowMs: number;
  prefs: NotificationPrefs;
  language: AppLanguage;
  /** Days the user picked in setup. Empty = unknown, so no reminders. */
  /**
   * The rhythm itself, not a list of weekdays.
   *
   * This was `trainingDays: SetupWeekday[]`, matched with `getDay()` — so a
   * reader on a 3-on-1-off cycle was reminded on the weekdays their setup
   * once named, which after the first week is a different set of days
   * entirely. The same TrainingSchedule Home draws its dots from answers
   * both kinds, and answers them the same way (2026-09-16).
   */
  schedule: TrainingSchedule;
  lastSessionAtMs: number | null;
  /**
   * Newest completed workout, cardio left out. The reminder skip reads this
   * rather than `lastSessionAtMs`: a run does not do the day's planned
   * training, so a morning run used to cancel that evening's reminder.
   */
  lastWorkoutAtMs: number | null;
  weekSessionCount: number;
  weekVolumeKg: number;
  latestPr: LatestPrSignal | null;
  onTrainingBreak: boolean;
  /** Last weigh-in, so today's nudge is skipped once it is already done. */
  lastBodyweightAtMs?: number | null;
  /** Last measurement of the reminded kind, for the same reason. */
  lastMeasurementAtMs?: number | null;
  /**
   * When the Pro trial runs out, or null when there is no trial running.
   *
   * The hand-off row says "we tell you when two days are left", so this is a
   * promise the app made rather than a nudge it invented.
   */
  proTrialEndsAtMs?: number | null;
}

export const DAILY_CAP_BY_LEVEL: Record<NotificationLevel, number> = {
  quiet: 1,
  normal: 2,
  motivating: 3,
};

/** How far ahead reminders are laid down, so a quiet month still gets them. */
export const REMINDER_HORIZON_DAYS = 28;
/** Days of silence before the comeback nudge. */
export const COMEBACK_AFTER_DAYS = 5;
export const WEEKLY_SUMMARY_HOUR = 18;
/** Before breakfast: a weight taken at the same time of day is comparable. */
export const WEIGH_IN_HOUR = 7;
export const WEIGH_IN_MINUTE = 30;
/**
 * Half the reminder horizon. A daily message over four weeks would be 28 of
 * the 48 slots the OS allows, and the app re-plans on every launch anyway.
 */
export const WEIGH_IN_HORIZON_DAYS = 14;
export const RECORD_HOUR = 9;
/** iOS keeps at most 64 pending local notifications; stay well under it. */
export const MAX_SCHEDULED = 48;

const CATEGORY_PRIORITY: Record<NotificationCategory, number> = {
  // Top of the list. Everything else in here is a nudge the app decided to
  // send; this one is a warning the app promised in writing, and it names a
  // deadline the reader cannot get back once it passes.
  trial: -1,
  record: 0,
  // Asked for by name, like the weigh-in, and the rarer of the two: once a
  // week against every morning. On the same minute of the same morning the
  // rarer message keeps the slot — on the quiet level, with both on, the
  // daily one used to win every Sunday inside its horizon and the weekly one
  // never fired at all (PR review).
  measure: 1,
  // Next: the other message the reader asked for by name, so it does not
  // lose its slot to a reminder that is on by default.
  weighIn: 2,
  comeback: 3,
  reminder: 4,
  weekly: 5,
};

const JS_WEEKDAY: Record<SetupWeekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const DEFAULT_REMINDER_HOUR = 17;
const DEFAULT_REMINDER_MINUTE = 30;

/** "17:30" -> { hour: 17, minute: 30 }. Anything malformed falls back. */
export function parseReminderTime(value: string | null | undefined) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
  if (!match) {
    return { hour: DEFAULT_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Local wall-clock time `dayOffset` days from `reference`. Built through the
 * Date constructor so month ends and DST shifts land on the hour the user
 * picked rather than on a raw +24h arithmetic drift.
 */
function atLocalTime(reference: Date, dayOffset: number, hour: number, minute: number) {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  ).getTime();
}

function localDayKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isSameLocalDay(left: number, right: number) {
  return localDayKey(left) === localDayKey(right);
}

function buildSessionReminders(input: NotificationPlanInput): PlannedNotification[] {
  const { prefs, language, nowMs } = input;
  if (!prefs.sessionReminders || !isScheduleKnown(input.schedule)) {
    return [];
  }

  const now = new Date(nowMs);
  const { hour, minute } = parseReminderTime(prefs.reminderTime);
  const reminders: PlannedNotification[] = [];

  for (let offset = 0; offset <= REMINDER_HORIZON_DAYS; offset += 1) {
    const fireAtMs = atLocalTime(now, offset, hour, minute);
    if (fireAtMs <= nowMs) {
      continue;
    }
    if (!trainsOn(input.schedule, new Date(fireAtMs))) {
      continue;
    }
    // Already trained that day — the reminder has nothing left to ask for.
    const lastWorkoutAtMs = input.lastWorkoutAtMs ?? null;
    if (lastWorkoutAtMs !== null && isSameLocalDay(lastWorkoutAtMs, fireAtMs)) {
      continue;
    }

    reminders.push({
      key: `reminder-${localDayKey(fireAtMs)}`,
      category: 'reminder',
      title: t(language, 'notif.msg.reminderTitle'),
      body: t(language, 'notif.msg.reminderBody'),
      fireAtMs,
    });
  }

  return reminders;
}

/**
 * A morning nudge to weigh in, every day it is on.
 *
 * Daily is the point: a weight is noise on any single morning and a line over
 * a fortnight, so the habit is what is being asked for. Today is skipped once
 * the scale has already been used — a reminder for something already done is
 * the sign that explains a sign.
 */
function buildWeighInReminders(input: NotificationPlanInput): PlannedNotification[] {
  const { prefs, language, nowMs } = input;
  if (!prefs.weighInReminder) {
    return [];
  }

  const now = new Date(nowMs);
  const reminders: PlannedNotification[] = [];
  for (let offset = 0; offset <= WEIGH_IN_HORIZON_DAYS; offset += 1) {
    const fireAtMs = atLocalTime(now, offset, WEIGH_IN_HOUR, WEIGH_IN_MINUTE);
    if (fireAtMs <= nowMs) {
      continue;
    }
    const weighedAt = input.lastBodyweightAtMs ?? null;
    if (weighedAt !== null && isSameLocalDay(weighedAt, fireAtMs)) {
      continue;
    }
    reminders.push({
      key: `weighin-${localDayKey(fireAtMs)}`,
      category: 'weighIn',
      title: t(language, 'notif.msg.weighInTitle'),
      body: t(language, 'notif.msg.weighInBody'),
      fireAtMs,
    });
  }
  return reminders;
}

/**
 * One tape measurement a week, on the morning the reader picked.
 *
 * Weekly, not daily: a circumference moves by millimetres a week, and a
 * daily reading is the tape's own noise. The weigh-in hour, so it is taken
 * under the same conditions a weight is. Skipped on a day that kind has
 * already been measured — a reminder for something done is the sign that
 * explains a sign.
 */
function buildMeasurementReminders(input: NotificationPlanInput): PlannedNotification[] {
  const { prefs, language, nowMs } = input;
  const kind = prefs.measurementReminderKind;
  // A kind that is not a tape measurement (body fat) cannot be reminded as
  // one; the loader rejects it, and this refuses it again on the way out.
  if (!kind || !isMeasurementReminderKind(kind)) {
    return [];
  }
  const wantedWeekday = JS_WEEKDAY[prefs.measurementReminderDay];
  if (wantedWeekday === undefined) {
    return [];
  }

  const now = new Date(nowMs);
  const kindLabel = t(language, MEASUREMENT_LABEL_KEYS[kind]);
  const reminders: PlannedNotification[] = [];
  for (let offset = 0; offset <= REMINDER_HORIZON_DAYS; offset += 1) {
    const fireAtMs = atLocalTime(now, offset, WEIGH_IN_HOUR, WEIGH_IN_MINUTE);
    if (fireAtMs <= nowMs || new Date(fireAtMs).getDay() !== wantedWeekday) {
      continue;
    }
    const measuredAt = input.lastMeasurementAtMs ?? null;
    if (measuredAt !== null && isSameLocalDay(measuredAt, fireAtMs)) {
      continue;
    }
    reminders.push({
      key: `measure-${kind}-${localDayKey(fireAtMs)}`,
      category: 'measure',
      title: t(language, 'notif.msg.measureTitle', { kind: kindLabel }),
      body: t(language, 'notif.msg.measureBody'),
      fireAtMs,
      measureKind: kind,
    });
  }
  return reminders;
}

/**
 * How many days after the last session the comeback nudge may fire.
 *
 * A flat five days told a once-a-week reader "it's been 5 days, no rush" every
 * single week, before their next planned day was even due (bug hunt,
 * 2026-10-04). A nudge about a gap only makes sense once a planned day has
 * actually gone by without a session, so it waits for the day after the first
 * scheduled day that follows the last session, and never fires earlier than
 * COMEBACK_AFTER_DAYS. Stepping is by calendar date so a 23- or 25-hour DST
 * day cannot shift it. With no known schedule there is no planned day to
 * miss, so the flat window stays.
 */
export function comebackGapDays(schedule: TrainingSchedule, lastSession: Date): number {
  if (!isScheduleKnown(schedule)) {
    return COMEBACK_AFTER_DAYS;
  }
  // An empty cycle has nothing planned; the flat window is the safe answer.
  for (let offset = 1; offset <= 60; offset += 1) {
    const day = new Date(lastSession.getFullYear(), lastSession.getMonth(), lastSession.getDate() + offset, 12, 0, 0, 0);
    if (trainsOn(schedule, day)) {
      return Math.max(COMEBACK_AFTER_DAYS, offset + 1);
    }
  }
  return COMEBACK_AFTER_DAYS;
}

function buildComebackNudge(input: NotificationPlanInput): PlannedNotification | null {
  const { prefs, language, nowMs } = input;
  if (!prefs.comebackNudge || input.lastSessionAtMs === null) {
    return null;
  }

  const { hour, minute } = parseReminderTime(prefs.reminderTime);
  const lastSession = new Date(input.lastSessionAtMs);
  const gapDays = comebackGapDays(input.schedule, lastSession);
  const fireAtMs = atLocalTime(lastSession, gapDays, hour, minute);
  // Anchored to the last session only: once that moment has passed there is no
  // second nudge, and the next one needs a new session to hang off.
  if (fireAtMs <= nowMs) {
    return null;
  }

  return {
    key: 'comeback',
    category: 'comeback',
    title: t(language, 'notif.msg.comebackTitle'),
    body: t(language, 'notif.msg.comebackBody', { days: gapDays }),
    fireAtMs,
  };
}

function weeklyBodyKey(sessionCount: number, volumeKg: number) {
  if (volumeKg <= 0) {
    return 'notif.msg.weeklyBodyNoVolume' as const;
  }
  return sessionCount === 1 ? ('notif.msg.weeklyBodyOne' as const) : ('notif.msg.weeklyBody' as const);
}

function buildWeeklySummary(input: NotificationPlanInput): PlannedNotification | null {
  const { prefs, language, nowMs } = input;
  // Nothing logged this week: a summary of nothing is a guilt trip, not a recap.
  if (!prefs.weeklySummary || input.weekSessionCount < 1) {
    return null;
  }

  const now = new Date(nowMs);
  const daysUntilSunday = (7 - now.getDay()) % 7;
  const fireAtMs = atLocalTime(now, daysUntilSunday, WEEKLY_SUMMARY_HOUR, 0);
  // Only ever this week's Sunday. Scheduling next week's would ship numbers
  // that describe a week the summary does not claim to be about.
  if (fireAtMs <= nowMs || getCalendarWeekStartTimestamp(new Date(fireAtMs)) !== getCalendarWeekStartTimestamp(now)) {
    return null;
  }

  return {
    key: 'weekly',
    category: 'weekly',
    title: t(language, 'notif.msg.weeklyTitle'),
    // A cardio-only week has no lifted volume — quoting "0 kg" would read as a
    // failure rather than as a week that simply was not about the barbell.
    body: t(language, weeklyBodyKey(input.weekSessionCount, input.weekVolumeKg), {
      count: input.weekSessionCount,
      volume: formatCompactVolume(input.weekVolumeKg),
    }),
    fireAtMs,
  };
}

function buildRecordNote(input: NotificationPlanInput): PlannedNotification | null {
  const { prefs, language, nowMs, latestPr } = input;
  if (!prefs.personalRecords || !latestPr) {
    return null;
  }

  // The morning after: by then "yesterday" is true and the record card the user
  // already saw on the completion screen is no longer on screen.
  const fireAtMs = atLocalTime(new Date(latestPr.achievedAtMs), 1, RECORD_HOUR, 0);
  if (fireAtMs <= nowMs) {
    return null;
  }

  return {
    key: `record-${localDayKey(latestPr.achievedAtMs)}`,
    category: 'record',
    title: t(language, 'notif.msg.recordTitle'),
    body: t(language, 'notif.msg.recordBody', {
      exercise: exerciseNameLabel(language, latestPr.exerciseName),
      // A lift is never tonnes — formatVolume keeps "92.5 kg" as written.
      weight: formatVolume(latestPr.weightKg),
      reps: latestPr.reps,
    }),
    fireAtMs,
  };
}

/** Applies the level's per-day cap, keeping the rarest message on a busy day. */
function applyDailyCap(planned: PlannedNotification[], level: NotificationLevel) {
  const cap = DAILY_CAP_BY_LEVEL[level] ?? DAILY_CAP_BY_LEVEL.normal;
  const byDay = new Map<string, PlannedNotification[]>();

  planned.forEach((item) => {
    const dayKey = localDayKey(item.fireAtMs);
    const bucket = byDay.get(dayKey);
    if (bucket) {
      bucket.push(item);
    } else {
      byDay.set(dayKey, [item]);
    }
  });

  const kept: PlannedNotification[] = [];
  byDay.forEach((items) => {
    const ranked = [...items].sort(
      (left, right) =>
        CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category] ||
        left.fireAtMs - right.fireAtMs,
    );
    kept.push(...ranked.slice(0, cap));
  });

  return kept.sort((left, right) => left.fireAtMs - right.fireAtMs);
}

/** How long before the trial's last moment the warning goes out. */
const TRIAL_WARNING_DAYS = 2;
/**
 * Fixed milliseconds, and deliberately so.
 *
 * The repo's rule is to step calendar dates by date rather than by DAY_MS,
 * because Helsinki's 23- and 25-hour days push a fixed step off local
 * midnight. This is not a calendar step: the trial ends at an instant, and the
 * warning is 48 hours before that instant. A clock change moves the wall-clock
 * time of the notice by an hour and changes nothing about when the trial ends.
 */
const TRIAL_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two days before the trial ends, once.
 *
 * Not a training nudge, which is why it survives a training break below: the
 * reader is on holiday, and the trial runs out anyway. It is still subject to
 * `pushEnabled` — an app that promised a warning cannot deliver one to
 * somebody who turned notifications off, and pretending otherwise would be the
 * lie, not the silence.
 */
function buildTrialEndingNote(input: NotificationPlanInput): PlannedNotification | null {
  const endsAt = input.proTrialEndsAtMs;
  if (!endsAt || !Number.isFinite(endsAt)) {
    return null;
  }
  const fireAtMs = endsAt - TRIAL_WARNING_DAYS * TRIAL_DAY_MS;
  if (fireAtMs <= input.nowMs) {
    return null;
  }
  return {
    key: `trial:${endsAt}`,
    category: 'trial',
    title: t(input.language, 'notif.trial.title'),
    body: t(input.language, 'notif.trial.body', { days: TRIAL_WARNING_DAYS }),
    fireAtMs,
  };
}

export function buildNotificationPlan(input: NotificationPlanInput): PlannedNotification[] {
  if (!input.prefs.pushEnabled) {
    return [];
  }
  const trialNote = buildTrialEndingNote(input);
  // Injured, on holiday, or otherwise out: silence until the break ends. The
  // trial notice is not training, so it goes out regardless.
  if (input.onTrainingBreak) {
    return trialNote ? [trialNote] : [];
  }

  const planned = [
    trialNote,
    ...buildSessionReminders(input),
    ...buildWeighInReminders(input),
    ...buildMeasurementReminders(input),
    buildComebackNudge(input),
    buildWeeklySummary(input),
    buildRecordNote(input),
  ].filter((item): item is PlannedNotification => item !== null);

  return applyDailyCap(planned, input.prefs.level).slice(0, MAX_SCHEDULED);
}
