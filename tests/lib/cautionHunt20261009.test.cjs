const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = '../../.test-dist/';
const first = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { exerciseHitsCautionArea, AREA_CAREFUL_SWAPS, AREA_BODYWEIGHT_SWAPS } = require(dist + 'lib/cautionExerciseFilter.js');
const { resolveAvailableEquipment } = require(dist + 'lib/equipmentExerciseFilter.js');
const { equipmentSetupForChips } = require(dist + 'lib/equipmentCardSetup.js');
const { WORKOUT_TEMPLATES_V1 } = require(dist + 'features/workout/workoutCatalog.js');
const { GENERATED_EXERCISE_LIBRARY } = require(dist + 'data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require(dist + 'data/extraExerciseLibrary.js');

/**
 * Bug hunt, 2026-10-09: the onboarding caution filter and recommendation.
 *
 * - the name lists for hips, ankles, neck, elbows and wrists were narrower
 *   than the work that loads those areas, so an "avoid" week kept it;
 * - careful swap rows for the bench press could never fire;
 * - a run + mobility reader handed a week with no runs was told it was
 *   "6 days for run + mobility";
 * - the full-gym card with every chip unticked meant "all gear".
 */

const hits = (name, area) => exerciseHitsCautionArea(name, area);

function allExerciseNames() {
  const names = new Set();
  for (const item of [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY]) names.add(item.name);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'exerciseName' && typeof value === 'string') names.add(value);
      else walk(value);
    }
  };
  walk(WORKOUT_TEMPLATES_V1);
  return [...names];
}

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];

function selection({ goal, level, days, environment, items, caution = [] }) {
  const heavyGym = environment === 'full_gym';
  return {
    ...first.DEFAULT_FIRST_RUN_SELECTION,
    goal,
    goals: [goal],
    level,
    daysPerWeek: days,
    equipment: heavyGym ? 'gym' : 'minimal',
    trainingEnvironment: environment,
    equipmentItems: items,
    secondaryOutcomes: [],
    focusAreas: [],
    availableDays: first.DEFAULT_RHYTHM_BY_DAYS[days],
    cautionFlags: caution.map(([area, level]) => ({ area, level, refinements: [] })),
  };
}

function tailoring(sel) {
  return {
    setupEquipment: sel.equipment,
    setupFreeWeightsPreference: 'neutral',
    setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral',
    setupShoulderFriendlySwaps: 'neutral',
    setupElbowFriendlySwaps: 'neutral',
    setupKneeFriendlySwaps: 'neutral',
  };
}

function weekNames(week) {
  return week.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
}

