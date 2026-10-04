import { isHoldExerciseName } from './holdExercises';
import { intervalOffSeconds } from './intervalScheme';

/**
 * One rep number per exercise, for SAVED programs too.
 *
 * The catalogs collapsed every "8-10" to "10" on 2026-08-25 (repsMax kept,
 * because the progression gate always measured readiness against it). A
 * programme saved to the reader's own database before that day still carried
 * its ranges — the user asked for the same rule there (2026-08-26). This runs
 * in the load-time normalization, so every stored programme reads the same
 * way the catalog now writes.
 *
 * Holds are exempt for the same reason they were in the catalog: their
 * numbers are seconds, and "30-60 s" is a dose bracket, not a rep range.
 * `isHoldExerciseName` is the one list that decides.
 */
export function collapseRepRange(exercise: {
  name: string;
  repMin: number;
  repMax: number;
}): { repMin: number; repMax: number } {
  if (exercise.repMin === exercise.repMax || isHoldExerciseName(exercise.name)) {
    return { repMin: exercise.repMin, repMax: exercise.repMax };
  }
  return { repMin: exercise.repMax, repMax: exercise.repMax };
}

/**
 * The rest a saved row keeps. 0 is a rest of none — a stretch is written that
 * way — and used to be dropped as "unset", which gave the stretch the
 * reader's default between sets (card 30 min, Home 35). Only a missing or
 * negative number is unset.
 */
export function savedRestSeconds(restSeconds: number | null | undefined): number | null {
  return typeof restSeconds === 'number' && Number.isFinite(restSeconds) && restSeconds >= 0 ? restSeconds : null;
}

/**
 * What a saved programme row prescribes: the reps and the rest the loader
 * reads back, and so the ones the writer has to write.
 *
 * The load applied both rules below and the save applied neither. The
 * editors' own defaults hand out ranges (6-8, 10-12, 12-15), so a lift saved
 * as "3 × 6–8" read "3 × 8" after the next launch, and an interval's rest
 * raised in the tune sheet snapped back to its off-phase on the relaunch
 * (persistence audit, 2026-09-20). Both sides call this, so what memory
 * holds after a save is what the disk gives back.
 */
export function savedPrescription(row: {
  name: string;
  repMin: number;
  repMax: number;
  restSeconds: number | null;
}): { repMin: number; repMax: number; restSeconds: number | null } {
  const reps = collapseRepRange(row);
  // An interval's rest is the off-phase its own name states — a saved
  // 30/30 carried a 60 s rest on top of the 30 s walk (2026-08-26).
  const offSeconds = intervalOffSeconds(row.name);
  return { repMin: reps.repMin, repMax: reps.repMax, restSeconds: offSeconds ?? row.restSeconds };
}
