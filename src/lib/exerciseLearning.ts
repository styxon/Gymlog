/**
 * What the reader has learned, and what they have checked off.
 *
 * Two separate answers, deliberately. `learned` is a declaration — the reader
 * pressed a button that says they know the lift. The technique check is a
 * self-audit: four statements about the set they just did, where the ones they
 * cannot tick are the ones worth filming. Deriving either from the other would
 * put words in their mouth, so nothing here does.
 *
 * Pure, because `src/storage/database.ts` normalises on load and that file
 * cannot be imported in a test (it reaches AsyncStorage, which reaches React
 * Native). The rule the loader enforces has to live somewhere a test can call.
 */

/** Ticked statement indexes, per exercise library item id. */
type ExerciseTechniqueChecks = Record<string, number[]>;

/**
 * Stored ticks, made safe to draw a counter from.
 *
 * The section says one thing out loud — "3 left" — and every one of these
 * corruptions would make it say the wrong number: a fractional or negative
 * index counts as a tick that no statement owns, and a repeated index counts
 * one tick twice. Sorted as well as de-duplicated, so the same four boxes
 * ticked in a different order compare equal between devices.
 */
export function normalizeTechniqueChecks(input: unknown): ExerciseTechniqueChecks {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const out: ExerciseTechniqueChecks = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.length === 0 || !Array.isArray(value)) {
      continue;
    }
    const indexes = [
      ...new Set(
        value.filter(
          (entry: unknown): entry is number =>
            typeof entry === 'number' && Number.isInteger(entry) && entry >= 0,
        ),
      ),
    ].sort((left, right) => left - right);

    // An empty list is the absence of an answer, not an answer of none. Kept,
    // it would leave a row for every lift the reader ever opened.
    if (indexes.length > 0) {
      out[key] = indexes;
    }
  }
  return out;
}

/** Ids, made safe: anything that is not a real id is not one. */
export function normalizeLearnedExerciseIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return [
    ...new Set(
      input.filter(
        (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0,
      ),
    ),
  ];
}

/**
 * Ticking a statement on or off.
 *
 * Returns the whole map rather than one lift's list, because the empty case
 * has to delete the key and a caller working with the list alone cannot.
 */
export function toggleTechniqueStatement(
  checks: ExerciseTechniqueChecks,
  exerciseId: string,
  index: number,
): ExerciseTechniqueChecks {
  const current = checks[exerciseId] ?? [];
  const next = current.includes(index)
    ? current.filter((entry) => entry !== index)
    : [...current, index].sort((left, right) => left - right);

  const out = { ...checks };
  if (next.length > 0) {
    out[exerciseId] = next;
  } else {
    delete out[exerciseId];
  }
  return out;
}

/** How many of this lift's statements are still unticked. */
export function countRemainingStatements(
  statementCount: number,
  ticked: readonly number[] | null | undefined,
): number {
  const set = new Set(ticked ?? []);
  let remaining = 0;
  for (let index = 0; index < statementCount; index += 1) {
    if (!set.has(index)) {
      remaining += 1;
    }
  }
  return remaining;
}
