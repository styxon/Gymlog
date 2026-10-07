import { rankProgramIdsByTailoring, TailoringPreferencesInput } from './tailoringFit';
import {
  RECOMMENDATION_PROGRAMS,
  getRecommendationProgramDefinition,
  isRecoveryOnlyProgram,
  readerAskedForRecovery,
} from './recommendationCatalog';
import { selectWaterfallDecision } from './recommendationWaterfall';
import { programRunStandInKind, splitsReaderWeek } from './recommendationWeekFit';
import { buildRecommendationTrainingBlock } from './recommendationProgramme';
import { evaluateWorkoutContentFit } from './workoutContentFit';
import { equipmentCandidatePool, programGearUse, programsIgnoringOwnedLoad } from './programEquipmentFit';
import type { I18nKey } from './i18n';
import type {
  RecommendationCandidate,
  RecommendationConfidence,
  RecommendationInput,
  RecommendationProgramDefinition,
  RecommendationResult,
  RecommendationScoreBreakdown,
} from '../types/recommendation';

function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function scoreGoalAlignment(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  let score = 0;

  if (definition.supportedGoals.includes(input.goal)) {
    score += 24;
  } else if (definition.backupGoals.includes(input.goal)) {
    score += 9;
  } else if (input.goal === 'general' || input.goal === 'general_fitness' || input.goal === 'lean_athletic') {
    score += 6;
  } else {
    score += 2;
  }

  for (const outcome of input.secondaryOutcomes) {
    if (definition.secondaryOutcomeTags.includes(outcome)) {
      score += outcome === 'consistency' ? 2 : 3;
    }
  }

  if (input.goal === 'muscle' && definition.styleTags.includes('pump')) {
    score += 2;
  }

  if (input.profile.goalType === 'hypertrophy' && input.profile.weightDirection === 'gain' && definition.styleTags.includes('pump')) {
    score += 2;
  }

  if (input.goal === 'strength' && definition.styleTags.includes('heavy')) {
    score += 2;
  }

  if ((input.goal === 'run_mobility' || input.goal === 'lean_athletic') && definition.styleTags.includes('conditioning')) {
    score += 2;
  }

  return clampScore(score, 0, 30);
}

function scoreScheduleFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  const dayDifference = Math.abs(definition.daysPerWeek - input.daysPerWeek);
  let score =
    input.daysPerWeek >= 6
      ? dayDifference === 0
        ? 22
        : dayDifference === 1
          ? 8
          : dayDifference === 2
            ? 1
            : -8
      : dayDifference === 0
        ? 13
        : dayDifference === 1
          ? 6
          : dayDifference === 2
            ? 1
            : 0;

  const preferredMinutes = input.preferredSessionMinutes ?? definition.estimatedSessionMinutes;
  const durationDifference = Math.abs(definition.estimatedSessionMinutes - preferredMinutes);

  score += durationDifference <= 5 ? 8 : durationDifference <= 10 ? 6 : durationDifference <= 20 ? 4 : 2;

  if (input.wantsConsistency && definition.lowFriction) {
    score += 2;
  }

  return input.daysPerWeek >= 6 ? clampScore(score, -8, 30) : clampScore(score, 0, 20);
}

function scoreEquipmentFit(definition: RecommendationProgramDefinition, input: RecommendationInput, ignoresLoad: boolean) {
  // A week that leaves the reader's barbell or dumbbells unused while another
  // that serves their goal uses them (review, 2026-10-05).
  if (ignoresLoad) {
    return 0;
  }
  if (input.equipment === 'gym') {
    return definition.equipmentTier === 'full_gym' ? 15 : 12;
  }

  // On the low-equipment shelf every programme scored the same 15, so a
  // dumbbell owner's no-equipment plan tied with the dumbbell one. Using the
  // gear they own is what sets them apart (recommendation matrix, 2026-10-05).
  if (definition.equipmentTier !== 'low_equipment') {
    return 0;
  }
  return 10 + Math.round(5 * programGearUse(definition.programId, input.availableEquipment));
}

function scoreExperienceFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  if (definition.supportedLevels.includes(input.level)) {
    return 10;
  }

  return input.level === 'beginner' ? 2 : input.level === 'pro' ? 6 : 5;
}

function scoreGenderFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  if (input.gender === 'unspecified') {
    return definition.targetGender === 'unisex' ? 5 : 1;
  }

  if (definition.targetGender === input.gender) {
    return 5;
  }

  if (definition.targetGender === 'unisex') {
    return 3;
  }

  return -4;
}

function scorePreferenceFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  let score = 0;

  if (input.secondaryOutcomes.includes('mobility') && definition.jointFriendly) {
    score += 4;
  }

  /**
   * The age band, finally deciding something.
   *
   * Deliberately small, and deliberately one-directional. A reader in the top
   * band gets joint-friendly programmes nudged UP; nobody gets anything pushed
   * down for being young, because a joint-friendly programme is a good
   * programme at any age and the opposite rule would be a judgement about the
   * reader rather than about the training.
   *
   * Smaller than the mobility bonus above on purpose: what someone ASKED for
   * has to outrank what was inferred about them. The two stack, so a reader
   * over 41 who also asked for mobility gets both — which is the case where
   * the inference and the request agree.
   */
  if (input.ageRange === '41_plus' && definition.jointFriendly) {
    score += 3;
  }

  if (input.secondaryOutcomes.includes('conditioning') && definition.styleTags.includes('conditioning')) {
    score += 4;
  }

  if (input.profile.setupContext === 'outdoor_running' && definition.styleTags.includes('conditioning')) {
    score += 2;
  }

  if (input.secondaryOutcomes.includes('consistency') && definition.lowFriction) {
    score += 2;
  }

  if (input.profile.goalType === 'fat_loss' && definition.lowFriction) {
    score += 2;
  }

  if (input.goal === 'strength' && definition.recoveryDemand === 'high' && input.level === 'beginner') {
    score -= 2;
  }

  if (input.profile.goalType === 'fat_loss' && definition.recoveryDemand === 'high' && input.level === 'beginner') {
    score -= 2;
  }

  return clampScore(score, 0, 10);
}

function scoreFocusFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  if (input.focusAreas.length === 0) {
    return 2;
  }

  const matches = input.focusAreas.filter((area) => definition.focusAreaTags.includes(area)).length;
  if (matches === 0) {
    return 0;
  }

  return clampScore(matches * 3, 0, 5);
}

function scoreContentFit(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  const fit = evaluateWorkoutContentFit(definition.programId, {
    goalType: input.profile.goalType,
    setupContext: input.profile.setupContext,
    availableEquipment: input.availableEquipment ?? null,
  });

  if (fit.issues.length > 0) {
    return clampScore(-12 * fit.issues.length, -30, 10);
  }

  let score = 0;

  if (input.profile.goalType === 'strength' && fit.signals.hasLowRepLoadedAnchors) {
    score += 6;
  }

  if (input.profile.goalType === 'hypertrophy' && fit.signals.hasHypertrophyVolume) {
    score += 6;
  }

  if (input.profile.goalType === 'fat_loss') {
    score += 5;
  }

  if (input.profile.goalType === 'endurance' && fit.signals.hasRunWork && fit.signals.hasMobilityWork) {
    score += 7;
  }

  if ((input.profile.setupContext === 'home_limited' || input.profile.setupContext === 'bodyweight' || input.profile.setupContext === 'outdoor_running') && !fit.signals.hasFullGymOnlyExercises) {
    score += 4;
  }

  return clampScore(score, -30, 10);
}

function buildBreakdown(
  definition: RecommendationProgramDefinition,
  input: RecommendationInput,
  ignoresLoad = false,
): RecommendationScoreBreakdown {
  return {
    goalAlignment: scoreGoalAlignment(definition, input),
    scheduleFit: scoreScheduleFit(definition, input),
    equipmentFit: scoreEquipmentFit(definition, input, ignoresLoad),
    experienceFit: scoreExperienceFit(definition, input),
    genderFit: scoreGenderFit(definition, input),
    preferenceFit: scorePreferenceFit(definition, input),
    focusFit: scoreFocusFit(definition, input),
    contentFit: scoreContentFit(definition, input),
  };
}

function sumBreakdown(breakdown: RecommendationScoreBreakdown) {
  return (
    breakdown.goalAlignment +
    breakdown.scheduleFit +
    breakdown.equipmentFit +
    breakdown.experienceFit +
    breakdown.genderFit +
    breakdown.preferenceFit +
    breakdown.focusFit +
    breakdown.contentFit
  );
}

function applyEquipmentFilter(input: RecommendationInput) {
  return equipmentCandidatePool(RECOMMENDATION_PROGRAMS, input);
}

function stableSortCandidates(candidates: RecommendationCandidate[]) {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.programId.localeCompare(right.programId);
  });
}

