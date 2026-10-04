import { EXTRA_EXERCISE_LIBRARY } from '../data/extraExerciseLibrary';
import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import {
  isTimedTrackingMode,
  isUnloadedTrackingMode,
  WorkoutTrackingMode,
} from '../features/workout/workoutTypes';
import { findGuidedLibraryIndex } from './guidedPlayer';
import { isHoldExerciseName } from './holdExercises';
import { isExerciseAllowedWithEquipment } from './equipmentExerciseFilter';
import { SetupFocusArea } from '../types/models';

/**
 * Exercise names the plan composer is allowed to invent.
 *
 * Three places used to write exercise names by hand — focus emphasis, the
 * equipment fallback chain, and the supplemental days that pad a template out
 * to the user's chosen day count. Each carried a comment saying the names were
 * grounded in the catalog. None of them were: the composer was producing
 * "Arms", "Lat Pulldown" and "Glute Bridge", none of which exist in the 873
 * exercise library, so the day arrived with no photo, no demo, no instructions
 * and nothing for the swap feature to match.
 *
 * Everything here is checked against the library by a test. A name that is not
 * in the catalog cannot reach a user's plan.
 */

const byName = new Map(
  GENERATED_EXERCISE_LIBRARY.map((entry) => [entry.name.trim().toLowerCase(), entry] as const),
);

const libraryNames = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);

// The app's own additions (extraExerciseLibrary), for what a name IS and how
// it is logged — not for body part or category, whose areas are built from
// the generated list (2026-09-26).
const extraByName = new Map(
  EXTRA_EXERCISE_LIBRARY.map((entry) => [entry.name.trim().toLowerCase(), entry] as const),
);

export function isCatalogExercise(name: string) {
  const key = name.trim().toLowerCase();
  return byName.has(key) || extraByName.has(key);
}

export function getCatalogBodyPart(name: string) {
  return byName.get(name.trim().toLowerCase())?.bodyPart ?? null;
}

/**
 * Body part for a name that may not be spelled the way the library spells it.
 *
 * The ready templates say "Bench Press" where the library says "Barbell Bench
 * Press - Medium Grip", so an exact lookup reports nothing for most of the
 * catalog. Reuses the guided player's matcher rather than repeating its alias
 * table — two copies of that mapping would drift, and then a day could show a
 * photo of one muscle group while emphasis treated it as another.
 */
export function resolveCatalogBodyPart(name: string) {
  const exact = getCatalogBodyPart(name);
  if (exact !== null) {
    return exact;
  }

  const index = findGuidedLibraryIndex(name, libraryNames);
  return index === null ? null : GENERATED_EXERCISE_LIBRARY[index].bodyPart;
}

/**
 * The library's own category for a name ("stretching", "strength", "cardio"…),
 * resolved through the same matcher as the body part.
 *
 * Worth having because the alternative is guessing from the name, and that
 * guess is wrong in both directions: "Child's Pose" and "Kneeling Hip Flexor"
 * carry no mobility word, while a "Standing Chest Stretch" prescribed as a
 * working set does. Returns null for names the library cannot place, so the
 * caller can decide what to do with a name it has never seen.
 */
export function resolveCatalogSourceCategory(name: string): string | null {
  const exact = byName.get(name.trim().toLowerCase());
  if (exact) {
    return exact.sourceCategory ?? null;
  }

  const index = findGuidedLibraryIndex(name, libraryNames);
  return index === null ? null : GENERATED_EXERCISE_LIBRARY[index].sourceCategory ?? null;
}

/**
 * Whether the logger should ask for a weight. Reading the catalog's own
 * equipment beats guessing from the name: "Butt Lift (Bridge)" matches no
 * bodyweight keyword but is bodyweight, and asking a bodyweight-only user for
 * kilograms is the specific failure this replaces.
 */
export function getCatalogTrackingMode(name: string): 'bodyweight' | 'load_and_reps' | 'hold' {
  // A hold is bodyweight too, so this has to be asked first or every plank
  // would come back as reps.
  if (isHoldExerciseName(name)) {
    return 'hold';
  }

  const key = name.trim().toLowerCase();
  // The app's own additions too: a fallback to "Band Curl" (filed bodyweight,
  // as every band movement is) was handed a weight dial because only the
  // generated list was asked (2026-09-26). Tracking only — body part and
  // category lookups stay on the generated list their areas are built from.
  const entry = byName.get(key) ?? extraByName.get(key);
  return entry?.equipment === 'bodyweight' ? 'bodyweight' : 'load_and_reps';
}

