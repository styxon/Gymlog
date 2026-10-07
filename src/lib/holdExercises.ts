import { GENERATED_EXERCISE_LIBRARY } from '../data/generatedExerciseLibrary';
import { DEMO_ONLY_ALIASES, findFiledLibraryIndex } from './guidedPlayer';

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

/**
 * Library rows that are held, whose names say nothing of it and whose rows the
 * catalogues never prescribe — so the list above, which the catalogues must
 * agree with, is not the place for them. Each one's own instructions give a
 * duration ("Hold for 10-20 seconds") or are a static position (a side bridge
 * is a side plank). Found by reading all 873 rows against the rule below
 * (2026-10-06); the SMR foam-roller rows are timed the same way and are caught
 * by their suffix. Pinned, both ways round, in tests/lib/holdTracking.test.cjs.
 */
const LIBRARY_HOLD_NAMES = [
  '90/90 Hamstring',
  'Adductor/Groin',
  'Ankle On The Knee',
  'Crucifix',
  'Lying Bent Leg Groin',
  'Lying Crossover',
  'Lying Glute',
  'Lying Hamstring',
  'Lying Prone Quadriceps',
  'One Handed Hang',
  'Overhead Lat',
  'Overhead Triceps',
  'Seated Biceps',
  'Seated Front Deltoid',
  'Seated Glute',
  'Seated Hamstring',
  'Side Bridge',
  'Standing Hip Flexors',
  'Standing Toe Touches',
  'The Straddle',
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

const byName = new Set([...HOLD_EXERCISE_NAMES, ...LIBRARY_HOLD_NAMES].map(normalize));

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
    // Exact name or alias only. This used to be findGuidedLibraryIndex, which
    // falls back to "the shortest library name that contains this one" — right
    // for finding a photo, wrong for deciding what an exercise IS: "Side Plank"
    // is contained in "Push Up to Side Plank", so the push-up (a repetition
    // movement) became a 3 x 30-45 s hold (bug hunt, 2026-10-05).
    const index = findFiledLibraryIndex(holdName, names);
    if (index !== null) {
      resolved.add(normalize(names[index]));
    }
  }
  return resolved;
})();

/**
 * A name that says what it is. The library's 873 rows are not on the list
 * above, and 49 of its stretches and isometrics — "Hamstring Stretch",
 * "Isometric Wipers" — opened a reps dial when picked in "Build it yourself",
 * so a 30-second stretch was stored as 12 repetitions (bug hunt, 2026-10-05).
 * A stretch or an isometric is held, whatever the row is called otherwise —
 * except a dynamic one, moved through in repetitions, which is how the ready
 * programmes log "Dynamic Back Stretch" and "Cat Stretch" (the cat-cow). The
 * agreement test below the list holds the rule to the programmes both ways.
 */
const NAMED_HOLD = /\b(stretch|stretches|stretching|isometric)\b/i;
const MOVED_STRETCH = /\bdynamic\b/i;
// A foam-roller row ("Calves-SMR"): pressed on a point of tension for 10-30 s.
const FOAM_ROLL = /-smr$/i;
// Named for a stretch or an isometric, moved through in repetitions: the
// cat-cow, leg swings, and a side-to-side push-up (review, 2026-10-05).
const REPS_STRETCHES = new Set(['cat stretch', 'iron crosses (stretch)', 'isometric wipers']);

function isNamedHold(normalized: string): boolean {
  if (FOAM_ROLL.test(normalized)) {
    return true;
  }
  return NAMED_HOLD.test(normalized) && !MOVED_STRETCH.test(normalized) && !REPS_STRETCHES.has(normalized);
}

/** Whether this exercise is logged in seconds held rather than repetitions. */
export function isHoldExerciseName(name: string): boolean {
  const normalized = normalize(name);
  return byName.has(normalized) || libraryAliases.has(normalized) || isNamedHold(normalized);
}

/** The names this module claims, exposed so a test can check the catalog agrees. */
export const HOLD_EXERCISE_NAME_LIST: readonly string[] = HOLD_EXERCISE_NAMES;
