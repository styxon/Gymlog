/**
 * The dialled ruler's arithmetic (components/RulerPicker), as pure functions.
 *
 * The ruler was a scroll view and nothing else: a screen-reader user could not
 * move it, and on About you the Continue button waits for the weight to be
 * moved (accessibility audit, 2026-09-21). It is an adjustable now, and a
 * swipe up or down steps it by one mark — the same mark a finger lands on, so
 * both ways of moving it are these functions.
 */

export interface RulerBounds {
  min: number;
  max: number;
  /** Smallest change the ruler can express — 0.1 for kg, 1 for cm. */
  step: number;
}

/** How many marks from `min` to `max`. */
export function rulerStepCount({ min, max, step }: RulerBounds): number {
  return Math.max(1, Math.round((max - min) / step));
}

/** The mark nearest a value. */
export function rulerIndexOf(value: number, { min, step }: RulerBounds): number {
  return Math.round((value - min) / step);
}

/**
 * The value at a mark. Rebuilt from the index rather than accumulated, so 0.1
 * steps do not drift into 74.30000000000001 after three hundred ticks.
 */
export function rulerValueAt(index: number, { min, step }: RulerBounds): number {
  const raw = min + index * step;
  const decimals = step < 1 ? 1 : 0;
  return Number(raw.toFixed(decimals));
}

/** One mark up or down, held inside the scale. */
export function stepRulerValue(value: number, direction: -1 | 1, bounds: RulerBounds): number {
  const index = Math.min(rulerStepCount(bounds), Math.max(0, rulerIndexOf(value, bounds) + direction));
  return rulerValueAt(index, bounds);
}

/**
 * What a reader typed into a ruler's number, as a value on that ruler.
 *
 * Finnish keyboards put a comma on the decimal pad, so both separators are
 * read; anything else that is not a number returns null and the caller keeps
 * the old value. The result is held to the scale and to its marks, so typing
 * 71.26 on a 0.1 ruler lands on 71.3 and typing 500 lands on the maximum.
 */
export function parseTypedRulerValue(text: string, bounds: RulerBounds): number | null {
  const cleaned = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const index = Math.min(rulerStepCount(bounds), Math.max(0, rulerIndexOf(parsed, bounds)));
  return rulerValueAt(index, bounds);
}
