import { useCallback, useMemo } from 'react';

import { resolveAvailableEquipment } from '../lib/equipmentExerciseFilter';
import { estimateRoutineBlockSeconds } from '../lib/guidedPlayer';
import {
  classifySessionFocus,
  getDefaultCooldown,
  getDefaultWarmup,
  SessionFocusKind,
} from '../lib/homeSessionHero';
import type { AppPreferences } from '../types/models';

/**
 * The equipment the reader's warm-up and cool-down drills may use, and what
 * those blocks cost a session in seconds.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook because the moved code is a memo and two callbacks, whose identity
 * Home's plan card and the programme pages depend on. VinhaApp calls this
 * exactly where the lines stood — after useCoachEntryReadings, just ahead of
 * useSetupReadings — so every hook keeps its slot.
 */
export interface RoutineBlockCostsDeps {
  /** The reader's preferences: language, setup equipment and drill swaps. */
  preferences: AppPreferences;
}

export function useRoutineBlockCosts(deps: RoutineBlockCostsDeps) {
  const { preferences } = deps;

  const availableEquipmentForDrills = useMemo(
    () =>
      resolveAvailableEquipment({
        trainingEnvironment: preferences.setupTrainingEnvironment,
        equipmentItems: preferences.setupEquipmentItems,
      }),
    [preferences.setupTrainingEnvironment, preferences.setupEquipmentItems],
  );
  /**
   * Warm-up and cool-down cost for a session, from the same blocks the player
   * runs — so Home's "~50 min" and the guided entry's "~50 min" are the same
   * arithmetic on the same inputs, not two guesses that happen to be close.
   */
  const routineBlockSeconds = useCallback(
    (focus: SessionFocusKind) => ({
      warmupSeconds: estimateRoutineBlockSeconds(
        getDefaultWarmup(
          focus,
          preferences.appLanguage,
          availableEquipmentForDrills,
          preferences.routineDrillOverrides,
          preferences.setupCautionFlags,
        ),
      ),
      cooldownSeconds: estimateRoutineBlockSeconds(
        getDefaultCooldown(
          focus,
          preferences.appLanguage,
          availableEquipmentForDrills,
          preferences.routineDrillOverrides,
          preferences.setupCautionFlags,
        ),
      ),
    }),
    [preferences.appLanguage, availableEquipmentForDrills, preferences.routineDrillOverrides, preferences.setupCautionFlags],
  );
  /** The same cost for a day known only by its lifts — the programme page's. */
  const routineSecondsForExercises = useCallback(
    (exerciseNames: string[]) => routineBlockSeconds(classifySessionFocus(exerciseNames)),
    [routineBlockSeconds],
  );

  return { availableEquipmentForDrills, routineBlockSeconds, routineSecondsForExercises };
}
