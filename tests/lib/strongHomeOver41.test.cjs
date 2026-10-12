const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * STRONG Home and HUGE Bodyweight, the strength and muscle answers over 41
 * that had no week for the gear they own (owner, 2026-10-12).
 *
 * An audit of 26,460 answers over 41 found two lanes with no week written for
 * them: strength with a pair of dumbbells and nothing else, and muscle with no
 * equipment at all. STRONG Home is STRONG Guided's week for the dumbbells (sets
 * of six on the anchor lifts, eight on the rest), HUGE Bodyweight is HUGE
 * Home's week with nothing to hold.
 *
 * Checked here: the weeks are what the owner asked for (rep numbers, no jumps,
 * legs every day, as much pulling as pressing, the gear they need, the card's
 * minutes, the bar they read as); the age rule offers them where they fit the
 * gear and the goal; no reader under 41 is offered either, at any age but the
 * one; STRONG Guided is joint-friendly now; and the copy is in both languages.
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
const { READY_PROGRAM_COLLECTIONS } = lib('readyProgramCollections');
const { t } = lib('i18n');
const catalog = lib('recommendationCatalog');
const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));

const STRONG_HOME = 'tpl_3_day_strong_home_v1';
const HUGE_BODYWEIGHT = 'tpl_3_day_huge_bodyweight_v1';
const STRONG_GUIDED = 'tpl_3_day_guided_strength_v1';
const NEW_IDS = [STRONG_HOME, HUGE_BODYWEIGHT];

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
    name: 'STRONG Home and HUGE Bodyweight: three joint-friendly full-body days, one rep number a row, no jumps, legs every day, pulling as much as pressing',
    run() {
      for (const id of NEW_IDS) {
        const template = getWorkoutTemplateById(id);
        assert.ok(template, id);
        assert.equal(template.daysPerWeek, 3, id);
        assert.equal(template.sessions.length, 3, id);
        assert.equal(template.splitType, 'full_body', id);
        // The card quotes what the sessions take.
        assert.equal(template.estimatedSessionDuration, readyTemplateCardMinutes({ ...template, estimatedSessionDuration: 0 }), `${id} minutes`);
        let push = 0;
        let pull = 0;
        for (const session of template.sessions) {
          assert.ok(session.exercises.some((exercise) => LEG_GROUPS.includes(exercise.substitutionGroup)), `${id} ${session.name}: legs every day`);
          for (const exercise of session.exercises) {
            const where = `${id} ${session.name} ${exercise.exerciseName}`;
            assert.equal(exercise.repsMin, exercise.repsMax, `${where}: one rep number`);
            assert.notEqual(exercise.substitutionGroup, 'jump_plyo', `${where}: no jumps`);
            assert.ok(!JUMPING.test(exercise.exerciseName), `${where}: no jumps`);
            assert.ok(!/barbell|back squat|bench press/i.test(exercise.exerciseName), `${where}: no barbell lift`);
            if (PUSH_GROUPS.includes(exercise.substitutionGroup)) push += exercise.sets;
            if (PULL_GROUPS.includes(exercise.substitutionGroup)) pull += exercise.sets;
          }
        }
        assert.ok(push >= 8, `${id}: ${push} pressing sets a week`);
        assert.ok(pull >= push, `${id}: ${pull} pulling against ${push} pressing sets`);
        const program = definition(id);
        assert.equal(program.jointFriendly, true, id);
        assert.deepEqual(program.supportedLevels, ['beginner', 'advanced'], id);
        // No minute of either is cardio, so neither is written for general fitness.
        assert.ok(!program.supportedGoals.includes('general_fitness'), id);
      }
    },
  },
  {
    name: 'STRONG Home: strength at home on one pair of dumbbells, anchors at six reps, the rest at six to eight, and the bar reads Strength',
    run() {
      const template = getWorkoutTemplateById(STRONG_HOME);
      // The "Dumbbells" chip alone runs all of it: no bench, no bar, no machine.
      assert.deepEqual(resolveProgramEquipment(names(STRONG_HOME)), ['Dumbbells']);
      for (const exercise of exercisesOf(STRONG_HOME)) {
        const where = `${exercise.exerciseName} (${exercise.role})`;
        assert.ok(exercise.repsMax >= 6 && exercise.repsMax <= 8, `${where}: ${exercise.repsMax} reps`);
        if (exercise.role === 'primary') assert.equal(exercise.repsMax, 6, `${where}: an anchor lifts at six`);
      }
      for (const session of template.sessions) {
        assert.ok(session.exercises.filter((exercise) => exercise.role === 'primary').length >= 2, `${session.name}: anchors`);
      }
      // Strength is six reps or fewer (programFocusSplit); the week is mostly that.
      const split = Object.fromEntries(buildProgramFocusSplit(template.sessions).map((segment) => [segment.quality, segment.pct]));
      assert.ok(split.Strength > split.Muscle, JSON.stringify(split));
      assert.equal(split.Conditioning, undefined, JSON.stringify(split));
      const program = definition(STRONG_HOME);
      assert.equal(program.familyId, 'strength_base');
      assert.equal(program.equipmentTier, 'low_equipment');
      assert.deepEqual(program.supportedGoals, ['strength']);
      assert.equal(template.goalType, 'strength');
    },
  },
  {
    name: 'HUGE Bodyweight: muscle with no equipment, every lift at 10-15 reps, and the bar reads Muscle',
    run() {
      const template = getWorkoutTemplateById(HUGE_BODYWEIGHT);
      // Nothing on the equipment card: not a dumbbell, a bar or a band.
      assert.deepEqual(resolveProgramEquipment(names(HUGE_BODYWEIGHT)), []);
      for (const exercise of exercisesOf(HUGE_BODYWEIGHT)) {
        const where = `${exercise.exerciseName} (${exercise.role})`;
        assert.notEqual(exercise.trackingMode, 'load_and_reps', `${where}: nothing to load`);
        // The core rows are the two accessories a day may close on at 12.
        assert.ok(exercise.repsMax >= 10 && exercise.repsMax <= 15, `${where}: ${exercise.repsMax} reps`);
      }
      const split = buildProgramFocusSplit(template.sessions);
      assert.deepEqual(split, [{ quality: 'Muscle', pct: 100 }]);
      const program = definition(HUGE_BODYWEIGHT);
      assert.deepEqual(program.supportedGoals, ['muscle']);
      assert.equal(program.equipmentTier, 'low_equipment');
      assert.equal(template.goalType, 'hypertrophy');
      // A push-up progression (incline, then the floor) and a row under a table.
      const pushes = names(HUGE_BODYWEIGHT).filter((name) => /push-up/i.test(name));
      assert.ok(pushes.includes('Incline Push-Up') && pushes.includes('Push-Up (or Knee Push-Up)'), pushes.join(', '));
      assert.ok(names(HUGE_BODYWEIGHT).includes('Inverted Row (Table)'));
    },
  },
  {
    name: 'STRONG Guided is joint-friendly: six-rep sets on machines and cables, no barbell',
    run() {
      const program = definition(STRONG_GUIDED);
      assert.equal(program.jointFriendly, true);
      assert.ok(program.styleTags.includes('machine_guided'));
      assert.deepEqual(program.supportedGoals, ['strength']);
      assert.ok(names(STRONG_GUIDED).every((name) => !/barbell|back squat|bench press/i.test(name)), names(STRONG_GUIDED).join(', '));
      // The card's rep numbers are untouched: this was a metadata change only
      // (an 8-rep machine week would overlap HUGE Guided and read as Muscle).
      const sixes = exercisesOf(STRONG_GUIDED).filter((exercise) => exercise.repsMax === 6).length;
      assert.equal(sixes, 5);
    },
  },
  {
    name: 'age band: over 41, a strength answer with dumbbells leads with STRONG Home at the days it fits, and has it on a card at every day count',
    run() {
      for (const gender of GENDERS) for (const card of ['dumbbells', 'dumbbellsBench']) {
        for (const days of DAYS) {
          const ids = offered({ card, goal: 'strength', level: 'beginner', days, gender });
          assert.equal(ids[0], STRONG_HOME, `${card} beginner ${days}d ${gender}: ${ids.join(' + ')}`);
          const advanced = offered({ card, goal: 'strength', level: 'advanced', days, gender });
          assert.ok(advanced.includes(STRONG_HOME), `${card} advanced ${days}d ${gender}: ${advanced.join(' + ')}`);
        }
        // Two and three days: the week the programme is written for.
        for (const days of [2, 3]) assert.equal(offered({ card, goal: 'strength', level: 'advanced', days, gender })[0], STRONG_HOME, `${card} advanced ${days}d ${gender}`);
      }
      // Pro asks for more than three days of dumbbells; the answers stay theirs.
      for (const days of DAYS) assert.ok(!offered({ card: 'dumbbells', goal: 'strength', level: 'pro', days }).includes(STRONG_HOME), `pro ${days}d`);
      // A barbell and a rack at home: the barbell week leads, the joint-friendly
      // dumbbell week is the age card beside it.
      for (const level of ['beginner', 'advanced']) for (const days of DAYS) {
        assert.ok(offered({ card: 'homeGym', goal: 'strength', level, days }).includes(STRONG_HOME), `homeGym ${level} ${days}d`);
      }
    },
  },
  {
    name: 'age band: over 41, a muscle answer with no equipment has HUGE Bodyweight on a card, and with dumbbells HUGE Home still leads',
    run() {
      for (const gender of GENDERS) for (const card of ['homeNone', 'bodyweight']) {
        for (const days of DAYS) for (const level of ['beginner', 'advanced']) {
          const ids = offered({ card, goal: 'muscle', level, days, gender });
          assert.ok(ids.includes(HUGE_BODYWEIGHT), `${card} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
        }
        for (const days of DAYS) assert.equal(offered({ card, goal: 'muscle', level: 'beginner', days, gender })[0], HUGE_BODYWEIGHT, `${card} beginner ${days}d ${gender}`);
      }
      // A pull-up bar is not equipment for this week; the same answer.
      for (const days of DAYS) assert.ok(offered({ card: 'pullUpBar', goal: 'muscle', level: 'beginner', days }).includes(HUGE_BODYWEIGHT), `pull-up bar ${days}d`);
      // Dumbbells have HUGE Home (hugeOver41), and a gym its machines; neither
      // is handed the bodyweight week first.
      for (const days of DAYS) {
        assert.equal(offered({ card: 'dumbbells', goal: 'muscle', level: 'beginner', days })[0], 'tpl_3_day_huge_home_v1');
        assert.equal(offered({ card: 'gym', goal: 'muscle', level: 'beginner', days: Math.max(days, 3) })[0], 'tpl_3_day_huge_guided_v1');
      }
    },
  },
  {
    name: 'age band: the strength week is not offered to a reader whose goal or gear it was not written for',
    run() {
      // STRONG Home needs a dumbbell; HUGE Bodyweight is a muscle week. Neither
      // is a card for a goal they do not list unless the age card brings it,
      // and neither is ever featured for another goal.
      for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
        const ids = offered({ card, goal, level, days });
        if (ids[0] === STRONG_HOME) assert.equal(goal, 'strength', `${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
        if (ids[0] === HUGE_BODYWEIGHT) assert.equal(goal, 'muscle', `${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
        if (ids.includes(STRONG_HOME)) assert.ok(CARDS[card].equipmentItems.includes('Dumbbells') || card === 'gym', `${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
      }
    },
  },
  {
    name: 'age band: nobody under 41 is offered STRONG Home or HUGE Bodyweight, at any age but over 41, for any answer',
    run() {
      let cells = 0;
      for (const ageRange of ['unspecified', '18', '19_25', '26_30', '31_40']) {
        for (const card of Object.keys(CARDS)) for (const goal of GOALS) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
          for (const gender of GENDERS) {
            cells += 1;
            const ids = offered({ ageRange, card, goal, level, days, gender });
            assert.ok(!ids.some((id) => NEW_IDS.includes(id)), `${ageRange} ${card} ${goal} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
          }
          cells += 1;
          const ids = offered({ ageRange, card, goal, level, days, cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }], secondaryOutcomes: ['mobility'] });
          assert.ok(!ids.some((id) => NEW_IDS.includes(id)), `${ageRange} ${card} ${goal} ${level} ${days}d knees+mobility: ${ids.join(' + ')}`);
        }
      }
      assert.ok(cells > 5000, `${cells} answers`);
      // The gate itself, not only what the waterfall happened to pick.
      for (const ageRange of ['unspecified', '18', '19_25', '26_30', '31_40']) {
        for (const id of NEW_IDS) {
          assert.equal(catalog.ageGateAllows({ programId: id, familyId: definition(id).familyId }, { ageRange, equipment: 'minimal', goal: 'strength', secondaryOutcomes: [], focusAreas: [], availableEquipment: ['Dumbbells'] }), false, `${ageRange} ${id}`);
        }
      }
      for (const id of NEW_IDS) {
        assert.equal(catalog.ageGateAllows({ programId: id, familyId: definition(id).familyId }, { ageRange: '41_plus', equipment: 'minimal', goal: 'strength', secondaryOutcomes: [], focusAreas: [], availableEquipment: ['Dumbbells'] }), true, id);
      }
    },
  },
  {
    name: 'STRONG Home and HUGE Bodyweight: named, tagged, collected and written up in English and Finnish',
    run() {
      for (const id of NEW_IDS) {
        const template = getWorkoutTemplateById(id);
        const presentation = getReadyTemplatePresentation(template, 'en');
        assert.equal(presentation.title, template.name, id);
        assert.ok(presentation.tagKeys === undefined || presentation.tagKeys.length >= 1, id);
        for (const language of ['en', 'fi']) {
          const subKey = `prog.sub.${id}`;
          const sub = t(language, subKey);
          assert.ok(sub && sub !== subKey && !sub.startsWith('prog.sub.'), `${language} ${subKey}`);
          const content = getReadyProgramContent(id, language);
          for (const field of ['summary', 'audience', 'equipmentProfile', 'whyItWorks']) {
            assert.ok(content[field] && content[field].length > 40, `${language} ${id} ${field}`);
          }
        }
        // Finnish is its own text, not the English fallback.
        assert.notEqual(getReadyProgramContent(id, 'fi').summary, getReadyProgramContent(id, 'en').summary, id);
        for (const rule of Object.values(template.progressionRules)) {
          assert.notEqual(progressionRuleLabel('fi', rule), rule, `${id}: "${rule}" has no Finnish`);
        }
        assert.ok(READY_PROGRAM_COLLECTIONS.some((collection) => collection.templateIds.includes(id)), `${id} is in a collection`);
      }
      assert.ok(READY_PROGRAM_COLLECTIONS.find((collection) => collection.key === 'strength').templateIds.includes(STRONG_HOME));
      assert.ok(READY_PROGRAM_COLLECTIONS.find((collection) => collection.key === 'muscle').templateIds.includes(HUGE_BODYWEIGHT));
    },
  },
];
