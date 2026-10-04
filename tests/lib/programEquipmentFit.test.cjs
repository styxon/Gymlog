const assert = require('node:assert/strict');

const { programFitsEquipment, equipmentCandidatePool } = require('../../.test-dist/lib/programEquipmentFit.js');
const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require('../../.test-dist/lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { applyEquipmentToExercises } = require('../../.test-dist/lib/equipmentExerciseFilter.js');

const GOALS = ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];

const SETUPS = {
  dumbbellsOnly: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Dumbbells'] },
  homeDefault: {
    trainingEnvironment: 'minimal_equipment',
    equipment: 'minimal',
    equipmentItems: ['Dumbbells', 'Bench', 'Resistance bands'],
  },
  homeRack: {
    trainingEnvironment: 'home_gym',
    equipment: 'home',
    equipmentItems: ['Dumbbells', 'Barbell & plates', 'Squat rack', 'Bench', 'Resistance bands', 'Kettlebells', 'Pull-up bar'],
  },
  bandsOnly: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Resistance bands'] },
  nothing: { trainingEnvironment: 'bodyweight_only', equipment: 'home', equipmentItems: [] },
};

function recommend(setup, goal, level, daysPerWeek) {
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
  const recommendation = resolveFirstRunRecommendationWithTailoring(selection, null);
  return { selection, recommendation };
}

module.exports = [
  {
    name: 'equipment fit: a programme fits when the reader\'s gear leaves it mostly as written',
    run() {
      // Unknown gear constrains nothing.
      assert.equal(programFitsEquipment('tpl_gainer_calisthenics_mastery_v1', null), true);
      // Calisthenics without a bar lost its whole pull day.
      assert.equal(programFitsEquipment('tpl_gainer_calisthenics_mastery_v1', []), false);
      assert.equal(programFitsEquipment('tpl_gainer_calisthenics_mastery_v1', ['Resistance bands']), false);
      assert.equal(programFitsEquipment('tpl_gainer_calisthenics_mastery_v1', ['Pull-up bar', 'Yoga mat']), true);
      // A barbell programme fits a home rack, not a pair of dumbbells.
      assert.equal(programFitsEquipment('tpl_3_day_strength_base_v1', SETUPS.homeRack.equipmentItems), true);
      assert.equal(programFitsEquipment('tpl_3_day_strength_base_v1', ['Dumbbells']), false);
    },
  },
  {
    name: 'equipment fit: a gym reader still draws from the whole catalog, and nobody draws from nothing',
    run() {
      const all = equipmentCandidatePool(RECOMMENDATION_PROGRAMS, { equipment: 'gym', availableEquipment: [] });
      assert.equal(all.length, RECOMMENDATION_PROGRAMS.length);
      // Unknown chips: the low-equipment shelf, as before.
      const shelf = equipmentCandidatePool(RECOMMENDATION_PROGRAMS, { equipment: 'home', availableEquipment: null });
      assert.ok(shelf.length > 0 && shelf.every((definition) => definition.equipmentTier === 'low_equipment'));
      for (const setup of Object.values(SETUPS)) {
        const pool = equipmentCandidatePool(RECOMMENDATION_PROGRAMS, {
          equipment: setup.equipment,
          availableEquipment: setup.equipmentItems,
        });
        assert.ok(pool.length >= 5, `${setup.equipmentItems.join('+') || 'nothing'}: ${pool.length}`);
      }
    },
  },
  {
    name: 'equipment fit: no recommended week loses exercises to the reader\'s gear',
    run() {
      // The coverage sweep's measure: every goal, level and day count, for five
      // home setups. Swaps are fine; dropped exercises mean the plan fits a
      // gear list the reader does not have.
      const losses = [];
      for (const [name, setup] of Object.entries(SETUPS)) {
        for (const goal of GOALS) {
          for (const level of LEVELS) {
            for (const daysPerWeek of DAYS) {
              const { selection, recommendation } = recommend(setup, goal, level, daysPerWeek);
              const week = composeProgramWeekForSelection(selection, recommendation.featuredProgramId);
              if (week && week.equipmentRemoved.length > 1) {
                losses.push(`${name} ${goal}/${level}/${daysPerWeek}: ${recommendation.featuredProgramId} lost ${week.equipmentRemoved.join(', ')}`);
              }
            }
          }
        }
      }
      assert.deepEqual(losses, []);
    },
  },
  {
    name: 'equipment fit: calisthenics only for a reader with a bar; a home rack opens the barbell shelf',
    run() {
      for (const setupName of ['nothing', 'bandsOnly', 'dumbbellsOnly', 'homeDefault']) {
        for (const goal of GOALS) {
          for (const level of LEVELS) {
            for (const daysPerWeek of DAYS) {
              const { recommendation } = recommend(SETUPS[setupName], goal, level, daysPerWeek);
              assert.notEqual(
                recommendation.featuredProgramId,
                'tpl_gainer_calisthenics_mastery_v1',
                `${setupName} ${goal}/${level}/${daysPerWeek}`,
              );
            }
          }
        }
      }
      const rackRecommendation = recommend(SETUPS.homeRack, 'strength', 'advanced', 4).recommendation;
      const rack = rackRecommendation.featuredProgramId;
      const definition = RECOMMENDATION_PROGRAMS.find((entry) => entry.programId === rack);
      assert.equal(definition.equipmentTier, 'full_gym', `a home rack got ${rack}`);
      // And it is not told "nothing in it needs a gym" about a barbell programme.
      assert.equal(rackRecommendation.waterfall.whyPrimary, 'wf.home_gear.primary');
      const dumbbells = recommend(SETUPS.dumbbellsOnly, 'muscle', 'advanced', 4).recommendation;
      assert.equal(dumbbells.waterfall.whyPrimary, 'wf.home_equipment.primary');
    },
  },
  {
    name: 'home dumbbell upper/lower: four days a pair of dumbbells can run as written',
    run() {
      const template = getWorkoutTemplateById('tpl_home_dumbbell_upper_lower_v1');
      assert.ok(template);
      assert.equal(template.daysPerWeek, 4);
      assert.equal(template.sessions.length, 4);
      for (const session of template.sessions) {
        assert.ok(session.exercises.length >= 5, session.name);
        const adjusted = applyEquipmentToExercises(session.exercises, ['Dumbbells']);
        assert.deepEqual(adjusted.removed, [], session.name);
        assert.deepEqual(adjusted.swapped, [], session.name);
      }
      // And it is the answer for the reader it was made for.
      for (const goal of ['muscle', 'strength']) {
        for (const setup of [SETUPS.dumbbellsOnly, SETUPS.homeDefault]) {
          assert.equal(
            recommend(setup, goal, 'advanced', 4).recommendation.featuredProgramId,
            'tpl_home_dumbbell_upper_lower_v1',
            `${goal} ${setup.equipmentItems.join('+')}`,
          );
        }
      }
      // A reader with nothing is not handed a dumbbell programme.
      for (const goal of GOALS) {
        for (const daysPerWeek of DAYS) {
          assert.notEqual(
            recommend(SETUPS.nothing, goal, 'advanced', daysPerWeek).recommendation.featuredProgramId,
            'tpl_home_dumbbell_upper_lower_v1',
          );
        }
      }
    },
  },
];
