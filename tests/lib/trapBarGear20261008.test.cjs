const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require(dist + 'lib/firstRunSetup.js');
const { RECOMMENDATION_PROGRAMS } = require(dist + 'lib/recommendationCatalog.js');
const { getWorkoutTemplateById } = require(dist + 'features/workout/workoutCatalog.js');
const {
  applyEquipmentToExercises,
  isExerciseAllowedWithEquipment,
  resolveAvailableEquipment,
  swapKeepsTheLift,
} = require(dist + 'lib/equipmentExerciseFilter.js');
const { programFitsEquipment } = require(dist + 'lib/programEquipmentFit.js');

/**
 * A hex bar was handed to anyone who ticked "Barbell & plates" (round 3
 * persona hunt, 2026-10-08): Trap Bar Deadlift is the lead lift of nine
 * programmes, and the home card's chip is a straight bar. The full-gym card's
 * "Barbells" still carries it.
 */

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const HOME_BARBELL = ['Barbell & plates', 'Squat rack', 'Dumbbells', 'Bench'];

module.exports = [
  {
    name: 'trap bar: a hex bar is gym gear, so a home barbell lifter gets the straight-bar deadlift',
    run() {
      assert.equal(isExerciseAllowedWithEquipment('Trap Bar Deadlift', HOME_BARBELL), false);
      assert.equal(isExerciseAllowedWithEquipment('Trap Bar Deadlift', ['Barbell & plates']), false);
      assert.equal(isExerciseAllowedWithEquipment('Trap Bar Deadlift', ['Barbells']), true);
      assert.equal(
        isExerciseAllowedWithEquipment(
          'Trap Bar Deadlift',
          resolveAvailableEquipment({ trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL }),
        ),
        true,
      );

      const exercise = { exerciseName: 'Trap Bar Deadlift', sets: 4, repsMin: 5, repsMax: 5, trackingMode: 'load_and_reps' };
      const adjusted = applyEquipmentToExercises([exercise], HOME_BARBELL);
      assert.deepEqual(adjusted.removed, []);
      assert.deepEqual(adjusted.swapped, [{ from: 'Trap Bar Deadlift', to: 'Barbell Deadlift' }]);
      assert.equal(adjusted.exercises[0].sets, 4);
      assert.equal(adjusted.exercises[0].repsMin, 5);
      // And for a reader with dumbbells only it is still a hinge they can do.
      assert.equal(applyEquipmentToExercises([exercise], ['Dumbbells']).swapped[0].to, 'Stiff-Legged Dumbbell Deadlift');
      assert.equal(swapKeepsTheLift({ from: 'Trap Bar Deadlift', to: 'Barbell Deadlift' }), true);
      assert.equal(swapKeepsTheLift({ from: 'Trap Bar Deadlift', to: 'Stiff-Legged Dumbbell Deadlift' }), false);
    },
  },
  {
    name: 'trap bar: no programme composed for a home barbell lifter holds a trap bar lift, and the swap does not unfit the week',
    run() {
      const trapBarPrograms = RECOMMENDATION_PROGRAMS.filter((definition) => {
        const template = getWorkoutTemplateById(definition.programId);
        return template && template.sessions.some((session) => session.exercises.some((e) => /trap bar/i.test(e.exerciseName)));
      });
      assert.ok(trapBarPrograms.length >= 5, 'the programmes with a trap bar lift');
      const home = { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: HOME_BARBELL };
      for (const definition of trapBarPrograms) {
        const goal = definition.supportedGoals[0];
        const selection = {
          ...DEFAULT_FIRST_RUN_SELECTION,
          ...home,
          goal,
          goals: [goal],
          level: definition.supportedLevels[0],
          daysPerWeek: definition.daysPerWeek,
          gender: 'unspecified',
          focusAreas: [],
          cautionFlags: [],
          availableDays: [],
        };
        const week = composeProgramWeekForSelection(selection, definition.programId);
        const names = week.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseName));
        assert.ok(!names.some((name) => /trap bar/i.test(name)), `${definition.programId} still holds a trap bar lift`);
      }
      // The straight bar stands in for the hex bar without counting as a swap
      // against the programme: the one trap bar day tipped POWERBUILD past a
      // third of its lifts swapped and out of the home barbell reader's pool.
      assert.equal(programFitsEquipment('tpl_4_day_powerbuilding_v1', HOME_BARBELL), true);
      assert.equal(programFitsEquipment('tpl_3_day_strength_base_v1', HOME_BARBELL), true);
    },
  },
];
