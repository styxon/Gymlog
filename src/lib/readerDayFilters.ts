import { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { resolveCatalogSourceCategory } from './catalogExercisePools';
import { applyCautionFlagsToExercises, CautionAdjustedExercises } from './cautionExerciseFilter';
import { applyEquipmentToExercises, EquipmentAdjustedExercises } from './equipmentExerciseFilter';
import { isStretchExercise } from './exerciseClassification';
import { isMinutesExerciseName } from './minutesExercises';
import type { SetupCautionFlag, SetupFocusArea } from '../types/models';

/**
 * A day as the reader would run it: the gear pass, then the caution pass.
 *
 * The composer builds the week with this, and the recommender's focus-block
 * guard judges a block with it, so the two cannot disagree about a day again.
 * The guard ran the caution pass alone, and a chest block with no dumbbells
 * or cables and elbows and wrists avoided kept Bench Press and a lateral
 * raise on Chest (Heavy), featured as training the focus twice a week (bug
 * hunt round 2, 2026-10-08).
 *
 * Order matters: equipment first, caution last so bans always win — an
 * equipment fallback can never resurrect a flagged movement.
 */
export function applyReaderFiltersToDay(
  exercises: WorkoutTemplateExercise[],
  availableEquipment: string[] | null,
  cautionFlags: SetupCautionFlag[],
  focusAreas: SetupFocusArea[] = [],
): { equipped: EquipmentAdjustedExercises; adjusted: CautionAdjustedExercises } {
  const equipped = applyEquipmentToExercises(exercises, availableEquipment);
  const adjusted = applyCautionFlagsToExercises(equipped.exercises, cautionFlags, focusAreas, availableEquipment);
  return { equipped, adjusted };
}

/**
 * The fewest lifts a training day is handed over with. A day the filters
 * leave below it is filled back or folded into its neighbour (owner,
 * 2026-10-08): "Lower Body HIIT" was Glute Bridge March alone with knees
 * avoided, under the programme's thirty minutes.
 */
export const MIN_DAY_LIFTS = 3;

/**
 * A lift, as the reader counts a day's: not a bout of minutes and not a
 * stretch. A plank is core work; Cat Stretch and Ankle Circles are not.
 */
export function isDayLift(exercise: Pick<WorkoutTemplateExercise, 'exerciseName' | 'trackingMode'>): boolean {
  if (exercise.trackingMode === 'duration_minutes' || isMinutesExerciseName(exercise.exerciseName)) {
    return false;
  }
  const sourceCategory = resolveCatalogSourceCategory(exercise.exerciseName) ?? undefined;
  if (isStretchExercise({ name: exercise.exerciseName, sourceCategory })) {
    return false;
  }
  // A held position the library does not file as strength is a stretch by
  // another name: Deep Squat Hold, Pigeon Pose.
  return exercise.trackingMode !== 'hold' || sourceCategory === 'strength';
}

export function countDayLifts(exercises: ReadonlyArray<Pick<WorkoutTemplateExercise, 'exerciseName' | 'trackingMode'>>): number {
  return exercises.filter(isDayLift).length;
}
