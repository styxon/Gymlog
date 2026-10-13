const assert = require('node:assert/strict');

const { getReadyProgramBlockWeeks } = require('../../.test-dist/lib/readyProgramDuration.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');

const { getRecommendationProgramDefinition } = require('../../.test-dist/lib/recommendationCatalog.js');

const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { recommendPrograms } = require('../../.test-dist/lib/recommendationScoring.js');

module.exports = [
  {
    name: 'recommendation scoring prefers beginner strength for a 2-day strength beginner',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'strength',
          level: 'beginner',
          daysPerWeek: 2,
          equipment: 'gym',
          secondaryOutcomes: ['consistency'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );

      assert.equal(result.featuredProgramId, 'tpl_2_day_beginner_strength_v1');
      assert.equal(result.secondaryProgramId, 'tpl_2_day_minimal_full_body_v1');
      assert.equal(result.primaryFamilyId, 'strength_base');
    },
  },
  {
    name: 'recommendation scoring keeps a 4-day muscle user on the muscle lane with a strength alternative',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'muscle',
          level: 'advanced',
          daysPerWeek: 4,
          equipment: 'gym',
          secondaryOutcomes: ['strength'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );

      assert.equal(result.featuredProgramId, 'tpl_4_day_upper_lower_v1');
      assert.equal(result.secondaryProgramId, 'tpl_4_day_powerbuilding_v1');
    },
  },
  {
    name: 'recommendation scoring limits home setups to low-equipment options',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'muscle',
          level: 'beginner',
          daysPerWeek: 4,
          equipment: 'home',
          secondaryOutcomes: ['consistency'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );

      assert.equal(result.featuredProgramId, 'tpl_gainer_at_home_beginner_v1');
      // The claim is a property, not a guest list: no full-gym program may be
      // scored for someone training at home. Pinning ids meant every new
      // low-equipment program broke a test it had done nothing wrong to.
      const gymLeaks = result.scoredCandidates
        .map((candidate) => getRecommendationProgramDefinition(candidate.programId))
        .filter((definition) => definition && definition.equipmentTier !== 'low_equipment')
        .map((definition) => definition.programId);
      assert.deepEqual(gymLeaks, [], `full-gym programs offered to a home setup: ${gymLeaks.join(', ')}`);
    },
  },
  {
    name: 'recommendation scoring lets tailoring reorder close 4-day strength candidates',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'strength',
          level: 'advanced',
          daysPerWeek: 4,
          equipment: 'gym',
          secondaryOutcomes: ['muscle'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
        {
          setupEquipment: 'gym',
          setupFreeWeightsPreference: 'avoid',
          setupBodyweightPreference: 'neutral',
          setupMachinesPreference: 'love',
          setupShoulderFriendlySwaps: 'prioritize',
          setupElbowFriendlySwaps: 'neutral',
          setupKneeFriendlySwaps: 'neutral',
        },
      );

      assert.equal(result.featuredProgramId, 'tpl_4_day_strength_size_v1');
    },
  },
  {
    name: 'recommendation scoring uses program fit gender as a soft signal',
    run() {
      const femaleResult = recommendPrograms(
        buildRecommendationInput({
          goal: 'muscle',
          level: 'beginner',
          daysPerWeek: 3,
          equipment: 'gym',
          secondaryOutcomes: [],
          focusAreas: ['glutes'],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'female',
          unitPreference: 'kg',
        }),
      );
      const maleResult = recommendPrograms(
        buildRecommendationInput({
          goal: 'muscle',
          level: 'advanced',
          daysPerWeek: 5,
          equipment: 'gym',
          secondaryOutcomes: [],
          focusAreas: ['chest', 'arms'],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'male',
          unitPreference: 'kg',
        }),
      );

      assert.equal(femaleResult.featuredProgramId, 'tpl_gainer_glute_foundations_v1');
      assert.equal(maleResult.featuredProgramId, 'tpl_gainer_dream_body_man_v1');
      assert.equal(femaleResult.scoredCandidates[0].breakdown.genderFit > 0, true);
      assert.equal(maleResult.scoredCandidates[0].breakdown.genderFit > 0, true);
    },
  },
  {
    name: 'recommendation scoring penalizes content that does not fit the requested goal',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'run_mobility',
          level: 'beginner',
          daysPerWeek: 3,
          equipment: 'gym',
          secondaryOutcomes: ['conditioning', 'mobility'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );
      const runCandidate = result.scoredCandidates.find((candidate) => candidate.programId === 'tpl_3_day_run_mobility_v1');
      const strengthCandidate = result.scoredCandidates.find((candidate) => candidate.programId === 'tpl_3_day_strength_base_v1');

      assert.equal(result.featuredProgramId, 'tpl_3_day_run_mobility_v1');
      assert.ok(runCandidate);
      assert.ok(strengthCandidate);
      assert.equal(runCandidate.breakdown.contentFit > 0, true);
      assert.equal(strengthCandidate.breakdown.contentFit < 0, true);
    },
  },
  {
    name: 'recommendation scoring marks 5-day strength as an explicit optional-day fallback',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'strength',
          level: 'advanced',
          daysPerWeek: 5,
          equipment: 'gym',
          secondaryOutcomes: ['consistency'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );

      assert.equal(result.featuredProgramId, 'tpl_4_day_strength_size_v1');
      assert.match(result.fallbackReason, /optional/i);
      assert.equal(result.recommendationConfidence < 1, true);
      // The catalog owns the length; onboarding no longer keeps its own.
      assert.equal(
        result.trainingBlock.blockLengthWeeks,
        getReadyProgramBlockWeeks(getWorkoutTemplateById(result.featuredProgramId)),
      );
      assert.equal(result.trainingBlock.currentWeek, 1);
      assert.equal(result.trainingBlock.currentWeekRole, 'baseline');
      assert.match(result.trainingBlock.nextWeekAction, /week 2/i);
    },
  },
  {
    name: 'recommendation scoring caps a 6-day general fitness beginner at the core 3-day tier',
    run() {
      const result = recommendPrograms(
        buildRecommendationInput({
          goal: 'general_fitness',
          level: 'beginner',
          daysPerWeek: 6,
          equipment: 'gym',
          secondaryOutcomes: ['consistency'],
          focusAreas: [],
          guidanceMode: 'guided_editable',
          scheduleMode: 'app_managed',
          weeklyMinutes: null,
          availableDays: [],
          gender: 'unspecified',
          unitPreference: 'kg',
        }),
      );

      // Experience first: a beginner asking for 6 days starts at the 3-day core tier.
      assert.equal(result.featuredProgramId, 'tpl_3_day_full_body_v1');
      assert.equal(result.waterfall.rule, 'beginner_first');
    },
  },
  {
    name: 'the age band finally decides something, and only one thing',
    run() {
      // setupAgeRange has been collected since the first setup screen, stored,
      // and shown back on the My data screen — and read by nothing. Asking a
      // reader a question and then ignoring the answer is the quiet version of
      // not asking.
      const base = {
        goal: 'strength',
        level: 'beginner',
        daysPerWeek: 3,
        equipment: 'gym',
        secondaryOutcomes: [],
        focusAreas: [],
        guidanceMode: 'guided_editable',
        scheduleMode: 'app_managed',
        weeklyMinutes: null,
        availableDays: [],
        gender: 'unspecified',
        unitPreference: 'kg',
      };

      const scoreOf = (ageRange, programId) => {
        const result = recommendPrograms(buildRecommendationInput({ ...base, ageRange }));
        const found = result.scoredCandidates.find((entry) => entry.programId === programId);
        return found ? found.score : null;
      };

      const joint = 'tpl_gainer_joint_friendly_v1';
      const younger = scoreOf('26_30', joint);
      const older = scoreOf('41_plus', joint);
      assert.ok(younger !== null && older !== null, "the joint-friendly programme should be a candidate");
      assert.ok(older > younger, "the top age band should lift a joint-friendly programme");

      // One direction only. Nobody is pushed DOWN for being young: a
      // joint-friendly programme is a good programme at any age, and the
      // opposite rule would be a judgement about the reader.
      assert.equal(scoreOf('19_25', joint), younger);
      assert.equal(scoreOf(undefined, joint), younger);

      // Declining the question decides the same as skipping it.
      assert.equal(scoreOf('unspecified', joint), younger);

      // And it touches nothing else. A programme with no joint-friendly flag
      // scores the same at every age.
      const plain = 'tpl_3_day_strength_base_v1';
      assert.equal(scoreOf('41_plus', plain), scoreOf('26_30', plain));

      // The other end, 16-18 (owner, 2026-10-12): the weeks lifted mostly on
      // guided machines get the same small nudge up, and again in one
      // direction only.
      const machine = 'tpl_huge_starter_v1';
      const teen = scoreOf('18', machine);
      assert.ok(teen !== null, 'the machine-guided starter should be a candidate');
      assert.equal(teen, scoreOf('26_30', machine) + 3, 'the 16-18 band should lift a machine-guided programme by 3');
      assert.equal(scoreOf('19_25', machine), scoreOf('26_30', machine));
      assert.equal(scoreOf(undefined, machine), scoreOf('26_30', machine));
      // Nothing pushed down at 16-18 either: the free-weight week and a
      // joint-friendly week without machines score as they do at 26-30.
      assert.equal(scoreOf('18', plain), scoreOf('26_30', plain));
      const homeStarter = 'tpl_2_day_minimal_full_body_v1';
      assert.equal(scoreOf('18', homeStarter), scoreOf('26_30', homeStarter));
      // And the two bands do not borrow each other's nudge: the 41+ one is
      // for joint-friendly weeks, the 16-18 one for machine-guided weeks.
      assert.equal(scoreOf('18', joint), scoreOf('26_30', joint) + 3, 'Joint-Friendly Strength is machine-guided too');
      assert.equal(scoreOf('41_plus', homeStarter), scoreOf('26_30', homeStarter) + 3);
    },
  },
];
