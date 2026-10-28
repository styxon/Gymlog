const assert = require('node:assert/strict');

const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require('../../src/lib/firstRunSetup');

// The sweep drives the recommendation with no tailoring preferences. src used
// to export a wrapper that did exactly this and had no other caller.
const resolveFirstRunRecommendation = (selection) => resolveFirstRunRecommendationWithTailoring(selection, null);
const { composeProgramWeekForSelection } = require('../../src/lib/programDayComposer');
const { getWorkoutTemplateById } = require('../../src/features/workout/workoutCatalog');
const { isCatalogExercise, resolveCatalogBodyPart } = require('../../src/lib/catalogExercisePools');

/**
 * Every onboarding answer combination, put through recommendation and week
 * composition, checked for the things that make a plan unusable rather than
 * merely imperfect.
 *
 * This exists because a sweep like it found that 39% of combinations produced
 * a day whose exercises were category words — "Arms", "Core", "Easy cardio" —
 * with a weight field attached and nothing in any catalog to show for them.
 */
const GOALS = ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];
const ENVIRONMENTS = ['full_gym', 'home_gym', 'minimal_equipment', 'bodyweight_only', 'running_hybrid'];
const EQUIPMENT_BY_ENV = {
  full_gym: 'gym',
  home_gym: 'home',
  minimal_equipment: 'minimal',
  bodyweight_only: 'home',
  running_hybrid: 'minimal',
};

function everyCombination(check) {
  const failures = [];
  for (const goal of GOALS) {
    for (const level of LEVELS) {
      for (const daysPerWeek of DAYS) {
        for (const trainingEnvironment of ENVIRONMENTS) {
          const selection = {
            ...DEFAULT_FIRST_RUN_SELECTION,
            goal,
            goals: [goal],
            level,
            daysPerWeek,
            trainingEnvironment,
            equipment: EQUIPMENT_BY_ENV[trainingEnvironment],
          };
          const label = `${goal}/${level}/${daysPerWeek}d/${trainingEnvironment}`;
          const recommendation = resolveFirstRunRecommendation(selection);
          const week = recommendation?.featuredProgramId
            ? composeProgramWeekForSelection(selection, recommendation.featuredProgramId)
            : null;
          check({ selection, recommendation, week, label, report: (why) => failures.push(`${label}: ${why}`) });
        }
      }
    }
  }
  return failures;
}

module.exports = [
  {
    name: 'sweep: every answer combination gets a real programme and a composable week',
    run() {
      const failures = everyCombination(({ recommendation, week, selection, report }) => {
        if (!recommendation?.featuredProgramId) {
          report('no programme recommended');
          return;
        }
        if (!getWorkoutTemplateById(recommendation.featuredProgramId)) {
          report(`recommended a programme that does not exist: ${recommendation.featuredProgramId}`);
          return;
        }
        if (recommendation.secondaryProgramId === recommendation.featuredProgramId) {
          report('the same programme was offered twice');
        }
        if (!week) {
          report('no week could be composed');
          return;
        }
        if (week.days !== selection.daysPerWeek) {
          report(`asked for ${selection.daysPerWeek} days, composed ${week.days}`);
        }
        if (week.sessions.length !== week.days) {
          report(`day count ${week.days} disagrees with ${week.sessions.length} sessions`);
        }
      });

      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'sweep: no session is empty, unnamed, or made only of warmups',
    run() {
      const failures = everyCombination(({ week, report }) => {
        for (const session of week?.sessions ?? []) {
          if (!session.name?.trim()) {
            report(`session ${session.orderIndex} has no name`);
          }
          if (session.exercises.length === 0) {
            report(`"${session.name}" is empty`);
            continue;
          }
          const working = session.exercises.filter(
            (exercise) => exercise.role === 'primary' || exercise.role === 'secondary',
          );
          if (working.length === 0) {
            report(`"${session.name}" has no primary or secondary work`);
          }
          const names = new Set();
          for (const exercise of session.exercises) {
            if (names.has(exercise.exerciseName)) {
              report(`"${session.name}" repeats ${exercise.exerciseName}`);
            }
            names.add(exercise.exerciseName);
            if (!(exercise.sets >= 1) || !(exercise.repsMin >= 1)) {
              report(`${exercise.exerciseName} has no sets or reps`);
            }
          }
        }
      });

      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'sweep: no generated exercise is a bare category word',
    run() {
      const { getDrillLibraryName } = require('../../src/lib/drillMedia');

      // The app resolves an exercise name three ways: the catalog outright, the
      // media matcher's aliases, or the drill table that lets warmup and
      // cooldown copy borrow a photo. A name none of them reach arrives as a
      // bare word with no demo and nothing to swap.
      //
      // Scope is the exercises the composer *generates* — supplemental days and
      // focus emphasis. Ready-template copy still carries hand-authored names
      // ("Cossack Squat", "Thread the Needle") that resolve to nothing; that is
      // a content gap in the templates, tracked separately, not something this
      // sweep can fix by failing.
      const failures = everyCombination(({ week, report }) => {
        for (const session of week?.sessions ?? []) {
          const generated =
            session.source === 'suggested'
              ? session.exercises
              : session.exercises.filter((exercise) => exercise.slotId?.startsWith('focus_accessory'));

          for (const exercise of generated) {
            const resolved =
              isCatalogExercise(exercise.exerciseName) ||
              resolveCatalogBodyPart(exercise.exerciseName) !== null ||
              getDrillLibraryName(exercise.exerciseName) !== null;
            if (!resolved) {
              report(`"${session.name}" contains ${exercise.exerciseName}, which resolves to nothing`);
            }
          }
        }
      });

      assert.deepEqual(failures, []);
    },
  },
  {
    name: 'sweep: a user with no equipment is never asked for a weight',
    run() {
      const failures = [];
      for (const goal of GOALS) {
        for (const level of LEVELS) {
          for (const daysPerWeek of DAYS) {
            const selection = {
              ...DEFAULT_FIRST_RUN_SELECTION,
              goal,
              goals: [goal],
              level,
              daysPerWeek,
              trainingEnvironment: 'bodyweight_only',
              equipment: 'home',
            };
            const recommendation = resolveFirstRunRecommendation(selection);
            const week = composeProgramWeekForSelection(selection, recommendation.featuredProgramId);
            for (const session of week?.sessions ?? []) {
              for (const exercise of session.exercises) {
                if (exercise.trackingMode === 'load_and_reps') {
                  failures.push(
                    `${goal}/${level}/${daysPerWeek}d: "${session.name}" asks for a load on ${exercise.exerciseName}`,
                  );
                }
              }
            }
          }
        }
      }

      assert.deepEqual(failures, []);
    },
  },
];
