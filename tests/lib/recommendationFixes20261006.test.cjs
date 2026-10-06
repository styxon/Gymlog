const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { recommendPrograms } = require('../../.test-dist/lib/recommendationScoring.js');
const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { selectWaterfallDecision } = require('../../.test-dist/lib/recommendationWaterfall.js');
const { getRecommendationProgramDefinition } = require('../../.test-dist/lib/recommendationCatalog.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');

/**
 * The recommender findings of the 2026-10-05 evening hunt, each held as an
 * invariant over the whole answer grid rather than the one example the hunt
 * happened to print, so the next catalog change cannot reopen them quietly.
 */

// The onboarding cards write equipment + trainingEnvironment + equipmentItems
// together (OnboardingScreen.applyEquipmentEnvironment); the same sets the
// accuracy matrix walks (tests/recommendation/recommendationMatrix.cjs).
const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const HEAVY = ['Barbell & plates', 'Squat rack'];
const homeCard = (items) => {
  if (items.length === 0) return { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] };
  const heavy = items.some((item) => HEAVY.includes(item));
  return { equipment: heavy ? 'home' : 'minimal', trainingEnvironment: heavy ? 'home_gym' : 'minimal_equipment', equipmentItems: items };
};
const bodyweightCard = (items) => ({ equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: items });
const gymCard = (items) => ({ equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: items });
const D = 'Dumbbells', B = 'Bench', R = 'Resistance bands', K = 'Kettlebells', P = 'Pull-up bar', BB = 'Barbell & plates', RK = 'Squat rack', C = 'Cardio machines';

const CARDS = [
  gymCard(GYM_ALL),
  gymCard(GYM_ALL.filter((item) => item !== 'Barbells' && item !== 'Squat rack')),
  gymCard(GYM_ALL.filter((item) => item !== 'Machines' && item !== 'Cables')),
  homeCard([]),
  homeCard([D]),
  homeCard([D, B]),
  homeCard([D, B, R]),
  homeCard([D, P]),
  homeCard([D, K]),
  homeCard([D, B, R, P]),
  homeCard([R]),
  homeCard([K]),
  homeCard([P]),
  homeCard([R, P]),
  homeCard([BB, RK]),
  homeCard([BB, RK, B]),
  homeCard([D, B, RK, BB]),
  homeCard([D, B, RK, BB, P]),
  homeCard([D, B, RK, BB, R, K, P]),
  homeCard([D, B, C]),
  bodyweightCard([]),
  bodyweightCard([P]),
  bodyweightCard([R]),
  bodyweightCard([P, R, 'Yoga mat']),
];
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];
// Gender decides only the gender-targeted programmes, which all need a gym or
// a home rack; the other cards are walked once, as an unsaid gender.
const gendersFor = (card) =>
  card.equipment === 'gym' || card.equipmentItems.some((item) => HEAVY.includes(item))
    ? ['unspecified', 'male', 'female']
    : ['unspecified'];

/**
 * Every answer set of the grid, recommended once with the tailoring the
 * onboarding screen passes, and shared by the suites below (about 2400 runs
 * of the recommender, the slow part).
 */
let gridCache = null;
function answerGrid() {
  if (gridCache) {
    return gridCache;
  }
  gridCache = [];
  for (const card of CARDS) {
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        for (const daysPerWeek of DAYS) {
          for (const gender of gendersFor(card)) {
            const selection = {
              ...DEFAULT_FIRST_RUN_SELECTION,
              ...card,
              goal,
              goals: [goal],
              level,
              daysPerWeek,
              gender,
              focusAreas: [],
              secondaryOutcomes: [],
              cautionFlags: [],
              weeklyMinutes: null,
            };
            const tailoring = {
              setupEquipment: selection.equipment,
              setupFreeWeightsPreference: 'neutral',
              setupBodyweightPreference: 'neutral',
              setupMachinesPreference: 'neutral',
              setupShoulderFriendlySwaps: 'neutral',
              setupElbowFriendlySwaps: 'neutral',
              setupKneeFriendlySwaps: 'neutral',
            };
            const input = buildRecommendationInput(selection);
            gridCache.push({
              selection,
              input,
              result: recommendPrograms(input, tailoring),
              label: `${card.equipment}:${card.equipmentItems.join('+') || 'none'} ${goal} ${level} ${daysPerWeek}d ${gender}`,
            });
          }
        }
      }
    }
  }
  return gridCache;
}

