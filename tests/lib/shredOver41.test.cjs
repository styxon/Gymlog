const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * SHRED Guided and VITAL Burn, and the lean-and-athletic answer over 41
 * and at 16-18 (owner, 2026-10-12).
 *
 * Over 41 the lean answer was SHRED (a barbell squat, burpees and treadmill
 * sprints) or Fat Burn HIIT (jump squats, burpees, box jumps), and a
 * 16-18-year-old at the gym had no lean week lifted on machines at all. The
 * owner asked for a fat-burn week for that reader: a circuit on machines and
 * cables with bike, rower or cross-trainer intervals at the gym, and a
 * bodyweight circuit with walking blocks at home. Neither has a jump in it.
 *
 * Checked here: the weeks are what the owner asked for (three days of 40
 * minutes by the card's own estimate, no jump, no barbell, no treadmill, one
 * rep number per row, the conditioning share the time-weighted bar reads, an
 * interval or a walking block on every day); the lean answer over 41 is
 * offered the gym week at a gym and the home week at home, at the two levels
 * the programmes list; the gym week is offered at 16-18 too and the home one
 * is not; and the middle bands (19-40) never see either.
 */

const dist = path.join(__dirname, '..', '..', 'src');
const lib = (name) => require(path.join(dist, 'lib', `${name}.js`));
const { resolveFirstRunRecommendationWithTailoring } = lib('firstRunSetup');
const { buildRecommendationOptionIds } = lib('recommendationPresentation');
const { buildProgramFocusSplit } = lib('programFocusSplit');
const { readyTemplateCardMinutes } = lib('programmeMinutes');
const { resolveProgramEquipment } = lib('programEquipment');
const catalog = lib('recommendationCatalog');
const { getWorkoutTemplateById } = require(path.join(dist, 'features', 'workout', 'workoutCatalog.js'));

