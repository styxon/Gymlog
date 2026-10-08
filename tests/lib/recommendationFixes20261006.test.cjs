const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { recommendPrograms } = require('../../.test-dist/lib/recommendationScoring.js');
const { buildRecommendationInput } = require('../../.test-dist/lib/recommendationInput.js');
const { selectWaterfallDecision } = require('../../.test-dist/lib/recommendationWaterfall.js');
const {
  getRecommendationProgramDefinition,
  isRecoveryOnlyProgram,
  readerAskedForRecovery,
  RECOMMENDATION_PROGRAMS,
} = require('../../.test-dist/lib/recommendationCatalog.js');
const { DEFAULT_FIRST_RUN_SELECTION } = require('../../.test-dist/lib/firstRunSetup.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');
const { applyCautionFlagsToExercises, CAUTION_TO_FOCUS_AREAS } = require('../../.test-dist/lib/cautionExerciseFilter.js');
const { applyEquipmentToExercises } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { exerciseHitsCautionArea } = require('../../.test-dist/lib/cautionAreaMatching.js');
const { composeProgramWeekForSelection } = require('../../.test-dist/lib/programDayComposer.js');

/**
 * The recommender findings of the 2026-10-05 evening hunt, each held as an
 * invariant over the whole answer grid rather than the one example the hunt
 * happened to print, so the next catalog change cannot reopen them quietly.
 */

// The onboarding cards write equipment + trainingEnvironment + equipmentItems
// together (OnboardingScreen.applyEquipmentEnvironment); the same sets the
// accuracy matrix walks (tests/recommendation/recommendationMatrix.cjs).
const GYM_ALL = ['Barbells', 'Dumbbells', 'Machines', 'Cables', 'Squat rack', 'Bench', 'Kettlebells', 'Cardio machines'];
const HEAVY = ['Barbell & plates', 'Squat rack'];
const homeCard = (items) => {
  if (items.length === 0) return { equipment: 'home', trainingEnvironment: 'bodyweight_only', equipmentItems: [] };
  const heavy = items.some((item) => HEAVY.includes(item));
  return { equipment: heavy ? 'home' : 'minimal', trainingEnvironment: heavy ? 'home_gym' : 'minimal_equipment', equipmentItems: items };
};
const bodyweightCard = (items) => ({ equipment: 'minimal', trainingEnvironment: 'bodyweight_only', equipmentItems: items });
const gymCard = (items) => ({ equipment: 'gym', trainingEnvironment: 'full_gym', equipmentItems: items });
const D = 'Dumbbells', B = 'Bench', R = 'Resistance bands', K = 'Kettlebells', P = 'Pull-up bar', BB = 'Barbell & plates', RK = 'Squat rack', C = 'Cardio machines';

const CARDS = [
  gymCard(GYM_ALL),
  gymCard(GYM_ALL.filter((item) => item !== 'Barbells' && item !== 'Squat rack')),
  gymCard(GYM_ALL.filter((item) => item !== 'Machines' && item !== 'Cables')),
  homeCard([]),
  homeCard([D]),
  homeCard([D, B]),
  homeCard([D, B, R]),
  homeCard([D, P]),
  homeCard([D, K]),
  homeCard([D, B, R, P]),
  homeCard([R]),
  homeCard([K]),
  homeCard([P]),
  homeCard([R, P]),
  homeCard([BB, RK]),
  homeCard([BB, RK, B]),
  homeCard([D, B, RK, BB]),
  homeCard([D, B, RK, BB, P]),
  homeCard([D, B, RK, BB, R, K, P]),
  homeCard([D, B, C]),
  bodyweightCard([]),
  bodyweightCard([P]),
  bodyweightCard([R]),
  bodyweightCard([P, R, 'Yoga mat']),
];
const GOALS = ['strength', 'muscle', 'lean_athletic', 'general_fitness'];
const LEVELS = ['beginner', 'advanced', 'pro'];
const DAYS = [2, 3, 4, 5, 6];
// Gender decides only the gender-targeted programmes, which all need a gym or
// a home rack; the other cards are walked once, as an unsaid gender.
const gendersFor = (card) =>
  card.equipment === 'gym' || card.equipmentItems.some((item) => HEAVY.includes(item))
    ? ['unspecified', 'male', 'female']
    : ['unspecified'];

/**
 * Every answer set of the grid, recommended once with the tailoring the
 * onboarding screen passes, and shared by the suites below (about 2400 runs
 * of the recommender, the slow part).
 */
