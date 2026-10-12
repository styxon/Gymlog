/**
 * The ceiling on a single set's weight, and the question "could this number
 * have been lifted?" — and, beside it, the same question for every other
 * stored training quantity a loader reads back: reps, set counts, body weight.
 *
 * It lives in its own leaf module because two layers need it and they cannot
 * import each other: the dial that refuses to write such a number
 * (`weightDial`) and the loader that refuses to read one back
 * (`exerciseLog`). `weightDial -> format -> exerciseLog` is already a chain,
 * so putting the constant in either end would close a cycle.
 */

/**
 * The heaviest single set the app will hold.
 *
 * Not a guess at anybody's strength. It was 500 kg, the all-time raw deadlift
 * record, until the bug hunt of 2026-10-05 found the other heavy lifts: a
 * leg press or a sled goes past 500, a Hevy import carried such sets in, and
 * the loader then dropped them for good. 600 is past what anyone moves in one
 * set (user, 2026-10-05). It exists so a stuck button, a fat finger or a typo
 * cannot write a number that breaks every chart it reaches.
 */
export const WEIGHT_DIAL_MAX_KG = 600;

/**
 * Could a person have lifted this?
 *
 * Zero is a real pull-up, so the floor is zero and not one. Everything above
 * the ceiling — and anything negative — is an artefact of a bug, never a
 * record of a set.
 */
export function isLiftableWeight(kg: unknown): kg is number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= 0 && kg <= WEIGHT_DIAL_MAX_KG;
}

/**
 * The largest stored reps number, in whatever unit the reps are in.
 *
 * A hold stores its seconds in the reps field, so this is the hold dial's
 * ceiling (`HOLD_DIAL.max` in weightDial — which cannot be imported here
 * without closing the cycle described above; a test pins the two equal). The
 * reps dial stops far below it at 300. Every loader of a stored rep TARGET
 * reads this one number: the logged plan, a "last time" rep target and a
 * programme row (duplicate sweep 13, D6-3). It was 1000 in three places, none
 * shared, while the dial wrote holds up to 1800 s. A recorded set has no
 * ceiling (isRecordedReps): an import writes counts no dial could.
 */
export const MAX_STORED_REPS = 1800;

/**
 * Could a plan have asked for this many reps (or seconds)?
 *
 * For targets only: a rep or hold target, a planned set. The dials that set
 * them stop at MAX_STORED_REPS, so a target past it is a stuck button. Zero
 * is the floor, as the weight's is. Not required whole.
 */
export function isPlannedReps(reps: unknown): reps is number {
  return isRecordedReps(reps) && reps <= MAX_STORED_REPS;
}

/**
 * Could a set have been recorded with this many reps (or seconds, minutes)?
 *
 * No ceiling. The player's dials stop at MAX_STORED_REPS, but the Hevy import
 * writes whatever the export held (a 2000-rep jump-rope set), and a loader
 * that dropped it lost a real set on the next save (dup sweep 13 review, R1).
 * A negative or non-finite count is no set — it summed into a negative
 * session volume (D6-2). Zero is a set not filled in yet, and is kept.
 */
export function isRecordedReps(reps: unknown): reps is number {
  return typeof reps === 'number' && Number.isFinite(reps) && reps >= 0;
}

/** The most sets one exercise of a programme can ask for. */
export const MAX_STORED_SETS = 20;

/**
 * A stored count of sets (or a rep target) as a whole number from 1 to `max`,
 * or undefined. Dropped rather than rounded: a lighter session's 2.5 planned
 * sets is no plan anybody made (D6-8). A programme row's own counts are
 * rounded and clamped instead (database.ts wholeCount), because a row needs a
 * number to exist at all.
 */
export function positiveWholeCount(value: unknown, max: number = MAX_STORED_SETS): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : undefined;
}

/**
 * The window a stored body weight has to fall in to be read back.
 *
 * Wider than either screen that writes one (onboarding's 35–220, the weigh-in
 * ruler's 30–250): a loader that dropped a real 28 kg child or a 260 kg
 * lifter would delete their history, while a negative or a 5000 kg number is
 * only ever a damaged or foreign file (D6-6).
 */
export const BODYWEIGHT_MIN_KG = 20;
export const BODYWEIGHT_MAX_KG = 400;

export function isPlausibleBodyweightKg(kg: unknown): kg is number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= BODYWEIGHT_MIN_KG && kg <= BODYWEIGHT_MAX_KG;
}
