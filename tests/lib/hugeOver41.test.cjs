const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * HUGE Guided and VITAL Muscle, and the muscle answer over 41 (owner,
 * 2026-10-12).
 *
 * Over 41 the muscle answer was HUGE Builder cut from four days to three (the
 * legs once a week, a barbell squat and bench in it), and at home VITAL Home,
 * close to half of it walking, as the featured card. The owner asked for a
 * muscle week written for that reader: these two, one for the gym and one for
 * a pair of dumbbells at home.
 *
 * Checked here: the weeks are what the owner asked for (moderate reps, no
 * jumps, legs every day, as much pulling as pressing, the card's minutes);
 * the age rule features them where they fit the gear and the days; the
 * walking weeks never lead a lifting goal and are not offered at all to a
 * reader who can lift for one; the tie-break reads lean and athletic as a
 * conditioning goal; and the age card never takes away the only card written
 * for the reader's goal.
 */

const dist = path.join(__dirname, '..', '..', 'src');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));
const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
const { buildRecommendationOptionIds } = lib('recommendationPresentation');
const { readyTemplateCardMinutes } = lib('programmeMinutes');
const { resolveProgramEquipment } = lib('programEquipment');
const catalog = lib('recommendationCatalog');
const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));

const GUIDED = 'tpl_3_day_huge_guided_v1';
const HOME = 'tpl_3_day_huge_home_v1';
const WALKING = ['tpl_3_day_walk_mobility_v1', 'tpl_3_day_home_easy_strength_v1'];

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const CARDS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  gymNoBarbell: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Machines', 'Cables', 'Dumbbells', 'Cardio machines'] },
  homeNone: { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  bodyweight: { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  dumbbells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  dumbbellsBench: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Bench'] },
  homeGym: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Dumbbells', 'Bench'] },
  homeBarbell: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench'] },
  pullUpBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Pull-up bar'] },
  bandsAndBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Resistance bands', 'Pull-up bar'] },
};
const LOAD_CARDS = ['gym', 'gymNoBarbell', 'dumbbells', 'dumbbellsBench', 'homeGym', 'homeBarbell'];
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness', 'general', 'run_mobility'];
const DAYS = [2, 3, 4, 5, 6];

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
const writtenFor = (id, goal) => Boolean(definition(id)?.supportedGoals.includes(goal));
const label = (answers) => [answers.ageRange ?? '41_plus', answers.card, answers.goal, answers.level, `${answers.days}d`, answers.gender ?? 'unspecified',
  ...(answers.secondaryOutcomes ?? []), ...(answers.focusAreas ?? []), ...(answers.cautionFlags ?? []).map((flag) => `${flag.area}-${flag.level}`)].join(' ');

/** Plain answers at every gender, then the asks and flags at one. */
function* answerSpace({ cards = Object.keys(CARDS), goals = GOALS, levels = ['beginner', 'advanced', 'pro'], ageRange = '41_plus' } = {}) {
  for (const card of cards) for (const goal of goals) for (const level of levels) for (const days of DAYS) {
    for (const gender of ['unspecified', 'male', 'female']) yield { ageRange, card, goal, level, days, gender };
    for (const secondaryOutcomes of [['mobility'], ['conditioning'], ['muscle']]) yield { ageRange, card, goal, level, days, secondaryOutcomes };
    yield { ageRange, card, goal, level, days, cautionFlags: [{ area: 'knees', level: 'avoid', refinements: [] }] };
    yield { ageRange, card, goal, level, days, focusAreas: ['chest'] };
  }
}

const LEG_GROUPS = ['squat_pattern', 'single_leg', 'hinge_pattern', 'bodyweight_hinge', 'accessory_hamstrings', 'hip_thrust_bridge'];
const PUSH_GROUPS = ['horizontal_press', 'vertical_press', 'bodyweight_press'];
const PULL_GROUPS = ['horizontal_pull', 'vertical_pull', 'cable_machine_row', 'bodyweight_pull'];

module.exports = [
  {
    name: 'HUGE Guided and VITAL Muscle: three joint-friendly full-body muscle days at 10-15 reps, pulling as much as pressing',
    run() {
      for (const id of [GUIDED, HOME]) {
        const template = getWorkoutTemplateById(id);
        assert.ok(template, id);
        assert.equal(template.daysPerWeek, 3, id);
        assert.equal(template.sessions.length, 3, id);
        // The card quotes what the sessions take.
        assert.equal(template.estimatedSessionDuration, readyTemplateCardMinutes({ ...template, estimatedSessionDuration: 0 }), `${id} minutes`);
        let push = 0;
        let pull = 0;
        for (const session of template.sessions) {
          assert.ok(session.exercises.some((exercise) => LEG_GROUPS.includes(exercise.substitutionGroup)), `${id} ${session.name}: legs every day`);
          for (const exercise of session.exercises) {
            const where = `${id} ${session.name} ${exercise.exerciseName}`;
            assert.equal(exercise.repsMin, exercise.repsMax, `${where}: one rep number`);
            assert.ok(exercise.repsMax >= 10 && exercise.repsMax <= 15, `${where}: ${exercise.repsMax} reps`);
            assert.notEqual(exercise.substitutionGroup, 'jump_plyo', `${where}: no jumps`);
            assert.ok(!/barbell|back squat|bench press|deadlift$/i.test(exercise.exerciseName) || /dumbbell/i.test(exercise.exerciseName), `${where}: no barbell lift`);
            if (PUSH_GROUPS.includes(exercise.substitutionGroup)) push += exercise.sets;
            if (PULL_GROUPS.includes(exercise.substitutionGroup)) pull += exercise.sets;
          }
        }
        assert.ok(push >= 8, `${id}: ${push} pressing sets a week`);
        assert.ok(pull >= push, `${id}: ${pull} pulling against ${push} pressing sets`);
        const program = definition(id);
        assert.deepEqual(program.supportedGoals, ['muscle'], id);
        assert.equal(program.jointFriendly, true, id);
        assert.deepEqual(program.supportedLevels, ['beginner', 'advanced'], id);
      }
      // VITAL Muscle runs on the "Dumbbells" chip alone, HUGE Guided is lifted
      // mostly on machines and cables.
      const homeNames = getWorkoutTemplateById(HOME).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      assert.deepEqual(resolveProgramEquipment(homeNames).filter((item) => item !== 'Dumbbells'), []);
      const guidedNames = getWorkoutTemplateById(GUIDED).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      const guided = guidedNames.filter((name) => resolveProgramEquipment([name]).some((item) => item === 'Machines' || item === 'Cables'));
      assert.ok(guided.length * 2 > guidedNames.length, `${guided.length} of ${guidedNames.length} lifts on machines or cables`);
      assert.ok(definition(GUIDED).styleTags.includes('machine_guided'));
    },
  },
  {
    name: 'age band: over 41, the muscle answer leads with HUGE Guided at the gym and VITAL Muscle with dumbbells where they fit the week',
    run() {
      for (const gender of ['unspecified', 'male', 'female']) {
        // A beginner's week starts at three days (effectiveDays), so every
        // day count; at advanced, two and three days. At four and more the
        // four- to six-day muscle weeks fit the week better and lead; at two
        // days a beginner keeps HUGE Starter, a two-day machine week.
        for (const card of ['gym', 'gymNoBarbell']) {
          for (const days of DAYS) {
            const ids = offered({ card, goal: 'muscle', level: 'beginner', days, gender });
            assert.equal(ids[0], days === 2 ? 'tpl_huge_starter_v1' : GUIDED, `${card} beginner ${days}d ${gender}: ${ids.join(' + ')}`);
          }
        }
        for (const card of ['dumbbells', 'dumbbellsBench', 'homeGym']) {
          for (const days of DAYS) assert.equal(offered({ card, goal: 'muscle', level: 'beginner', days, gender })[0], HOME, `${card} beginner ${days}d ${gender}`);
        }
      }
      for (const days of [2, 3]) {
        for (const card of ['gym', 'gymNoBarbell']) assert.equal(offered({ card, goal: 'muscle', level: 'advanced', days })[0], GUIDED, `${card} advanced ${days}d`);
        for (const card of ['dumbbells', 'dumbbellsBench']) assert.equal(offered({ card, goal: 'muscle', level: 'advanced', days })[0], HOME, `${card} advanced ${days}d`);
      }
      // Never in the middle bands: the answers there move nothing
      // (ageBandOffers), and the Programs tab lists both for everyone.
      for (const ageRange of ['19_25', '26_30', '31_40']) {
        for (const card of Object.keys(CARDS)) for (const days of DAYS) {
          const ids = offered({ ageRange, card, goal: 'muscle', level: 'beginner', days });
          assert.ok(!ids.includes(GUIDED) && !ids.includes(HOME), `${ageRange} ${card} ${days}d: ${ids.join(' + ')}`);
        }
      }
    },
  },
  {
    name: 'age band: a walking week never leads a lifting goal over 41, and a reader who can lift for one is not offered it',
    run() {
      const misses = [];
      let cells = 0;
      for (const answers of answerSpace({ goals: ['muscle', 'strength'] })) {
        cells += 1;
        const ids = offered(answers);
        if (WALKING.includes(ids[0])) misses.push(`${label(answers)}: featured ${ids[0]}`);
        if (LOAD_CARDS.includes(answers.card) && ids.some((id) => WALKING.includes(id))) misses.push(`${label(answers)}: ${ids.join(' + ')}`);
      }
      assert.ok(cells > 1000, `only ${cells} answers walked`);
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} of ${cells} lifting answers over 41 were handed a walking week`);
      // General fitness and lean and athletic still may: with dumbbells and
      // no answer beyond the goal, a beginner over 41 is led by VITAL Walk.
      assert.equal(offered({ card: 'dumbbells', goal: 'general_fitness', level: 'beginner', days: 3 })[0], 'tpl_3_day_walk_mobility_v1');
    },
  },
  {
    name: 'age band: over 41 with dumbbells, lean and athletic leads with a conditioning week, not the muscle week the tie-break chose',
    run() {
      // Home Dumbbell Upper/Lower is joint-friendly and lists lean and
      // athletic; rated equal with Fat Burn HIIT on every other answer, the
      // tie-break handed it a goal it has no minute of conditioning for.
      for (const card of ['dumbbells', 'dumbbellsBench']) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
        const featured = offered({ card, goal: 'lean_athletic', level, days })[0];
        assert.notEqual(featured, 'tpl_home_dumbbell_upper_lower_v1', `${card} ${level} ${days}d`);
        assert.ok(definition(featured).styleTags.includes('conditioning'), `${card} ${level} ${days}d: ${featured}`);
      }
    },
  },
  {
    name: 'age band: the age card never takes away the only card written for the reader\'s goal',
    run() {
      // A reader over 41 whose featured week only lists the goal as a backup
      // (or not at all) keeps the second card that is written for it, unless
      // the age card is written for it too. Compared with the same answers at
      // 26-30, where no age card comes.
      const misses = [];
      let checked = 0;
      for (const answers of answerSpace({ goals: ['strength', 'muscle', 'lean_athletic', 'general_fitness'] })) {
        const over = offered(answers);
        if (writtenFor(over[0], answers.goal)) continue;
        const middle = offered({ ...answers, ageRange: '26_30' });
        if (middle[0] !== over[0] || !middle[1] || !writtenFor(middle[1], answers.goal)) continue;
        checked += 1;
        if (!over.slice(1).some((id) => writtenFor(id, answers.goal))) misses.push(`${label(answers)}: ${over.join(' + ')} (26-30: ${middle.join(' + ')})`);
      }
      assert.ok(checked > 20, `only ${checked} answers had the shape`);
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} of ${checked} answers lost their only goal card to the age card`);
    },
  },
];
