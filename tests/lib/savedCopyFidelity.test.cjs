const assert = require('node:assert/strict');

/**
 * What onboarding composes and what it saves have to read the same once the
 * saved copy is adapted back into a runtime template (sweep, 2026-10-04):
 *  - a stretch written with no rest was given the reader's default between sets,
 *    so the card said 30 min and Home said 35;
 *  - push-ups, bird dogs and skater jumps came back from the library lookup as
 *    weighted lifts, because the library spells them its own way.
 */

const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { buildSavedOnboardingPlan } = require('../../.test-dist/app/onboardingHandoff.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require('../../.test-dist/features/workout/customWorkoutAdapter.js');
const { savedPrescription, savedRestSeconds } = require('../../.test-dist/lib/singleRepTarget.js');
const { estimateSessionMinutes } = require('../../.test-dist/lib/sessionDuration.js');
const { classifySessionFocus, getDefaultWarmup, getDefaultCooldown } = require('../../.test-dist/lib/homeSessionHero.js');
const { estimateRoutineBlockSeconds } = require('../../.test-dist/lib/guidedPlayer.js');
const { resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { isTimedTrackingMode } = require('../../.test-dist/features/workout/workoutTypes.js');
const { normalizeDatabase } = require('../../.test-dist/storage/database.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { EXTRA_EXERCISE_LIBRARY } = require('../../.test-dist/data/extraExerciseLibrary.js');

// The writer's rule for a row's rest (AppProvider calls savedRestSeconds). The
// fallback is the rule it replaced, so a tree without the helper fails on the
// behaviour rather than on the missing name.
const keepRest = typeof savedRestSeconds === 'function' ? savedRestSeconds : (value) => (value && value > 0 ? value : null);

const library = [...GENERATED_EXERCISE_LIBRARY, ...EXTRA_EXERCISE_LIBRARY];

const ENVIRONMENTS = [
  {
    equipment: 'gym',
    trainingEnvironment: 'full_gym',
    equipmentItems: ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'],
  },
  { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
];

function selectionFor(environment, daysPerWeek) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    goal: 'general',
    level: 'advanced',
    daysPerWeek,
    availableDays: [],
    scheduleMode: 'app_managed',
    ...environment,
  };
}

/** The saved draft as the template writer stores it, then adapted as Home reads it. */
function saveAndAdapt(selection, programId) {
  const saved = buildSavedOnboardingPlan(selection, programId, 'en');
  const sessions = saved.draft.sessions.map((session, sessionIndex) => ({
    id: session.id,
    name: session.name,
    orderIndex: sessionIndex,
    exercises: session.exercises.map((exercise, exerciseIndex) => {
      // What AppProvider's writer does to each row.
      const prescription = savedPrescription({
        name: exercise.name,
        repMin: Math.max(1, exercise.repMin),
        repMax: Math.max(Math.max(1, exercise.repMin), exercise.repMax),
        restSeconds: keepRest(exercise.restSeconds),
      });
      return {
        ...exercise,
        repMin: prescription.repMin,
        repMax: prescription.repMax,
        restSeconds: prescription.restSeconds,
        trackingMode: exercise.trackingMode ?? null,
        orderIndex: exerciseIndex,
      };
    }),
  }));
  const adapted = adaptLegacyWorkoutTemplateToRuntimeTemplate({ id: 'x', name: 'x' }, sessions, library, 90);
  return { saved, adapted };
}

function homeMinutes(adapted, selection) {
  const available = resolveAvailableEquipment(selection);
  const minutes = adapted.sessions.map((session) => {
    const focus = classifySessionFocus(session.exercises.map((exercise) => exercise.exerciseName));
    return estimateSessionMinutes({
      exercises: session.exercises.map((exercise) => ({
        name: exercise.exerciseName,
        sets: exercise.sets,
        reps: exercise.repsMax,
        timed: isTimedTrackingMode(exercise.trackingMode),
        restSeconds: exercise.restSecondsMin,
        supersetGroup: exercise.supersetGroup ?? null,
      })),
      warmupSeconds: estimateRoutineBlockSeconds(getDefaultWarmup(focus, 'en', available, null)),
      cooldownSeconds: estimateRoutineBlockSeconds(getDefaultCooldown(focus, 'en', available, null)),
    });
  });
  return Math.max(5, Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length / 5) * 5);
}

module.exports = [
  {
    name: 'saved copy: a rest of none survives the save, so the card and Home quote the same minutes',
    run() {
      const mismatches = [];
      let mobilityChecked = 0;
      for (const environment of ENVIRONMENTS) {
        const selection = selectionFor(environment, 3);
        const week = composeProgramWeekForSelection(selection, 'tpl_gainer_mobility_flow_v1');
        assert.ok(week, 'mobility flow composes');
        const { adapted } = saveAndAdapt(selection, 'tpl_gainer_mobility_flow_v1');
        // The stretch rows keep their zero; only an unset rest takes the default.
        const zeroRest = week.sessions.flatMap((session) => session.exercises).filter((exercise) => exercise.restSecondsMax === 0);
        assert.ok(zeroRest.length > 0, 'mobility flow has rows written with no rest');
        for (const [sessionIndex, session] of adapted.sessions.entries()) {
          session.exercises.forEach((exercise, exerciseIndex) => {
            const composed = week.sessions[sessionIndex].exercises[exerciseIndex];
            if (composed.restSecondsMax === 0) {
              assert.equal(exercise.restSecondsMin, 0, exercise.exerciseName);
            }
          });
        }
        const home = homeMinutes(adapted, selection);
        if (home !== week.savedCopySessionMinutes) {
          mismatches.push(`${environment.trainingEnvironment}: card ${week.savedCopySessionMinutes} home ${home}`);
        }
        mobilityChecked += 1;
      }
      assert.equal(mobilityChecked, ENVIRONMENTS.length);
      assert.deepEqual(mismatches, []);
    },
  },
  {
    name: 'saved copy: an unset rest still takes the reader\'s default, and a stored 0 is kept on load',
    run() {
      const base = {
        id: 'e1',
        workoutTemplateId: 't',
        workoutTemplateSessionId: 's',
        name: 'Bench Press',
        targetSets: 3,
        repMin: 8,
        repMax: 8,
        trackedDefault: true,
        orderIndex: 0,
      };
      const adapt = (restSeconds) =>
        adaptLegacyWorkoutTemplateToRuntimeTemplate(
          { id: 't', name: 't' },
          [{ id: 's', name: 's', orderIndex: 0, exercises: [{ ...base, restSeconds }] }],
          library,
          90,
        ).sessions[0].exercises[0];
      assert.equal(savedRestSeconds(0), 0);
      assert.equal(savedRestSeconds(45), 45);
      assert.equal(savedRestSeconds(null), null);
      assert.equal(savedRestSeconds(undefined), null);
      assert.equal(savedRestSeconds(-5), null);
      assert.equal(savedRestSeconds(Number.NaN), null);
      assert.equal(adapt(null).restSecondsMin, 90);
      assert.equal(adapt(120).restSecondsMax, 120);
      assert.equal(adapt(0).restSecondsMin, 0);
      const loaded = normalizeDatabase({
        exerciseTemplates: [{ ...base, restSeconds: 0, trackingMode: 'bodyweight' }],
      }).exerciseTemplates[0];
      assert.equal(loaded.restSeconds, 0);
      assert.equal(loaded.trackingMode, 'bodyweight');
    },
  },
  {
    name: 'saved copy: every row of the home programmes keeps its tracking mode through save and adapt',
    run() {
      const cases = [
        ['tpl_home_dumbbell_upper_lower_v1', ENVIRONMENTS[2], 4],
        ['tpl_home_dumbbell_ppl_v1', ENVIRONMENTS[2], 6],
        ['tpl_home_dumbbell_strength_v1', ENVIRONMENTS[2], 3],
        ['tpl_home_dumbbell_strength_split_v1', ENVIRONMENTS[2], 5],
        ['tpl_home_bodyweight_upper_lower_v1', ENVIRONMENTS[1], 4],
        ['tpl_home_athletic_5_day_v1', ENVIRONMENTS[1], 5],
        ['tpl_home_bodyweight_strength_3_day_v1', ENVIRONMENTS[1], 3],
        ['tpl_home_calisthenics_strength_5_day_v1', ENVIRONMENTS[1], 4],
        ['tpl_gainer_at_home_beginner_v1', ENVIRONMENTS[1], 3],
      ];
      let rows = 0;
      let bodyweightRows = 0;
      for (const [programId, environment, days] of cases) {
        const selection = selectionFor(environment, days);
        const { saved, adapted } = saveAndAdapt(selection, programId);
        assert.equal(adapted.sessions.length, saved.runtimeTemplate.sessions.length, programId);
        adapted.sessions.forEach((session, sessionIndex) => {
          session.exercises.forEach((exercise, exerciseIndex) => {
            const composed = saved.runtimeTemplate.sessions[sessionIndex].exercises[exerciseIndex];
            assert.equal(exercise.exerciseName, composed.exerciseName);
            assert.equal(exercise.trackingMode, composed.trackingMode, `${programId}: ${exercise.exerciseName}`);
            rows += 1;
            if (composed.trackingMode === 'bodyweight') bodyweightRows += 1;
          });
        });
      }
      assert.ok(rows > 60, `only ${rows} rows`);
      assert.ok(bodyweightRows > 20, 'the test must cover rows the library lookup got wrong');
    },
  },
  {
    name: 'saved copy: a stored tracking mode that is not one of the four is dropped on load',
    run() {
      const row = {
        id: 'e1',
        workoutTemplateId: 't',
        workoutTemplateSessionId: 's',
        name: 'Push-Up',
        targetSets: 3,
        repMin: 10,
        repMax: 10,
        restSeconds: 60,
        trackedDefault: true,
        orderIndex: 0,
      };
      const modeOf = (trackingMode) => normalizeDatabase({ exerciseTemplates: [{ ...row, trackingMode }] }).exerciseTemplates[0].trackingMode;
      assert.equal(modeOf('hold'), 'hold');
      assert.equal(modeOf('reps_first'), 'reps_first');
      assert.equal(modeOf('load_and_reps'), 'load_and_reps');
      assert.equal(modeOf('banana'), null);
      assert.equal(modeOf(undefined), null);
      assert.equal(modeOf(7), null);
    },
  },
];
