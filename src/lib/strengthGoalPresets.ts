/**
 * The lifts anybody actually sets a target on.
 *
 * Ten, not 876. The target flow briefly offered the whole library behind a
 * search, and that is the wrong shape for this question: nobody says "I want
 * to cable-crossover 30 kg". They say squat, bench, deadlift — and then the
 * handful of accessories that carry a number in their head anyway. Naming the
 * list is also what lets the app promise a PROGRAMME behind every target,
 * which it cannot do for a lift no catalog week trains as a main lift.
 *
 * The list is the user's, given in Finnish on 2026-09-01: kyykky, penkki,
 * mave, pystysoutu, hackkyykky, lantionnosto, suorin jaloin mave, etukyykky,
 * and then kulmasoutu and yläpenkki. The names here are the library's own
 * English ones, because that is what a stored goal is keyed by; the reader
 * sees them through `exerciseNameLabel`. No two of them fold into each other
 * under `isSameLift` — checked pairwise, not eyeballed.
 *
 * The front squat is `Front Barbell Squat`, which is the entry the catalog's
 * own "Front Squat" resolves to through the guided alias. Named as `Front
 * Squat (Clean Grip)` — a different library row — it read as a lift no ready
 * programme trains, when eight of them train it and six as a main lift.
 *
 * NOT here: sumo deadlift, which the user also named. `liftIdentity` folds
 * sumo and trap bar into the deadlift on purpose — a lifter's deadlift best is
 * their deadlift best whichever stance it was pulled from — so a sumo row
 * would show the same best and the same rate as the deadlift row beside it.
 * Two rows, one number. Splitting it is a change to how every deadlift best in
 * the app is measured, not an addition to this list.
 */

interface StrengthGoalPreset {
  /** Matches ExerciseProgressSummary.name — the stored English name. */
  exerciseName: string;
}

export const STRENGTH_GOAL_PRESETS: readonly StrengthGoalPreset[] = [
  { exerciseName: 'Barbell Squat' },
  { exerciseName: 'Barbell Bench Press - Medium Grip' },
  { exerciseName: 'Barbell Deadlift' },
  { exerciseName: 'Front Barbell Squat' },
  { exerciseName: 'Hack Squat' },
  { exerciseName: 'Barbell Hip Thrust' },
  { exerciseName: 'Romanian Deadlift' },
  { exerciseName: 'Upright Barbell Row' },
  { exerciseName: 'Bent Over Barbell Row' },
  { exerciseName: 'Barbell Incline Bench Press - Medium Grip' },
];
