/**
 * Step 1 (where you train): what Continue waits for.
 *
 * Full gym and bodyweight are complete answers on their own. Home equipment
 * asks what is at home, and an empty answer is not one: it let the reader
 * through with "0 selected" (emulator pass, 2026-10-16).
 */
export interface LocationStepAnswer {
  selectedId: string | null;
  itemCount: number;
}

export function canContinueLocation(answer: LocationStepAnswer): boolean {
  return firstMissingLocation(answer) === null;
}

/** What the line under the disabled button names, or null when nothing is missing. */
export function firstMissingLocation(answer: LocationStepAnswer): 'location' | 'equip' | null {
  if (answer.selectedId === null) {
    return 'location';
  }
  if (answer.selectedId === 'home_gym' && answer.itemCount < 1) {
    return 'equip';
  }
  return null;
}
