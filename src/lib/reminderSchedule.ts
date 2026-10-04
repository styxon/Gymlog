/**
 * The rhythm the training-day reminders follow, as one function.
 *
 * The reminders read the reader's cycle when they keep one, otherwise the
 * weekdays their own plan names, otherwise the days setup said they had free.
 * That rule lived inside the scheduling hook, and the two screens that talk
 * about reminders read `setupAvailableDays` on their own — so a reader whose
 * plan named its weekdays, or who trains on a cycle, was told "No training
 * days picked yet" on the very screen whose reminders were firing on those
 * days. The screens now ask this, and cannot say anything else.
 */
import { SetupWeekday } from '../types/models';
import { planWeekdayIndexes, resolveDerivedTrainingDays, WEEKDAY_KEYS } from './programTrainingDays';
import { cycleSchedule, TrainingSchedule, weekdaySchedule, withRestDays } from './trainingSchedule';

export interface ReminderScheduleInput {
  trainingCycle: { pattern: boolean[]; anchorDayStart: number } | null;
  /** The active plan's entries; their labels are weekdays when the plan names them. */
  planEntries: ReadonlyArray<{ label?: string | null }>;
  availableDays: readonly SetupWeekday[];
  /**
   * Days taken off from the recovery sheet. A reminder to train on a day the
   * reader has just made a rest day would be the app arguing with itself.
   */
  restDayStarts?: readonly number[];
}

export function resolveReminderSchedule(input: ReminderScheduleInput): TrainingSchedule {
  return withRestDays(resolveRhythm(input), input.restDayStarts ?? []);
}

function resolveRhythm(input: ReminderScheduleInput): TrainingSchedule {
  if (input.trainingCycle) {
    return cycleSchedule(input.trainingCycle.pattern, input.trainingCycle.anchorDayStart);
  }
  // Availability is not a plan: the days the plan names win over it.
  const named = planWeekdayIndexes(input.planEntries);
  if (named.length > 0) {
    return weekdaySchedule(named);
  }

  /*
   * And when the plan names none, availability is still not a plan.
   *
   * The fallback took every day setup was told the reader had free, so a
   * three-session programme on five free days reminded five times — while
   * Home's week strip, reading the same two facts, lit three dots. The strip
   * thins with `resolveDerivedTrainingDays`; the reminders now ask the same
   * function the same question, so the two cannot disagree (2026-09-19).
   *
   * With no plan there is no count to thin to, and every open day is the only
   * honest answer.
   */
  const open = input.availableDays.map((day) => WEEKDAY_KEYS.indexOf(day)).filter((index) => index >= 0);
  const sessionsPerWeek = input.planEntries.length > 0 ? input.planEntries.length : open.length;
  return weekdaySchedule(resolveDerivedTrainingDays(open, sessionsPerWeek));
}

/**
 * The weekdays a weekday schedule trains on, Monday first. A cycle has no
 * weekdays to name — the same Tuesday trains on one turn and rests on the
 * next — so it answers with none.
 */
export function reminderWeekdays(schedule: TrainingSchedule): SetupWeekday[] {
  if (schedule.kind !== 'weekdays') {
    return [];
  }
  return [...new Set(schedule.weekdayIndexes)]
    .filter((index) => index >= 0 && index < WEEKDAY_KEYS.length)
    .sort((left, right) => left - right)
    .map((index) => WEEKDAY_KEYS[index]);
}
