import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { applyEquipmentToExercises, GYM_ALWAYS_HAS } from './equipmentExerciseFilter';
import { resolveProgramEquipment } from './programEquipment';

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

/** The chips the full-gym onboarding card starts with (OnboardingScreen). */
export const FULL_GYM_ITEMS: readonly string[] = [
  'Barbells',
  'Dumbbells',
  'Machines',
  'Cables',
  'Squat rack',
  'Bench',
  'Kettlebells',
  'Cardio machines',
];

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
 * A gym reader with the full set of chips draws from the whole catalog; with
 * chips unticked, from what the rest can run. Anyone else draws
 * from what fits their chips — the low-equipment shelf and any gym programme
 * their own gear can run — and from the whole low-equipment shelf only when
 * nothing fits, so there is always an answer.
 */
/** A barbell is one chip on the home card and another in the exercise rules. */
const SAME_GEAR: Record<string, string[]> = {
  'Barbell & plates': ['Barbell & plates', 'Barbells'],
  Barbells: ['Barbells', 'Barbell & plates'],
};

const gearUseCache = new Map<string, number>();

/**
 * How much of the reader's own training gear a programme uses: 0 when none of
 * it, 1 when all of it. A mat is not counted; it is a floor, not gear.
 *
 * Every home programme sits on the one low-equipment shelf, so the pick among
 * them used to ignore what the reader owns: someone with dumbbells was handed
 * At Home - No Equipment over the dumbbell programme that fitted (920 of 7200
 * answer sets, recommendation matrix 2026-10-05). The pick weighs this now.
 */
export function programGearUse(programId: string, available: readonly string[] | null | undefined): number {
  const gear = (available ?? []).filter((item) => item !== 'Yoga mat');
  if (gear.length === 0) {
    return 0;
  }
  const key = `${programId}|${[...gear].sort().join(',')}`;
  const cached = gearUseCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const template = getWorkoutTemplateById(programId);
  const needs = new Set<string>(
    template ? resolveProgramEquipment(template.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName))) : [],
  );
  const used = gear.filter((item) => (SAME_GEAR[item] ?? [item]).some((name) => needs.has(name)));
  const share = used.length / gear.length;
  gearUseCache.set(key, share);
  return share;
}

export { GYM_ALWAYS_HAS };

export function equipmentCandidatePool<T extends { programId: string; equipmentTier: string }>(
  programs: readonly T[],
  input: { equipment: string; availableEquipment?: string[] | null },
): T[] {
  if (input.equipment === 'gym') {
    // The full-gym card's chips are editable. Unticking Barbells used to change
    // nothing here, so a gym without barbells was handed 5x5 with eight of nine
    // lifts swapped (sweep, 2026-10-04). Every default chip, or no list at all,
    // is still the whole catalog.
    const gymChips = input.availableEquipment ?? null;
    if (gymChips === null || gymChips.length === 0 || FULL_GYM_ITEMS.every((item) => gymChips.includes(item))) {
      return [...programs];
    }
    // The card never offers a pull-up bar or bands: every gym has them, so
    // they are read in. Without them unticking Cardio machines dropped the
    // glute and calisthenics programmes over Banded Hip Thrust and Weighted
    // Pull-Up (review, 2026-10-04).
    const withGymBasics = [...new Set([...gymChips, ...GYM_ALWAYS_HAS])];
    const gymFitting = programs.filter((definition) => programFitsEquipment(definition.programId, withGymBasics));
    return gymFitting.length > 0 ? gymFitting : [...programs];
  }
  const lowTier = programs.filter((definition) => definition.equipmentTier === 'low_equipment');
  const available = input.availableEquipment ?? null;
  if (available === null) {
    return lowTier;
  }
  const fitting = programs.filter((definition) => programFitsEquipment(definition.programId, available));
  return fitting.length > 0 ? fitting : lowTier;
}
