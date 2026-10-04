import { getWorkoutTemplateById, WORKOUT_SUBSTITUTION_GROUPS } from '../features/workout/workoutCatalog';
import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { resolveProgramEquipmentBucket } from './programEquipment';
import { I18nKey, t } from './i18n';
import {
  AppLanguage,
  AppPreferences,
  ExerciseModalityPreference,
  JointSwapBias,
  JointSwapPreference,
  SetupEquipment,
} from '../types/models';

type ExerciseModalityCategory = 'free_weights' | 'machines' | 'bodyweight';

interface ExercisePreferenceMetadata {
  modality: ExerciseModalityCategory;
  lowEquipmentFriendly?: boolean;
  homeFriendly?: boolean;
  jointFriendly?: Partial<Record<JointSwapBias, boolean>>;
  jointStress?: Partial<Record<JointSwapBias, boolean>>;
}

interface ProgramPreferenceMetadata {
  recoveryFocused?: boolean;
  lowFrictionTraining?: boolean;
  steadyStrengthBias?: boolean;
  aggressiveStrengthBias?: boolean;
}

export interface TailoringPreferencesInput {
  setupEquipment: SetupEquipment | null;
  setupFreeWeightsPreference: ExerciseModalityPreference;
  setupBodyweightPreference: ExerciseModalityPreference;
  setupMachinesPreference: ExerciseModalityPreference;
  setupShoulderFriendlySwaps: JointSwapPreference;
  setupElbowFriendlySwaps: JointSwapPreference;
  setupKneeFriendlySwaps: JointSwapPreference;
}

export interface TailoredSwapOption {
  exerciseName: string;
  reason: string | null;
  score: number;
}

/**
 * Only the template is read. The content used to come with it, because the
 * equipment bucket was parsed out of the English equipment sentence; it is
 * derived from the exercises now, so the copy is no longer an input to a score.
 */
interface TailorableReadyDiscoveryItem {
  template: WorkoutTemplateV1;
}

interface JointBiasPreferenceEntry {
  bias: JointSwapBias;
  preference: JointSwapPreference;
}

const PROGRAM_METADATA: Record<string, ProgramPreferenceMetadata> = {
  tpl_2_day_minimal_full_body_v1: {
    lowFrictionTraining: true,
  },
  tpl_2_day_mobility_reset_v1: {
    recoveryFocused: true,
  },
  tpl_2_day_yoga_recovery_v1: {
    recoveryFocused: true,
  },
  tpl_3_day_run_mobility_v1: {
    recoveryFocused: true,
  },
  tpl_4_day_powerbuilding_v1: {
    aggressiveStrengthBias: true,
  },
  tpl_4_day_strength_size_v1: {
    steadyStrengthBias: true,
  },
};

const EXERCISE_METADATA: Record<string, ExercisePreferenceMetadata> = {
  'back squat': {
    modality: 'free_weights',
    jointStress: { knees: true },
  },
  'front squat': {
    modality: 'free_weights',
    jointStress: { knees: true },
  },
  'hack squat': {
    modality: 'machines',
    jointFriendly: { shoulders: true },
  },
  'leg press': {
    modality: 'machines',
    jointFriendly: { shoulders: true, knees: true },
  },
  'romanian deadlift': {
    modality: 'free_weights',
    jointFriendly: { knees: true },
  },
  'trap bar deadlift': {
    modality: 'free_weights',
    jointFriendly: { knees: true },
  },
  'hip thrust': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { knees: true },
  },
  'bench press': {
    modality: 'free_weights',
    jointStress: { shoulders: true, elbows: true },
  },
  'dumbbell bench press': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true },
  },
  'machine chest press': {
    modality: 'machines',
    jointFriendly: { shoulders: true, elbows: true },
  },
  'incline bench press': {
    modality: 'free_weights',
    jointStress: { shoulders: true },
  },
  'incline dumbbell press': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true },
  },
  'overhead press': {
    modality: 'free_weights',
    jointStress: { shoulders: true, elbows: true },
  },
  'dumbbell shoulder press': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true },
  },
  'machine shoulder press': {
    modality: 'machines',
    jointFriendly: { shoulders: true },
  },
  'chest-supported row': {
    modality: 'machines',
    jointFriendly: { shoulders: true, elbows: true },
  },
  'seated cable row': {
    modality: 'machines',
    jointFriendly: { shoulders: true, elbows: true },
  },
  'barbell row': {
    modality: 'free_weights',
    jointStress: { elbows: true },
  },
  'lat pulldown': {
    modality: 'machines',
    jointFriendly: { shoulders: true, elbows: true },
  },
  'assisted pull-up': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true },
  },
  'pull-up': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { shoulders: true, elbows: true },
  },
  'reverse lunge': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { knees: true },
  },
  'walking lunge': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { knees: true },
  },
  'bulgarian split squat': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { knees: true },
  },
  'triceps pushdown': {
    modality: 'machines',
    jointFriendly: { elbows: true, shoulders: true },
  },
  'dumbbell curl': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { elbows: true },
  },
  'hammer curl': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { elbows: true },
  },
  'lateral raise': {
    modality: 'free_weights',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { shoulders: true },
  },
  'rear delt fly': {
    modality: 'machines',
    jointFriendly: { shoulders: true },
  },
  'cable crunch': {
    modality: 'machines',
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'hanging knee raise': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true },
  },
  'calf raise': {
    modality: 'machines',
    jointFriendly: { knees: true },
  },
  'leg curl': {
    modality: 'machines',
    jointFriendly: { knees: true },
  },
  'mobility flow': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'hip mobility flow': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'recovery stretch flow': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'sun salutation flow': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'yoga balance flow': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'breath reset': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'easy run blocks': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointFriendly: { shoulders: true, elbows: true, knees: true },
  },
  'tempo run blocks': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { knees: true },
  },
  'stride finishers': {
    modality: 'bodyweight',
    lowEquipmentFriendly: true,
    homeFriendly: true,
    jointStress: { knees: true },
  },
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function getPreferenceWeight(preference: ExerciseModalityPreference) {
  switch (preference) {
    case 'avoid':
      return -2.5;
    case 'neutral':
      return 0;
    case 'prefer':
      return 1.35;
    case 'love':
      return 2.15;
    default:
      return 0;
  }
}

