const assert = require('node:assert/strict');

const { applyCautionFlagsToExercises } = require('../../.test-dist/lib/cautionExerciseFilter.js');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { buildProgramFocusSplit } = require('../../.test-dist/lib/programFocusSplit.js');
const { exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionAreaMatching.js');
const { programGearUse } = require('../../.test-dist/lib/programEquipmentFit.js');
const { t } = require('../../.test-dist/lib/i18n.js');
const { DEFAULT_FIRST_RUN_SELECTION, resolveFirstRunRecommendationWithTailoring } = require('../../.test-dist/lib/firstRunSetup.js');
const { RECOMMENDATION_PROGRAMS } = require('../../.test-dist/lib/recommendationCatalog.js');
const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { applyEquipmentToExercises } = require('../../.test-dist/lib/equipmentExerciseFilter.js');

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
  {
    name: 'bodyweight strength: a strength reader with no gear, a bar, bands, a kettlebell or a mat is handed a strength programme at every level and day count',
    run() {
      const BODYWEIGHT_STRENGTH = ['tpl_home_bodyweight_strength_3_day_v1', 'tpl_home_calisthenics_strength_5_day_v1'];
      const setups = {
        nothing: { trainingEnvironment: 'bodyweight_only', equipment: 'home', equipmentItems: [] },
        bar: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Pull-up bar'] },
        bands: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Resistance bands'] },
        kettlebell: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Kettlebells'] },
        barAndBands: { trainingEnvironment: 'minimal_equipment', equipment: 'minimal', equipmentItems: ['Resistance bands', 'Pull-up bar'] },
        bodyweightMat: {
          trainingEnvironment: 'bodyweight_only',
          equipment: 'minimal',
          equipmentItems: ['Pull-up bar', 'Resistance bands', 'Yoga mat'],
        },
      };
      const featured = (setup, level, daysPerWeek) =>
        resolveFirstRunRecommendationWithTailoring(
          {
            ...DEFAULT_FIRST_RUN_SELECTION,
            goal: 'strength',
            goals: ['strength'],
            level,
            daysPerWeek,
            availableDays: [],
            scheduleMode: 'app_managed',
            ...setup,
          },
          null,
        ).featuredProgramId;

      // The two answers the matrix named: a beginner for three days, a pro for five.
      assert.equal(featured(setups.nothing, 'beginner', 3), 'tpl_home_bodyweight_strength_3_day_v1');
      assert.equal(featured(setups.nothing, 'pro', 5), 'tpl_home_calisthenics_strength_5_day_v1');

      // And all of them. Strength was listed by no programme these readers could run.
      const misses = [];
      for (const [name, setup] of Object.entries(setups)) {
        for (const level of ['beginner', 'advanced', 'pro']) {
          for (const days of [2, 3, 4, 5, 6]) {
            const id = featured(setup, level, days);
            const definition = RECOMMENDATION_PROGRAMS.find((entry) => entry.programId === id);
            if (!BODYWEIGHT_STRENGTH.includes(id) || !definition.supportedGoals.includes('strength') || !definition.supportedLevels.includes(level)) {
              misses.push(`${name} ${level}/${days}: ${id}`);
            }
          }
        }
      }
      assert.deepEqual(misses, []);
    },
  },
  {
    name: 'bodyweight strength: the strength claim is the work — lead lifts unloaded, five or six reps, long rests, nothing to buy',
    run() {
      for (const id of ['tpl_home_bodyweight_strength_3_day_v1', 'tpl_home_calisthenics_strength_5_day_v1']) {
        const template = getWorkoutTemplateById(id);
        assert.equal(template.goalType, 'strength', id);
        assert.ok(template.sessions.length === template.daysPerWeek, id);
        const slots = new Set();
        let primarySets = 0;
        for (const session of template.sessions) {
          assert.ok(session.exercises.length >= 5, `${id} ${session.name}`);
          const primaries = session.exercises.filter((exercise) => exercise.role === 'primary');
          assert.equal(primaries.length, 1, `${id} ${session.name}`);
          for (const exercise of session.exercises) {
            assert.ok(!slots.has(exercise.slotId), `duplicate slot ${exercise.slotId}`);
            slots.add(exercise.slotId);
            assert.notEqual(exercise.trackingMode, 'load_and_reps', `${id}: ${exercise.exerciseName} asks for a weight`);
            if (exercise.trackingMode !== 'hold') {
              assert.equal(exercise.repsMin, exercise.repsMax, `${id}: ${exercise.exerciseName}`);
            }
            if (exercise.role === 'primary') {
              primarySets += exercise.sets;
              // Strength is low reps on the hardest variation, with the rest it takes.
              assert.ok(exercise.trackingMode === 'hold' || exercise.repsMax <= 6, `${id}: ${exercise.exerciseName} ${exercise.repsMax}`);
              assert.ok(exercise.sets >= 4, `${id}: ${exercise.exerciseName}`);
              assert.ok(exercise.restSecondsMin >= 90, `${id}: ${exercise.exerciseName}`);
            }
          }
        }
        assert.ok(primarySets >= 12, `${id} lead-lift sets ${primarySets}`);
      }

      // Nothing to buy: with no gear at all the three-day week runs as written,
      // and the five-day one only turns its two pull-ups into rows.
      const noGear = (id) => getWorkoutTemplateById(id).sessions.map((session) => applyEquipmentToExercises(session.exercises, []));
      for (const adjusted of noGear('tpl_home_bodyweight_strength_3_day_v1')) {
        assert.deepEqual(adjusted.removed, []);
        assert.deepEqual(adjusted.swapped, []);
      }
      const swaps = noGear('tpl_home_calisthenics_strength_5_day_v1').flatMap((adjusted) => {
        assert.deepEqual(adjusted.removed, []);
        return adjusted.swapped;
      });
      assert.deepEqual(swaps, [
        { from: 'Pull-Up', to: 'Inverted Row' },
        { from: 'Pull-Up', to: 'Inverted Row' },
      ]);
      // A bar keeps the pull-up.
      for (const session of getWorkoutTemplateById('tpl_home_calisthenics_strength_5_day_v1').sessions) {
        const adjusted = applyEquipmentToExercises(session.exercises, ['Pull-up bar']);
        assert.deepEqual(adjusted.removed, []);
        assert.deepEqual(adjusted.swapped, []);
      }
    },
  },
];
