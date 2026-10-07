/**
 * The dose a slot asks for once another lift is swapped into it.
 *
 * One rule for every swap made before a session starts: "Just this time" (the
 * held swap, applied at the start), "For ever" (written into the programme),
 * and the row that shows either one on Home and the programme day. They used
 * to disagree. The held swap converted the numbers when the unit changed, the
 * permanent one carried them over raw — a 45-second plank kept for ever as
 * crunches asked for 45 crunches, a squat at 8 became an 8-second plank or 8
 * minutes on a bike — and the row kept printing the old lift's "3 × 8" over a
 * session that would open on seconds (swap hunt, 2026-10-07).
 *
 * Within a unit, nothing moves: same sets, same numbers, same slot. Across one
 * (repetitions, seconds of a hold, minutes of a bout) the old numbers mean
 * nothing, and the slot takes the incoming lift's own default — the one the
 * add sheet starts that exercise on (getExerciseTemplateDefaults), so a lift
 * swapped in reads exactly as the same lift added from the library would.
 * Two exceptions keep the slot's set count:
 * - A superset counts in rounds, and one lift of a block on its own count is
 *   a round the block never runs.
 * - A name the library cannot place, or whose library row's default is
 *   written in another unit, has no add-sheet default to take; it gets what
 *   the programmes write for it (prescriptionAfterSwap) instead.
 */

import { EXTRA_EXERCISE_LIBRARY } from '../data/extraExerciseLibrary';
import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { prescriptionUnitOf, PrescriptionUnit, WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { ExerciseLibraryItem } from '../types/models';
import { prescriptionAfterSwap, trackingModeAfterSwap } from './catalogExercisePools';
import { withLibraryCorrections } from './exerciseClassification';
import { getExerciseTemplateDefaults } from './exerciseSuggestions';
import { findGuidedLibraryIndex } from './guidedPlayer';
import { isHoldExerciseName } from './holdExercises';

export interface SlotDose {
  trackingMode: WorkoutTrackingMode;
  sets: number;
  repsMin: number;
  repsMax: number;
}

/**
 * The library the add sheet adds from, as the app seeds it on every load.
 * Built on first use rather than at import: Home's first frame does not need
 * it, and app start is on a time budget.
 */
let seedLibrary: { items: ExerciseLibraryItem[]; names: string[] } | null = null;

function libraryItemNamed(name: string): ExerciseLibraryItem | undefined {
  if (!seedLibrary) {
    const items = withLibraryCorrections([...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]);
    seedLibrary = { items, names: items.map((item) => item.name) };
  }
  // The add sheet's own lookup (resolveLibraryItemIdForName): a programme's
  // spelling finds the library row it means.
  const index = findGuidedLibraryIndex(name, seedLibrary.names);
  return index === null || index < 0 ? undefined : seedLibrary.items[index];
}

/** Whether the add sheet's default for this row is written in this unit. */
function defaultSpeaks(unit: PrescriptionUnit, item: ExerciseLibraryItem): boolean {
  const hold = isHoldExerciseName(item.name);
  if (unit === 'seconds') {
    return hold;
  }
  if (unit === 'minutes') {
    // Its cardio default is one bout of 8–12; any other is a set count.
    return !hold && item.category === 'cardio';
  }
  return !hold;
}

/** The same lift, however it is cased or padded: a swap to it is no swap. */
export function isSameLiftName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function doseAfterSwap(
  current: SlotDose & { supersetGroup?: string | null },
  exerciseName: string,
): SlotDose {
  const trackingMode = trackingModeAfterSwap(current.trackingMode, exerciseName);
  const unit = prescriptionUnitOf(trackingMode);
  if (unit === prescriptionUnitOf(current.trackingMode)) {
    return { trackingMode, sets: current.sets, repsMin: current.repsMin, repsMax: current.repsMax };
  }
  const item = libraryItemNamed(exerciseName);
  if (!item || !defaultSpeaks(unit, item)) {
    const { repsMin, repsMax } = prescriptionAfterSwap(
      current.trackingMode,
      trackingMode,
      { repsMin: current.repsMin, repsMax: current.repsMax },
      exerciseName,
    );
    return { trackingMode, sets: current.sets, repsMin, repsMax };
  }
  // The rest is the slot's and stays where it is, so the default's own rest
  // is not read; any number does for it.
  const defaults = getExerciseTemplateDefaults(item, 90);
  return {
    trackingMode,
    sets: current.supersetGroup ? current.sets : defaults.targetSets,
    repsMin: defaults.repMin,
    repsMax: defaults.repMax,
  };
}
