import { useMemo } from 'react';

import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { resolveFirstRunRecommendationWithTailoring } from '../lib/firstRunSetup';
import type { getBodyweightProgress } from '../lib/progression';
import { buildTailoringPreferences } from '../lib/tailoringFit';
import type { AppPreferences, TrainingCycle } from '../types/models';
import {
  buildSetupBasicsFromPreferences,
  buildSetupSeedKey,
  buildSetupSelectionFromPreferences,
} from './onboardingHandoff';

/**
 * The setup answers as the shell reads them: the selection, the questionnaire's
 * seed, the tailoring, the recommendation, and the recommended ready
 * programme with its content.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01),
 * keys, memos and eslint-disable lines as they stood. A hook because these
 * are memos whose identity everything downstream depends on — the keys exist
 * so it holds across a theme or sound toggle. VinhaApp calls this exactly
 * where the lines stood — after useRoutineBlockCosts, just ahead of
 * homeActivePlanCard — so every hook keeps its slot. setupSelectionKey and
 * tailoringKey stay inside: nothing else in VinhaApp reads them.
 */
export interface SetupReadingsDeps {
  /** The reader's preferences: the setup answers, the recommended programme, the language. */
  preferences: AppPreferences;
  /** The weigh-in log's progress; its latest weight seeds the questionnaire. */
  bodyweightProgress: ReturnType<typeof getBodyweightProgress>;
  /** The lead programme's rhythm, which the questionnaire opens on. */
  leadTrainingCycle: TrainingCycle | null;
}

export function useSetupReadings(deps: SetupReadingsDeps) {
  const { preferences, bodyweightProgress, leadTrainingCycle } = deps;

  // Both used to depend on the whole preferences object, so a theme or sound
  // toggle handed them a new object and they rebuilt — and everything
  // downstream of the setup selection (the recommendation, the programme
  // rankings, the goal-programme suggestions) rebuilt with them. Measured: that
  // chain was the ~4.9s behind every settings switch. A key over the fields
  // each one actually reads is what "changed" should have meant all along —
  // kept beside the builders, where a test holds it to what they read.
  const setupSelectionKey = buildSetupSeedKey(preferences, leadTrainingCycle);
  const setupSelection = useMemo(
    () => buildSetupSelectionFromPreferences(preferences, null, leadTrainingCycle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setupSelectionKey],
  );
  // What the setup questionnaire opens on: the same answers, with the weight
  // from the weigh-in log rather than what setup was last told. Only the
  // questionnaire — the recommendation and the composed onboarding week stay
  // on `setupSelection`, so a weigh-in never reshapes a running programme.
  const latestWeighInKg = bodyweightProgress.latest?.weight ?? null;
  const setupEditSelection = useMemo(
    () => buildSetupSelectionFromPreferences(preferences, latestWeighInKg, leadTrainingCycle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setupSelectionKey, latestWeighInKg],
  );
  const setupBasics = useMemo(
    () => buildSetupBasicsFromPreferences(preferences, latestWeighInKg, leadTrainingCycle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setupSelectionKey, latestWeighInKg],
  );
  const tailoringKey = JSON.stringify([
    preferences.setupBodyweightPreference, preferences.setupElbowFriendlySwaps, preferences.setupEquipment,
    preferences.setupFreeWeightsPreference, preferences.setupKneeFriendlySwaps, preferences.setupMachinesPreference,
    preferences.setupShoulderFriendlySwaps,
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tailoringPreferences = useMemo(() => buildTailoringPreferences(preferences), [tailoringKey]);
  const setupRecommendation = useMemo(
    () =>
      setupSelection
        ? resolveFirstRunRecommendationWithTailoring(setupSelection, tailoringPreferences, preferences.appLanguage)
        : null,
    [setupSelection, tailoringPreferences, preferences.appLanguage],
  );
  const recommendedReadyTemplate = useMemo(
    () => (preferences.recommendedProgramId ? getWorkoutTemplateById(preferences.recommendedProgramId) : null),
    [preferences.recommendedProgramId],
  );

  return {
    setupSelection,
    latestWeighInKg,
    setupEditSelection,
    setupBasics,
    tailoringPreferences,
    setupRecommendation,
    recommendedReadyTemplate,
  };
}
