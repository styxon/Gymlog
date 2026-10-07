import type { FirstRunSetupSelection } from './firstRunSetup';
import { buildRecommendationProfile } from './recommendationProfile';
import { resolveAvailableEquipment } from './equipmentExerciseFilter';
import type { RecommendationInput } from '../types/recommendation';

const DEFAULT_SESSION_MINUTES_BY_DAYS: Record<number, number> = {
  2: 45,
  3: 50,
  4: 55,
  5: 60,
};

function clampMinutes(value: number) {
  return Math.max(30, Math.min(90, Math.round(value / 5) * 5));
}

export function inferPreferredSessionMinutes(selection: Pick<FirstRunSetupSelection, 'daysPerWeek' | 'weeklyMinutes'>) {
  if (typeof selection.weeklyMinutes === 'number' && selection.weeklyMinutes > 0) {
    return clampMinutes(selection.weeklyMinutes / Math.max(selection.daysPerWeek, 1));
  }

  return DEFAULT_SESSION_MINUTES_BY_DAYS[selection.daysPerWeek] ?? 55;
}

export function buildRecommendationInput(selection: FirstRunSetupSelection): RecommendationInput {
  const preferredSessionMinutes = inferPreferredSessionMinutes(selection);

  return {
    goal: selection.goal,
    level: selection.level,
    daysPerWeek: selection.daysPerWeek,
    equipment: selection.equipment,
    gender: selection.gender,
    profile: buildRecommendationProfile(selection),
    secondaryOutcomes: selection.secondaryOutcomes,
    focusAreas: selection.focusAreas,
    weeklyMinutes: typeof selection.weeklyMinutes === 'number' ? selection.weeklyMinutes : null,
    preferredSessionMinutes,
    wantsConsistency: selection.secondaryOutcomes.includes('consistency'),
    // 'unspecified' is a real answer meaning "I would rather not say", so it
    // reaches the scorer as null rather than as a band. Skipping the question
    // and declining it should decide the same thing: nothing.
    ageRange:
      selection.ageRange && selection.ageRange !== 'unspecified' ? selection.ageRange : null,
    availableEquipment: resolveAvailableEquipment(selection),
    cautionFlags: selection.cautionFlags ?? [],
  };
}
