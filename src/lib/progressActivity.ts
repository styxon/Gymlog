import { isScheduleKnown, TrainingSchedule, trainsOn } from './trainingSchedule';

/**
 * What a square in the activity calendar means.
 *
 * `missed` is only ever claimed about a day that has already passed and was
 * genuinely a planned training day. A rest day without a session is just rest,
 * and a training day still ahead is upcoming, not a failure — the calendar
 * should never invent a streak the user broke.
 *
 * The plan's rhythm comes in as a TrainingSchedule, the same shape Home and
 * the widget read, so a two-on-one-off cycle marks the same days here as it
 * does everywhere else. A weekday list could not say that (2026-08-25).
 */
type ProgressActivityDayStatus = 'done' | 'missed' | 'upcoming' | 'rest' | 'outside';

interface ProgressActivityDayInput {
  dayStart: number;
  dayNumber: number;
  active: boolean;
  isToday: boolean;
  inCurrentMonth: boolean;
}

interface ProgressActivityOptions {
  /** The plan's rhythm; unknown means nothing is ever called missed. */
  schedule?: TrainingSchedule;
  /** Start-of-day timestamp for today, used to place a day in past or future. */
  todayStart?: number;
}

export function getProgressActivityDayStatus(
  day: ProgressActivityDayInput,
  options: ProgressActivityOptions = {},
): ProgressActivityDayStatus {
  if (!day.inCurrentMonth) {
    return 'outside';
  }

  if (day.active) {
    return 'done';
  }

  const schedule = options.schedule;
  if (!schedule || !isScheduleKnown(schedule)) {
    // Without a schedule there is nothing to have missed.
    return 'rest';
  }

  if (!trainsOn(schedule, new Date(day.dayStart))) {
    return 'rest';
  }

  const todayStart = options.todayStart;
  if (todayStart === undefined) {
    return 'rest';
  }

  // Today stays in play until it ends, so it reads as upcoming, never missed.
  return day.dayStart < todayStart ? 'missed' : 'upcoming';
}
