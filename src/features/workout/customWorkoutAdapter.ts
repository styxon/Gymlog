import { ExerciseLibraryItem, ExerciseTemplate, WorkoutTemplate, WorkoutTemplateSessionWithExercises } from '../../types/models';
import {
  WorkoutProgressionPriority,
  WorkoutRole,
  WorkoutRuntimeTemplate,
  WorkoutTemplateExercise,
  WorkoutTrackingMode,
} from './workoutTypes';

import { WORKOUT_SUBSTITUTION_GROUPS } from './workoutCatalog';
import { isHoldExerciseName } from '../../lib/holdExercises';
import { isMinutesExerciseName } from '../../lib/minutesExercises';

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

/**
 * The catalog swap group this exercise belongs to, by name.
 *
 * Every custom template used to get `custom_<exerciseId>` — a group of one,
 * belonging to no catalog — so nothing in a custom plan could ever be
 * substituted. That includes the plan onboarding builds and saves for the
 * user, which is most plans. The list logger opened an empty swap sheet and
 * the guided player showed no swap row at all.
 *
 * The synthetic id remains the fallback: an exercise the catalog does not
 * group has no honest alternatives to offer.
 */
function resolveSubstitutionGroup(exerciseName: string, fallbackId: string): string {
  const normalized = normalizeName(exerciseName);
  const group = WORKOUT_SUBSTITUTION_GROUPS.find((candidate) =>
    candidate.allowedExerciseNames.some((allowed) => normalizeName(allowed) === normalized),
  );
  return group?.id ?? `custom_${fallbackId}`;
}

function getTrackingMode(exercise: ExerciseTemplate, libraryItem?: ExerciseLibraryItem): WorkoutTrackingMode {
  // The writer's own answer, when it had one (onboarding's composed week).
  if (exercise.trackingMode) {
    return exercise.trackingMode;
  }

  // Asked before the equipment check: a hold is bodyweight, so the branch
  // below would swallow it and a plank in your own program would ask for
  // repetitions while the same plank in a ready program asked for seconds.
  if (isHoldExerciseName(libraryItem?.name ?? exercise.name)) {
    return 'hold';
  }

  // Before the category check below, which files a bike as cardio and so as
  // repetitions. Either spelling: the programme's own or the library row's.
  if (isMinutesExerciseName(exercise.name) || isMinutesExerciseName(libraryItem?.name)) {
    return 'duration_minutes';
  }

  if (libraryItem?.equipment === 'bodyweight') {
    return 'bodyweight';
  }

  if (libraryItem?.category === 'core' || libraryItem?.category === 'cardio') {
    return 'reps_first';
  }

  return 'load_and_reps';
}

function getRole(exercise: ExerciseTemplate, libraryItem?: ExerciseLibraryItem): WorkoutRole {
  if (libraryItem?.category === 'compound') {
    return 'secondary';
  }

  return exercise.trackedDefault ? 'secondary' : 'accessory';
}

function getPriority(exercise: ExerciseTemplate, libraryItem?: ExerciseLibraryItem): WorkoutProgressionPriority {
  if (libraryItem?.category === 'compound') {
    return 'medium';
  }

  return exercise.trackedDefault ? 'medium' : 'low';
}

/**
 * The library, indexed once.
 *
 * This used to be built inside adaptExercise — a Map over all 873 items, plus
 * a linear name scan that normalized every one of them, for each exercise of
 * each day of each programme, every time the database changed. The reader felt
 * it as a day screen that "lagged" and buttons that did not answer (#bugs
 * 2026-08-27). The work is the same shape; it just happens once.
 */
interface ExerciseLibraryIndex {
  byId: Map<string, ExerciseLibraryItem>;
  byName: Map<string, ExerciseLibraryItem>;
}

function indexExerciseLibrary(exerciseLibrary: ExerciseLibraryItem[]): ExerciseLibraryIndex {
  const byId = new Map<string, ExerciseLibraryItem>();
  const byName = new Map<string, ExerciseLibraryItem>();
  for (const item of exerciseLibrary) {
    byId.set(item.id, item);
    // First wins, matching the .find() this replaced.
    const key = normalizeName(item.name);
    if (!byName.has(key)) {
      byName.set(key, item);
    }
  }
  return { byId, byName };
}

function adaptExercise(
  exercise: ExerciseTemplate,
  library: ExerciseLibraryIndex,
  defaultRestSeconds: number,
): WorkoutTemplateExercise {
  const libraryItem =
    (exercise.libraryItemId ? library.byId.get(exercise.libraryItemId) : undefined) ??
    library.byName.get(normalizeName(exercise.name));

  return {
    id: exercise.id,
    persistedExerciseTemplateId: exercise.id,
    exerciseName: exercise.name,
    slotId: `custom_slot_${exercise.id}`,
    role: getRole(exercise, libraryItem),
    progressionPriority: getPriority(exercise, libraryItem),
    trackingMode: getTrackingMode(exercise, libraryItem),
    sets: Math.max(1, exercise.targetSets),
    repsMin: Math.max(1, exercise.repMin),
    repsMax: Math.max(Math.max(1, exercise.repMin), exercise.repMax),
    // 0 is a rest of none (stretches), not "unset"; only null falls to the default.
    restSecondsMin: typeof exercise.restSeconds === 'number' && exercise.restSeconds >= 0 ? exercise.restSeconds : defaultRestSeconds,
    restSecondsMax: typeof exercise.restSeconds === 'number' && exercise.restSeconds >= 0 ? exercise.restSeconds : defaultRestSeconds,
    substitutionGroup: resolveSubstitutionGroup(exercise.name, exercise.id),
    supersetGroup: exercise.supersetGroup ?? null,
  };
}

export function adaptLegacyWorkoutTemplateToRuntimeTemplate(
  template: WorkoutTemplate,
  sessions: WorkoutTemplateSessionWithExercises[],
  exerciseLibrary: ExerciseLibraryItem[],
  defaultRestSeconds: number,
): WorkoutRuntimeTemplate {
  const library = indexExerciseLibrary(exerciseLibrary);
  return {
    id: template.id,
    name: template.name,
    defaultScheduleMode: 'rolling_sequence',
    sessions: sessions
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((session) => ({
        id: session.id,
        name: session.name,
        orderIndex: session.orderIndex,
        exercises: session.exercises
          .slice()
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map((exercise) => adaptExercise(exercise, library, defaultRestSeconds)),
      })),
  };
}