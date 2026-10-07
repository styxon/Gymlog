const assert = require('node:assert/strict');

const { programFitsEquipment } = require('../../.test-dist/lib/programEquipmentFit.js');
const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require('../../.test-dist/lib/firstRunSetup.js');
const { getRecommendationProgramDefinition } = require('../../.test-dist/lib/recommendationCatalog.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { applyEquipmentToExercises } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { buildProgramFocusSplit, liftingFocusPct } = require('../../.test-dist/lib/programFocusSplit.js');
const { resolveProgramEquipment } = require('../../.test-dist/lib/programEquipment.js');

/**
 * The two content gaps the recommendation matrix named on 2026-10-05, and the
 * three programmes (plus one goal) that close them.
 *
 *  - Build muscle at advanced or pro with no gear, or only a bar, bands, a
 *    kettlebell or a mat: no programme listed the goal at any day count. Two
 *    days (Bodyweight Full Body), four (Bodyweight Upper/Lower now lists
 *    muscle) and six (Bodyweight Push/Pull/Legs) cover two to six within a day.
 *  - Lean and athletic, beginner, with a barbell, a rack and a bench: STRONG
 *    was handed out on its backup goal. Athletic Starter lists the goal.
 *
 * Why two, four and six and not three and five: where a bodyweight week sat
 * exactly on the reader's days and a dumbbell week a day off, the bodyweight
 * one outbid it for readers who own dumbbells and a bench, and the matrix's
 * "owns gear, plan uses none" count rose from 85 to 104. The pins below hold
 * that line.
 */
const NO_GEAR = [
  { trainingEnvironment: 'bodyweight_only', equipment: 'home', equipmentItems: [] },
  { trainingEnvironment: 'bodyweight_only', equipment: 'minimal', equipmentItems: ['Pull-up bar'] },
  { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Resistance bands'] },
  { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Kettlebells'] },
];
const DUMBBELLS_AND_BENCH = [
  { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Dumbbells', 'Bench'] },
  { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'] },
  { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Dumbbells', 'Kettlebells'] },
];
const HOME_RACK = [
  { trainingEnvironment: 'home_gym', equipment: 'home', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench'] },
  { trainingEnvironment: 'home_gym', equipment: 'home', equipmentItems: ['Dumbbells', 'Bench', 'Squat rack', 'Barbell & plates'] },
  { trainingEnvironment: 'home_gym', equipment: 'home', equipmentItems: ['Dumbbells', 'Bench', 'Squat rack', 'Barbell & plates', 'Pull-up bar'] },
];

function featured(setup, goal, level, daysPerWeek) {
  const selection = {
    ...DEFAULT_FIRST_RUN_SELECTION,
    goal,
    goals: [goal],
    level,
    daysPerWeek,
    availableDays: [],
    scheduleMode: 'app_managed',
    ...setup,
  };
  // The same tailoring the onboarding screen passes: its cell swap is where a
  // same-family, same-days programme can overtake the waterfall's pick.
  const tailoring = {
    setupEquipment: selection.equipment,
    setupFreeWeightsPreference: 'neutral',
    setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral',
    setupShoulderFriendlySwaps: 'neutral',
    setupElbowFriendlySwaps: 'neutral',
    setupKneeFriendlySwaps: 'neutral',
  };
  return resolveFirstRunRecommendationWithTailoring(selection, tailoring).featuredProgramId;
}

const BODYWEIGHT_MUSCLE = {
  2: 'tpl_home_bodyweight_full_body_v1',
  3: 'tpl_home_bodyweight_upper_lower_v1',
  4: 'tpl_home_bodyweight_upper_lower_v1',
  5: 'tpl_home_bodyweight_upper_lower_v1',
  6: 'tpl_home_bodyweight_ppl_v1',
};

module.exports = [
  {
    name: 'catalog gaps: no gear and advanced or pro muscle is handed a programme that lists muscle, at every day count',
    run() {
      for (const setup of NO_GEAR) {
        for (const level of ['advanced', 'pro']) {
          for (const days of [2, 3, 4, 5, 6]) {
            const id = featured(setup, 'muscle', level, days);
            const definition = getRecommendationProgramDefinition(id);
            const label = `${setup.equipmentItems.join('+') || 'nothing'} ${level} ${days}d -> ${id}`;
            assert.ok(definition.supportedGoals.includes('muscle'), label);
            assert.ok(definition.supportedLevels.includes(level), label);
            // Two to six within a day: the answer is never further off than that.
            assert.ok(Math.abs(definition.daysPerWeek - days) <= 1, label);
          }
        }
      }
      // And the reader with nothing, specifically.
      for (const [days, expected] of Object.entries(BODYWEIGHT_MUSCLE)) {
        assert.equal(featured(NO_GEAR[0], 'muscle', 'advanced', Number(days)), expected, `${days}d`);
      }
    },
  },
  {
    name: 'catalog gaps: dumbbells and a bench still get a dumbbell week, not a bodyweight one',
    run() {
      const dumbbellWeeks = new Set(['tpl_home_dumbbell_upper_lower_v1', 'tpl_home_dumbbell_ppl_v1']);
      for (const setup of DUMBBELLS_AND_BENCH) {
        for (const level of ['advanced', 'pro']) {
          for (const days of [3, 4, 5, 6]) {
            const id = featured(setup, 'muscle', level, days);
            assert.ok(
              dumbbellWeeks.has(id),
              `${setup.equipmentItems.join('+')} ${level} ${days}d was handed ${id}, which uses none of their gear`,
            );
          }
        }
      }
    },
  },
  {
    name: 'catalog gaps: a beginner with a barbell, a rack and a bench who wants lean and athletic is featured Athletic Starter',
    run() {
      for (const setup of HOME_RACK) {
        for (const days of [2, 3, 4, 5, 6]) {
          assert.equal(featured(setup, 'lean_athletic', 'beginner', days), 'tpl_athletic_starter_v1', `${setup.equipmentItems.join('+')} ${days}d`);
        }
      }
      const definition = getRecommendationProgramDefinition('tpl_athletic_starter_v1');
      assert.deepEqual(definition.supportedGoals, ['lean_athletic']);
      assert.deepEqual(definition.supportedLevels, ['beginner']);
      // Three days, because a beginner is held to three.
      assert.equal(definition.daysPerWeek, 3);
    },
  },
  {
    name: 'catalog gaps: Athletic Starter is for a barbell, and a reader with dumbbells only is not handed it',
    run() {
      const gear = ['Barbell & plates', 'Squat rack', 'Bench'];
      const template = getWorkoutTemplateById('tpl_athletic_starter_v1');
      assert.equal(template.level, 'beginner');
      assert.equal(template.sessions.length, 3);
      assert.deepEqual(resolveProgramEquipment(template.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseName))), [
        'Barbells',
        'Squat rack',
        'Bench',
      ]);
      for (const session of template.sessions) {
        const adjusted = applyEquipmentToExercises(session.exercises, gear);
        assert.deepEqual(adjusted.removed, [], session.name);
        assert.deepEqual(adjusted.swapped, [], session.name);
      }
      assert.equal(programFitsEquipment('tpl_athletic_starter_v1', gear), true);
      // Five of its fourteen lifts are barbell-only: dumbbells would leave over a
      // third of the week swapped, and it would out-rank the dumbbell weeks on days.
      for (const chips of [['Dumbbells'], ['Dumbbells', 'Pull-up bar'], ['Dumbbells', 'Kettlebells'], []]) {
        assert.equal(programFitsEquipment('tpl_athletic_starter_v1', chips), false, chips.join('+') || 'nothing');
      }
      // The week says what it is: strength with a real conditioning share.
      const split = buildProgramFocusSplit(template.sessions);
      const conditioning = split.find((segment) => segment.quality === 'Conditioning')?.pct ?? 0;
      assert.ok(conditioning >= 15 && conditioning <= 50, `conditioning ${conditioning}`);
    },
  },
  {
    name: 'catalog gaps: the bodyweight muscle weeks run on no gear, and a pull-up is the only thing that swaps',
    run() {
      const cases = [
        ['tpl_home_bodyweight_full_body_v1', 2],
        ['tpl_home_bodyweight_ppl_v1', 6],
      ];
      for (const [programId, days] of cases) {
        const template = getWorkoutTemplateById(programId);
        assert.equal(template.sessions.length, days, programId);
        assert.equal(template.level, 'intermediate', `${programId}: 8 weeks, like the other advanced weeks`);
        const definition = getRecommendationProgramDefinition(programId);
        assert.deepEqual(definition.supportedGoals, ['muscle'], programId);
        assert.deepEqual(definition.supportedLevels, ['advanced', 'pro'], programId);
        assert.equal(definition.equipmentTier, 'low_equipment', programId);
        for (const gear of [[], ['Resistance bands'], ['Kettlebells'], ['Pull-up bar']]) {
          assert.equal(programFitsEquipment(programId, gear), true, `${programId} with ${gear.join('+') || 'nothing'}`);
        }
        for (const session of template.sessions) {
          assert.ok(session.exercises.length >= 5, `${programId} ${session.name}`);
          const adjusted = applyEquipmentToExercises(session.exercises, []);
          assert.deepEqual(adjusted.removed, [], `${programId} ${session.name}`);
          for (const swap of adjusted.swapped) {
            assert.equal(swap.from, 'Pull-Up', `${programId} ${session.name}: ${swap.from} -> ${swap.to}`);
            assert.equal(swap.to, 'Inverted Row', programId);
          }
          // With the bar, nothing swaps at all.
          const withBar = applyEquipmentToExercises(session.exercises, ['Pull-up bar']);
          assert.deepEqual(withBar.swapped, [], `${programId} ${session.name}`);
          for (const exercise of session.exercises) {
            assert.notEqual(exercise.trackingMode, 'load_and_reps', `${programId}: ${exercise.exerciseName}`);
          }
        }
        // A muscle week, not a conditioning one.
        const split = buildProgramFocusSplit(template.sessions);
        const lifting = liftingFocusPct(split);
        assert.ok(lifting >= 90, `${programId} lifting ${lifting}`);
      }
    },
  },
  {
    name: 'catalog gaps: Bodyweight Upper/Lower lists muscle outright, and strength stays a backup',
    run() {
      const definition = getRecommendationProgramDefinition('tpl_home_bodyweight_upper_lower_v1');
      assert.ok(definition.supportedGoals.includes('muscle'));
      assert.ok(definition.supportedGoals.includes('general_fitness'));
      assert.ok(definition.backupGoals.includes('strength'));
      assert.ok(!definition.backupGoals.includes('muscle'));
    },
  },
];
