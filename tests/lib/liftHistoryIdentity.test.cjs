const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getExerciseProgressForName,
  getExerciseProgressSignal,
  getLiftProgress,
  getTrackedExerciseProgress,
} = require('../../.test-dist/lib/progression.js');
const { isSameLift, isSameLiftAsLibraryRow } = require('../../.test-dist/lib/goalProgramme.js');
const { liftGroupOf } = require('../../.test-dist/lib/liftIdentity.js');
const { findFiledLibraryIndex, findGuidedLibraryIndex } = require('../../.test-dist/lib/guidedPlayer.js');
const { exerciseNameLabel } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { STRENGTH_GOAL_PRESETS } = require('../../.test-dist/lib/strengthGoalPresets.js');
const library = Object.values(require('../../.test-dist/data/generatedExerciseLibrary.js'))[0];

const libraryNames = library.map((item) => item.name);
// The matcher the goal flow and the target bars already read the log with.
const sameLift = (loggedName, liftName) => isSameLift(loggedName, liftName, libraryNames);
// The same rule narrowed to one library row, for an exercise page.
const sameLibraryRow = (loggedName, rowName) => isSameLiftAsLibraryRow(loggedName, rowName, libraryNames);

const BENCH_LIBRARY = 'Barbell Bench Press - Medium Grip';
const SQUAT_LIBRARY = 'Barbell Squat';

function set(weight, reps) {
  return { orderIndex: 0, weight, reps, kind: 'working', outcome: null, status: 'completed' };
}

/**
 * The emulator's install on 2026-09-13, in miniature: an onboarding-built
 * programme whose exercises carry the catalogue's names and no library id, and
 * sessions logged against those template exercises.
 */
function onboardingDatabase({ goals = [] } = {}) {
  const tpl = 'onboarding_tpl_4_day_upper_lower_v1_1';
  const exerciseTemplates = [
    { id: `${tpl}_upper_a_bench_press`, name: 'Bench Press', libraryItemId: null },
    { id: `${tpl}_lower_a_back_squat`, name: 'Back Squat', libraryItemId: null },
    { id: `${tpl}_lower_b_front_squat`, name: 'Front Squat', libraryItemId: null },
    { id: `${tpl}_upper_b_incline_bench_press`, name: 'Incline Bench Press', libraryItemId: null },
  ];
  const benchTop = [70, 72.5, 75, 75, 77.5, 80];
  const squatTop = [95, 100, 100, 105, 107.5, 110];
  const workoutSessions = [];
  const exerciseLogs = [];
  for (let index = 0; index < 6; index += 1) {
    const sessionId = `s${index}`;
    workoutSessions.push({
      id: sessionId,
      performedAt: new Date(Date.UTC(2026, 7, 20 + index * 4, 9)).toISOString(),
      workoutNameSnapshot: index % 2 === 0 ? 'Upper A' : 'Lower A',
    });
    exerciseLogs.push({
      id: `bench-${index}`,
      sessionId,
      exerciseTemplateId: `${tpl}_upper_a_bench_press`,
      exerciseNameSnapshot: 'Bench Press',
      weight: benchTop[index],
      repsPerSet: [9, 9],
      sets: [set(benchTop[index] - 5, 9), set(benchTop[index], 9)],
      tracked: true,
      orderIndex: 0,
    });
    exerciseLogs.push({
      id: `squat-${index}`,
      sessionId,
      exerciseTemplateId: `${tpl}_lower_a_back_squat`,
      exerciseNameSnapshot: 'Back Squat',
      weight: squatTop[index],
      repsPerSet: [5, 5],
      sets: [set(squatTop[index], 5), set(squatTop[index], 5)],
      tracked: true,
      orderIndex: 1,
    });
  }
  // Neighbours that share words with the two lifts and are not them.
  exerciseLogs.push(
    {
      id: 'front-0',
      sessionId: 's5',
      exerciseTemplateId: `${tpl}_lower_b_front_squat`,
      exerciseNameSnapshot: 'Front Squat',
      weight: 140,
      repsPerSet: [5],
      sets: [set(140, 5)],
      tracked: true,
      orderIndex: 2,
    },
    {
      id: 'incline-0',
      sessionId: 's4',
      exerciseTemplateId: `${tpl}_upper_b_incline_bench_press`,
      exerciseNameSnapshot: 'Incline Bench Press',
      weight: 120,
      repsPerSet: [8],
      sets: [set(120, 8)],
      tracked: true,
      orderIndex: 2,
    },
  );
  return {
    exerciseTemplates,
    workoutSessions,
    exerciseLogs,
    preferences: { strengthGoals: goals },
  };
}

