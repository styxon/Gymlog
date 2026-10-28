const assert = require('node:assert/strict');

const { buildRecommendationProfile } = require('../../src/lib/recommendationProfile');

const baseSelection = {
  gender: 'unspecified',
  age: 30,
  ageRange: '26_35',
  goal: 'strength',
  level: 'advanced',
  daysPerWeek: 3,
  equipment: 'gym',
  secondaryOutcomes: ['consistency'],
  focusAreas: [],
  guidanceMode: 'guided_editable',
  scheduleMode: 'app_managed',
  weeklyMinutes: null,
  availableDays: [],
  currentWeightKg: null,
  targetWeightKg: null,
  unitPreference: 'kg',
};

function selection(overrides) {
  const equipment = overrides.equipment ?? baseSelection.equipment;

  return {
    ...baseSelection,
    ...overrides,
    equipment,
    secondaryOutcomes: overrides.secondaryOutcomes ?? baseSelection.secondaryOutcomes,
    focusAreas: overrides.focusAreas ?? baseSelection.focusAreas,
  };
}

module.exports = [
  {
    name: 'recommendation profile treats lower target weight on lose weight as fat loss',
    run() {
      const profile = buildRecommendationProfile(
        selection({
          goal: 'general',
          currentWeightKg: 100,
          targetWeightKg: 85,
        }),
      );

      assert.equal(profile.goalType, 'fat_loss');
      assert.equal(profile.weightDirection, 'loss');
      assert.equal(profile.setupContext, 'full_gym');
      assert.equal(profile.hasWeightTarget, true);
    },
  },
  {
    name: 'recommendation profile treats higher target weight on build muscle as hypertrophy gain',
    run() {
      const profile = buildRecommendationProfile(
        selection({
          goal: 'muscle',
          currentWeightKg: 80,
          targetWeightKg: 90,
        }),
      );

      assert.equal(profile.goalType, 'hypertrophy');
      assert.equal(profile.weightDirection, 'gain');
      assert.equal(profile.hasWeightTarget, true);
    },
  },
  {
    name: 'recommendation profile keeps new Step 2 goal intents distinct',
    run() {
      assert.equal(
        buildRecommendationProfile(selection({ goal: 'lean_athletic' })).goalType,
        'recomposition',
      );
      assert.equal(
        buildRecommendationProfile(selection({ goal: 'general_fitness' })).goalType,
        'recomposition',
      );
    },
  },
  {
    name: 'recommendation profile separates home bodyweight and outdoor running contexts',
    run() {
      assert.equal(buildRecommendationProfile(selection({ equipment: 'home' })).setupContext, 'home_limited');
      assert.equal(
        buildRecommendationProfile(selection({ equipment: 'minimal', focusAreas: ['bodyweight'] })).setupContext,
        'bodyweight',
      );
      assert.equal(
        buildRecommendationProfile(
          selection({
            equipment: 'minimal',
            goal: 'run_mobility',
            secondaryOutcomes: ['conditioning'],
          }),
        ).setupContext,
        'outdoor_running',
      );
    },
  },
  {
    name: 'recommendation profile keeps precise Step 1 environment separate from broad equipment',
    run() {
      assert.equal(
        buildRecommendationProfile(
          selection({
            equipment: 'minimal',
            trainingEnvironment: 'running_hybrid',
            goal: 'strength',
            secondaryOutcomes: [],
            focusAreas: [],
          }),
        ).setupContext,
        'outdoor_running',
      );
      assert.equal(
        buildRecommendationProfile(
          selection({
            equipment: 'minimal',
            trainingEnvironment: 'bodyweight_only',
            goal: 'run_mobility',
            secondaryOutcomes: ['conditioning'],
            focusAreas: ['conditioning'],
          }),
        ).setupContext,
        'bodyweight',
      );
    },
  },
];
