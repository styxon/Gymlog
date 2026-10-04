/**
 * Which calendar days are training days.
 *
 * The app used to answer this with a set of weekdays — `mon`, `tue`, `wed` —
 * and that set is a rhythm with a period of seven. A reader who trains two days
 * on, one day off has a rhythm with a period of three, and no weekday set can
 * express it: the same weekday is a training day on one turn of the cycle and a
 * rest day on the next. Reported from a gym floor 2026-08-21, with the note
 * that this is the rhythm they always use.
 *
 * So a schedule is one of two shapes, and everything downstream asks this file
 * rather than counting weekdays for itself. That is deliberate: the schedule
 * already had two truths and three editors before this, and a third truth would
 * have been the end of it.
 */

/** Day-of-week indexes, Monday first, matching the rest of the app. */
export interface WeekdaySchedule {
  kind: 'weekdays';
  weekdayIndexes: number[];
  /** Days the reader took off (see withRestDays). */
  restDayStarts?: readonly number[];
}

/**
 * A repeating pattern of training and rest days, anchored to a real date.
 *
 * `pattern` is read cyclically from `anchorDayStart`: `[true, true, false]` is
 * two on, one off. The anchor is a local day start, because a cycle that drifts
 * by an hour drifts by a day twice a year.
 */
export interface CycleSchedule {
  kind: 'cycle';
  pattern: boolean[];
  anchorDayStart: number;
  /** Days the reader took off (see withRestDays). */
  restDayStarts?: readonly number[];
}

export type TrainingSchedule = WeekdaySchedule | CycleSchedule;