function hasMeaningfulTailoringPreferences(preferences: TailoringPreferencesInput | null | undefined) {
  if (!preferences) {
    return false;
  }

  return (
    preferences.setupEquipment !== 'gym' ||
    preferences.setupFreeWeightsPreference !== 'neutral' ||
    preferences.setupBodyweightPreference !== 'neutral' ||
    preferences.setupMachinesPreference !== 'neutral' ||
    preferences.setupShoulderFriendlySwaps !== 'neutral' ||
    preferences.setupElbowFriendlySwaps !== 'neutral' ||
    preferences.setupKneeFriendlySwaps !== 'neutral'
  );
}

function applyTailoringOrdering(
  candidates: RecommendationCandidate[],
  tailoringPreferences?: TailoringPreferencesInput | null,
) {
  if (!hasMeaningfulTailoringPreferences(tailoringPreferences) || candidates.length < 2) {
    return candidates;
  }

  const topScore = candidates[0]?.score ?? 0;
  const rerankWindow = candidates.filter((candidate) => topScore - candidate.score <= 4);
  if (rerankWindow.length < 2) {
    return candidates;
  }

  const rerankedIds = rankProgramIdsByTailoring(
    rerankWindow.map((candidate) => candidate.programId),
    tailoringPreferences,
  );
  const rerankedMap = new Map(rerankedIds.map((programId, index) => [programId, index]));
  const rerankedTop = [...rerankWindow].sort((left, right) => {
    return (rerankedMap.get(left.programId) ?? Number.MAX_SAFE_INTEGER) - (rerankedMap.get(right.programId) ?? Number.MAX_SAFE_INTEGER);
  });
  const remaining = candidates.filter((candidate) => !rerankedMap.has(candidate.programId));

  return [...rerankedTop, ...remaining];
}

function resolveConfidence(candidates: RecommendationCandidate[]): RecommendationConfidence {
  if (candidates.length <= 1) {
    return 'high';
  }

  const [first, second] = candidates;
  const gap = first.score - second.score;
  if (first.score >= 74 && gap >= 8) {
    return 'high';
  }

  if (gap >= 4) {
    return 'medium';
  }

  return 'low';
}

function resolveRecommendationConfidence(
  candidates: RecommendationCandidate[],
  featuredDefinition: RecommendationProgramDefinition,
  input: RecommendationInput,
) {
  if (candidates.length === 0) {
    return 0.4;
  }

  const [first, second] = candidates;
  const gap = second ? first.score - second.score : 12;
  const dayMismatchPenalty = featuredDefinition.daysPerWeek !== input.daysPerWeek ? 0.12 : 0;
  const contentPenalty = first.breakdown.contentFit < 0 ? Math.min(0.2, Math.abs(first.breakdown.contentFit) / 100) : 0;
  const base = 0.62 + Math.min(0.2, first.score / 500) + Math.min(0.18, gap / 50);

  return Math.max(0.35, Math.min(1, Number((base - dayMismatchPenalty - contentPenalty).toFixed(2))));
}

function resolveFallbackReason(featuredDefinition: RecommendationProgramDefinition, input: RecommendationInput) {
  if (featuredDefinition.daysPerWeek < input.daysPerWeek) {
    return 'Closest structured plan with optional extra day.';
  }

  if (featuredDefinition.daysPerWeek > input.daysPerWeek) {
    return 'Closest structured plan with a slightly higher weekly rhythm.';
  }

  return null;
}

function fitsLevel(candidate: RecommendationCandidate, input: RecommendationInput) {
  return getRecommendationProgramDefinition(candidate.programId)?.supportedLevels.includes(input.level) ?? false;
}

/**
 * 2 = written for the reader's goal, 1 = the goal is a backup, 0 = neither.
 * The same three tiers the waterfall and the goal score separate.
 */
function goalTier(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  return definition.supportedGoals.includes(input.goal) ? 2 : definition.backupGoals.includes(input.goal) ? 1 : 0;
}

/** The waterfall's home reason for a programme, chosen as step 1 chooses it. */
function homeEquipmentReason(programId: string): I18nKey {
  return getRecommendationProgramDefinition(programId)?.equipmentTier !== 'low_equipment'
    ? 'wf.home_gear.primary'
    : 'wf.home_equipment.primary';
}

/**
 * The reason over a programme whose runs the reader's knee or ankle flag turns
 * into walks or rides, or null when it still runs.
 *
 * Whatever lane picked it: "Running comes first" was printed over a week of
 * stretches for a reader who avoids their knees, and a home reader whose RUN
 * was all walks was told only that nothing in it needed a gym (bug hunt,
 * 2026-10-07, #35). The walks are the thing they did not ask for and need to
 * know about.
 */
