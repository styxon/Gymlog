/**
 * Barbell plate math for the freestyle logger's plate readout.
 *
 * Mirrors the AW3 design handoff (aw3-shared.jsx): a 20 kg bar, standard kg
 * plates, and a greedy per-side breakdown. Pure and kg-only like the rest of
 * src/lib.
 */

export const BAR_WEIGHT_KG = 20;

/** Standard kg plates, heaviest first — the greedy order used per side. */
export const PLATE_SIZES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** Competition-style plate colors from the design handoff. */
export const PLATE_COLORS: Record<number, string> = {
  25: '#C0392B',
  20: '#2A6FDB',
  15: '#E0A100',
  10: '#1F8A5B',
  5: '#33302B',
  2.5: '#8A8577',
  1.25: '#B9B4A8',
};

/**
 * Greedy plate breakdown for one side of the bar. Returns an empty list when
 * the total is at or below the bar weight ("just the bar"). Weight that does
 * not divide into standard plates is left off rather than rounded up.
 */
export function platesPerSide(totalKg: number, barKg: number = BAR_WEIGHT_KG): number[] {
  let remaining = (totalKg - barKg) / 2;
  const plates: number[] = [];

  if (!Number.isFinite(remaining) || remaining <= 0.0001) {
    return plates;
  }

  for (const plate of PLATE_SIZES_KG) {
    // The epsilon absorbs float drift from repeated 2.5/1.25 subtraction.
    while (remaining >= plate - 1e-9) {
      plates.push(plate);
      remaining -= plate;
    }
  }

  return plates;
}

interface PlateLoad {
  /** One side, heaviest first. */
  plates: number[];
  /** Below the bar itself: no loading reaches this weight. */
  belowBar: boolean;
  /**
   * What standard plates cannot make, both sides together — 62 kg on a 20 kg
   * bar loads 60 and leaves 2.
   */
  remainderKg: number;
}

/**
 * The readout's whole answer: the plates, and what they do not cover.
 *
 * The readout said "Just the bar (20 kg)" for 15 kg, which is not the bar,
 * and drew the plates for 60 kg under a set of 62 without a word about the
 * other two — what `platesPerSide` leaves off (audit, 2026-09-26).
 */
export function plateLoad(totalKg: number, barKg: number = BAR_WEIGHT_KG): PlateLoad {
  if (!Number.isFinite(totalKg) || totalKg < barKg - 1e-9) {
    return { plates: [], belowBar: true, remainderKg: 0 };
  }
  const plates = platesPerSide(totalKg, barKg);
  const loaded = barKg + 2 * plates.reduce((sum, plate) => sum + plate, 0);
  const remainderKg = Math.round((totalKg - loaded) * 100) / 100;
  return { plates, belowBar: false, remainderKg: remainderKg > 0.001 ? remainderKg : 0 };
}
