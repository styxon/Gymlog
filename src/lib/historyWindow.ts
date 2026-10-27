/**
 * How far back the trend charts reach on the free tier.
 *
 * This is the market's second-strongest converter after the program cap — Hevy
 * caps its charts at three months and its paying users name it unprompted: "I
 * bought it because I wanted to be able to see more than just three months of
 * history data." So the window is worth charging for.
 *
 * What is free and what is paid, and the line between them:
 *
 *   Free, forever, uncapped        Pro
 *   ─────────────────────────      ──────────────────────────────
 *   every session in History       the 6-month and all-time trend
 *   every set inside a session      measures past a year
 *   CSV export                     records older than 3 months
 *   the per-lift trend curve        the per-lift set log
 *
 * The line is between YOUR LOG and a VIEW ASSEMBLED FROM IT. Capping the log
 * would be the thing this app has spent its whole design refusing to do, and
 * the competitor who effectively did it — Strong's v6 update lost people years
 * of saved workouts — is the cautionary tale, not the model. A free user can
 * still open any session they have ever logged and read every set in it, and
 * export the lot.
 *
 * What Pro buys is the app doing the assembling: five sessions of one lift
 * lined up side by side, five years drawn as one line, a record with the
 * figure on it. The data is the user's either way.
 */

import { calendarDaysBetween, subtractCalendarMonths } from './completedSessions';

export const FREE_TREND_MONTHS = 3;

/**
 * Overview trend ranges, shortest first.
 *
 * The week leads and is the default. Three months was, and with two weigh-ins
 * in the log it drew ninety empty slots with both dots crushed against the
 * right edge — "pallo on ihan väärässä kohtaan" (user, 2026-08-25). A window
 * nobody has data for is not a longer view, it is an emptier one, and the
 * reader who wants it is one tap away.
 */
type TrendRange = '7d' | '1m' | '3m' | '6m' | 'all';
/** Body-measure ranges, shortest first. */
type MeasureTrendRange = '7d' | '3m' | '1y' | 'all';

// The week is shorter than the free cap, so it is free in every tier by
// definition — a paywall on seven days would be a paywall on this week.
const FREE_TREND_RANGES: readonly TrendRange[] = ['7d', '1m', '3m'];
const FREE_MEASURE_RANGES: readonly MeasureTrendRange[] = ['7d', '3m'];

export function isTrendRangeLocked(range: TrendRange, proUnlocked: boolean): boolean {
  return !proUnlocked && !FREE_TREND_RANGES.includes(range);
}

export function isMeasureRangeLocked(range: MeasureTrendRange, proUnlocked: boolean): boolean {
  return !proUnlocked && !FREE_MEASURE_RANGES.includes(range);
}

/**
 * The range actually drawn.
 *
 * Entitlement can lapse while the screen is mounted — a promo code runs out,
 * the preview switch goes off — and the selected range is component state that
 * knows nothing about it. Without this, a chart chosen while Pro was on keeps
 * drawing six months after it is off. Falls back to the longest free range so
 * the view narrows rather than resetting to nothing.
 */
export function resolveTrendRange(range: TrendRange, proUnlocked: boolean): TrendRange {
  return isTrendRangeLocked(range, proUnlocked) ? '3m' : range;
}

export function resolveMeasureRange(
  range: MeasureTrendRange,
  proUnlocked: boolean,
): MeasureTrendRange {
  return isMeasureRangeLocked(range, proUnlocked) ? '3m' : range;
}

/**
 * Where a trend chip's window opens: 7D at local midnight six days back (six
 * plus today), the month chips a calendar month back through
 * `subtractCalendarMonths` (the 31st clamps, it does not roll over). Null for
 * All, which follows the history.
 *
 * Every chart under the chips reads it. The weight chart counted fixed days
 * (31 / 91 / 183) while volume and duration went back calendar months, so on
 * 12 October the 3M weight axis began on 14 July and the volume axis on
 * 12 July — and a weigh-in from 13 July set the card's figure over an empty
 * chart (dup sweep 13, 2026-10-12).
 */
export function trendRangeStart(range: TrendRange, now: Date): Date | null {
  switch (range) {
    case '7d':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    case '1m':
      return subtractCalendarMonths(now, 1);
    case '3m':
      return subtractCalendarMonths(now, 3);
    case '6m':
      return subtractCalendarMonths(now, 6);
    case 'all':
    default:
      return null;
  }
}

/**
 * The same window as a count of calendar days, today included: 7 for 7D, 93
 * for 3M on 12 October. Null for All.
 */
export function trendRangeDays(range: TrendRange, now: Date): number | null {
  const start = trendRangeStart(range, now);
  return start ? calendarDaysBetween(start, now) + 1 : null;
}

/**
 * How far back your records read on the free tier.
 *
 * A record is by definition the best you have ever done, so a window on it is
 * a sharper thing than a window on a chart: hide the older ones and the number
 * left on screen is no longer your record, it is your best of the last three
 * months, and the app would be stating it as the former. So the older records
 * are LOCKED rather than dropped — the lift and the date it was set stay
 * readable, only the figure sits behind the lock. Nothing on screen is wrong,
 * and the reader can see exactly what they are being asked to pay for.
 *
 * The window matches the trend charts on purpose. Two different free depths
 * for two views of the same history is a rule nobody can hold in their head.
 */
export const FREE_RECORD_MONTHS = FREE_TREND_MONTHS;

/**
 * The per-lift set log — every set of one exercise, session by session.
 *
 * Not a window but a whole view: free gets the curve over the same sessions,
 * Pro gets the sets behind it. The session log stays free in both tiers, which
 * is what keeps this a paywall on assembly rather than on the user's own data
 * — a free user can still read every one of these sets by opening the sessions
 * they belong to.
 */
export function isSetLogLocked(proUnlocked: boolean): boolean {
  return !proUnlocked;
}

export function isRecordLocked(
  performedAt: string,
  proUnlocked: boolean,
  now: Date = new Date(),
): boolean {
  if (proUnlocked) {
    return false;
  }
  const stamp = Date.parse(performedAt);
  if (!Number.isFinite(stamp)) {
    // An unreadable date cannot be shown to be old, and locking on a parse
    // failure would hide a record the user set yesterday.
    return false;
  }
  // Through `subtractCalendarMonths`, the way the trend ranges above go — the
  // comment there says the window matches the charts on purpose, and the raw
  // construction did not: `new Date(y, m - 3, 31)` on 31 May asks for 31
  // February and JavaScript answers 3 March. So on the 31st of some months the
  // free depth rolled into the following month and locked records the reader
  // was entitled to, while the 3M chart beside them drew from 28 February
  // (audit 3, 2026-09-19).
  const cutoff = subtractCalendarMonths(now, FREE_RECORD_MONTHS);
  return stamp < cutoff.getTime();
}