function runStandInReason(programId: string, input: RecommendationInput): I18nKey | null {
  const kind = programRunStandInKind(programId, input);
  if (kind === 'ride') {
    return 'wf.run_mobility.ridePrimary';
  }
  return kind === 'walk' ? 'wf.run_mobility.walkPrimary' : null;
}

function selectAlternativeCandidates(candidates: RecommendationCandidate[], input: RecommendationInput) {
  const [featuredCandidate, ...otherCandidates] = candidates;
  if (!featuredCandidate) {
    return [];
  }

  // The level gate the primary pick has (levelFirst), before the day count:
  // a beginner asking for six days was offered HUGE Elite and HUGE Classic as
  // the second card because they were the six-day programmes, with twenty
  // beginner ones in the pool (bug hunt, 2026-10-05, B2). Off-level
  // programmes are offered only when nothing at the reader's level is left.
  const levelFitting = otherCandidates.filter((candidate) => fitsLevel(candidate, input));
  const remainingCandidates = levelFitting.length > 0 ? levelFitting : otherCandidates;

  const sameDayAlternatives = remainingCandidates.filter((candidate) => {
    const definition = getRecommendationProgramDefinition(candidate.programId);
    return definition?.daysPerWeek === input.daysPerWeek;
  });
  const orderedAlternatives = sameDayAlternatives.length > 0 ? [...sameDayAlternatives] : [...remainingCandidates];

  // Programmes that serve the reader's goal (written for it, or as a backup)
  // ahead of those that do not, score order kept within each. The level gate
  // above narrowed the pool, and a pro strength reader at home was handed RUN
  // as the second card because it was the first three-day programme left
  // (review of B2, 2026-10-06).
  const servesGoal = (candidate: RecommendationCandidate) => {
    const definition = getRecommendationProgramDefinition(candidate.programId);
    return definition ? goalTier(definition, input) > 0 : false;
  };
  return [
    ...orderedAlternatives.filter(servesGoal),
    ...orderedAlternatives.filter((candidate) => !servesGoal(candidate)),
  ].slice(0, 2);
}

/**
 * A programme written for one gender is shown only to that gender (user,
 * 2026-10-05): a reader who left it unsaid sees neither. The score only took
 * 4 points off a mismatch, so with some gym chips unticked a female programme
 * still reached an unspecified reader (recommendation matrix, 2026-10-05).
 */
function genderAllows(definition: RecommendationProgramDefinition, input: RecommendationInput) {
  return definition.targetGender === 'unisex' || definition.targetGender === input.gender;
}

/**
 * The candidates a reader at this level should see first, in score order.
 *
 * Within each level, a stretching-only week goes after the rest unless the
 * reader asked for one (readerAskedForRecovery). When the waterfall's pick is
 * not among the candidates the score alone chooses, and a gym member with only
 * dumbbells ticked who asked for general fitness at five days was handed the
 * five-day mobility flow (bug hunt, 2026-10-07).
 *
 * A split the reader's short week cuts in half goes after every week that
 * fits it, as in the waterfall, where it costs more than a wrong level. The
 * score alone handed a two-day woman with machines and cables the three-day
 * arms block, whose Arms (Volume) and Arms (Heavy) are a week with no legs,
 * with the two-day full body on the same screen (review, 2026-10-08).
 */
function levelFirst(candidates: RecommendationCandidate[], input: RecommendationInput) {
  const askedForRecovery = readerAskedForRecovery(input);
  const rank = (candidate: RecommendationCandidate) => {
    const definition = getRecommendationProgramDefinition(candidate.programId);
    const recoveryOnly = !askedForRecovery && definition !== null && isRecoveryOnlyProgram(definition);
    const splitsWeek = definition !== null && splitsReaderWeek(definition, input);
    return (splitsWeek ? 4 : 0) + (fitsLevel(candidate, input) ? 0 : 2) + (recoveryOnly ? 1 : 0);
  };
  return [0, 1, 2, 3, 4, 5, 6, 7].flatMap((tier) => candidates.filter((candidate) => rank(candidate) === tier));
}

