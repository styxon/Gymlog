import { useMemo } from 'react';
import { createExerciseProgressLookup, SameLiftMatcher } from '../lib/progression';
import { AppDatabase } from '../types/models';

/**
 * The exercise page's history, by exercise name.
 *
 * A hook because the answer must outlive the render that asked: the page is
 * drawn by renderWorkoutTab, a plain function the shell calls on every one of
 * its renders, and a technique tick or a preference change re-renders the
 * shell without touching a single log. Keyed on the three tables the summary
 * reads and on the matcher, like liftHistory beside it, so those renders get
 * the summary they had and the page's chart memos hold.
 */
export function useExerciseDetailHistory(database: AppDatabase, sameLibraryRow: SameLiftMatcher) {
  return useMemo(
    () => createExerciseProgressLookup(database, sameLibraryRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [database.exerciseLogs, database.exerciseTemplates, database.workoutSessions, sameLibraryRow],
  );
}
