const assert = require('node:assert/strict');

const {
  buildRecommendationPlanReadyPayload,
  buildRecommendationProgrammeProfile,
  getRecommendationProgrammeSummary,
} = require('../../src/lib/recommendationProgramme');
const { getReadyProgramBlockWeeks, READY_PROGRAM_MIN_BLOCK_WEEKS } = require('../../src/lib/readyProgramDuration');
const { getWorkoutTemplateById } = require('../../src/features/workout/workoutCatalog');

/** What the catalog says this programme's block is — the single source. */
function expectedCatalogWeeks(programId) {
  const template = getWorkoutTemplateById(programId);
  return template ? getReadyProgramBlockWeeks(template) : READY_PROGRAM_MIN_BLOCK_WEEKS;
}

const baseSelection = {
  gender: 'unspecified',
  age: 30,
  ageRange: '26_35',
  goal: 'strength',
  level: 'advanced',
  daysPerWeek: 3,
  equipment: 'gym',
  trainingEnvironment: 'full_gym',
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

function selection(overrides = {}) {
  return {
    ...baseSelection,
    ...overrides,
    secondaryOutcomes: overrides.secondaryOutcomes ?? baseSelection.secondaryOutcomes,
    focusAreas: overrides.focusAreas ?? baseSelection.focusAreas,
    availableDays: overrides.availableDays ?? baseSelection.availableDays,
  };
}

function assertProgrammeContractPayload(payload, expectations = {}) {
  // The rule, not the number: onboarding hands over a catalog programme, so
  // its block length has to BE the catalog's answer for that programme. The
  // two used to be separate constants and drifted apart the moment the
  // catalog moved off four weeks — the same plan said four on the way in and
  // eight on its own page.
  const catalogWeeks = expectedCatalogWeeks(payload.programId);
  assert.equal(payload.blockLengthWeeks, catalogWeeks);
  assert.equal(payload.durationModel.status, 'starter');
  assert.equal(payload.durationModel.blockLengthWeeks, catalogWeeks);
  assert.match(payload.durationModel.label, new RegExp(`${catalogWeeks}-week`, 'i'));
  assert.ok(payload.sessionComposition.prepBlock.body.length > 20);
  assert.ok(payload.sessionComposition.mainBlock.body.length > 20);
  assert.ok(payload.sessionComposition.supportBlock.body.length > 20);
  assert.ok(payload.sessionComposition.cooldownBlock.body.length > 20);
  assert.ok(payload.sessionBlocks.length >= 4);
  assert.equal(payload.sessionBlocks[0].type, 'prep');
  assert.equal(payload.sessionBlocks[payload.sessionBlocks.length - 1].type, 'cooldown');
  assert.match(payload.prepSummary, expectations.prep ?? /prep|warm|ramp|mobility|activation/i);
  assert.match(payload.cooldownSummary, expectations.cooldown ?? /cooldown|mobility|recovery|breathing|stretch/i);
}

module.exports = [
  {
    name: 'the starter block runs the catalog length, on a repeating four-week cycle',
    run() {
      const programId = 'tpl_3_day_strength_base_v1';
      const profile = buildRecommendationProgrammeProfile(programId);
      const catalogWeeks = expectedCatalogWeeks(programId);

      // Onboarding no longer holds a block length of its own.
      assert.equal(profile.blockLengthWeeks, catalogWeeks);
      assert.equal(profile.durationModel.status, 'starter');
      assert.equal(profile.durationModel.blockLengthWeeks, catalogWeeks);
      assert.ok(catalogWeeks >= READY_PROGRAM_MIN_BLOCK_WEEKS, 'no four-week starter block survives');
      assert.equal(profile.progressionStyle, 'strength_wave');
      // The four-week shape is the CYCLE inside the block, not the block:
      // baseline, build, build, easier week — then it runs again.
      assert.equal(profile.easierWeek.week, 4);
      assert.match(profile.phaseLabels[0], /Week 1/i);
      assert.match(profile.phaseLabels[3], /Week 4/i);
      assert.match(profile.volumeProgression, /volume/i);
      assert.match(profile.intensityProgression, /intensity|load/i);
      assert.match(profile.sessionComposition.prepBlock.body, /ramp|warm|mobility/i);
      assert.match(profile.sessionComposition.cooldownBlock.body, /cooldown|breathing|mobility/i);
    },
  },
  {
    name: 'recommendation programme summary explains the heavy plus volume split for powerbuilding',
    run() {
      const summary = getRecommendationProgrammeSummary('tpl_4_day_powerbuilding_v1');

      assert.ok(summary);
      assert.match(summary, new RegExp(`${expectedCatalogWeeks('tpl_4_day_powerbuilding_v1')}-week`, 'i'));
      assert.match(summary, /heavy|strength/i);
      assert.match(summary, /volume|hypertrophy|muscle/i);
      assert.match(summary, /easier week|pivot|deload/i);
    },
  },
  {
    name: 'recommendation plan-ready payload exposes documented myplan fields',
    run() {
      const payload = buildRecommendationPlanReadyPayload(
        selection({
          goal: 'muscle',
          level: 'advanced',
          daysPerWeek: 5,
          equipment: 'gym',
          currentWeightKg: 80,
          targetWeightKg: 90,
          focusAreas: ['chest', 'back'],
        }),
        'tpl_5_day_hybrid_v1',
      );

      assert.equal(payload.programId, 'tpl_5_day_hybrid_v1');
      assertProgrammeContractPayload(payload, {
        prep: /muscle|prep|warm|ramp/i,
        cooldown: /accessory|recovery|cooldown|breathing/i,
      });
      assert.ok(payload.title.length > 0);
      assert.match(payload.subtitle, /goals|schedule|recovery|muscle/i);
      assert.equal('starterNote' in payload, false);
      assert.equal(payload.weeklySchedule.length, 5);
      assert.equal(payload.fourWeekProgression.length, 4);
      assert.deepEqual(
        payload.fourWeekProgression.map((week) => week.role),
        ['baseline', 'build', 'build', 'review'],
      );
      assert.ok(payload.whyThisPlan.some((reason) => /muscle|gain/i.test(reason)));
      assert.ok(payload.whyThisPlan.length <= 4);
      assert.ok(payload.whyThisPlan.every((reason) => reason.length <= 34), payload.whyThisPlan.join(' | '));
      assert.ok(payload.whyThisPlan.some((reason) => /5 days/i.test(reason)));
      assert.match(payload.focusAllocation, /Pecs|Back|focus/i);
      assert.match(payload.howToProgress, /reps|load|volume/i);
      assert.match(payload.readinessGuardrail, /intermediate|recovery|build/i);
      assert.match(payload.firstAction, /start|open|begin/i);
    },
  },
  {
    name: 'recommendation programme payload covers the core onboarding programme paths',
    run() {
      const scenarios = [
        {
          programId: 'tpl_3_day_strength_base_v1',
          selection: selection({
            goal: 'strength',
            level: 'advanced',
            daysPerWeek: 3,
            equipment: 'gym',
            trainingEnvironment: 'full_gym',
          }),
          prep: /ramp|heavy|anchor|warm/i,
          cooldown: /breathing|mobility|cooldown/i,
        },
        {
          programId: 'tpl_5_day_hybrid_v1',
          selection: selection({
            goal: 'muscle',
            level: 'advanced',
            daysPerWeek: 5,
            equipment: 'gym',
            trainingEnvironment: 'full_gym',
            currentWeightKg: 80,
            targetWeightKg: 90,
          }),
          prep: /muscle|prep|warm|ramp/i,
          cooldown: /recovery|cooldown|breathing/i,
        },
        {
          programId: 'tpl_2_day_minimal_full_body_v1',
          selection: selection({
            goal: 'general_fitness',
            level: 'beginner',
            daysPerWeek: 3,
            equipment: 'minimal',
            trainingEnvironment: 'bodyweight_only',
          }),
          prep: /movement|bodyweight|range|warm/i,
          cooldown: /mobility|cooldown|recovery/i,
        },
        {
          programId: 'tpl_3_day_run_mobility_v1',
          selection: selection({
            goal: 'lean_athletic',
            level: 'beginner',
            daysPerWeek: 4,
            equipment: 'minimal',
            trainingEnvironment: 'running_hybrid',
          }),
          prep: /ankle|calf|hips|run|dynamic/i,
          cooldown: /calves|hips|breathing|cooldown/i,
        },
        {
          programId: 'tpl_4_day_muscle_builder_v1',
          selection: selection({
            goal: 'muscle',
            level: 'advanced',
            daysPerWeek: 4,
            equipment: 'gym',
            trainingEnvironment: 'full_gym',
            focusAreas: ['glutes', 'quads'],
          }),
          prep: /muscle|prep|warm|ramp/i,
          cooldown: /recovery|cooldown|breathing/i,
        },
      ];

      scenarios.forEach((scenario) => {
        const payload = buildRecommendationPlanReadyPayload(scenario.selection, scenario.programId);

        assertProgrammeContractPayload(payload, {
          prep: scenario.prep,
          cooldown: scenario.cooldown,
        });
      });
    },
  },
  {
    name: 'recommendation plan-ready payload explains coherent fallback days',
    run() {
      const payload = buildRecommendationPlanReadyPayload(
        selection({
          goal: 'strength',
          level: 'beginner',
          daysPerWeek: 5,
          equipment: 'gym',
        }),
        'tpl_2_day_beginner_strength_v1',
        { fallbackReason: 'Closest structured plan with optional extra day.' },
      );

      assert.equal(payload.requestedDaysPerWeek, 5);
      assert.equal(payload.programDaysPerWeek, 2);
      assert.equal(payload.weeklySchedule.length, 5);
      assert.ok(payload.weeklySchedule.some((day) => day.source === 'suggested'));
      assert.match(payload.fallbackReason ?? '', /optional extra day/i);
      assert.ok(payload.whyThisPlan.length <= 4);
      assert.ok(payload.whyThisPlan.every((reason) => reason.length <= 34), payload.whyThisPlan.join(' | '));
      assert.doesNotMatch(payload.whyThisPlan.join(' '), /GAINER recommends|starting point|optional extra day/i);
      assert.match(payload.readinessGuardrail, /beginner|conservative|recovery/i);
    },
  },
  {
    name: 'recommendation plan-ready payload gives every selected day a visible plan item',
    run() {
      const payload = buildRecommendationPlanReadyPayload(
        selection({
          goal: 'muscle',
          level: 'beginner',
          daysPerWeek: 6,
          equipment: 'home',
          trainingEnvironment: 'bodyweight_only',
        }),
        'tpl_2_day_minimal_full_body_v1',
      );

      assert.equal(payload.requestedDaysPerWeek, 6);
      assert.equal(payload.weeklySchedule.length, 6);
      assert.equal(new Set(payload.weeklySchedule.map((day) => day.weekdayLabel)).size, 6);
      assert.equal(payload.weeklySchedule.filter((day) => day.source === 'suggested').length, 4);
      assert.ok(payload.weeklySchedule.every((day) => day.name.length > 0));
      assert.ok(payload.weeklySchedule.every((day) => day.keyLifts.length > 0));
      assert.ok(payload.whyThisPlan.includes('6 days / week.'));
      assert.ok(payload.planOverview.includes('6 workouts / week'));
    },
  },
];