module.exports = [
  {
    name: 'caution hunt 2026-10-09: hips "avoid" reaches the hip mobility and activation drills',
    run() {
      for (const name of [
        'Pigeon Pose (each side)', 'Couch Stretch (each side)', '90/90 Hip Stretch', 'Frog Stretch', 'Cossack Squat',
        'Deep Squat Hold', 'Supported Deep Squat Hold', 'Hip Circles', 'Butterfly Stretch', 'Kneeling Hip Flexor',
        'Hip Flexor Stretch', 'Banded Fire Hydrant', 'Hip Thrust', 'Sumo Squat',
      ]) {
        assert.equal(hits(name, 'hips'), true, `${name} must hit hips`);
      }
      // The pec fly machine is called "Butterfly", the bridge is the careful
      // stand-in for a hip thrust, and the rest of the lower body stays out.
      for (const name of ['Butterfly', 'Glute Bridge', 'Back Squat', 'Romanian Deadlift', 'Bench Press', 'Lat Pulldown']) {
        assert.equal(hits(name, 'hips'), false, `${name} must not hit hips`);
      }

      // The composed week: the Hip Opening Flow day was kept whole.
      const sel = selection({ goal: 'run_mobility', level: 'advanced', days: 5, environment: 'full_gym', items: GYM_ALL, caution: [['hips', 'avoid']] });
      const week = composeProgramWeekForSelection(sel, 'tpl_gainer_mobility_flow_v1');
      assert.ok(week.cautionRemoved.length >= 6, `removed ${week.cautionRemoved.map((entry) => entry.name).join(', ')}`);
      const left = weekNames(week).filter((name) => hits(name, 'hips'));
      assert.deepEqual(left, [], `hip drills still in the week: ${left.join(', ')}`);
      assert.ok(weekNames(week).length > 15, 'the rest of the week is still there');
    },
  },
  {
    name: 'caution hunt 2026-10-09: ankles "avoid" takes the landings and cuts the knees list already takes',
    run() {
      for (const name of [
        'Lateral Bound', 'Cone Drill (Pro Agility)', 'Ladder Drill', 'High Knees', 'Burpee', 'Pogo Hops', 'Mountain Climbers',
        'Hurdle Hops', 'Single-Leg Hop Progression', 'Carioca Quick Step', 'Side to Side Box Shuffle', 'Box Skip', 'Quick Leap',
      ]) {
        assert.equal(hits(name, 'ankles'), true, `${name} must hit ankles`);
        assert.equal(hits(name, 'knees'), true, `${name} hits knees today; the two lists agree on landings`);
      }
      // A bike has no landing; a crunch and a chest fly are not hops or skips.
      for (const name of ['Stationary Bike Blocks', 'Cable Crunch', 'Hip Circles', 'Back Squat']) {
        assert.equal(hits(name, 'ankles'), false, `${name} must not hit ankles`);
      }

      const sel = selection({ goal: 'run_mobility', level: 'pro', days: 5, environment: 'full_gym', items: GYM_ALL, caution: [['ankles', 'avoid']] });
      const week = composeProgramWeekForSelection(sel, 'tpl_gainer_athlete_conditioning_v1');
      const left = weekNames(week).filter((name) => /bound|cone drill|ladder drill|high knees|burpee|pogo/i.test(name));
      assert.deepEqual(left, [], `landing drills still in the week: ${left.join(', ')}`);
    },
  },
  {
    name: 'caution hunt 2026-10-09: neck, elbows and wrists "avoid" reach the work that loads them',
    run() {
      for (const name of ['Chin To Chest Stretch', 'Wall Handstand Hold', 'Handstand Wall Walk']) {
        assert.equal(hits(name, 'neck'), true, `${name} must hit neck`);
      }
      for (const name of ['Diamond Push-Up', 'JM Press', 'Lying Dumbbell Tricep Extension', 'Cable One Arm Tricep Extension', 'Tricep Dumbbell Kickback']) {
        assert.equal(hits(name, 'elbows'), true, `${name} must hit elbows`);
      }
      for (const name of ['Tuck Planche Hold', 'L-Sit Hold', 'Plank Shoulder Tap', 'Plank Jack', 'Plank to Pike', 'Plank-Up', 'Inchworm', 'Spider Crawl']) {
        assert.equal(hits(name, 'wrists'), true, `${name} must hit wrists`);
      }
      // Forearm work and the glute kickback stay out; a chin-up is a pull.
      for (const name of ['Plank', 'Side Plank', 'Chin-Up', 'Chin Ups', 'Glute Kickback', 'Cable Glute Kickback']) {
        for (const area of ['neck', 'elbows', 'wrists']) {
          assert.equal(hits(name, area), false, `${name} must not hit ${area}`);
        }
      }

      const neck = composeProgramWeekForSelection(
        selection({ goal: 'general_fitness', level: 'beginner', days: 5, environment: 'full_gym', items: GYM_ALL, caution: [['neck', 'avoid']] }),
        'tpl_3_day_full_body_v1',
      );
      assert.ok(!weekNames(neck).includes('Chin To Chest Stretch'));

      const wrists = composeProgramWeekForSelection(
        selection({ goal: 'strength', level: 'advanced', days: 4, environment: 'bodyweight_only', items: [], caution: [['wrists', 'avoid']] }),
        'tpl_home_calisthenics_strength_5_day_v1',
      );
      const names = weekNames(wrists);
      assert.ok(!names.includes('Tuck Planche Hold') && !names.includes('L-Sit Hold'), names.join(', '));

      const elbows = composeProgramWeekForSelection(
        selection({ goal: 'strength', level: 'beginner', days: 3, environment: 'bodyweight_only', items: [], caution: [['elbows', 'avoid']] }),
        'tpl_home_bodyweight_strength_3_day_v1',
      );
      assert.ok(!weekNames(elbows).includes('Diamond Push-Up'));
    },
  },
  {
    name: 'caution hunt 2026-10-09: every careful and bodyweight swap row names a lift its own area test calls a hit',
    run() {
      // A swap is only looked up for a name the area test already flags, so a
      // row whose pattern the area does not match is a promise nothing keeps
      // (Bench Press -> Machine Chest Press for careful shoulders never fired).
      const dead = [];
      for (const [kind, table] of [['careful', AREA_CAREFUL_SWAPS], ['bodyweight', AREA_BODYWEIGHT_SWAPS]]) {
        for (const [area, rows] of Object.entries(table)) {
          for (const [pattern, to] of rows) {
            if (!hits(pattern, area)) {
              dead.push(`${kind} ${area}: ${pattern} -> ${to}`);
            }
          }
        }
      }
      assert.deepEqual(dead, []);
    },
  },
  {
    name: 'caution hunt 2026-10-09: a run + mobility reader handed a week with no runs is not told it is for run + mobility',
    run() {
      const bodyweight = selection({ goal: 'run_mobility', level: 'pro', days: 6, environment: 'bodyweight_only', items: [] });
      const rec = first.resolveFirstRunRecommendationWithTailoring(bodyweight, tailoring(bodyweight), 'en');
      const programId = rec.featuredProgramId;
      assert.notEqual(programId, 'tpl_3_day_run_mobility_v1');
      assert.equal(rec.waterfall.whyPrimary, 'wf.run_mobility.closestPrimary');

      const linesFor = (language) =>
        first.buildFirstRunRecommendationReasons(bodyweight, { projectedDaysPerWeek: 6, language, programId });
      assert.equal(linesFor('en')[0], '6 days a week. There is no running in this program.');
      assert.equal(linesFor('fi')[0], '6 päivää viikossa. Ohjelmassa ei ole juoksua.');
      assert.ok(!/run \+ mobility/i.test(linesFor('en').join(' ')));

      // The reader whose pick does run keeps the line about the goal.
      const runner = selection({ goal: 'run_mobility', level: 'beginner', days: 3, environment: 'bodyweight_only', items: [] });
      const runRec = first.resolveFirstRunRecommendationWithTailoring(runner, tailoring(runner), 'en');
      assert.equal(runRec.featuredProgramId, 'tpl_3_day_run_mobility_v1');
      const runLines = first.buildFirstRunRecommendationReasons(runner, { projectedDaysPerWeek: 3, language: 'en', programId: runRec.featuredProgramId });
      assert.match(runLines[0], /^3 days for /);
      assert.equal(runRec.waterfall.whyPrimary, 'wf.home_equipment.primary');
    },
  },
  {
    name: 'caution hunt 2026-10-09: the full-gym card with every chip unticked is the bodyweight setup, as the home card is',
    run() {
      const gym = { id: 'full_gym', equipment: 'gym', trainingEnvironment: 'full_gym' };
      const home = { id: 'home_gym', equipment: 'home', trainingEnvironment: 'home_gym' };

      assert.deepEqual(equipmentSetupForChips(gym, ['Dumbbells']), { equipment: 'gym', trainingEnvironment: 'full_gym' });
      assert.deepEqual(equipmentSetupForChips(gym, GYM_ALL), { equipment: 'gym', trainingEnvironment: 'full_gym' });
      assert.deepEqual(equipmentSetupForChips(gym, []), { equipment: 'minimal', trainingEnvironment: 'bodyweight_only' });
      // The home card's own rules are unchanged.
      assert.deepEqual(equipmentSetupForChips(home, []), { equipment: 'home', trainingEnvironment: 'bodyweight_only' });
      assert.deepEqual(equipmentSetupForChips(home, ['Dumbbells']), { equipment: 'minimal', trainingEnvironment: 'minimal_equipment' });
      assert.deepEqual(equipmentSetupForChips(home, ['Squat rack']), { equipment: 'home', trainingEnvironment: 'home_gym' });

      // End to end: no chips no longer resolves to "all gear".
      const setup = equipmentSetupForChips(gym, []);
      const gearOf = (items) => resolveAvailableEquipment({ trainingEnvironment: setup.trainingEnvironment, equipmentItems: items });
      assert.deepEqual(gearOf([]), []);
      const sel = {
        ...selection({ goal: 'muscle', level: 'beginner', days: 3, environment: setup.trainingEnvironment, items: [] }),
        equipment: setup.equipment,
      };
      const rec = first.resolveFirstRunRecommendationWithTailoring(sel, tailoring(sel), 'en');
      const week = composeProgramWeekForSelection(sel, rec.featuredProgramId);
      const gearLifts = weekNames(week).filter((name) => /barbell|back squat|bench press|machine|cable|lat pulldown|leg press|pushdown/i.test(name));
      assert.deepEqual(gearLifts, []);
    },
  },
  {
    name: 'caution hunt 2026-10-09: the onboarding screen derives the card setup from the chips through equipmentSetupForChips',
    run() {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'OnboardingScreen.tsx'), 'utf8');
      const body = source.slice(source.indexOf('function applyEquipmentEnvironment'));
      const fn = body.slice(0, body.indexOf('function selectEquipmentSetup'));
      assert.match(fn, /equipmentSetupForChips\(option, items\)/);
      assert.doesNotMatch(fn, /option\.trainingEnvironment/, 'the card must not store its own environment past the helper');
    },
  },
];
