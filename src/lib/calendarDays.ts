/**
 * Local calendar-day arithmetic, in one place.
 *
 * Helsinki changes its clocks twice a year, so a local day is 23, 24 or 25
 * hours long. Every helper here steps by calendar date through the Date
 * constructor, never by adding `DAY_MS`, so a result lands on local midnight
 * (or the same wall-clock time) on both sides of a clock change.
 *
 * Pure: no imports, no side effects.
 */

/** Local midnight of the day `date` falls on. NaN for an invalid date. */
export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight `offset` calendar days from `date` — not `+ offset * DAY_MS`. */
export function dayStartPlus(date: Date, offset: number): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

/**
 * `reference` shifted by whole calendar days, keeping its time of day.
 *
 * Adding or subtracting `days * DAY_MS` instead drifts an hour whenever the
 * span crosses a clock change, and an hour is the whole distance between a
 * timestamp that matches a stored day or week start and one that matches
 * nothing.
 *
 * One case the Date constructor decides rather than this function: a wall-clock
 * time that spring-forward skips normalizes forward an hour. Under Helsinki's
 * 03:00 transitions only times in that hour are affected, which is why the week
 * helpers — always at local midnight — are exact.
 */
export function addCalendarDays(reference: Date | string | number, days: number): number {
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
