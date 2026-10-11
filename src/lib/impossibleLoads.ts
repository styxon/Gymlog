/**
 * Loads no one could have lifted, taken out of a session that is still open.
 *
 * The completed side of this lives in `exerciseLog`, which drops such a set on
 * load, and it is not enough on its own: the 5122,5 kg sumo deadlift of
 * #bugs 2026-09-05 was sitting in a LIVE session, where a load is a dial value
 * rather than a logged set. Cleaning only the history would have let the reader
 * resume the workout and write the number straight back.
 */

import { parseNumberInput } from './format';
import { isLiftableWeight } from './weightLimits';
import type { WorkoutSessionRuntime, WorkoutSetInstance } from '../features/workout/workoutTypes';

/**
 * Does any load on this set describe a bar nobody could have held?
 *
 * `draftLoadText` counts, because it is what the dial reads on resume — the
 * numeric fields can be clean while the text still says 5122,5.
 */
export function setCarriesImpossibleLoad(set: WorkoutSetInstance): boolean {
  if (!set || typeof set !== 'object') {
    return false;
  }
  // `parseNumberInput` calls `.replace` on what it is given, and the stored
  // set is a cast rather than a validated shape — an older bundle without the
  // draft field would throw here rather than read as "nothing typed".
  const drafted = typeof set.draftLoadText === 'string' ? parseNumberInput(set.draftLoadText) : null;

  return (
    (set.plannedLoadKg !== undefined && !isLiftableWeight(set.plannedLoadKg)) ||
    (set.actualLoadKg !== undefined && !isLiftableWeight(set.actualLoadKg)) ||
    (set.autoProgressedFromKg !== undefined && !isLiftableWeight(set.autoProgressedFromKg)) ||
    (drafted !== null && !isLiftableWeight(drafted))
  );
}

/**
 * Every load on an affected set goes together — planned, drafted, actual and
 * the "we moved this up for you" marker — because they all describe one bar,
 * and so does everything the gate said about that bar: its holds, where it
 * was borrowed from and the rep targets set with it.
 * Keeping any one of them would leave the set arguing with itself.
 *
 * Sets and exercises that are already fine keep their identity: this runs on
 * every resume, and rebuilding the whole board each time would remount it.
 */
export function scrubImpossibleSessionLoads(session: WorkoutSessionRuntime): WorkoutSessionRuntime {
  /*
   * This runs on stored shapes, every custom-programme session among them. A
   * truncated blob with no `exercises` would throw here, and the only catch
   * above is around the whole bundle: one bad session would take the slot
   * history and the active cardio with it (found in review, 2026-09-05).
   *
   * That guard covered this function only. The loader's own slot remap read
   * the same missing fields a few lines later and threw anyway, so the loader
   * now repairs the session's shape before either runs
   * (workoutPersistence.repairSessionShape, 2026-09-21). This check stays for
   * any other caller.
   */
  if (!Array.isArray(session.exercises)) {
    return session;
  }

  let sessionChanged = false;

  const exercises = session.exercises.map((exercise) => {
    if (!Array.isArray(exercise?.sets)) {
      return exercise;
    }

    let exerciseChanged = false;

    const sets = exercise.sets.map((set) => {
      if (!setCarriesImpossibleLoad(set)) {
        return set;
      }

      exerciseChanged = true;
      sessionChanged = true;
      // The gate's badges and targets go with the load they were about: a
      // hold left on a set with no weight saved the reader's own number as
      // 'held_recovery' (hunt, 2026-10-11).
      const {
        plannedLoadKg,
        actualLoadKg,
        autoProgressedFromKg,
        heldForFatigue,
        heldForCautionArea,
        prefilledFromPerformedAt,
        plannedTargetReps,
        autoProgressedFromReps,
        rampTargetReps,
        ...rest
      } = set;
      return { ...rest, draftLoadText: '' };
    });

    return exerciseChanged ? { ...exercise, sets } : exercise;
  });

  return sessionChanged ? { ...session, exercises } : session;
}
