const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * VITAL Base, the strength answer over 41 with no equipment at all
 * (owner, 2026-10-12).
 *
 * The audit of 26,460 answers over 41 left one gap after VITAL Strength and HUGE
 * Bodyweight: strength with nothing to hold, 1,260 answers with no card
 * fitting. VITAL Base is that week: three full-body days of 40 minutes,
 * sets of six on hard versions of bodyweight lifts (rear foot raised, one leg,
 * feet up, a table row), support lifts at eight, no jumps, no weights, legs on
 * every day, and at least as much pulling as pressing.
 *
 * Checked here: the week is what the owner asked for (gear, rep numbers, no
 * jumps, legs every day, pull against push, the card's minutes, the bar it
 * reads as, and that it is not a copy of VITAL Body); the age rule puts
 * it on a card for a reader over 41 with no equipment; no reader under 41 is
 * ever offered it; and the copy is in both languages.
 */

const dist = path.join(__dirname, '..', '..', '.test-dist');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));
const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
const { buildRecommendationOptionIds } = lib('recommendationPresentation');
const { readyTemplateCardMinutes } = lib('programmeMinutes');
const { resolveProgramEquipment } = lib('programEquipment');
const { buildProgramFocusSplit } = lib('programFocusSplit');
const { progressionRuleLabel } = lib('progressionRuleLabel');
const { getReadyProgramContent } = lib('readyProgramContent');
const { getReadyTemplatePresentation } = lib('templatePresentation');
const { localizeSessionName } = lib('sessionNameLabel');
const { READY_PROGRAM_COLLECTIONS } = lib('readyProgramCollections');
const { t } = lib('i18n');
const catalog = lib('recommendationCatalog');
const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));

