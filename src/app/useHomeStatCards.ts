import { useMemo } from 'react';

import { suggestHomeStatCardKeys } from '../lib/homeCardSuggestions';
import { buildHomeStatCardCatalog, buildHomeStatCards, resolveHomeStatCardKeys } from '../lib/homeStatCards';
import type { ExerciseProgressSummary } from '../lib/progression';
import type { AppDatabase, AppPreferences } from '../types/models';

/**
 * Home's stat cards: the full catalogue, the reader's pinned keys, and the
 * keys the one prompt card may suggest.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30).
 * A hook, not a helper: two of these are memos, and the pinned keys' identity
 * is in dependency lists further down App.tsx. The suggestion stays
 * unmemoised, as it was. VinhaApp calls this exactly where the lines stood —
 * after progressWeeklyTarget — so every hook keeps its slot and every reader
 * still sits below the values it reads.
 *
 * In the moved comment below, "the props below" and "the queue" are in
 * App.tsx. The card sources stay inside; VinhaApp reads only what this
 * returns.
 */
interface HomeStatCardsDeps {
  /** The whole database: the bodyweight and measurement entries are read. */
  database: AppDatabase;
  /** The app context's tracked-lift progress, one summary per tracked exercise. */
  trackedProgress: ExerciseProgressSummary[];
  /** The reader's preferences: language, pinned and dismissed cards, setup focus and goals. */
  preferences: AppPreferences;
}

export function useHomeStatCards(deps: HomeStatCardsDeps) {
  const { database, trackedProgress, preferences } = deps;

  // "Your cards" on Home: full catalog computed once, pins resolved from prefs.
  const homeStatCardSources = useMemo(
    () => ({
      bodyweightEntries: database.bodyweightEntries,
      measurementEntries: database.measurementEntries,
      trackedProgress,
    }),
    [database.bodyweightEntries, database.measurementEntries, trackedProgress],
  );
  const homeStatCatalogCards = useMemo(
    () =>
      buildHomeStatCards(
        buildHomeStatCardCatalog(homeStatCardSources).map((item) => item.key),
        homeStatCardSources,
        preferences.appLanguage,
      ),
    [homeStatCardSources, preferences.appLanguage],
  );
  const homePinnedStatCardKeys = useMemo(
    () => resolveHomeStatCardKeys(preferences.homeStatCardKeys),
    [preferences.homeStatCardKeys],
  );
  /**
   * The ONE prompt card Home may show (design frame 15). The suggester and
   * the sign-in offer used to render independently and stacked; the queue
   * decides, and the props below go quiet for whichever card is not up.
   */
  const homeSuggestedStatCardKeys = suggestHomeStatCardKeys({
    focusAreas: preferences.setupFocusAreas,
    goals: [preferences.setupGoal, ...preferences.setupGoals],
    pinnedKeys: homePinnedStatCardKeys,
    dismissedKeys: preferences.dismissedCardSuggestionKeys,
  });

  return { homeStatCatalogCards, homePinnedStatCardKeys, homeSuggestedStatCardKeys };
}
