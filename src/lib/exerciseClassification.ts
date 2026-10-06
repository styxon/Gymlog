/**
 * What kind of exercise a library row is — the one mapping every exercise
 * filter and row label reads.
 *
 * The library is free-exercise-db imported whole (scripts/
 * generate_free_exercise_library.mjs), and three of its fields answered the
 * filters wrongly (#bugs 2026-10-06, "kaikki filtterit uusiksi"):
 *
 * - `category` is "compound" for 214 lifts the source itself files as
 *   isolation — the generator calls every "strength" row compound before it
 *   reads the mechanic — so "Eristävä" never listed the leg extension, and
 *   rows said "Moninivel" under it.
 * - a handful of `primaryMuscles` are plain source errors: cable hip
 *   adduction is filed as a quadriceps lift, so "Etureidet" listed it.
 * - the strongman implements (car deadlift, Conan's wheel, tyres, stones,
 *   yokes) sit in the "machine" bucket, because the equipment chips have no
 *   better one, so "Laite" listed them among the leg presses.
 *
 * The type the reader sees and filters by is `exerciseTypeOf`, read from the
 * source's own mechanic. Since 2026-10-06 `category` agrees with it too:
 * `withLibraryCorrections` rewrites a compound/isolation category to the
 * source mechanic where the library is seeded, so custom programmes' role,
 * progression priority and rep defaults (getExerciseTemplateDefaults,
 * customWorkoutAdapter), the suggestions and the coach's plan read the same
 * answer as the chips — one truth, not one function every consumer has to
 * remember to call.
 */
import { displayEquipmentValue } from './libraryLabel';
import type { ExerciseLibraryItem } from '../types/models';

type ClassifiedExercise = Pick<ExerciseLibraryItem, 'name' | 'category'> &
  Partial<Pick<ExerciseLibraryItem, 'sourceCategory' | 'sourceMechanic'>>;

// ── specialty (strongman) movements ──────────────────────────────────────

/**
 * Strongman rows that are everyday gym work. Both are prescribed by a ready
 * programme (the guard in tests/lib/exerciseFilterInvariants.test.cjs holds
 * every prescribed lift out of the specialty list): farmer's walks need only
 * dumbbells or handles, and the push sled is on most gym floors.
 */
const EVERYDAY_STRONGMAN = new Set(["farmer's walk", 'sled push']);

/**
 * Implements a regular gym floor does not have, that the source files under
 * another category: the tyre-and-sledgehammer swing and the heavy bag. Both
 * sat in "Laite" beside the leg press.
 */
const SPECIALTY_OUTSIDE_STRONGMAN = new Set(['sledgehammer swings', 'heavy bag thrust']);

/**
 * A specialty movement: one that needs a strongman implement — a car, a
 * Conan's wheel, a tyre, stones, a yoke, a log, an axle, a keg, a harness
 * sled drag. "These are not machines, they are specialty movements that
 * should not be among normal exercises" (#bugs 2026-10-06).
 *
 * Hidden from every unsearched list and every equipment chip, offered by
 * their own type chip and by search. Never deleted: old logs and programmes
 * reference them by name.
 */
export function isSpecialtyExercise(item: Pick<ExerciseLibraryItem, 'name'> & Partial<Pick<ExerciseLibraryItem, 'sourceCategory'>>): boolean {
  const name = item.name.trim().toLowerCase();
  if (SPECIALTY_OUTSIDE_STRONGMAN.has(name)) {
    return true;
  }
  return item.sourceCategory?.trim().toLowerCase() === 'strongman' && !EVERYDAY_STRONGMAN.has(name);
}

// ── mechanic and type ────────────────────────────────────────────────────

export type ExerciseMechanic = 'compound' | 'isolation';

/**
 * Compound or isolation, as the source says it — the generator's `category`
 * folded every "strength" row into compound before reading this. Rows with
 * no source mechanic (the app's own extras, a few imports) keep their
 * category's answer; core and cardio rows without one have none.
 */
export function exerciseMechanic(item: ClassifiedExercise): ExerciseMechanic | null {
  const source = item.sourceMechanic?.trim().toLowerCase();
  if (source === 'compound' || source === 'isolation') {
    return source;
  }
  if (item.category === 'compound' || item.category === 'isolation') {
    return item.category;
  }
  return null;
}

// ── stretches ────────────────────────────────────────────────────────────

const STRETCH_NAME = /\bstretch(?:es|ing)?\b/i;
const FOAM_ROLLER_NAME = /-smr\b/i;

