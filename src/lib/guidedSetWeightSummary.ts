/**
 * Whether "ramp a ramp" (2026-09-09) is visible in a set summary, or hidden
 * behind one number.
 *
 * Each set's opening weight is deliberately carried from the SAME set index
 * last time (workoutState.ts resolveHistoricalSetDraft / findHistoricalSetForIndex),
 * so a ramp stays a ramp across sessions. But every summary on the guided
 * player collapsed that to one weight: the set card's "LAST TIME" header
 * showed only the heaviest set with rep-only chips, and the walk-up card's
 * NYT/VIIMEKSI showed set 1's planned load and the heaviest logged one. A
 * real case (#bugs 2026-09-29): last time's Lantionnosto laitteessa went
 * 16,25×8, 16,25×8, 30×6, 30×6, 30×6 — the header said "30 kg · 8 8 6 6 6",
 * sets 1-2 opened at 16,25 and set 3 "suddenly" opened at 30 with nothing on
 * screen explaining why.
 *
 * The owner's call (decision "a", 2026-09-29): keep the per-set replay, and
 * make it visible instead of smoothing it away. A uniform set keeps today's
 * exact look — one weight, plain rep chips — so nothing changes for the
 * common case.
 */
import { removeTrailingZeros } from './format';

/** Below this, two set weights are the same number that rounding jittered. */
const LOAD_EQUAL_TOLERANCE_KG = 0.01;

/**
 * True when every weight in the list is the same. Empty and single-element
 * lists count as uniform — there is nothing to show a variation between.
 */
export function isUniformLoad(loadsKg: readonly number[]): boolean {
  if (loadsKg.length <= 1) {
    return true;
  }
  const first = loadsKg[0];
  return loadsKg.every((load) => Math.abs(load - first) <= LOAD_EQUAL_TOLERANCE_KG);
}

/**
 * "60 kg" when every loaded set carries the same weight, "55-60 kg" (locale
 * decimal comma) when it does not. Null when nothing here is actually loaded
 * (bodyweight, or a plan with no target yet) — callers already have their own
 * "—" / first-time text for that case.
 */
export function formatLoadOrRange(loadsKg: readonly number[]): string | null {
  const loaded = loadsKg.filter((load) => load > 0);
  if (loaded.length === 0) {
    return null;
  }
  if (isUniformLoad(loaded)) {
    return `${removeTrailingZeros(loaded[loaded.length - 1])} kg`;
  }
  const min = Math.min(...loaded);
  const max = Math.max(...loaded);
  return `${removeTrailingZeros(min)}-${removeTrailingZeros(max)} kg`;
}

interface HistoricalSetChipsView {
  /** True when every logged set here carried the same weight. */
  uniform: boolean;
  /** One chip per set, in set order: "8" (reps only) when uniform, "16,25×8"
   *  (weight×reps) when the load varied — so a ramp reads as a ramp instead
   *  of a rep count with an unexplained jump partway through. */
  chips: string[];
}

/** The set card's "LAST TIME" chip row. */
export function summarizeHistoricalSetChips(
  sets: readonly { loadKg: number; reps: number }[],
): HistoricalSetChipsView {
  const uniform = isUniformLoad(sets.map((set) => set.loadKg));
  return {
    uniform,
    chips: sets.map((set) => (uniform ? `${set.reps}` : `${removeTrailingZeros(set.loadKg)}×${set.reps}`)),
  };
}
