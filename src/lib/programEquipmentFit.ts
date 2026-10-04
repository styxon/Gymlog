import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { applyEquipmentToExercises } from './equipmentExerciseFilter';

/**
 * Whether a ready programme survives the reader's own gear.
 *
 * The recommender chose by environment alone: anyone not at a full gym drew
 * from the low-equipment shelf, and nothing else. So a home gym with a barbell
 * and a rack was never offered a barbell programme, and calisthenics was
 * offered to a reader with no pull-up bar — whose pull day the equipment pass
 * then emptied down to two exercises (coverage sweep, 2026-10-04).
 *
 * A programme fits when the equipment pass leaves it mostly as written: at
 * most one exercise dropped in the whole week, never two from one day, and no
 * more than a third of it swapped for something else.
 */
const MAX_REMOVED_PER_WEEK = 1;
const MAX_REMOVED_PER_SESSION = 1;
const MAX_SWAPPED_SHARE = 1 / 3;

const cache = new Map<string, boolean>();

export function programFitsEquipment(programId: string, available: string[] | null): boolean {
  if (available === null) {
    return true;
  }
  const key = `${programId}|${[...available].sort().join(',')}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const template = getWorkoutTemplateById(programId);
  if (!template) {
    cache.set(key, false);
    return false;
  }
  let removed = 0;
  let swapped = 0;
  let total = 0;
  let fits = true;
  for (const session of template.sessions) {
    const adjusted = applyEquipmentToExercises(session.exercises, available);
    total += session.exercises.length;
    removed += adjusted.removed.length;
    swapped += adjusted.swapped.length;
    if (adjusted.removed.length > MAX_REMOVED_PER_SESSION) {
      fits = false;
    }
  }
  if (removed > MAX_REMOVED_PER_WEEK || (total > 0 && swapped / total > MAX_SWAPPED_SHARE)) {
    fits = false;
  }
  cache.set(key, fits);
  return fits;
}

/**
 * The programmes the recommender may choose from.
 *
 * A gym reader draws from the whole catalog, as before. Anyone else draws
 * from what fits their chips — the low-equipment shelf and any gym programme
 * their own gear can run — and from the whole low-equipment shelf only when
 * nothing fits, so there is always an answer.
 */
export function equipmentCandidatePool<T extends { programId: string; equipmentTier: string }>(
  programs: readonly T[],
  input: { equipment: string; availableEquipment?: string[] | null },
): T[] {
  if (input.equipment === 'gym') {
    return [...programs];
  }
  const lowTier = programs.filter((definition) => definition.equipmentTier === 'low_equipment');
  const available = input.availableEquipment ?? null;
  if (available === null) {
    return lowTier;
  }
  const fitting = programs.filter((definition) => programFitsEquipment(definition.programId, available));
  return fitting.length > 0 ? fitting : lowTier;
}
