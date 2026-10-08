import { useCallback, useMemo } from 'react';

import { adaptLegacyWorkoutTemplateToRuntimeTemplate } from '../features/workout/customWorkoutAdapter';
import type { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import type { WorkoutFeatureState } from '../features/workout/workoutState';
import { isWorkoutInProgress } from '../lib/activeWorkout';
import { getRecentExerciseLibraryItems } from '../lib/exerciseSuggestions';
import { selectHomeCustomProgram } from '../lib/homeProgramSelection';
import { buildProgramInsightMap } from '../lib/programInsights';
import { buildExercisePrLookup, buildExercisePrLookupBefore } from '../lib/workoutCompletionSummary';
import type {
  AppDatabase,
  AppPreferences,
  ExerciseTemplate,
  UnitPreference,
  WorkoutTemplateSessionWithExercises,
} from '../types/models';

/**
 * The reader's own programmes as the shell reads them — each adapted to the
 * runtime template the player runs, listed newest first, with the insight
 * cards for every programme, ready or custom, and the one Home offers — and
 * the exercise log's recent-lift list and PR lookup.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30).
 * A hook, not a helper: these are memos, and VinhaApp calls this exactly
 * where the lines stood — after handleSetupCompleteToTraining, before
 * proEntitlement — so every hook keeps its slot, and the handlers declared
 * above the call that read these values (the custom-programme starts and
 * adoption, and the finish flow's PR lookup) still read consts bound at the
 * same place in VinhaApp as before.
 *
 * recentCompletedCustomTemplateId and recentExerciseLibraryItems stay inside;
 * VinhaApp reads only what this returns.
 */
export interface CustomProgramViewsDeps {
  /** The app context's custom programmes. */
  workoutTemplates: AppDatabase['workoutTemplates'];
  /** The app context's session reader for one custom programme. */
  getWorkoutTemplateSessions: (workoutTemplateId: string) => WorkoutTemplateSessionWithExercises[];
  /** The app context's exercise reader for one custom programme. */
  getWorkoutExercises: (workoutTemplateId: string) => ExerciseTemplate[];
  /** The app context's exercise library. */
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  /** The reader's preferences: the default rest the adapter fills in. */
  preferences: AppPreferences;
  /** The whole database, for the programme insights, the recent lifts and the PR lookup. */
  database: AppDatabase;
  /** The reader's kg/lb setting, for the programme insights. */
  unitPreference: UnitPreference;
  /**
   * The workout context, passed whole so the deps entries keep reading
   * workout.activeSession, workout.templates and workout.history.*.
   */
  workout: Pick<WorkoutFeatureState, 'activeSession' | 'history'> & { templates: typeof WORKOUT_TEMPLATES_V1 };
}

export function useCustomProgramViews(deps: CustomProgramViewsDeps) {
  const {
    workoutTemplates,
    getWorkoutTemplateSessions,
    getWorkoutExercises,
    exerciseLibrary,
    preferences,
    database,
    unitPreference,
    workout,
  } = deps;

  const customWorkoutRuntimeMap = useMemo(
    () =>
      Object.fromEntries(
        workoutTemplates.map((template) => {
          const sessions = getWorkoutTemplateSessions(template.id);
          return [
            template.id,
            adaptLegacyWorkoutTemplateToRuntimeTemplate(
              template,
              sessions,
              exerciseLibrary,
              preferences.defaultRestSeconds,
            ),
          ] as const;
        }),
      ),
    [exerciseLibrary, getWorkoutTemplateSessions, preferences.defaultRestSeconds, workoutTemplates],
  );

  const customWorkouts = useMemo(
    () =>
      [...workoutTemplates]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .map((template) => ({
          id: template.id,
          name: template.name,
          sessionCount: getWorkoutTemplateSessions(template.id).length,
          exerciseCount: getWorkoutExercises(template.id).length,
          updatedAt: template.updatedAt,
          origin: template.origin,
        })),
    [getWorkoutExercises, getWorkoutTemplateSessions, workoutTemplates],
  );
  // The two fields the insight map reads of the running session. The session
  // object itself is replaced on every set logged, rest ended and swap, and
  // keying the map on it rebuilt all 71 programmes' insights each time with
  // the same answer.
  const liveTemplateId = workout.activeSession?.templateId ?? null;
  const liveTemplateName = workout.activeSession?.templateName ?? null;
  const programInsightsByTemplateId = useMemo(
    () =>
      buildProgramInsightMap({
        database,
        programs: [
          ...workout.templates.map((template) => ({
            id: template.id,
            name: template.name,
            sessions: template.sessions,
            weeklyTarget: template.daysPerWeek,
          })),
          ...Object.values(customWorkoutRuntimeMap).map((template) => ({
            id: template.id,
            name: template.name,
            sessions: template.sessions,
            weeklyTarget: template.sessions.length,
          })),
        ],
        unitPreference,
        activeSession:
          liveTemplateId !== null
            ? { templateId: liveTemplateId, templateName: liveTemplateName ?? '' }
            : null,
      }),
    [database, customWorkoutRuntimeMap, unitPreference, liveTemplateId, liveTemplateName, workout.templates],
  );
  const recentCompletedCustomTemplateId = useMemo(
    () =>
      workout.history.sessions.find((session) => customWorkouts.some((workoutItem) => workoutItem.id === session.templateId))
        ?.templateId ?? null,
    [customWorkouts, workout.history.sessions],
  );
  const selectedCustomProgram = useMemo(
    () =>
      selectHomeCustomProgram({
        customWorkouts,
        activeSessionTemplateId: workout.activeSession?.templateId ?? null,
        hasActiveSession: isWorkoutInProgress(workout.activeSession),
        lastSelectedTemplateId: workout.history.lastSelectedTemplateId,
        recentCompletedCustomTemplateId,
      }),
    [customWorkouts, recentCompletedCustomTemplateId, workout.activeSession, workout.history.lastSelectedTemplateId],
  );
  const recentExerciseLibraryItems = useMemo(
    () =>
      getRecentExerciseLibraryItems({
        exerciseLibrary,
        exerciseLogs: database.exerciseLogs,
        workoutSessions: database.workoutSessions,
        exerciseTemplates: database.exerciseTemplates,
      }),
    [database.exerciseLogs, database.exerciseTemplates, database.workoutSessions, exerciseLibrary],
  );
  const recentExerciseBrowserItems = recentExerciseLibraryItems;
  const exercisePrLookup = useMemo(
    () =>
      buildExercisePrLookup({
        exerciseLogs: database.exerciseLogs,
        workoutSessions: database.workoutSessions,
        exerciseTemplates: database.exerciseTemplates,
      }),
    [database.exerciseLogs, database.exerciseTemplates, database.workoutSessions],
  );
  // What a free workout board's Finish compares against: without its own earlier save when it is one
  // carried on after it (the guided finish does the same in finishSaves).
  const exercisePrLookupBefore = useCallback(
    (sessionId: string | null | undefined) =>
      buildExercisePrLookupBefore(
        {
          exerciseLogs: database.exerciseLogs,
          workoutSessions: database.workoutSessions,
          exerciseTemplates: database.exerciseTemplates,
        },
        sessionId,
        exercisePrLookup,
      ),
    [database.exerciseLogs, database.exerciseTemplates, database.workoutSessions, exercisePrLookup],
  );

  return {
    customWorkoutRuntimeMap,
    customWorkouts,
    programInsightsByTemplateId,
    selectedCustomProgram,
    recentExerciseBrowserItems,
    exercisePrLookup,
    exercisePrLookupBefore,
  };
}
