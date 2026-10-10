/**
 * The weight on a set: what stepping does, and what typing accepts.
 *
 * Two complaints from the same dial, one morning apart (#bugs 2026-08-27):
 *
 * "Ei voi valita tasan 12 kg." True, and no step size fixes it. The dial moves
 * in 1,25 kg — the smallest real plate pair — so from zero it lands on 11,25
 * and 12,5 and never on 12. A stepper can only reach its own grid; a reader who
 * wants a number off that grid has to be able to say it. The card has claimed
 * you could since it was built — it draws a pencil and tells a screen reader
 * "tap to edit" — and tapping opened the same two buttons.
 *
 * "Yhtäkkiä paino pomppasi +5000 kg." The dial had no ceiling: `Math.max(0, …)`
 * on the way down and nothing on the way up, while a held button accelerates to
 * a step every 45 ms. Whatever produced it, a set of five thousand kilograms is
 * not a number the app should be able to hold — it lands in volume, in records
 * and in the coach's context, and it poisons every chart it touches.
 */

import { parseNumberInput } from './format';
import { WEIGHT_DIAL_MAX_KG } from './weightLimits';

/** The smallest real plate pair. */
export const WEIGHT_DIAL_STEP_KG = 1.25;

/**
 * The ceiling now lives in `weightLimits`, because the loader has to apply the
 * same rule to what is already stored and cannot import this file. Re-exported
 * so the dial still reads as the place that owns its own bounds.
 */
export { WEIGHT_DIAL_MAX_KG };

interface DialBounds {
  step?: number;
  max?: number;
}

/** Two decimals, because 61.25 rounds itself to 61.3 on the way through. */
function toDialPrecision(kg: number): number {
  return Number(kg.toFixed(2));
}

/** One press, or one tick of a held button. */
export function stepDialWeight(
  currentKg: number,
  direction: -1 | 1,
  { step = WEIGHT_DIAL_STEP_KG, max = WEIGHT_DIAL_MAX_KG }: DialBounds = {},
): number {
  const next = (Number.isFinite(currentKg) ? currentKg : 0) + direction * step;
  return toDialPrecision(Math.min(max, Math.max(0, next)));
}

/**
 * What a typed weight becomes.
 *
 * Unparseable input keeps what was there rather than falling to zero: the
 * reader is mid-edit, and a field that empties itself when you delete the last
 * digit has thrown away the number you were adjusting.
 */
export function commitDialWeight(
  text: string,
  previousKg: number,
  { max = WEIGHT_DIAL_MAX_KG }: DialBounds = {},
): number {
  // parseNumberInput takes the Finnish comma as well as the dot.
  const parsed = parseNumberInput(text);
  // Past the ceiling is a typo, not a heavier set: "825" is 82,5 with the
  // comma missed. It was clamped, so the field read 825 while the set logged
  // 500 kg and carried 500 into the next one (decimal audit, 2026-09-21).
  // The set-log editor and the freestyle fields already refuse it.
  // Below zero likewise: "-5" became 0 and threw away the dialled weight,
  // while the field it was typed in read red (CI review of #174).
  if (parsed === null || parsed < 0 || parsed > max) {
    return toDialPrecision(Math.min(max, Math.max(0, previousKg)));
  }
  return toDialPrecision(parsed);
}

/**
 * Whether text typed into the weight dial is a weight the set can log.
 *
 * While it is not — empty mid-edit, "82,,5", "825" — the dial keeps the last
 * number that was, and the log button waits: a set must log what the field
 * says, and the field does not say a weight.
 */
export function isLoggableTypedWeight(text: string, { max = WEIGHT_DIAL_MAX_KG }: DialBounds = {}): boolean {
  const parsed = parseNumberInput(text);
  return parsed !== null && parsed >= 0 && parsed <= max;
}

/** The reps dial: whole numbers. 300 is past any set anyone logs on purpose. */
export const REPS_DIAL = { min: 1, step: 1, max: 300 } as const;
/** A hold's dial counts seconds in fives; half an hour is past any hold. */
export const HOLD_DIAL = { min: 5, step: 5, max: 1800 } as const;
/** Steady cardio's dial counts whole minutes; five hours is past any bout. */
export const MINUTES_DIAL = { min: 1, step: 1, max: 300 } as const;
/**
 * A warm-up's reps: the working dial's floor, a lower ceiling. The store keeps
 * a warm-up of up to 100 and refuses more, so the dial stops where the store
 * does (workoutState `exercise/logWarmup`).
 */
export const WARMUP_REPS_DIAL = { min: 1, step: 1, max: 100 } as const;

interface RepsDialBounds {
  min: number;
  step?: number;
  max: number;
}

/** One press, or one tick of a held button — and a held button stops. */
export function stepDialReps(current: number, direction: -1 | 1, { min, step = 1, max }: RepsDialBounds): number {
  const next = (Number.isFinite(current) ? current : min) + direction * step;
  return Math.min(max, Math.max(min, next));
}

/**
 * What typed reps become. The reps card types too now (user 2026-09-09, with
 * a sketch: number above, buttons below, "tap to type" under both). Whole
 * numbers inside the dial's bounds — a ceiling for the same reason the weight
 * has one (review, PR #88): a fat-fingered 99999 would land in the log and in
 * every chart that reads it. Unparseable input keeps what was there.
 */
export function commitDialReps(text: string, previous: number, { min, max }: RepsDialBounds): number {
  const clamp = (value: number) => Math.min(max, Math.max(min, value));
  const parsed = parseNumberInput(text);
  if (parsed === null) {
    return clamp(previous);
  }
  return clamp(Math.round(parsed));
}

/**
 * Whether text typed into a reps, seconds or minutes dial is a count the set
 * can log — the reps counterpart of `isLoggableTypedWeight`.
 *
 * `commitDialReps` clamps, so "0" logged 1 and "350" logged 300 while the
 * field kept showing what was typed. A set must log what the field says: out
 * of range, or not a number, the dial keeps its last good value and the log
 * button waits. 0 is no set at all — the store refuses it too (`set/complete`).
 */
export function isLoggableTypedReps(text: string, { min, max }: RepsDialBounds): boolean {
  const parsed = parseNumberInput(text);
  if (parsed === null) {
    return false;
  }
  const whole = Math.round(parsed);
  return whole >= min && whole <= max;
}
