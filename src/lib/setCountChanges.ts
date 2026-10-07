/**
 * Which lifts a programme save changed the set count of, for the line that
 * names them.
 *
 * The emphasis sheet's sliders move set counts row by row without showing
 * the rows: a reader who dragged "Glutes & legs" up found the hip thrust at
 * 5 × 8 weeks later, remembered it as 4 × 8, and could not tell whether the
 * app had added a set on its own (#to-do 2026-09-29 — it never does). The
 * save now says which rows moved, "Hip thrust 4 → 5 sets", so the change has
 * a moment the reader saw.
 */

export interface SetCountChange {
  name: string;
  from: number;
  to: number;
}

interface SessionRows {
  exercises: ReadonlyArray<{ id: string; name: string; targetSets: number }>;
}

/**
 * The rows whose count `setsByExerciseId` changes, in programme order. A lift
 * on several days moved the same way is named once; moved differently, each
 * move is its own entry.
 */
export function setCountChanges(
  sessions: ReadonlyArray<SessionRows>,
  setsByExerciseId: ReadonlyMap<string, number>,
): SetCountChange[] {
  const changes: SetCountChange[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const to = setsByExerciseId.get(exercise.id);
      if (to === undefined || to === exercise.targetSets) {
        continue;
      }
      const key = `${exercise.name.trim().toLowerCase()}|${exercise.targetSets}|${to}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      changes.push({ name: exercise.name, from: exercise.targetSets, to });
    }
  }
  return changes;
}

/** How many changes a toast names before "+N more": a toast is read at a glance. */
export const SET_COUNT_TOAST_NAMED = 3;

/** The changes a toast names, and how many it only counts. */
export function setCountToastParts(
  changes: readonly SetCountChange[],
  named = SET_COUNT_TOAST_NAMED,
): { named: SetCountChange[]; more: number } {
  return { named: changes.slice(0, named), more: Math.max(0, changes.length - named) };
}
