const assert = require('node:assert/strict');

const dist = '../../.test-dist/';
const {
  DEFAULT_FIRST_RUN_SELECTION,
  resolveFirstRunRecommendationWithTailoring,
} = require(dist + 'lib/firstRunSetup.js');
const { composeProgramWeekForSelection, foldThinSessions } = require(dist + 'lib/programDayComposer.js');
const { focusProgrammeLosesItsPoint } = require(dist + 'lib/recommendationWeekFit.js');
const { buildRecommendationInput } = require(dist + 'lib/recommendationInput.js');
const { getWorkoutTemplateById } = require(dist + 'features/workout/workoutCatalog.js');
const { emphasisAreaForExercise } = require(dist + 'lib/programEmphasis.js');
const { exerciseHitsCautionArea } = require(dist + 'lib/cautionAreaMatching.js');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = require(dist + 'lib/equipmentExerciseFilter.js');
const { resolveCatalogSourceCategory } = require(dist + 'lib/catalogExercisePools.js');
const { isStretchExercise } = require(dist + 'lib/exerciseClassification.js');
const { isMinutesExerciseName } = require(dist + 'lib/minutesExercises.js');

/**
 * What the recommender features has to be a week the reader can train after
 * their gear and their avoid flags have been applied (bug hunt round 2,
 * 2026-10-08).
 *
 * - The focus-block guard asked the avoid flags alone, on the catalog week.
 *   The composer takes the gear out first, so a chest block with no
 *   dumbbells or cables and elbows and wrists avoided kept Bench Press and a
 *   lateral raise on Chest (Heavy) and was featured under "trains your focus
 *   area twice a week".
 * - A day with one lift left was kept as a training day: Fat Burn HIIT's
 *   Lower Body HIIT was Glute Bridge March alone with knees avoided. Owner:
 *   such a day is filled back to three lifts from its own movement pools,
 *   and when nothing safe is left it joins its neighbour.
 */

const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const gym = (items) => ({ equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: items });
const GEARS = {
  gym: gym(GYM_ALL),
  gymNoDumbbellsCables: gym(['Barbells', 'Machines', 'Bench', 'Kettlebells', 'Cardio machines']),
  gymNoRackMachines: gym(['Barbells', 'Cables', 'Bench', 'Barbell & plates', 'Resistance bands', 'Pull-up bar', 'Yoga mat']),
  gymMachinesCables: gym(['Machines', 'Cables']),
  gymDumbbells: gym(['Dumbbells']),
  homeNone: { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] },
  homeDumbbells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Dumbbells'] },
  homeBar: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Pull-up bar', 'Resistance bands', 'Yoga mat'] },
  homeRack: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench', 'Dumbbells'] },
  homeBarbell: { equipment: 'home', trainingEnvironment: 'home_gym', equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench'] },
  homeKettlebells: { equipment: 'minimal', trainingEnvironment: 'minimal_equipment', equipmentItems: ['Kettlebells'] },
};

function selection({ gear, avoid = [], ...rest }) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    equipment: gear.equipment,
    trainingEnvironment: gear.trainingEnvironment,
    equipmentItems: gear.equipmentItems,
    gender: 'unspecified',
    focusAreas: [],
    availableDays: [],
    ...rest,
    goals: [rest.goal],
    cautionFlags: avoid.map((area) => ({ area, level: 'avoid' })),
  };
}

/**
 * A lift, as a reader counts them: not a bout of minutes, not a stretch. A
 * plank is core work; Cat Stretch and Ankle Circles are not.
 */
function isLift(exercise) {
  if (exercise.trackingMode === 'duration_minutes' || isMinutesExerciseName(exercise.exerciseName)) {
    return false;
  }
  const sourceCategory = resolveCatalogSourceCategory(exercise.exerciseName) ?? undefined;
  if (isStretchExercise({ name: exercise.exerciseName, sourceCategory })) {
    return false;
  }
  return exercise.trackingMode !== 'hold' || sourceCategory === 'strength';
}

