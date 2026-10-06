/**
 * What the exercise picker offers before the reader has said what they want.
 *
 * The library is 873 entries wide because it was imported whole, and about
 * sixty of them are not things you log a set of: hamstring stretches, cone
 * drills, and the "(single response)" / "(multiple response)" plyometric test
 * protocols. Filtering by chest handed back "Behind Head Chest Stretch" and
 * "Chest Push from 3 point stance" alongside the bench press, and the reader
 * had to read past them to build a day ("vaikka filtteröin rinta niin ihan
 * ihme liikkeitä tulee esiin", #bugs 2026-08-26).
 *
 * They are hidden rather than deleted. A stretch is still a real thing someone
 * might want to find, and deleting the row would orphan any programme or log
 * that already points at it — so it stays in the library, stays resolvable by
 * name, and comes back the moment the reader types a query. The rule is about
 * what is *offered*, not what exists.
 */
import { ExerciseBodyPart, ExerciseEquipment, ExerciseLibraryItem } from '../types/models';
import { ExerciseType, exerciseTypeOf, isSpecialtyExercise } from './exerciseClassification';
import { displayEquipmentValue } from './libraryLabel';

type BrowsableExercise = Pick<ExerciseLibraryItem, 'name'> & Partial<Pick<ExerciseLibraryItem, 'sourceCategory'>>;

/**
 * Deliberately narrow. Each pattern names a family that is measured in held
 * seconds, ground covered or reps-against-a-clock rather than in sets — never
 * a family that merely sounds unusual.
 *
 * `\bdrag\b` is absent on purpose: the drag curl is a barbell biceps lift, and
 * a rule that catches it to also catch sled drags costs more than it saves.
 * Sled and Bosu work stays for the same reason — people load and log both.
 */
const NOT_A_LOGGED_SET: RegExp[] = [
  // Mobility. Held, not repped.
  /\bstretch(?:es|ing)?\b/i,
  // Lab protocols from the source data's plyometric section.
  /\((?:multiple|single) response\)/i,
  // Field drills: the equipment is a cone, and the unit is a run.
  /\bcone\b/i,
  /\bhurdle hops\b/i,
  /\bsprint\b/i,
];

/** True when the exercise belongs in the picker's default listing. */
export function isBrowsableExercise(item: BrowsableExercise): boolean {
  return !NOT_A_LOGGED_SET.some((pattern) => pattern.test(item.name));
}

/**
 * The picker's list.
 *
 * With a query the reader has named what they are after, so nothing is
 * withheld — searching "stretch" or "venytys" finds the stretches, and
 * "autonnosto" finds the car deadlift. With no query the app is the one
 * choosing, and it chooses the things you can log, among normal exercises:
 * the specialty (strongman) movements come only with their own type chip
 * (`type: 'specialty'`), never mixed into a body part or "Laite" (#bugs
 * 2026-10-06).
 */
export function filterBrowsableExercises<T extends BrowsableExercise>(
  items: T[],
  options?: BrowseOptions,
): T[] {
  if (options?.query?.trim()) {
    return items;
  }

  return items.filter((item) => isBrowsableExercise(item) && passesSpecialtyGate(item, options));
}

type BrowseOptions = { query?: string; type?: ExerciseTypeFilter | string };

/**
 * The specialty half of the rule on its own, for the library screen, which
 * lists stretches on purpose (it is where you learn them) but mixes the
 * strongman implements into nothing either: shown under a query or their own
 * type chip, hidden otherwise.
 */
export function passesSpecialtyGate(item: BrowsableExercise, options?: BrowseOptions): boolean {
  return Boolean(options?.query?.trim()) || options?.type === 'specialty' || !isSpecialtyExercise(item);
}

/**
 * The type chips: what kind of lift, one chip per row (exerciseTypeOf).
 * Compound and isolation are read from the source's mechanic, not the stored
 * category — "Eristävä" did not list the leg extension.
 */
export type ExerciseTypeFilter = 'all' | ExerciseType;

export const EXERCISE_TYPE_FILTERS: ExerciseTypeFilter[] = ['all', 'compound', 'isolation', 'cardio', 'core', 'specialty'];

