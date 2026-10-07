const assert = require('node:assert/strict');

const dist = (name) => require(`../../.test-dist/${name}`);
const { DEFAULT_FIRST_RUN_SELECTION, resolveFirstRunRecommendationWithTailoring } = dist('lib/firstRunSetup.js');
const { composeProgramWeekForSelection } = dist('lib/programDayComposer.js');
const { buildRecommendationInput } = dist('lib/recommendationInput.js');
const { selectWaterfallDecision } = dist('lib/recommendationWaterfall.js');
const { getRecommendationProgramDefinition } = dist('lib/recommendationCatalog.js');
const { programGearUse } = dist('lib/programEquipmentFit.js');
const { isExerciseAllowedWithEquipment, resolveAvailableEquipment } = dist('lib/equipmentExerciseFilter.js');
const {
  applyCautionFlagsToExercises,
  AREA_CAREFUL_SWAPS,
  AREA_BODYWEIGHT_SWAPS,
} = dist('lib/cautionExerciseFilter.js');
const { createSeedExerciseLibrary } = dist('data/seed.js');
const { findGuidedLibraryIndex } = dist('lib/guidedPlayer.js');
const { getWorkoutTemplateById } = dist('features/workout/workoutCatalog.js');

/**
 * The recommender over the onboarding answer space, for the four classes the
 * bug hunt of 2026-10-07 found (A7): each is held at zero.
 *
 * - a careful swap the reader's gear cannot do, or one the library has no row
 *   for (Landmine Press for a dumbbells-only reader);
 * - the tailoring swap trading the waterfall's pick for one that uses less of
 *   the reader's gear (SHRED for RUN at a full home gym);
 * - two optional days of a composed week that are the same day;
 * - a stretching-only week for a reader who did not ask for one ("Lose
 *   weight", five days at a gym, handed five days of mobility flow).
 */

const GOALS = ['strength', 'muscle', 'general', 'run_mobility', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];
const GENDERS = ['unspecified', 'male', 'female'];
const FULL_GYM = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];

