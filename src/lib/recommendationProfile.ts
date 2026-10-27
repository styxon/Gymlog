import type { FirstRunSetupSelection } from './firstRunSetup';

export type RecommendationSetupContext = 'full_gym' | 'home_limited' | 'bodyweight' | 'outdoor_running';
export type RecommendationGoalType = 'strength' | 'hypertrophy' | 'fat_loss' | 'recomposition' | 'endurance';
type RecommendationWeightDirection = 'gain' | 'loss' | 'maintain' | null;

export interface RecommendationProfile {
  setupContext: RecommendationSetupContext;
  goalType: RecommendationGoalType;
  weightDirection: RecommendationWeightDirection;
  hasWeightTarget: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveWeightDirection(selection: Pick<FirstRunSetupSelection, 'currentWeightKg' | 'targetWeightKg'>): RecommendationWeightDirection {
  if (!isFiniteNumber(selection.currentWeightKg) || !isFiniteNumber(selection.targetWeightKg)) {
    return null;
  }

  const difference = selection.targetWeightKg - selection.currentWeightKg;
  if (difference > 0.5) {
    return 'gain';
  }

  if (difference < -0.5) {
    return 'loss';
  }

  return 'maintain';
}

function resolveGoalType(selection: Pick<FirstRunSetupSelection, 'goal' | 'currentWeightKg' | 'targetWeightKg'>): RecommendationGoalType {
  const weightDirection = resolveWeightDirection(selection);

  if (selection.goal === 'strength') {
    return 'strength';
  }

  if (selection.goal === 'muscle') {
    return weightDirection === 'loss' ? 'recomposition' : 'hypertrophy';
  }

  if (selection.goal === 'run_mobility') {
    return 'endurance';
  }

  if (selection.goal === 'lean_athletic') {
    return weightDirection === 'loss' ? 'fat_loss' : 'recomposition';
  }

  return weightDirection === 'loss' ? 'fat_loss' : 'recomposition';
}

function resolveSetupContext(
  selection: Pick<FirstRunSetupSelection, 'equipment' | 'trainingEnvironment' | 'goal' | 'secondaryOutcomes' | 'focusAreas'>,
): RecommendationSetupContext {
  switch (selection.trainingEnvironment) {
    case 'full_gym':
      return 'full_gym';
    case 'home_gym':
    case 'minimal_equipment':
      return 'home_limited';
    case 'bodyweight_only':
      return 'bodyweight';
    case 'running_hybrid':
      return 'outdoor_running';
    default:
      break;
  }

  if (selection.equipment === 'gym') {
    return 'full_gym';
  }

  if (selection.equipment === 'home') {
    return 'home_limited';
  }

  const hasRunningSignal =
    selection.goal === 'run_mobility' ||
    selection.secondaryOutcomes.includes('conditioning') ||
    selection.focusAreas.includes('conditioning');

  if (hasRunningSignal) {
    return 'outdoor_running';
  }

  return 'bodyweight';
}

export function buildRecommendationProfile(selection: FirstRunSetupSelection): RecommendationProfile {
  return {
    setupContext: resolveSetupContext(selection),
    goalType: resolveGoalType(selection),
    weightDirection: resolveWeightDirection(selection),
    hasWeightTarget: isFiniteNumber(selection.currentWeightKg) && isFiniteNumber(selection.targetWeightKg),
  };
}
