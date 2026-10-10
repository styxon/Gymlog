import { useEffect } from 'react';

import { resolveLeadPlanId } from '../lib/runningProgrammes';
import type { AppDatabase, AppPreferences } from '../types/models';
import { useAttemptOnce } from './useAttemptOnce';

/**
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because the moved code is an effect; it returns nothing. VinhaApp
 * calls this exactly where the effect stood — after useCoachContext, just
 * ahead of the widget pin-state effect — so React's effect order is
 * unchanged. The doc below is the effect's own.
 */
export interface LeadPlanRepairDeps {
  /** Both stores loaded: nothing is repaired before the stored lead is read. */
  appHydrated: boolean;
  /** The reader's preferences: the lead plan and the held ones. */
  preferences: AppPreferences;
  /** The whole database: the plan records are read. */
  database: AppDatabase;
  /** AppProvider's preference write, for the repaired lead. */
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
}

export function useLeadPlanRepair(deps: LeadPlanRepairDeps) {
  const { appHydrated, preferences, database, updatePreferences } = deps;
  const tryOnce = useAttemptOnce();

  /**
   * Home must never say "find a programme" while one is running.
   *
   * Removing the lead already promotes the next in line, but that is one path
   * of several that can empty `activePlanId` — a season leaving, a plan record
   * being rewritten, a stored value from an older build. Rather than chase each
   * one, the invariant is repaired wherever it broke: a held programme with no
   * lead becomes the lead.
   *
   * A lead naming a plan that no longer exists is broken the same way — Home
   * rendered no programme and no row carried the Active tag — and was left
   * alone because it was not empty (2026-09-16).
   */
  useEffect(() => {
    if (!appHydrated) {
      return;
    }
    const lead = resolveLeadPlanId({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
    });
    if (lead !== preferences.activePlanId) {
      // Once per session and lead: a refused write is rolled back, which broke the invariant
      // again and ran this again, forever.
      tryOnce(`lead:${lead}`, () => updatePreferences({ activePlanId: lead }));
    }
  }, [appHydrated, database.workoutPlans, preferences.activePlanId, preferences.activePlanIds, tryOnce, updatePreferences]);
}