let gridCache = null;
function answerGrid() {
  if (gridCache) {
    return gridCache;
  }
  gridCache = [];
  for (const card of CARDS) {
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        for (const daysPerWeek of DAYS) {
          for (const gender of gendersFor(card)) {
            const selection = {
              ...DEFAULT_FIRST_RUN_SELECTION,
              ...card,
              goal,
              goals: [goal],
              level,
              daysPerWeek,
              gender,
              focusAreas: [],
              secondaryOutcomes: [],
              cautionFlags: [],
              weeklyMinutes: null,
            };
            const tailoring = {
              setupEquipment: selection.equipment,
              setupFreeWeightsPreference: 'neutral',
              setupBodyweightPreference: 'neutral',
              setupMachinesPreference: 'neutral',
              setupShoulderFriendlySwaps: 'neutral',
              setupElbowFriendlySwaps: 'neutral',
              setupKneeFriendlySwaps: 'neutral',
            };
            const input = buildRecommendationInput(selection);
            gridCache.push({
              selection,
              input,
              result: recommendPrograms(input, tailoring),
              label: `${card.equipment}:${card.equipmentItems.join('+') || 'none'} ${goal} ${level} ${daysPerWeek}d ${gender}`,
            });
          }
        }
      }
    }
  }
  return gridCache;
}

const definition = (programId) => getRecommendationProgramDefinition(programId);
/** 2 = written for the goal, 1 = a backup goal, 0 = neither. */
const goalTier = (programId, goal) => {
  const entry = definition(programId);
  return entry.supportedGoals.includes(goal) ? 2 : entry.backupGoals.includes(goal) ? 1 : 0;
};