/**
 * Whether the ready programmes log a name with a weight, for every name they
 * prescribe. A name some rows load and others do not (a reverse lunge, a calf
 * raise) is loaded: a weight dial left at zero still records bodyweight work
 * truthfully, and a hidden one cannot record a weight that was lifted.
 */
const programmeLoadedByName = (() => {
  const loadedByName = new Map<string, boolean>();
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        const key = exercise.exerciseName.trim().toLowerCase();
        const loaded = !isUnloadedTrackingMode(exercise.trackingMode);
        loadedByName.set(key, (loadedByName.get(key) ?? false) || loaded);
      }
    }
  }
  return loadedByName;
})();

/**
 * How a lift is logged when it is swapped into a slot: the way the ready
 * programmes log it, and the library's answer (getCatalogTrackingMode) only
 * for a name no programme prescribes — one picked from the library's own list.
 *
 * The programmes answer first because a swap lands on their names: 226 of the
 * 283 names the swap groups offer are not spelled the library's way, so the
 * library says "load" for a pull-up by not finding it. The composer keeps
 * asking the library alone: its pools are curated against the library.
 *
 * On the library's word alone a loaded slot stays loaded. Its "bodyweight" was
 * the generator's fallback for any equipment it did not know, and that filed
 * the trap bar deadlift, the farmer's walk, the Svend press and the axle, car
 * and rickshaw deadlifts as bodyweight; a swap to one of them from the sheet's
 * library search hid the weight dial and saved 0 kg (CI review of #170). The
 * loaded ones are named in scripts/exercise-equipment-overrides.json now
 * (2026-09-21), but the fallback still decides for every name that list does
 * not reach, so the rule stays. The two mistakes do not cost the same. A dial shown for bodyweight work is left at
 * zero; a dial hidden for a loaded lift loses the weight. So the library may
 * move a slot to loaded, never away from it; the programmes' own answer, and
 * the hold list's seconds, still decide both ways.
 */
function swappedInTrackingMode(
  name: string,
  current: WorkoutTrackingMode,
): 'bodyweight' | 'load_and_reps' | 'hold' {
  if (isHoldExerciseName(name)) {
    return 'hold';
  }
  const programmeLoaded = programmeLoadedByName.get(name.trim().toLowerCase());
  if (programmeLoaded !== undefined) {
    return programmeLoaded ? 'load_and_reps' : 'bodyweight';
  }
  const library = getCatalogTrackingMode(name);
  return library === 'bodyweight' && !isUnloadedTrackingMode(current) ? 'load_and_reps' : library;
}

/**
 * The tracking mode a slot takes on when another lift is swapped into it.
 *
 * The slot's mode is how the lift it was PROGRAMMED with is logged, and a swap
 * used to keep it: a pull-up swapped for a lat pulldown kept "bodyweight", so
 * the set screen hid the weight dial and the pulldown was saved as 0 kg × 12;
 * a glute bridge hold swapped for a barbell hip thrust kept "hold", and its
 * dial counted seconds (swap audit, 2026-09-21). One rule for both places a
 * swap is made — the player's sheet and Home before the start.
 *
 * Only the kind of set changes hands: when the lift coming in is logged the
 * same way as the slot already is, the slot's own mode stays.
 */
export function trackingModeAfterSwap(current: WorkoutTrackingMode, exerciseName: string): WorkoutTrackingMode {
  const incoming = swappedInTrackingMode(exerciseName, current);
  const sameKind =
    isUnloadedTrackingMode(incoming) === isUnloadedTrackingMode(current) &&
    isTimedTrackingMode(incoming) === isTimedTrackingMode(current);
  return sameKind ? current : incoming;
}

export interface SwapPrescription {
  repsMin: number;
  repsMax: number;
}

