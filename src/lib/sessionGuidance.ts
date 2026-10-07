import { isTimedTrackingMode, isUnloadedTrackingMode } from '../features/workout/workoutTypes';
import type { WorkoutTemplateExercise, WorkoutTemplateSession, WorkoutTemplateV1 } from '../features/workout/workoutTypes';

export interface SessionGuidance {
  warmup: string;
  mainFocus: string;
  supportFocus: string;
  restGuidance: string;
  estimatedDuration: string;
  progressionHint: string;
  firstAction: string;
}

function joinExerciseNames(exercises: WorkoutTemplateExercise[], maxCount = 3) {
  const names = exercises.slice(0, maxCount).map((exercise) => exercise.exerciseName);
  if (names.length <= 1) {
    return names[0] ?? 'the first movement';
  }

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function isRunExercise(exercise: WorkoutTemplateExercise) {
  return /\b(run|running|stride|tempo)\b/i.test(exercise.exerciseName);
}

function isMobilityExercise(exercise: WorkoutTemplateExercise) {
  return /\b(mobility|stretch|yoga|breath|flow|reset)\b/i.test(exercise.exerciseName);
}

function hasLoadedPrimary(exercises: WorkoutTemplateExercise[]) {
  return exercises.some((exercise) => exercise.role === 'primary' && exercise.trackingMode === 'load_and_reps');
}

function isBodyweightStrengthSession(exercises: WorkoutTemplateExercise[]) {
  // A plank is now 'hold' rather than 'bodyweight', and a bodyweight session
  // with a plank in it is still a bodyweight session.
  return exercises.every((exercise) => isUnloadedTrackingMode(exercise.trackingMode)) && exercises.some((exercise) => !isMobilityExercise(exercise));
}

function buildWarmup(exercises: WorkoutTemplateExercise[]) {
  const firstPrimary = exercises.find((exercise) => exercise.role === 'primary') ?? exercises[0];
  if (!firstPrimary) {
    return 'Start easy and use the first few minutes to check movement quality.';
  }

  if (isRunExercise(firstPrimary)) {
    return 'Start with 5-8 minutes of easy movement before the first run block.';
  }

  if (isMobilityExercise(firstPrimary) && !hasLoadedPrimary(exercises)) {
    return 'Start with easy breathing and keep the first round smooth.';
  }

  if (isBodyweightStrengthSession(exercises)) {
    return `Do one easy round of ${joinExerciseNames(exercises, 2)} before the work sets.`;
  }

  return `Ramp into ${firstPrimary.exerciseName} with 2-4 lighter warm-up sets before the work sets.`;
}

function buildSupportFocus(exercises: WorkoutTemplateExercise[]) {
  const support = exercises.filter((exercise) => exercise.role !== 'primary');
  if (support.length === 0) {
    return 'No extra support work; keep the main work clean.';
  }

  return `Support work: ${joinExerciseNames(support)}.`;
}

function buildRestGuidance(exercises: WorkoutTemplateExercise[]) {
  const primary = exercises.filter((exercise) => exercise.role === 'primary');
  const mainWork = primary.length ? primary : exercises;
  const support = exercises.filter((exercise) => exercise.role !== 'primary');
  const primaryMin = Math.min(...mainWork.map((exercise) => exercise.restSecondsMin));
  const primaryMax = Math.max(...mainWork.map((exercise) => exercise.restSecondsMax));

  if (support.length === 0) {
    return `Rest ${primaryMin}-${primaryMax} sec between work sets.`;
  }

  const supportMin = Math.min(...support.map((exercise) => exercise.restSecondsMin));
  const supportMax = Math.max(...support.map((exercise) => exercise.restSecondsMax));
  return `Rest ${primaryMin}-${primaryMax} sec on main work and ${supportMin}-${supportMax} sec on support work.`;
}

function buildProgressionHint(template: WorkoutTemplateV1, exercises: WorkoutTemplateExercise[]) {
  if (exercises.some(isRunExercise)) {
    return template.progressionRules.primary;
  }

  if (isBodyweightStrengthSession(exercises)) {
    return 'Add reps or cleaner range before harder variations; keep the same movement until all sets reach the top of the range.';
  }

  return template.progressionRules.primary;
}

function buildFirstAction(exercises: WorkoutTemplateExercise[]) {
  const firstPrimary = exercises.find((exercise) => exercise.role === 'primary') ?? exercises[0];
  if (!firstPrimary) {
    return 'Start the session and log the first planned block.';
  }

  if (isRunExercise(firstPrimary)) {
    return `Start ${firstPrimary.exerciseName} at an easy pace and log the planned blocks.`;
  }

  if (isMobilityExercise(firstPrimary)) {
    return `Start with ${firstPrimary.exerciseName} and keep the first round easy.`;
  }

  if (firstPrimary.trackingMode === 'duration_minutes') {
    return `Start ${firstPrimary.exerciseName} at a steady pace and log the minutes you did.`;
  }

  if (isTimedTrackingMode(firstPrimary.trackingMode)) {
    return `Start with ${firstPrimary.exerciseName} and hold the position rather than chasing the clock.`;
  }

  if (firstPrimary.trackingMode === 'bodyweight') {
    return `Start with ${firstPrimary.exerciseName} and log clean reps before increasing difficulty.`;
  }

  return `Open ${firstPrimary.exerciseName}, do warm-up sets, then log the first work set.`;
}

/**
 * `sessionMinutes` is the number the programme page's badge quotes
 * (`readyProgramSessionMinutes`) — passed in, not read from the template's
 * hand-written `estimatedSessionDuration`, which said 50 where the badge said
 * 35 (bug hunt, 2026-10-05, B14).
 */
export function buildSessionGuidance(
  template: WorkoutTemplateV1,
  session: WorkoutTemplateSession,
  sessionMinutes: number,
): SessionGuidance {
  const primary = session.exercises.filter((exercise) => exercise.role === 'primary');

  return {
    warmup: buildWarmup(session.exercises),
    mainFocus: `Main focus: ${joinExerciseNames(primary.length ? primary : session.exercises)}.`,
    supportFocus: buildSupportFocus(session.exercises),
    restGuidance: buildRestGuidance(session.exercises),
    estimatedDuration: `${sessionMinutes} min`,
    progressionHint: buildProgressionHint(template, session.exercises),
    firstAction: buildFirstAction(session.exercises),
  };
}