/** Nothing is known about the rhythm — draw no dots rather than guess. */
export const UNKNOWN_SCHEDULE: TrainingSchedule = { kind: 'weekdays', weekdayIndexes: [] };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStartOf(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Whole days between two local midnights.
 *
 * Not `(a - b) / DAY_MS`: the day a clock changes is 23 or 25 hours long, and
 * across one of those the division lands on 0.96 of a day and truncates to the
 * wrong side. Rounding is exact for local midnights either side of a change.
 */
function daysBetween(fromDayStart: number, toDayStart: number) {
  return Math.round((toDayStart - fromDayStart) / DAY_MS);
}

export function weekdaySchedule(weekdayIndexes: number[]): TrainingSchedule {
  return { kind: 'weekdays', weekdayIndexes: [...weekdayIndexes] };
}

/**
 * The cycle the setup will save for a chosen pattern.
 *
 * An unchanged pattern keeps the anchor it already has: re-anchoring "2 on, 1
 * off" to today would silently shift which day of the rhythm today is for a
 * reader who only re-ran the questions. The save and the setup's preview both
 * ask this, so the week the preview draws is the week Home shows afterwards
 * (bug hunt, 2026-10-04: the preview always anchored on today).
 */
export function resolveCycleAnchor(
  pattern: readonly boolean[] | null | undefined,
  previousCycle: { pattern: boolean[]; anchorDayStart: number } | null | undefined,
  now: Date,
): { pattern: boolean[]; anchorDayStart: number } | null {
  if (!pattern || pattern.length === 0) {
    return null;
  }
  if (previousCycle && previousCycle.pattern.join(',') === pattern.join(',')) {
    return previousCycle;
  }
  return { pattern: [...pattern], anchorDayStart: dayStartOf(now) };
}

export function cycleSchedule(pattern: boolean[], anchor: Date | number): TrainingSchedule {
  const anchorDayStart = dayStartOf(new Date(anchor));
  // A pattern with no training day in it is not a rhythm, it is a stopped app.
  return pattern.some(Boolean)
    ? { kind: 'cycle', pattern: [...pattern], anchorDayStart }
    : UNKNOWN_SCHEDULE;
}

/**
 * The rhythm with days the reader has taken off — "Lisää lepopäivä huomiselle"
 * from the recovery sheet (2026-09-26).
 *
 * A rest day is a day off and nothing more: it does not push the rest of the
 * rhythm along. The session it would have carried is not lost — Home offers
 * sessions by what was last trained, not by date — so it simply comes on the
 * next training day. Shifting a cycle's count instead would move every later
 * day, and then move them all back the day the rest day passed and was pruned.
 */
export function withRestDays(schedule: TrainingSchedule, restDayStarts: readonly number[]): TrainingSchedule {
  return restDayStarts.length > 0 ? { ...schedule, restDayStarts: [...restDayStarts] } : schedule;
}

/** `[true, true, false]` from "two on, one off". */
export function patternFromOnOff(onDays: number, offDays: number): boolean[] {
  const on = Math.max(1, Math.round(onDays));
  const off = Math.max(0, Math.round(offDays));
  return [...Array.from({ length: on }, () => true), ...Array.from({ length: off }, () => false)];
}

/** False when the reader has told us nothing, so nothing may be claimed. */
export function isScheduleKnown(schedule: TrainingSchedule): boolean {
  return schedule.kind === 'cycle' ? schedule.pattern.some(Boolean) : schedule.weekdayIndexes.length > 0;
}

function weekdayIndexOf(date: Date) {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

/** Where a date falls inside the cycle, counting from the anchor. */
function cycleOffset(schedule: CycleSchedule, date: Date) {
  const length = schedule.pattern.length;
  const offset = daysBetween(schedule.anchorDayStart, dayStartOf(date)) % length;
  // JS keeps the sign of the dividend, so a date before the anchor lands on a
  // negative index — and the day before the anchor is the last day of the
  // previous turn, not an error.
  return (offset + length) % length;
}

export function trainsOn(schedule: TrainingSchedule, date: Date): boolean {
  if (!isScheduleKnown(schedule)) {
    return false;
  }
  if (schedule.restDayStarts?.includes(dayStartOf(date))) {
    return false;
  }
  if (schedule.kind === 'weekdays') {
    return schedule.weekdayIndexes.includes(weekdayIndexOf(date));
  }
  return schedule.pattern[cycleOffset(schedule, date)] === true;
}

/**
 * Which session a training day gets, as an index into the programme's list.
 *
 * For weekdays this is the position in the chosen set, which is what the app
 * has always done. For a cycle it is the count of training days since the
 * anchor: the programme rotates through its sessions in order, and the cycle
 * decides only which calendar days it lands on.
 *
 * Null on a rest day, and on a day no schedule can speak for.
 */
export function sessionSlotOn(schedule: TrainingSchedule, date: Date): number | null {
  if (!trainsOn(schedule, date)) {
    return null;
  }

  if (schedule.kind === 'weekdays') {
    const slot = schedule.weekdayIndexes.indexOf(weekdayIndexOf(date));
    return slot >= 0 ? slot : null;
  }

  const length = schedule.pattern.length;
  const perTurn = schedule.pattern.filter(Boolean).length;
  const elapsed = daysBetween(schedule.anchorDayStart, dayStartOf(date));
  // Turns can be negative for a date before the anchor; floor keeps the count
  // walking backwards in the same direction the calendar does.
  const turns = Math.floor(elapsed / length);
  const within = schedule.pattern.slice(0, cycleOffset(schedule, date)).filter(Boolean).length;
  return turns * perTurn + within;
}

/**
 * Where the rotation stands today: the slot Home's hero offers next
 * (resolveNextPlanEntryIndex, by what was last trained) and whether this
 * programme was already trained today.
 */
export interface SessionForecast {
  /** Local midnight of today. */
  fromDayStart: number;
  /** Index into the plan's session list of the session Home offers next. */
  nextSlot: number;
  trainedToday: boolean;
}

/**
 * Which session a day is shown with, as an index into the programme's list.
 *
 * From today on, the rotation Home's hero follows: the first training day not
 * yet trained gets the session Home offers, and each training day after it
 * the next one. `sessionSlotOn` counted by the calendar instead, so a missed
 * day or a rest day on a training day left every later label one session off
 * what the Start button then offered — the calendar said Legs, Home said Pull
 * (break round, 2026-09-28). The rhythm still decides WHICH days train; only
 * the names follow the rotation. Days before today, and a call with no
 * forecast (the rhythm editor's preview), keep the calendar count.
 */
export function forecastSlotOn(schedule: TrainingSchedule, date: Date, forecast: SessionForecast | null): number | null {
  const day = dayStartOf(date);
  if (!forecast || day < forecast.fromDayStart) {
    return sessionSlotOn(schedule, date);
  }
  if (forecast.trainedToday && day === forecast.fromDayStart) {
    // Today's session is the one just done.
    return forecast.nextSlot - 1;
  }
  if (!trainsOn(schedule, date)) {
    return null;
  }
  // Training days from the first untrained day through this one, stepped by
  // calendar date so a clock change cannot skip or repeat a day.
  const cursor = new Date(forecast.fromDayStart);
  if (forecast.trainedToday) {
    cursor.setDate(cursor.getDate() + 1);
  }
  let turn = 0;
  // A year ahead is the most any calendar here asks for.
  for (let guard = 0; guard < 400 && dayStartOf(cursor) <= day; guard += 1) {
    if (trainsOn(schedule, cursor)) {
      turn += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return forecast.nextSlot + turn - 1;
}

/**
 * How many training days a seven-day window holds, on average, for a rolling
 * cycle of `onDays` training and `offDays` rest.
 *
 * The number the reader actually wants when they dial a rhythm: "2 on, 1 off"
 * is 4.67 sessions a week, and until the screen said so they had to work it
 * out (user, 2026-09-09). Not rounded here — `cycleDaysPerWeek` rounds to the
 * questionnaire's 2..6 answer, and that is a different question. This one is
 * for reading, so it keeps the fraction and lets the caller decide the
 * decimals.
 */
export function cycleSessionsPerWeek(onDays: number, offDays: number): number {
  const on = Math.max(1, Math.round(onDays));
  const off = Math.max(0, Math.round(offDays));
  return (7 * on) / (on + off);
}
