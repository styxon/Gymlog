import { exerciseNameLabel } from './exerciseNameLabel';
import { t } from './i18n';
import { AppLanguage } from '../types/models';

/**
 * The guided player's two exercise sheets are one sheet.
 *
 * "Vaihda liike" was a list of picture rows with a search field and body-part
 * chips; "Lisää liike" a card grid with category, body-part and equipment
 * filters. The reader asked for them to be the same sheet — the add sheet's
 * — differing only in what the tap does (#bugs 2026-10-06). Everything the two
 * modes say differently is decided here, so the sheet itself has no `if swap`
 * in its copy.
 */
export type ExerciseSheetMode = 'add' | 'swap';

export interface ExerciseSheetCopy {
  /** "Lisää liike" / "Vaihda Penkkipunnerrus". */
  title: string;
  /** The pill on every card: "Lisää" / "Vaihda". */
  actionLabel: string;
  /**
   * Said under the title in swap mode only: what happens to the sets already
   * logged. An add touches no logged set, so it has nothing to say.
   */
  note: string | null;
  searchPlaceholder: string;
  /** The heading over the first cards: the programme's own alternatives in swap mode. */
  featuredTitle: string;
}

export function exerciseSheetCopy(
  mode: ExerciseSheetMode,
  language: AppLanguage,
  /** The lift being swapped, as stored. Ignored in add mode. */
  swappedName?: string | null,
): ExerciseSheetCopy {
  if (mode === 'swap') {
    return {
      title: t(language, 'guided.swap.title', { name: exerciseNameLabel(language, swappedName ?? '') }),
      actionLabel: t(language, 'sheet.swapAction'),
      note: t(language, 'guided.swap.footnote'),
      searchPlaceholder: t(language, 'guided.swap.search'),
      featuredTitle: t(language, 'guided.swap.suggested'),
    };
  }
  return {
    title: t(language, 'guided.own.addExercise'),
    actionLabel: t(language, 'editor.add'),
    note: null,
    searchPlaceholder: t(language, 'sheet.searchPlaceholder'),
    featuredTitle: t(language, 'sheet.popular'),
  };
}
