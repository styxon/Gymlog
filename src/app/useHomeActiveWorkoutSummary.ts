import { useMemo } from 'react';

import { isWorkoutInProgress } from '../lib/activeWorkout';
import { markingWorkoutFailures } from '../features/errorReporting/workoutFailure';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { formatTime, pluralize } from '../lib/format';
import type { AppLanguage } from '../types/models';
import { useStableActiveWorkoutSummary } from './useStableActiveWorkoutSummary';

/**
 * The running workout's Home/coach summary, moved out of App.tsx verbatim
 * (app-split step 4c). VinhaApp calls it at the slot the memo stood in, so it
 * is still read on every route.
 */
export function useHomeActiveWorkoutSummary(
  activeSession: ReturnType<typeof useWorkoutContext>['activeSession'],
  appLanguage: AppLanguage,
) {
  // Read on every route, from the first render after the stored workout is loaded: a session the app cannot
  // read fails here before any workout screen is drawn, and is marked as the workout's (errorReporting/workoutFailure).
  const homeActiveWorkoutParts = useMemo(() => markingWorkoutFailures(() => {
    if (!activeSession || !isWorkoutInProgress(activeSession)) {
      return null;
    }

    const activeExercise =
      activeSession.exercises.find((exercise) => exercise.slotId === activeSession.ui.activeSlotId) ??
      activeSession.exercises.find(
        (exercise) => exercise.status !== 'completed' && exercise.status !== 'skipped',
      ) ??
      null;
    const remainingSets = activeSession.exercises.reduce(
      (sum, exercise) => sum + exercise.sets.filter((set) => set.status === 'pending').length,
      0,
    );

    return {
      title: activeSession.templateName,
      nextExercise: activeExercise?.exerciseName ?? null,
      meta: `${pluralize(remainingSets, 'set')} left | Started ${formatTime(activeSession.startedAt, appLanguage)}`,
    };
  }), [activeSession, appLanguage]);
  // The same three fields as a value that holds still: see useStableActiveWorkoutSummary.
  return useStableActiveWorkoutSummary(homeActiveWorkoutParts);
}
