import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { resolveCatalogSourceCategory } from './catalogExercisePools';
import { readyTemplateCardMinutes } from './programmeMinutes';
import { isUnloadedTrackingMode } from '../features/workout/workoutTypes';
import type { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import type { RecommendationGoalType, RecommendationSetupContext } from './recommendationProfile';

export interface WorkoutContentFitInput {
  goalType: RecommendationGoalType;
  setupContext: RecommendationSetupContext;
  /**
   * The reader's gear, so the session length is the one their card prints
   * (readyTemplateCardMinutes). Without it a bands-only reader's card said
   * about 20 minutes while this judged the ungeared 35 (review, 2026-10-07).
   */
  availableEquipment?: string[] | null;
}

export interface WorkoutContentFitSignals {
  exerciseCount: number;
  accessoryExerciseCount: number;
  bodyweightExerciseCount: number;
  weeklySetCount: number;
  primarySetCount: number;
  runExerciseCount: number;
  loadedExerciseCount: number;
  technicalLiftCount: number;
  maxExercisesPerSession: number;
  averageSessionMinutes: number;
  hasLowRepLoadedAnchors: boolean;
  hasHypertrophyVolume: boolean;
  hasRunWork: boolean;
  hasMobilityWork: boolean;
  hasResistanceWork: boolean;
  hasFullGymOnlyExercises: boolean;
}

export interface WorkoutContentFitResult {
  programId: string;
  issues: string[];
  signals: WorkoutContentFitSignals;
}

const FULL_GYM_ONLY_EXERCISE_NAMES = new Set([
  'Back Squat',
  'Bench Press',
  'Barbell Row',
  'Cable Crunch',
  'Chest-Supported Row',
  'Front Squat',
  'Hack Squat',
  'Lat Pulldown',
  'Leg Curl',
  'Leg Press',
  'Machine Chest Press',
  'Machine Shoulder Press',
  'Seated Cable Row',
  'Trap Bar Deadlift',
  'Triceps Pushdown',
]);

function flattenExercises(sessions: Array<{ exercises: WorkoutTemplateExercise[] }>) {
  return sessions.flatMap((session) => session.exercises);
}

function isBodyweightExercise(exercise: WorkoutTemplateExercise) {
  return (
    isUnloadedTrackingMode(exercise.trackingMode) ||
    exercise.exerciseName.includes('Push-Up') ||
    exercise.exerciseName.includes('Bodyweight') ||
    exercise.exerciseName === 'Inverted Row' ||
    exercise.exerciseName === 'Glute Bridge' ||
    exercise.exerciseName === 'Mountain Climbers' ||
    exercise.exerciseName === 'Plank'
  );
}

function isRunExercise(exercise: WorkoutTemplateExercise) {
  return /\b(run|running|stride|tempo)\b/i.test(exercise.exerciseName);
}

function isMobilityExercise(exercise: WorkoutTemplateExercise) {
  // The library's own category decides when it knows the exercise. The name
  // regex below was the only rule, and it read "Sun Salutation Flow" as
  // mobility while reading "Child's Pose" as resistance work — so replacing a
  // block name with a real exercise made a yoga program look like strength
  // training. The regex stays for names the library has never seen.
  const category = resolveCatalogSourceCategory(exercise.exerciseName);
  if (category !== null) {
    return category === 'stretching';
  }

  return /\b(mobility|stretch|yoga|breath|flow|reset)\b/i.test(exercise.exerciseName);
}

function isResistanceExercise(exercise: WorkoutTemplateExercise) {
  if (isRunExercise(exercise) || isMobilityExercise(exercise)) {
    return false;
  }

  return (
    exercise.trackingMode === 'load_and_reps' ||
    isBodyweightExercise(exercise) ||
    /\b(squat|press|row|deadlift|lunge|curl|raise|thrust|bridge|pull-up|push-up)\b/i.test(exercise.exerciseName)
  );
}

function isTechnicalLift(exercise: WorkoutTemplateExercise) {
  return (
    exercise.role === 'primary' &&
    exercise.repsMax <= 6 &&
    /\b(front squat|trap bar deadlift)\b/i.test(exercise.exerciseName)
  );
}

function buildSignals(
  exercises: WorkoutTemplateExercise[],
  sessionExerciseCounts: number[],
  averageSessionMinutes: number,
  input: WorkoutContentFitInput,
): WorkoutContentFitSignals {
  const primaryExercises = exercises.filter((exercise) => exercise.role === 'primary');
  const accessoryExercises = exercises.filter((exercise) => exercise.role === 'accessory');
  const bodyweightExerciseCount = exercises.filter(isBodyweightExercise).length;
  const bodyweightStrengthExerciseCount = exercises.filter(
    (exercise) => isBodyweightExercise(exercise) && isResistanceExercise(exercise),
  ).length;
  const runExerciseCount = exercises.filter(isRunExercise).length;
  const hasRepVolume = exercises.some((exercise) => exercise.repsMax >= 12);
  const isLowEquipmentStrengthSetup = input.setupContext === 'bodyweight' || input.setupContext === 'home_limited';

  return {
    exerciseCount: exercises.length,
    accessoryExerciseCount: accessoryExercises.length,
    bodyweightExerciseCount,
    weeklySetCount: exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
    primarySetCount: primaryExercises.reduce((sum, exercise) => sum + exercise.sets, 0),
    runExerciseCount,
    loadedExerciseCount: exercises.filter((exercise) => exercise.trackingMode === 'load_and_reps').length,
    technicalLiftCount: exercises.filter(isTechnicalLift).length,
    maxExercisesPerSession: Math.max(...sessionExerciseCounts),
    averageSessionMinutes,
    hasLowRepLoadedAnchors: primaryExercises.some(
      (exercise) => exercise.trackingMode === 'load_and_reps' && exercise.repsMax <= 6,
    ),
    hasHypertrophyVolume:
      (hasRepVolume && accessoryExercises.length >= 4) ||
      (isLowEquipmentStrengthSetup && hasRepVolume && bodyweightStrengthExerciseCount >= 6),
    hasRunWork: runExerciseCount > 0,
    hasMobilityWork: exercises.some(isMobilityExercise),
    hasResistanceWork: exercises.some(isResistanceExercise),
    hasFullGymOnlyExercises: exercises.some((exercise) => FULL_GYM_ONLY_EXERCISE_NAMES.has(exercise.exerciseName)),
  };
}

function buildIssues(input: WorkoutContentFitInput, signals: WorkoutContentFitSignals) {
  const issues: string[] = [];

  if ((input.setupContext === 'home_limited' || input.setupContext === 'bodyweight' || input.setupContext === 'outdoor_running') && signals.hasFullGymOnlyExercises) {
    issues.push('Contains full-gym-only exercises for a low-equipment setup.');
  }

  if (input.setupContext === 'bodyweight' && signals.bodyweightExerciseCount < Math.max(4, signals.exerciseCount - 1)) {
    issues.push('Bodyweight setup does not contain enough bodyweight-friendly work.');
  }

  if (input.goalType === 'strength' && !signals.hasLowRepLoadedAnchors) {
    issues.push('Strength plan is missing low-rep loaded anchor lifts.');
  }

  if (input.goalType === 'strength' && signals.primarySetCount < 6) {
    issues.push('Strength plan does not include enough primary strength work.');
  }

  if (input.goalType === 'hypertrophy' && !signals.hasHypertrophyVolume) {
    issues.push('Hypertrophy plan is missing enough volume or accessory work.');
  }

  const minimumHypertrophySetCount = input.setupContext === 'bodyweight' || input.setupContext === 'home_limited' ? 20 : 24;
  if (input.goalType === 'hypertrophy' && signals.weeklySetCount < minimumHypertrophySetCount) {
    issues.push('Hypertrophy plan does not include enough weekly set volume.');
  }

  if (input.goalType === 'fat_loss' && (signals.maxExercisesPerSession > 6 || signals.averageSessionMinutes > 55)) {
    issues.push('Fat-loss plan is too dense for a low-friction starting point.');
  }

  if (input.goalType === 'fat_loss' && !signals.hasResistanceWork) {
    issues.push('Fat-loss plan needs resistance work to support muscle retention.');
  }

  if (input.goalType === 'endurance' && (signals.runExerciseCount < 2 || !signals.hasMobilityWork)) {
    issues.push('Endurance plan needs both run/cardio work and mobility support.');
  }

  return issues;
}

export function evaluateWorkoutContentFit(programId: string, input: WorkoutContentFitInput): WorkoutContentFitResult {
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    return {
      programId,
      issues: ['Program template was not found.'],
      signals: {
        exerciseCount: 0,
        accessoryExerciseCount: 0,
        bodyweightExerciseCount: 0,
        weeklySetCount: 0,
        primarySetCount: 0,
        runExerciseCount: 0,
        loadedExerciseCount: 0,
        technicalLiftCount: 0,
        maxExercisesPerSession: 0,
        averageSessionMinutes: 0,
        hasLowRepLoadedAnchors: false,
        hasHypertrophyVolume: false,
        hasRunWork: false,
        hasMobilityWork: false,
        hasResistanceWork: false,
        hasFullGymOnlyExercises: false,
      },
    };
  }

  const exercises = flattenExercises(template.sessions);
  const signals = buildSignals(
    exercises,
    template.sessions.map((session) => session.exercises.length),
    readyTemplateCardMinutes(template, { availableEquipment: input.availableEquipment ?? null }),
    input,
  );

  return {
    programId,
    issues: buildIssues(input, signals),
    signals,
  };
}