const liftsOf = (session) => session.exercises.filter(isLift).length;

/** The reader's flags and gear hold for every exercise on the week. */
function assertSafe(week, setup, label) {
  const gear = resolveAvailableEquipment(setup);
  for (const session of week.sessions) {
    const names = session.exercises.map((exercise) => exercise.exerciseName.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${label}: ${session.name} holds a lift twice: ${names}`);
    for (const exercise of session.exercises) {
      for (const flag of setup.cautionFlags) {
        assert.ok(!exerciseHitsCautionArea(exercise.exerciseName, flag.area), `${label}: ${exercise.exerciseName} loads ${flag.area}`);
      }
      assert.ok(isExerciseAllowedWithEquipment(exercise.exerciseName, gear), `${label}: ${exercise.exerciseName} needs gear the reader lacks`);
    }
  }
}

/**
 * The days the reader's flags leave thin: a day of the same week composed
 * without the flags that had three lifts or more, and has fewer with them.
 * A day the flags folded into its neighbour is gone from the week, and is
 * not thin.
 */
function thinDays(setup, programId) {
  const flagged = composeProgramWeekForSelection(setup, programId);
  if (flagged.sessions.every((session) => liftsOf(session) >= 3)) {
    return [];
  }
  const free = composeProgramWeekForSelection({ ...setup, cautionFlags: [] }, programId);
  return flagged.sessions.filter((session) => {
    const unflagged = free.sessions.find((entry) => entry.id === session.id);
    return unflagged && liftsOf(unflagged) >= 3 && liftsOf(session) < 3;
  });
}

const FOCUS_BLOCK_AREA = {
  tpl_focus_chest_program_v1: 'chestArms',
  tpl_focus_back_program_v1: 'shouldersBack',
  tpl_focus_arms_program_v1: 'chestArms',
  tpl_focus_legs_program_v1: 'glutesLegs',
  tpl_focus_glutes_program_v1: 'glutesLegs',
};

/**
 * The focus days of a specialisation block that the reader's composed week
 * keeps less than half of the area's sets on: what the guard exists to
 * keep off the featured card.
 */
function guttedFocusDays(setup, programId) {
  const area = FOCUS_BLOCK_AREA[programId];
  if (!area) {
    return [];
  }
  const template = getWorkoutTemplateById(programId);
  const areaSets = (exercises) =>
    exercises.filter((exercise) => emphasisAreaForExercise(exercise.exerciseName) === area).reduce((sum, exercise) => sum + exercise.sets, 0);
  const week = composeProgramWeekForSelection(setup, programId);
  return week.sessions.filter((session) => {
    const source = template.sessions.find((entry) => entry.name === session.name);
    if (!source) {
      return false;
    }
    const before = areaSets(source.exercises);
    const total = source.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
    return before * 2 > total && areaSets(session.exercises) * 2 < before;
  });
}

module.exports = [
  {
    name: 'round 2: the focus-block guard judges the block after the gear pass, as the composer does',
    run() {
      // Chest (Heavy) without dumbbells or cables, elbows and wrists avoided:
      // the gear takes the dumbbell press and fly, the flags the push-ups and
      // the pushdown, and Bench Press and a lateral raise were left.
      const setup = selection({
        goal: 'muscle',
        level: 'pro',
        daysPerWeek: 4,
        gear: GEARS.gymNoDumbbellsCables,
        avoid: ['elbows', 'wrists'],
        focusAreas: ['chest'],
      });
      assert.equal(focusProgrammeLosesItsPoint('tpl_focus_chest_program_v1', buildRecommendationInput(setup)), true);
      const recommendation = resolveFirstRunRecommendationWithTailoring(setup, null);
      assert.notEqual(recommendation.featuredProgramId, 'tpl_focus_chest_program_v1');
      assert.notEqual(recommendation.waterfall?.alternativeProgramId, 'tpl_focus_chest_program_v1');

      // The controls: the same gear with no flags, and the same flags with
      // every piece of gear, leave the block its point.
      for (const control of [
        { ...setup, cautionFlags: [] },
        { ...setup, equipmentItems: GYM_ALL },
      ]) {
        assert.equal(focusProgrammeLosesItsPoint('tpl_focus_chest_program_v1', buildRecommendationInput(control)), false);
      }

      // The score ranking, which picks when the waterfall has nothing: Legs
      // (Heavy) without a rack or machines was Bodyweight Squat and a crunch.
      const scored = selection({
        goal: 'muscle',
        level: 'pro',
        daysPerWeek: 5,
        gear: GEARS.gymNoRackMachines,
        avoid: ['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'ankles'],
        focusAreas: ['hamstrings'],
      });
      assert.equal(focusProgrammeLosesItsPoint('tpl_focus_legs_program_v1', buildRecommendationInput(scored)), true);
      const scoredPick = resolveFirstRunRecommendationWithTailoring(scored, null);
      assert.notEqual(scoredPick.featuredProgramId, 'tpl_focus_legs_program_v1');
    },
  },
  {
    name: 'round 2: a day the avoid flags leave with one lift is filled back to three from its own movement',
    run() {
      // Knees avoided took Jump Squat, Reverse Lunge, Bodyweight Squat and
      // High Knees off Lower Body HIIT, and Glute Bridge March was the day.
      const hiit = selection({ goal: 'general', level: 'beginner', daysPerWeek: 3, gear: GEARS.homeDumbbells, avoid: ['knees'] });
      const hiitPick = resolveFirstRunRecommendationWithTailoring(hiit, null);
      assert.equal(hiitPick.featuredProgramId, 'tpl_gainer_fat_burn_hiit_v1');
      const hiitWeek = composeProgramWeekForSelection(hiit, hiitPick.featuredProgramId);
      const lower = hiitWeek.sessions.find((session) => session.name === 'Lower Body HIIT');
      assert.ok(lower, hiitWeek.sessions.map((session) => session.name).join(', '));
      assert.ok(liftsOf(lower) >= 3, lower.exercises.map((exercise) => exercise.exerciseName).join(', '));
      assert.ok(lower.exercises.some((exercise) => exercise.exerciseName === 'Glute Bridge March'), 'the survivor keeps its place');
      assert.equal(hiitWeek.days, 3, 'a day that could be filled stays a day');
      assertSafe(hiitWeek, hiit, 'hiit');

      // Knees and wrists on the two-day full body: Day 2 was Glute Bridge.
      const minimal = selection({ goal: 'general', level: 'beginner', daysPerWeek: 2, gear: GEARS.gym, avoid: ['knees', 'wrists'] });
      const minimalWeek = composeProgramWeekForSelection(minimal, 'tpl_2_day_minimal_full_body_v1');
      for (const session of minimalWeek.sessions) {
        assert.ok(liftsOf(session) >= 3, `${session.name}: ${session.exercises.map((exercise) => exercise.exerciseName)}`);
      }
      assertSafe(minimalWeek, minimal, 'minimal');

      // The minutes the card quotes are the filled day's, not a 15-minute one.
      assert.ok(hiitWeek.sessionMinutes >= 25, `${hiitWeek.sessionMinutes} min`);
    },
  },
  {
    name: 'round 2: a day avoiding every joint is still filled to three safe lifts, and keeps its place in the week',
    run() {
      const every = ['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'hips', 'knees', 'ankles'];
      for (const programId of ['tpl_gainer_fat_burn_hiit_v1', 'tpl_2_day_minimal_full_body_v1', 'tpl_3_day_full_body_v1', 'tpl_5_day_ppl_v1', 'tpl_home_bodyweight_upper_lower_v1']) {
        for (const avoid of [['knees', 'hips', 'ankles', 'lower_back'], ['knees', 'wrists', 'elbows', 'shoulders'], every]) {
          for (const gear of [GEARS.homeNone, GEARS.homeDumbbells, GEARS.gym]) {
            const setup = selection({ goal: 'general', level: 'beginner', daysPerWeek: 3, gear, avoid });
            const label = `${programId}/${avoid}/${gear.equipmentItems}`;
            assert.deepEqual(thinDays(setup, programId).map((session) => session.name), [], label);
            const week = composeProgramWeekForSelection(setup, programId);
            assertSafe(week, setup, label);
            assert.equal(week.days, week.sessions.length, label);
            week.sessions.forEach((session, index) => assert.equal(session.orderIndex, index, label));
          }
        }
      }
    },
  },
  {
    name: 'round 2: a day with no safe lift left to fill it joins its neighbour instead of being a one-lift day',
    run() {
      // No catalog week reaches this yet (the test above): some bodyweight
      // core or glute lift survives every flag. The owner's rule for when one
      // does, on the folding step itself.
      const lift = (name, slotId = name) => ({ exerciseName: name, slotId, trackingMode: 'bodyweight' });
      const day = (id, ...names) => ({ id, name: id, exercises: names.map((name) => lift(name)) });
      const thin = (session) => session.exercises.length < 3;

      // A thin day goes into the day before it.
      const middle = foldThinSessions([day('a', 'Push-Up', 'Plank', 'Dead Bug'), day('b', 'Glute Bridge'), day('c', 'Inverted Row', 'Plank', 'Bird Dog')], thin);
      assert.deepEqual(middle.sessions.map((session) => session.id), ['a', 'c']);
      assert.deepEqual(middle.sessions[0].exercises.map((exercise) => exercise.exerciseName), ['Push-Up', 'Plank', 'Dead Bug', 'Glute Bridge']);
      assert.equal(middle.foldedInto.get('b'), 'a');

      // The first day has none before it, so it goes into the next one; a
      // lift the neighbour already holds is not put there twice, and a slot
      // id the neighbour uses is not reused.
      const first = foldThinSessions([
        { id: 'a', name: 'a', exercises: [lift('Plank', 'core_1'), lift('Glute Bridge', 'lower_1')] },
        { id: 'b', name: 'b', exercises: [lift('Plank', 'core_1'), lift('Push-Up', 'core_2'), lift('Inverted Row', 'lower_1')] },
      ], thin);
      assert.deepEqual(first.sessions.map((session) => session.id), ['b']);
      const folded = first.sessions[0].exercises;
      assert.deepEqual(folded.map((exercise) => exercise.exerciseName), ['Plank', 'Push-Up', 'Inverted Row', 'Glute Bridge']);
      assert.equal(new Set(folded.map((exercise) => exercise.slotId)).size, folded.length, folded.map((exercise) => exercise.slotId).join(', '));
      assert.equal(first.foldedInto.get('a'), 'b');

      // A week of thin days has no neighbour to fold into, and stays.
      const all = [day('a', 'Plank'), day('b', 'Glute Bridge')];
      assert.equal(foldThinSessions(all, thin).sessions, all);
    },
  },
  {
    name: 'round 2 sweep: no featured or second-card day the avoid flags thinned is under three lifts',
    run() {
      // Every goal, level, day count, gear and single or paired avoid flag,
      // a fixed fifth of them (the full product is about half a minute). The
      // step is 5, which shares no factor with the 12 flag sets or the 11
      // gears, so it walks through every pair of them; a step of 4 landed on
      // the same three flag sets in every block and never ran knees.
      const flagSets = [['knees'], ['wrists'], ['shoulders'], ['lower_back'], ['elbows'], ['ankles'], ['hips'], ['neck'], ['knees', 'wrists'], ['elbows', 'wrists'], ['knees', 'lower_back'], ['shoulders', 'elbows']];
      let index = 0;
      let checked = 0;
      const failures = [];
      const visitedFlags = new Map(flagSets.map((avoid) => [avoid.join('+'), 0]));
      const visitedGear = new Map(Object.keys(GEARS).map((gearId) => [gearId, 0]));
      const visitedPairs = new Set();
      for (const goal of ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness']) {
        for (const level of ['beginner', 'advanced', 'pro']) {
          for (const daysPerWeek of [2, 3, 4, 5, 6]) {
            for (const [gearId, gear] of Object.entries(GEARS)) {
              for (const avoid of flagSets) {
                index += 1;
                if (index % 5 !== 0) {
                  continue;
                }
                visitedFlags.set(avoid.join('+'), visitedFlags.get(avoid.join('+')) + 1);
                visitedGear.set(gearId, visitedGear.get(gearId) + 1);
                visitedPairs.add(`${gearId}/${avoid.join('+')}`);
                const setup = selection({ goal, level, daysPerWeek, gear, avoid });
                const recommendation = resolveFirstRunRecommendationWithTailoring(setup, null);
                for (const programId of [recommendation.featuredProgramId, recommendation.waterfall?.alternativeProgramId].filter(Boolean)) {
                  checked += 1;
                  for (const session of thinDays(setup, programId)) {
                    failures.push(`${goal}/${level}/${daysPerWeek}d/${gearId}/${avoid} ${programId} ${session.name}: ${session.exercises.map((exercise) => exercise.exerciseName).join('; ')}`);
                  }
                }
              }
            }
          }
        }
      }
      assert.deepEqual(failures.slice(0, 15), [], `${failures.length} failures`);
      assert.ok(checked > 1500, `${checked}`);
      // A sample that aliases with the loops skips whole flag sets or gears
      // and still passes; this fails it instead.
      assert.deepEqual([...visitedFlags].filter(([, count]) => count === 0), [], 'flag sets the sample never ran');
      assert.deepEqual([...visitedGear].filter(([, count]) => count === 0), [], 'gears the sample never ran');
      assert.equal(visitedPairs.size, flagSets.length * visitedGear.size, 'gear and flag pairs the sample never ran');
    },
  },
  {
    name: 'round 2 sweep: no specialisation block whose focus days the gear and flags gut is featured or the second card',
    run() {
      // The focus lane is for muscle readers past beginner on up to four days,
      // and the score ranking and the second card reach the blocks from there.
      const flagSets = [[], ['elbows'], ['wrists'], ['shoulders'], ['knees'], ['lower_back'], ['elbows', 'wrists'], ['knees', 'lower_back'], ['shoulders', 'elbows'], ['knees', 'wrists']];
      let focusFeatured = 0;
      const failures = [];
      for (const level of ['advanced', 'pro']) {
        for (const daysPerWeek of [2, 3, 4]) {
          for (const [gearId, gear] of Object.entries(GEARS)) {
            for (const focusAreas of [['chest'], ['arms'], ['legs'], ['back'], ['glutes']]) {
              for (const avoid of flagSets) {
                const setup = selection({ goal: 'muscle', level, daysPerWeek, gear, avoid, focusAreas });
                const label = `${level}/${daysPerWeek}d/${gearId}/${focusAreas}/${avoid}`;
                const recommendation = resolveFirstRunRecommendationWithTailoring(setup, null);
                for (const programId of [recommendation.featuredProgramId, recommendation.waterfall?.alternativeProgramId]) {
                  if (!FOCUS_BLOCK_AREA[programId]) {
                    continue;
                  }
                  focusFeatured += 1;
                  if (focusProgrammeLosesItsPoint(programId, buildRecommendationInput(setup))) {
                    failures.push(`${label} ${programId}: handed over although the guard says it loses its point`);
                  }
                  for (const session of guttedFocusDays(setup, programId)) {
                    failures.push(`${label} ${programId} ${session.name} gutted: ${session.exercises.map((exercise) => exercise.exerciseName).join('; ')}`);
                  }
                }
              }
            }
          }
        }
      }
      assert.deepEqual(failures.slice(0, 15), [], `${failures.length} failures`);
      assert.ok(focusFeatured > 100, `a block the flags leave whole is still featured (${focusFeatured})`);
    },
  },
];
