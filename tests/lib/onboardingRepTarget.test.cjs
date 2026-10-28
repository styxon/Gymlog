const assert = require('node:assert/strict');

const { buildSavedOnboardingPlan } = require('../../src/app/onboardingHandoff');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../src/lib/firstRunSetup');
const { buildComposedFallbackExercise } = require('../../src/lib/programDayComposer');
const { RECOMMENDATION_PROGRAMS } = require('../../src/lib/recommendationCatalog');
const { collapseRepRange } = require('../../src/lib/singleRepTarget');

/**
 * The programme onboarding saves has to read the same after a relaunch.
 *
 * Saved programmes prescribe one rep number (user 2026-08-26), and
 * `normalizeDatabase` enforces it on every load with `collapseRepRange`. The
 * composer's two invented doses — the focus accessory and the suggested day's
 * lift — still wrote "10–15". So onboarding previewed "2 × 10–15", the next
 * launch read "2 × 15", and the stored bytes caught up at the first full
 * save, which is finishing a workout: every one of those rows, trained that
 * day or not, went from 10/15 to 15/15 in `@vinha/database/v1` (emulator,
 * 2026-09-13). It looked like progression rewriting the programme. It was the
 * loader applying a rule the composer had not.
 *
 * The oracle is the loader's own function: whatever onboarding saves must be a
 * fixed point of it, so a save can never change what the reader was shown.
 */

function assertReadsTheSameAfterLoad(exercise, label) {
  assert.deepEqual(
    { repMin: exercise.repMin, repMax: exercise.repMax },
    collapseRepRange({ name: exercise.name, repMin: exercise.repMin, repMax: exercise.repMax }),
    `${label}: ${exercise.name} is saved as ${exercise.repMin}-${exercise.repMax}, which the next load rewrites`,
  );
}

// A composed focus accessory's id is `${sessionId}_focus_${n}`, a suggested
// day's lift `${sessionId}_exercise_${n}` — the two doses the composer invents.
const isFocusRow = (exercise) => exercise.id.includes('_focus_');
const isSuggestedRow = (exercise) => exercise.id.includes('_exercise_');

