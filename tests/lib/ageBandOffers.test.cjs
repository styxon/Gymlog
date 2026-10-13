const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * The age band and the pick screen (owner, 2026-10-12).
 *
 * The onboarding age band changed nothing in which two programmes the pick
 * screen offered. Over 41, a lower-impact card was there for 36 of 180
 * answers (none for general fitness: the catalogue had no walking week); at
 * 16-18 with the gym card, a week lifted on guided machines for 16 of 60.
 *
 * The rule (recommendationWaterfall, recommendationScoring): over 41 every
 * answer gets a joint-friendly or lower-impact card, and 16-18 at the gym
 * (beginner and advanced; at pro the stated level decides) a machine-guided
 * one, through a second-card guarantee that never replaces the featured card.
 * The age decides nothing for 19-40: those offers are the same as for a
 * reader who skipped the question.
 *
 * "Offered" is what OnboardingScreen shows: the featured programme, then the
 * next option id.
 */

const dist = path.join(__dirname, '..', '..', '.test-dist');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));
const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
const { buildRecommendationOptionIds } = lib('recommendationPresentation');
const catalog = lib('recommendationCatalog');

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const CARDS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  gymNoBarbell: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Machines', 'Cables', 'Dumbbells', 'Cardio machines'] },
  homeNone: { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  bodyweight: { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  dumbbells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  dumbbellsBench: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Bench'] },
  homeGym: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Dumbbells', 'Bench'] },
};
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness', 'general', 'run_mobility'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];
const GENDERS = ['unspecified', 'male', 'female'];
const WALK = 'tpl_3_day_walk_mobility_v1';

function offered(answers) {
  const card = CARDS[answers.card];
  const selection = {
    gender: answers.gender, ageRange: answers.ageRange, goal: answers.goal, goals: [answers.goal], level: answers.level,
    daysPerWeek: answers.days, equipment: card.equipment, trainingEnvironment: card.trainingEnvironment,
    equipmentItems: card.equipmentItems, secondaryOutcomes: answers.secondaryOutcomes ?? [], focusAreas: answers.focusAreas ?? [],
    cautionFlags: answers.cautionFlags ?? [], guidanceMode: 'guided_editable', scheduleMode: 'app_managed',
    automatedProgression: true, weeklyMinutes: null, availableDays: [], trainingCyclePattern: null,
    currentWeightKg: null, targetWeightKg: null, unitPreference: 'kg',
  };
  const recommendation = resolveFirstRunRecommendationWithTailoring(selection, {
    setupEquipment: selection.equipment,
    setupFreeWeightsPreference: 'neutral',
    setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral',
    setupShoulderFriendlySwaps: 'neutral',
    setupElbowFriendlySwaps: 'neutral',
    setupKneeFriendlySwaps: 'neutral',
  }, 'en');
  return {
    ids: [
      recommendation.featuredProgramId,
      ...buildRecommendationOptionIds(recommendation).filter((id) => id !== recommendation.featuredProgramId),
    ].slice(0, 2),
    waterfall: recommendation.waterfall,
  };
}

const definition = (id) => catalog.getRecommendationProgramDefinition(id);
/** The owner's definition, written out here rather than read from the code under test. */
const suitsOver41 = (id) => Boolean(definition(id)?.jointFriendly || definition(id)?.familyId === 'low_impact');
const machineGuided = (id) => Boolean(definition(id)?.styleTags.includes('machine_guided'));

/** Every card, goal, level, day count and gender, plain; then the asks and flags at one gender. */
function* answerSpace(ageRange, { cards = Object.keys(CARDS), goals = GOALS, levels = LEVELS } = {}) {
  for (const card of cards) for (const goal of goals) for (const level of levels) for (const days of DAYS) {
    for (const gender of GENDERS) yield { ageRange, card, goal, level, days, gender };
    for (const secondaryOutcomes of [['mobility'], ['conditioning'], ['muscle']]) {
      yield { ageRange, card, goal, level, days, gender: 'unspecified', secondaryOutcomes };
    }
    yield { ageRange, card, goal, level, days, gender: 'unspecified', cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }] };
    yield { ageRange, card, goal, level, days, gender: 'female', focusAreas: ['glutes'] };
  }
}

const label = (answers) => [answers.card, answers.goal, answers.level, `${answers.days}d`, answers.gender,
  ...(answers.secondaryOutcomes ?? []), ...(answers.focusAreas ?? []), ...(answers.cautionFlags ?? []).map((flag) => `${flag.area}-${flag.level}`)].join(' ');

