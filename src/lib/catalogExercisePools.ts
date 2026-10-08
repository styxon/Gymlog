import { EXTRA_EXERCISE_LIBRARY } from '../data/extraExerciseLibrary';
import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import {
  isUnloadedTrackingMode,
  prescriptionUnitOf,
  WorkoutTrackingMode,
} from '../features/workout/workoutTypes';
import { findGuidedLibraryIndex } from './guidedPlayer';
import { DEFAULT_HOLD_SECONDS, isHoldExerciseName, isRepsStretchName } from './holdExercises';
import { DEFAULT_MINUTES_PRESCRIPTION, isMinutesExerciseName } from './minutesExercises';
import { exerciseNameLabel } from './exerciseNameLabel';
import { collapseRepRange } from './singleRepTarget';
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
 * The library row a name is, lower-cased — the identity two spellings of one
 * lift share. A ready template says "Hip Thrust" where the focus pools say
 * "Barbell Hip Thrust", and "Dumbbell Fly" where they say "Dumbbell Flyes";
 * the guided player opens the same exercise for both, so a day holding both
 * holds the lift twice. A name the library cannot place is its own identity.
 */
export function resolveCatalogLibraryKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const index = findGuidedLibraryIndex(name, libraryNames);
  return index === null ? trimmed : libraryNames[index].trim().toLowerCase();
}

/**
 * Whether two names are the one lift on a day: the same spelling, the same
 * library row, or the same English label (the rows the app itself renames,
 * such as "Butt Lift (Bridge)" and "Glute Bridge", are one lift to the reader).
 * Variants the library files apart (Barbell and Dumbbell Bench Press) stay apart.
 */