module.exports = [
  {
    name: 'onboardingRepTarget: the chest/back/shoulder accessories from the emulator run save as one rep number',
    run() {
      // The plan from the report: the 4-day upper/lower block with chest,
      // back and shoulders as focus areas ("Rintamassa · Advanced").
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        goal: 'muscle',
        goals: ['muscle'],
        level: 'advanced',
        daysPerWeek: 4,
        focusAreas: ['chest', 'back', 'shoulders'],
      };
      const { draft } = buildSavedOnboardingPlan(selection, 'tpl_4_day_upper_lower_v1', 'en');
      const exercises = draft.sessions.flatMap((session) => session.exercises);
      const focusRows = exercises.filter(isFocusRow);

      const reported = [
        'Incline Dumbbell Press',
        'Dumbbell Flyes',
        'Close-Grip Front Lat Pulldown',
        'Bent Over Two-Dumbbell Row',
        'Arnold Dumbbell Press',
      ];
      for (const name of reported) {
        const found = focusRows.filter((exercise) => exercise.name === name);
        // Not an empty loop: the plan has to contain the lifts it is about.
        assert.ok(found.length > 0, `${name} is not a focus accessory in the plan — the fixture no longer matches the report`);
        for (const exercise of found) {
          // The ceiling, because the loader keeps the ceiling: an install that
          // already relaunched reads 15, and nothing it shows moves.
          assert.deepEqual({ repMin: exercise.repMin, repMax: exercise.repMax }, { repMin: 15, repMax: 15 }, name);
        }
      }
      for (const exercise of exercises) {
        assertReadsTheSameAfterLoad(exercise, 'upper/lower + chest/back/shoulders');
      }
    },
  },
  {
    name: "onboardingRepTarget: a suggested day's lift prescribes one rep number, and a hold keeps its seconds",
    run() {
      const lift = buildComposedFallbackExercise('Romanian Deadlift', 'onboarding_tpl_x_5', 1);
      assert.deepEqual({ repsMin: lift.repsMin, repsMax: lift.repsMax }, { repsMin: 15, repsMax: 15 });

      // A plank's 20-40 is seconds — a dose bracket the loader leaves alone.
      const plank = buildComposedFallbackExercise('Plank', 'onboarding_tpl_x_5', 0);
      assert.equal(plank.trackingMode, 'hold');
      assert.deepEqual({ repsMin: plank.repsMin, repsMax: plank.repsMax }, { repsMin: 20, repsMax: 40 });
    },
  },
  {
    name: 'onboardingRepTarget: sweep — every recommendable plan saves rows the next load leaves as they are',
    run() {
      // Fewest days trims the template, most days pads it with suggested days.
      const DAYS = [2, 6];
      const ENVIRONMENTS = [
        ['full_gym', 'gym'],
        ['bodyweight_only', 'home'],
      ];
      // Every focus area appears in one of these sets.
      const FOCUS_SETS = [
        ['chest', 'back', 'shoulders'],
        ['arms', 'core', 'calves', 'bodyweight'],
        ['glutes', 'quads', 'hamstrings', 'legs', 'mobility', 'conditioning'],
      ];
      // Equipment and caution swaps run after the doses are written and keep
      // them — a swap into a hold, or out of one, must not leave a row the
      // loader would rewrite either.
      const CAUTIONS = [
        [],
        ['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'hips', 'knees', 'ankles'].map((area) => ({
          area,
          level: 'careful',
          refinements: [],
        })),
      ];
      // Caution swaps are in the sweep with no exceptions. Deep Squat Hold used
      // to swap into a squat that kept its 60-90 s — 90 squats after the next
      // load — and was pinned here as a known row until #100 made a careful
      // knee take the supported hold instead. That swap is now the proof the
      // careful half of the sweep composed anything swapped at all.

      const failures = [];
      let focusRows = 0;
      let suggestedRows = 0;
      let cautionSwapRows = 0;
      for (const { programId } of RECOMMENDATION_PROGRAMS) {
        for (const daysPerWeek of DAYS) {
          for (const [trainingEnvironment, equipment] of ENVIRONMENTS) {
            for (const focusAreas of FOCUS_SETS) {
              for (const cautionFlags of CAUTIONS) {
                const selection = {
                  ...DEFAULT_FIRST_RUN_SELECTION,
                  daysPerWeek,
                  trainingEnvironment,
                  equipment,
                  focusAreas,
                  cautionFlags,
                };
                const label = `${programId}/${daysPerWeek}d/${trainingEnvironment}/${focusAreas.join('+')}/careful:${cautionFlags.length}`;
                const { draft } = buildSavedOnboardingPlan(selection, programId, 'en');
                for (const exercise of draft.sessions.flatMap((session) => session.exercises)) {
                  focusRows += isFocusRow(exercise) ? 1 : 0;
                  suggestedRows += isSuggestedRow(exercise) ? 1 : 0;
                  cautionSwapRows += cautionFlags.length > 0 && exercise.name === 'Supported Deep Squat Hold' ? 1 : 0;
                  const loaded = collapseRepRange({
                    name: exercise.name,
                    repMin: exercise.repMin,
                    repMax: exercise.repMax,
                  });
                  if (loaded.repMin === exercise.repMin && loaded.repMax === exercise.repMax) {
                    continue;
                  }
                  failures.push(
                    `${label}: ${exercise.name} is saved as ${exercise.repMin}-${exercise.repMax}, which the next load rewrites`,
                  );
                }
              }
            }
          }
        }
      }

      // Both invented doses have to be in the sweep, or it proves nothing.
      assert.ok(focusRows > 0, 'the sweep composed no focus accessories');
      assert.ok(suggestedRows > 0, 'the sweep composed no suggested-day lifts');
      assert.ok(cautionSwapRows > 0, 'the careful selections swapped nothing, so caution swaps are not in the sweep');
      assert.deepEqual(failures.slice(0, 10), [], `${failures.length} saved rows change on the next load`);
    },
  },
];