module.exports = [
  {
    name: 'age band: over 41, every answer is offered a joint-friendly or lower-impact card',
    run() {
      const misses = [];
      let cells = 0;
      for (const answers of answerSpace('41_plus')) {
        cells += 1;
        const { ids } = offered(answers);
        if (!ids.some(suitsOver41)) misses.push(`${label(answers)}: ${ids.join(' + ')}`);
      }
      assert.ok(cells > 2000, `only ${cells} answers walked: did the answer space shrink?`);
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} of ${cells} answers over 41 have no fitting card`);
    },
  },
  {
    name: 'age band: 16-18 at the gym, beginner or advanced, is offered a machine-guided card',
    run() {
      // Not running and mobility: no machine week lists the goal, and what
      // the reader asked for outranks the age. Not pro: the stated level
      // decides there (owner, 2026-10-12).
      const misses = [];
      let cells = 0;
      for (const answers of answerSpace('18', {
        cards: ['gym', 'gymNoBarbell'],
        goals: GOALS.filter((goal) => goal !== 'run_mobility'),
        levels: ['beginner', 'advanced'],
      })) {
        cells += 1;
        const { ids } = offered(answers);
        if (!ids.some(machineGuided)) misses.push(`${label(answers)}: ${ids.join(' + ')}`);
      }
      assert.ok(cells > 300, `only ${cells} answers walked`);
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} of ${cells} answers at 16-18 have no machine-guided card`);
    },
  },
  {
    name: 'age band: 19-25, 26-30 and 31-40 are offered what a reader who skipped the question is offered',
    run() {
      // The acceptance: the age rule adds cards at the two ends and nothing in
      // the middle. Checked against the skipped answer rather than a stored
      // snapshot, so a catalogue change that moves every band alike passes,
      // and one that moves a middle band apart from the rest fails.
      const differs = [];
      let cells = 0;
      for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const level of LEVELS) for (const days of DAYS) {
        for (const extra of [{ gender: 'male' }, { gender: 'female' }, { gender: 'unspecified', secondaryOutcomes: ['mobility'] }]) {
          const answers = { card, goal, level, days, ...extra };
          const skipped = offered({ ...answers, ageRange: 'unspecified' });
          for (const ageRange of ['19_25', '26_30', '31_40']) {
            cells += 1;
            const banded = offered({ ...answers, ageRange });
            if (banded.ids.join() !== skipped.ids.join()
              || banded.waterfall?.whyPrimary !== skipped.waterfall?.whyPrimary
              || banded.waterfall?.whyAlternative !== skipped.waterfall?.whyAlternative) {
              differs.push(`${ageRange} ${label(answers)}: ${banded.ids.join(' + ')} against ${skipped.ids.join(' + ')}`);
            }
          }
        }
      }
      assert.deepEqual(differs.slice(0, 10), [], `${differs.length} of ${cells} middle-band answers moved`);
      // And the rule's own predicates say the same, for every programme.
      for (const ageRange of ['19_25', '26_30', '31_40', 'unspecified', null]) {
        for (const program of catalog.RECOMMENDATION_PROGRAMS) {
          for (const equipment of ['gym', 'home', 'minimal']) {
            assert.equal(catalog.programFitsReaderAge(program, { ageRange, equipment }), false, `${ageRange} ${program.programId}`);
          }
        }
        assert.equal(catalog.ageRuleGuaranteesCard({ ageRange, equipment: 'gym', level: 'beginner' }), false, `${ageRange}`);
      }
    },
  },
  {
    name: 'age band: VITAL Walk leads for a plain general-fitness beginner over 41, with the answers\' own pick second',
    run() {
      for (const card of Object.keys(CARDS)) for (const days of DAYS) for (const gender of GENDERS) {
        const answers = { ageRange: '41_plus', card, goal: 'general_fitness', level: 'beginner', days, gender };
        const { ids, waterfall } = offered(answers);
        assert.equal(ids[0], WALK, label(answers));
        assert.ok(ids[1] && ids[1] !== WALK, `${label(answers)}: a second card`);
        assert.equal(waterfall.whyPrimary, 'wf.age.walkPrimary', label(answers));
        // The Programs tab reads the second card from the decision.
        assert.equal(waterfall.alternativeProgramId, ids[1], label(answers));
      }
      // Asked-for outranks the age: with a secondary outcome the lane decides.
      const asked = offered({ ageRange: '41_plus', card: 'gym', goal: 'general_fitness', level: 'beginner', days: 3, gender: 'unspecified', secondaryOutcomes: ['muscle'] });
      assert.notEqual(asked.ids[0], WALK);
      // And at advanced the answers' pick leads; VITAL Walk is not forced.
      const advanced = offered({ ageRange: '41_plus', card: 'gym', goal: 'general_fitness', level: 'advanced', days: 3, gender: 'unspecified' });
      assert.notEqual(advanced.waterfall.rule, 'age_low_impact');
    },
  },
  {
    name: 'age band: the tie-break decides only between programmes the answers rate equal',
    run() {
      // 16-18 at the gym, strength, beginner, three days: STRONG and STRONG
      // Guided are both three-day beginner strength weeks; the age picks the
      // guided one. At 26-30 the answers alone pick, and STRONG Guided is not
      // offered at all.
      const teen = offered({ ageRange: '18', card: 'gym', goal: 'strength', level: 'beginner', days: 3, gender: 'unspecified' });
      assert.equal(teen.ids[0], 'tpl_3_day_guided_strength_v1');
      const adult = offered({ ageRange: '26_30', card: 'gym', goal: 'strength', level: 'beginner', days: 3, gender: 'unspecified' });
      assert.equal(adult.ids[0], 'tpl_3_day_strength_base_v1');
      assert.ok(!adult.ids.includes('tpl_3_day_guided_strength_v1'));
      // The goal outranks the age: over 41 at home with no gear, lean and
      // athletic, three days, the week written for the goal leads and VITAL Walk,
      // which lists it as a backup, is the second card.
      const lean = offered({ ageRange: '41_plus', card: 'homeNone', goal: 'lean_athletic', level: 'beginner', days: 3, gender: 'unspecified' });
      assert.ok(definition(lean.ids[0]).supportedGoals.includes('lean_athletic'), `${lean.ids[0]} leads`);
      // The level outranks it too: a pro over 41 is never handed a beginner-only week by the tie-break.
      for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const days of DAYS) {
        const pro = offered({ ageRange: '41_plus', card, goal, level: 'pro', days, gender: 'unspecified' });
        const featured = definition(pro.ids[0]);
        const sameAnswersSkipped = offered({ ageRange: 'unspecified', card, goal, level: 'pro', days, gender: 'unspecified' });
        if (pro.ids[0] !== sameAnswersSkipped.ids[0]) {
          assert.ok(featured.supportedLevels.includes('pro'), `${card} ${goal} ${days}d: ${pro.ids[0]} is not a pro week`);
        }
      }
    },
  },
];