module.exports = [
  {
    // B2: a beginner, gym, 6 days was offered "HUGE Elite" (advanced/pro) and
    // "HUGE Classic" (pro) as the second card, with twenty beginner
    // programmes in the pool. The alternatives took the day count before
    // the level the primary pick is gated on.
    name: 'recommendation fixes 10-06: no alternative is above or below the reader\'s level while one at it is in the pool',
    run() {
      const offenders = [];
      for (const { selection, result, label } of answerGrid()) {
        const level = selection.level;
        const fitsLevel = (programId) => definition(programId).supportedLevels.includes(level);
        const levelFitAvailable = result.scoredCandidates.some(
          (candidate) => candidate.programId !== result.featuredProgramId && fitsLevel(candidate.programId),
        );
        if (!levelFitAvailable) {
          continue;
        }
        for (const programId of [result.secondaryProgramId, ...result.alternativeProgramIds].filter(Boolean)) {
          if (!fitsLevel(programId)) {
            offenders.push(`${label}: ${programId} (${definition(programId).supportedLevels.join('/')})`);
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} alternatives off the reader's level`);
    },
  },
  {
    // Review of B2: with the pool narrowed to the reader's level, a pro
    // strength reader at home with a rack was handed RUN as the second card,
    // the first three-day programme left. A card that does not serve the goal
    // is offered only when nothing at the level and day count that does is left.
    name: 'recommendation fixes 10-06: no alternative ignores the goal while one at the level and day count serves it',
    run() {
      const offenders = [];
      for (const { selection, result, label } of answerGrid()) {
        const { level, goal, daysPerWeek } = selection;
        const shown = new Set([result.featuredProgramId, result.secondaryProgramId, ...result.alternativeProgramIds]);
        // A week of stretching is not left to offer to a reader who did not ask
        // for one (recommender fit, 2026-10-08).
        const recoveryOffered =
          readerAskedForRecovery(buildRecommendationInput(selection)) || isRecoveryOnlyProgram(definition(result.featuredProgramId));
        const servingLeft = result.scoredCandidates.some(
          (candidate) =>
            !shown.has(candidate.programId)
            && (recoveryOffered || !isRecoveryOnlyProgram(definition(candidate.programId)))
            && definition(candidate.programId).supportedLevels.includes(level)
            && definition(candidate.programId).daysPerWeek === daysPerWeek
            && goalTier(candidate.programId, goal) > 0,
        );
        if (!servingLeft) {
          continue;
        }
        // The waterfall's own second card is its decision (a gender-targeted
        // programme, say), held to the level gate above; only the cards the
        // score fills in are held to this.
        const waterfallCard = result.waterfall ? result.waterfall.alternativeProgramId : null;
        for (const programId of result.alternativeProgramIds.filter((id) => id !== waterfallCard)) {
          if (goalTier(programId, goal) === 0) {
            offenders.push(`${label}: ${programId}`);
          }
        }
      }
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} alternatives that ignore the goal`);
    },
  },
  {
    // B3: a general-fitness reader at home was handed RUN (run_mobility +
    // general, not general_fitness) because the waterfall's own pick
    // (Runner's Strength) lists general fitness only as a backup, and the
    // tailoring swap's guard let anything in when the pick did not list the
    // goal outright.
    name: 'recommendation fixes 10-06: the tailoring swap never trades the waterfall\'s pick for one that serves the goal less',
    run() {
      const offenders = [];
      let swaps = 0;
      for (const { selection, input, result, label } of answerGrid()) {
        const waterfallPick = selectWaterfallDecision(input).primaryProgramId;
        if (!result.scoredCandidates.some((candidate) => candidate.programId === waterfallPick)) {
          continue; // The waterfall's pick is not in the pool; the score chose, not the swap.
        }
        if (result.featuredProgramId === waterfallPick) {
          continue;
        }
        swaps += 1;
        if (goalTier(result.featuredProgramId, selection.goal) < goalTier(waterfallPick, selection.goal)) {
          offenders.push(`${label}: ${waterfallPick} -> ${result.featuredProgramId}`);
        }
      }
      assert.ok(swaps > 0, 'the grid no longer exercises the swap');
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} swaps away from the reader's goal`);
    },
  },
  {
    name: 'recommendation fixes 10-06: a general-fitness reader at home is not swapped onto RUN, which does not list general fitness',
    run() {
      // The hunt's example: dumbbells, a bench and bands, general fitness, advanced, 3 days.
      const selection = {
        ...DEFAULT_FIRST_RUN_SELECTION,
        ...homeCard([D, B, R]),
        goal: 'general_fitness',
        goals: ['general_fitness'],
        level: 'advanced',
        daysPerWeek: 3,
        gender: 'unspecified',
        secondaryOutcomes: [],
        focusAreas: [],
        weeklyMinutes: null,
      };
      const result = recommendPrograms(buildRecommendationInput(selection), {
        setupEquipment: selection.equipment,
        setupFreeWeightsPreference: 'neutral',
        setupBodyweightPreference: 'neutral',
        setupMachinesPreference: 'neutral',
        setupShoulderFriendlySwaps: 'neutral',
        setupElbowFriendlySwaps: 'neutral',
        setupKneeFriendlySwaps: 'neutral',
      });
      assert.notEqual(result.featuredProgramId, 'tpl_3_day_run_mobility_v1');
      assert.ok(goalTier(result.featuredProgramId, 'general_fitness') > 0, result.featuredProgramId);
    },
  },
  {
    // B7: a lower day with Back Squat and Front Squat (or one that already
    // had a Box Squat) came out of a careful knee as Box Squat twice; the
    // same for Incline Push-Up, Hammer Curl, Leg Press, Inverted Row and
    // Glute Bridge under the other areas.
    name: 'recommendation fixes 10-06: a caution swap never puts a lift on a day that already has it',
    run() {
      const areas = Object.keys(CAUTION_TO_FOCUS_AREAS);
      const careful = (area) => ({ area, level: 'careful', refinements: [] });
      const flagSets = [
        ...areas.flatMap((area) => [
          { flags: [careful(area)], focus: [] },
          // A flagged area that is also a focus swaps bodyweight-first.
          { flags: [careful(area)], focus: CAUTION_TO_FOCUS_AREAS[area] },
          { flags: [{ area, level: 'avoid', refinements: [] }], focus: [] },
        ]),
        ...areas.flatMap((first, index) =>
          areas.slice(index + 1).map((second) => ({ flags: [careful(first), careful(second)], focus: [] })),
        ),
      ];
      const gearSets = [null, [], ['Dumbbells'], ['Dumbbells', 'Bench', 'Resistance bands'], ['Barbell & plates', 'Squat rack', 'Bench'], ['Pull-up bar', 'Resistance bands']];
      const repeated = (names) => names.filter((name, index) => names.indexOf(name) !== index);
      const offenders = [];
      let swaps = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const gear of gearSets) {
            // The composer's order: the gear pass first, then caution.
            const equipped = applyEquipmentToExercises([...session.exercises], gear).exercises;
            const already = new Set(repeated(equipped.map((exercise) => exercise.exerciseName.toLowerCase())));
            for (const { flags, focus } of flagSets) {
              const result = applyCautionFlagsToExercises(equipped, flags, focus, gear);
              swaps += result.swapped.length;
              const twice = repeated(result.exercises.map((exercise) => exercise.exerciseName.toLowerCase()))
                .filter((name) => !already.has(name));
              if (twice.length > 0) {
                offenders.push(`${template.id}/${session.id} ${flags.map((flag) => `${flag.area}:${flag.level}`).join('+')} focus=${focus.join('+') || 'none'} gear=${gear === null ? 'any' : gear.join('+') || 'none'}: ${[...new Set(twice)].join(', ')}`);
              }
            }
          }
        }
      }
      assert.ok(swaps > 1000, `the sweep no longer swaps anything (${swaps})`);
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} days with a lift twice`);
    },
  },
  {
    name: 'recommendation fixes 10-06: the second squat of a careful-knee day takes the next swap, and keeps its place when none is left',
    run() {
      const lift = (exerciseName) => ({
        id: exerciseName,
        exerciseName,
        slotId: exerciseName,
        role: 'primary',
        progressionPriority: 'high',
        trackingMode: 'load_and_reps',
        sets: 3,
        repsMin: 8,
        repsMax: 8,
        restSecondsMin: 90,
        restSecondsMax: 90,
        substitutionGroup: 'x',
      });
      const knees = [{ area: 'knees', level: 'careful', refinements: [] }];
      const names = (result) => result.exercises.map((exercise) => exercise.exerciseName);
      // Box Squat for the first, the bodyweight one for the second.
      assert.deepEqual(
        names(applyCautionFlagsToExercises([lift('Back Squat'), lift('Front Squat')], knees, [], null)),
        ['Box Squat', 'Bodyweight Squat'],
      );
      // A day that already has a Box Squat does not get another.
      assert.deepEqual(
        names(applyCautionFlagsToExercises([lift('Back Squat'), lift('Box Squat')], knees, [], null)),
        ['Bodyweight Squat', 'Box Squat'],
      );
      // Both swaps taken: the third squat stays what it was.
      assert.deepEqual(
        names(applyCautionFlagsToExercises([lift('Back Squat'), lift('Front Squat'), lift('Hack Squat')], knees, [], null)),
        ['Box Squat', 'Bodyweight Squat', 'Hack Squat'],
      );
    },
  },
  {
    // B8: a knee to avoid still left Sprint 40m, Tempo Run Blocks, Stride
    // Finishers and Lateral Bound in the week. Every landing is a knee load.
    name: 'recommendation fixes 10-06: a knee to avoid takes running, sprints, bounds and hops out of every programme',
    run() {
      // Named here independently of the filter's own word list; a bike
      // sprint is seated and is the knee-friendly conditioning.
      const runningOrLanding = (name) =>
        !/\bbike\b/i.test(name)
        && /\b(run|running|jog|jogging|sprints?|strides?|bounds?|hops?|hopping|leaps?|skips?|skipping|agility|ladder drill|cone drill)\b/i.test(name);
      const knees = [{ area: 'knees', level: 'avoid', refinements: [] }];
      const cards = [gymCard(GYM_ALL), homeCard([]), homeCard([D, B, R]), bodyweightCard([P, R, 'Yoga mat'])];
      const offenders = [];
      let weeks = 0;
      // Every session of every ready programme, through the filter itself.
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of applyCautionFlagsToExercises(session.exercises, knees, [], null).exercises) {
            if (runningOrLanding(exercise.exerciseName)) {
              offenders.push(`${template.id}/${session.id}: ${exercise.exerciseName}`);
            }
          }
        }
      }
      // And every week onboarding composes, refilled days included.
      for (const program of RECOMMENDATION_PROGRAMS) {
        for (const card of cards) {
          const selection = {
            ...DEFAULT_FIRST_RUN_SELECTION,
            ...card,
            goal: 'general_fitness',
            goals: ['general_fitness'],
            daysPerWeek: program.daysPerWeek,
            cautionFlags: knees,
            focusAreas: [],
          };
          const week = composeProgramWeekForSelection(selection, program.programId);
          if (!week) {
            continue;
          }
          weeks += 1;
          for (const session of week.sessions) {
            for (const exercise of session.exercises) {
              if (runningOrLanding(exercise.exerciseName)) {
                offenders.push(`${program.programId} ${card.equipment}:${card.equipmentItems.join('+') || 'none'}: ${exercise.exerciseName}`);
              }
            }
          }
        }
      }
      assert.ok(weeks > 100, `composed only ${weeks} weeks`);
      assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} runs or landings kept for an avoided knee`);
    },
  },
  {
    name: 'recommendation fixes 10-06: the knee list names runs and landings, and leaves bikes, rows, walks and crunches alone',
    run() {
      const landings = [
        'Sprint 40m',
        'Sprint Interval (200m)',
        'Tempo Run Blocks',
        'Easy Run Blocks',
        'Stride Finishers',
        'Lateral Bound',
        'Treadmill HIIT (30s on / 30s off)',
        'Cone Drill (Pro Agility)',
        'Ladder Drill',
        'Hurdle Hops',
        'Running, Treadmill',
        'Jogging, Treadmill',
        'Wind Sprints',
        'Fast Skipping',
        'Quick Leap',
      ];
      for (const name of landings) {
        assert.equal(exerciseHitsCautionArea(name, 'knees'), true, name);
      }
      const notLandings = [
        'Bike HIIT (45s sprint / 15s rest)',
        'Air Bike (30s sprint)',
        'Stationary Bike (Easy Pace)',
        'Rowing Machine HIIT',
        'Walking, Treadmill',
        "Runner's Stretch",
        'Cable Crunch',
        'Bicycle Crunch',
        'Leg Curl',
        "Farmer's Walk",
      ];
      for (const name of notLandings) {
        assert.equal(exerciseHitsCautionArea(name, 'knees'), false, name);
      }
      // The ankle list is its own: a bike sprint still counts there as it did.
      assert.equal(exerciseHitsCautionArea('Bike HIIT (45s sprint / 15s rest)', 'ankles'), true);
    },
  },
  {
    // B14: Athletic Starter's page badge said 35 min, while its "Why it fits"
    // line worked the week out from the catalog's hand-written 50.
    name: 'recommendation fixes 10-06: a programme page quotes one session length, the badge and the "why it fits" line alike',
    run() {
      const { buildReadyProgramDetail, readyProgramSessionMinutes } = require('../../.test-dist/lib/programDetails.js');
      const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');
      const { buildFirstRunRecommendationReasons } = require('../../.test-dist/lib/firstRunSetup.js');
      const gymSelection = { ...DEFAULT_FIRST_RUN_SELECTION, ...gymCard(GYM_ALL), weeklyMinutes: null, availableDays: [] };
      const optionsFor = [{ availableEquipment: null }, { availableEquipment: [] }, { availableEquipment: [D, B, R] }];
      const disagreements = [];
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const options of optionsFor) {
          const minutes = readyProgramSessionMinutes(template, null, options);
          assert.equal(minutes, readyTemplateCardMinutes(template, options), template.id);
          const badge = buildReadyProgramDetail(template, undefined, null, [], null, 'en', false, false, options).badges[3];
          if (badge !== `${minutes} min`) {
            disagreements.push(`${template.id}: badge ${badge}, minutes ${minutes}`);
          }
        }
      }
      assert.deepEqual(disagreements, []);

      // The hunt's case, through the explanation the page prints.
      const starter = WORKOUT_TEMPLATES_V1.find((template) => template.id === 'tpl_athletic_starter_v1');
      const minutes = readyProgramSessionMinutes(starter, null, { availableEquipment: null });
      assert.notEqual(minutes, starter.estimatedSessionDuration, 'the hunt case no longer differs; pick another');
      const reasons = buildFirstRunRecommendationReasons(gymSelection, {
        projectedDaysPerWeek: starter.daysPerWeek,
        estimatedSessionDuration: minutes,
        language: 'en',
      }).join(' ');
      const weekly = Math.round(Math.max(60, starter.daysPerWeek * minutes) / 10) * 10;
      assert.match(reasons, new RegExp(`About ${weekly} min this week`));

      // And the page hands that explanation the page's own minutes, never the
      // catalog's hand-written number (renderWorkoutTab is not compiled here).
      const page = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'renderWorkoutTab.tsx'), 'utf8');
      assert.doesNotMatch(page, /estimatedSessionDuration: readyTemplate\.estimatedSessionDuration/);
      assert.match(
        page,
        /estimatedSessionDuration: readyProgramSessionMinutes\(readyTemplate, readyComposedWeek, readyProgramMinutesOptions\)/,
      );
      assert.match(page, /buildReadyProgramDetail\([\s\S]*?readyComposedWeek,[\s\S]*?readyProgramMinutesOptions,\s*\)/);
    },
  },
];
