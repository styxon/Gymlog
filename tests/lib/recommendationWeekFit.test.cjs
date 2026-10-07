const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const {
  DEFAULT_FIRST_RUN_SELECTION,
  buildFirstRunRecommendationReasons,
  resolveFirstRunRecommendationWithTailoring,
} = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = require(dist + 'lib/programDayComposer.js');
const { exerciseHitsCautionArea } = require(dist + 'lib/cautionAreaMatching.js');
const { classifySessionFocus } = require(dist + 'lib/homeSessionHero.js');
const { isMinutesExerciseName } = require(dist + 'lib/minutesExercises.js');
const { exerciseNameLabel } = require(dist + 'lib/exerciseNameLabel.js');
const { getExerciseInstructions } = require(dist + 'lib/exerciseInstructions.js');
const { localizeSessionName } = require(dist + 'lib/sessionNameLabel.js');
const { resolveAvailableEquipment } = require(dist + 'lib/equipmentExerciseFilter.js');
const { readyTemplateCardMinutes } = require(dist + 'lib/programmeMinutes.js');
const {
  programmeCardMinutes,
  readyProgramSessionMinutes,
  resolveReaderComposedWeek,
} = require(dist + 'lib/programDetails.js');
const { EXTRA_EXERCISE_LIBRARY } = require(dist + 'data/extraExerciseLibrary.js');
const { getWorkoutTemplateById } = require(dist + 'features/workout/workoutCatalog.js');

/**
 * What the recommender hands over has to survive being composed for the
 * reader's days and flags (bug hunt, 2026-10-07, #34, #35, #37).
 *
 * - #34: a two-day reader got Push and Pull of a three-day push/pull/legs, a
 *   muscle plan with no legs. Owner: a week that fits two days (full body or
 *   upper/lower) wins whenever the pool has one.
 * - #35: a runner who avoids their knees or ankles got RUN with every run
 *   taken out under "Running comes first". Owner: the runs are replaced, not
 *   removed — knees walk, ankles ride a bike when the gear has one and walk
 *   otherwise — and the reason says so. An arms block with the elbows avoided
 *   is not handed over as "trains your focus".
 * - #37: the Programs card costed the catalog week for gear alone while the
 *   programme page costed the reader's composed week.
 */

