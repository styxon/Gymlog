/**
 * The dose a slot asks for once another lift is swapped into it.
 *
 * One rule for every swap a reader makes: the player's own swap, "Just this
 * time" (the held swap, applied at the start), "For ever" (written into the
 * programme), and the row that shows either one on Home and the programme
 * day. They used to disagree. The held swap and the player converted the
 * numbers when the unit changed, the permanent one carried them over raw — a
 * 45-second plank kept for ever as crunches asked for 45 crunches, a squat at
 * 8 became an 8-second plank or 8 minutes on a bike — and the row kept
 * printing the old lift's "3 × 8" over a session that would open on seconds
 * (swap hunt, 2026-10-07).
 *
 * The mode is the incoming lift's (trackingModeAfterSwap). The set count and
 * the rest are the slot's and stay. Within a unit the numbers stay too; across
 * one (repetitions, seconds of a hold, minutes of a bout) they mean nothing,
 * and the slot takes what the programmes write for the incoming lift
 * (prescriptionAfterSwap).
 */

import { WorkoutTrackingMode } from '../features/workout/workoutTypes';
import { prescriptionAfterSwap, trackingModeAfterSwap } from './catalogExercisePools';

export interface SlotDose {
  trackingMode: WorkoutTrackingMode;
  sets: number;
  repsMin: number;
  repsMax: number;
}

/** The same lift, however it is cased or padded: a swap to it is no swap. */
export function isSameLiftName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function doseAfterSwap(current: SlotDose, exerciseName: string): SlotDose {
  const trackingMode = trackingModeAfterSwap(current.trackingMode, exerciseName);
  const { repsMin, repsMax } = prescriptionAfterSwap(
    current.trackingMode,
    trackingMode,
    { repsMin: current.repsMin, repsMax: current.repsMax },
    exerciseName,
  );
  return { trackingMode, sets: current.sets, repsMin, repsMax };
}
