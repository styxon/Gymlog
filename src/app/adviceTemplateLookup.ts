import { adaptLegacyWorkoutTemplateToRuntimeTemplate } from '../features/workout/customWorkoutAdapter';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import type { AdviceTemplate, AdviceTemplateLookup } from '../lib/nextSessionAdvice';
import type { AppDatabase, WorkoutTemplateSessionWithExercises } from '../types/models';

export interface AdviceTemplateLookupDeps {
  /** The reader's own programmes. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  defaultRestSeconds: number;
}

/**
 * Finds the programme a logged session was started from — the ready
 * catalogue's, or one of the reader's own — for the rep range and set count
 * the progression gate reads (lib/nextSessionAdvice). Built on first ask, per
 * programme: only the one or two a screen names are ever adapted.
 */
export function createAdviceTemplateLookup(deps: AdviceTemplateLookupDeps): AdviceTemplateLookup {
  const cache = new Map<string, AdviceTemplate | null>();
  return (templateId) => {
    if (cache.has(templateId)) {
      return cache.get(templateId) ?? null;
    }
    const custom = deps.workoutTemplates.find((template) => template.id === templateId);
    const found: AdviceTemplate | null = custom
      ? adaptLegacyWorkoutTemplateToRuntimeTemplate(
          custom,
          deps.getWorkoutTemplateSessions(custom.id),
          deps.exerciseLibrary,
          deps.defaultRestSeconds,
        )
      : getWorkoutTemplateById(templateId);
    cache.set(templateId, found);
    return found;
  };
}