function middle<T>(items: T[], by: (item: T) => number): T | null {
  if (items.length === 0) {
    return null;
  }
  const sorted = [...items].sort((left, right) => by(left) - by(right));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * What the ready programmes prescribe: the middle of the rows that write each
 * name (by their top number, so the pair stays one row's pair), and the middle
 * timed and counted rows over all of them, for a name none of them writes.
 */
const programmePrescriptions = (() => {
  const rowsByName = new Map<string, SwapPrescription[]>();
  const timed: SwapPrescription[] = [];
  const counted: SwapPrescription[] = [];
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        const row = { repsMin: exercise.repsMin, repsMax: exercise.repsMax };
        const key = exercise.exerciseName.trim().toLowerCase();
        const rows = rowsByName.get(key) ?? [];
        rows.push(row);
        rowsByName.set(key, rows);
        (isTimedTrackingMode(exercise.trackingMode) ? timed : counted).push(row);
      }
    }
  }
  const byName = new Map<string, SwapPrescription>();
  rowsByName.forEach((rows, key) => byName.set(key, middle(rows, (row) => row.repsMax)!));
  return {
    byName,
    timed: middle(timed, (row) => row.repsMax) ?? { repsMin: 30, repsMax: 30 },
    counted: middle(counted, (row) => row.repsMax) ?? { repsMin: 10, repsMax: 10 },
  };
})();

/**
 * The numbers a slot asks for after a swap that turns seconds into
 * repetitions, or repetitions into seconds.
 *
 * A slot's numbers are written in its programmed lift's unit, and a swap that
 * keeps the unit keeps them — same sets, same reps, same slot. Across the
 * unit they mean nothing: a 60-second glute bridge hold swapped for a barbell
 * hip thrust opened the reps dial at 60, and a hip thrust at 10 swapped for a
 * hold asked for 10 seconds (review of this change). There, the incoming
 * lift's own prescription is used — as the programmes write it, or, for a
 * name none of them writes, as they write that kind of set.
 */
export function prescriptionAfterSwap(
  from: WorkoutTrackingMode,
  to: WorkoutTrackingMode,
  current: SwapPrescription,
  exerciseName: string,
): SwapPrescription {
  if (isTimedTrackingMode(from) === isTimedTrackingMode(to)) {
    return current;
  }
  return (
    programmePrescriptions.byName.get(exerciseName.trim().toLowerCase()) ??
    (isTimedTrackingMode(to) ? programmePrescriptions.timed : programmePrescriptions.counted)
  );
}

/** Bodyweight-first, then the loaded version. Both are real catalog entries. */
export interface FocusAccessoryPool {
  bodyweight: string[];
  loaded: string[];
}

export const FOCUS_ACCESSORY_POOL: Record<SetupFocusArea, FocusAccessoryPool> = {
  chest: {
    bodyweight: ['Push-Up Wide', 'Incline Push-Up'],
    loaded: ['Incline Dumbbell Press', 'Dumbbell Flyes'],
  },
  back: {
    bodyweight: ['Inverted Row', 'Bodyweight Mid Row'],
    loaded: ['Close-Grip Front Lat Pulldown', 'Bent Over Two-Dumbbell Row'],
  },
  shoulders: {
    // "Alternating Deltoid Raise" is a dumbbell lift whose name never says so,
    // which means the gear filter cannot see what it needs. Keep names the
    // equipment rules can read.
    bodyweight: ['Band Pull Apart', 'Arm Circles'],
    loaded: ['Arnold Dumbbell Press', 'Cable Rear Delt Fly'],
  },
  arms: {
    bodyweight: ['Bench Dips', 'Body-Up'],
    loaded: ['Alternate Hammer Curl', 'Triceps Pushdown'],
  },
  core: {
    bodyweight: ['Plank', 'Dead Bug'],
    loaded: ['Cable Crunch', 'Hanging Leg Raise'],
  },
  quads: {
    bodyweight: ['Bodyweight Squat', 'Bodyweight Walking Lunge'],
    loaded: ['Leg Press', 'Dumbbell Lunges'],
  },
  glutes: {
    bodyweight: ['Butt Lift (Bridge)', 'Glute Kickback'],
    loaded: ['Barbell Hip Thrust', 'One-Legged Cable Kickback'],
  },
  hamstrings: {
    bodyweight: ['Floor Glute-Ham Raise', 'Band Good Morning'],
    loaded: ['Romanian Deadlift', 'Glute Ham Raise'],
  },
  calves: {
    bodyweight: ['Donkey Calf Raises', 'Calf Raises - With Bands'],
    loaded: ['Seated Calf Raise', 'Calf Press'],
  },
  legs: {
    bodyweight: ['Bodyweight Squat', 'Bodyweight Walking Lunge'],
    loaded: ['Leg Press', 'Dumbbell Lunges'],
  },
  mobility: {
    bodyweight: ['Cat Stretch', 'All Fours Quad Stretch'],
    loaded: ['Cat Stretch', 'All Fours Quad Stretch'],
  },
  conditioning: {
    // Not "Air Bike" — in this catalog that is the ab exercise, not a fan bike.
    bodyweight: ['Mountain Climbers', 'Battling Ropes'],
    loaded: ['Elliptical Trainer', 'Jogging, Treadmill'],
  },
  bodyweight: {
    bodyweight: ['Push-Up Wide', 'Plank'],
    loaded: ['Push-Up Wide', 'Plank'],
  },
};

