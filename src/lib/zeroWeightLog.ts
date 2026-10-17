/**
 * Whether "Log set" first says that no weight is set.
 *
 * A loaded lift with nothing to go on — no plan weight, no last time — opens
 * its weight dial at a faint zero, and one tap on Log set wrote 0 kg. On a new
 * phone that is the first session's every lift: the reader's back squat was
 * listed as "0 kg × 7, Starting" (owner's #9, iOS hunt 2026-10-17). The store
 * keeps accepting 0 kg, which is a real answer for a loaded lift done with
 * bodyweight (a lunge); the first tap says so, the second logs it.
 */
export function asksBeforeZeroWeightLog(input: {
  /** The set has a weight card: not a bodyweight lift. */
  carriesWeight: boolean;
  kg: number;
  /** The weight the set was opened with; null when there was nothing to go on. */
  plannedKg: number | null;
  /** The note has been shown for this set already. */
  asked: boolean;
}): boolean {
  return input.carriesWeight && !(input.kg > 0) && input.plannedKg === null && !input.asked;
}