export function isSameCatalogMovement(left: string, right: string): boolean {
  if (left.trim().toLowerCase() === right.trim().toLowerCase()) {
    return true;
  }
  if (resolveCatalogLibraryKey(left) === resolveCatalogLibraryKey(right)) {
    return true;
  }
  return exerciseNameLabel('en', left).trim().toLowerCase() === exerciseNameLabel('en', right).trim().toLowerCase();
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
export function getCatalogTrackingMode(name: string): 'bodyweight' | 'load_and_reps' | 'hold' | 'duration_minutes' {
  // A hold is bodyweight too, so this has to be asked first or every plank
  // would come back as reps.
  if (isHoldExerciseName(name)) {
    return 'hold';
  }
  // A bike or a treadmill is filed as a machine, which would ask for a weight.
  if (isMinutesExerciseName(name)) {
    return 'duration_minutes';
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

let stapleLibraryNames: Set<string> | null = null;

/**
 * Whether a library row is a lift the ready programmes prescribe — resolved
 * the way the guided player resolves them, so "Back Squat" counts for the
 * library's "Barbell Full Squat" and "Leg Extension" for "Leg Extensions".
 *
 * The ready programmes are the app's own statement of what everyday training
 * is made of, which the library's 880 rows do not say anywhere: the swap
 * list ranks these first so the leg extension is not buried under 47 barbell
 * variants of the squat, snatch and clean when a squat is swapped (#bugs
 * 2026-10-06, "Reiden ojennus ei vieläkään"). Built on first use and kept.
 */
export function isCatalogStapleExercise(name: string | null | undefined): boolean {
  if (!name) {
    return false;
  }
  if (!stapleLibraryNames) {
    const names = [...libraryNames, ...EXTRA_EXERCISE_LIBRARY.map((entry) => entry.name)];
    const prescribed = new Set<string>();
    for (const template of WORKOUT_TEMPLATES_V1) {
      for (const session of template.sessions) {
        for (const exercise of session.exercises) {
          prescribed.add(exercise.exerciseName);
        }
      }
    }
    stapleLibraryNames = new Set();
    for (const prescribedName of prescribed) {
      const index = findGuidedLibraryIndex(prescribedName, names);
      if (index !== null) {
        stapleLibraryNames.add(names[index].trim().toLowerCase());
      }
    }
  }
  return stapleLibraryNames.has(name.trim().toLowerCase());
}

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
): 'bodyweight' | 'load_and_reps' | 'hold' | 'duration_minutes' {
  if (isHoldExerciseName(name)) {
    return 'hold';
  }
  if (isMinutesExerciseName(name)) {
    return 'duration_minutes';
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
    prescriptionUnitOf(incoming) === prescriptionUnitOf(current);
  return sameKind ? current : incoming;
}

export interface SwapPrescription {
  repsMin: number;
  repsMax: number;
}

interface ProgrammeRow extends SwapPrescription {
  sets: number;
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
  const rowsByName = new Map<string, ProgrammeRow[]>();
  const timed: ProgrammeRow[] = [];
  const minutes: ProgrammeRow[] = [];
  const counted: ProgrammeRow[] = [];
  for (const template of WORKOUT_TEMPLATES_V1) {
    for (const session of template.sessions) {
      for (const exercise of session.exercises) {
        const row = { sets: exercise.sets, repsMin: exercise.repsMin, repsMax: exercise.repsMax };
        const key = exercise.exerciseName.trim().toLowerCase();
        const rows = rowsByName.get(key) ?? [];
        rows.push(row);
        rowsByName.set(key, rows);
        const unit = prescriptionUnitOf(exercise.trackingMode);
        (unit === 'seconds' ? timed : unit === 'minutes' ? minutes : counted).push(row);
      }
    }
  }
  const byName = new Map<string, ProgrammeRow>();
  rowsByName.forEach((rows, key) => byName.set(key, middle(rows, (row) => row.repsMax)!));
  return {
    byName,
    timed: middle(timed, (row) => row.repsMax) ?? { sets: 3, repsMin: 30, repsMax: 30 },
    minutes: middle(minutes, (row) => row.repsMax) ?? {
      sets: DEFAULT_MINUTES_PRESCRIPTION.sets,
      repsMin: DEFAULT_MINUTES_PRESCRIPTION.minutes,
      repsMax: DEFAULT_MINUTES_PRESCRIPTION.minutes,
    },
    counted: middle(counted, (row) => row.repsMax) ?? { sets: 3, repsMin: 10, repsMax: 10 },
  };
})();

/** The row the programmes write for this name, or for its kind of set. */
function programmeRowFor(exerciseName: string, unit: ReturnType<typeof prescriptionUnitOf>): ProgrammeRow {
  return (
    programmePrescriptions.byName.get(exerciseName.trim().toLowerCase()) ??
    (unit === 'seconds'
      ? programmePrescriptions.timed
      : unit === 'minutes'
        ? programmePrescriptions.minutes
        : programmePrescriptions.counted)
  );
}

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
  const toUnit = prescriptionUnitOf(to);
  if (prescriptionUnitOf(from) === toUnit) {
    return current;
  }
  const { repsMin, repsMax } = programmeRowFor(exerciseName, toUnit);
  return { repsMin, repsMax };
}

/**
 * How many bouts a slot asks for once a lift timed in minutes takes the place
 * of one that was not: the count the programmes write beside the minutes
 * prescriptionAfterSwap gives it (one row's pair), and the slot's own count
 * for any other swap.
 *
 * A set count belongs to its unit as much as the reps do. SHRED's treadmill
 * HIIT at 8 × 30 s fell back to "Trail Running/Walking 8 × 5 min" with the
 * cardio machines unticked: forty minutes in place of eight, Day 1 at 80 min
 * against 45 (bug hunt, 2026-10-08).
 */
export function boutsAfterSwap(
  from: WorkoutTrackingMode,
  to: WorkoutTrackingMode,
  currentSets: number,
  exerciseName: string,
): number {
  const toUnit = prescriptionUnitOf(to);
  if (toUnit !== 'minutes' || prescriptionUnitOf(from) === toUnit) {
    return currentSets;
  }
  return programmeRowFor(exerciseName, toUnit).sets;
}

/** What workoutCatalog doses Cat Stretch at in its own mobility programmes. */
export const MOBILITY_REPS_DOSE = { reps: 6, maxSets: 3, restSecondsMin: 30, restSecondsMax: 45 } as const;

export interface ComposedSlotDose {
  sets: number;
  repsMin: number;
  repsMax: number;
  restSecondsMin: number;
  restSecondsMax: number;
}

/**
 * The numbers a slot the composer writes from a name alone asks for, in the
 * unit its tracking mode counts. `lift` is the sets and rest the caller gives
 * a slot of repetitions or seconds; a bout of minutes replaces them.
 *
 * - Minutes: one bout of DEFAULT_MINUTES_PRESCRIPTION, no rest.
 * - Seconds: a hold bracket — a plank's 20–40, else DEFAULT_HOLD_SECONDS.
 * - Reps: 10–15, collapsed to one number.
 * - A stretch moved through in reps (the cat-cow): the ready mobility
 *   programmes' dose, 6 reps on 30–45 s of rest and no more than 3 sets. A
 *   lift's 15 reps on a two-minute rest between cat-cows was the whole of a
 *   suggested recovery day (bug hunt, 2026-10-08).
 *
 * Focus emphasis and the suggested days both build slots this way. Emphasis
 * used to write "2 × 10–15" whatever the unit: an Elliptical Trainer was two
 * 15-minute bouts with a rest between, and a plank a 10–15 s hold, while a
 * suggested day wrote the same names as one 20-minute bout and 20–40 s (bug
 * hunt, 2026-10-07). Saved programmes prescribe one rep number, and the loader
 * collapses any range it finds (lib/singleRepTarget); the same function
 * decides here, so what is saved is what every later load reads.
 */
export function composedSlotDose(
  name: string,
  trackingMode: WorkoutTrackingMode,
  lift: { sets: number; restSecondsMin: number; restSecondsMax: number },
): ComposedSlotDose {
  const unit = prescriptionUnitOf(trackingMode);
  if (unit === 'minutes') {
    return {
      sets: DEFAULT_MINUTES_PRESCRIPTION.sets,
      repsMin: DEFAULT_MINUTES_PRESCRIPTION.minutes,
      repsMax: DEFAULT_MINUTES_PRESCRIPTION.minutes,
      restSecondsMin: 0,
      restSecondsMax: 0,
    };
  }
  if (unit === 'reps' && isRepsStretchName(name)) {
    return {
      sets: Math.min(lift.sets, MOBILITY_REPS_DOSE.maxSets),
      repsMin: MOBILITY_REPS_DOSE.reps,
      repsMax: MOBILITY_REPS_DOSE.reps,
      restSecondsMin: MOBILITY_REPS_DOSE.restSecondsMin,
      restSecondsMax: MOBILITY_REPS_DOSE.restSecondsMax,
    };
  }
  const plank = name.toLowerCase().includes('plank');
  const bracket =
    unit === 'seconds'
      ? plank
        ? { min: 20, max: 40 }
        : DEFAULT_HOLD_SECONDS
      : { min: 10, max: 15 };
  const reps = collapseRepRange({ name, repMin: bracket.min, repMax: bracket.max });
  return { ...lift, repsMin: reps.repMin, repsMax: reps.repMax };
}

/** Bodyweight-first, then the loaded version. Both are real catalog entries. */
export interface FocusAccessoryPool {
  bodyweight: string[];
  loaded: string[];
}

export const FOCUS_ACCESSORY_POOL: Record<SetupFocusArea, FocusAccessoryPool> = {
  chest: {
    bodyweight: ['Push-Up Wide', 'Incline Push-Up', 'Decline Push-Up'],
    loaded: ['Incline Dumbbell Press', 'Dumbbell Flyes', 'Cable Crossover'],
  },
  back: {
    bodyweight: ['Inverted Row', 'Bodyweight Mid Row', 'Superman'],
    loaded: ['Close-Grip Front Lat Pulldown', 'Bent Over Two-Dumbbell Row', 'Seated Cable Rows'],
  },
  shoulders: {
    // "Alternating Deltoid Raise" is a dumbbell lift whose name never says so,
    // which means the gear filter cannot see what it needs. Keep names the
    // equipment rules can read.
    bodyweight: ['Band Pull Apart', 'Arm Circles', 'Pike Push-Up'],
    loaded: ['Arnold Dumbbell Press', 'Cable Rear Delt Fly', 'Dumbbell Lying Rear Lateral Raise'],
  },
  arms: {
    bodyweight: ['Bench Dips', 'Body-Up'],
    loaded: ['Alternate Hammer Curl', 'Triceps Pushdown'],
  },
  core: {
    bodyweight: ['Plank', 'Dead Bug'],
    loaded: ['Cable Crunch', 'Hanging Leg Raise'],
  },
  // Each area keeps a reserve beyond what its emphasis promises: a ready
  // template often holds the lift a pool names under another spelling, and the
  // walk down the pool then needs something to land on. Bodyweight and loaded
  // lists stay the same length, so pickPoolVariant swaps them place for place.
  quads: {
    bodyweight: ['Bodyweight Squat', 'Bodyweight Walking Lunge', 'Step-up with Knee Raise'],
    loaded: ['Leg Press', 'Dumbbell Lunges', 'Leg Extensions'],
  },
  glutes: {
    // Not "Pull Through": it is a cable lift whose name never says so, which
    // the gear filter cannot read.
    bodyweight: ['Butt Lift (Bridge)', 'Glute Kickback', 'Standing Hip Abduction', 'Frog Pump'],
    loaded: ['Barbell Hip Thrust', 'One-Legged Cable Kickback', 'Cable Abductor', 'Barbell Glute Bridge'],
  },
  hamstrings: {
    bodyweight: ['Floor Glute-Ham Raise', 'Band Good Morning', 'Butt Lift (Bridge)'],
    loaded: ['Romanian Deadlift', 'Glute Ham Raise', 'Lying Leg Curls'],
  },
  calves: {
    // Not "Donkey Calf Raises": that one needs a machine (bug hunt, 2026-10-04).
    bodyweight: ['Bodyweight Calf Raise', 'Calf Raises - With Bands'],
    loaded: ['Seated Calf Raise', 'Calf Press'],
  },
  legs: {
    bodyweight: ['Bodyweight Squat', 'Bodyweight Walking Lunge', 'Step-up with Knee Raise'],
    loaded: ['Leg Press', 'Dumbbell Lunges', 'Leg Extensions'],
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
