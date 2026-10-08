const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { buildRecommendationInput } = require(dist + 'lib/recommendationInput.js');
const { selectWaterfallDecision } = require(dist + 'lib/recommendationWaterfall.js');
const {
  getRecommendationProgramDefinition,
  isRecoveryOnlyProgram,
  RECOMMENDATION_PROGRAMS,
} = require(dist + 'lib/recommendationCatalog.js');
const { lowerBodyOnlyAgainstFocus, trainsLowerBodyOnly } = require(dist + 'lib/recommendationWeekFit.js');
const { classifySessionFocus } = require(dist + 'lib/homeSessionHero.js');
const { t } = require(dist + 'lib/i18n.js');

/**
 * Recommender fit (round 3 persona hunt, 2026-10-08).
 *
 * - A woman who wanted muscle or general fitness was featured Glute
 *   Foundations by the -1 gender tie-break alone: three lower-body days, not
 *   one set for the chest, back or shoulders, where a man with the same
 *   answers got a full week. Picking a lower-body focus keeps it.
 * - "Lean & athletic" went to the women's physique programmes, none of which
 *   lists the goal, under "Balanced strength and conditioning" with no
 *   conditioning in them. Women now get the pick men get from the
 *   conditioning lane.
 * - The lean line said the plan drives fat loss for a reader who never said so.
 * - The gym beginner's second card was the bodyweight starter, "without
 *   needing a gym".
 */

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const GEARS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  homeDumbbells: {
    equipment: 'minimal',
    trainingEnvironment: 'minimal_equipment',
    equipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'],
  },
};
const NEUTRAL_TAILORING = {
  setupEquipment: null,
  setupFreeWeightsPreference: 'neutral',
  setupBodyweightPreference: 'neutral',
  setupMachinesPreference: 'neutral',
  setupShoulderFriendlySwaps: 'neutral',
  setupElbowFriendlySwaps: 'neutral',
  setupKneeFriendlySwaps: 'neutral',
};

function selection({ gear = GEARS.gym, ...rest }) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    equipment: gear.equipment,
    trainingEnvironment: gear.trainingEnvironment,
    equipmentItems: gear.equipmentItems,
    gender: 'female',
    focusAreas: [],
    cautionFlags: [],
    availableDays: [],
    ...rest,
    goals: [rest.goal],
  };
}

function featured(sel) {
  return resolveFirstRunRecommendationWithTailoring(sel, NEUTRAL_TAILORING, 'en');
}

const GLUTE_FOUNDATIONS = 'tpl_gainer_glute_foundations_v1';

