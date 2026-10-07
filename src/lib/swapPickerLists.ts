import { ExerciseLibraryItem, AppLanguage } from '../types/models';
import { oneRowPerShownName } from './exerciseSearch';
import { exerciseNameLabel } from './exerciseNameLabel';
import { ExercisePickerFilters, listPickerExercises, matchesExercisePickerFilters } from './exercisePicker';
import { orderSwapCandidates } from './swapBrowsePrefilter';

/**
 * The swap sheet's two lists, for every screen that swaps a lift.
 *
 * The guided player's "Vaihda liike" became the add sheet in swap mode
 * (#bugs 2026-10-06), and Home's swap kept a list of its own: a search and
 * two plain lists, no chips (review, 2026-10-07). Both now draw the same
 * sheet over these two lists, so what a swap offers cannot depend on where
 * the reader opened it.
 */

/** Unsearched, the library list is a choice, not a scroll. */
const UNSEARCHED_CAP = 25;
/** Typing lifts the cap to something a reader can still read through. */
const SEARCHED_CAP = 40;

export interface SwapPickerLibraryOptions {
  query: string;
  filters: ExercisePickerFilters;
  language: AppLanguage;
  /** The lift being replaced, as stored, and its library row (null when the library does not hold it). */
  currentName: string | null;
  currentItem: ExerciseLibraryItem | null;
  /**
   * Shown names left out: today's other lifts (a swap to a lift two rows
   * down changes nothing) and the cards above the list (the same row twice).
   */
  excludeLabels: ReadonlySet<string>;
  popularOrder: ReadonlyMap<string, number>;
}

/**
 * Everything else the library holds, under the sheet's chips.
 *
 * Every picker's one list (lib/exercisePicker): what can be logged as sets
 * until the reader types, specialty movements only under their own chip.
 * Matched on the displayed name as well as the stored one: the plan may hold
 * "Barbell Squat" where the library holds "Back Squat", and both read
 * "Takakyykky". Unsearched, nearest the lift first (orderSwapCandidates);
 * searched, best answer first. One row per shown name.
 */
export function buildSwapPickerLibrary<T extends ExerciseLibraryItem>(
  library: readonly T[],
  { query, filters, language, currentName, currentItem, excludeLabels, popularOrder }: SwapPickerLibraryOptions,
): T[] {
  const typed = query.trim();
  const currentLabel = currentName ? exerciseNameLabel(language, currentName) : null;
  const pool = listPickerExercises(library, {
    query: typed,
    filters,
    language,
    popularity: (item) => popularOrder.get(item.id),
  }).filter((item) => {
    const label = exerciseNameLabel(language, item.name);
    return item.name !== currentName && label !== currentLabel && !excludeLabels.has(label);
  });
  if (!typed) {
    return oneRowPerShownName(orderSwapCandidates(pool, currentItem, popularOrder), language).slice(0, UNSEARCHED_CAP);
  }
  return oneRowPerShownName(pool, language).slice(0, SEARCHED_CAP);
}

/**
 * The programme's alternatives, as the sheet's first cards, under its chips.
 *
 * The body-part chip does not reach them — it opens on the lift's own body
 * part, and the alternatives are the programme's answer whatever chip is on —
 * but a category or equipment chip does: a reader who taps "Käsipaino" is
 * asking for dumbbell lifts, and a barbell card above them would argue with
 * the chip. An alternative the library does not hold cannot be checked, so it
 * steps aside while one of those two is on.
 */
export function narrowSwapAlternatives<T extends { item: ExerciseLibraryItem | null }>(
  rows: readonly T[],
  filters: ExercisePickerFilters,
): T[] {
  const narrowed = filters.category !== 'all' || filters.equipment !== 'all';
  return rows.filter(
    ({ item }) => !narrowed || (item !== null && matchesExercisePickerFilters(item, { ...filters, bodyPart: 'all' })),
  );
}
