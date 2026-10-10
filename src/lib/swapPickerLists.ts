import { ExerciseLibraryItem, AppLanguage } from '../types/models';
import { isExerciseAllowedWithEquipment, resolveAvailableEquipment } from './equipmentExerciseFilter';
import { oneRowPerShownName } from './exerciseSearch';
import { exerciseNameLabel } from './exerciseNameLabel';
import { ExercisePickerFilters, listPickerExercises, matchesExercisePickerFilters } from './exercisePicker';
import { orderSwapCandidates } from './swapBrowsePrefilter';
import { buildSwapShortlist, identityKey } from './swapShortlist';
import { buildSwapOptionsForSlot, TailoringPreferencesInput } from './tailoringFit';

/**
 * The swap sheet's two lists, for every screen that swaps a lift.
 *
 * The guided player's "Vaihda liike" became the add sheet in swap mode
 * (#bugs 2026-10-06), and Home's swap kept a list of its own: a search and
 * two plain lists, no chips (review, 2026-10-07). Both now draw the same
 * sheet over these two lists, so what a swap offers cannot depend on where
 * the reader opened it.
 */

export interface SwapAlternativesInput {
  /** The lift being replaced, as it stands now (today's swap included). */
  currentName: string;
  /** The slot's substitution group; '' when it has none. */
  substitutionGroup: string;
  preferences: TailoringPreferencesInput | null | undefined;
  /** Every lift in the session as it stands, swaps included. */
  sessionLifts: readonly string[];
  query: string;
  language: AppLanguage;
}

/**
 * The programme's alternatives for a slot: the sheet's first cards.
 *
 * The whole substitution pool, same-movement variations first and the related
 * lifts after them (swapShortlist), the lifts already in the session left out.
 * The player once showed every member and Home and the programme day three
 * plus three, so the same lift was a card in one and missing in the other
 * (bug hunt 2026-10-07); all three call this now, and nothing is cut.
 *
 * Nothing the reader's gear cannot do is a card, as in the week the composer
 * built for them: at home with a pair of dumbbells the sheet over Goblet Squat
 * offered Back Squat, Pause Squat and Hip Thrust first, because the score reads
 * only the equipment tier and most squat and hinge variants tie on it (hunt
 * 2026-10-09). Gear that is unknown leaves the pool as it was.
 */
export function buildSwapAlternatives({
  currentName,
  substitutionGroup,
  preferences,
  sessionLifts,
  query,
  language,
}: SwapAlternativesInput): string[] {
  const availableEquipment = resolveAvailableEquipment({
    trainingEnvironment: preferences?.setupTrainingEnvironment,
    equipmentItems: preferences?.setupEquipmentItems,
  });
  const { variations, related } = buildSwapShortlist(
    currentName,
    buildSwapOptionsForSlot(substitutionGroup, currentName, preferences)
      .filter((option) => isExerciseAllowedWithEquipment(option.exerciseName, availableEquipment))
      .map((option) => ({
        ...option,
        searchLabel: exerciseNameLabel(language, option.exerciseName),
      })),
    // The lift being swapped is left out with the others, whether or not the
    // caller's session list holds it under this name.
    { alreadyInSession: [currentName, ...sessionLifts], query, language },
  );
  return [...variations, ...related].map((option) => option.exerciseName);
}

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
   * Stored names left out: today's other lifts (a swap to a lift two rows
   * down changes nothing) and the cards above the list (the same row twice).
   * Matched by the name shown and by identity, so another spelling of one of
   * them is left out too ("Bench Press" in the plan, "Barbell Bench Press -
   * Medium Grip" in the library, both "Penkkipunnerrus").
   */
  excludeNames: readonly string[];
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
  { query, filters, language, currentName, currentItem, excludeNames, popularOrder }: SwapPickerLibraryOptions,
): T[] {
  const typed = query.trim();
  const left = currentName ? [currentName, ...excludeNames] : [...excludeNames];
  const excludedLabels = new Set(left.map((name) => exerciseNameLabel(language, name)));
  const excludedIdentities = new Set(left.map(identityKey));
  const pool = listPickerExercises(library, {
    query: typed,
    filters,
    language,
    popularity: (item) => popularOrder.get(item.id),
  }).filter(
    (item) => !excludedLabels.has(exerciseNameLabel(language, item.name)) && !excludedIdentities.has(identityKey(item.name)),
  );
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