module.exports = [
  {
    name: 'recommender fit: only Glute Foundations trains the lower body and nothing else',
    run() {
      const lowerOnly = RECOMMENDATION_PROGRAMS.filter((definition) => trainsLowerBodyOnly(definition.programId)).map(
        (definition) => definition.programId,
      );
      assert.deepEqual(lowerOnly, [GLUTE_FOUNDATIONS]);
      // The rule asks the reader's focus, and a run or mobility ask is not it.
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: [] }), true);
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: ['chest', 'back'] }), true);
      for (const area of ['glutes', 'legs', 'quads', 'hamstrings', 'calves']) {
        assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'muscle', focusAreas: [area] }), false, area);
      }
      assert.equal(lowerBodyOnlyAgainstFocus(GLUTE_FOUNDATIONS, { goal: 'run_mobility', focusAreas: [] }), false);
      assert.equal(lowerBodyOnlyAgainstFocus('tpl_3_day_full_body_v1', { goal: 'muscle', focusAreas: [] }), false);
    },
  },
  {
    name: 'recommender fit: a woman who wants muscle or general fitness is not handed a week with no upper body',
    run() {
      for (const gearName of Object.keys(GEARS)) {
        for (const goal of ['muscle', 'general_fitness']) {
          for (const focusAreas of [[], ['chest'], ['back', 'shoulders']]) {
            for (const days of [2, 3, 4, 5]) {
              const sel = selection({ gear: GEARS[gearName], goal, level: 'beginner', daysPerWeek: days, focusAreas });
              const label = `${gearName} ${goal} ${days}d focus ${focusAreas.join('+') || 'none'}`;
              const result = featured(sel);
              assert.notEqual(result.featuredProgramId, GLUTE_FOUNDATIONS, label);
              const week = composeProgramWeekForSelection(sel, result.featuredProgramId);
              const upperDays = week.sessions.filter((session) =>
                session.exercises.some((exercise) => {
                  const kind = classifySessionFocus([exercise.exerciseName]);
                  return kind !== 'lower' && kind !== 'general';
                }),
              );
              assert.ok(upperDays.length >= 1, `${label}: the week trains no upper body`);
            }
          }
        }
      }
    },
  },
  {
    name: 'recommender fit: a woman who picks a lower-body focus still gets Glute Foundations, and a man never does',
    run() {
      for (const focus of ['glutes', 'legs', 'hamstrings']) {
        const sel = selection({ goal: 'muscle', level: 'beginner', daysPerWeek: 3, focusAreas: [focus] });
        assert.equal(featured(sel).featuredProgramId, GLUTE_FOUNDATIONS, focus);
        const general = selection({ goal: 'general_fitness', level: 'beginner', daysPerWeek: 3, focusAreas: [focus] });
        assert.equal(featured(general).featuredProgramId, GLUTE_FOUNDATIONS, `${focus} general`);
      }
      const man = selection({ gender: 'male', goal: 'muscle', level: 'beginner', daysPerWeek: 3, focusAreas: ['glutes'] });
      assert.notEqual(featured(man).featuredProgramId, GLUTE_FOUNDATIONS);
    },
  },
  {
    name: 'recommender fit: a woman wanting lean & athletic gets a programme that lists the goal and holds conditioning',
    run() {
      for (const level of ['advanced', 'pro']) {
        for (const days of [2, 3, 4, 5, 6]) {
          const input = buildRecommendationInput(selection({ goal: 'lean_athletic', level, daysPerWeek: days }));
          const decision = selectWaterfallDecision(input);
          const label = `${level} ${days}d`;
          assert.equal(decision.rule, 'lean_athletic', label);
          const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
          assert.ok(primary.supportedGoals.includes('lean_athletic'), `${label}: ${primary.programId} does not list the goal`);
          assert.ok(primary.styleTags.includes('conditioning'), `${label}: ${primary.programId} has no conditioning`);
          assert.notEqual(primary.familyId, 'glute_priority', label);
        }
      }
    },
  },
  {
    name: 'recommender fit: the lean & athletic line speaks of fat loss only for a reader whose target is a loss',
    run() {
      const lean = (extra) =>
        selectWaterfallDecision(
          buildRecommendationInput(selection({ gender: 'male', goal: 'lean_athletic', level: 'advanced', daysPerWeek: 4, ...extra })),
        );
      const plain = lean({});
      assert.equal(plain.rule, 'lean_athletic');
      for (const language of ['en', 'fi']) {
        for (const key of [plain.whyPrimary, plain.whyAlternative]) {
          assert.doesNotMatch(t(language, key), /fat loss|rasvanpol/i, `${language}: ${key}`);
        }
      }
      const loss = lean({ currentWeightKg: 80, targetWeightKg: 74 });
      assert.equal(loss.whyPrimary, 'wf.lean_athletic.primaryLoss');
      assert.equal(loss.whyAlternative, 'wf.lean_athletic.altLoss');
      assert.match(t('en', loss.whyPrimary), /fat loss/i);
      assert.match(t('fi', loss.whyPrimary), /rasvanpol/i);
    },
  },
  {
    name: 'recommender fit: a gym beginner at three days or more is not offered the bodyweight starter as the second card',
    run() {
      for (const gender of ['female', 'male']) {
        for (const goal of ['strength', 'muscle', 'lean_athletic']) {
          for (const days of [3, 4, 5, 6]) {
            const sel = selection({ gender, goal, level: 'beginner', daysPerWeek: days });
            const decision = selectWaterfallDecision(buildRecommendationInput(sel));
            if (decision.alternativeProgramId) {
              const alt = getRecommendationProgramDefinition(decision.alternativeProgramId);
              assert.notEqual(alt.equipmentTier, 'low_equipment', `${gender} ${goal} ${days}d: ${alt.programId}`);
            }
          }
        }
      }
      // The two-day gym reader keeps it, as the 2-day base.
      const twoDay = selectWaterfallDecision(
        buildRecommendationInput(selection({ goal: 'strength', level: 'beginner', daysPerWeek: 2 })),
      );
      assert.equal(twoDay.alternativeProgramId, 'tpl_2_day_minimal_full_body_v1');
    },
  },
  {
    name: 'recommender fit: no second card is a week of stretching for a reader who did not ask for recovery',
    run() {
      const GOALS = ['general', 'general_fitness', 'strength', 'muscle', 'lean_athletic'];
      for (const gearName of Object.keys(GEARS)) {
        for (const gender of ['female', 'male', 'unspecified']) {
          for (const goal of GOALS) {
            for (const level of ['beginner', 'intermediate', 'advanced']) {
              for (const days of [2, 3, 4, 5, 6]) {
                const sel = selection({ gear: GEARS[gearName], gender, goal, level, daysPerWeek: days });
                const result = featured(sel);
                const label = `${gearName} ${gender} ${goal} ${level} ${days}d`;
                const primary = getRecommendationProgramDefinition(result.featuredProgramId);
                if (isRecoveryOnlyProgram(primary)) {
                  continue;
                }
                for (const id of result.alternativeProgramIds) {
                  assert.equal(isRecoveryOnlyProgram(getRecommendationProgramDefinition(id)), false, `${label}: ${id}`);
                }
              }
            }
          }
        }
      }
      // The gym beginner at general fitness keeps two real cards at 4-5 days.
      for (const goal of ['general', 'general_fitness']) {
        for (const days of [4, 5]) {
          const result = featured(selection({ gender: 'male', goal, level: 'beginner', daysPerWeek: days }));
          assert.ok(result.alternativeProgramIds.length >= 1, `${goal} ${days}d`);
        }
      }
      // Asking for mobility still gets it.
      const asked = featured(selection({ gender: 'male', goal: 'general', level: 'beginner', daysPerWeek: 5, secondaryOutcomes: ['mobility'] }));
      assert.ok(
        [asked.featuredProgramId, ...asked.alternativeProgramIds].some((id) => isRecoveryOnlyProgram(getRecommendationProgramDefinition(id))),
      );
    },
  },
];
