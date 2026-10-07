/**
 * Pure helpers for the Workout Complete screen (design_handoff_workout_complete):
 * top-set labels, per-muscle-group aggregation, and the volume delta vs the
 * previous session of the same workout.
 */

import { isMinutesTrackingMode, isTimedTrackingMode, WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { AppLanguage } from '../types/models';
import { t } from './i18n';
import { formatWeight, removeTrailingZeros } from './format';

export interface CompletedSetLike {
  status: 'completed' | 'skipped' | string;
  weightKg?: number | null;
  reps?: number | null;
}

export interface CompletedExerciseLike {
  exerciseName: string;
  sets: CompletedSetLike[];
}

export interface MuscleFocusRow {
  name: string;
  sets: number;
  volumeKg: number;
  /**
   * Share of the session's completed sets, 0–100. Sets rather than volume:
   * a bodyweight session has no volume at all, and "0 kg" bars told the user
   * nothing about where the work went.
   */
  sharePercent: number;
}

const BODY_PART_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  legs: 'Legs',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
  glutes: 'Glutes',
  'full body': 'Full body',
};

/**
 * Heaviest completed set as "60 × 8"; bodyweight-only sets as "12 reps", and a
 * hold as "45 s" — a 45-second plank read as "45 toistoa" on the finish screen.
 */
export function getTopSetLabel(
  sets: CompletedSetLike[],
  language: AppLanguage = 'en',
  trackingMode: WorkoutTrackingMode = 'load_and_reps',
): string | null {
  const completed = sets.filter(
    (set) => set.status === 'completed' && typeof set.reps === 'number' && set.reps > 0,
  );
  if (!completed.length) {
    return null;
  }

  const top = [...completed].sort((left, right) => {
    const leftWeight = left.weightKg ?? 0;
    const rightWeight = right.weightKg ?? 0;
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }
    return (right.reps ?? 0) - (left.reps ?? 0);
  })[0];

  if (isTimedTrackingMode(trackingMode)) {
    return t(language, 'logger.secondsValue', { count: top.reps ?? 0 });
  }
  // A bike's twenty minutes, not "20 toistoa".
  if (isMinutesTrackingMode(trackingMode)) {
    return t(language, 'logger.minutesValue', { count: top.reps ?? 0 });
  }

  const weight = top.weightKg ?? 0;
  if (weight > 0) {
    // formatWeight, not the bare number: "38,75 × 9" under a label reading
    // "raskain sarja" states a load without saying of what (#bugs 2026-08-26,
    // "38,75 mitä, mittayksiköt puuttuu"). Every other surface that prints a
    // load goes through here.
    return `${formatWeight(weight)} × ${top.reps}`;
  }
  return t(language, 'logger.repsValue', { count: top.reps ?? 0 });
}

/**
 * Infers a muscle group from the exercise name when the library has no exact
 * match. Mirrors the tone of the equipment inference: obvious patterns only,
 * anything ambiguous falls back to "Other".
 */
export function inferBodyPartFromExerciseName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (/squat|leg press|leg extension|lunge|calf|quad/.test(normalized)) {
    return 'legs';
  }
  if (/deadlift|hip thrust|glute|hamstring|leg curl/.test(normalized)) {
    return 'glutes';
  }
  // Rows/pulls before chest so "Chest-Supported Row" lands on back.
  if (/row|pulldown|pull-?up|chin-?up|lat |face pull/.test(normalized)) {
    return 'back';
  }
  if (/bench|chest|fly|dip|push-?up|incline/.test(normalized)) {
    return 'chest';
  }
  if (/overhead press|shoulder|lateral raise|arnold|delt/.test(normalized)) {
    return 'shoulders';
  }
  if (/curl/.test(normalized)) {
    return 'biceps';
  }
  if (/triceps|pushdown|skull|extension/.test(normalized)) {
    return 'triceps';
  }
  if (/plank|crunch|sit-?up|ab |core|leg raise/.test(normalized)) {
    return 'core';
  }
  return 'other';
}

/**
 * Aggregates completed sets/volume per muscle group. Library exact-name match
 * wins; otherwise the name is pattern-inferred. Sorted by set count descending,
 * capped to the top four groups. The share is taken over every group, so a
 * session with a long tail doesn't inflate the four that made the cut.
 */
export function buildMuscleFocus(
  exercises: CompletedExerciseLike[],
  library: Array<{ name: string; bodyPart: string }>,
): MuscleFocusRow[] {
  const bodyPartByName = new Map(library.map((item) => [item.name.trim().toLowerCase(), item.bodyPart]));
  const groups = new Map<string, { sets: number; volumeKg: number }>();

  for (const exercise of exercises) {
    const completed = exercise.sets.filter((set) => set.status === 'completed');
    if (!completed.length) {
      continue;
    }

    const bodyPart =
      bodyPartByName.get(exercise.exerciseName.trim().toLowerCase()) ??
      inferBodyPartFromExerciseName(exercise.exerciseName);
    const label = BODY_PART_LABELS[bodyPart] ?? 'Other';
    const entry = groups.get(label) ?? { sets: 0, volumeKg: 0 };
    entry.sets += completed.length;
    entry.volumeKg += completed.reduce(
      (total, set) => total + (set.weightKg ?? 0) * (set.reps ?? 0),
      0,
    );
    groups.set(label, entry);
  }

  const totalSets = [...groups.values()].reduce((sum, value) => sum + value.sets, 0);

  return [...groups.entries()]
    .map(([name, value]) => ({
      name,
      sets: value.sets,
      volumeKg: Math.round(value.volumeKg),
      sharePercent: totalSets === 0 ? 0 : Math.round((value.sets / totalSets) * 100),
    }))
    .sort((left, right) => right.sets - left.sets || right.volumeKg - left.volumeKg)
    .slice(0, 4);
}

/**
 * Signed volume delta vs the most recent earlier session of the same workout
 * (matched by name), or null when there is no prior session to compare to.
 */
export function getVolumeDeltaVsPrevious(
  current: { sessionId: string; workoutName: string; performedAt: string; totalVolumeKg: number },
  allSessions: Array<{ id: string; name?: string | null; performedAt: string; totalVolume?: number | null }>,
): number | null {
  const currentTime = new Date(current.performedAt).getTime();
  const previous = allSessions
    .filter(
      (session) =>
        session.id !== current.sessionId &&
        (session.name ?? '').trim().toLowerCase() === current.workoutName.trim().toLowerCase() &&
        new Date(session.performedAt).getTime() < currentTime &&
        typeof session.totalVolume === 'number',
    )
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())[0];

  if (!previous || typeof previous.totalVolume !== 'number') {
    return null;
  }
  return Math.round(current.totalVolumeKg - previous.totalVolume);
}
