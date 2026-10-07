import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { buildWorkoutTemplateSessions } from '../lib/workoutTemplateSessions';
import type { AppDatabase } from '../types/models';

/**
 * The sessions a plan's template holds, from whichever source it lives in.
 *
 * The same two sources Home's card resolves a plan against (the reader's own
 * template, else the catalog), so `livePlanEntries` drops exactly the entries
 * Home's rotation drops.
 */
export function templateSessionsReader(database: Pick<AppDatabase, 'workoutTemplates' | 'exerciseTemplates'>) {
  return (workoutTemplateId: string): Array<{ id: string }> => {
    const custom = database.workoutTemplates.find((item) => item.id === workoutTemplateId);
    if (custom) {
      return buildWorkoutTemplateSessions(custom, database.exerciseTemplates);
    }
    return getWorkoutTemplateById(workoutTemplateId)?.sessions ?? [];
  };
}