const GUIDED = 'tpl_3_day_shred_guided_v1';
const HOME = 'tpl_3_day_shred_home_easy_v1';

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const CARDS = {
  gym: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  gymNoBarbell: { equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Machines', 'Cables', 'Dumbbells', 'Cardio machines'] },
  homeNone: { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  bodyweight: { equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  bands: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Resistance bands'] },
  kettlebells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Kettlebells'] },
  pullUpBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Pull-up bar'] },
  bandsAndBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Resistance bands', 'Pull-up bar'] },
  homeBarbell: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench'] },
  dumbbells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  dumbbellsBench: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Bench'] },
  homeGym: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Dumbbells', 'Bench'] },
};
const GYM_CARDS = ['gym', 'gymNoBarbell'];
// The home cards without a dumbbell. A reader with dumbbells is handed the
// week that uses them (Fat Burn HIIT, Home Dumbbell Upper/Lower) before the age
// is asked: VITAL Burn uses no weight (see the last test).
const HOME_CARDS = ['homeNone', 'bodyweight', 'bands', 'kettlebells', 'pullUpBar', 'bandsAndBar', 'homeBarbell'];
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness', 'general', 'run_mobility'];
const DAYS = [2, 3, 4, 5, 6];

function offered({ card, goal = 'lean_athletic', level, days, gender = 'unspecified', ageRange = '41_plus', secondaryOutcomes = [] }) {
  const cardItems = CARDS[card];
  const selection = {
    gender, ageRange, goal, goals: [goal], level, daysPerWeek: days, equipment: cardItems.equipment,
    trainingEnvironment: cardItems.trainingEnvironment, equipmentItems: cardItems.equipmentItems, secondaryOutcomes,
    focusAreas: [], cautionFlags: [], guidanceMode: 'guided_editable', scheduleMode: 'app_managed',
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
const conditioningPct = (id) => buildProgramFocusSplit(getWorkoutTemplateById(id).sessions).find((segment) => segment.quality === 'Conditioning')?.pct ?? 0;

const CONDITIONING_GROUPS = ['cardio_intervals', 'steady_cardio', 'walking_blocks'];
const JUMPING = /jump|\bhop|bound|burpee|climber|plyo|pogo|skater|high knee|jack\b|swing|thruster/i;

module.exports = [
  {
    name: 'SHRED Guided and VITAL Burn: three 40-minute full-body days, no jump, no barbell, conditioning written as intervals or blocks',
    run() {
      for (const id of [GUIDED, HOME]) {
        const template = getWorkoutTemplateById(id);
        assert.ok(template, id);
        assert.equal(template.daysPerWeek, 3, id);
        assert.equal(template.sessions.length, 3, id);
        // The card quotes what the sessions take.
        assert.equal(template.estimatedSessionDuration, readyTemplateCardMinutes({ ...template, estimatedSessionDuration: 0 }), `${id} minutes`);
        assert.equal(template.estimatedSessionDuration, 40, `${id} card minutes`);
        for (const session of template.sessions) {
          // An interval or a walking block on every day, not a finisher on one.
          assert.ok(
            session.exercises.some((exercise) => CONDITIONING_GROUPS.includes(exercise.substitutionGroup)),
            `${id} ${session.name}: a conditioning block`,
          );
          const lifts = session.exercises.filter((exercise) => !CONDITIONING_GROUPS.includes(exercise.substitutionGroup));
          assert.ok(lifts.length >= 4, `${id} ${session.name}: ${lifts.length} lifts`);
          for (const exercise of session.exercises) {
            const where = `${id} ${session.name} ${exercise.exerciseName}`;
            assert.equal(exercise.repsMin, exercise.repsMax, `${where}: one rep number`);
            assert.ok(!JUMPING.test(exercise.exerciseName), `${where}: no jump`);
            assert.ok(!['jump_plyo', 'conditioning_circuit', 'explosive_power', 'agility_drills'].includes(exercise.substitutionGroup), `${where}: no jump group`);
            assert.ok(!/barbell|back squat|bench press|treadmill|sprint 40|air bike/i.test(exercise.exerciseName), `${where}: no barbell lift and no treadmill`);
            // Light work, many sets: a lift at six reps or fewer is a strength week.
            if (!CONDITIONING_GROUPS.includes(exercise.substitutionGroup) && exercise.trackingMode !== 'hold') {
              assert.ok(exercise.repsMax >= 10 && exercise.repsMax <= 15, `${where}: ${exercise.repsMax} reps`);
            }
          }
          // No beginner day over 20 sets (catalogContent20261008).
          assert.ok(session.exercises.reduce((sum, exercise) => sum + exercise.sets, 0) <= 20, `${id} ${session.name}: over 20 sets`);
        }
      }
      // A third of the week's time in conditioning, by the bar the card shows.
      const guided = conditioningPct(GUIDED);
      const home = conditioningPct(HOME);
      assert.ok(guided >= 25 && guided <= 35, `SHRED Guided: ${guided} % conditioning`);
      assert.ok(home >= 30 && home <= 40, `VITAL Burn: ${home} % conditioning`);
    },
  },
  {
    name: 'SHRED Guided is lifted on machines and cables with a bike, a rower and a cross-trainer; VITAL Burn needs no equipment',
    run() {
      const guidedNames = getWorkoutTemplateById(GUIDED).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      assert.ok(guidedNames.includes('Bike HIIT (45s sprint / 15s rest)'));
      assert.ok(guidedNames.includes('Rowing Machine HIIT'));
      assert.ok(guidedNames.includes('Elliptical Trainer'));
      const lifts = guidedNames.filter((name) => !/HIIT|Elliptical/.test(name));
      const guided = lifts.filter((name) => resolveProgramEquipment([name]).some((item) => item === 'Machines' || item === 'Cables'));
      assert.equal(guided.length, lifts.length, `${guided.length} of ${lifts.length} lifts on machines or cables`);
      // Pulling as much as pressing, legs on every day.
      const sets = (groups) => getWorkoutTemplateById(GUIDED).sessions.flatMap((session) => session.exercises)
        .filter((exercise) => groups.includes(exercise.substitutionGroup)).reduce((sum, exercise) => sum + exercise.sets, 0);
      assert.ok(sets(['horizontal_pull', 'vertical_pull', 'cable_machine_row']) >= sets(['horizontal_press', 'vertical_press']));
      for (const session of getWorkoutTemplateById(GUIDED).sessions) {
        assert.ok(session.exercises.some((exercise) => ['squat_pattern', 'hinge_pattern', 'accessory_hamstrings'].includes(exercise.substitutionGroup)), `legs on ${session.name}`);
      }

      const homeNames = getWorkoutTemplateById(HOME).sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
      assert.deepEqual(resolveProgramEquipment(homeNames), [], 'VITAL Burn asks for nothing the reader has to own');
      assert.ok(homeNames.includes('Brisk Walk Blocks') && homeNames.includes('Incline Walk Blocks'));
      assert.equal(definition(HOME).equipmentTier, 'low_equipment');
      assert.equal(definition(GUIDED).equipmentTier, 'full_gym');
    },
  },
  {
    name: 'SHRED Guided and VITAL Burn: the lean family, joint-friendly, beginner and advanced; Guided machine-guided',
    run() {
      for (const id of [GUIDED, HOME]) {
        const program = definition(id);
        assert.equal(program.familyId, 'athletic_recomp', id);
        assert.deepEqual(program.supportedGoals, ['lean_athletic'], id);
        assert.deepEqual(program.supportedLevels, ['beginner', 'advanced'], id);
        assert.equal(program.jointFriendly, true, id);
        assert.ok(program.styleTags.includes('conditioning'), `${id}: the lean lane filters on the conditioning style`);
        assert.equal(program.estimatedSessionMinutes, 40, id);
      }
      assert.ok(definition(GUIDED).styleTags.includes('machine_guided'));
      assert.ok(!definition(HOME).styleTags.includes('machine_guided'));
    },
  },
  {
    name: 'age band: over 41, a lean answer at the gym is offered SHRED Guided, and at home with no dumbbell VITAL Burn',
    run() {
      const misses = [];
      let cells = 0;
      for (const level of ['beginner', 'advanced']) for (const days of DAYS) for (const gender of ['unspecified', 'male', 'female']) {
        for (const card of GYM_CARDS) {
          cells += 1;
          const ids = offered({ card, level, days, gender });
          if (!ids.includes(GUIDED)) misses.push(`${card} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
          assert.ok(!ids.includes(HOME), `${card} ${level} ${days}d ${gender}: the home week at the gym`);
        }
        for (const card of HOME_CARDS) {
          cells += 1;
          const ids = offered({ card, level, days, gender });
          if (!ids.includes(HOME)) misses.push(`${card} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
          assert.ok(!ids.includes(GUIDED), `${card} ${level} ${days}d ${gender}: the gym week at home`);
        }
      }
      assert.ok(cells > 250, `only ${cells} answers walked`);
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} of ${cells} lean answers over 41 were not offered the fitting SHRED week`);
      // A beginner's featured card at three days, the days they can do.
      assert.equal(offered({ card: 'gym', level: 'beginner', days: 3 })[0], GUIDED);
      assert.equal(offered({ card: 'homeNone', level: 'beginner', days: 3 })[0], HOME);
    },
  },
  {
    name: 'age band: at 16-18 a lean answer at the gym is offered SHRED Guided, never VITAL Burn',
    run() {
      const misses = [];
      for (const level of ['beginner', 'advanced']) for (const days of DAYS) for (const gender of ['unspecified', 'male', 'female']) {
        for (const card of GYM_CARDS) {
          const ids = offered({ card, level, days, gender, ageRange: '18' });
          if (!ids.includes(GUIDED)) misses.push(`${card} ${level} ${days}d ${gender}: ${ids.join(' + ')}`);
        }
      }
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} gym answers at 16-18 were not offered SHRED Guided`);
      for (const card of Object.keys(CARDS)) for (const level of ['beginner', 'advanced', 'pro']) for (const days of DAYS) {
        assert.ok(!offered({ card, level, days, ageRange: '18' }).includes(HOME), `${card} ${level} ${days}d at 16-18`);
      }
    },
  },
  {
    name: 'age band: 19-40 never see SHRED Guided or VITAL Burn, and neither is offered for any other goal',
    run() {
      let cells = 0;
      for (const ageRange of ['19_25', '26_30', '31_40']) for (const card of Object.keys(CARDS)) for (const level of ['beginner', 'advanced', 'pro']) {
        for (const days of DAYS) for (const goal of GOALS) {
          cells += 1;
          const ids = offered({ card, goal, level, days, ageRange });
          assert.ok(!ids.includes(GUIDED) && !ids.includes(HOME), `${ageRange} ${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
        }
      }
      assert.ok(cells > 1500, `only ${cells} answers walked`);
      // They are written for the lean goal: nothing else is handed either.
      const misses = [];
      for (const card of ['gym', 'homeNone']) for (const goal of ['strength', 'muscle', 'run_mobility']) for (const level of ['beginner', 'advanced']) for (const days of DAYS) {
        const ids = offered({ card, goal, level, days });
        if (ids.includes(GUIDED) || ids.includes(HOME)) misses.push(`${card} ${goal} ${level} ${days}d: ${ids.join(' + ')}`);
      }
      assert.deepEqual(misses.slice(0, 10), [], `${misses.length} answers for another goal were offered a SHRED week`);
    },
  },
  {
    name: 'age band: a reader over 41 with dumbbells is still handed the week that uses them first (VITAL Burn uses no weight)',
    run() {
      // The limit the owner should know: the recommender weighs a reader's own
      // gear before their age. VITAL Burn has no dumbbell in it, so a
      // dumbbell owner over 41 keeps Fat Burn HIIT and Home Dumbbell
      // Upper/Lower. Pinned so that a change here is a decision.
      for (const card of ['dumbbells', 'dumbbellsBench']) for (const level of ['beginner', 'advanced']) for (const days of DAYS) {
        const ids = offered({ card, level, days });
        assert.ok(!ids.includes(HOME), `${card} ${level} ${days}d: ${ids.join(' + ')}`);
      }
    },
  },
];
