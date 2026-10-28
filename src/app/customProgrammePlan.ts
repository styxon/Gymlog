import { planLabelsForProgramme } from '../lib/trainingWeekSync';
import { buildCustomProgramPlanId, buildProgramWorkoutPlan } from '../lib/programAdoption';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import type { WorkoutPlan } from '../types/models';
import type { useAppContext } from '../state/AppProvider';
import type { useCustomProgramViews } from './useCustomProgramViews';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * The builder of the plan that takes one of the reader's own programmes into
 * use. Its own module because two factories need it and each needs a value the
 * other returns: adoption calls promoteHeldProgramToLead from the switches,
 * and the switches call this builder. A function declaration hoisted in
 * VinhaApp used to settle that; a factory cannot lean on hoisting, so the
 * builder is made first, from the two values it reads, and handed to both.
 */
interface CustomProgrammePlanBuilderDeps {
  customWorkoutRuntimeMap: ReturnType<typeof useCustomProgramViews>['customWorkoutRuntimeMap'];
  preferences: AppContextValue['preferences'];
}

export function createCustomProgrammePlanBuilder(
  deps: CustomProgrammePlanBuilderDeps,
): (workoutTemplateId: string) => WorkoutPlan | null {
  const { customWorkoutRuntimeMap, preferences } = deps;

  /**
   * The plan that takes one of the reader's own programmes into use, or null
   * when it has no lift to train. Shared by adoption and by switching the
   * active programme off in its favour, so both build the same week.
   */
  function buildCustomProgrammePlan(workoutTemplateId: string) {
    const template = customWorkoutRuntimeMap[workoutTemplateId];
    const sessionIds = (template?.sessions ?? [])
      .filter((session) => session.exercises.length > 0)
      .map((session) => session.id);
    if (sessionIds.length === 0) {
      return null;
    }
    // The program's own session count leads, exactly as it does for a ready
    // programme: an imported six-day week dealt across three chosen weekdays
    // would run every session twice and call itself a three-day programme.
    const dayLabels = planLabelsForProgramme(sessionIds.length, preferences.setupAvailableDays, new Date());
    return buildProgramWorkoutPlan({
      planId: buildCustomProgramPlanId(workoutTemplateId),
      workoutTemplateId,
      programName: formatWorkoutDisplayLabel(template?.name ?? ''),
      sessionIds,
      dayLabels,
      now: new Date().toISOString(),
    });
  }

  return buildCustomProgrammePlan;
}
