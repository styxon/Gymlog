import { findPhrase, phraseWords, words } from './cautionAreaMatching';

/**
 * Which lifts are one movement under different names, for the places that
 * add a lift to a day and must not add a second of the same.
 *
 * Exact-name checks missed these: a knee-careful week swapped a leg press to
 * Hip Thrust and a lunge to Glute Bridge on the same day, and a curl pair
 * ended as Leg Curl beside Lying Leg Curl (persona hunt, 2026-10-08). The
 * families are deliberately few. A family exists only where two names are
 * the same drill to the reader, not wherever two lifts share a muscle.
 *
 * Pure name matching with the same whole-word rule as the caution areas. The
 * kickbacks are listed by name ("glute kickback", "cable kickback") because a
 * Triceps Kickback is an arm lift.
 */
const FAMILY_PHRASES: ReadonlyArray<[family: string, phrases: readonly string[]]> = [
  ['glute-bridge', ['hip thrust', 'bridge', 'butt lift', 'glute kickback', 'cable kickback']],
  ['leg-curl', ['leg curl', 'hamstring curl', 'nordic']],
];

/** The movement family a lift name belongs to, or null when it has none. */
export function movementFamilyOf(exerciseName: string): string | null {
  const nameWords = words(exerciseName);
  for (const [family, phrases] of FAMILY_PHRASES) {
    if (phrases.some((phrase) => findPhrase(nameWords, phraseWords(phrase)) !== -1)) {
      return family;
    }
  }
  return null;
}
