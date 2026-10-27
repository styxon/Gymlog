import { useCallback, useMemo } from 'react';

import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { countLabel } from '../lib/repCountCopy';
import { runningProgrammeTitle as runningProgrammeTitleOf } from '../lib/templatePresentation';
import type { AppDatabase, AppPreferences } from '../types/models';

/**
 * The read models of the programmes that are running, moved out of App.tsx
 * verbatim (app-split step 5): which templates the active plans point at, what
 * a running programme is called, and the ones listed under Home's lead.
 * VinhaApp calls it at the slot the three lines stood in, so the memo and
 * callback identities, and their dependency arrays, are the ones they were.
 */
export function useRunningProgrammeViews({
  database,
  preferences,
  workoutTemplates,
}: {
  database: Pick<AppDatabase, 'workoutPlans'>;
  preferences: Pick<AppPreferences, 'activePlanId' | 'activePlanIds' | 'appLanguage'>;
  workoutTemplates: AppDatabase['workoutTemplates'];
}) {
  /**
   * Which programmes the active plans actually point at.
   *
   * Plan ids are not programme ids: onboarding writes onboarding_plan_<id> and
   * adoption writes ready_plan_<id>, so a reader who picked a ready
   * programme during onboarding holds a different plan id for the same
   * programme. Membership has to be asked of the template, not the plan.
   */
  const activeProgramTemplateIds = useMemo(() => {
    const byId = new Map(database.workoutPlans.map((plan) => [plan.id, plan]));
    // The LEADER counts too. Several writers set `activePlanId` without
    // adding it to `activePlanIds` (activating a held plan, among others),
    // so the plan Home leads with could be missing from this set —
    // and its own detail page then offered "Start this programme" for a
    // programme that was already running (device, 2026-08-30).
    return [...new Set([preferences.activePlanId, ...preferences.activePlanIds])]
      .filter((planId): planId is string => Boolean(planId))
      .map((planId) => byId.get(planId)?.entries[0]?.workoutTemplateId ?? null)
      .filter((id): id is string => Boolean(id));
  }, [database.workoutPlans, preferences.activePlanId, preferences.activePlanIds]);

  /**
   * What a RUNNING programme is called, wherever it is listed: the one rule in
   * lib/templatePresentation (runningProgrammeTitleOf), which Home's hero and
   * the coach read too. The Programs tab lists the same programmes Home does,
   * so it has to reach the same answer.
   */
  const runningProgrammeTitle = useCallback(
    (templateId: string | null, planName: string | null | undefined, days: number): string =>
      runningProgrammeTitleOf(
        templateId ? getWorkoutTemplateById(templateId) : null,
        planName,
        preferences.appLanguage,
        days,
      ),
    [preferences.appLanguage],
  );

  /**
   * The programmes running alongside the one Home leads with.
   *
   * Home's hero still belongs to a single plan; these are the rest, listed
   * under it so a programme the reader added is visible rather than merely
   * stored.
   */
  const homeOtherPrograms = useMemo(() => {
    const byId = new Map(database.workoutPlans.map((plan) => [plan.id, plan]));
    return preferences.activePlanIds
      .filter((planId) => planId !== preferences.activePlanId)
      .map((planId) => {
        const plan = byId.get(planId);
        const templateId = plan?.entries[0]?.workoutTemplateId ?? null;
        const template = templateId ? getWorkoutTemplateById(templateId) : null;
        if (!plan) {
          return null;
        }
        const days = template?.daysPerWeek ?? plan.entries.length;
        // The reader's own programme is named by its template, for the same
        // reason the hero above is: the plan's copy of the name can be older
        // than the last rename. A ready one is not in this map at all, and
        // gets its presentation title from runningProgrammeTitle — the one
        // helper every surface names a running programme with.
        const ownTemplate = templateId
          ? workoutTemplates.find((entry) => entry.id === templateId) ?? null
          : null;
        return {
          planId,
          title: runningProgrammeTitle(templateId, ownTemplate?.name || plan.name, days),
          meta: countLabel(days, 'programs.card.daysOne', 'programs.card.days', preferences.appLanguage),
        };
      })
      .filter((row): row is { planId: string; title: string; meta: string } => row !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    database.workoutPlans,
    preferences.activePlanIds,
    preferences.activePlanId,
    preferences.appLanguage,
    workoutTemplates,
  ]);

  return { activeProgramTemplateIds, runningProgrammeTitle, homeOtherPrograms };
}
