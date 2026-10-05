const assert = require('node:assert/strict');

const { applyCautionFlagsToExercises } = require('../../.test-dist/lib/cautionExerciseFilter.js');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { buildProgramFocusSplit } = require('../../.test-dist/lib/programFocusSplit.js');
const { exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionAreaMatching.js');
const { programGearUse } = require('../../.test-dist/lib/programEquipmentFit.js');
const { t } = require('../../.test-dist/lib/i18n.js');

/**
 * The fixes behind the recommendation accuracy ceilings (2026-10-05), each
 * pinned where it lives, so a regression names its cause and not only a count.
 */
const lift = (exerciseName, sets = 3) => ({
  id: exerciseName,
  exerciseName,
  slotId: exerciseName,
  role: 'primary',
  progressionPriority: 'high',
  trackingMode: 'load_and_reps',
  sets,
  repsMin: 8,
  repsMax: 8,
  restSecondsMin: 90,
  restSecondsMax: 90,
  substitutionGroup: 'x',
});

module.exports = [
  {
    name: 'recommendation fixes: a careful swap is something the reader can do with their gear',
    run() {
      const knees = [{ area: 'knees', level: 'careful', refinements: [] }];
      // No gear at home: "squat → Box Squat" needs a barbell and a rack.
      const home = applyCautionFlagsToExercises([lift('Goblet Squat')], knees, [], []);
      for (const exercise of home.exercises) {
        assert.equal(isExerciseAllowedWithEquipment(exercise.exerciseName, []), true, exercise.exerciseName);
      }
      // At a gym the careful swap still happens.
      const gym = applyCautionFlagsToExercises([lift('Back Squat')], knees, [], null);
      assert.equal(gym.exercises[0].exerciseName, 'Box Squat');
    },
  },
  {
    name: 'recommendation fixes: "run" is a word, not the middle of "Crunch"; holds and drills are what they are',
    run() {
      assert.deepEqual(buildProgramFocusSplit([{ exercises: [lift('Bench Press'), lift('Cable Crunch')] }]), [
        { quality: 'Muscle', pct: 100 },
      ]);
      const mobility = buildProgramFocusSplit([{ exercises: [lift('Standing Forward Fold'), lift('Sphinx Pose')] }]);
      assert.deepEqual(mobility, [{ quality: 'Mobility', pct: 100 }]);
      const conditioning = buildProgramFocusSplit([{ exercises: [lift('Ladder Drill'), lift('Pogo Hops'), lift('Treadmill Run')] }]);
      assert.deepEqual(conditioning, [{ quality: 'Conditioning', pct: 100 }]);
    },
  },
  {
    name: 'recommendation fixes: lifting splits into strength and muscle by the reps written for it',
    run() {
      const heavy = { ...lift('Back Squat', 5), repsMin: 5, repsMax: 5 };
      const pump = { ...lift('Dumbbell Curl', 3), repsMin: 12, repsMax: 12 };
      const plank = { ...lift('Plank', 2), trackingMode: 'hold', repsMin: 5, repsMax: 5 };
      assert.deepEqual(buildProgramFocusSplit([{ exercises: [heavy, pump, plank] }]), [
        { quality: 'Strength', pct: 50 },
        { quality: 'Muscle', pct: 50 },
      ]);
      // A 5x5 reads as strength; a plank's five is seconds, not a heavy set.
      assert.equal(t('fi', 'focus.quality.strength'), 'Voima');
      assert.equal(t('fi', 'focus.quality.muscle'), 'Lihaskasvu');
      assert.equal(t('en', 'focus.quality.muscle'), 'Muscle');
    },
  },
  {
    name: 'recommendation fixes: a knee to avoid keeps the landings out too',
    run() {
      for (const name of ['Burpee', 'Jumping Jack', 'Mountain Climber', 'Pogo Hops', 'High Knees']) {
        assert.equal(exerciseHitsCautionArea(name, 'knees'), true, name);
      }
      for (const name of ['Leg Curl', 'Hip Thrust', 'Plank', 'Bench Press']) {
        assert.equal(exerciseHitsCautionArea(name, 'knees'), false, name);
      }
    },
  },
  {
    name: 'recommendation fixes: a gym has a pull-up bar and bands, and a home has what was ticked',
    run() {
      const gym = resolveAvailableEquipment({ trainingEnvironment: 'full_gym', equipmentItems: ['Barbells', 'Machines'] });
      assert.ok(gym.includes('Pull-up bar') && gym.includes('Resistance bands'));
      assert.deepEqual(resolveAvailableEquipment({ trainingEnvironment: 'home_gym', equipmentItems: ['Dumbbells'] }), ['Dumbbells']);
    },
  },
  {
    name: 'recommendation fixes: how much of the reader’s gear a programme uses',
    run() {
      assert.equal(programGearUse('tpl_home_dumbbell_upper_lower_v1', ['Dumbbells']), 1);
      assert.equal(programGearUse('tpl_gainer_at_home_beginner_v1', ['Dumbbells']), 0);
      assert.equal(programGearUse('tpl_gainer_at_home_beginner_v1', []), 0);
      assert.equal(programGearUse('tpl_gainer_at_home_beginner_v1', ['Yoga mat']), 0, 'a mat is not gear');
    },
  },
];
