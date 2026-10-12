const assert = require('node:assert/strict');

const { resolveOnboardingPlanName } = require('../../.test-dist/lib/onboardingPlanName.js');
const { buildSavedOnboardingPlan, buildSavedOnboardingWorkoutPlan } = require('../../.test-dist/app/onboardingHandoff.js');
const { buildFirstRunCustomProgramName, DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { getReadyTemplatePresentation } = require('../../.test-dist/lib/templatePresentation.js');
const { buildTrackChangeExampleCard } = require('../../.test-dist/lib/trackChangeExample.js');

const selection = { ...DEFAULT_FIRST_RUN_SELECTION, focusAreas: ['quads'], level: 'amateur' };
const FIT_LITE = 'tpl_3_day_upper_lower_lite_v1';

module.exports = [
  {
    name: 'a picked ready programme names the plan with its presentation title, no tier',
    run() {
      const template = getWorkoutTemplateById(FIT_LITE);
      assert.ok(template);
      for (const language of ['fi', 'en']) {
        const name = resolveOnboardingPlanName(selection, template, language);
        assert.equal(name, 'FIT Lite');
        assert.equal(name, getReadyTemplatePresentation(template, language).title);
        assert.notEqual(name, buildFirstRunCustomProgramName(selection, language));
        assert.doesNotMatch(name, /Amateur|Pro\b|Advanced/);
      }
    },
  },
  {
    name: 'a plan the app builds itself keeps the composed name',
    run() {
      for (const language of ['fi', 'en']) {
        assert.equal(
          resolveOnboardingPlanName(selection, null, language),
          buildFirstRunCustomProgramName(selection, language),
        );
      }
    },
  },
  {
    name: 'both onboarding builders take the picked programme title for the saved template and the plan',
    run() {
      const saved = buildSavedOnboardingPlan(selection, FIT_LITE, 'fi');
      assert.equal(saved.draft.name, 'FIT Lite');
      assert.equal(saved.runtimeTemplate.name, 'FIT Lite');
      const plan = buildSavedOnboardingWorkoutPlan(selection, 'wt_1', ['s1', 's2'], 'fi', null, FIT_LITE);
      assert.equal(plan.name, 'FIT Lite');
      // Without a picked programme the plan keeps the composed name.
      assert.equal(
        buildSavedOnboardingWorkoutPlan(selection, 'wt_1', ['s1'], 'fi').name,
        buildFirstRunCustomProgramName(selection, 'fi'),
      );
    },
  },
  {
    name: 'the track-change dialog example is shoulders with a visible line and weekly change, built in memory',
    run() {
      const card = buildTrackChangeExampleCard('en', new Date(2026, 9, 12, 10));
      assert.equal(card.key, 'shoulders');
      assert.equal(card.unit, 'cm');
      assert.ok(card.series.length >= 3);
      assert.ok(Math.max(...card.series) > Math.min(...card.series));
      assert.ok(card.weeklyTrend !== null && card.weeklyTrend > 0);
    },
  },
];