/** The onboarding equipment cards, as the screen fills them in. */
const GEAR = [
  { id: 'gym', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: FULL_GYM },
  { id: 'gym-no-barbells', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: FULL_GYM.filter((item) => item !== 'Barbells') },
  { id: 'gym-dumbbells', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Dumbbells'] },
  { id: 'gym-machines-cables', equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: ['Machines', 'Cables'] },
  ...[
    [],
    ['Dumbbells'],
    ['Dumbbells', 'Bench', 'Resistance bands'],
    ['Dumbbells', 'Pull-up bar'],
    ['Barbell & plates', 'Squat rack', 'Bench'],
    ['Barbell & plates', 'Squat rack', 'Bench', 'Dumbbells'],
    ['Kettlebells'],
    ['Resistance bands'],
    ['Pull-up bar', 'Resistance bands', 'Yoga mat'],
    ['Cardio machines'],
    ['Dumbbells', 'Barbell & plates', 'Squat rack', 'Bench', 'Resistance bands', 'Kettlebells', 'Pull-up bar', 'Cardio machines'],
  ].map((items) => ({
    id: `home[${items.join('+')}]`,
    equipment: items.length === 0 || items.some((item) => item === 'Barbell & plates' || item === 'Squat rack') ? 'home' : 'minimal',
    trainingEnvironment:
      items.length === 0 ? 'bodyweight_only' : items.some((item) => item === 'Barbell & plates' || item === 'Squat rack') ? 'home_gym' : 'minimal_equipment',
    equipmentItems: items,
  })),
];

function selection({ goal, level, days, gear, gender = 'unspecified', cautionFlags = [], focusAreas = [], secondaryOutcomes = [] }) {
  return {
    ...DEFAULT_FIRST_RUN_SELECTION,
    goal,
    goals: [goal],
    level,
    daysPerWeek: days,
    gender,
    equipment: gear.equipment,
    trainingEnvironment: gear.trainingEnvironment,
    equipmentItems: gear.equipmentItems,
    cautionFlags,
    focusAreas,
    secondaryOutcomes,
    availableDays: [],
  };
}

/** What the app passes: the reader's own card, every preference neutral. */
function neutralTailoring(gear) {
  return {
    setupEquipment: gear.equipment,
    setupFreeWeightsPreference: 'neutral',
    setupBodyweightPreference: 'neutral',
    setupMachinesPreference: 'neutral',
    setupShoulderFriendlySwaps: 'neutral',
    setupElbowFriendlySwaps: 'neutral',
    setupKneeFriendlySwaps: 'neutral',
  };
}

function everyAnswer(visit, { genders = ['unspecified'], goals = GOALS, gear = GEAR } = {}) {
  for (const goal of goals) {
    for (const level of LEVELS) {
      for (const days of DAYS) {
        for (const card of gear) {
          for (const gender of genders) {
            visit({ goal, level, days, gear: card, gender, label: `${goal}/${level}/${days}d/${card.id}/${gender}` });
          }
        }
      }
    }
  }
}

const LIBRARY = createSeedExerciseLibrary();
const LIBRARY_NAMES = LIBRARY.map((item) => item.name);
const libraryRow = (name) => {
  const index = findGuidedLibraryIndex(name, LIBRARY_NAMES);
  return index === null ? null : LIBRARY[index];
};

/**
 * Written out, not derived from the catalogue's tags: the guard must not
 * agree with the code it guards by construction. Each is a week of stretches
 * and holds with nothing lifted (checked below, so a new lift in one of them
 * takes it off this list on purpose).
 */
const STRETCHING_ONLY = ['tpl_2_day_mobility_reset_v1', 'tpl_2_day_yoga_recovery_v1', 'tpl_gainer_mobility_flow_v1'];

module.exports = [
  {
    name: 'recommender sweep: a strength, muscle, fat-loss or general goal is never handed a stretching-only week',
    run() {
      for (const programId of STRETCHING_ONLY) {
        const template = getWorkoutTemplateById(programId);
        assert.ok(template, programId);
        const lifted = template.sessions
          .flatMap((session) => session.exercises)
          .filter((exercise) => exercise.trackingMode === 'load_and_reps');
        assert.deepEqual(lifted.map((exercise) => exercise.exerciseName), [], `${programId} lifts`);
      }

      const offenders = [];
      let checked = 0;
      everyAnswer(
        ({ goal, level, days, gear, gender, label }) => {
          const answers = selection({ goal, level, days, gear, gender });
          for (const tailoring of [neutralTailoring(gear), null]) {
            checked += 1;
            const featured = resolveFirstRunRecommendationWithTailoring(answers, tailoring).featuredProgramId;
            if (STRETCHING_ONLY.includes(featured)) {
              offenders.push(`${label}${tailoring ? '' : ' (no tailoring)'}: ${featured}`);
            }
          }
        },
        { genders: GENDERS, goals: ['strength', 'muscle', 'general', 'lean_athletic', 'general_fitness'] },
      );
      assert.ok(checked > 6000, `the sweep checked only ${checked} answers`);
      assert.deepEqual(offenders, []);

      // The reported case, and the reader who asks for mobility still gets it.
      const gym = GEAR[0];
      const loseWeight = resolveFirstRunRecommendationWithTailoring(
        selection({ goal: 'general', level: 'advanced', days: 5, gear: gym }),
        neutralTailoring(gym),
      );
      assert.ok(!STRETCHING_ONLY.includes(loseWeight.featuredProgramId), loseWeight.featuredProgramId);
      const askedForMobility = resolveFirstRunRecommendationWithTailoring(
        selection({ goal: 'general', level: 'advanced', days: 5, gear: gym, secondaryOutcomes: ['mobility'] }),
        neutralTailoring(gym),
      );
      assert.ok(STRETCHING_ONLY.includes(askedForMobility.featuredProgramId), askedForMobility.featuredProgramId);
    },
  },
  {
    name: 'recommender sweep: the tailoring swap never uses less of the reader\'s gear than the waterfall\'s pick',
    run() {
      const offenders = [];
      let swaps = 0;
      const preferenceSets = [
        {},
        { setupBodyweightPreference: 'prefer' },
        { setupFreeWeightsPreference: 'avoid' },
        { setupMachinesPreference: 'love' },
      ];
      everyAnswer(({ goal, level, days, gear, label }) => {
        if (gear.equipment === 'gym') return;
        const answers = selection({ goal, level, days, gear });
        const available = resolveAvailableEquipment(answers);
        const pick = selectWaterfallDecision(buildRecommendationInput(answers)).primaryProgramId;
        for (const preferences of preferenceSets) {
          const result = resolveFirstRunRecommendationWithTailoring(answers, { ...neutralTailoring(gear), ...preferences });
          if (!result.waterfall || result.featuredProgramId === pick) continue;
          swaps += 1;
          const shown = getRecommendationProgramDefinition(result.featuredProgramId);
          const why = `${label} ${JSON.stringify(preferences)}: ${pick} -> ${result.featuredProgramId}`;
          // Running and mobility asked for a week that leaves the load
          // unused, so the swap to the running week is not held to the gear.
          if (goal !== 'run_mobility' && programGearUse(result.featuredProgramId, available) < programGearUse(pick, available)) {
            offenders.push(`${why} uses less gear`);
          }
          // The home reason names the tier of the programme it is printed over.
          if (result.waterfall.rule === 'home_equipment') {
            const want = shown.equipmentTier === 'low_equipment' ? 'wf.home_equipment.primary' : 'wf.home_gear.primary';
            if (result.waterfall.whyPrimary !== want) offenders.push(`${why} reads ${result.waterfall.whyPrimary}`);
          }
        }
      });
      // The swap still happens where it keeps the gear: the guard is not
      // passing because swapping was switched off.
      assert.ok(swaps > 20, `only ${swaps} swaps in the sweep`);
      assert.deepEqual(offenders, []);

      // The reported case: SHRED stays, under the gear reason.
      const home = GEAR.find((card) => card.id.startsWith('home[Dumbbells+Barbell & plates'));
      const result = resolveFirstRunRecommendationWithTailoring(
        selection({ goal: 'general', level: 'beginner', days: 3, gear: home }),
        neutralTailoring(home),
      );
      assert.equal(result.featuredProgramId, 'tpl_shred_v1');
      assert.equal(result.waterfall.whyPrimary, 'wf.home_gear.primary');

      // Running and mobility keeps the running week, not a strength week
      // with no running in it, under the no-gym reason (review, 2026-10-07).
      const dumbbellsBenchBands = GEAR.find((card) => card.id === 'home[Dumbbells+Bench+Resistance bands]');
      for (const gender of GENDERS) {
        const runner = resolveFirstRunRecommendationWithTailoring(
          selection({ goal: 'run_mobility', level: 'advanced', days: 3, gear: dumbbellsBenchBands, gender }),
          neutralTailoring(dumbbellsBenchBands),
        );
        assert.equal(runner.featuredProgramId, 'tpl_3_day_run_mobility_v1', gender);
        assert.equal(runner.waterfall.whyPrimary, 'wf.home_equipment.primary', gender);
      }
    },
  },
  {
    name: 'recommender sweep: no two optional days of a composed week are the same day',
    run() {
      const offenders = [];
      let padded = 0;
      const check = (answers, programId, label) => {
        const week = composeProgramWeekForSelection(answers, programId);
        if (!week) return;
        const suggested = week.sessions.filter((session) => session.source === 'suggested');
        if (suggested.length < 2) return;
        padded += 1;
        const seenNames = new Set();
        const seenLifts = new Set();
        for (const session of suggested) {
          const lifts = session.exercises.map((exercise) => exercise.exerciseName).join(' | ');
          if (seenNames.has(session.name)) offenders.push(`${label} ${programId}: "${session.name}" twice`);
          if (seenLifts.has(lifts)) offenders.push(`${label} ${programId}: ${lifts} twice`);
          seenNames.add(session.name);
          seenLifts.add(lifts);
        }
      };
      everyAnswer(({ goal, level, days, gear, label }) => {
        const answers = selection({ goal, level, days, gear });
        const result = resolveFirstRunRecommendationWithTailoring(answers, neutralTailoring(gear));
        for (const programId of [result.featuredProgramId, ...result.alternativeProgramIds]) {
          check(answers, programId, label);
        }
      });
      // A two-day programme stretched to six days: four optional days, the
      // most a recommended week can have.
      for (const goal of GOALS) {
        for (const gear of [GEAR[0], GEAR[4]]) {
          check(selection({ goal, level: 'advanced', days: 6, gear }), 'tpl_2_day_minimal_full_body_v1', `${goal}/6d/${gear.id}`);
        }
      }
      assert.ok(padded > 300, `only ${padded} weeks had two optional days`);
      assert.deepEqual(offenders, []);

      // The reported case: a beginner asking for six strength days.
      const week = composeProgramWeekForSelection(
        selection({ goal: 'strength', level: 'beginner', days: 6, gear: GEAR[0] }),
        'tpl_3_day_strength_base_v1',
      );
      assert.equal(week.days, 6);
      const names = week.sessions.filter((session) => session.source === 'suggested').map((session) => session.name);
      assert.equal(new Set(names).size, 3, names.join(', '));
    },
  },
  {
    name: 'recommender sweep: every careful swap names a library lift, filed with the gear it needs',
    run() {
      // The tables: each target opens a row, and a row filed as needing
      // equipment is refused to a reader with none. Landmine Press opened
      // nothing and passed every gear check (bug hunt, 2026-10-07).
      const tableProblems = [];
      for (const table of [AREA_CAREFUL_SWAPS, AREA_BODYWEIGHT_SWAPS]) {
        for (const [area, entries] of Object.entries(table)) {
          for (const [, to] of entries) {
            const row = libraryRow(to);
            if (!row) {
              tableProblems.push(`${area}: ${to} has no library row`);
            } else if (row.equipment !== 'bodyweight' && isExerciseAllowedWithEquipment(to, [])) {
              tableProblems.push(`${area}: ${to} is filed as ${row.equipment} but passes with no gear`);
            }
          }
        }
      }
      assert.deepEqual(tableProblems, []);

      // The weeks: every careful swap the composer makes is one the reader's
      // gear allows, and a lift the library knows.
      const AREAS = ['shoulders', 'lower_back', 'knees', 'elbows', 'wrists', 'hips', 'ankles'];
      const offenders = [];
      let swapsSeen = 0;
      everyAnswer(({ goal, level, days, gear, label }) => {
        const plain = selection({ goal, level, days, gear });
        const programId = resolveFirstRunRecommendationWithTailoring(plain, null).featuredProgramId;
        for (const area of AREAS) {
          const answers = selection({ goal, level, days, gear, cautionFlags: [{ area, level: 'careful', refinements: [] }] });
          const available = resolveAvailableEquipment(answers);
          const week = composeProgramWeekForSelection(answers, programId);
          for (const swap of week.cautionSwapped) {
            swapsSeen += 1;
            if (!isExerciseAllowedWithEquipment(swap.to, available)) {
              offenders.push(`${label} ${area}: ${swap.from} -> ${swap.to} not doable with ${JSON.stringify(available)}`);
            }
            if (!libraryRow(swap.to)) offenders.push(`${label} ${area}: ${swap.to} has no library row`);
          }
        }
      });
      assert.ok(swapsSeen > 1000, `only ${swapsSeen} careful swaps in the sweep`);
      assert.deepEqual(offenders, []);

      // The reported case: dumbbells only, shoulders careful. The press goes
      // to the bodyweight swap; a barbell owner still gets the landmine.
      const press = [{ ...getWorkoutTemplateById('tpl_home_dumbbell_strength_v1').sessions[1].exercises[1] }];
      assert.equal(press[0].exerciseName, 'Dumbbell Shoulder Press');
      const careful = [{ area: 'shoulders', level: 'careful', refinements: [] }];
      assert.equal(applyCautionFlagsToExercises(press, careful, [], ['Dumbbells']).exercises[0].exerciseName, 'Incline Push-Up');
      assert.equal(
        applyCautionFlagsToExercises(press, careful, [], ['Dumbbells', 'Barbell & plates']).exercises[0].exerciseName,
        'Landmine Press',
      );
    },
  },
];
