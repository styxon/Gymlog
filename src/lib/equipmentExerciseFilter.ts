import { EXTRA_EXERCISE_LIBRARY } from '../data/extraExerciseLibrary';
import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { isMinutesTrackingMode, WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { getCatalogTrackingMode, prescriptionAfterSwap } from './catalogExercisePools';
import { DisplayEquipmentValue, displayEquipmentValue } from './libraryLabel';

/**
 * Equipment chips filter the actual exercises (onboarding truth plan P4).
 *
 * The chips chosen on step 1 (`selection.equipmentItems`) are the complete set
 * of available gear. Exercises whose requirements aren't met swap to the first
 * fallback the gear allows, or drop when nothing honest remains. Name-based,
 * grounded in the catalog + chip labels, so composed and custom programs
 * behave the same.
 */

type RequirementGroup = string[]; // any-of

interface EquipmentRule {
  pattern: string;
  /**
   * Match the whole name, not a part of it. "Deadlift" is a barbell lift but
   * "Single-Leg Romanian Deadlift" is done with nothing, and a substring rule
   * cannot tell them apart.
   */
  exact?: boolean;
  /**
   * Names containing any of these are not this rule's business: "IT Band and
   * Glute Stretch" has no resistance band in it, and "Nordic Hamstring Curl"
   * is a curl of the body, not of a weight.
   */
  unless?: string[];
  /** Every group must be satisfied by at least one available item. */
  requires: RequirementGroup[];
}

/** Whether a rule speaks about this (trimmed, lower-cased) exercise name. */
export function equipmentRuleMatches(
  normalizedName: string,
  rule: { pattern: string; exact?: boolean; unless?: string[] },
): boolean {
  if (rule.unless?.some((exception) => normalizedName.includes(exception))) {
    return false;
  }
  return rule.exact ? normalizedName === rule.pattern : normalizedName.includes(rule.pattern);
}

const BARBELL = ['Barbells', 'Barbell & plates'];

const EQUIPMENT_RULES: EquipmentRule[] = [
  { pattern: 'back squat', requires: [BARBELL, ['Squat rack']] },
  { pattern: 'front squat', requires: [BARBELL, ['Squat rack']] },
  { pattern: 'box squat', requires: [BARBELL, ['Squat rack']] },
  { pattern: 'bench press', requires: [BARBELL, ['Bench']] },
  { pattern: 'barbell', requires: [BARBELL] },
  // The band skull crusher is done with the band alone (the band rule below).
  { pattern: 'skull crusher', unless: ['band skull crusher'], requires: [[...BARBELL, 'Dumbbells']] },
  { pattern: 'overhead press', requires: [[...BARBELL, 'Dumbbells']] },
  { pattern: 'dumbbell', requires: [['Dumbbells']] },
  { pattern: 'goblet', requires: [['Dumbbells', 'Kettlebells']] },
  { pattern: 'kettlebell', requires: [['Kettlebells']] },
  { pattern: 'cable', requires: [['Cables', 'Machines']] },
  { pattern: 'pulldown', requires: [['Cables', 'Machines']] },
  { pattern: 'pushdown', requires: [['Cables', 'Machines']] },
  { pattern: 'machine', requires: [['Machines']] },
  // Catalog names for plate-loaded machines that never say "machine".
  { pattern: 'leverage', requires: [['Machines']] },
  { pattern: 'glute ham raise', requires: [['Machines']] },
  { pattern: 'calf press', requires: [['Machines']] },
  { pattern: 'leg press', requires: [['Machines']] },
  { pattern: 'hack squat', requires: [['Machines']] },
  { pattern: 'leg curl', requires: [['Machines']] },
  { pattern: 'leg extension', requires: [['Machines']] },
  { pattern: 'seated calf raise', requires: [['Machines']] },
  // The library files it as bodyweight, but its steps open with a donkey calf
  // raise machine (bug hunt, 2026-10-04).
  { pattern: 'donkey calf', requires: [['Machines']] },
  { pattern: 'preacher curl', requires: [['Bench', 'Machines']] },
  { pattern: 'lateral raise', requires: [['Dumbbells', 'Cables', 'Resistance bands']] },
  { pattern: 'rear delt', requires: [['Dumbbells', 'Cables', 'Resistance bands']] },
  { pattern: 'curl', unless: ['nordic hamstring curl', 'lower back curl'], requires: [[...BARBELL, 'Dumbbells', 'Resistance bands']] },
  { pattern: 'treadmill', requires: [['Cardio machines']] },
  { pattern: 'bike', requires: [['Cardio machines']] },
  { pattern: 'rowing machine', requires: [['Cardio machines']] },
  { pattern: 'elliptical', requires: [['Cardio machines']] },
  // Had no rule, so the steady-cardio slot kept it for a reader with no gear.
  { pattern: 'stairmaster', requires: [['Cardio machines', 'Machines']] },
  { pattern: 'stair climber', requires: [['Cardio machines', 'Machines']] },
  { pattern: 'pull-up', requires: [['Pull-up bar']] },
  // The catalog spells it "Pullups", which the hyphenated pattern misses.
  { pattern: 'pullup', requires: [['Pull-up bar']] },
  { pattern: 'chin-up', requires: [['Pull-up bar']] },
  { pattern: 'hanging', requires: [['Pull-up bar']] },
  { pattern: 'band', unless: ['it band'], requires: [['Resistance bands']] },
  // "Hip Thrust (Bodyweight)" is done on the floor; programEquipment already
  // reads a name that says bodyweight as gear-free, and the filter must agree.
  { pattern: 'hip thrust', unless: ['bodyweight'], requires: [['Bench', ...BARBELL, 'Dumbbells']] },
  // The weight is the exercise. They were logged as bodyweight, so a plan for
  // someone with no equipment carried weighted dips without asking anything
  // of them; logged with the weight (2026-09-21), they need a weight to hang.
  { pattern: 'weighted pull', requires: [['Dumbbells', 'Kettlebells', ...BARBELL]] },
  { pattern: 'weighted dip', requires: [['Dumbbells', 'Kettlebells', ...BARBELL]] },
  { pattern: 'weighted bench dip', requires: [['Dumbbells', 'Kettlebells', ...BARBELL]] },
  // Filed with its dumbbells on the same day, and it had no rule at all: the
  // recovery day's loaded variant handed it to anyone with any chip (CI review
  // of #172).
  { pattern: 'farmer', requires: [['Dumbbells', 'Kettlebells', ...BARBELL]] },
  // A plate lift needs the plate. The curl rule above lets bands through, and
  // a dumbbell curl for a bands-only reader fell back to reverse plate curls
  // with a weight dial and no plate (CI review of #172).
  { pattern: 'plate', requires: [BARBELL] },
  // The same class of miss as 'plate', for a different curl. "Hammer" names a
  // grip a band cannot give — the library files it under Dumbbell equipment,
  // not bands — but the generic curl rule above let bands satisfy it anyway,
  // so a bands-only reader's arms accessory was a hammer curl with a weight
  // dial and no dumbbell (#bugs, 2026-09-26).
  { pattern: 'hammer curl', requires: [['Dumbbells']] },
  // And the other way round: the band curl is the curl for a reader with a
  // band, and the generic curl rule would otherwise let dumbbells stand in
  // for the band it is named after (2026-09-26).
  { pattern: 'band curl', requires: [['Resistance bands']] },
  // The catalog's loaded lifts that never say "barbell". With no rule they
  // passed every equipment check, so the fallbacks below for "deadlift" and
  // "romanian deadlift" never ran and a dumbbells-only home plan kept a
  // conventional deadlift (bug hunt, 2026-10-04). Exact where a bodyweight
  // version shares the words: a single-leg RDL needs nothing.
  { pattern: 'deadlift', exact: true, requires: [BARBELL] },
  { pattern: 'conventional deadlift', requires: [BARBELL] },
  { pattern: 'competition deadlift', requires: [BARBELL] },
  { pattern: 'deficit deadlift', requires: [BARBELL] },
  { pattern: 'sumo deadlift', requires: [BARBELL] },
  { pattern: 'trap bar', requires: [BARBELL] },
  { pattern: 'romanian deadlift', exact: true, requires: [BARBELL] },
  // The light one is the postpartum and recovery hinge, done with whatever
  // weight is in the house; dumbbells come first so that is the chip shown.
  { pattern: 'romanian deadlift (light)', exact: true, requires: [['Dumbbells', 'Kettlebells', ...BARBELL]] },
  // The band good mornings stand on the band; no bar.
  { pattern: 'good morning', unless: ['band good morning'], requires: [BARBELL] },
  { pattern: 'power clean', requires: [BARBELL] },
  { pattern: 'push press', requires: [BARBELL] },
  { pattern: 'pendlay row', requires: [BARBELL] },
  { pattern: 'bent-over row', exact: true, requires: [BARBELL] },
  { pattern: 'pause squat', requires: [BARBELL, ['Squat rack']] },
  { pattern: 't-bar row', requires: [[...BARBELL, 'Machines']] },
  { pattern: 'chest-supported row', requires: [['Dumbbells', 'Machines']] },
  { pattern: 'arnold press', requires: [['Dumbbells', 'Kettlebells']] },
  { pattern: 'renegade row', requires: [['Dumbbells', 'Kettlebells']] },
  { pattern: 'overhead triceps extension', requires: [[...BARBELL, 'Dumbbells', 'Cables', 'Resistance bands']] },
  { pattern: 'triceps kickback', requires: [['Dumbbells', 'Cables', 'Resistance bands']] },
  { pattern: 'face pull', requires: [['Cables', 'Resistance bands']] },
  { pattern: 'reverse pec deck', requires: [['Machines']] },
  { pattern: 'reverse hyperextension', requires: [['Machines']] },
  // Bar work the pull-up rules above missed by name.
  { pattern: 'muscle-up', requires: [['Pull-up bar']] },
  { pattern: 'front lever', requires: [['Pull-up bar']] },
  { pattern: 'toes-to-bar', requires: [['Pull-up bar']] },
  { pattern: 'rows (bar or rings)', requires: [['Pull-up bar']] },
  // Gym floor gear with no chip of its own. "Machines" is the chip that says
  // the reader trains where these live; a home setup has neither.
  { pattern: 'battle rope', requires: [['Machines']] },
  { pattern: 'battling rope', requires: [['Machines']] },
  { pattern: 'sled', requires: [['Machines']] },
  { pattern: 'medicine ball', requires: [['Machines']] },
  { pattern: 'box jump', requires: [['Machines']] },
  { pattern: 'step-up (high box)', requires: [['Bench', 'Machines']] },
  { pattern: 'step-up (low box)', requires: [['Bench', 'Machines']] },
];

/**
 * Exposed so the program screen can read this table FORWARDS.
 *
 * It exists to swap exercises the reader cannot do; the same rules answer
 * "what does this program need" without a second table to keep in sync.
 */
export const EQUIPMENT_RULES_FOR_DISPLAY: readonly EquipmentRule[] = EQUIPMENT_RULES;

/**
 * Fallbacks tried in order; the first candidate the gear allows wins.
 *
 * Every name here must be a real catalog exercise — a swap that lands on a
 * name the library does not know strips the demo, the instructions and the
 * substitution options from the exercise it was supposed to rescue. A test
 * checks the whole table against the library.
 *
 * Where no honest substitute exists (a curl with neither weights nor a bar),
 * the chain ends and the exercise is removed. The composer reports that as
 * `equipmentRemoved`, which is the truthful outcome.
 */
export const EQUIPMENT_FALLBACKS: Array<[string, string[]]> = [
  // Ahead of "pull-up": with a bar and no weight, the pull-up itself.
  ['weighted pull', ['Pullups', 'Inverted Row']],
  ['weighted dip', ['Bench Dips']],
  ['weighted bench dip', ['Bench Dips']],
  // A hold, because the swap keeps the prescription's numbers and a carry's
  // are seconds or metres: 3 × 40 of a carry became 3 × 40 bridges. A brace
  // held for those seconds is the carry without the weight (CI review of #172).
  ['farmer', ['Plank']],
  ['bench press', ['Leverage Chest Press', 'Dumbbell Floor Press', 'Push-Up Wide']],
  ['back squat', ['Goblet Squat', 'Bodyweight Squat']],
  ['front squat', ['Goblet Squat', 'Bodyweight Squat']],
  ['box squat', ['Goblet Squat', 'Bodyweight Squat']],
  ['hack squat', ['Goblet Squat', 'Bodyweight Squat']],
  ['leg press', ['Goblet Squat', 'Bodyweight Squat']],
  ['romanian deadlift', ['Stiff-Legged Dumbbell Deadlift', 'Butt Lift (Bridge)']],
  ['deadlift', ['Stiff-Legged Dumbbell Deadlift', 'Butt Lift (Bridge)']],
  ['barbell row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['seated cable row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['lat pulldown', ['Pullups', 'Inverted Row']],
  ['overhead press', ['Dumbbell Shoulder Press', 'Incline Push-Up']],
  ['dumbbell shoulder press', ['Incline Push-Up']],
  ['cable fly', ['Dumbbell Flyes', 'Push-Up Wide']],
  ['dumbbell fly', ['Push-Up Wide']],
  ['skull crusher', ['Triceps Pushdown', 'Incline Push-Up']],
  ['overhead triceps extension', ['Triceps Pushdown', 'Incline Push-Up']],
  ['triceps pushdown', ['Bench Dips']],
  ['preacher curl', ['Dumbbell Bicep Curl', 'Band Curl']],
  ['barbell curl', ['Dumbbell Bicep Curl', 'Band Curl']],
  ['dumbbell curl', ['Reverse Plate Curls', 'Band Curl']],
  ['hammer curl', ['Dumbbell Bicep Curl', 'Reverse Plate Curls', 'Band Curl']],
  ['rear delt', ['Band Pull Apart']],
  ['kettlebell swing', ['Butt Lift (Bridge)']],
  ['leg curl', ['Butt Lift (Bridge)']],
  ['leg extension', ['Bodyweight Squat']],
  // Not "Donkey Calf Raises": its steps start with "you will need access to a
  // donkey calf raise machine" (bug hunt, 2026-10-04).
  // The donkey raise needs its machine too (2026-10-04).
  ['donkey calf', ['Bodyweight Calf Raise']],
  ['seated calf raise', ['Bodyweight Calf Raise']],
  ['treadmill', ['Trail Running/Walking']],
  ['stairmaster', ['Trail Running/Walking']],
  ['stair climber', ['Trail Running/Walking']],
  ['bike', ['Mountain Climbers']],
  ['chest press', ['Push-Up Wide']],
  ['hanging leg raise', ['Plank']],
  ['pull-up', ['Inverted Row']],
  ['pullup', ['Inverted Row']],
  ['hip thrust', ['Butt Lift (Bridge)']],
  ['cable crunch', ['Plank']],
  ['good morning', ['Butt Lift (Bridge)']],
  ['power clean', ['Kettlebell Swing', 'Freehand Jump Squat']],
  ['push press', ['Dumbbell Shoulder Press', 'Incline Push-Up']],
  ['pendlay row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['bent-over row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['t-bar row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['chest-supported row', ['Bent Over Two-Dumbbell Row', 'Inverted Row']],
  ['pause squat', ['Goblet Squat', 'Bodyweight Squat']],
  ['arnold press', ['Dumbbell Shoulder Press', 'Incline Push-Up']],
  ['renegade row', ['Plank']],
  ['triceps kickback', ['Bench Dips']],
  ['face pull', ['Band Pull Apart']],
  ['reverse pec deck', ['Band Pull Apart']],
  ['reverse hyperextension', ['Butt Lift (Bridge)']],
  ['muscle-up', ['Pullups', 'Inverted Row']],
  ['front lever', ['Plank']],
  ['toes-to-bar', ['Reverse Crunch']],
  ['rows (bar or rings)', ['Inverted Row']],
  ['battle rope', ['Mountain Climbers']],
  ['battling rope', ['Mountain Climbers']],
  ['sled', ['Mountain Climbers']],
  ['medicine ball', ['Burpee']],
  ['box jump', ['Freehand Jump Squat']],
  ['step-up (high box)', ['Bodyweight Walking Lunge']],
  ['step-up (low box)', ['Bodyweight Walking Lunge']],
];

function normalize(name: string) {
  return name.trim().toLowerCase();
}

/** Gear every gym has, which the full-gym card does not offer as chips. */
export const GYM_ALWAYS_HAS: readonly string[] = ['Pull-up bar', 'Resistance bands'];

/**
 * `null` = unconstrained (unknown setups stay untouched). Chosen chips are the
 * full truth; a bodyweight-only setup with no chips means "no equipment".
 *
 * At a gym, the chips plus what every gym has: the card offers no pull-up bar
 * or bands, and without them the composer dropped Hanging Knee Raise from nine
 * programmes and swapped Weighted Pull-Up for Inverted Row in four, for a
 * reader with a gym card (catalog audit, 2026-10-05). The candidate pool
 * already read them in; the week did not.
 */
export function resolveAvailableEquipment(selection: {
  trainingEnvironment?: string | null;
  equipmentItems?: string[];
}): string[] | null {
  if (selection.equipmentItems && selection.equipmentItems.length > 0) {
    return selection.trainingEnvironment === 'full_gym'
      ? [...new Set([...selection.equipmentItems, ...GYM_ALWAYS_HAS])]
      : selection.equipmentItems;
  }
  if (selection.trainingEnvironment === 'bodyweight_only') {
    return [];
  }
  return null;
}

/**
 * What a library row's own equipment asks for, beyond what its name says.
 *
 * The rules above read names, and most band and ball rows say what they use —
 * but the library files every one of them as bodyweight, and the ones that do
 * not say it ("Monster Walk" is a band walk; "Overhead Slam" and "Supine
 * Chest Throw" are medicine-ball throws) passed for a reader with no gear at
 * all (#bugs 2026-10-06, "kuminauhaliikkeet kehonpainona"). Exact library
 * names only: a catalogue name that merely resolves to a band row — "Skull
 * Crusher" finds the band skull crusher by containment — is not one.
 *
 * Balls take the chip the rules above already give the medicine ball: gym
 * floor gear, which "Machines" stands for. There is no ball chip to ask.
 */
const GEAR_BY_DISPLAY_EQUIPMENT: Partial<Record<DisplayEquipmentValue, RequirementGroup>> = {
  band: ['Resistance bands'],
  ball: ['Machines'],
};

let libraryGearByName: Map<string, RequirementGroup> | null = null;

export function libraryEquipmentRequirement(normalizedName: string): RequirementGroup | null {
  if (!libraryGearByName) {
    libraryGearByName = new Map();
    for (const item of [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]) {
      // A stretch is never refused for its gear word (the suite's sweep):
      // "Chest Stretch on Stability Ball" is a chest stretch with a prop.
      if (item.sourceCategory?.trim().toLowerCase() === 'stretching') {
        continue;
      }
      const group = GEAR_BY_DISPLAY_EQUIPMENT[displayEquipmentValue(item)];
      if (group) {
        libraryGearByName.set(normalize(item.name), group);
      }
    }
  }
  return libraryGearByName.get(normalizedName) ?? null;
}

export function isExerciseAllowedWithEquipment(exerciseName: string, available: string[] | null): boolean {
  if (available === null) {
    return true;
  }
  const normalized = normalize(exerciseName);
  const fromLibrary = libraryEquipmentRequirement(normalized);
  if (fromLibrary && !fromLibrary.some((item) => available.includes(item))) {
    return false;
  }
  return EQUIPMENT_RULES.filter((rule) => equipmentRuleMatches(normalized, rule)).every((rule) =>
    rule.requires.every((group) => group.some((item) => available.includes(item))),
  );
}

/**
 * `taken` is what the session already holds. Two exercises whose equipment is
 * missing often share a fallback list — a weighted pull-up and an explosive
 * pull-up both land on the inverted row for someone with no bar — and picking
 * per-exercise put the same movement in one session twice. The next allowed
 * candidate is taken instead, and only when the list is exhausted does the
 * exercise go.
 */
function findEquipmentFallback(
  exerciseName: string,
  available: string[],
  taken: ReadonlySet<string> = new Set(),
): string | null {
  const normalized = normalize(exerciseName);
  for (const [pattern, candidates] of EQUIPMENT_FALLBACKS) {
    if (!normalized.includes(pattern)) {
      continue;
    }
    for (const candidate of candidates) {
      if (!taken.has(candidate) && isExerciseAllowedWithEquipment(candidate, available)) {
        return candidate;
      }
    }
  }
  return null;
}

export interface EquipmentAdjustedExercises {
  exercises: WorkoutTemplateExercise[];
  removed: string[];
  swapped: Array<{ from: string; to: string }>;
}

export function applyEquipmentToExercises(
  exercises: WorkoutTemplateExercise[],
  available: string[] | null,
): EquipmentAdjustedExercises {
  if (available === null) {
    return { exercises, removed: [], swapped: [] };
  }

  const removed: string[] = [];
  const swapped: Array<{ from: string; to: string }> = [];
  // Everything the session already holds, so a fallback never repeats a
  // movement that is staying or one an earlier swap already claimed.
  const taken = new Set(
    exercises
      .filter((exercise) => isExerciseAllowedWithEquipment(exercise.exerciseName, available))
      .map((exercise) => exercise.exerciseName),
  );

  const adjusted = exercises
    .map((exercise) => {
      if (isExerciseAllowedWithEquipment(exercise.exerciseName, available)) {
        return exercise;
      }

      const fallback = findEquipmentFallback(exercise.exerciseName, available, taken);
      if (!fallback) {
        removed.push(exercise.exerciseName);
        return null;
      }
      taken.add(fallback);

      swapped.push({ from: exercise.exerciseName, to: fallback });
      // A barbell squat that falls back to a bodyweight squat must stop
      // asking for kilograms. The catalog knows; keyword matching guessed.
      const trackingMode = getCatalogTrackingMode(fallback);
      // And minutes mean nothing in another unit: a stair machine's twenty
      // minutes is not twenty of whatever replaces it, nor a lift's ten reps
      // ten minutes on a bike. Only across minutes — a carry's seconds have
      // always stayed with the hold it falls back to.
      const acrossMinutes = isMinutesTrackingMode(exercise.trackingMode) !== isMinutesTrackingMode(trackingMode);
      const dose = acrossMinutes
        ? prescriptionAfterSwap(
            exercise.trackingMode,
            trackingMode,
            { repsMin: exercise.repsMin, repsMax: exercise.repsMax },
            fallback,
          )
        : { repsMin: exercise.repsMin, repsMax: exercise.repsMax };
      return {
        ...exercise,
        exerciseName: fallback,
        trackingMode,
        repsMin: dose.repsMin,
        repsMax: dose.repsMax,
      };
    })
    .filter((exercise): exercise is WorkoutTemplateExercise => exercise !== null);

  return { exercises: adjusted, removed, swapped };
}