export function recommendPrograms(
  input: RecommendationInput,
  tailoringPreferences?: TailoringPreferencesInput | null,
): RecommendationResult {
  const equipmentFiltered = applyEquipmentFilter(input);
  const genderFiltered = equipmentFiltered.filter((definition) => genderAllows(definition, input));
  const filteredPrograms = genderFiltered.length > 0 ? genderFiltered : equipmentFiltered;
  const ignoringLoad = programsIgnoringOwnedLoad(filteredPrograms, input);
  const scoredCandidates = filteredPrograms.map((definition) => {
    const breakdown = buildBreakdown(definition, input, ignoringLoad.has(definition.programId));

    return {
      programId: definition.programId,
      familyId: definition.familyId,
      breakdown,
      score: sumBreakdown(breakdown),
    };
  });

  // The level is a fit, not a preference: when the waterfall's pick is not
  // among the candidates, the score alone chose, and a beginner was handed a
  // pro programme four points behind (recommendation matrix, 2026-10-05).
  const scoreRankedCandidates = levelFirst(
    applyTailoringOrdering(stableSortCandidates(scoredCandidates), tailoringPreferences),
    input,
  );

  // Onboarding Rules v2: the waterfall decides which family the user lands in;
  // scoring keeps ranking everything else (alternatives, confidence, tradeoffs).
  const waterfallDecision = selectWaterfallDecision(input);
  let waterfallPrimary = scoreRankedCandidates.find((candidate) => candidate.programId === waterfallDecision.primaryProgramId) ?? null;
  const waterfallPick = waterfallPrimary;
  if (waterfallPrimary && hasMeaningfulTailoringPreferences(tailoringPreferences)) {
    // Tailoring may swap between variants of the same family + weekly rhythm
    // (e.g. the two 4-day STRONG Pro templates), but never change the cell itself.
    const primaryDefinition = getRecommendationProgramDefinition(waterfallPrimary.programId);
    const cellCandidates = scoreRankedCandidates.filter((candidate) => {
      const definition = getRecommendationProgramDefinition(candidate.programId);
      // And the same answers: the low-equipment and recomp families are
      // catch-alls, and the swap handed a general-fitness reader the run
      // programme (recommendation matrix, 2026-10-05).
      //
      // The goal guard compares tiers, not "lists it or not". It let anything
      // through once the waterfall's pick did not list the goal outright, so
      // Runner's Strength (general fitness as a backup) was swapped for RUN
      // (general fitness nowhere) — bug hunt, 2026-10-05, B3. A swap may keep
      // or raise how well the pick serves the goal, never lower it.
      //
      // The gear the same way. Away from a gym the tailoring order puts the
      // low-equipment variant first, and a home reader with a barbell, a rack
      // and dumbbells had SHRED, the waterfall's pick, swapped for RUN, which
      // uses none of it, under "built around the gear you said you have at
      // home" (bug hunt, 2026-10-07). A swap keeps or raises how much of the
      // reader's gear the week uses, and does not leave their load unused
      // where the pick did not. Not for running and mobility: leaving the load
      // unused is the ask there (programsIgnoringOwnedLoad), and the swap to
      // the running week is the one the reader wants.
      return Boolean(
        definition
        && primaryDefinition
        && definition.familyId === primaryDefinition.familyId
        && definition.daysPerWeek === primaryDefinition.daysPerWeek
        && goalTier(definition, input) >= goalTier(primaryDefinition, input)
        && (definition.supportedLevels.includes(input.level) || !primaryDefinition.supportedLevels.includes(input.level))
        && (input.equipment === 'gym'
          || input.goal === 'run_mobility'
          || programGearUse(definition.programId, input.availableEquipment)
            >= programGearUse(primaryDefinition.programId, input.availableEquipment))
        && (!ignoringLoad.has(definition.programId) || ignoringLoad.has(primaryDefinition.programId))
        && (!isRecoveryOnlyProgram(definition) || isRecoveryOnlyProgram(primaryDefinition)),
      );
    });
    // The variant written for the goal first, then the tailoring's order.
    const bestTier = Math.max(
      -1,
      ...cellCandidates.map((candidate) => {
        const definition = getRecommendationProgramDefinition(candidate.programId);
        return definition ? goalTier(definition, input) : -1;
      }),
    );
    const cellTop = cellCandidates.find((candidate) => {
      const definition = getRecommendationProgramDefinition(candidate.programId);
      return definition ? goalTier(definition, input) === bestTier : false;
    });
    if (cellTop) {
      waterfallPrimary = cellTop;
    }
  }
  const waterfallSecond = waterfallDecision.alternativeProgramId
    ? scoreRankedCandidates.find((candidate) => candidate.programId === waterfallDecision.alternativeProgramId) ?? null
    : null;
  // The swap can promote the waterfall's own second card: home, strength,
  // advanced, four days put powerbuilding first and second, and the reader
  // saw one card where there were two (review, 2026-10-07). The two trade
  // places then. The reasons stay: they speak of the cell ("built around your
  // gear", "a different rhythm with the same gear"), which both share; only
  // the home reason follows the tier of the programme it is printed over.
  const promotedSecond = Boolean(waterfallSecond && waterfallSecond === waterfallPrimary && waterfallPick !== waterfallPrimary);
  const waterfallAlternativeCandidate = promotedSecond ? waterfallPick : waterfallSecond;
  // The waterfall's second card answers to the same level gate as the rest
  // of the alternatives (selectAlternativeCandidates): off the reader's level
  // it is dropped while anything at their level is left to offer (B2).
  const waterfallAlternative =
    waterfallAlternativeCandidate
    && (fitsLevel(waterfallAlternativeCandidate, input)
      || !scoreRankedCandidates.some(
        (candidate) => candidate !== waterfallPrimary && fitsLevel(candidate, input),
      ))
      ? waterfallAlternativeCandidate
      : null;
  const standInReason = waterfallPrimary ? runStandInReason(waterfallPrimary.programId, input) : null;
  const appliedWaterfall = waterfallPrimary
    ? {
        ...waterfallDecision,
        primaryProgramId: waterfallPrimary.programId,
        ...(promotedSecond && waterfallPick ? { alternativeProgramId: waterfallPick.programId } : {}),
        // The home reason names the tier ("built around your gear", "nothing
        // in it needs a gym"), so it follows a swap that changed the tier.
        ...(waterfallDecision.rule === 'home_equipment' && waterfallPrimary !== waterfallPick
          ? { whyPrimary: homeEquipmentReason(waterfallPrimary.programId) }
          : {}),
        // The Programs tab's row reads the second card from here, so a card
        // the level gate dropped leaves this too, with its reason.
        ...(waterfallAlternativeCandidate && !waterfallAlternative
          ? { alternativeProgramId: null, whyAlternative: null }
          : {}),
        ...(standInReason ? { whyPrimary: standInReason } : {}),
      }
    : null;
  const rankedCandidates = waterfallPrimary
    ? [
        waterfallPrimary,
        ...(waterfallAlternative ? [waterfallAlternative] : []),
        ...scoreRankedCandidates.filter(
          (candidate) => candidate !== waterfallPrimary && candidate !== waterfallAlternative,
        ),
      ]
    : scoreRankedCandidates;

  const featuredCandidate = rankedCandidates[0] ?? null;
  const alternativeCandidates = waterfallPrimary && waterfallAlternative
    ? [waterfallAlternative, ...selectAlternativeCandidates(rankedCandidates, input).filter((candidate) => candidate !== waterfallAlternative)].slice(0, 2)
    : selectAlternativeCandidates(rankedCandidates, input);
  const alternativeProgramIds = alternativeCandidates.map((candidate) => candidate.programId);

  if (!featuredCandidate) {
    const fallback = getRecommendationProgramDefinition('tpl_2_day_minimal_full_body_v1');
    if (!fallback) {
      throw new Error('Recommendation fallback program is missing.');
    }

    return {
      featuredProgramId: fallback.programId,
      secondaryProgramId: null,
      alternativeProgramIds: [],
      confidence: 'low',
      recommendationConfidence: 0.35,
      fallbackReason: 'Fallback plan used because no scored recommendation was available.',
      trainingBlock: buildRecommendationTrainingBlock(fallback.programId),
      primaryFamilyId: fallback.familyId,
      scoredCandidates: [],
      waterfall: null,
    };
  }

  const featuredDefinition = getRecommendationProgramDefinition(featuredCandidate.programId);
  if (!featuredDefinition) {
    throw new Error(`Recommendation program definition is missing for ${featuredCandidate.programId}.`);
  }

  return {
    featuredProgramId: featuredCandidate.programId,
    secondaryProgramId: alternativeProgramIds[0] ?? null,
    alternativeProgramIds,
    confidence: resolveConfidence(rankedCandidates),
    recommendationConfidence: resolveRecommendationConfidence(rankedCandidates, featuredDefinition, input),
    fallbackReason: resolveFallbackReason(featuredDefinition, input),
    trainingBlock: buildRecommendationTrainingBlock(featuredCandidate.programId),
    primaryFamilyId: featuredCandidate.familyId,
    scoredCandidates: rankedCandidates,
    waterfall: appliedWaterfall,
  };
}