module.exports = [
  {
    name: 'the library bench press finds the history logged as the catalogue "Bench Press"',
    run() {
      // The screen's identity: the row the library opens is the database's
      // pedantic name, and the reader sees it as "Bench Press" / "Penkkipunnerrus".
      assert.ok(libraryNames.includes(BENCH_LIBRARY));
      assert.equal(exerciseNameLabel('en', BENCH_LIBRARY), 'Bench Press');
      assert.equal(exerciseNameLabel('fi', BENCH_LIBRARY), 'Penkkipunnerrus');

      const database = onboardingDatabase();
      // What the detail screen read before: no log is spelled like the row.
      assert.equal(getExerciseProgressForName(database, BENCH_LIBRARY).logs.length, 0);

      const history = getExerciseProgressForName(database, BENCH_LIBRARY, sameLibraryRow);
      assert.equal(history.logs.length, 6, 'six bench sessions are the library bench press');
      assert.equal(history.latestWeight, 80);
      assert.equal(history.latestReps.split(',')[0], '9');
      assert.equal(history.bestWeight, 80);
      assert.ok(
        history.logs.every((log) => log.exerciseNameSnapshot === 'Bench Press'),
        'the incline bench is not the bench',
      );
    },
  },
  {
    name: 'Back Squat logs are the Barbell Squat (Takakyykky) because the lift groups say so',
    run() {
      // The evidence, from the app's own data rather than a new alias:
      // - liftIdentity puts "Back Squat" and "Barbell Squat" in one closed group;
      // - the alias table files "Back Squat" on the row "Barbell Full Squat",
      //   and the plain-name table reads that row as "Back Squat";
      // - the squat group names one library row, "Barbell Squat";
      // - the Finnish table calls all three "Takakyykky".
      assert.notEqual(liftGroupOf('Back Squat'), null);
      assert.equal(liftGroupOf('Back Squat'), liftGroupOf(SQUAT_LIBRARY));
      assert.equal(libraryNames[findFiledLibraryIndex('Back Squat', libraryNames)], 'Barbell Full Squat');
      assert.equal(exerciseNameLabel('en', 'Barbell Full Squat'), 'Back Squat');
      assert.equal(exerciseNameLabel('fi', 'Back Squat'), 'Takakyykky');
      assert.equal(exerciseNameLabel('fi', SQUAT_LIBRARY), 'Takakyykky');
      assert.equal(exerciseNameLabel('fi', 'Barbell Full Squat'), 'Takakyykky');
      assert.ok(STRENGTH_GOAL_PRESETS.some((preset) => preset.exerciseName === SQUAT_LIBRARY));

      const history = getExerciseProgressForName(onboardingDatabase(), SQUAT_LIBRARY, sameLibraryRow);
      assert.equal(history.logs.length, 6);
      assert.equal(history.bestWeight, 110, 'the 140 kg front squat must not become the squat best');
      // Both library rows the reader sees as "Takakyykky" carry it.
      assert.equal(getExerciseProgressForName(onboardingDatabase(), 'Barbell Full Squat', sameLibraryRow).logs.length, 6);
    },
  },
  {
    name: 'a lift that shares words with another is still a different lift',
    run() {
      const database = onboardingDatabase();
      const front = getExerciseProgressForName(database, 'Front Barbell Squat', sameLibraryRow);
      assert.deepEqual(
        front.logs.map((log) => log.exerciseNameSnapshot),
        ['Front Squat'],
        'the back squat is not the front squat',
      );
      const incline = getExerciseProgressForName(database, 'Barbell Incline Bench Press - Medium Grip', sameLibraryRow);
      assert.deepEqual(
        incline.logs.map((log) => log.exerciseNameSnapshot),
        ['Incline Bench Press'],
        'the flat bench is not the incline bench',
      );
      assert.equal(getExerciseProgressForName(database, 'Romanian Deadlift', sameLibraryRow).logs.length, 0);
      assert.equal(getExerciseProgressForName(database, 'Dumbbell Bench Press', sameLibraryRow).logs.length, 0);
    },
  },
  {
    /**
     * A target folds variations in by decision — a trap-bar pull fills a
     * deadlift target. A library page is one row, and the library files sumo,
     * trap bar and deficit pulls as rows of their own. Found by /code-review
     * on this change: the target matcher on the page put 200 kg of trap-bar
     * pulls on the sumo deadlift's page.
     */
    name: 'a library page keeps a variation the library files as its own row off its history',
    run() {
      const database = { exerciseTemplates: [], workoutSessions: [], exerciseLogs: [], preferences: { strengthGoals: [] } };
      const log = (id, name, kg, day) => {
        database.workoutSessions.push({ id, performedAt: `2026-09-${String(day).padStart(2, '0')}T09:00:00.000Z`, workoutNameSnapshot: 'Pull' });
        database.exerciseLogs.push({
          id,
          sessionId: id,
          exerciseTemplateId: null,
          exerciseNameSnapshot: name,
          weight: kg,
          repsPerSet: [3],
          sets: [set(kg, 3)],
          tracked: true,
          orderIndex: 0,
        });
      };
      log('conventional', 'Conventional Deadlift', 180, 1);
      log('generic', 'Deadlift', 185, 2);
      log('trap', 'Trap Bar Deadlift', 200, 3);
      log('sumo', 'Sumo Deadlift', 170, 4);
      // A partial pull, which the deadlift group no longer folds in: it
      // starts above the knee and takes 20–40 % more weight, so counting it
      // handed the reader a best they never pulled from the floor
      // (2026-09-16).
      log('rack', 'Rack Pull', 240, 5);

      const pageIds = (row) => getExerciseProgressForName(database, row, sameLibraryRow).logs.map((entry) => entry.id).sort();
      assert.deepEqual(pageIds('Barbell Deadlift'), ['conventional', 'generic']);
      assert.deepEqual(pageIds('Sumo Deadlift'), ['sumo']);
      assert.deepEqual(pageIds('Trap Bar Deadlift'), ['trap']);
      assert.deepEqual(pageIds('Deficit Deadlift'), []);
      assert.deepEqual(pageIds('Rack Pulls'), [], 'the rows the group names are not the plural row either');

      // And the narrowing never widens the target's rule.
      const tracked = getTrackedExerciseProgress(database);
      assert.deepEqual(
        getLiftProgress('Barbell Deadlift', tracked, sameLift).logs.map((entry) => entry.id).sort(),
        ['conventional', 'generic', 'sumo', 'trap'],
        'the deadlift TARGET still counts every pull liftIdentity folds in — and only those',
      );
    },
  },
  {
    name: 'a library page never takes a history by substring',
    run() {
      // Substrings are how the guided player finds a photo, not how two lifts
      // become one. Found by /code-review on this change, each against the
      // real library.
      const substringOnly = [
        // "Barbell Bench Press" was the first example until the catalog audit
        // (2026-10-06) gave it its alias; the leg curl's alias is demo-only, so
        // the photo moved and the page still takes nothing from it.
        ['Chest Press', 'Cable Chest Press'],
        ['Squat', 'Box Squat'],
        ['Pull Up', 'Weighted Pull Ups'],
        ['Push Up', 'Push Up to Side Plank'],
        ['Lunge', 'Lunge Sprint'],
        ['Leg Curl', 'Lying Leg Curls'],
        ['Calf Raise', 'Seated Calf Raise'],
        ['Shoulder Press', 'Cable Shoulder Press'],
      ];
      for (const [logged, row] of substringOnly) {
        assert.equal(libraryNames[findGuidedLibraryIndex(logged, libraryNames)], row, `${logged} stopped reaching ${row} — pick a new example`);
        assert.equal(findFiledLibraryIndex(logged, libraryNames), null);
        assert.equal(sameLibraryRow(logged, row), false, `${logged} is history on the ${row} page`);
      }

      // What a page does take: its own title, and the alias table's filing.
      assert.equal(sameLibraryRow('Lat Pulldown', 'Wide-Grip Lat Pulldown'), true, 'the page is titled "Lat Pulldown"');
      assert.equal(sameLibraryRow('Hip Thrust', 'Barbell Hip Thrust'), true, 'the page is titled "Hip Thrust"');
      assert.equal(sameLibraryRow('Pendlay Row', 'Bent Over Barbell Row'), true, 'filed there by the alias table');
    },
  },
  {
    /**
     * The catalogue prescribes "Barbell Bench Press" (workoutCatalog.ts). The
     * bench group has it; the library's bench row, "Barbell Bench Press -
     * Medium Grip", is in no group, so the only bridge was a substring — and
     * the substring found the decline. The row's plain name "Bench Press" is
     * in the group, which is the hand-written same-lift data that joins them.
     */
    name: 'the catalogue "Barbell Bench Press" is the bench press, on its page and in its target',
    run() {
      assert.equal(sameLift('Barbell Bench Press', BENCH_LIBRARY), true, 'the bench target misses "Barbell Bench Press"');
      assert.equal(sameLibraryRow('Barbell Bench Press', BENCH_LIBRARY), true, 'the bench page misses "Barbell Bench Press"');
      // The group's competition and paused benches are filed on a row of their
      // own, so they fill the target and stay off the medium-grip page.
      assert.equal(sameLift('Competition Bench Press', BENCH_LIBRARY), true);
      assert.equal(sameLibraryRow('Competition Bench Press', BENCH_LIBRARY), false);
      assert.equal(sameLibraryRow('Competition Bench Press', 'Bench Press - Powerlifting'), true);
      // Still not the incline or the dumbbell bench, on the page or as a target.
      for (const other of ['Barbell Incline Bench Press - Medium Grip', 'Dumbbell Bench Press']) {
        assert.equal(sameLift('Barbell Bench Press', other), false, `${other} is the bench target now`);
        assert.equal(sameLibraryRow('Barbell Bench Press', other), false, `${other} page takes the bench now`);
      }
    },
  },
  {
    name: 'a squat target reads the Back Squat log instead of an empty row named after the target',
    run() {
      const database = onboardingDatabase({
        goals: [{ exerciseName: SQUAT_LIBRARY, targetKg: 120, createdAt: '2026-09-13T10:00:00.000Z' }],
      });
      const tracked = getTrackedExerciseProgress(database);

      // The shape of the bug: the target seeds a summary under its own name,
      // and the log lives under another. Joining the row on that name opened
      // "Alkuvaihe –" and a sheet with no sets.
      const seeded = tracked.find((summary) => summary.key === 'barbell squat');
      assert.equal(seeded.logs.length, 0);
      assert.equal(getExerciseProgressSignal(seeded).kind, 'starting');

      const row = getLiftProgress(SQUAT_LIBRARY, tracked, sameLift);
      assert.equal(row.key, 'barbell squat', 'the row keeps the target lift as its key');
      assert.equal(row.name, SQUAT_LIBRARY);
      assert.equal(row.logs.length, 6);
      assert.equal(row.latestWeight, 110);
      assert.equal(row.bestWeight, 110);
      assert.notEqual(getExerciseProgressSignal(row).kind, 'starting');

      // And the bench row, which has no target, finds its own six sessions.
      assert.equal(getLiftProgress(BENCH_LIBRARY, tracked, sameLift).logs.length, 6);
      // The front squat row takes the front squat and nothing else.
      assert.deepEqual(
        getLiftProgress('Front Barbell Squat', tracked, sameLift).logs.map((log) => log.id),
        ['front-0'],
      );
      // A lift never logged and never aimed at has no row to fill.
      assert.equal(getLiftProgress('Hack Squat', tracked, sameLift), null);
    },
  },
  {
    name: 'a lift logged under two spellings is one row with every session in it',
    run() {
      const database = onboardingDatabase();
      // A custom programme built from the library writes the library's name.
      database.workoutSessions.push({ id: 'lib', performedAt: '2026-09-12T09:00:00.000Z', workoutNameSnapshot: 'Mine' });
      database.exerciseLogs.push({
        id: 'library-squat',
        sessionId: 'lib',
        exerciseTemplateId: null,
        exerciseNameSnapshot: SQUAT_LIBRARY,
        weight: 112.5,
        repsPerSet: [3],
        sets: [set(112.5, 3)],
        tracked: true,
        orderIndex: 0,
      });
      const tracked = getTrackedExerciseProgress(database);
      const row = getLiftProgress(SQUAT_LIBRARY, tracked, sameLift);
      assert.equal(row.logs.length, 7);
      assert.equal(row.latestLog.id, 'library-squat', 'newest first across both spellings');
      assert.equal(row.bestWeight, 112.5);
    },
  },
  {
    name: 'the exercise detail and the Progress target rows read the log through the shared matcher',
    run() {
      const app = require('../helpers/appWiringSource.cjs').readAppWiring();

      // The matchers are bound to the library once, not re-spelled per screen.
      assert.match(
        app,
        /const sameLift = useCallback<SameLiftMatcher>\(\s*\(loggedName, liftName\) => isSameLift\(loggedName, liftName, libraryNames\)/,
        'the app no longer binds isSameLift to the library once',
      );
      assert.match(
        app,
        /const sameLibraryRow = useCallback<SameLiftMatcher>\(\s*\(loggedName, rowName\) => isSameLiftAsLibraryRow\(loggedName, rowName, libraryNames\)/,
        'the app no longer binds the library-row matcher once',
      );
      assert.match(
        app,
        /history=\{getExerciseProgressForName\(database, exercise\.name, sameLibraryRow\)\}/,
        'the exercise detail reads its history by exact name, or by the target rule, again',
      );
      assert.match(
        app,
        /getLiftProgress\(lift\.exerciseName, trackedProgress, sameLift\)/,
        'the Progress target rows join the log by exact name again',
      );
      assert.match(app, /summaries=\{targetLiftProgress\}/, 'the Progress rows are fed the unmerged summaries again');
      assert.match(
        app,
        /liftSetLogSources=\{targetLiftSources\}/,
        'a target row opens a set log built from something other than its own merged lift',
      );

      // The screen: a target row opens from the lift sources, and only there.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ProgressScreen.tsx'),
        'utf8',
      );
      assert.match(screen, /const pool = setLogTarget\.fromLift \? liftSetLogSources : setLogSources;/);
      const liftOpens = screen.match(/setSetLogTarget\(\{ key: summary\.key, fromLift: true \}\)/g) ?? [];
      assert.equal(liftOpens.length, 2, 'the target row and its chart link both open the merged lift');
      assert.doesNotMatch(screen, /setSetLogTarget\(\{ key: summary\.key, fromLift: false \}\)/);
    },
  },
  {
    name: 'the exercise detail header spacer is not drawn as an empty button',
    run() {
      // The star went in #40 and its Pressable became a spacer that kept the
      // button's surface and border: an empty square at the top right.
      const screen = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'screens', 'ExerciseDetailScreen.tsx'),
        'utf8',
      );
      assert.doesNotMatch(screen, /<View style=\{styles\.iconButton\} \/>/);
      assert.match(screen, /<View style=\{styles\.iconSpacer\} \/>/);
      const spacer = screen.match(/iconSpacer: \{([^}]*)\}/);
      assert.ok(spacer, 'the spacer style is missing');
      assert.doesNotMatch(spacer[1], /backgroundColor|borderWidth/, 'the spacer wears chrome again');
    },
  },
  {
    name: 'a rack pull is not a deadlift, and cannot become one’s personal best',
    run() {
      // Partials start above the knee and move a fraction of the range, so
      // 240 kg off pins is not a 240 kg deadlift. Sumo and trap bar stay in
      // by decision: those are the lift, from another stance or handle.
      assert.equal(liftGroupOf('Rack Pull'), null);
      assert.equal(liftGroupOf('Rack Pulls'), null);
      assert.equal(liftGroupOf('Block Pull'), null);
      assert.equal(liftGroupOf('Sumo Deadlift'), liftGroupOf('Deadlift'));
      assert.equal(liftGroupOf('Trap Bar Deadlift'), liftGroupOf('Deadlift'));
      // The deficit stays too: same full pull, from a harder position, and it
      // loads less — it cannot inflate anything.
      assert.equal(liftGroupOf('Deficit Deadlift'), liftGroupOf('Deadlift'));
    },
  },
];
