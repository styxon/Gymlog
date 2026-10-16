/**
 * The weight wheel's arithmetic: two columns (whole kg, tenths) over one value.
 *
 * Everything runs in integer tenths so 0.1 steps never drift into 74.30000000000001.
 * The tenths column wraps 9 -> 0, and the wrap carries into the whole column
 * because both columns move the same number: a step is +-1 whole or +-1 tenth
 * of that number, clamped to the limits. Pure: no React, no storage.
 */

export interface WheelBounds {
  min: number;
  max: number;
}

export type WheelColumn = 'whole' | 'tenth';

/** Rows shown per column: offsets -2..2 around the selected row. */
export const WHEEL_OFFSETS = [-2, -1, 0, 1, 2] as const;

/** Pixels of drag per step. */
const WHEEL_DRAG_PX_PER_STEP = 50;

const toTenths = (kg: number) => Math.round(kg * 10);

/** A value held to a tenth and inside the limits. */
export function clampWeight(kg: number, { min, max }: WheelBounds): number {
  const tenths = Math.min(Math.max(toTenths(Number.isFinite(kg) ? kg : min), toTenths(min)), toTenths(max));
  return tenths / 10;
}

/** Whole-kg labels for offsets -2..2; null where the row would pass a limit. */
export function wholeRows(kg: number, bounds: WheelBounds): (number | null)[] {
  const whole = Math.floor(toTenths(clampWeight(kg, bounds)) / 10);
  const lo = Math.ceil(toTenths(bounds.min) / 10);
  const hi = Math.floor(toTenths(bounds.max) / 10);
  return WHEEL_OFFSETS.map((offset) => {
    const w = whole + offset;
    return w < lo || w > hi ? null : w;
  });
}

/** Tenth digits for offsets -2..2; the column wraps 9 -> 0. */
export function tenthRows(kg: number, bounds: WheelBounds): number[] {
  const tenth = toTenths(clampWeight(kg, bounds)) % 10;
  return WHEEL_OFFSETS.map((offset) => (((tenth + offset) % 10) + 10) % 10);
}

/** Moves a column by `steps` rows (positive = larger). Wrap carries; limits hold. */
export function stepWeight(kg: number, column: WheelColumn, steps: number, bounds: WheelBounds): number {
  const current = toTenths(clampWeight(kg, bounds));
  const delta = Math.trunc(steps) * (column === 'whole' ? 10 : 1);
  return clampWeight((current + delta) / 10, bounds);
}

/**
 * Rows moved by a vertical drag of `dy` px. Dragging up brings the larger rows
 * (which sit below) to the middle, so the sign flips.
 */
export function dragSteps(dy: number): number {
  return Math.trunc(-dy / WHEEL_DRAG_PX_PER_STEP) || 0;
}
