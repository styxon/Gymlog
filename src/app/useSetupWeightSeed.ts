import { useEffect } from 'react';

import { AppDatabase, AppPreferences } from '../types/models';
import { useAttemptOnce } from './useAttemptOnce';

/**
 * The weight given in setup becomes the first weigh-in: once, ever, and
 * flagged only after the weigh-in is stored. The doc inside says why the flag,
 * not an empty log, decides.
 *
 * Moved out of App.tsx verbatim in the phase-B split (2026-09-30). A hook
 * because the moved code is one effect: VinhaApp calls it at the slot it stood
 * in — after fullBleedReview, before the route-level back listener — so
 * React's hook order and the order the effects run in are unchanged.
 */

export interface SetupWeightSeedDeps {
  /** The database store has loaded: `useAppContext().hydrated`. */
  hydrated: boolean;
  /** The stored preferences: onboarding finished, setup's weight, the seeded flag. */
  preferences: AppPreferences;
  /** The database, passed whole so `database.bodyweightEntries.length` reads as it did in App.tsx. */
  database: AppDatabase;
  /** `useAppContext().addBodyweightEntry`. */
  addBodyweightEntry: (weightKg: number) => Promise<unknown>;
  /** `useAppContext().updatePreferences`. */
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
}

export function useSetupWeightSeed(deps: SetupWeightSeedDeps): void {
  const { hydrated, preferences, database, addBodyweightEntry, updatePreferences } = deps;
  const tryOnce = useAttemptOnce();
  useEffect(() => {
    if (!hydrated || !preferences.onboardingCompleted) {
      return;
    }

    if (
      typeof preferences.setupCurrentWeightKg !== 'number' ||
      !Number.isFinite(preferences.setupCurrentWeightKg) ||
      preferences.setupCurrentWeightKg <= 0
    ) {
      return;
    }

    /**
     * Once, ever — not "whenever the log is empty".
     *
     * An empty log is also what the reader sees the moment they delete their
     * only weigh-in, and this effect put setup's number straight back: the
     * row reappeared, and deleting it looked broken (2026-09-16). The flag
     * records that the seed has been written, so a deleted weigh-in stays
     * deleted.
     */
    if (preferences.setupWeightSeeded || database.bodyweightEntries.length > 0) {
      if (!preferences.setupWeightSeeded && database.bodyweightEntries.length > 0) {
        // Once per session: a refused write is rolled back and this ran again.
        tryOnce('setupWeightSeeded', () => updatePreferences({ setupWeightSeeded: true }));
      }
      return;
    }

    void addBodyweightEntry(preferences.setupCurrentWeightKg)
      // Flagged only once the weigh-in is actually stored: a write that failed
      // has seeded nothing, and the empty log below asks again next render.
      .then(() => updatePreferences({ setupWeightSeeded: true }))
      .catch(() => undefined);
  }, [
    addBodyweightEntry,
    database.bodyweightEntries.length,
    hydrated,
    preferences.onboardingCompleted,
    preferences.setupCurrentWeightKg,
    preferences.setupWeightSeeded,
    tryOnce,
    updatePreferences,
  ]);
}