/**
 * Which catalog body parts a focus area is about. Used to land an accessory on
 * a day that already trains it — a glute accessory belongs on leg day, not on
 * the upper-body day the round-robin happened to reach.
 */
export const FOCUS_AREA_BODY_PARTS: Record<SetupFocusArea, string[]> = {
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  arms: ['biceps', 'triceps'],
  core: ['core'],
  quads: ['legs'],
  glutes: ['glutes', 'legs'],
  hamstrings: ['legs', 'glutes'],
  calves: ['legs'],
  legs: ['legs', 'glutes'],
  mobility: [],
  conditioning: [],
  bodyweight: [],
};

/**
 * How much of a session already trains this area. Zero means no signal, not a
 * ban — mobility and conditioning match nothing and may go anywhere.
 */
export function sessionFocusAffinity(exerciseNames: string[], area: SetupFocusArea) {
  const parts = FOCUS_AREA_BODY_PARTS[area] ?? [];
  if (parts.length === 0) {
    return 0;
  }
  return exerciseNames.filter((name) => {
    const bodyPart = resolveCatalogBodyPart(name);
    return bodyPart !== null && parts.includes(bodyPart);
  }).length;
}

/**
 * Exercises for the optional days that pad a template out to the requested day
 * count. Short on purpose — these days are 25–30 minute add-ons.
 */
export const SUPPLEMENTAL_DAY_POOL = {
  accessoryStrength: {
    bodyweight: ['Bench Dips', 'Inverted Row', 'Plank'],
    loaded: ['Alternate Hammer Curl', 'Triceps Pushdown', 'Cable Crunch'],
  },
  recoveryStrength: {
    // Not the farmer's walk here: it carries a weight, and this variant is the
    // plan for someone with no equipment. The library filed it as bodyweight
    // until 2026-09-21, which is how it got in.
    bodyweight: ['Cat Stretch', 'Butt Lift (Bridge)'],
    loaded: ['Cat Stretch', "Farmer's Walk"],
  },
  easyRun: {
    bodyweight: ['Trail Running/Walking', 'Ankle Circles'],
    loaded: ['Jogging, Treadmill', 'Ankle Circles'],
  },
  longRun: {
    bodyweight: ['Trail Running/Walking', 'All Fours Quad Stretch'],
    loaded: ['Trail Running/Walking', 'All Fours Quad Stretch'],
  },
  bodyweightVolume: {
    bodyweight: ['Push-Up Wide', 'Bodyweight Walking Lunge', 'Plank'],
    loaded: ['Push-Up Wide', 'Bodyweight Walking Lunge', 'Plank'],
  },
  conditioningMobility: {
    bodyweight: ['Mountain Climbers', 'Cat Stretch'],
    loaded: ['Elliptical Trainer', 'Cat Stretch'],
  },
  recoveryMobility: {
    bodyweight: ['Cat Stretch', 'Plank'],
    loaded: ['Cat Stretch', 'Plank'],
  },
  easyConditioning: {
    bodyweight: ['Trail Running/Walking', 'Chin To Chest Stretch'],
    loaded: ['Recumbent Bike', 'Chin To Chest Stretch'],
  },
} satisfies Record<string, FocusAccessoryPool>;

export type SupplementalDayKind = keyof typeof SUPPLEMENTAL_DAY_POOL;

/**
 * `null` available equipment means the setup is unconstrained, so the loaded
 * version is fine. An empty list means the user told us they have nothing.
 */
export function pickPoolVariant(pool: FocusAccessoryPool, available: string[] | null) {
  if (available === null) {
    return pool.loaded;
  }
  if (available.length === 0) {
    return pool.bodyweight;
  }
  // Between the two, each loaded pick has to be one the reader's chips allow;
  // where it is not, the bodyweight pick in the same place stands in. Any chip
  // at all used to mean the loaded list whole, so a home rack's recovery day
  // was an elliptical trainer the equipment pass then removed — twice, on a
  // six-day week (coverage sweep, 2026-10-04).
  const picked = pool.loaded.map((name, index) =>
    isExerciseAllowedWithEquipment(name, available) ? name : pool.bodyweight[index] ?? name,
  );
  return [...new Set(picked)];
}
