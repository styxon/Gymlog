const assert = require('node:assert/strict');

const {
  WORKOUT_SUBSTITUTION_GROUPS,
  WORKOUT_TEMPLATES_V1,
  getWorkoutTemplateById,
} = require('../../src/features/workout/workoutCatalog');
const { getReadyProgramContent } = require('../../src/lib/readyProgramContent');

module.exports = [
  {
    name: 'ready workout catalog now covers multiple goals with a broader library',
    run() {
      assert.ok(WORKOUT_TEMPLATES_V1.length >= 10);

      const strengthTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.goalType === 'strength');
      const hypertrophyTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.goalType === 'hypertrophy');
      const generalTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.goalType === 'general');
      assert.ok(strengthTemplates.length >= 3);
      assert.ok(hypertrophyTemplates.length >= 4);
      assert.ok(generalTemplates.length >= 3);

      const minimal = getWorkoutTemplateById('tpl_2_day_minimal_full_body_v1');
      assert.equal(minimal.daysPerWeek, 2);
      assert.equal(minimal.sessions.length, 2);
      assert.equal(minimal.sessions[0].name, 'Day 1: Full Body');

      const muscleBuilder = getWorkoutTemplateById('tpl_4_day_muscle_builder_v1');
      assert.equal(muscleBuilder.sessions.length, 4);
      assert.equal(muscleBuilder.level, 'beginner');
    },
  },
  {
    name: 'no session carries a warmup or cooldown placeholder as a logged exercise',
    run() {
      const gainerTemplates = WORKOUT_TEMPLATES_V1.filter((template) => template.id.startsWith('tpl_gainer_'));
      assert.equal(gainerTemplates.length, 20);

      // The xlsx import wrote "Dynamic Warm-Up" as the first row and "Cooldown
      // Flow" as the last row of all 81 gainer sessions. They were exercises
      // in the data and nowhere else: no library entry, so no photo, no demo
      // and no swap pool — and the app generates its own warmup and cooldown
      // blocks anyway (homeSessionHero), so they were a second, inert copy of
      // a block the user already gets. What they did do was show up as the
      // first thing in the workout list.
      const placeholder = /^(dynamic warm-up|cooldown flow|joint prep flow|mobility warm-up|breathing reset|recovery stretch)$/i;
      const offenders = [];

      WORKOUT_TEMPLATES_V1.forEach((template) => {
        template.sessions.forEach((session) => {
          assert.ok(session.exercises.length >= 3, `${template.id} ${session.id} has too few exercises`);
          session.exercises.forEach((exercise) => {
            if (placeholder.test(exercise.exerciseName.trim())) {
              offenders.push(`${template.id} ${session.id}: ${exercise.exerciseName}`);
            }
          });
        });
      });

      assert.deepEqual(offenders, []);
    },
  },
  {
    name: 'ready programs use goal-first family names instead of structural day-count names',
    run() {
      assert.equal(getWorkoutTemplateById('tpl_2_day_minimal_full_body_v1').name, 'HOME Starter');
      assert.equal(getWorkoutTemplateById('tpl_2_day_beginner_strength_v1').name, 'STRONG Starter');
      assert.equal(getWorkoutTemplateById('tpl_3_day_strength_base_v1').name, 'STRONG');
      assert.equal(getWorkoutTemplateById('tpl_3_day_push_pull_legs_v1').name, 'HUGE');
      assert.equal(getWorkoutTemplateById('tpl_3_day_full_body_v1').name, 'FIT');
      assert.equal(getWorkoutTemplateById('tpl_gainer_beginner_bro_split_v1').name, 'Bro Split');
      // No template name may contain a structural day-count prefix anymore.
      WORKOUT_TEMPLATES_V1.forEach((template) => {
        assert.equal(/\d-Day /.test(template.name), false, `${template.id} still has a day-count name: ${template.name}`);
      });
      // Authored A/B session names are gone from the rebranded catalog (gainer set already uses day labels).
      WORKOUT_TEMPLATES_V1.filter((template) => !template.id.startsWith('tpl_gainer_')).forEach((template) => {
        template.sessions.forEach((session) => {
          assert.equal(/\s[AB]$/.test(session.name), false, `${template.id} ${session.id} still has an authored A/B name: ${session.name}`);
        });
      });
    },
  },
  {
    name: 'ready workout content exists for every ready template',
    run() {
      WORKOUT_TEMPLATES_V1.forEach((template) => {
        const content = getReadyProgramContent(template.id);
        assert.ok(content);
        assert.ok(content.summary.length > 20);
        assert.ok(content.audience.length > 20);
      });
    },
  },
  {
    name: 'low-equipment starter avoids full-gym-only exercises',
    run() {
      const minimal = getWorkoutTemplateById('tpl_2_day_minimal_full_body_v1');
      const fullGymOnly = new Set([
        'Back Squat',
        'Bench Press',
        'Chest-Supported Row',
        'Cable Crunch',
        'Leg Press',
        'Overhead Press',
        'Lat Pulldown',
        'Leg Curl',
      ]);
      const exerciseNames = minimal.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.exerciseName),
      );

      assert.equal(exerciseNames.some((exerciseName) => fullGymOnly.has(exerciseName)), false);
      assert.ok(exerciseNames.includes('Bodyweight Squat'));
      assert.ok(exerciseNames.includes('Incline Push-Up'));
      assert.ok(exerciseNames.includes('Inverted Row'));
      // What matters is that nothing asks for a weight. A plank is now 'hold'
      // rather than 'bodyweight' — still unloaded, and still logged without a
      // kilogram field. The run blocks that close each day since 2026-10-12
      // are minutes ('duration_minutes'), unloaded too.
      assert.equal(
        minimal.sessions.every((session) =>
          session.exercises.every((exercise) => ['bodyweight', 'hold', 'duration_minutes'].includes(exercise.trackingMode)),
        ),
        true,
      );
    },
  },
  {
    name: 'ready workout substitutions cover every template exercise',
    run() {
      const groupsById = new Map(WORKOUT_SUBSTITUTION_GROUPS.map((group) => [group.id, group]));

      WORKOUT_TEMPLATES_V1.forEach((template) => {
        template.sessions.forEach((session) => {
          session.exercises.forEach((exercise) => {
            const group = groupsById.get(exercise.substitutionGroup);

            assert.ok(group, `${template.id} ${session.id} ${exercise.exerciseName}`);
            assert.ok(
              group.allowedExerciseNames.includes(exercise.exerciseName),
              `${exercise.exerciseName} missing from ${exercise.substitutionGroup}`,
            );
          });
        });
      });
    },
  },
  {
    name: 'ready workout substitution groups provide realistic alternatives',
    run() {
      WORKOUT_SUBSTITUTION_GROUPS.forEach((group) => {
        assert.equal(group.allowedExerciseNames.length >= 2, true, group.id);
        assert.equal(new Set(group.allowedExerciseNames).size, group.allowedExerciseNames.length, group.id);
      });
    },
  },
  {
    name: 'bodyweight substitution groups avoid full-gym-only alternatives',
    run() {
      const fullGymOnly = new Set([
        'Back Squat',
        'Bench Press',
        'Barbell Row',
        'Cable Crunch',
        'Chest-Supported Row',
        'Front Squat',
        'Hack Squat',
        'Lat Pulldown',
        'Leg Curl',
        'Leg Press',
        'Machine Chest Press',
        'Machine Shoulder Press',
        'Seated Cable Row',
        'Trap Bar Deadlift',
        'Triceps Pushdown',
        'Hip Thrust',
      ]);
      const bodyweightGroups = WORKOUT_SUBSTITUTION_GROUPS.filter((group) => group.id.startsWith('bodyweight_'));

      bodyweightGroups.forEach((group) => {
        assert.equal(
          group.allowedExerciseNames.some((exerciseName) => fullGymOnly.has(exerciseName)),
          false,
          group.id,
        );
      });
    },
  },
  {
    name: 'a band accessory is logged with no weight dial',
    run() {
      // The Gainer mobility flow's shoulder day hard-coded this one exercise
      // as "load_and_reps" while every neighbouring bodyweight/hold accessory
      // on the same day was tagged correctly — a copy-paste slip that gave a
      // resistance-band exercise a kg field to fill in (#bugs, 2026-09-26).
      const offenders = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const item of session.exercises) {
            if (item.exerciseName === 'Band Pull-Apart' && item.trackingMode !== 'bodyweight') {
              offenders.push(`${template.id}/${session.id}/${item.id}: ${item.trackingMode}`);
            }
          }
        }
      }
      assert.deepEqual(offenders, []);
    },
  },
];