export function matchesExerciseTypeFilter(
  item: Parameters<typeof exerciseTypeOf>[0],
  filter: ExerciseTypeFilter | string,
): boolean {
  return filter === 'all' || exerciseTypeOf(item) === filter;
}

/**
 * `kettlebells` is not an `ExerciseEquipment` — the library files kettlebells
 * under `dumbbell` — but it is what `displayEquipmentValue` prints on the row,
 * and a chip set that cannot select what the rows say is a filter that argues
 * with its own list. Widened here rather than in the union, because the union
 * is the storage and planning vocabulary and a sixth value there would have to
 * be threaded through the coach's allowed-equipment sets too.
 */
export type EquipmentFilter = 'all' | ExerciseEquipment | 'kettlebells';

export const EQUIPMENT_FILTERS: EquipmentFilter[] = [
  'all',
  'barbell',
  'dumbbell',
  'kettlebells',
  'machine',
  'cable',
  'bodyweight',
];

/**
 * An equipment chip lists what the row prints as its equipment — and never a
 * specialty movement. The car deadlift and Conan's wheel are filed under
 * "machine" for want of a better bucket; "Laite" listed them among the leg
 * presses ("nämä eivät ole laitteita", #bugs 2026-10-06).
 */
export function matchesEquipmentFilter(
  item: BrowsableExercise & Pick<ExerciseLibraryItem, 'equipment'> & Partial<Pick<ExerciseLibraryItem, 'sourceEquipment'>>,
  filter: EquipmentFilter | string,
): boolean {
  if (filter === 'all') {
    return true;
  }
  return !isSpecialtyExercise(item) && displayEquipmentValue(item) === filter;
}

/**
 * The picker's body-part chips.
 *
 * The stored body parts are coarse: "legs" is 276 lifts, quad, hamstring and
 * calf work in one list, so a reader building a day called "Etureidet ja
 * takareidet" had to read through all of it. The three leg muscles are chips
 * of their own, answered by the lift's primary muscles; the rest are the
 * stored body part. Biceps and triceps were in the library all along and only
 * missing from the chips ("laajennetaan kehonosaa hauis ojentaja yms", #bugs
 * 2026-09-28).
 */
export type BodyPartFilter = 'all' | ExerciseBodyPart | LegMuscleFilter;

// One list, and the type read off it, so a muscle cannot be a chip without
// being answered by its muscles. Exported for the swap sheet's browse
// prefilter (swapBrowsePrefilter.ts), which needs the same three names to
// decide whether a leg exercise preselects a muscle chip or the plain "Legs"
// one — a second copy of this list would drift the day either one changes.
export const LEG_MUSCLE_FILTERS = ['quadriceps', 'hamstrings', 'calves'] as const;

type LegMuscleFilter = (typeof LEG_MUSCLE_FILTERS)[number];

function isLegMuscleFilter(filter: BodyPartFilter): filter is LegMuscleFilter {
  return (LEG_MUSCLE_FILTERS as readonly string[]).includes(filter);
}

/** In reading order: the big groups, the arms after the shoulders, the legs split after "legs". */
export const BODY_PART_FILTERS: BodyPartFilter[] = [
  'all',
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'quadriceps',
  'hamstrings',
  'calves',
  'glutes',
  'core',
  'full body',
];

/**
 * A muscle chip lists the lifts that train the muscle. The source also names
 * a primary muscle for its cardio machines and its stretches — the treadmill,
 * the stationary bike and the kneeling hip-flexor stretch are all
 * "quadriceps" — and none of them is a swap for a squat.
 */
function trainsTheMuscle(item: Partial<Pick<ExerciseLibraryItem, 'category' | 'sourceCategory'>>): boolean {
  return item.category !== 'cardio' && item.sourceCategory?.trim().toLowerCase() !== 'stretching';
}

export function matchesBodyPartFilter(
  item: Pick<ExerciseLibraryItem, 'bodyPart' | 'primaryMuscles'> &
    Partial<Pick<ExerciseLibraryItem, 'category' | 'sourceCategory'>>,
  filter: BodyPartFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }
  if (isLegMuscleFilter(filter)) {
    return (item.primaryMuscles ?? []).includes(filter) && trainsTheMuscle(item);
  }
  return item.bodyPart === filter;
}
