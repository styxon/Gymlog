/**
 * A programme copied before steady cardio was logged in minutes gets the mode
 * the ready programme now runs on.
 *
 * A custom programme's stored `trackingMode` outranks the name check in
 * customWorkoutAdapter.getTrackingMode ("the writer's own answer"). Copies of
 * the ready programmes made before 'duration_minutes' existed stored what the
 * catalogue then said: 'bodyweight' for Stairmaster (Moderate) and Stationary
 * Bike (Easy Pace), 'reps_first' for Easy Run Blocks and Tempo Run Blocks. So
 * the ready programme asked for "20 minutes" while the copy of it kept asking
 * for "1 × 20 reps".
 *
 * The rule: a stored row whose name is a minutes exercise
 * (lib/minutesExercises) and whose stored mode is 'bodyweight' or 'reps_first'
 * is set to 'duration_minutes'. A stored null is left alone: it already
 * derives minutes from the name, and null is what a lift swapped in writes so
 * that the library describes it. Nothing else is touched either: a hold, a
 * load mode or an existing 'duration_minutes' stays as it is.
 *
 * Nothing the reader can do sets 'bodyweight' or 'reps_first' on one of these
 * names — no screen has a mode picker; the mode is whatever the writer (a
 * catalogue copy, onboarding's composed week, the CSV importer) stored — so
 * the stored value was a writer's old answer, not a choice. The numbers keep:
 * 1 × 20 and 5 × 4 read the same as minutes, as the ready rows prescribe them.
 * Logs written before are read by name as minutes (lib/exerciseLog
 * isMinutesLogEntry), so history and personal records stay in step.
 *
 * Once per database (`appliedMigrations`, storage/database.ts), like the
 * category rule: a later writer that stores another mode for one of these names
 * on purpose is not undone on the next load.
 */
import { isMinutesExerciseName } from './minutesExercises';
import type { ExerciseTemplate } from '../types/models';

/** The marker a database carries once the rule above has run over it. */
export const MINUTES_MODE_MIGRATION_ID = 'minutes-mode-for-old-copies-2026-10-06';

type ModeRow = Pick<ExerciseTemplate, 'name' | 'trackingMode'>;

export function moveOldCopiesToMinutesMode<T extends ModeRow>(exercises: readonly T[]): T[] {
  return exercises.map((exercise) => {
    if (!isMinutesExerciseName(exercise.name)) {
      return exercise;
    }
    const mode = exercise.trackingMode;
    if (mode !== 'bodyweight' && mode !== 'reps_first') {
      return exercise;
    }
    return { ...exercise, trackingMode: 'duration_minutes' as const };
  });
}
