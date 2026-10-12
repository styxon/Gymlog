/**
 * What the set screen's top card and set row show when a lift has more sets
 * than fit (#bugs 2026-10-10, from the gym, on an 11-set lift):
 *
 * - the card's two lines show five chips at a time, not a sideways scroll;
 * - the row under it shows at most six boxes, and the −/+ beside them stay
 *   where they are, however many sets are added;
 * - today's line carries its weight, as last time's does, with an arrow when
 *   automated progression moved it.
 *
 * Pure: the screen measures, this decides.
 */
import { type GuidedCurrentLift, type GuidedTargetSet, resolveGuidedSetTargetsAsPlanned } from './guidedPlayer';

/** Chips per line on the card. */
export const GUIDED_CARD_CHIP_CAP = 5;
/** Boxes on the set row. */
export const GUIDED_SET_BOX_CAP = 6;

export interface GuidedWindow {
  /** First index shown. */
  start: number;
  /** One past the last index shown. */
  end: number;
}

/**
 * Which `size` of `total` items to show so the `current` one is among them.
 * The first `size` until the current item would fall off their end; from
 * there the window moves with it and keeps it last, so what has been done
 * leaves on the left and what is left stays in sight on the right only as far
 * as the window reaches.
 */
export function guidedWindow(total: number, current: number, size: number): GuidedWindow {
  const count = Math.max(0, Math.floor(total));
  const width = Math.max(0, Math.min(Math.floor(size), count));
  if (width === 0) {
    return { start: 0, end: 0 };
  }
  const at = Math.min(Math.max(0, Math.floor(current)), count - 1);
  const start = Math.min(Math.max(0, at - (width - 1)), count - width);
  return { start, end: start + width };
}

/**
 * How many boxes of `itemWidth` with `gap` between them fit in `available`,
 * never more than `cap` and never fewer than one. Unmeasured (0) is the cap:
 * the first frame draws what the row is meant to hold, and the measurement
 * only ever takes boxes away, so no box is drawn cut in half.
 */
export function guidedBoxesThatFit(available: number, itemWidth: number, gap: number, cap: number): number {
  if (!(available > 0) || !(itemWidth > 0)) {
    return Math.max(1, cap);
  }
  const fit = Math.floor((available + Math.max(0, gap)) / (itemWidth + Math.max(0, gap)));
  return Math.max(1, Math.min(cap, fit));
}

export type GuidedLoadTrend = 'up' | 'down' | null;

/**
 * The arrow beside today's weight: green up when it is more than last time,
 * red down when less, nothing when the same — and nothing at all unless
 * automated progression is on, the one case where the app moved the number
 * and the arrow says so (#bugs 2026-10-10). Nothing without both weights.
 */
export function guidedLoadTrend(input: {
  lastKg: number | null;
  todayKg: number | null;
  progressionOn: boolean;
}): GuidedLoadTrend {
  const { lastKg, todayKg, progressionOn } = input;
  if (!progressionOn || lastKg === null || todayKg === null || !(lastKg > 0) || !(todayKg > 0)) {
    return null;
  }
  // Rounded to the gram: 16.25 and 16.250000001 are the same plate.
  const delta = Math.round((todayKg - lastKg) * 1000);
  return delta > 0 ? 'up' : delta < 0 ? 'down' : null;
}

/**
 * Last time's weight for the arrow: the heaviest of last time's sets that
 * today's sets stand in for — by position, a set skipped today left out —
 * so the arrow compares like with like. The heaviest of every set last time
 * put a set the lifter added on the day (or the top of a pyramid a lighter
 * session drops) against today's programme sets, and the arrow read red
 * beside "AUTO +2.5 kg" (hunt 12, A11-1). Null when nothing pairs.
 */
export function guidedLastLoadKg(
  lastSets: ReadonlyArray<{ loadKg: number }> | null | undefined,
  todaySets: ReadonlyArray<{ status: string }>,
): number | null {
  if (!lastSets) {
    return null;
  }
  let heaviest = 0;
  todaySets.forEach((set, position) => {
    const last = lastSets[position];
    if (set.status === 'skipped' || !last || !Number.isFinite(last.loadKg)) {
      return;
    }
    heaviest = Math.max(heaviest, last.loadKg);
  });
  return heaviest > 0 ? heaviest : null;
}

/**
 * Today's weight, as last time's heading reads it: the heaviest of the day's
 * sets. Logged sets by what was lifted, the one being done by its dial (so the
 * number follows the reader's thumb), the rest by what their dial will open
 * on. Null for a lift that carries no weight, or when nothing has one.
 */
export function guidedTodayLoadKg(input: {
  sets: GuidedTargetSet[];
  currentSetIndex: number;
  currentKg: number | null;
  trackingMode: string;
  swappedAfterSetIndex?: number | null;
  lift?: GuidedCurrentLift | null;
}): number | null {
  const { sets, currentSetIndex, currentKg, trackingMode, swappedAfterSetIndex, lift } = input;
  const asPlanned = resolveGuidedSetTargetsAsPlanned(sets, trackingMode, swappedAfterSetIndex, lift);
  let heaviest = 0;
  for (const set of sets) {
    if (set.status === 'skipped') {
      continue;
    }
    const kg =
      set.status === 'completed'
        ? set.actualLoadKg ?? null
        : set.setIndex === currentSetIndex && currentKg !== null
          ? currentKg
          : asPlanned.get(set.setIndex)?.loadKg ?? null;
    if (typeof kg === 'number' && Number.isFinite(kg) && kg > heaviest) {
      heaviest = kg;
    }
  }
  return heaviest > 0 ? heaviest : null;
}
