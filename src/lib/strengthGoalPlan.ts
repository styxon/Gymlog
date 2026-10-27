/**
 * "How much heavier, and how long would that take?"
 *
 * The target picker offered five lifts at three round numbers each. A round
 * number off a poster is not a target — 100 kg means one thing to someone
 * benching 95 and another to someone benching 60 — so a target here is the
 * reader's own best plus something they can actually add, and the time it
 * would take is arithmetic on their own log.
 *
 * Nothing in this file predicts. Every number it returns is either measured
 * from logged sets or a division of two such numbers, and every case where
 * there is nothing to divide returns a named reason instead of a figure.
 */

import { calendarDaysBetween } from './completedSessions';

/** One logged session of a lift: when, and the top set. */
interface RatePoint {
  time: number;
  topSetWeightKg: number;
}

/** The deltas the flow offers. Not a scale — four decisions. */
export const TARGET_DELTAS_KG: readonly number[] = [5, 10, 20, 30];

/**
 * How many sessions the rate is read over.
 *
 * Six is the brief's number and it is a reasonable one: enough that a single
 * good day cannot set the pace, few enough that a rate from last spring does
 * not dilute this month's.
 */
export const RATE_WINDOW_SESSIONS = 6;

/**
 * Beyond this the estimate stops being information.
 *
 * Two years extrapolated from six sessions is a number with no evidence in
 * it. The flow says "more than two years at this rate" rather than printing
 * 137 weeks, because the digits would imply a precision the log cannot carry.
 */
export const RATE_HORIZON_WEEKS = 104;

/**
 * A gap this long ends the window, however few sessions it has collected.
 *
 * Six sessions is a count, and a count can straddle a layoff: train eight
 * times last spring, three times this month, and the last six span a year.
 * The rate then comes out at a third of the reader's actual pace, and the one
 * number this flow exists to state honestly is the one it gets wrong. Eight
 * weeks is a long enough break that what happened before it is a different
 * block of training, not the same one paused.
 */
export const RATE_MAX_GAP_WEEKS = 8;

/** The shortest stretch a pace is measured over. See resolveObservedRate. */
const RATE_MIN_SPAN_WEEKS = 1;

const WEEK_MS = 7 * 86_400_000;

export interface ObservedRate {
  /** Kilos per week, as measured. Can be zero; never NaN. */
  kgPerWeek: number;
  /** What the window actually contained, so a screen can say so. */
  gainKg: number;
  spanWeeks: number;
  sessions: number;
}

/**
 * The rate the reader has actually been adding weight at.
 *
 * Measured, not fitted: the top set of the oldest session in the window
 * against the top set of the newest, over the time between them. A fitted
 * trend would look more sophisticated and would be harder to check against
 * the log by hand, which is the property that matters here.
 *
 * Null when there is nothing to measure — fewer than two sessions, or two
 * sessions on the same day. Null is not zero: "no rate yet" and "no gain" are
 * different things to tell someone, and a caller that conflates them tells a
 * beginner they have stalled.
 */
export function resolveObservedRate(points: readonly RatePoint[]): ObservedRate | null {
  const clean = points
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.topSetWeightKg))
    .slice()
    .sort((left, right) => left.time - right.time);

  // Walk back from the newest and stop at a layoff: the window is the last six
  // sessions of one block, not the last six sessions on the clock.
  const usable: RatePoint[] = [];
  for (let index = clean.length - 1; index >= 0 && usable.length < RATE_WINDOW_SESSIONS; index -= 1) {
    const point = clean[index];
    const newer = usable[0];
    if (newer && (newer.time - point.time) / WEEK_MS > RATE_MAX_GAP_WEEKS) {
      break;
    }
    usable.unshift(point);
  }
  if (usable.length < 2) {
    return null;
  }

  const first = usable[0];
  const last = usable[usable.length - 1];
  const spanWeeks = (last.time - first.time) / WEEK_MS;
  // Under a week is not a pace. Two sessions three days apart, 60 then 65,
  // became "about 3 weeks at your pace" for +30 kg, above a line reading
  // "you have added 5 kg in 0 weeks". Counted in calendar days: seven days
  // across a clock change are 167 hours, which is still a week.
  if (!(spanWeeks > 0) || calendarDaysBetween(first.time, last.time) < RATE_MIN_SPAN_WEEKS * 7) {
    return null;
  }

  const gainKg = last.topSetWeightKg - first.topSetWeightKg;
  return { kgPerWeek: gainKg / spanWeeks, gainKg, spanWeeks, sessions: usable.length };
}

export type WeeksToTarget =
  /** Already there: the best set is at or above the target. */
  | { kind: 'reached' }
  /** Nothing logged to measure a rate from. */
  | { kind: 'noRate' }
  /** A rate exists and it is flat or falling. */
  | { kind: 'noGain'; rate: ObservedRate }
  /** Far enough out that the digits would be false precision. */
  | { kind: 'beyondHorizon'; rate: ObservedRate }
  | { kind: 'weeks'; weeks: number; rate: ObservedRate };

/**
 * How long the reader's own pace would take to cover the gap.
 *
 * Every branch that cannot answer says which one it is, so the screen can
 * write a sentence instead of a shrug. A plateau in particular has to be its
 * own case: dividing by a rate of zero is Infinity, and "∞ weeks" on a card
 * is a rendering fault wearing the clothes of a prediction.
 */
export function estimateWeeksToTarget(
  bestKg: number,
  targetKg: number,
  rate: ObservedRate | null,
): WeeksToTarget {
  if (!Number.isFinite(bestKg) || !Number.isFinite(targetKg) || targetKg <= bestKg) {
    return { kind: 'reached' };
  }
  if (!rate) {
    return { kind: 'noRate' };
  }
  if (!(rate.kgPerWeek > 0)) {
    return { kind: 'noGain', rate };
  }

  const weeks = Math.ceil((targetKg - bestKg) / rate.kgPerWeek);
  if (!Number.isFinite(weeks) || weeks > RATE_HORIZON_WEEKS) {
    return { kind: 'beyondHorizon', rate };
  }
  return { kind: 'weeks', weeks: Math.max(1, weeks), rate };
}

interface TargetLiftRow {
  /** The stored English library name — what a goal is keyed by. */
  exerciseName: string;
  bestKg: number | null;
  rate: ObservedRate | null;
  /** Milliseconds of the most recent logged session, for ordering. */
  lastLoggedAt: number | null;
}

/**
 * The lifts to offer, the ones with a log first.
 *
 * A target on a lift that has never been logged has no best to add to and no
 * rate to work from, so the flow can only offer a bare number and no estimate.
 * Those lifts stay on the list — someone may be aiming at a lift they are
 * about to start — but they sit under the ones the reader actually trains,
 * most recent first, because that is the order the question is usually asked
 * in.
 */
export function orderTargetLifts<T extends TargetLiftRow>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftLogged = left.bestKg !== null;
    const rightLogged = right.bestKg !== null;
    if (leftLogged !== rightLogged) {
      return leftLogged ? -1 : 1;
    }
    if (leftLogged && rightLogged) {
      const byRecency = (right.lastLoggedAt ?? 0) - (left.lastLoggedAt ?? 0);
      if (byRecency !== 0) {
        return byRecency;
      }
    }
    return left.exerciseName.localeCompare(right.exerciseName);
  });
}
