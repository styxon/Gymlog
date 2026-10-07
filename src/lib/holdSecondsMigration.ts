/**
 * A stretch stored as repetitions before it was a hold gets the hold the
 * editor gives it today.
 *
 * Until 2026-10-05 a stretch or an isometric picked from the library
 * ("Hamstring Stretch", "Seated Hamstring", "Calves-SMR") opened a reps dial
 * and was stored "3 × 12" with no mode. The name rule in lib/holdExercises
 * made those names holds, and a row with no stored mode derives its mode from
 * the name (customWorkoutAdapter.getTrackingMode), so the same row asked for
 * 3 × 12 SECONDS — a number nobody chose as seconds (bug hunt, 2026-10-07).
 *
 * The rule: a stored row with no mode, whose name (the library row's, as the
 * adapter reads it) is a hold only since the name rule
 * (holdExercises.isHoldSinceNameRule), and whose prescription is below
 * REPS_NOT_SECONDS_BELOW, is prescribed DEFAULT_HOLD_SECONDS — what
 * exerciseSuggestions.getExerciseTemplateDefaults hands the same row now.
 * Sets and rest stay: neither changed its unit.
 *
 * Not touched: a row with a stored mode (the writer's own answer outranks the
 * name), a name that was a hold from the start (its numbers were seconds all
 * along — an L-sit at 10 s is meant), a count of 20 or more (a reader who
 * typed 30 on the reps dial meant 30 seconds), and logged sets — history is
 * what was done, in the numbers it was done in.
 *
 * Once per database (`appliedMigrations`, storage/database.ts), like the
 * minutes rule: a reader who steps the hold down to 12 s after the update is
 * not undone on the next load.
 */
import { DEFAULT_HOLD_SECONDS, isHoldSinceNameRule } from './holdExercises';
import type { ExerciseLibraryItem, ExerciseTemplate } from '../types/models';

/** The marker a database carries once the rule above has run over it. */
export const HOLD_SECONDS_MIGRATION_ID = 'hold-seconds-for-old-stretches-2026-10-07';

/**
 * The reps the old editor handed these rows were 6–8, 8–12, 10–12 and 12–15.
 * The ready programmes' shortest hold of a beginner's position starts at 20 s
 * (Plank, Side Plank 20–40) and every stretch they prescribe at 30 s, so a
 * count below 20 was a count of repetitions.
 */
export const REPS_NOT_SECONDS_BELOW = 20;

type HoldRow = Pick<ExerciseTemplate, 'name' | 'trackingMode' | 'repMin' | 'repMax' | 'libraryItemId'>;

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export function moveOldStretchesToHoldSeconds<T extends HoldRow>(
  exercises: readonly T[],
  library: readonly Pick<ExerciseLibraryItem, 'id' | 'name'>[],
): T[] {
  const byId = new Map<string, Pick<ExerciseLibraryItem, 'id' | 'name'>>();
  const byName = new Map<string, Pick<ExerciseLibraryItem, 'id' | 'name'>>();
  for (const item of library) {
    byId.set(item.id, item);
    const key = normalizeName(item.name);
    if (!byName.has(key)) {
      byName.set(key, item);
    }
  }
  return exercises.map((exercise) => {
    if (exercise.trackingMode || exercise.repMax >= REPS_NOT_SECONDS_BELOW) {
      return exercise;
    }
    // The name the player decides the mode by: the library row's, else the row's own.
    const item =
      (exercise.libraryItemId ? byId.get(exercise.libraryItemId) : undefined) ?? byName.get(normalizeName(exercise.name));
    if (!isHoldSinceNameRule(item?.name ?? exercise.name)) {
      return exercise;
    }
    return { ...exercise, repMin: DEFAULT_HOLD_SECONDS.min, repMax: DEFAULT_HOLD_SECONDS.max };
  });
}
