const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { DEFAULT_FIRST_RUN_SELECTION, resolveFirstRunRecommendationWithTailoring } = require('../../src/lib/firstRunSetup');
const { describeGoalCoverage, rankProgrammesForLift } = require('../../src/lib/goalProgramme');
const { buildTailoringPreferences } = require('../../src/lib/tailoringFit');
const { readyTemplateCardMinutes } = require('../../src/lib/programmeMinutes');
const { resolveAvailableEquipment } = require('../../src/lib/equipmentExerciseFilter');
const { STRENGTH_GOAL_PRESETS } = require('../../src/lib/strengthGoalPresets');
const { GENERATED_EXERCISE_LIBRARY } = require('../../src/data/generatedExerciseLibrary');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');

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

/**
 * Loads every module of src/ in a fresh Node and prints each one's own
 * evaluation time — its top-level code, without the modules it requires — as
 * JSON lines, slowest first.
 *
 * The child runs with the TypeScript hook (scripts/registerTs.cjs). Every
 * file is transpiled into the hook's memory cache BEFORE the timer is
 * patched in, so the walk measures evaluation only: transpile time is
 * excluded, and the child asserts that nothing was transpiled during it.
 */
const REGISTER_TS = path.resolve(__dirname, '../../scripts/registerTs.cjs');

const MODULE_SELF_TIMES = `
const Module = require('module');
const fs = require('fs');
const path = require('path');
const registerTs = require(process.argv[2]);
const root = process.argv[1];
const sources = [];
(function collect(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) collect(file);
    else if (/[.]tsx?$/.test(file) && !file.endsWith('.d.ts')) sources.push(file);
  }
})(root);
registerTs.warm(sources);
const transpiledBefore = registerTs.stats.transpiled;
const compile = Module.prototype._compile;
const stack = [];
const self = new Map();
Module.prototype._compile = function (content, filename) {
  const start = process.hrtime.bigint();
  stack.push(0n);
  try {
    return compile.call(this, content, filename);
  } finally {
    const total = process.hrtime.bigint() - start;
    const children = stack.pop();
    if (stack.length) stack[stack.length - 1] += total;
    self.set(filename, Number(total - children) / 1e6);
  }
};
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      try { require(file); } catch {}
    }
  }
})(root);
if (registerTs.stats.transpiled !== transpiledBefore) {
  throw new Error('transpile time leaked into the timed section');
}
for (const [file, ms] of [...self].filter(([file]) => file.startsWith(root)).sort((a, b) => b[1] - a[1])) {
  console.log(JSON.stringify({ file: path.relative(root, file), ms }));
}
`;

module.exports = [
  {
    /*
     * The app's modules are all evaluated before the first render, Hermes
     * without a JIT, so a table built at the top of a module is paid on every
     * cold start whether its screen is opened or not. The crisis filter's
     * rows once multiplied out to 195,800 phrases there: 420 ms in Node and
     * eight seconds on the phone, a cold start of 9.4 s (#bugs, 2026-10-08).
     *
     * The slowest module today takes 30–60 ms of its own here, the spread
     * being a garbage collection that lands on whichever module is loading,
     * so each module counts at its fastest of three fresh loads. A failure
     * means a module does work when it loads: build it on first use, or
     * without the multiplication.
     */
    name: 'startup budget: no module does heavy work when it loads',
    run() {
      const root = path.resolve(__dirname, '../../src');
      const fastest = new Map();
      for (let load = 0; load < 3; load += 1) {
        // A module that leaves a timer running at load would keep the child
        // alive; the timeout fails the suite instead of hanging it.
        const result = spawnSync(process.execPath, ['-r', REGISTER_TS, '-e', MODULE_SELF_TIMES, root, REGISTER_TS], { encoding: 'utf8', timeout: 60_000 });
        assert.equal(result.status, 0, result.error ? `module load child: ${result.error.message}` : result.stderr);
        for (const { file, ms } of result.stdout.trim().split('\n').map((line) => JSON.parse(line))) {
          fastest.set(file, Math.min(fastest.get(file) ?? Infinity, ms));
        }
      }
      assert.ok(fastest.size > 100, `only ${fastest.size} modules loaded`);
      for (const [file, ms] of fastest) {
        assertWithin(`loading ${file}`, ms, 150);
      }
    },
  },
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
  {
    /*
     * The SQLite mirror's modules are part of the app bundle (so every one is
     * evaluated before the first render), but none may open a database or load
     * a SQL engine when it is evaluated: the engine is opened by start(), after
     * the first render, and the native module is required inside the driver's
     * open() and nowhere else.
     */
    name: 'startup budget: loading the SQLite mirror modules opens no database and loads no SQL engine',
    run() {
      const nodeFs = require('node:fs');
      const Module = require('node:module');
      const dir = path.resolve(__dirname, '../../src/storage/sqlite');
      const files = nodeFs.readdirSync(dir).filter((name) => name.endsWith('.ts'));
      assert.ok(files.length >= 6, 'the mirror modules are where this expects them');

      // 1. Nothing at the top of a file imports the native module or calls open().
      for (const name of files) {
        const text = nodeFs.readFileSync(path.join(dir, name), 'utf8');
        assert.doesNotMatch(text, /^import(?!\s+type)[^\n]*['"]expo-sqlite['"]/m, `${name} imports expo-sqlite at the top`);
        assert.doesNotMatch(text, /^(?:const|let|var)\s[^\n]*(?:require\(['"]expo-sqlite|\.open\(|openDatabase)/m, `${name} opens a database at the top`);
      }

      // 2. Evaluating them requests no SQL engine.
      const asked = [];
      const load = Module._load;
      Module._load = function (request, ...rest) {
        if (request === 'expo-sqlite' || request === 'node:sqlite' || request === 'sqlite') {
          asked.push(request);
        }
        return load.call(this, request, ...rest);
      };
      try {
        for (const name of files) {
          const file = path.join(dir, name);
          delete require.cache[file];
          require(file);
        }
      } finally {
        Module._load = load;
      }
      assert.deepEqual(asked, []);
    },
  },
];