const RUN = 'tpl_3_day_run_mobility_v1';
const RUN_SESSION_IDS = ['run_mobility_easy', 'run_mobility_tempo'];
const STAND_INS = ['Brisk Walk Blocks', 'Incline Walk Blocks', 'Stationary Bike Blocks'];

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const GEARS = [
  { id: 'gym', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL },
  { id: 'gym-no-cardio', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: GYM_ALL.filter((item) => item !== 'Cardio machines') },
  { id: 'gym-dumbbells', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Dumbbells'] },
  { id: 'home-none', equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  { id: 'home-db', equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  { id: 'home-db-bar', equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells', 'Pull-up bar'] },
  { id: 'home-cardio', equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Cardio machines'] },
  { id: 'home-rack', equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench', 'Dumbbells'] },
];

function selection(overrides) {
  const { gear = GEARS[0], ...rest } = overrides;
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    equipment: gear.equipment,
    trainingEnvironment: gear.trainingEnvironment,
    equipmentItems: gear.equipmentItems,
    ...rest,
    goals: [rest.goal ?? DEFAULT_FIRST_RUN_SELECTION.goal],
  };
}

/** Which halves of the body a set of days lifts for, by each lift's movement. */
function halves(sessions) {
  const found = new Set();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const kind = classifySessionFocus([exercise.exerciseName]);
      if (kind === 'lower') {
        found.add('lower');
      } else if (kind !== 'general') {
        found.add('upper');
      }
    }
  }
  return found;
}

module.exports = [
  {
    name: 'week fit: a two-day lifter is handed a week with both halves of the body in it, not a split cut to two',
    run() {
      let checked = 0;
      for (const goal of ['muscle', 'strength']) {
        for (const level of ['beginner', 'advanced', 'pro']) {
          for (const gear of GEARS) {
            const setup = selection({ goal, level, daysPerWeek: 2, gear });
            const { featuredProgramId } = resolveFirstRunRecommendationWithTailoring(setup, null);
            const week = composeProgramWeekForSelection(setup, featuredProgramId);
            const trains = halves(getWorkoutTemplateById(featuredProgramId).sessions);
            const kept = halves(week.sessions.filter((session) => session.source === 'template'));
            for (const half of trains) {
              assert.ok(kept.has(half), `${goal}/${level}/${gear.id}: ${featuredProgramId} at two days keeps no ${half}-body day`);
            }
            checked += 1;
          }
        }
      }
      assert.equal(checked, 48);

      // The finding's own cases: push/pull/legs and Calisthenics Mastery no
      // longer win a two-day muscle week.
      for (const [gear, level] of [[GEARS[0], 'advanced'], [GEARS[0], 'pro'], [GEARS[5], 'pro']]) {
        const setup = selection({ goal: 'muscle', level, daysPerWeek: 2, gear });
        const { featuredProgramId } = resolveFirstRunRecommendationWithTailoring(setup, null);
        assert.ok(
          !['tpl_3_day_push_pull_legs_v1', 'tpl_gainer_calisthenics_mastery_v1'].includes(featuredProgramId),
          `${gear.id}/${level}: ${featuredProgramId}`,
        );
      }
      // A dumbbell owner's two days are the dumbbell upper/lower's Upper and
      // Lower, not a bodyweight week that leaves the dumbbells unused.
      for (const level of ['advanced', 'pro']) {
        const dumbbells = selection({ goal: 'muscle', level, daysPerWeek: 2, gear: GEARS[5] });
        assert.equal(resolveFirstRunRecommendationWithTailoring(dumbbells, null).featuredProgramId, 'tpl_home_dumbbell_upper_lower_v1', level);
      }
      // A specialisation block is two days of its area and one of the rest:
      // cut to two, one week of it holds no legs, so a two-day reader with a
      // focus gets a whole-body week and the focus emphasis on top.
      for (const focus of ['chest', 'arms', 'back']) {
        const setup = selection({ goal: 'muscle', level: 'advanced', daysPerWeek: 2, gear: GEARS[0], focusAreas: [focus] });
        const recommendation = resolveFirstRunRecommendationWithTailoring(setup, null);
        assert.ok(!recommendation.featuredProgramId.startsWith('tpl_focus_'), `${focus}: ${recommendation.featuredProgramId}`);
        assert.notEqual(recommendation.waterfall?.whyPrimary, 'wf.muscle_focus.primary', focus);
      }
      // Three days still get push/pull/legs: only a short week is steered.
      const three = selection({ goal: 'muscle', level: 'advanced', daysPerWeek: 3, gear: GEARS[0] });
      assert.equal(resolveFirstRunRecommendationWithTailoring(three, null).featuredProgramId, 'tpl_3_day_push_pull_legs_v1');
    },
  },
  {
    name: 'week fit: a runner who avoids their knees or ankles keeps the run minutes as walks or rides, under a reason that says so',
    run() {
      const template = getWorkoutTemplateById(RUN);
      let runWeeks = 0;
      const seen = new Set();
      for (const area of ['knees', 'ankles']) {
        for (const level of ['beginner', 'advanced', 'pro']) {
          for (const daysPerWeek of [3, 4, 5]) {
            for (const gear of GEARS) {
              const setup = selection({ goal: 'run_mobility', level, daysPerWeek, gear, cautionFlags: [{ area, level: 'avoid' }] });
              const recommendation = resolveFirstRunRecommendationWithTailoring(setup, null);
              if (recommendation.featuredProgramId !== RUN) {
                continue;
              }
              runWeeks += 1;
              const label = `${area}/${level}/${daysPerWeek}/${gear.id}`;
              const week = composeProgramWeekForSelection(setup, RUN);
              const ride = area === 'ankles' && gear.equipmentItems.includes('Cardio machines');
              RUN_SESSION_IDS.forEach((sessionId, index) => {
                const before = template.sessions.find((session) => session.id === sessionId);
                const after = week.sessions[index];
                assert.equal(after.name, before.name.replace('Run', ride ? 'Ride' : 'Walk'), label);
                const blocks = before.exercises.find((exercise) => exercise.trackingMode === 'duration_minutes');
                const standIn = after.exercises.find((exercise) => STAND_INS.includes(exercise.exerciseName));
                assert.ok(standIn, `${label}: ${after.name} lost its run instead of replacing it`);
                assert.equal(standIn.trackingMode, 'duration_minutes', label);
                assert.deepEqual(
                  [standIn.sets, standIn.repsMin, standIn.repsMax],
                  [blocks.sets, blocks.repsMin, blocks.repsMax],
                  `${label}: the same minutes`,
                );
                const expected = ride
                  ? 'Stationary Bike Blocks'
                  : area === 'knees' && sessionId === 'run_mobility_tempo'
                    ? 'Incline Walk Blocks'
                    : 'Brisk Walk Blocks';
                assert.equal(standIn.exerciseName, expected, label);
                seen.add(expected);
              });
              for (const session of week.sessions) {
                assert.doesNotMatch(session.name, /\bRun\b/, `${label}: ${session.name}`);
                for (const exercise of session.exercises) {
                  assert.ok(!exerciseHitsCautionArea(exercise.exerciseName, area), `${label}: ${exercise.exerciseName} loads the ${area}`);
                }
              }
              const why = recommendation.waterfall?.whyPrimary;
              if (why) {
                assert.equal(why, ride ? 'wf.run_mobility.ridePrimary' : 'wf.run_mobility.walkPrimary', label);
              }
              const lines = buildFirstRunRecommendationReasons(setup, {
                projectedDaysPerWeek: 3,
                mismatchNote: recommendation.mismatchNote,
                programId: RUN,
              }).join(' ');
              assert.doesNotMatch(lines, /Run work|run \+ mobility split/, `${label}: ${lines}`);
              assert.match(lines, ride ? /bike/i : /walk/i, `${label}: ${lines}`);
            }
          }
        }
      }
      assert.ok(runWeeks >= 20, `the sweep reached ${runWeeks} RUN weeks`);
      assert.deepEqual([...seen].sort(), [...STAND_INS].sort(), 'every stand-in is reached');

      // Without the flag the runs are runs, and the reason says so.
      const runner = selection({ goal: 'run_mobility', level: 'beginner', daysPerWeek: 3 });
      const plain = composeProgramWeekForSelection(runner, RUN);
      assert.equal(plain.sessions[0].exercises[0].exerciseName, 'Easy Run Blocks');
      assert.equal(resolveFirstRunRecommendationWithTailoring(runner, null).waterfall.whyPrimary, 'wf.run_mobility.primary');
      assert.match(buildFirstRunRecommendationReasons(runner, { projectedDaysPerWeek: 3, programId: RUN }).join(' '), /Run work/);
    },
  },
  {
    name: 'week fit: each run stand-in is a library row that plays as minutes, with steps and a name in Finnish',
    run() {
      for (const name of STAND_INS) {
        const row = EXTRA_EXERCISE_LIBRARY.find((item) => item.name === name);
        assert.ok(row, `${name} has a library row`);
        assert.ok(row.instructions.length >= 2, name);
        assert.ok(isMinutesExerciseName(name), `${name} is timed in minutes`);
        assert.notEqual(exerciseNameLabel('fi', name), name, `${name} has a Finnish name`);
        assert.notDeepEqual(getExerciseInstructions(name, row.instructions, 'fi'), row.instructions, `${name} has Finnish steps`);
      }
      for (const name of ['Day 1: Easy Walk', 'Day 2: Tempo Walk', 'Day 1: Easy Ride', 'Day 2: Tempo Ride', 'Easy Walk Add-On', 'Long Ride Add-On']) {
        assert.doesNotMatch(localizeSessionName(name, 'fi'), /Walk|Ride/, name);
      }
    },
  },
  {
    name: 'week fit: an arms block the elbow flag strips is not handed over as training the focus',
    run() {
      for (const level of ['advanced', 'pro']) {
        const base = { goal: 'muscle', level, daysPerWeek: 3, focusAreas: ['arms'] };
        // The control: without the flag the arms block is the pick.
        const free = resolveFirstRunRecommendationWithTailoring(selection(base), null);
        assert.equal(free.featuredProgramId, 'tpl_focus_arms_program_v1', level);
        const avoided = resolveFirstRunRecommendationWithTailoring(
          selection({ ...base, cautionFlags: [{ area: 'elbows', level: 'avoid' }] }),
          null,
        );
        assert.notEqual(avoided.featuredProgramId, 'tpl_focus_arms_program_v1', level);
        assert.notEqual(avoided.waterfall?.whyPrimary, 'wf.muscle_focus.primary', level);
      }
    },
  },
  {
    name: 'week fit: the Programs card quotes the minutes the programme page quotes, flags and focus included',
    run() {
      let held = 0;
      let differsFromGear = 0;
      for (const goal of ['muscle', 'strength', 'general_fitness']) {
        for (const level of ['beginner', 'advanced']) {
          for (const gear of [GEARS[0], GEARS[3], GEARS[4]]) {
            for (const extra of [
              { cautionFlags: [{ area: 'knees', level: 'avoid' }] },
              { cautionFlags: [{ area: 'shoulders', level: 'avoid' }] },
              { focusAreas: ['glutes'] },
              {},
            ]) {
              const setup = selection({ goal, level, daysPerWeek: 3, gear, ...extra });
              const label = `${goal}/${level}/${gear.id}/${JSON.stringify(extra)}`;
              const { featuredProgramId } = resolveFirstRunRecommendationWithTailoring(setup, null);
              const template = getWorkoutTemplateById(featuredProgramId);
              const options = { availableEquipment: resolveAvailableEquipment(setup), overrides: null };
              const composed = composeProgramWeekForSelection(setup, featuredProgramId);
              // Onboarding saved the composed week as the plan.
              const context = {
                recommendedProgramId: featuredProgramId,
                setupSelection: setup,
                workoutTemplates: [],
                workoutPlans: [{
                  entries: composed.sessions.map((session) => ({ workoutTemplateId: featuredProgramId, workoutTemplateSessionId: session.id })),
                }],
              };
              const readerWeek = resolveReaderComposedWeek(featuredProgramId, context);
              assert.ok(readerWeek, label);
              const page = readyProgramSessionMinutes(template, readerWeek, options);
              const card = programmeCardMinutes(template, readerWeek, options);
              assert.equal(card, page, `${label} ${featuredProgramId}`);
              assert.equal(card, composed.sessionMinutes, label);
              held += 1;
              if (card !== readyTemplateCardMinutes(template, options)) {
                differsFromGear += 1;
              }

              // Every other card has no composed week behind its page either.
              const other = getWorkoutTemplateById(featuredProgramId === RUN ? 'tpl_3_day_full_body_v1' : RUN);
              assert.equal(resolveReaderComposedWeek(other.id, context), null, label);
              assert.equal(programmeCardMinutes(other, readerWeek, options), readyTemplateCardMinutes(other, options), label);
              // A copy of the programme is what the reader trains: the
              // catalog card and page go back to the catalog's week together.
              const copied = { ...context, workoutTemplates: [{ id: 'mine', sourceTemplateId: featuredProgramId }] };
              assert.equal(resolveReaderComposedWeek(featuredProgramId, copied), null, label);
            }
          }
        }
      }
      assert.equal(held, 72);
      // The sweep reaches the readers the finding was about: flags or focus
      // move the week's minutes off the gear-only estimate.
      assert.ok(differsFromGear >= 10, `only ${differsFromGear} cards differ from the gear-only estimate`);
    },
  },
];
