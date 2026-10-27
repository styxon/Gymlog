import { AppPreferences } from '../types/models';
import { UserFitnessProfile } from '../types/coaching';

/**
 * Derives a typed UserFitnessProfile from raw AppPreferences.
 *
 * Pure function — no side effects, no storage access, no defaults invented.
 * When a value cannot be derived safely, returns null or a conservative default
 * that exists in the preferences schema.
 */
export function buildUserFitnessProfile(prefs: AppPreferences): UserFitnessProfile {
  // Primary goal: prefer the singular setupGoal field.
  // Fall back to the first entry in setupGoals if setupGoal was never set
  // (some onboarding paths stored goals only in the array).
  const primaryGoal = prefs.setupGoal ?? prefs.setupGoals[0] ?? null;

  // Secondary goals: any goals in setupGoals that are not the primary.
  // setupGoals is an array of SetupGoal, so the types are compatible.
  // setupSecondaryOutcomes is a different type (SetupSecondaryOutcome) and is
  // intentionally excluded here — it does not map to SetupGoal.
  const secondaryGoals = primaryGoal
    ? prefs.setupGoals.filter((g) => g !== primaryGoal)
    : prefs.setupGoals.slice(1); // no primary: skip the implicit first, rest are secondary

  // Joint-friendly flags: any preference beyond 'neutral' means the user
  // wants the system to favour substitutions that protect that joint.
  const shoulderFriendly = prefs.setupShoulderFriendlySwaps !== 'neutral';
  const elbowFriendly = prefs.setupElbowFriendlySwaps !== 'neutral';
  const kneeFriendly = prefs.setupKneeFriendlySwaps !== 'neutral';

  return {
    level: prefs.setupLevel,
    primaryGoal,
    secondaryGoals,
    daysPerWeek: prefs.setupDaysPerWeek ?? null,
    weeklyMinutes: prefs.setupWeeklyMinutes,
    equipment: prefs.setupEquipment,
    trainingEnvironment: prefs.setupTrainingEnvironment,
    focusAreas: prefs.setupFocusAreas,
    trainingFeel: prefs.setupTrainingFeel,
    shoulderFriendly,
    elbowFriendly,
    kneeFriendly,
    currentWeightKg: prefs.setupCurrentWeightKg,
    unitPreference: prefs.unitPreference,
  };
}