function getJointPreferenceWeight(preference: JointSwapPreference) {
  switch (preference) {
    case 'prefer':
      return 1;
    case 'prioritize':
      return 1.7;
    case 'neutral':
    default:
      return 0;
  }
}

function getJointBiases(preferences: TailoringPreferencesInput): JointBiasPreferenceEntry[] {
  const entries: JointBiasPreferenceEntry[] = [
    { bias: 'shoulders', preference: preferences.setupShoulderFriendlySwaps },
    { bias: 'elbows', preference: preferences.setupElbowFriendlySwaps },
    { bias: 'knees', preference: preferences.setupKneeFriendlySwaps },
  ];

  return entries.filter((entry) => entry.preference !== 'neutral');
}

function getJointBiasLabel(bias: JointSwapBias, preference: JointSwapPreference) {
  const title = bias === 'shoulders' ? 'Shoulder' : bias === 'elbows' ? 'Elbow' : 'Knee';
  return preference === 'prioritize' ? `${title} priority` : `${title}-friendly`;
}

function getEquipmentFitBadge(equipment: SetupEquipment | null) {
  switch (equipment) {
    case 'home':
      return 'Home fit';
    case 'minimal':
      return 'Minimal fit';
    case 'gym':
      return 'Full gym fit';
    default:
      return null;
  }
}

export function buildTailoringBadgeLabels(preferences: TailoringPreferencesInput | null | undefined) {
  if (!preferences) {
    return [];
  }

  const labels: string[] = [];
  const equipmentBadge = getEquipmentFitBadge(preferences.setupEquipment);
  if (equipmentBadge) {
    labels.push(equipmentBadge);
  }

  for (const entry of getJointBiases(preferences)) {
    labels.push(getJointBiasLabel(entry.bias, entry.preference));
  }

  return labels;
}

function inferMetadata(exerciseName: string): ExercisePreferenceMetadata {
  const normalized = normalize(exerciseName);
  const direct = EXERCISE_METADATA[normalized];
  if (direct) {
    return direct;
  }

  if (normalized.includes('machine') || normalized.includes('cable') || normalized.includes('pulldown') || normalized.includes('row')) {
    return { modality: 'machines' };
  }

  if (normalized.includes('pull-up') || normalized.includes('bodyweight') || normalized.includes('plank') || normalized.includes('run')) {
    return { modality: 'bodyweight', lowEquipmentFriendly: true, homeFriendly: true };
  }

  return { modality: 'free_weights' };
}

function getModalityPreferenceForMetadata(
  metadata: ExercisePreferenceMetadata,
  preferences: TailoringPreferencesInput,
) {
  if (metadata.modality === 'bodyweight') {
    return preferences.setupBodyweightPreference;
  }

  if (metadata.modality === 'machines') {
    return preferences.setupMachinesPreference;
  }

  return preferences.setupFreeWeightsPreference;
}

