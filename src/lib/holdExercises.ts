import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { DEMO_ONLY_ALIASES, findGuidedLibraryIndex } from './guidedPlayer';

/**
 * Which exercises are a timed position rather than repetitions.
 *
 * This has to be written down. The exercise library cannot answer it: its
 * `sourceCategory` puts "Child's Pose" and "Split Squats" in the same bucket
 * ('stretching'), and its equipment field says only that neither uses a
 * barbell. Nothing in the data distinguishes a plank from a push-up.
 *
 * So it is a list — but ONE list. The ready catalogs mark these rows
 * `trackingMode: 'hold'`, custom programs resolve the same names through
 * `getCatalogTrackingMode`, and a test asserts the two agree in both
 * directions. Two lists would drift, and the drift would be silent: the same
 * plank reading "3 × 30-60 s" in a ready program and "3 × 60" in your own.
 */
const HOLD_EXERCISE_NAMES = [
  '90/90 Hip Stretch',
  'Box Breathing',
  'Butterfly Stretch',
  "Child's Pose",
  "Child's Pose with Reach",
  'Cobra Pose',
  'Couch Stretch (each side)',
  'Deep Squat Hold',
  'Doorway Pec Stretch',
  'Frog Stretch',
  'Front Lever Tuck Hold',
  'Glute Bridge Hold',
  'Hip Flexor Stretch',
  'Hollow Body Hold',
  'IT Band and Glute Stretch',
  'Intermediate Hip Flexor and Quad Stretch',
  'Kneeling Hip Flexor',
  'L-Sit Hold',
  'Legs Up the Wall',
  'Lying Quad Stretch',
  'Pigeon Pose',
  'Pigeon Pose (each side)',
  'Plank',
  'Seated Floor Hamstring Stretch',
  'Seated Hip Stretch',
  'Seated Pancake Stretch',
  'Seated Spinal Twist',
  'Side Plank',
  'Side Plank (Knees Down)',
  'Single-Leg Balance Hold',
  'Sleeper Stretch',
  'Sphinx Pose',
  'Spinal Twist (Supine)',
  'Standing Forward Fold',
  'Standing Hamstring and Calf Stretch',
  'Supported Deep Squat Hold',
  // 30 "reps" of standing on one leg was 30 seconds wearing the wrong unit —
  // found by the single-rep-target guard, mis-marked since the catalog landed.
  'Supported Single-Leg Balance',
  'Tuck Planche Hold',
  'Vacuum (Stomach)',
  'Wall Handstand Hold',
  "World's Greatest Stretch",
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

const byName = new Set(HOLD_EXERCISE_NAMES.map(normalize));

/**
 * The library names of the holds above, so a user who picks the library's own
 * spelling gets a hold too. "Plank" is listed here as the catalogs write it;
 * the library agrees, but "Couch Stretch (each side)" resolves to
 * "Intermediate Hip Flexor and Quad Stretch" and would otherwise be missed
 * when picked from the browser rather than prescribed by a program.
 */
const libraryAliases = (() => {
  const names = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);
  const resolved = new Set<string>();
  for (const holdName of HOLD_EXERCISE_NAMES) {
    // A demo-only alias borrows a row's pictures; that row is another
    // movement ("Glute Bridge Hold" opens the plain bridge's steps) and is
    // not a hold itself.
    if (DEMO_ONLY_ALIASES.has(normalize(holdName))) {
      continue;
    }
    const index = findGuidedLibraryIndex(holdName, names);
    if (index !== null) {
      resolved.add(normalize(names[index]));
    }
  }
  return resolved;
})();

/** Whether this exercise is logged in seconds held rather than repetitions. */
export function isHoldExerciseName(name: string): boolean {
  const normalized = normalize(name);
  return byName.has(normalized) || libraryAliases.has(normalized);
}

/** The names this module claims, exposed so a test can check the catalog agrees. */
export const HOLD_EXERCISE_NAME_LIST: readonly string[] = HOLD_EXERCISE_NAMES;
