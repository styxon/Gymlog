import { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { SetupCautionArea, SetupCautionFlag, SetupFocusArea } from '../types/models';
import { trackingModeAfterSwap } from './catalogExercisePools';
import { exerciseHitsCautionArea, findPhrase, normalize, phraseWords, words } from './cautionAreaMatching';
import { isExerciseAllowedWithEquipment } from './equipmentExerciseFilter';
import { isHoldExerciseName } from './holdExercises';
import { isMinutesExerciseName } from './minutesExercises';
import { movementFamilyOf } from './movementFamily';

export { cautionAreaLoadedBy, exerciseHitsCautionArea } from './cautionAreaMatching';

/**
 * Caution flags become real training changes (onboarding truth plan P2).
 *
 * - `avoid`   — the area is left out entirely: matching exercises are removed.
 * - `careful` — joint-friendly swaps: matching exercises with a known swap are
 *               replaced; sets/reps/rest keep their prescription.
 * - `info`    — no change.
 * - flagged area picked as a FOCUS on step 6 (careful only) — that area's
 *   exercises swap to bodyweight variants instead (the step-6 promise).
 *
 * Everything is exercise-NAME based, so composed and custom programs behave the
 * same; how a name is matched to an area (whole words, exclusions) lives in
 * cautionAreaMatching. Swaps use the same word rule.
 */

/** Caution areas → the focus areas they touch (mirrors the onboarding UI). */
export const CAUTION_TO_FOCUS_AREAS: Record<SetupCautionArea, SetupFocusArea[]> = {
  neck: ['shoulders'],
  shoulders: ['shoulders'],
  elbows: ['arms'],
  wrists: ['arms'],
  lower_back: ['back', 'core'],
  hips: ['glutes'],
  knees: ['legs', 'quads', 'hamstrings'],
  ankles: ['calves'],
};

// `careful` swaps: first matching pattern wins; unmatched exercises keep their
// place (there is no honest generic swap for every movement).
// Exposed (with AREA_BODYWEIGHT_SWAPS below) so a test can sweep every swap
// this filter can produce and check its tracking mode against the library.
export const AREA_CAREFUL_SWAPS: Record<SetupCautionArea, Array<[string, string]>> = {
  shoulders: [
    ['overhead press', 'Landmine Press'],
    ['shoulder press', 'Landmine Press'],
    ['push press', 'Landmine Press'],
    ['arnold press', 'Landmine Press'],
    ['upright row', 'Lateral Raise'],
    ['upright barbell row', 'Lateral Raise'],
    ['incline bench press', 'Machine Chest Press'],
    ['bench press', 'Machine Chest Press'],
    ['dip', 'Machine Chest Press'],
    ['dippi', 'Machine Chest Press'],
  ],
  lower_back: [
    ['romanian deadlift', 'Hip Thrust'],
    ['rdl', 'Hip Thrust'],
    ['deadlift', 'Hip Thrust'],
    ['pull-through', 'Hip Thrust'],
    ['good morning', 'Back Extension'],
    ['bent-over', 'Chest-Supported Row'],
    ['barbell row', 'Chest-Supported Row'],
    ['pendlay', 'Chest-Supported Row'],
    ['kettlebell swing', 'Glute Bridge'],
  ],
  knees: [
    // A hold is a stretch held for seconds; its supported version is the
    // careful one. Listed before 'squat', which would turn it into a lift.
    ['deep squat hold', 'Supported Deep Squat Hold'],
    ['bulgarian split squat', 'Box Squat'],
    ['squat', 'Box Squat'],
    ['lunge', 'Glute Bridge'],
    ['leg press', 'Hip Thrust'],
    ['leg extension', 'Leg Curl'],
    ['step-up', 'Glute Bridge'],
  ],
  elbows: [
    ['skull crusher', 'Triceps Pushdown'],
    ['overhead triceps extension', 'Triceps Pushdown'],
    ['close-grip bench press', 'Machine Chest Press'],
    ['preacher curl', 'Hammer Curl'],
    ['barbell curl', 'Hammer Curl'],
    ['dumbbell curl', 'Hammer Curl'],
  ],
  wrists: [
    ['barbell curl', 'Hammer Curl'],
    ['push-up', 'Incline Push-Up'],
    ['front squat', 'Back Squat'],
  ],
  hips: [
    ['hip thrust', 'Glute Bridge'],
    ['bulgarian split squat', 'Leg Press'],
  ],
  neck: [],
  ankles: [
    ['standing calf raise', 'Seated Calf Raise'],
    ['treadmill hiit', 'Bike HIIT (45s sprint / 15s rest)'],
  ],
};

// Careful + the area chosen as a focus: bodyweight-first variants (step-6 note).
export const AREA_BODYWEIGHT_SWAPS: Record<SetupCautionArea, Array<[string, string]>> = {
  shoulders: [
    ['overhead press', 'Incline Push-Up'],
    ['shoulder press', 'Incline Push-Up'],
    ['bench press', 'Push-Up Wide'],
  ],
  lower_back: [
    ['deadlift', 'Glute Bridge'],
    ['rdl', 'Glute Bridge'],
    ['pull-through', 'Glute Bridge'],
    ['barbell row', 'Inverted Row'],
    ['bent-over', 'Inverted Row'],
    ['kettlebell swing', 'Glute Bridge'],
  ],
  knees: [
    ['deep squat hold', 'Supported Deep Squat Hold'],
    ['squat', 'Bodyweight Squat'],
    ['lunge', 'Bodyweight Walking Lunge'],
    ['leg press', 'Bodyweight Squat'],
  ],
  elbows: [],
  wrists: [],
  hips: [['hip thrust', 'Glute Bridge']],
  neck: [],
  ankles: [],
};

function findSwap(exerciseName: string, table: Array<[string, string]>): string | null {
  const nameWords = words(exerciseName);
  for (const [pattern, replacement] of table) {
    if (findPhrase(nameWords, phraseWords(pattern)) !== -1) {
      return replacement;
    }
  }
  return null;
}

function isBannedByAnyAvoid(exerciseName: string, flags: SetupCautionFlag[]): boolean {
  return flags.some((flag) => flag.level === 'avoid' && exerciseHitsCautionArea(exerciseName, flag.area));
}

/**
 * What a run becomes for a reader who avoids their knees or ankles.
 *
 * `avoid` used to remove it like any other lift, and RUN's "Easy Run" day was
 * left as one stretch and a calf raise under "Running comes first" (bug hunt,
 * 2026-10-07, #35). The owner's call: the run is replaced, for the same
 * minutes. Knees walk — briskly on the easy day, uphill on the tempo day.
 * Ankles ride a stationary bike when the reader's gear has one, and walk on
 * the flat otherwise: a hill loads the ankle the flag is about.
 *
 * Only a run done for minutes has a stand-in. A stride or a sprint is counted,
 * and walking one is not the same drill made gentler, so those still go.
 */
export const RUN_STAND_INS = {
  walk: 'Brisk Walk Blocks',
  inclineWalk: 'Incline Walk Blocks',
  ride: 'Stationary Bike Blocks',
} as const;

/** The run the uphill walk stands in for; every other run walks on the flat. */
const TEMPO_RUN = normalize('Tempo Run Blocks');

export type RunStandInKind = 'walk' | 'ride';

/** What a reader's runs become, or null when their flags keep them running. */
export function runStandInKind(
  flags: readonly SetupCautionFlag[],
  availableEquipment: string[] | null = null,
): RunStandInKind | null {
  const avoids = (area: SetupCautionArea) => flags.some((flag) => flag.level === 'avoid' && flag.area === area);
  if (avoids('ankles')) {
    return isExerciseAllowedWithEquipment(RUN_STAND_INS.ride, availableEquipment) ? 'ride' : 'walk';
  }
  return avoids('knees') ? 'walk' : null;
}

/** The kind a stand-in name is, for renaming the day it landed on. */
export function runStandInKindOf(exerciseName: string): RunStandInKind | null {
  const key = normalize(exerciseName);
  if (key === normalize(RUN_STAND_INS.ride)) {
    return 'ride';
  }
  return key === normalize(RUN_STAND_INS.walk) || key === normalize(RUN_STAND_INS.inclineWalk) ? 'walk' : null;
}

/**
 * A day named for its run, renamed for what it now holds: "Day 1: Easy Run"
 * over two brisk walks was the same false promise as the reason line.
 */
export function sessionNameAfterRunStandIn(name: string, kind: RunStandInKind): string {
  return name.replace(/\bRun\b/g, kind === 'ride' ? 'Ride' : 'Walk');
}

/** The lifts a day can be named for. Each has a Finnish word in sessionNameLabel. */
const TITLE_LIFTS = ['squat', 'deadlift', 'bench'] as const;

const hasWord = (text: string, word: string) => findPhrase(words(text), [word]) !== -1;

/**
 * A day named for a lift it no longer holds, renamed for what it does.
 *
 * "Day 1: Squat & Bench" stayed that over Bench Press, a row and a crunch
 * when the knees were avoided, and a "Squat Day" held calf raises and
 * bridges (44 titles across the ready templates, persona hunt 2026-10-08).
 * Only a lift an avoid flag removed counts, and only when nothing left on
 * the day carries its word: a Box Squat swapped in keeps "Squat" honest.
 * The named part goes ("Squat & Bench" is "Bench"); a title with nothing
 * left is the day's focus, a name sessionNameLabel already translates.
 */
export function sessionNameAfterRemovedLifts(
  name: string,
  removed: readonly string[],
  remaining: readonly string[],
  fallbackFocus: string,
): string {
  const prefixed = name.match(/^(.*?:\s+)?(.*)$/);
  const prefix = prefixed?.[1] ?? '';
  const focus = prefixed?.[2] ?? name;
  const missing = TITLE_LIFTS.filter(
    (word) =>
      hasWord(focus, word) &&
      removed.some((lift) => hasWord(lift, word)) &&
      !remaining.some((lift) => hasWord(lift, word)),
  );
  if (missing.length === 0) {
    return name;
  }
  const parts = focus.split(/(\s*[&+/]\s*)/);
  const separator = parts.find((part, index) => index % 2 === 1) ?? ' & ';
  const kept = parts.filter((part, index) => index % 2 === 0 && !missing.some((word) => hasWord(part, word)));
  return `${prefix}${kept.length > 0 ? kept.map((part) => part.trim()).join(separator) : fallbackFocus}`;
}

/** A run done for minutes: the only kind of run with a stand-in. */
export function isMinutesRun(exercise: Pick<WorkoutTemplateExercise, 'exerciseName' | 'trackingMode'>): boolean {
  const minutes = exercise.trackingMode === 'duration_minutes' || isMinutesExerciseName(exercise.exerciseName);
  return minutes
    && (exerciseHitsCautionArea(exercise.exerciseName, 'knees') || exerciseHitsCautionArea(exercise.exerciseName, 'ankles'));
}

function runStandIn(
  exercise: WorkoutTemplateExercise,
  flags: SetupCautionFlag[],
  availableEquipment: string[] | null,
): string | null {
  if (!isMinutesRun(exercise)) {
    return null;
  }
  const kind = runStandInKind(flags, availableEquipment);
  if (kind === 'ride') {
    return RUN_STAND_INS.ride;
  }
  if (kind === null) {
    return null;
  }
  const flatOnly = flags.some((flag) => flag.level === 'avoid' && flag.area === 'ankles');
  return !flatOnly && normalize(exercise.exerciseName) === TEMPO_RUN ? RUN_STAND_INS.inclineWalk : RUN_STAND_INS.walk;
}

export interface CautionExerciseSwap {
  from: string;
  to: string;
  area: SetupCautionArea;
}

export interface CautionAdjustedExercises {
  exercises: WorkoutTemplateExercise[];
  removed: Array<{ name: string; area: SetupCautionArea }>;
  swapped: CautionExerciseSwap[];
}

export function applyCautionFlagsToExercises(
  exercises: WorkoutTemplateExercise[],
  flags: SetupCautionFlag[],
  focusAreas: SetupFocusArea[] = [],
  /**
   * The reader's gear, when known. A careful swap has to be something they
   * can do: "squat → Box Squat" put a barbell-and-rack lift in a home week
   * with no gear, and "bench press → Machine Chest Press" a machine there
   * (1317 of 7200 answer sets, recommendation matrix 2026-10-05). The swap
   * falls through to the bodyweight one, then keeps the movement as it was.
   */
  availableEquipment: string[] | null = null,
): CautionAdjustedExercises {
  const seriousFlags = flags.filter((flag) => flag.level !== 'info');
  if (seriousFlags.length === 0) {
    return { exercises, removed: [], swapped: [] };
  }

  const removed: CautionAdjustedExercises['removed'] = [];
  const swapped: CautionExerciseSwap[] = [];

  /*
   * The names already on the day (the list is one session).
   *
   * Two squats on a lower day both became Box Squat, and a Box Squat the day
   * already had got a second one beside it — the same lift twice, in 46
   * answer sets (bug hunt, 2026-10-05, B7). A swap therefore skips a
   * replacement the day already holds and tries the next one (careful, then
   * bodyweight, or the other way round for a focus area). When every
   * replacement is taken the movement keeps its place, the same as one with
   * no swap at all: dropping it would cut the day's volume for a lift the
   * reader only asked to be careful with, and that is the less expected
   * change of the two.
   *
   * "On the day" is what this pass has already kept or swapped in, plus the
   * originals it has yet to reach. An original that will itself be swapped
   * away later still blocks its name: being conservative here can only
   * keep a movement, never put a duplicate in.
   */
  const pending = new Map<string, number>();
  for (const exercise of exercises) {
    const key = normalize(exercise.exerciseName);
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }
  const taken = new Set<string>();
  /*
   * The same rule for a movement family, in two strengths.
   *
   * Exact names missed the pairs that are one drill: a leg press became Hip
   * Thrust and a lunge Glute Bridge on the same day, and Leg Curl stood beside
   * Lying Leg Curl (17 of 113 swapped sessions across the ready templates,
   * persona hunt 2026-10-08). A family THIS PASS has already swapped in is a
   * hard block: a swap never adds a second one.
   *
   * A family the template itself holds is only a preference. The first cut
   * made it a block too, and a day with its own Hip Thrust or bridge then kept
   * its Conventional Deadlift for a careful lower-back reader (15 ready
   * sessions, 22 composed weeks): a duplicate bridge is a smaller fault than
   * a heavy hinge left in place. So a replacement outside the family wins when
   * there is one, and otherwise the swap goes ahead beside the native lift.
   */
  const nativeFamilies = new Set<string>();
  for (const exercise of exercises) {
    const family = movementFamilyOf(exercise.exerciseName);
    if (family) {
      nativeFamilies.add(family);
    }
  }
  const swappedInFamilies = new Set<string>();
  const onTheDay = (name: string) => {
    const key = normalize(name);
    return taken.has(key) || (pending.get(key) ?? 0) > 0;
  };
  const familyAddedBySwap = (name: string) => {
    const family = movementFamilyOf(name);
    return family !== null && swappedInFamilies.has(family);
  };
  const familyNative = (name: string) => {
    const family = movementFamilyOf(name);
    return family !== null && nativeFamilies.has(family);
  };

  const adjustOne = (exercise: WorkoutTemplateExercise): WorkoutTemplateExercise | null => {
    const matching = seriousFlags.filter((flag) => exerciseHitsCautionArea(exercise.exerciseName, flag.area));
    if (matching.length === 0) {
      return exercise;
    }

    const avoidFlag = matching.find((flag) => flag.level === 'avoid');
    if (avoidFlag) {
      const standIn = runStandIn(exercise, seriousFlags, availableEquipment);
      if (standIn && !onTheDay(standIn) && !isBannedByAnyAvoid(standIn, seriousFlags)) {
        // The same blocks for the same minutes: only the movement changes.
        swapped.push({ from: exercise.exerciseName, to: standIn, area: avoidFlag.area });
        return { ...exercise, exerciseName: standIn, trackingMode: 'duration_minutes' };
      }
      removed.push({ name: exercise.exerciseName, area: avoidFlag.area });
      return null;
    }

    for (const flag of matching) {
      const focusOverlap = CAUTION_TO_FOCUS_AREAS[flag.area].some((area) => focusAreas.includes(area));
      const bodyweight = findSwap(exercise.exerciseName, AREA_BODYWEIGHT_SWAPS[flag.area]);
      const careful = findSwap(exercise.exerciseName, AREA_CAREFUL_SWAPS[flag.area]);
      const candidates = focusOverlap ? [bodyweight, careful] : [careful, bodyweight];
      const usable = candidates.filter(
        (candidate): candidate is string =>
          candidate !== null
          && isExerciseAllowedWithEquipment(candidate, availableEquipment)
          && !onTheDay(candidate)
          && !familyAddedBySwap(candidate),
      );
      // The table's own order decides (the focus area asks for the bodyweight
      // variant first). Only a first choice that repeats a movement the
      // template holds gives way, and only to a later one that repeats nothing
      // and leaves the flag alone: a bodyweight lunge for a lunge still hits
      // the knee, which is worse than a repeated bridge.
      const stillHits = (candidate: string) => exerciseHitsCautionArea(candidate, flag.area);
      const replacement =
        usable[0] !== undefined && familyNative(usable[0])
          ? usable.find((candidate) => !familyNative(candidate) && !stillHits(candidate)) ?? usable[0]
          : usable[0] ?? null;

      // Never swap into something another flag bans outright. And never
      // swap a hold into a lift: its dose is seconds, and "60–90" carried
      // onto Box Squat read as 90 squats (2026-09-14). A hold with no hold
      // to go to keeps its place, the same as any unmatched movement.
      //
      // The same for a bout of minutes: twenty minutes on a stair machine
      // carried onto a lift is twenty reps of it (2026-10-06).
      const holdIntoLift =
        replacement !== null &&
        (((exercise.trackingMode === 'hold' || isHoldExerciseName(exercise.exerciseName)) &&
          !isHoldExerciseName(replacement)) ||
          ((exercise.trackingMode === 'duration_minutes' || isMinutesExerciseName(exercise.exerciseName)) &&
            !isMinutesExerciseName(replacement)));
      const sameLift = replacement !== null && normalize(replacement) === normalize(exercise.exerciseName);
      if (replacement && !holdIntoLift && !sameLift && !isBannedByAnyAvoid(replacement, seriousFlags)) {
        swapped.push({ from: exercise.exerciseName, to: replacement, area: flag.area });
        return {
          ...exercise,
          exerciseName: replacement,
          // The library's own data, not a name guess: a keyword match on the
          // replacement name called "Bench Dips" -> "Machine Chest Press"
          // bodyweight, leaving the set screen with no kg field for a machine
          // lift (found 2026-09-26). trackingModeAfterSwap is the same rule
          // the live player and Home use for every other swap — hold names
          // first, then the ready programmes' own prescriptions, then the
          // generated library's equipment field, and it only ever moves a
          // slot TOWARD needing a weight for a name none of those place, so
          // an unknown name never silently loses its weight field either.
          trackingMode: trackingModeAfterSwap(exercise.trackingMode, replacement),
        };
      }
    }

    return exercise;
  };

  const adjusted: WorkoutTemplateExercise[] = [];
  for (const exercise of exercises) {
    const key = normalize(exercise.exerciseName);
    pending.set(key, (pending.get(key) ?? 1) - 1);
    const result = adjustOne(exercise);
    if (result) {
      taken.add(normalize(result.exerciseName));
      if (result.exerciseName !== exercise.exerciseName) {
        const resultFamily = movementFamilyOf(result.exerciseName);
        if (resultFamily) {
          swappedInFamilies.add(resultFamily);
        }
      }
      adjusted.push(result);
    }
  }

  return { exercises: adjusted, removed, swapped };
}