function scoreExerciseNameForTailoring(exerciseName: string, preferences: TailoringPreferencesInput) {
  const metadata = inferMetadata(exerciseName);
  let score = getPreferenceWeight(getModalityPreferenceForMetadata(metadata, preferences));

  if (preferences.setupEquipment === 'minimal') {
    score += metadata.lowEquipmentFriendly ? 1.75 : -1.25;
  } else if (preferences.setupEquipment === 'home') {
    score += metadata.homeFriendly ? 1.75 : metadata.lowEquipmentFriendly ? 1 : -1.25;
  } else if (preferences.setupEquipment === 'gym' && !metadata.lowEquipmentFriendly) {
    score += 0.45;
  }

  for (const entry of getJointBiases(preferences)) {
    const jointWeight = getJointPreferenceWeight(entry.preference);
    if (metadata.jointFriendly?.[entry.bias]) {
      score += 1.6 * jointWeight;
    }
    if (metadata.jointStress?.[entry.bias]) {
      score -= 1.5 * jointWeight;
    }
  }

  return score;
}

function scoreProgramForTailoring(template: WorkoutTemplateV1, preferences: TailoringPreferencesInput) {
  const exerciseNames = template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
  const equipmentBucket = resolveProgramEquipmentBucket(exerciseNames);
  const totalExerciseScore =
    exerciseNames.reduce((sum, exerciseName) => sum + scoreExerciseNameForTailoring(exerciseName, preferences), 0) /
    Math.max(1, exerciseNames.length);
  let score = totalExerciseScore;

  if (preferences.setupEquipment === 'minimal') {
    score += equipmentBucket === 'low_equipment' ? 5 : -4;
  } else if (preferences.setupEquipment === 'home') {
    score += equipmentBucket === 'low_equipment' ? 4.5 : -2.5;
  } else if (preferences.setupEquipment === 'gym') {
    score += equipmentBucket === 'full_gym' ? 1.5 : 0;
  }

  const programMetadata = PROGRAM_METADATA[template.id];
  if (programMetadata) {
    const bodyweightPositive =
      preferences.setupBodyweightPreference === 'prefer' || preferences.setupBodyweightPreference === 'love';
    const machineSupportPositive =
      preferences.setupMachinesPreference === 'prefer' || preferences.setupMachinesPreference === 'love';
    const wantsJointFriendlyPath = getJointBiases(preferences).length > 0;
    const avoidingFreeWeights = preferences.setupFreeWeightsPreference === 'avoid';

    if (programMetadata.recoveryFocused && !bodyweightPositive) {
      score -= 2.25;
    }

    if (
      programMetadata.lowFrictionTraining &&
      (preferences.setupEquipment === 'minimal' || preferences.setupEquipment === 'home')
    ) {
      score += 1.5;
    }

    if (programMetadata.steadyStrengthBias && (machineSupportPositive || wantsJointFriendlyPath || avoidingFreeWeights)) {
      score += 1.2;
    }

    if (programMetadata.aggressiveStrengthBias && (wantsJointFriendlyPath || avoidingFreeWeights)) {
      score -= 1;
    }
  }

  return score;
}

