import { MEASUREMENT_KIND_ORDER } from './measurementKinds';
import { WEEKDAY_KEYS } from './programTrainingDays';
import { MeasurementKind, SetupWeekday } from '../types/models';

/**
 * The weekly measurement reminder's two settings, as one value.
 *
 * "Jos käyttäjä haluaa niin ilmoituksia että muistaa kirjata painot ja vaikka
 * kerran viikossa esim lantion mittaus tai sen mitä itse haluaa" (#bugs
 * 2026-08-29). The weigh-in nudge already existed; this is the other half —
 * one tape measurement, one morning a week, the kind the reader picks.
 *
 * `kind` null is off. There is no separate on/off flag, because a flag that
 * is on with no kind chosen is a reminder that cannot say what to measure.
 */
interface MeasurementReminderSetting {
  kind: MeasurementReminderKind | null;
  day: SetupWeekday;
}

/**
 * What a tape can measure. Body fat is a measurement the app records, but
 * not one a tape takes, and the reminder names its instrument — "Tape
 * measure: Body fat" would be a reminder for the wrong tool (PR review).
 */
type MeasurementReminderKind = Exclude<MeasurementKind, 'bodyfat'>;

export const MEASUREMENT_REMINDER_KINDS: readonly MeasurementReminderKind[] = MEASUREMENT_KIND_ORDER.filter(
  (kind): kind is MeasurementReminderKind => kind !== 'bodyfat',
);

export function isMeasurementReminderKind(value: unknown): value is MeasurementReminderKind {
  return typeof value === 'string' && (MEASUREMENT_REMINDER_KINDS as readonly string[]).includes(value);
}

export function isSetupWeekday(value: unknown): value is SetupWeekday {
  return typeof value === 'string' && (WEEKDAY_KEYS as readonly string[]).includes(value);
}

/**
 * What the loader stores from whatever it read. The rule lives here rather
 * than inline in database.ts so Node can call it: database.ts imports
 * AsyncStorage and cannot be required in a test.
 *
 * A kind the reminder cannot name (a typo, a kind from a newer build, body
 * fat) is off, not a crash; a weekday it does not know is the fallback's day,
 * because a reminder on no day at all would be a setting that quietly does
 * nothing.
 */
export function normalizeMeasurementReminder(
  kind: unknown,
  day: unknown,
  fallback: MeasurementReminderSetting,
): MeasurementReminderSetting {
  return {
    kind: kind === null ? null : isMeasurementReminderKind(kind) ? kind : fallback.kind,
    day: isSetupWeekday(day) ? day : fallback.day,
  };
}
