import { WorkoutTemplateV1 } from '../features/workout/workoutTypes';
import { I18nKey } from './i18n';
import { AFFINITY_REASON_KEYS, resolveProgramAffinity } from './programAffinity';

/**
 * Keeping "Sinulle" honest after you act on it.
 *
 * The row came from the questionnaire and never moved again: adopt the
 * programme it recommended and it kept recommending it, next to a card saying
 * "valittu sinulle" for something you were already running. Two slots, one of
 * them permanently spent.
 *
 * So a programme you have taken leaves the row, and the gap is filled from the
 * catalog — measured from what you are running NOW rather than from what you
 * answered in a form months ago. resolveProgramAffinity ranks its reasons, and
 * "same goal, one level up" is the first of them, so the replacement is
 * usually a step up. Usually, not always: if the catalog has no harder
 * programme for that goal it offers a different split rather than inventing a
 * level, because "haastavampi" has to be true of the programme and not just of
 * the label on the card.
 *
 * Nothing here is a score and nothing is random. Same inputs, same row.
 */

interface RecommendationSlot {
  templateId: string;
  /** The sentence under the name — always derived, never written per card. */
  whyKey: I18nKey;
}

interface RecommendationBackfillInput {
  /** The questionnaire's picks, in order: primary, then alternative. */
  picks: readonly RecommendationSlot[];
  /** Programmes the reader is running — these have been chosen already. */
  adoptedIds: readonly string[];
  /**
   * What the replacement steps up FROM: the programme being trained now.
   * Null means there is nothing to step up from, so nothing is backfilled —
   * the row shrinks rather than guessing.
   */
  anchor: WorkoutTemplateV1 | null;
  catalog: readonly WorkoutTemplateV1[];
  /** How many cards the row holds. */
  limit: number;
}

export function backfillRecommendations(input: RecommendationBackfillInput): RecommendationSlot[] {
  const adopted = new Set(input.adoptedIds);
  const kept: RecommendationSlot[] = [];
  const seen = new Set<string>();

  for (const pick of input.picks) {
    if (adopted.has(pick.templateId) || seen.has(pick.templateId)) {
      continue;
    }
    seen.add(pick.templateId);
    kept.push(pick);
    if (kept.length >= input.limit) {
      return kept;
    }
  }

  if (!input.anchor) {
    return kept;
  }

  // Asked for the whole ranked list rather than the exact shortfall: the first
  // matches can be programmes already in the row or already adopted, and
  // asking for two and dropping both would leave the gap it was meant to fill.
  for (const match of resolveProgramAffinity(input.anchor, input.catalog, input.catalog.length)) {
    if (adopted.has(match.templateId) || seen.has(match.templateId)) {
      continue;
    }
    seen.add(match.templateId);
    kept.push({ templateId: match.templateId, whyKey: AFFINITY_REASON_KEYS[match.reason] });
    if (kept.length >= input.limit) {
      break;
    }
  }

  return kept;
}
