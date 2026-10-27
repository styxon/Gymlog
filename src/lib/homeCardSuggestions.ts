import { MeasurementKind, SetupFocusArea, SetupGoal } from '../types/models';

/**
 * What the reader already told us, offered as a card.
 *
 * Onboarding asks which areas they care about and what they are training for,
 * and then nothing ever uses those answers on Home. Someone who said "chest"
 * and "muscle growth" has to find the measurement screen and the card sheet on
 * their own to see either number move.
 *
 * This turns those answers into an offer, never into an action: a suggestion
 * the reader accepts or puts away. Nothing is pinned behind their back — a
 * Home that rearranges itself because of a form filled in weeks ago is not
 * responsive, it is unpredictable.
 */

/** Focus areas that have a tape measurement to match. */
const MEASUREMENT_BY_FOCUS_AREA: Partial<Record<SetupFocusArea, MeasurementKind>> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  arms: 'arms',
  calves: 'calves',
  glutes: 'hips',
  legs: 'thighs',
  quads: 'thighs',
  hamstrings: 'thighs',
  core: 'waist',
};

/**
 * Goals whose progress is legible on the scale.
 *
 * Deliberately not 'strength': a stronger squat shows in the lift's own card,
 * and telling a strength trainee to watch their bodyweight suggests a
 * relationship the app cannot stand behind.
 */
const BODYWEIGHT_GOALS: SetupGoal[] = ['muscle', 'lean_athletic'];

interface CardSuggestionInput {
  focusAreas: readonly SetupFocusArea[];
  goals: readonly (SetupGoal | null)[];
  /** Cards already on Home — never suggest what is already there. */
  pinnedKeys: readonly string[];
  /** Suggestions the reader has already put away. */
  dismissedKeys: readonly string[];
}

/**
 * Card keys worth offering, most specific first: the measurement they named
 * before the general one everybody could use.
 */
export function suggestHomeStatCardKeys(input: CardSuggestionInput): string[] {
  const taken = new Set([...input.pinnedKeys, ...input.dismissedKeys]);
  const suggestions: string[] = [];

  for (const area of input.focusAreas) {
    const measurement = MEASUREMENT_BY_FOCUS_AREA[area];
    if (measurement && !taken.has(measurement) && !suggestions.includes(measurement)) {
      suggestions.push(measurement);
    }
  }

  const wantsScale = input.goals.some((goal) => goal !== null && BODYWEIGHT_GOALS.includes(goal));
  if (wantsScale && !taken.has('bodyweight') && !suggestions.includes('bodyweight')) {
    suggestions.push('bodyweight');
  }

  return suggestions;
}
