const assert = require('node:assert/strict');

const { DEFAULT_FIRST_RUN_SELECTION, resolveFirstRunRecommendationWithTailoring } = require('../../.test-dist/lib/firstRunSetup.js');
const { describeGoalCoverage, rankProgrammesForLift } = require('../../.test-dist/lib/goalProgramme.js');
const { buildTailoringPreferences } = require('../../.test-dist/lib/tailoringFit.js');
const { readyTemplateCardMinutes } = require('../../.test-dist/lib/programmeMinutes.js');
const { resolveAvailableEquipment } = require('../../.test-dist/lib/equipmentExerciseFilter.js');
const { STRENGTH_GOAL_PRESETS } = require('../../.test-dist/lib/strengthGoalPresets.js');
const { GENERATED_EXERCISE_LIBRARY } = require('../../.test-dist/data/generatedExerciseLibrary.js');
const { WORKOUT_TEMPLATES_V1 } = require('../../.test-dist/features/workout/workoutCatalog.js');

/**
 * The domain work every cold start does before the native splash can hide,
 * held to a time budget.
 *
 * The phone's JavaScript engine (Hermes, release build) has no JIT, so a pass
 * that takes 2 ms here takes 50–100 ms there. Three PRs in a row (#322, #323,
 * #326) grew the recommender's pass from 29 to 57 ms here without anyone
 * noticing, and on the phone that was most of a cold start that went from
 * 4.7 to 5.2 s (#bugs, 2026-10-06; fixed in #328).
 *
 * Each budget is about ten times the slowest reader's pass on a laptop today
 * (2.4, 21 and 9 ms), so a slower CI runner passes and an accidental per-call
 * scan of the library — the class every one of those regressions belonged
 * to — does not. Before #328 the first pass took 54 ms. A failure here
 * means: profile the pass (node --cpu-prof) before raising the budget.
 *
 * Each pass is timed as the fastest of a few runs after one warm-up, so a
 * scheduler hiccup or a JIT compile does not fail the build.
 */
const libraryNames = GENERATED_EXERCISE_LIBRARY.map((entry) => entry.name);

/**
 * Three readers that take different branches: gym, home rack, bodyweight.
 * The second also asks for joint-friendly swaps, which the recommender's
 * tailoring pass resolves exercise by exercise.
 */
const READERS = [
  { goal: 'muscle', level: 'intermediate', daysPerWeek: 4, trainingEnvironment: 'full_gym', equipment: 'gym', equipmentItems: [], swaps: {} },
  {
    goal: 'strength',
    level: 'advanced',
    daysPerWeek: 3,
    trainingEnvironment: 'home_gym',
    equipment: 'home',
    equipmentItems: ['Barbell & plates', 'Squat rack', 'Bench'],
    swaps: { setupKneeFriendlySwaps: 'prioritize', setupShoulderFriendlySwaps: 'prefer', setupFreeWeightsPreference: 'prefer' },
  },
  { goal: 'muscle', level: 'beginner', daysPerWeek: 3, trainingEnvironment: 'bodyweight_only', equipment: 'home', equipmentItems: [], swaps: {} },
];

function fastestMs(work, runs = 5) {
  work();
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    work();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function assertWithin(label, ms, budgetMs) {
  assert.ok(ms <= budgetMs, `${label} took ${ms.toFixed(1)} ms, budget ${budgetMs} ms`);
}

module.exports = [
  {
    // useSetupReadings: the setup recommendation, resolved on every cold start.
    name: 'startup budget: the setup recommendation',
    run() {
      for (const reader of READERS) {
        const selection = {
          ...DEFAULT_FIRST_RUN_SELECTION,
          ...reader,
          goals: [reader.goal],
          availableDays: [],
          scheduleMode: 'app_managed',
        };
        // As useSetupReadings builds it, from the stored preferences.
        const tailoring = buildTailoringPreferences({ setupEquipment: reader.equipment, ...reader.swaps });
        const ms = fastestMs(() => resolveFirstRunRecommendationWithTailoring(selection, tailoring, 'fi'));
        assertWithin(`recommendation for a ${reader.level} ${reader.trainingEnvironment} reader`, ms, 25);
      }
    },
  },
  {
    // useGoalFlow: goalProgrammeSuggestions, for a reader with no active
    // programme and for one running a catalog programme.
    name: 'startup budget: a programme suggestion for every strength goal',
    run() {
      for (const active of [[], WORKOUT_TEMPLATES_V1.slice(0, 1)]) {
        const ms = fastestMs(() => {
          for (const preset of STRENGTH_GOAL_PRESETS) {
            const lift = preset.exerciseName;
            const coverage = describeGoalCoverage({ exerciseName: lift, targetKg: 1, createdAt: '' }, active, libraryNames);
            if (coverage.status === 'covered') {
              rankProgrammesForLift(active, lift, { libraryNames });
              continue;
            }
            rankProgrammesForLift(WORKOUT_TEMPLATES_V1, lift, {
              preferredOrder: [],
              libraryNames,
              reader: { level: 'intermediate', daysPerWeek: 4 },
            });
          }
        });
        assertWithin(`goal programme suggestions with ${active.length} active programme(s)`, ms, 200);
      }
    },
  },
  {
    // useProgramsCatalog: programsCatalogItems, a minutes figure per catalog card.
    name: 'startup budget: the minutes on every catalog card',
    run() {
      for (const reader of READERS) {
        const options = {
          availableEquipment: resolveAvailableEquipment({
            trainingEnvironment: reader.trainingEnvironment,
            equipmentItems: reader.equipmentItems,
          }),
        };
        const ms = fastestMs(() => {
          for (const template of WORKOUT_TEMPLATES_V1) {
            readyTemplateCardMinutes(template, options);
          }
        });
        assertWithin(`card minutes for a ${reader.trainingEnvironment} reader`, ms, 100);
      }
    },
  },
];
