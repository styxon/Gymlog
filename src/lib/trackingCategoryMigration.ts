/**
 * Programmes saved before the library's category correction keep the
 * progression they had.
 *
 * A custom programme's lift is in the progression when the library calls it
 * compound, and otherwise when its stored `trackedDefault` says so
 * (features/workout/customWorkoutAdapter). Two writers stored false for every
 * row: a copy of a ready programme (fixed for new copies on 2026-10-06) and a
 * programme the AI coach built (lib/programmeBrief, fixed the same day). While
 * the library filed every curl, raise and fly as compound that was invisible;
 * with the category following the source mechanic (withLibraryCorrections),
 * the Barbell Curl, the Triceps Pushdown and the Seated Leg Curl of those
 * programmes would have dropped out of the trend and out of last-session
 * deltas the day the update landed. "No one's progression may change" (user
 * decision, 2026-10-06).
 *
 * The rule: a stored row with `trackedDefault: false` whose library row the
 * shipped app filed as compound and the corrected one does not
 * (data/categoryCorrectedLibraryIds) is set to true. Nothing else is touched:
 *
 * - That is exactly the set whose computed role the correction changes — a
 *   row stored true is tracked either way, a lift still compound is tracked
 *   either way, and a lift the shipped app already called isolation, core or
 *   cardio read its stored false then as now.
 * - No screen lets a reader set `trackedDefault`; every stored value came from
 *   a writer (the template editor's library defaults, onboarding, CSV import,
 *   the two above). A false on one of these rows was never a reader's choice,
 *   so the rule needs no "is this a copy / an AI programme" test — which the
 *   stored shape could not answer for AI programmes anyway (they are
 *   `origin: 'authored'` like any other).
 * - A catalogue row's own priority is NOT applied to old copies: hundreds of
 *   copied rows (the Back Squat, which the library spells differently and so
 *   never matched; the catalogue's low-priority curls, which the old filing
 *   tracked) would change role, which is the thing this exists to prevent.
 *
 * It runs once per database (`appliedMigrations`, storage/database.ts): run on
 * every load it would also flip the false a writer stores today on purpose — a
 * curl added in the template editor, a coach's accessory raise.
 */
import { CATEGORY_CORRECTED_LIBRARY_IDS } from '../data/categoryCorrectedLibraryIds';
import type { ExerciseLibraryItem, ExerciseTemplate } from '../types/models';

/** The marker a database carries once the rule above has run over it. */
export const TRACKING_CATEGORY_MIGRATION_ID = 'tracking-after-category-correction-2026-10-06';

const CORRECTED_IDS: ReadonlySet<string> = new Set(CATEGORY_CORRECTED_LIBRARY_IDS);

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

type TrackedRow = Pick<ExerciseTemplate, 'name' | 'trackedDefault'> & Partial<Pick<ExerciseTemplate, 'libraryItemId'>>;

/**
 * The rule above over a list of stored rows. The library is the one the app
 * reads (corrected); a row resolves to it as customWorkoutAdapter resolves it —
 * by its library id, else by name, first row of a name wins.
 */
export function restoreTrackingAfterCategoryCorrection<T extends TrackedRow>(
  exercises: readonly T[],
  library: readonly Pick<ExerciseLibraryItem, 'id' | 'name' | 'category'>[],
  correctedIds: ReadonlySet<string> = CORRECTED_IDS,
): T[] {
  const byId = new Map<string, Pick<ExerciseLibraryItem, 'id' | 'name' | 'category'>>();
  const byName = new Map<string, Pick<ExerciseLibraryItem, 'id' | 'name' | 'category'>>();
  for (const item of library) {
    byId.set(item.id, item);
    const key = normalizeName(item.name);
    if (!byName.has(key)) {
      byName.set(key, item);
    }
  }
  return exercises.map((exercise) => {
    if (exercise.trackedDefault !== false) {
      return exercise;
    }
    const item =
      (exercise.libraryItemId ? byId.get(exercise.libraryItemId) : undefined) ?? byName.get(normalizeName(exercise.name));
    if (!item || item.category === 'compound' || !correctedIds.has(item.id)) {
      return exercise;
    }
    return { ...exercise, trackedDefault: true };
  });
}

/** A stored marker list: strings only, each once. Anything else is no list. */
export function normalizeAppliedMigrations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0 && !seen.includes(entry)) {
      seen.push(entry);
    }
  }
  return seen;
}
