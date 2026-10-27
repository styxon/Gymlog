/**
 * Vinha coaching system types.
 *
 * Do not add types here ahead of an active implementation need.
 */

import {
  SetupEquipment,
  SetupFocusArea,
  SetupGoal,
  SetupLevel,
  SetupTrainingEnvironment,
  TrainingFeelPreference,
  UnitPreference,
} from './models';

// ---------------------------------------------------------------------------
// UserFitnessProfile
// ---------------------------------------------------------------------------
// A typed, derived view over AppPreferences.
// No new data collection. No new storage key. No UI required.
// Assembled by buildUserFitnessProfile() in src/lib/userFitnessProfile.ts
//
// Status: MVP — type defined, builder function is the next step when needed.
// ---------------------------------------------------------------------------

export interface UserFitnessProfile {
  // Training background
  level: SetupLevel | null;

  // Goal hierarchy
  primaryGoal: SetupGoal | null;
  secondaryGoals: SetupGoal[];

  // Schedule
  daysPerWeek: number | null;
  weeklyMinutes: number | null;

  // Equipment and environment
  equipment: SetupEquipment | null;
  trainingEnvironment: SetupTrainingEnvironment | null;

  // Focus
  focusAreas: SetupFocusArea[];

  // Preferences relevant to coaching decisions
  trainingFeel: TrainingFeelPreference;

  // Joint sensitivity (used for exercise substitution)
  shoulderFriendly: boolean;
  elbowFriendly: boolean;
  kneeFriendly: boolean;

  // Physical context
  currentWeightKg: number | null;

  // Output format
  unitPreference: UnitPreference;
}

// ---------------------------------------------------------------------------
// Future types — do not implement yet
// ---------------------------------------------------------------------------
// ProgressionState       — per-exercise progression tracking    [later]
// SessionPerformanceSignal — computed after each session        [later]
// AdherenceRecord        — weekly planned vs actual             [later]
// CoachingAction         — typed coaching recommendation union  [later]
// CoachingContext        — assembled context for Vinha AI       [later]
// MuscleGroupFatigueState — per-muscle ACWR                    [do not build yet]
// GoalMilestone          — goal progress tracking               [do not build yet]
// RecentMemory / BlockMemory / LifetimeMemory                   [do not build yet]