/**
 * A stretch: held or rolled, not repped — every row the source files as
 * "stretching" (Child's Pose, Arm Circles, the foam-roller "-SMR" rows among
 * them), and any row whose name says stretch or SMR (the app's own rows have
 * no source category).
 *
 * A type of its own, built like the specialty one (user, 2026-10-06): hidden
 * from every unsearched set list, offered by its own chip ("Venytykset") and
 * by search. Stretches a ready programme prescribes are found by name where
 * they are prescribed, as before.
 */
export function isStretchExercise(
  item: Pick<ExerciseLibraryItem, 'name'> & Partial<Pick<ExerciseLibraryItem, 'sourceCategory'>>,
): boolean {
  return (
    item.sourceCategory?.trim().toLowerCase() === 'stretching' ||
    STRETCH_NAME.test(item.name) ||
    FOAM_ROLLER_NAME.test(item.name)
  );
}

export type ExerciseType = ExerciseMechanic | 'cardio' | 'core' | 'stretch' | 'specialty';

/**
 * The type chip a row belongs to, exactly one: specialty first (a tyre flip
 * is not "Moninivel" for the purposes of a list), then stretch (a lying
 * hamstring stretch is not "Eristävä", and a core stretch is not core work),
 * then cardio and core as the library files them, then the mechanic.
 */
export function exerciseTypeOf(item: ClassifiedExercise): ExerciseType {
  if (isSpecialtyExercise(item)) {
    return 'specialty';
  }
  if (isStretchExercise(item)) {
    return 'stretch';
  }
  if (item.category === 'cardio' || item.category === 'core') {
    return item.category;
  }
  return exerciseMechanic(item) ?? 'compound';
}

/**
 * The values under a row's name, before labelling: body part · equipment ·
 * type. "Keskivartalo · Kehonpaino · Keskivartalo" printed the core body part
 * and the core category side by side (#bugs 2026-10-06); where the type
 * repeats the body part, the third slot says compound or isolation instead.
 */
export function exerciseRowMetaValues(
  item: ClassifiedExercise & Pick<ExerciseLibraryItem, 'bodyPart' | 'equipment'> & Partial<Pick<ExerciseLibraryItem, 'sourceEquipment'>>,
): string[] {
  // The three vocabularies only meet at "core" (a body part and a type), so
  // that is the one collision to step around; the suite checks every row.
  const type = exerciseTypeOf(item);
  const third = type === item.bodyPart ? exerciseMechanic(item) : type;
  const values: Array<string | null> = [item.bodyPart, displayEquipmentValue(item), third];
  return values.filter((value): value is string => Boolean(value));
}

// ── source corrections ───────────────────────────────────────────────────

/**
 * Muscles the source files wrongly, by library name. Each keeps the row's
 * body part (all four are leg lifts either way), so the catalog's body-part
 * lookups, which read the generated list directly, agree with the app's.
 *
 * - Cable hip adduction is an adductor lift; the source says quadriceps, so
 *   "Etureidet" listed it (#bugs 2026-10-06).
 * - The cable and one-arm side deadlifts are hinges, filed with the app's
 *   other deadlifts (Romanian, stiff-legged, sumo) under the hamstrings —
 *   "Maastaveto taljassa" in "Etureidet" was in the same report. The trap bar
 *   and leverage deadlifts stay quadriceps lifts: the knee-dominant
 *   squat–deadlift hybrid is what they are for.
 * - The lunge pass-through is a lunge, and every other lunge is a
 *   quadriceps lift.
 */
const MUSCLE_CORRECTIONS: Record<string, Pick<ExerciseLibraryItem, 'primaryMuscles' | 'secondaryMuscles'>> = {
  'Cable Hip Adduction': { primaryMuscles: ['adductors'], secondaryMuscles: [] },
  'Cable Deadlifts': {
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['forearms', 'glutes', 'lower back', 'quadriceps'],
  },
  'One-Arm Side Deadlift': {
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['abdominals', 'calves', 'glutes', 'lower back', 'quadriceps', 'traps'],
  },
  'Lunge Pass Through': { primaryMuscles: ['quadriceps'], secondaryMuscles: ['calves', 'glutes', 'hamstrings'] },
};

