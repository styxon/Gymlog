import { useCallback } from 'react';

import type { ProgramSeason } from '../lib/programSeasons';
import { addSeasonEnrolment } from '../lib/seasonEnrolment';
import type { PreferencesPatch } from '../state/AppProvider';
import type { AppPreferences } from '../types/models';

/**
 * Signing up for a season: the one callback the season screen's button runs.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because it is a useCallback, and VinhaApp calls this exactly where
 * the lines stood — after useRecordsAndMilestones, before useGoalFlow — so
 * every hook keeps its slot.
 */
export interface SeasonEnrolmentDeps {
  /** The reader's preferences: the season enrolments already stored. */
  preferences: AppPreferences;
  /** The app context's preference writer. */
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
}

export function useSeasonEnrolment(deps: SeasonEnrolmentDeps) {
  const { preferences, updatePreferences } = deps;

  /**
   * Signing up for a season — the whole act, in one place.
   *
   * It writes a row and nothing else. The season screen writes it only after
   * the season's programme is running: the row is what turns the screen to
   * "running", and it was written before a cap refusal (hunt 10, #11).
   *
   * From the stored enrolments: it runs after the adoption's awaited write,
   * and this render's snapshot predates that.
   */
  const handleEnrolSeason = useCallback(
    (season: ProgramSeason, year: number) =>
      updatePreferences((current) => ({
        seasonEnrolments: addSeasonEnrolment(current.seasonEnrolments, {
          season,
          year,
          joinedAt: new Date().toISOString(),
        }),
      })),
    [updatePreferences],
  );

  return {
    handleEnrolSeason,
  };
}
