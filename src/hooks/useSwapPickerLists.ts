import { useCallback, useEffect, useMemo, useState } from 'react';

import { ExercisePickerEntry, SheetEquipmentOption } from '../components/AddExerciseSheet';
import { getDrillLibraryName } from '../lib/drillMedia';
import { BodyPartFilter } from '../lib/exerciseBrowseFilter';
import { ExercisePickerFilters } from '../lib/exercisePicker';
import { getPopularExerciseLibraryOrder } from '../lib/exerciseSuggestions';
import { findGuidedLibraryIndex } from '../lib/guidedPlayer';
import { t } from '../lib/i18n';
import { libraryLabel } from '../lib/libraryLabel';
import { effectiveSwapBodyPart, effectiveSwapCategory, resolveSwapBrowsePrefilter } from '../lib/swapBrowsePrefilter';
import { buildSwapPickerLibrary, narrowSwapAlternatives } from '../lib/swapPickerLists';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

interface SwapPickerListsInput {
  exerciseLibrary: ExerciseLibraryItem[] | undefined;
  /** The lift being replaced, as stored; null while the sheet is closed. */
  currentName: string | null;
  /** The slot's shortlist (variations, then related), drawn as the first cards. Memoize it. */
  alternatives: readonly string[];
  /** The day's lifts, swaps included. Memoize it. */
  sessionLifts: readonly string[];
  query: string;
  language: AppLanguage;
}

/**
 * The swap sheet's chips and lists for a screen that swaps from a planned
 * day — Home and the programme day — before a workout starts.
 *
 * The guided player's "Vaihda liike" is the add sheet in swap mode (#bugs
 * 2026-10-06), and the owner asked for that sheet everywhere (2026-10-07).
 * The lists are lib/swapPickerLists; this holds the chip state and wires the
 * library lookups the way the player does, so the two planned-day screens
 * cannot drift from each other.
 */
export function useSwapPickerLists({
  exerciseLibrary,
  currentName,
  alternatives,
  sessionLifts,
  query,
  language,
}: SwapPickerListsInput) {
  /** The reader's body-part chip; null means the lift's own (effectiveSwapBodyPart). */
  const [bodyPartPick, setBodyPartPick] = useState<BodyPartFilter | null>(null);
  /** The reader's type chip; null means the lift's own (effectiveSwapCategory). */
  const [categoryPick, setCategoryPick] = useState<ExercisePickerFilters['category'] | null>(null);
  const [equipment, setEquipment] = useState<SheetEquipmentOption>('all');
  // Cleared whenever the sheet closes, however it closed (a pick, the close
  // button, hardware back): it never opens on the last lift's chips.
  useEffect(() => {
    if (currentName === null) {
      setBodyPartPick(null);
      setCategoryPick(null);
      setEquipment('all');
    }
  }, [currentName]);

  // One names array per library: the lookup remembers its answers per array
  // (#328), and a fresh .map() per call would miss that every time.
  const libraryNames = useMemo(() => (exerciseLibrary ?? []).map((item) => item.name), [exerciseLibrary]);
  const libraryRow = useCallback(
    (name: string) => {
      const index = findGuidedLibraryIndex(getDrillLibraryName(name) ?? name, libraryNames);
      return index === null || !exerciseLibrary ? null : exerciseLibrary[index];
    },
    [exerciseLibrary, libraryNames],
  );
  const popularOrder = useMemo(() => getPopularExerciseLibraryOrder(exerciseLibrary ?? []), [exerciseLibrary]);

  const currentItem = useMemo(() => (currentName ? libraryRow(currentName) : null), [currentName, libraryRow]);
  const filters = useMemo<ExercisePickerFilters>(
    () => ({
      category: effectiveSwapCategory(categoryPick, currentItem, query),
      bodyPart: effectiveSwapBodyPart(bodyPartPick, resolveSwapBrowsePrefilter(currentItem), query),
      equipment,
    }),
    [bodyPartPick, categoryPick, currentItem, equipment, query],
  );

  const alternativeRows = useMemo(
    () => alternatives.map((name) => ({ name, item: libraryRow(name) })),
    [alternatives, libraryRow],
  );
  const featuredEntries = useMemo<ExercisePickerEntry[]>(
    () =>
      // The type chip reaches the cards only when the reader moved it: the
      // stretch default narrows the library, not the programme's own answer
      // (a core slot filed as a stretch kept none of its four).
      narrowSwapAlternatives(alternativeRows, { ...filters, category: categoryPick ?? 'all' }).map(({ name, item }) => ({
        key: `suggested-${name}`,
        name,
        item,
      })),
    [alternativeRows, categoryPick, filters],
  );
  const libraryEntries = useMemo<ExercisePickerEntry[]>(() => {
    if (!currentName || !exerciseLibrary) {
      return [];
    }
    return buildSwapPickerLibrary(exerciseLibrary, {
      query,
      filters,
      language,
      currentName,
      currentItem,
      excludeNames: [...sessionLifts, ...alternatives],
      popularOrder,
    }).map((item) => ({ key: item.id, name: item.name, item }));
  }, [alternatives, currentItem, currentName, exerciseLibrary, filters, language, popularOrder, query, sessionLifts]);

  /** "Kaikki liikkeet", or the chip's own word while one narrows the list. */
  const libraryTitle = filters.bodyPart !== 'all' ? libraryLabel(filters.bodyPart, language) : t(language, 'guided.swap.library');

  const onFiltersChange = (next: ExercisePickerFilters) => {
    // Only a chip the reader moved becomes theirs: the lift's own body part
    // stays the default until then (effectiveSwapBodyPart).
    if (next.bodyPart !== filters.bodyPart) {
      setBodyPartPick(next.bodyPart);
    }
    if (next.category !== filters.category) {
      setCategoryPick(next.category);
    }
    setEquipment(next.equipment);
  };
  return { filters, onFiltersChange, featuredEntries, libraryEntries, libraryTitle };
}
