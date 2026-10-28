const assert = require('node:assert/strict');

const { selectWaterfallDecision } = require('../../src/lib/recommendationWaterfall');
const { getRecommendationProgramDefinition } = require('../../src/lib/recommendationCatalog');

function input(overrides = {}) {
  return {
    goal: 'muscle',
    level: 'advanced',
    daysPerWeek: 4,
    equipment: 'gym',
    gender: 'male',
    profile: {},
    secondaryOutcomes: [],
    focusAreas: [],
    weeklyMinutes: null,
    preferredSessionMinutes: null,
    wantsConsistency: false,
    ...overrides,
  };
}

module.exports = [
  {
    name: 'waterfall: home equipment overrides everything else',
    run() {
      const decision = selectWaterfallDecision(input({ equipment: 'home', goal: 'muscle' }));
      assert.equal(decision.rule, 'home_equipment');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.equal(primary.equipmentTier, 'low_equipment');
      assert.notEqual(decision.alternativeProgramId, decision.primaryProgramId);
    },
  },
  {
    name: 'waterfall: run intent goes to the run program with a balanced alternative',
    run() {
      const decision = selectWaterfallDecision(input({ goal: 'run_mobility', daysPerWeek: 3, level: 'beginner' }));
      assert.equal(decision.rule, 'run_mobility');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.ok(primary.supportedGoals.includes('run_mobility') || primary.backupGoals.includes('run_mobility'));
    },
  },
  {
    name: 'waterfall: experience first — a beginner asking for 5 days never gets a 5-day plan',
    run() {
      const decision = selectWaterfallDecision(input({ level: 'beginner', goal: 'strength', daysPerWeek: 5 }));
      assert.equal(decision.rule, 'beginner_first');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.ok(primary.supportedLevels.includes('beginner'));
      assert.ok(primary.daysPerWeek <= 4, `expected <=4 days, got ${primary.daysPerWeek}`);
    },
  },
  {
    name: 'waterfall: experience beats gender — a female beginner lands on the beginner rule',
    run() {
      const decision = selectWaterfallDecision(input({ level: 'beginner', gender: 'female', goal: 'muscle', daysPerWeek: 3 }));
      assert.equal(decision.rule, 'beginner_first');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.ok(primary.supportedLevels.includes('beginner'));
    },
  },
  {
    name: 'waterfall: experienced women get a women-targeted primary with the goal family as alternative',
    run() {
      const decision = selectWaterfallDecision(input({ gender: 'female', goal: 'muscle', level: 'advanced', daysPerWeek: 4 }));
      assert.equal(decision.rule, 'female_targeted');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.equal(primary.targetGender, 'female');
      assert.ok(decision.alternativeProgramId);
      const alternative = getRecommendationProgramDefinition(decision.alternativeProgramId);
      assert.notEqual(alternative.targetGender, 'female');
    },
  },
  {
    name: 'waterfall: fat-loss goal gets conditioning content, not a bare lifting plan',
    run() {
      const decision = selectWaterfallDecision(input({ goal: 'lean_athletic', level: 'advanced', daysPerWeek: 3 }));
      assert.equal(decision.rule, 'lean_athletic');
      const primary = getRecommendationProgramDefinition(decision.primaryProgramId);
      assert.ok(primary.styleTags.includes('conditioning'));
    },
  },
  {
    name: 'waterfall: focus area sends experienced muscle users to the FOCUS specialisation program',
    run() {
      const decision = selectWaterfallDecision(input({ goal: 'muscle', level: 'advanced', focusAreas: ['chest'] }));
      assert.equal(decision.rule, 'muscle_focus');
      assert.equal(decision.primaryProgramId, 'tpl_focus_chest_program_v1');
      assert.ok(decision.alternativeProgramId);
    },
  },
  {
    name: 'waterfall: muscle and strength lanes are mutual alternatives at the same weekly rhythm',
    run() {
      const muscle = selectWaterfallDecision(input({ goal: 'muscle', daysPerWeek: 4 }));
      assert.equal(muscle.rule, 'muscle');
      const musclePrimary = getRecommendationProgramDefinition(muscle.primaryProgramId);
      assert.equal(musclePrimary.familyId, 'mass_hypertrophy');
      const muscleAlt = getRecommendationProgramDefinition(muscle.alternativeProgramId);
      assert.ok(['strength_base', 'powerbuilding'].includes(muscleAlt.familyId));

      const strength = selectWaterfallDecision(input({ goal: 'strength', daysPerWeek: 4 }));
      assert.equal(strength.rule, 'strength');
      const strengthPrimary = getRecommendationProgramDefinition(strength.primaryProgramId);
      assert.ok(['strength_base', 'powerbuilding'].includes(strengthPrimary.familyId));
    },
  },
  {
    name: 'waterfall: every decision names two different programs or a null alternative',
    run() {
      const variations = [
        input(),
        input({ goal: 'general', level: 'beginner', daysPerWeek: 2 }),
        input({ goal: 'general_fitness', level: 'pro', daysPerWeek: 6 }),
        input({ equipment: 'minimal', goal: 'strength' }),
        input({ gender: 'female', goal: 'lean_athletic', level: 'pro', daysPerWeek: 5 }),
      ];
      for (const variation of variations) {
        const decision = selectWaterfallDecision(variation);
        assert.ok(decision.primaryProgramId);
        assert.ok(getRecommendationProgramDefinition(decision.primaryProgramId));
        if (decision.alternativeProgramId) {
          assert.notEqual(decision.alternativeProgramId, decision.primaryProgramId);
          assert.ok(getRecommendationProgramDefinition(decision.alternativeProgramId));
        }
      }
    },
  },
];