/**
 * Mechanics the source files wrongly — found by the name sweep in
 * tests/lib/librarySweep.test.cjs, which lists the rows it lets stand.
 *
 * - Two rows are rows: a kettlebell row and a lying cambered-bar row pull
 *   with the elbow and the shoulder, as every other row in the source does.
 * - Flyes, crossovers, curls and the glute kickback move one joint. The
 *   source calls these eight compound while it calls every other fly, curl
 *   and kickback isolation, so "Eristävä" missed them and a custom programme
 *   gave them a squat's defaults.
 *
 * Set on `sourceMechanic`, the field every reader of the mechanic asks first
 * (exerciseMechanic), so the category below and the detail card follow.
 */
const MECHANIC_CORRECTIONS: Record<string, ExerciseMechanic> = {
  'Alternating Kettlebell Row': 'compound',
  'Lying Cambered Barbell Row': 'compound',
  'Back Flyes - With Bands': 'isolation',
  'Cross Over - With Bands': 'isolation',
  'Decline Dumbbell Flyes': 'isolation',
  'Incline Dumbbell Flyes': 'isolation',
  'Incline Dumbbell Flyes - With A Twist': 'isolation',
  'Drag Curl': 'isolation',
  'High Cable Curls': 'isolation',
  'Glute Kickback': 'isolation',
};

/**
 * Equipment the source files wrongly. The Smith incline shoulder raise is
 * done on the Smith machine (its first step), and the source calls it a
 * barbell lift; every other Smith row is "machine".
 */
const EQUIPMENT_CORRECTIONS: Record<string, ExerciseLibraryItem['equipment']> = {
  'Smith Incline Shoulder Raise': 'machine',
};

function rowCorrection(name: string): Partial<ExerciseLibraryItem> | null {
  const muscles = MUSCLE_CORRECTIONS[name];
  const mechanic = MECHANIC_CORRECTIONS[name];
  const equipment = EQUIPMENT_CORRECTIONS[name];
  if (!muscles && !mechanic && !equipment) {
    return null;
  }
  return {
    ...muscles,
    ...(mechanic ? { sourceMechanic: mechanic } : null),
    ...(equipment ? { equipment } : null),
  };
}

/**
 * The stored category with the source's mechanic read into it.
 *
 * The generator (scripts/generate_free_exercise_library.mjs, `mapCategory`)
 * calls every "strength", "powerlifting" and "strongman" row compound before
 * it reads the mechanic, so 214 isolation lifts — the leg extension, every
 * curl, lateral raise and fly — were stored as compound. Custom programmes
 * read the category for their defaults: a leg extension added to your own
 * programme started at 3 × 6–8 with the full compound rest, as if it were a
 * squat (#bugs 2026-10-06). Core and cardio are body-part answers the
 * mechanic does not overrule; a row with no source mechanic keeps its own.
 */
function correctedCategory(item: ExerciseLibraryItem): ExerciseLibraryItem['category'] {
  if (item.category !== 'compound' && item.category !== 'isolation') {
    return item.category;
  }
  const source = item.sourceMechanic?.trim().toLowerCase();
  return source === 'compound' || source === 'isolation' ? source : item.category;
}

/**
 * The library as the app reads it: the generated rows with the corrections
 * above. Applied where the library is seeded (data/seed.ts) and again over a
 * stored library row on load (storage/database.ts), so every screen — chips,
 * swap list, detail card, a custom programme's defaults — reads the same
 * muscles and the same mechanic. Idempotent.
 */
export function withLibraryCorrections<T extends ExerciseLibraryItem>(items: readonly T[]): T[] {
  return items.map((item) => {
    const correction = rowCorrection(item.name);
    const corrected: T = correction ? { ...item, ...correction } : item;
    const category = correctedCategory(corrected);
    const bodyPart = correctedBodyPart(corrected);
    if (!correction && category === item.category && bodyPart === item.bodyPart) {
      return item;
    }
    return { ...corrected, category, bodyPart };
  });
}

/**
 * The neck, filed with the back. The generator has no body part for a neck
 * lift and files all eight under "full body", so "Koko keho" was six neck
 * exercises and two whole-body ones (picker audit, 2026-10-06). The app files
 * the traps — the shrugs — under the back, and the neck work is their
 * neighbour; a body part of its own would be a new stored value and a chip
 * for five lifts.
 */
function correctedBodyPart(item: ExerciseLibraryItem): ExerciseLibraryItem['bodyPart'] {
  const muscles = item.primaryMuscles ?? [];
  return item.bodyPart === 'full body' && muscles.length > 0 && muscles.every((muscle) => muscle === 'neck')
    ? 'back'
    : item.bodyPart;
}
