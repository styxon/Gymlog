import type { SetupEquipment, SetupTrainingEnvironment } from '../types/models';

/** Heavy home gear upgrades the derived environment from minimal_equipment to home_gym. */
export const HOME_HEAVY_EQUIPMENT_ITEMS: readonly string[] = ['Barbell & plates', 'Squat rack'];

export interface EquipmentCard {
  id: SetupTrainingEnvironment;
  equipment: SetupEquipment;
  trainingEnvironment: SetupTrainingEnvironment;
}

/**
 * The equipment and environment a setup card stores for the chips ticked on it.
 *
 * Every chip unticked is an answer: nothing. Saved as the card's own setup with
 * no chips it reads as "unknown gear" (resolveAvailableEquipment returns null
 * for it), and the reader was handed dumbbell work on the home card (bug hunt,
 * 2026-10-04) and barbell, machine and cable lifts on the full-gym card, whose
 * week flipped from dumbbell-only at one chip to everything at none (hunt,
 * 2026-10-09). With no chips either card is the bodyweight one.
 */
export function equipmentSetupForChips(
  card: EquipmentCard,
  items: readonly string[],
): { equipment: SetupEquipment; trainingEnvironment: SetupTrainingEnvironment } {
  if (card.id === 'home_gym') {
    if (items.length === 0) {
      return { equipment: 'home', trainingEnvironment: 'bodyweight_only' };
    }
    const hasHeavy = items.some((item) => HOME_HEAVY_EQUIPMENT_ITEMS.includes(item));
    return {
      equipment: hasHeavy ? 'home' : 'minimal',
      trainingEnvironment: hasHeavy ? 'home_gym' : 'minimal_equipment',
    };
  }
  if (card.id === 'full_gym' && items.length === 0) {
    return { equipment: 'minimal', trainingEnvironment: 'bodyweight_only' };
  }
  return { equipment: card.equipment, trainingEnvironment: card.trainingEnvironment };
}
