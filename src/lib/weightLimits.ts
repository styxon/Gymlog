/**
 * The ceiling on a single set's weight, and the question "could this number
 * have been lifted?"
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
