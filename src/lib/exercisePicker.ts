/**
 * Every exercise picker's list and row, as one rule.
 *
 * The app offers library exercises in five places — the add sheet (programme
 * builder, programme day, guided player), the guided player's swap sheet, the
 * empty workout's add sheet, the exercise library screen and the import's
 * "which lift did you mean" list — and each of them used to compose the
 * shared filters (exerciseBrowseFilter) and the search (exerciseSearch) in its
 * own way. Two of them skipped pieces: the empty workout had its own six
 * body-part chips with no "Etureidet", the library screen filtered by the
 * stored body part, and the import list showed the library's first twenty
 * rows, a stretch among them, unranked (#bugs 2026-10-06, "kaikki filtterit
 * uusiksi"). Which lift belongs to which chip is exerciseBrowseFilter's and
 * exerciseClassification's business; this module only composes them, once,
 * so a picker cannot leave a rule out.
 */
import {
  BodyPartFilter,
  EquipmentFilter,
  ExerciseTypeFilter,
  filterBrowsableExercises,
  matchesBodyPartFilter,
  matchesEquipmentFilter,
  matchesExerciseTypeFilter,
  passesSpecialtyGate,
} from './exerciseBrowseFilter';
import { exerciseRowMetaValues } from './exerciseClassification';
import { exerciseNameLabel } from './exerciseNameLabel';
import { I18nKey, t } from './i18n';
import { rankExerciseMatches } from './exerciseSearch';
import { libraryLabel } from './libraryLabel';
import { AppLanguage, ExerciseLibraryItem } from '../types/models';

export interface ExercisePickerFilters {
  category: ExerciseTypeFilter;
  bodyPart: BodyPartFilter;
  equipment: EquipmentFilter;
}

export const NO_PICKER_FILTERS: ExercisePickerFilters = { category: 'all', bodyPart: 'all', equipment: 'all' };

/** The three chip groups as one rule: type, body part (with the leg muscles), equipment. */
export function matchesExercisePickerFilters(item: ExerciseLibraryItem, filters: ExercisePickerFilters): boolean {
  return (
    matchesExerciseTypeFilter(item, filters.category) &&
    matchesBodyPartFilter(item, filters.bodyPart) &&
    matchesEquipmentFilter(item, filters.equipment)
  );
}

export interface PickerListOptions<T> {
  /** What the reader typed. A query lifts the hiding: they named what they want. */
  query?: string;
  /** The chips in force; a picker without a group leaves it 'all'. */
  filters?: Partial<ExercisePickerFilters>;
  language: AppLanguage;
  /** Library id → popularity rank, lower first; breaks ties under a query. */
  popularity?: (item: T) => number | undefined;
  /**
   * The exercise library screen only: it lists the stretches and drills on
   * purpose, because it is where you learn them. Every picker that adds or
   * swaps a set leaves this off, and the specialty movements stay behind
   * their own chip or a query either way.
   */
  listsStretches?: boolean;
}

/**
 * What a picker lists: with no query, the things you log as sets among normal
 * exercises (no stretch, drill or strongman implement — the specialty chip is
 * the exception), narrowed by its chips; with a query, every match, best
 * answer first.
 */
export function listPickerExercises<T extends ExerciseLibraryItem>(
  items: readonly T[],
  { query = '', filters, language, popularity, listsStretches = false }: PickerListOptions<T>,
): T[] {
  const chips: ExercisePickerFilters = { ...NO_PICKER_FILTERS, ...filters };
  const typed = query.trim();
  const browsable = listsStretches
    ? items.filter((item) => passesSpecialtyGate(item, { query: typed, type: chips.category }))
    : filterBrowsableExercises([...items], { query: typed, type: chips.category });
  const narrowed = browsable.filter((item) => matchesExercisePickerFilters(item, chips));
  return rankExerciseMatches(narrowed, typed, language, popularity);
}

/** An unsearched list's order: the alphabet of the name the reader sees, not the stored English one. */
export function compareByShownName(language: AppLanguage) {
  return (left: Pick<ExerciseLibraryItem, 'name'>, right: Pick<ExerciseLibraryItem, 'name'>) =>
    exerciseNameLabel(language, left.name).localeCompare(exerciseNameLabel(language, right.name));
}

/**
 * A chip's or a row's word for a body part, muscle, type or equipment value —
 * the same word on the chip and under every row in every picker. The add
 * sheet printed "Perusliike · Käsipaino" under a lift the library screen
 * called "Moninivel · Käsipainot", and the empty workout "Hauikset" where both
 * said "Hauis" (#bugs 2026-10-06).
 */
export function exercisePickerLabel(value: string, language: AppLanguage): string {
  return libraryLabel(value, language);
}

/**
 * A filter chip's word. The same as the row's, except where a chip names a
 * group and the row one lift: "Erikoisliikkeet" on the chip, "Erikoisliike"
 * under a tyre flip. The add sheet's words are the app's words (user,
 * 2026-10-06: Perusliike, Cardio, Käsipaino, Talja, Erikoisliikkeet).
 */
const CHIP_KEYS: Partial<Record<string, I18nKey>> = {
  specialty: 'facet.specialty',
};

export function exercisePickerChipLabel(value: string, language: AppLanguage): string {
  const key = CHIP_KEYS[value];
  return key ? t(language, key) : exercisePickerLabel(value, language);
}

/** The words under a row's name — body part, equipment, type — for a layout that splits them. */
export function exercisePickerRowLabels(item: ExerciseLibraryItem, language: AppLanguage): string[] {
  return exerciseRowMetaValues(item).map((value) => exercisePickerLabel(value, language));
}

/** "Rinta · Tanko · Moninivel" — the line under a row's name, in every picker. */
export function exercisePickerRowMeta(item: ExerciseLibraryItem, language: AppLanguage): string {
  return exercisePickerRowLabels(item, language).join(' · ');
}
