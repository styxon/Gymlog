import { WorkoutTemplateExercise } from '../features/workout/workoutTypes';
import { SetupCautionArea, SetupCautionFlag, SetupFocusArea } from '../types/models';
import { trackingModeAfterSwap } from './catalogExercisePools';
import { exerciseHitsCautionArea, findPhrase, normalize, phraseWords, words } from './cautionAreaMatching';
import { isExerciseAllowedWithEquipment } from './equipmentExerciseFilter';
import { isHoldExerciseName } from './holdExercises';

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
    ['deadlift', 'Hip Thrust'],
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

  const adjusted = exercises
    .map((exercise) => {
      const matching = seriousFlags.filter((flag) => exerciseHitsCautionArea(exercise.exerciseName, flag.area));
      if (matching.length === 0) {
        return exercise;
      }

      const avoidFlag = matching.find((flag) => flag.level === 'avoid');
      if (avoidFlag) {
        removed.push({ name: exercise.exerciseName, area: avoidFlag.area });
        return null;
      }

      for (const flag of matching) {
        const focusOverlap = CAUTION_TO_FOCUS_AREAS[flag.area].some((area) => focusAreas.includes(area));
        const bodyweight = findSwap(exercise.exerciseName, AREA_BODYWEIGHT_SWAPS[flag.area]);
        const careful = findSwap(exercise.exerciseName, AREA_CAREFUL_SWAPS[flag.area]);
        const candidates = focusOverlap ? [bodyweight, careful] : [careful, bodyweight];
        const replacement =
          candidates.find(
            (candidate): candidate is string =>
              candidate !== null && isExerciseAllowedWithEquipment(candidate, availableEquipment),
          ) ?? null;

        // Never swap into something another flag bans outright. And never
        // swap a hold into a lift: its dose is seconds, and "60–90" carried
        // onto Box Squat read as 90 squats (2026-09-14). A hold with no hold
        // to go to keeps its place, the same as any unmatched movement.
        const holdIntoLift =
          replacement !== null &&
          (exercise.trackingMode === 'hold' || isHoldExerciseName(exercise.exerciseName)) &&
          !isHoldExerciseName(replacement);
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
    })
    .filter((exercise): exercise is WorkoutTemplateExercise => exercise !== null);

  return { exercises: adjusted, removed, swapped };
}