function stableScoreSort<T>(items: T[], scorer: (item: T) => number) {
  return items
    .map((item, index) => ({ item, index, score: scorer(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

export function buildTailoringPreferences(
  preferences: Pick<
    AppPreferences,
    | 'setupEquipment'
    | 'setupFreeWeightsPreference'
    | 'setupBodyweightPreference'
    | 'setupMachinesPreference'
    | 'setupShoulderFriendlySwaps'
    | 'setupElbowFriendlySwaps'
    | 'setupKneeFriendlySwaps'
  >,
): TailoringPreferencesInput {
  return {
    setupEquipment: preferences.setupEquipment,
    setupFreeWeightsPreference: preferences.setupFreeWeightsPreference,
    setupBodyweightPreference: preferences.setupBodyweightPreference,
    setupMachinesPreference: preferences.setupMachinesPreference,
    setupShoulderFriendlySwaps: preferences.setupShoulderFriendlySwaps,
    setupElbowFriendlySwaps: preferences.setupElbowFriendlySwaps,
    setupKneeFriendlySwaps: preferences.setupKneeFriendlySwaps,
  };
}

export function buildTailoringRecommendationNote(
  preferences: TailoringPreferencesInput | null | undefined,
  language: AppLanguage = 'en',
) {
  if (!preferences) {
    return null;
  }

  // In the reader's language: these were English inside a Finnish
  // "why it fits" paragraph (bug hunt, 2026-10-04).
  const jointBadges = getJointBiases(preferences);
  if (jointBadges.length) {
    const joint = (bias: JointSwapBias) => t(language, `tailor.joint.${bias}` as I18nKey);
    if (jointBadges.length === 1) {
      return t(
        language,
        jointBadges[0].preference === 'prioritize' ? 'tailor.note.prioritizeOne' : 'tailor.note.friendlyOne',
        { joint: joint(jointBadges[0].bias) },
      );
    }

    return t(language, 'tailor.note.several', {
      first: joint(jointBadges[0].bias),
      second: joint(jointBadges[1].bias),
    });
  }

  if (preferences.setupEquipment === 'home') {
    return t(language, 'tailor.note.home');
  }

  if (preferences.setupEquipment === 'minimal') {
    return t(language, 'tailor.note.minimal');
  }

  return null;
}

export function rankProgramIdsByTailoring(programIds: string[], preferences: TailoringPreferencesInput | null | undefined) {
  if (!preferences) {
    return [...programIds];
  }

  const templates = programIds
    .map((programId) => getWorkoutTemplateById(programId))
    .filter((template): template is WorkoutTemplateV1 => Boolean(template));

  return stableScoreSort(templates, (template) => scoreProgramForTailoring(template, preferences)).map((template) => template.id);
}

export function sortReadyDiscoveryItemsByTailoring<T extends TailorableReadyDiscoveryItem>(
  items: T[],
  preferences: TailoringPreferencesInput | null | undefined,
) {
  if (!preferences) {
    return [...items];
  }

  return stableScoreSort(items, (item) => scoreProgramForTailoring(item.template, preferences));
}

export function getPreferredReadyEquipmentFilter(preferences: TailoringPreferencesInput | null | undefined) {
  if (!preferences) {
    return 'all' as const;
  }

  if (preferences.setupEquipment === 'home' || preferences.setupEquipment === 'minimal') {
    return 'low_equipment' as const;
  }

  return 'all' as const;
}

function buildSwapOptionReason(exerciseName: string, preferences: TailoringPreferencesInput) {
  const metadata = inferMetadata(exerciseName);
  const reasons: string[] = [];

  for (const entry of getJointBiases(preferences)) {
    if (metadata.jointFriendly?.[entry.bias]) {
      const jointTitle = entry.bias === 'shoulders' ? 'shoulders' : entry.bias === 'elbows' ? 'elbows' : 'knees';
      reasons.push(
        entry.preference === 'prioritize'
          ? `Protects ${jointTitle} first.`
          : `Feels friendlier on ${jointTitle}.`,
      );
      break;
    }
  }

  if (preferences.setupEquipment === 'home' && metadata.homeFriendly) {
    reasons.push('Fits your home setup.');
  } else if (preferences.setupEquipment === 'minimal' && metadata.lowEquipmentFriendly) {
    reasons.push('Works with lighter equipment.');
  } else if (preferences.setupEquipment === 'gym' && !metadata.lowEquipmentFriendly) {
    reasons.push('Uses your full gym access well.');
  }

  const modalityPreference = getModalityPreferenceForMetadata(metadata, preferences);
  if ((modalityPreference === 'prefer' || modalityPreference === 'love') && reasons.length < 3) {
    reasons.push(
      metadata.modality === 'bodyweight'
        ? 'Matches your bodyweight preference.'
        : metadata.modality === 'machines'
            ? 'Matches your machine preference.'
            : 'Matches your free-weight preference.',
    );
  }

  return reasons.length ? reasons.slice(0, 3).join(' ') : 'Closest fit for your current setup.';
}

/**
 * The exercises a slot may be swapped to, from its substitution group.
 *
 * Lived inside GuidedPlayerScreen until Home needed the same pool: you can now
 * change a lift while looking at the plan, not only mid-session, and both have
 * to offer the same list or the two surfaces disagree about what a slot is.
 */
export function getAllowedSwapNames(substitutionGroup: string): string[] {
  return (
    WORKOUT_SUBSTITUTION_GROUPS.find((group) => group.id === substitutionGroup)?.allowedExerciseNames ?? []
  );
}

/**
 * The swap list for a slot, minus the lift already in it — offering what you
 * are already doing is a row that does nothing.
 */
export function buildSwapOptionsForSlot(
  substitutionGroup: string,
  currentExerciseName: string,
  preferences: TailoringPreferencesInput | null | undefined,
): TailoredSwapOption[] {
  const current = currentExerciseName.trim().toLowerCase();
  return buildTailoredSwapOptions(getAllowedSwapNames(substitutionGroup), preferences).filter(
    (option) => option.exerciseName.trim().toLowerCase() !== current,
  );
}

export function buildTailoredSwapOptions(
  exerciseNames: string[],
  preferences: TailoringPreferencesInput | null | undefined,
): TailoredSwapOption[] {
  const uniqueExerciseNames = [...new Set(exerciseNames)];
  if (!preferences) {
    return uniqueExerciseNames.map((exerciseName) => ({ exerciseName, reason: null, score: 0 }));
  }

  return uniqueExerciseNames
    .map((exerciseName) => ({
      exerciseName,
      reason: buildSwapOptionReason(exerciseName, preferences),
      score: scoreExerciseNameForTailoring(exerciseName, preferences),
    }))
    .sort((left, right) => right.score - left.score || left.exerciseName.localeCompare(right.exerciseName));
}
