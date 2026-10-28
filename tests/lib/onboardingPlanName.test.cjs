const assert = require('node:assert/strict');

const { resolveOnboardingPlanName } = require('../../src/lib/onboardingPlanName');
const { buildSavedOnboardingPlan, buildSavedOnboardingWorkoutPlan } = require('../../src/app/onboardingHandoff');
const { buildFirstRunCustomProgramName, DEFAULT_FIRST_RUN_SELECTION } = require('../../src/lib/firstRunSetup');
const { getWorkoutTemplateById } = require('../../src/features/workout/workoutCatalog');
const { getReadyTemplatePresentation } = require('../../src/lib/templatePresentation');
const { buildTrackChangeExampleCard } = require('../../src/lib/trackChangeExample');

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
  {
    name: 'the track-change example follows the site picked first, for every site',
    run() {
      const { resolveTrackChangeExampleKind } = require('../../src/lib/trackChangeExample');
      const now = new Date(2026, 9, 12, 10);
      for (const kind of ['shoulders', 'chest', 'back', 'arms', 'waist', 'hips', 'thighs', 'calves', 'bodyfat']) {
        const card = buildTrackChangeExampleCard('fi', now, kind);
        assert.equal(card.key, kind);
        assert.ok(card.series.length >= 3, kind);
        assert.ok(card.weeklyTrend !== null && card.weeklyTrend !== 0, `${kind} shows a change`);
      }
      assert.equal(buildTrackChangeExampleCard('en', now, 'bodyfat').unit, '%');
      // Waist and body fat go down; the others go up.
      assert.ok(buildTrackChangeExampleCard('en', now, 'waist').weeklyTrend < 0);
      assert.ok(buildTrackChangeExampleCard('en', now, 'arms').weeklyTrend > 0);

      // The first pick, not the latest; nothing picked, the first tile.
      assert.equal(resolveTrackChangeExampleKind(['waist', 'arms'], ['chest', 'waist', 'arms']), 'waist');
      assert.equal(resolveTrackChangeExampleKind([], ['chest', 'waist']), 'chest');
      assert.equal(resolveTrackChangeExampleKind([], []), 'shoulders');
    },
  },
];