const STRONG_BODYWEIGHT = 'tpl_3_day_strong_bodyweight_v1';
const HUGE_BODYWEIGHT = 'tpl_3_day_huge_bodyweight_v1';
const STRONG_HOME = 'tpl_3_day_strong_home_v1';

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const CARDS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  homeNone: { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  bodyweight: { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  pullUpBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Pull-up bar'] },
  dumbbells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  dumbbellsBench: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Bench'] },
  homeGym: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Dumbbells', 'Bench'] },
  bands: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Resistance bands'] },
};
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness', 'general', 'run_mobility'];
const DAYS = [2, 3, 4, 5, 6];
const GENDERS = ['unspecified', 'male', 'female'];

function offered(answers) {
  const card = CARDS[answers.card];
  const selection = {
    gender: answers.gender ?? 'unspecified', ageRange: answers.ageRange ?? '41_plus', goal: answers.goal, goals: [answers.goal],
    level: answers.level, daysPerWeek: answers.days, equipment: card.equipment, trainingEnvironment: card.trainingEnvironment,
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
  return [
    recommendation.featuredProgramId,
    ...buildRecommendationOptionIds(recommendation).filter((id) => id !== recommendation.featuredProgramId),
  ].slice(0, 2);
}

const definition = (id) => catalog.getRecommendationProgramDefinition(id);
const exercisesOf = (id) => getWorkoutTemplateById(id).sessions.flatMap((session) => session.exercises);
const names = (id) => exercisesOf(id).map((exercise) => exercise.exerciseName);

const LEG_GROUPS = ['squat_pattern', 'single_leg', 'hinge_pattern', 'bodyweight_hinge', 'bodyweight_squat_pattern', 'accessory_hamstrings', 'hip_thrust_bridge'];
const PUSH_GROUPS = ['horizontal_press', 'vertical_press', 'bodyweight_press'];
const PULL_GROUPS = ['horizontal_pull', 'vertical_pull', 'cable_machine_row', 'bodyweight_pull'];
const JUMPING = /jump|hop\b|bound|burpee|skater|plyo/i;

module.exports = [
  {
    name: 'VITAL Base: three full-body days of 40 minutes, no equipment, no jumps, legs every day, pulling as much as pressing',
    run() {
      const template = getWorkoutTemplateById(STRONG_BODYWEIGHT);
      assert.ok(template);
      assert.equal(template.daysPerWeek, 3);
      assert.equal(template.sessions.length, 3);
      assert.equal(template.splitType, 'full_body');
      assert.equal(template.goalType, 'strength');
      // The card quotes what the sessions take.
      assert.equal(template.estimatedSessionDuration, 40);
      assert.equal(template.estimatedSessionDuration, readyTemplateCardMinutes({ ...template, estimatedSessionDuration: 0 }));
      // Nothing on the equipment card: not a dumbbell, a bar, a band or a bench.
      assert.deepEqual(resolveProgramEquipment(names(STRONG_BODYWEIGHT)), []);
      let push = 0;
      let pull = 0;
      for (const session of template.sessions) {
        assert.ok(session.exercises.some((exercise) => LEG_GROUPS.includes(exercise.substitutionGroup)), `${session.name}: legs every day`);
        for (const exercise of session.exercises) {
          const where = `${session.name} ${exercise.exerciseName}`;
          assert.equal(exercise.repsMin, exercise.repsMax, `${where}: one rep number`);
          assert.equal(exercise.trackingMode, 'bodyweight', `${where}: nothing to load`);
          assert.notEqual(exercise.substitutionGroup, 'jump_plyo', `${where}: no jumps`);
          assert.ok(!JUMPING.test(exercise.exerciseName), `${where}: no jumps`);
          assert.ok(!/barbell|dumbbell|kettlebell|machine|cable|back squat|bench press/i.test(exercise.exerciseName), `${where}: no weights`);
          if (PUSH_GROUPS.includes(exercise.substitutionGroup)) push += exercise.sets;
          if (PULL_GROUPS.includes(exercise.substitutionGroup)) pull += exercise.sets;
        }
      }
      assert.ok(push >= 8, `${push} pressing sets a week`);
      assert.ok(pull >= push, `${pull} pulling against ${push} pressing sets`);
      const program = definition(STRONG_BODYWEIGHT);
      assert.equal(program.jointFriendly, true);
      assert.deepEqual(program.supportedLevels, ['beginner', 'advanced']);
      assert.deepEqual(program.supportedGoals, ['strength']);
      assert.deepEqual(program.backupGoals, ['muscle']);
      assert.equal(program.equipmentTier, 'low_equipment');
      // No minute of it is cardio, so it is not written for general fitness.
      assert.ok(!program.supportedGoals.includes('general_fitness'));
    },
  },
  {
    name: 'VITAL Base: anchors at six reps on hard versions, the rest at six to eight, and the bar reads mostly Strength',
    run() {
      const template = getWorkoutTemplateById(STRONG_BODYWEIGHT);
      for (const exercise of exercisesOf(STRONG_BODYWEIGHT)) {
        const where = `${exercise.exerciseName} (${exercise.role})`;
        assert.ok(exercise.repsMax >= 6 && exercise.repsMax <= 8, `${where}: ${exercise.repsMax} reps`);
        if (exercise.role === 'primary') assert.equal(exercise.repsMax, 6, `${where}: an anchor lifts at six`);
      }
      for (const session of template.sessions) {
        assert.ok(session.exercises.filter((exercise) => exercise.role === 'primary').length >= 2, `${session.name}: anchors`);
      }
      // The hard versions that make a six heavy with nothing to load.
      const all = names(STRONG_BODYWEIGHT);
      for (const hard of ['Bulgarian Split Squat', 'Decline Push-Up', 'Single-Leg RDL', 'Inverted Row (Table)', 'Single Leg Glute Bridge', 'Pike Push-Up']) {
        assert.ok(all.includes(hard), `${hard}: ${all.join(', ')}`);
      }
      // Strength is six reps or fewer (programFocusSplit); the week is mostly that.
      const split = Object.fromEntries(buildProgramFocusSplit(template.sessions).map((segment) => [segment.quality, segment.pct]));
      assert.ok(split.Strength >= 60 && split.Strength > split.Muscle * 1.5, JSON.stringify(split));
      assert.equal(split.Conditioning, undefined, JSON.stringify(split));
      // Progression without a load: a harder version and a pause, never a pace rule by role.
      const primary = template.progressionRules.primary;
      assert.ok(/harder/i.test(primary) && /pause/i.test(primary), primary);
    },
  },
  {
    name: 'VITAL Base is its own week, not VITAL Body with the numbers turned down',
    run() {
      const strong = getWorkoutTemplateById(STRONG_BODYWEIGHT);
      const huge = getWorkoutTemplateById(HUGE_BODYWEIGHT);
      const hugeSplit = buildProgramFocusSplit(huge.sessions);
      assert.deepEqual(hugeSplit, [{ quality: 'Muscle', pct: 100 }]);
      const strongSplit = buildProgramFocusSplit(strong.sessions);
      assert.ok(strongSplit.some((segment) => segment.quality === 'Strength'));
      // Every rep number is lower, and the lifts are the harder versions.
      const hugeMin = Math.min(...exercisesOf(HUGE_BODYWEIGHT).map((exercise) => exercise.repsMax));
      assert.ok(exercisesOf(STRONG_BODYWEIGHT).every((exercise) => exercise.repsMax < hugeMin), `huge starts at ${hugeMin}`);
      const hugeNames = new Set(names(HUGE_BODYWEIGHT));
      const shared = names(STRONG_BODYWEIGHT).filter((name) => hugeNames.has(name));
      const own = [...new Set(names(STRONG_BODYWEIGHT))].filter((name) => !hugeNames.has(name));
      // The harder versions are the week's own: not one of them is in VITAL Body.
      assert.deepEqual(own.sort(), ['Bulgarian Split Squat', 'Decline Push-Up', 'Pike Push-Up'], `shares ${[...new Set(shared)].join(', ')}`);
      assert.ok(!names(STRONG_BODYWEIGHT).includes('Incline Push-Up'));
      assert.ok(!names(STRONG_BODYWEIGHT).includes('Bodyweight Squat'));
    },
  },
  {
    name: 'age band: over 41, strength with no equipment has VITAL Base on a card at every day count, beginner and advanced',
    run() {
      for (const gender of GENDERS) for (const card of ['homeNone', 'bodyweight']) {
        for (const days of DAYS) for (const level of ['beginner', 'advanced']) {
          const ids = offered({ card, goal: 'strength', level, days, gender });
          assert.ok(ids.includes(STRONG_BODYWEIGHT), `${card} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
        }
        for (const days of [2, 3]) {
          assert.equal(offered({ card, goal: 'strength', level: 'beginner', days, gender })[0], STRONG_BODYWEIGHT, `${card} beginner ${days}d ${gender}`);
        }
      }
      // A pull-up bar is not equipment for this week: the same answer.
      for (const days of DAYS) assert.ok(offered({ card: 'pullUpBar', goal: 'strength', level: 'beginner', days }).includes(STRONG_BODYWEIGHT), `pull-up bar ${days}d`);
      // With dumbbells the dumbbell week still leads; the gym keeps its own.
      for (const days of DAYS) {
        assert.equal(offered({ card: 'dumbbells', goal: 'strength', level: 'beginner', days })[0], STRONG_HOME);
      }
    },
  },
  {
    name: 'age band: VITAL Base is only ever a strength answer, and only for a reader with no weights to hold',
    run() {
      for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
        const ids = offered({ card, goal, level, days });
        // Featured for no goal but strength.
        if (ids[0] === STRONG_BODYWEIGHT) assert.equal(goal, 'strength', `${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
      }
    },
  },
  {
    name: 'age band: nobody under 41 is offered VITAL Base, at any age but over 41, for any answer',
    run() {
      let cells = 0;
      for (const ageRange of ['unspecified', '18', '19_25', '26_30', '31_40']) {
        for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
          for (const gender of GENDERS) {
            cells += 1;
            const ids = offered({ ageRange, card, goal, level, days, gender });
            assert.ok(!ids.includes(STRONG_BODYWEIGHT), `${ageRange} ${card} ${goal} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
          }
          cells += 1;
          const ids = offered({ ageRange, card, goal, level, days, cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }], secondaryOutcomes: ['mobility'] });
          assert.ok(!ids.includes(STRONG_BODYWEIGHT), `${ageRange} ${card} ${goal} ${level} ${days}d knees+mobility: ${ids.join(' + ')}`);
        }
      }
      assert.ok(cells > 2500, `${cells} answers`);
      // The gate itself, not only what the waterfall happened to pick.
      const input = (ageRange) => ({ ageRange, equipment: 'minimal', goal: 'strength', secondaryOutcomes: [], focusAreas: [], availableEquipment: [] });
      const program = { programId: STRONG_BODYWEIGHT, familyId: definition(STRONG_BODYWEIGHT).familyId };
      for (const ageRange of ['unspecified', '18', '19_25', '26_30', '31_40']) {
        assert.equal(catalog.ageGateAllows(program, input(ageRange)), false, ageRange);
      }
      assert.equal(catalog.ageGateAllows(program, input('41_plus')), true);
    },
  },
  {
    name: 'VITAL Base: named, tagged, collected and written up in English and Finnish',
    run() {
      const template = getWorkoutTemplateById(STRONG_BODYWEIGHT);
      const presentation = getReadyTemplatePresentation(template, 'en');
      assert.equal(presentation.title, template.name);
      assert.ok(presentation.tagKeys === undefined || presentation.tagKeys.length >= 1);
      for (const language of ['en', 'fi']) {
        const subKey = `prog.sub.${STRONG_BODYWEIGHT}`;
        const sub = t(language, subKey);
        assert.ok(sub && sub !== subKey && !sub.startsWith('prog.sub.'), `${language} ${subKey}`);
        const content = getReadyProgramContent(STRONG_BODYWEIGHT, language);
        for (const field of ['summary', 'audience', 'equipmentProfile', 'whyItWorks']) {
          assert.ok(content[field] && content[field].length > 40, `${language} ${field}`);
        }
      }
      // Finnish is its own text, not the English fallback.
      assert.notEqual(getReadyProgramContent(STRONG_BODYWEIGHT, 'fi').summary, getReadyProgramContent(STRONG_BODYWEIGHT, 'en').summary);
      assert.notEqual(t('fi', `prog.sub.${STRONG_BODYWEIGHT}`), t('en', `prog.sub.${STRONG_BODYWEIGHT}`));
      for (const rule of Object.values(template.progressionRules)) {
        assert.notEqual(progressionRuleLabel('fi', rule), rule, `"${rule}" has no Finnish`);
      }
      for (const session of template.sessions) {
        assert.notEqual(localizeSessionName(session.name, 'fi'), session.name, `${session.name} has no Finnish`);
      }
      assert.ok(READY_PROGRAM_COLLECTIONS.find((collection) => collection.key === 'strength').templateIds.includes(STRONG_BODYWEIGHT));
      assert.ok(READY_PROGRAM_COLLECTIONS.some((collection) => collection.templateIds.includes(STRONG_BODYWEIGHT)));
    },
  },
];
