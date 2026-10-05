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
      // A loaded twist and a frog pump are lifting; the stretches named alike are not.
      assert.deepEqual(buildProgramFocusSplit([{ exercises: [lift('Russian Twist'), lift('Frog Pump')] }]), [{ quality: 'Muscle', pct: 100 }]);
      assert.deepEqual(
        buildProgramFocusSplit([{ exercises: [lift('Seated Spinal Twist'), lift('Frog Stretch'), lift('Butterfly Stretch')] }]),
        [{ quality: 'Mobility', pct: 100 }],
      );
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
  {
    name: 'recommendation fixes: a reader with only dumbbells who wants strength is featured a dumbbell strength programme',
    run() {
      const dist = '../../.test-dist/lib/';
      const { recommendPrograms } = require(`${dist}recommendationScoring.js`);
      const { buildRecommendationInput } = require(`${dist}recommendationInput.js`);
      const { DEFAULT_FIRST_RUN_SELECTION } = require(`${dist}firstRunSetup.js`);
      const featured = (level, daysPerWeek, equipmentItems = ['Dumbbells']) =>
        recommendPrograms(
          buildRecommendationInput({
            ...DEFAULT_FIRST_RUN_SELECTION,
            goal: 'strength',
            goals: ['strength'],
            level,
            daysPerWeek,
            equipment: 'home',
            trainingEnvironment: 'home_gym',
            equipmentItems,
          }),
        ).featuredProgramId;
      assert.equal(featured('beginner', 3), 'tpl_home_dumbbell_strength_v1');
      assert.equal(featured('pro', 5), 'tpl_home_dumbbell_strength_split_v1');
      // The bench, bands, a bar and a kettlebell do not change the answer.
      assert.equal(featured('beginner', 3, ['Dumbbells', 'Bench', 'Resistance bands']), 'tpl_home_dumbbell_strength_v1');
      assert.equal(featured('advanced', 5, ['Dumbbells', 'Pull-up bar', 'Kettlebells']), 'tpl_home_dumbbell_strength_split_v1');
    },
  },
  {
    name: 'recommendation fixes: the dumbbell strength programmes are strength — fives and sixes, one rep number, long rests',
    run() {
      const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const { getRecommendationProgramDefinition } = require('../../.test-dist/lib/recommendationCatalog.js');
      for (const id of ['tpl_home_dumbbell_strength_v1', 'tpl_home_dumbbell_strength_split_v1']) {
        const template = getWorkoutTemplateById(id);
        assert.ok(template, id);
        assert.equal(template.goalType, 'strength', id);
        assert.equal(template.sessions.length, template.daysPerWeek, id);
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            if (exercise.trackingMode !== 'hold') {
              assert.equal(exercise.repsMin, exercise.repsMax, `${id}: ${exercise.exerciseName}`);
            }
            if (exercise.role !== 'accessory') {
              assert.ok(exercise.repsMax <= 6, `${id}: ${exercise.exerciseName} is a main lift above six reps`);
              assert.ok(exercise.restSecondsMin >= 120, `${id}: ${exercise.exerciseName} rests too little to be heavy`);
            }
          }
        }
        const definition = getRecommendationProgramDefinition(id);
        assert.deepEqual(definition.supportedGoals, ['strength'], id);
        assert.equal(definition.targetGender, 'unisex', id);
        assert.equal(programGearUse(id, ['Dumbbells']), 1, id);
      }
    },
  },
];