const definition = (programId) => getRecommendationProgramDefinition(programId);
/** 2 = written for the goal, 1 = a backup goal, 0 = neither. */
const goalTier = (programId, goal) => {
  const entry = definition(programId);
  return entry.supportedGoals.includes(goal) ? 2 : entry.backupGoals.includes(goal) ? 1 : 0;
};

module.exports = [
  {
    // B2: a beginner, gym, 6 days was offered "HUGE Elite" (advanced/pro) and
    // "HUGE Classic" (pro) as the second card, with twenty beginner
    // programmes in the pool. The alternatives took the day count before
    // the level the primary pick is gated on.
    name: 'recommendation fixes 10-06: no alternative is above or below the reader\'s level while one at it is in the pool',
    run() {
      const offenders = [];
      for (const { selection, result, label } of answerGrid()) {
        const level = selection.level;
        const fitsLevel = (programId) => definition(programId).supportedLevels.includes(level);
        const levelFitAvailable = result.scoredCandidates.some(
          (candidate) => candidate.programId !== result.featuredProgramId && fitsLevel(candidate.programId),
        );
        if (!levelFitAvailable) {
          continue;
        }
        for (const programId of [result.secondaryProgramId, ...result.alternativeProgramIds].filter(Boolean)) {
          if (!fitsLevel(programId)) {
            offenders.push(`${label}: ${programId} (${definition(programId).supportedLevels.join('/')})`);
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} alternatives off the reader's level`);
    },
  },
  {
    // B3: a general-fitness reader at home was handed RUN (run_mobility +
    // general, not general_fitness) because the waterfall's own pick
    // (Runner's Strength) lists general fitness only as a backup, and the
    // tailoring swap's guard let anything in when the pick did not list the
    // goal outright.
    name: 'recommendation fixes 10-06: the tailoring swap never trades the waterfall\'s pick for one that serves the goal less',
    run() {
      const offenders = [];
      let swaps = 0;
      for (const { selection, input, result, label } of answerGrid()) {
        const waterfallPick = selectWaterfallDecision(input).primaryProgramId;
        if (!result.scoredCandidates.some((candidate) => candidate.programId === waterfallPick)) {
          continue; // The waterfall's pick is not in the pool; the score chose, not the swap.
        }
        if (result.featuredProgramId === waterfallPick) {
          continue;
        }
        swaps += 1;
        if (goalTier(result.featuredProgramId, selection.goal) < goalTier(waterfallPick, selection.goal)) {
          offenders.push(`${label}: ${waterfallPick} -> ${result.featuredProgramId}`);
        }
      }
      assert.ok(swaps > 0, 'the grid no longer exercises the swap');
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} swaps away from the reader's goal`);
    },
  },
  {
    name: 'recommendation fixes 10-06: a general-fitness reader at home is not swapped onto RUN, which does not list general fitness',
    run() {
      // The hunt's example: dumbbells, a bench and bands, general fitness, advanced, 3 days.
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        ...homeCard([D, B, R]),
        goal: 'general_fitness',
        goals: ['general_fitness'],
        level: 'advanced',
        daysPerWeek: 3,
        gender: 'unspecified',
        secondaryOutcomes: [],
        focusAreas: [],
        weeklyMinutes: null,
      };
      const result = recommendPrograms(buildRecommendationInput(selection), {
        setupEquipment: selection.equipment,
        setupFreeWeightsPreference: 'neutral',
        setupBodyweightPreference: 'neutral',
        setupMachinesPreference: 'neutral',
        setupShoulderFriendlySwaps: 'neutral',
        setupElbowFriendlySwaps: 'neutral',
        setupKneeFriendlySwaps: 'neutral',
      });
      assert.notEqual(result.featuredProgramId, 'tpl_3_day_run_mobility_v1');
      assert.ok(goalTier(result.featuredProgramId, 'general_fitness') > 0, result.featuredProgramId);
    },
  },
];
