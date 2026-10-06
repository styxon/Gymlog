import { I18nKey, t } from './i18n';
import type { AppLanguage, ExerciseEquipment } from '../types/models';

/**
 * Body parts, equipment, categories, muscles and levels, in the reader's
 * language.
 *
 * These strings arrive from the generated library as lowercase English keys
 * and used to be title-cased on the way to the screen — so every filter chip
 * and card subtitle read "Back", "Chest", "Bodyweight" no matter the app's
 * language. The muscle names went the same way for longer: the exercise detail
 * card and the how-to sheet showed "Quadriceps" and "Hamstrings" in a Finnish
 * app because nothing ever mapped them.
 *
 * This lives in lib/ rather than beside one screen because more than one
 * surface renders them now: the library browser, the records list, the
 * template editor, the exercise detail card. Two copies of the map is two
 * places for a body part to stay English.
 */
const LIBRARY_LABEL_KEYS: Record<string, I18nKey> = {
  all: 'lib.bodyPart.all',
  back: 'lib.bodyPart.back',
  biceps: 'lib.bodyPart.biceps',
  chest: 'lib.bodyPart.chest',
  core: 'lib.bodyPart.core',
  'full body': 'lib.bodyPart.fullBody',
  glutes: 'lib.bodyPart.glutes',
  legs: 'lib.bodyPart.legs',
  shoulders: 'lib.bodyPart.shoulders',
  triceps: 'lib.bodyPart.triceps',
  barbell: 'lib.equipment.barbell',
  bodyweight: 'lib.equipment.bodyweight',
  cable: 'lib.equipment.cable',
  dumbbell: 'lib.equipment.dumbbell',
  machine: 'lib.equipment.machine',
  cardio: 'lib.category.cardio',
  compound: 'lib.category.compound',
  isolation: 'lib.category.isolation',
  // Not a stored category: the type exerciseTypeOf gives a strongman row.
  specialty: 'lib.category.specialty',
  // primaryMuscles / secondaryMuscles — the source's seventeen muscle names.
  // Body-part words that double as muscle names (chest, glutes, shoulders,
  // biceps, triceps) already resolve above.
  abdominals: 'lib.muscle.abdominals',
  abductors: 'lib.muscle.abductors',
  adductors: 'lib.muscle.adductors',
  calves: 'lib.muscle.calves',
  forearms: 'lib.muscle.forearms',
  hamstrings: 'lib.muscle.hamstrings',
  lats: 'lib.muscle.lats',
  'lower back': 'lib.muscle.lowerBack',
  'middle back': 'lib.muscle.middleBack',
  neck: 'lib.muscle.neck',
  quadriceps: 'lib.muscle.quadriceps',
  traps: 'lib.muscle.traps',
  // sourceEquipment — the raw source field the detail card prefers over the
  // normalised `equipment`, because it keeps kettlebells and bands apart from
  // "other".
  bands: 'lib.equipment.bands',
  'body only': 'lib.equipment.bodyOnly',
  'e-z curl bar': 'lib.equipment.ezCurlBar',
  'exercise ball': 'lib.equipment.exerciseBall',
  'foam roll': 'lib.equipment.foamRoll',
  kettlebells: 'lib.equipment.kettlebells',
  // Not a source value: the display bucket for medicine and exercise balls
  // (displayEquipmentValue), one chip for both.
  ball: 'lib.equipment.ball',
  'medicine ball': 'lib.equipment.medicineBall',
  other: 'lib.equipment.other',
  // sourceLevel — three source levels onto the app's own three-step scale
  // (Amateur / Advanced / Pro, deliberately English everywhere), so the detail
  // card does not introduce a fourth word for the middle step.
  beginner: 'myData.level.beginner',
  intermediate: 'myData.level.advanced',
  advanced: 'myData.level.advanced',
  expert: 'myData.level.pro',
};

/**
 * The equipment value a library row should show — not the label, because two
 * surfaces label it from two different dictionaries (`lib.equipment.*` here,
 * `facet.*` in AddExerciseSheet) and unifying those would silently reword four
 * existing chips. One rule, each caller's own words.
 *
 * The generated library has five buckets — the stored `ExerciseEquipment`,
 * which is also what tracking reads (a "bodyweight" row logs reps with no
 * weight dial, and a band row should). As a filing decision that is fine. As
 * a sentence it is not:
 *
 * - `mapEquipment` in scripts/generate_free_exercise_library.mjs files all 53
 *   kettlebell exercises under `dumbbell`, and a row that reads "Käsipainot"
 *   under an exercise whose every step says kahvakuula tells the reader
 *   something untrue about what to pick up off the rack.
 * - it files every band, medicine-ball, exercise-ball and foam-roller row
 *   under `bodyweight`, so "Kehonpaino" listed 20 band, 16 medicine-ball and
 *   10 exercise-ball rows among the push-ups (#bugs 2026-10-06). Kehonpaino
 *   is what needs nothing in your hands; these say what they need.
 *
 * So this reads the source field for those cases and only those. A band or a
 * ball the source files as "other" or "body only" (the band-assisted pull-up,
 * the crunch with legs on an exercise ball) is read off the name, as are the
 * foam-roller rows the source calls "other" ("Neck-SMR"). A general
 * `sourceEquipment ?? equipment` is worse, not better: it turns 199
 * bodyweight rows into "Other" and "Body only". The detail card does prefer
 * the source field, deliberately — it has room to be specific, a list row
 * does not — so the two rules are different on purpose and should not be
 * merged.
 */
export type DisplayEquipmentValue = ExerciseEquipment | 'kettlebells' | 'bands' | 'ball' | 'foam roll';

const BAND_IN_NAME = /\bbands?\b/i;
/** The iliotibial band is a body part, not a piece of kit. */
const NOT_A_BAND = /\bit band\b/i;
const BALL_IN_NAME = /\b(?:exercise|stability|medicine|swiss) ball\b|\bphysioball\b/i;
const FOAM_ROLLER_IN_NAME = /-smr\b/i;

export function displayEquipmentValue(item: {
  name?: string;
  equipment: ExerciseEquipment;
  sourceEquipment?: string | null;
}): DisplayEquipmentValue {
  const source = item.sourceEquipment?.trim().toLowerCase();
  if (source === 'kettlebells') {
    return 'kettlebells';
  }
  // A loaded row keeps its bucket: "Squat with Bands" is a barbell lift with
  // bands on the bar, and the weighted ball side bend is held with a dumbbell.
  if (item.equipment !== 'bodyweight') {
    return item.equipment;
  }
  const name = item.name ?? '';
  if (source === 'bands' || (BAND_IN_NAME.test(name) && !NOT_A_BAND.test(name))) {
    return 'bands';
  }
  if (source === 'medicine ball' || source === 'exercise ball' || BALL_IN_NAME.test(name)) {
    return 'ball';
  }
  if (source === 'foam roll' || FOAM_ROLLER_IN_NAME.test(name)) {
    return 'foam roll';
  }
  return 'bodyweight';
}

export function libraryLabel(raw: string, language: AppLanguage = 'en'): string {
  const key = LIBRARY_LABEL_KEYS[raw.trim().toLowerCase()];
  if (key) {
    return t(language, key);
  }
  // Anything the data adds later reads as itself rather than as nothing.
  return raw
    .split(/[_\s/()-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
