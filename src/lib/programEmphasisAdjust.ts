import { EmphasisArea } from './programEmphasis';

/**
 * Moving a programme's emphasis (design: GAINER Hourglass Shape, screen 3).
 *
 * The design's rule, and the reason the controls are linked: a week holds a
 * finite number of sets, so raising one area lowers the others. The total is
 * preserved by construction here rather than checked afterwards — a slider
 * that could quietly grow the week from 77 sets to 96 would be selling more
 * training as a preference.
 *
 * Steppers rather than sliders at the call site: the design's own script
 * quantises a drag to whole four-set jumps, and a stepper expresses exactly
 * that with no gesture imprecision — which also happens to be the only option
 * without a slider dependency.
 */

export interface EmphasisExercise {
  area: EmphasisArea;
  /** 'primary' | 'secondary' | 'accessory'; anything else sorts last. */
  role: string;
  sets: number;
}

/** One press. Four sets is roughly five percent of a typical week. */
export const EMPHASIS_STEP = 4;

/**
 * An exercise never drops below one set (removing it is a different action,
 * and a zero-set exercise is a lie in the list) and never climbs past six
 * (past that the programme is not the programme any more).
 */
export const MIN_SETS_PER_EXERCISE = 1;
export const MAX_SETS_PER_EXERCISE = 6;

/**
 * Which lift absorbs a change first.
 *
 * Volume goes on and comes off the accessories before the anchor: the anchor
 * is the lift the programme measures progress by, and quietly halving its sets
 * because the reader nudged a slider would change what the programme IS. This
 * is the same order the progression rules state in words.
 */
const ROLE_ORDER: Record<string, number> = { accessory: 0, secondary: 1, primary: 2 };

function roleRank(role: string): number {
  return ROLE_ORDER[role] ?? 0;
}

/** Indexes of `exercises`, ordered by how willingly they take a change. */
function candidates(exercises: readonly EmphasisExercise[], inArea: boolean, area: EmphasisArea): number[] {
  return exercises
    .map((exercise, index) => ({ exercise, index }))
    .filter(({ exercise }) => (exercise.area === area) === inArea)
    .sort((left, right) => roleRank(left.exercise.role) - roleRank(right.exercise.role) || left.index - right.index)
    .map(({ index }) => index);
}

interface EmphasisAdjustment {
  /** New set count per exercise, same order and length as the input. */
  sets: number[];
  /**
   * Sets actually moved, which can be less than requested when the area is
   * already at its ceiling or the rest of the week is at its floor. The sheet
   * shows this number, not the requested one — a control that reports a change
   * it did not make is worse than one that refuses.
   */
  moved: number;
}

/**
 * Move `requestedSets` into (or out of, when negative) `area`, taking the same
 * amount from the rest of the week.
 *
 * Spreading is round-robin over the role order, so a four-set move lands on
 * four different lifts rather than quadrupling one.
 */
export function adjustEmphasis(
  exercises: readonly EmphasisExercise[],
  area: EmphasisArea,
  requestedSets: number,
): EmphasisAdjustment {
  const sets = exercises.map((exercise) => exercise.sets);
  if (requestedSets === 0 || exercises.length === 0) {
    return { sets, moved: 0 };
  }

  const growing = requestedSets > 0;
  const magnitude = Math.abs(requestedSets);
  // Growing the area means giving to it and taking from the rest; shrinking is
  // the same walk with the two sides swapped.
  const givers = candidates(exercises, !growing, area);
  const takers = candidates(exercises, growing, area);

  const room = (index: number) => MAX_SETS_PER_EXERCISE - sets[index];
  const spare = (index: number) => sets[index] - MIN_SETS_PER_EXERCISE;

  const capacity = Math.min(
    takers.reduce((sum, index) => sum + room(index), 0),
    givers.reduce((sum, index) => sum + spare(index), 0),
    magnitude,
  );
  if (capacity <= 0) {
    return { sets, moved: 0 };
  }

  let remaining = capacity;
  while (remaining > 0) {
    const before = remaining;
    for (const index of takers) {
      if (remaining === 0) {
        break;
      }
      if (room(index) > 0) {
        sets[index] += 1;
        remaining -= 1;
      }
    }
    // A full pass that placed nothing means every taker is capped; the
    // capacity check above should prevent it, and the break keeps a data shape
    // we did not foresee from spinning forever.
    if (remaining === before) {
      break;
    }
  }

  let owed = capacity - remaining;
  while (owed > 0) {
    const before = owed;
    for (const index of givers) {
      if (owed === 0) {
        break;
      }
      if (spare(index) > 0) {
        sets[index] -= 1;
        owed -= 1;
      }
    }
    if (owed === before) {
      break;
    }
  }

  return { sets, moved: (capacity - remaining) * (growing ? 1 : -1) };
}
