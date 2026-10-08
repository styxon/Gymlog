const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(path.join(DIST, 'features', 'workout', 'customWorkoutAdapter.js'));
const {
  isMinutesLogEntry,
  LEGACY_MINUTES_PLAUSIBLE_MAX,
  readsAsMinutesByName,
} = require(path.join(DIST, 'lib', 'minutesExercises.js'));
const {
  IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID,
  MINUTES_MODE_MIGRATION_ID,
  moveOldCopiesToMinutesMode,
  undoImplausibleMinutesMode,
} = require(path.join(DIST, 'lib', 'minutesModeMigration.js'));
const { recordSetsOfLog } = require(path.join(DIST, 'lib', 'personalRecords.js'));

/**
 * The #330 trade-off (#bugs 2026-10-07): the library's cardio machines were
 * logged as repetitions until 2026-10-06, and #330 began reading every old
 * log and programme row on those names as minutes by the name alone. A rower
 * logged at 500 (metres) showed "500 min" and left the records; a programme
 * row of 3 x 500 asked for 500 minutes.
 *
 * The rule now: numbers written without a unit on a library cardio name are
 * minutes only when every one could be a bout of minutes
 * (LEGACY_MINUTES_PLAUSIBLE_MAX). The ready programmes' own rows were
 * prescribed in minutes all along and always are.
 */

function loadModule() {
  return loadAgainstFake(createFakeAsyncStorage(), (requireDist) => requireDist('storage/database.js'));
}

function row(id, name, trackingMode, repMin, orderIndex = 0) {
  return {
    id,
    workoutTemplateId: 't',
    workoutTemplateSessionId: 's',
    name,
    targetSets: 3,
    repMin,
    repMax: repMin,
    restSeconds: null,
    trackedDefault: true,
    orderIndex,
    libraryItemId: null,
    trackingMode,
    supersetGroup: null,
  };
}

function blob(exerciseTemplates, appliedMigrations) {
  return {
    workoutTemplates: [
      { id: 't', name: 'Own', sessions: [{ id: 's', name: 'A', orderIndex: 0, exerciseIds: exerciseTemplates.map((entry) => entry.id) }], origin: 'authored' },
    ],
    exerciseTemplates,
    ...(appliedMigrations ? { appliedMigrations } : {}),
  };
}

function playedModes(loaded) {
  const template = loaded.workoutTemplates[0];
  const sessions = template.sessions.map((session) => ({
    ...session,
    exercises: loaded.exerciseTemplates.filter((entry) => entry.workoutTemplateSessionId === session.id),
  }));
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, loaded.exerciseLibrary, 90);
  return runtime.sessions.flatMap((session) => session.exercises).map((entry) => entry.trackingMode);
}

const oldLog = (name, reps, extra = {}) => ({
  id: `l-${name}-${reps.join('-')}`,
  sessionId: 's1',
  exerciseTemplateId: null,
  exerciseNameSnapshot: name,
  weight: 0,
  repsPerSet: reps,
  tracked: true,
  orderIndex: 0,
  ...extra,
});

module.exports = [
  {
    name: 'legacy minutes: an old rower log of 500 is a count, of 20 is minutes; a log with its unit is minutes whatever the number',
    run() {
      assert.equal(isMinutesLogEntry(oldLog('Rowing, Stationary', [500])), false, '"500 min" on a rower');
      assert.equal(isMinutesLogEntry(oldLog('Rowing, Stationary', [20])), true);
      assert.equal(isMinutesLogEntry(oldLog('Elliptical Trainer', [30, 250])), false, 'one number past the line is enough');
      assert.equal(isMinutesLogEntry(oldLog('Elliptical Trainer', [LEGACY_MINUTES_PLAUSIBLE_MAX])), true);
      assert.equal(isMinutesLogEntry(oldLog('Elliptical Trainer', [LEGACY_MINUTES_PLAUSIBLE_MAX + 1])), false);
      // The sets win over repsPerSet when a log has both.
      assert.equal(
        isMinutesLogEntry(oldLog('Rowing, Stationary', [20], { sets: [{ orderIndex: 0, weight: 0, reps: 2000, kind: 'working', outcome: null }] })),
        false,
      );
      assert.equal(isMinutesLogEntry(oldLog('Rowing, Stationary', [500], { repsUnit: 'minutes' })), true);
      // A long ride or hike runs for hours, and nothing on it shows metres.
      assert.equal(isMinutesLogEntry(oldLog('Bicycling', [150])), true);
      assert.equal(isMinutesLogEntry(oldLog('Trail Running/Walking', [240])), true);
      assert.equal(isMinutesLogEntry(oldLog('Trail Running/Walking', [301])), false);
      // A ready programme's own minutes row was prescribed in minutes before the unit.
      assert.equal(isMinutesLogEntry(oldLog('Stairmaster (Moderate)', [200])), true);
      // Not a minutes name at all.
      assert.equal(isMinutesLogEntry(oldLog('Push-Up', [20])), false);
      assert.equal(readsAsMinutesByName(null, [20]), false);
    },
  },
  {
    name: 'legacy minutes: an old rower log of 500 offers the records the set it was saved as; 20 minutes offers none',
    run() {
      assert.deepEqual(recordSetsOfLog(oldLog('Rowing, Stationary', [500])), [{ weight: 0, reps: 500 }]);
      assert.deepEqual(recordSetsOfLog(oldLog('Rowing, Stationary', [20])), []);
    },
  },
  {
    name: 'legacy minutes: a programme row of 3 x 500 on a rower is played as the count the library gives it, 3 x 20 as minutes',
    run() {
      const database = loadModule();
      const loaded = database.normalizeDatabase(
        blob([row('a', 'Rowing, Stationary', null, 500), row('b', 'Rowing, Stationary', null, 20, 1), row('c', 'Stairmaster (Moderate)', null, 200, 2)]),
      );
      const [metres, minutes, stair] = playedModes(loaded);
      assert.notEqual(metres, 'duration_minutes', 'a rower at 500 asked for 500 minutes');
      assert.equal(minutes, 'duration_minutes');
      assert.equal(stair, 'duration_minutes', 'the ready programme row is minutes whatever its number');
    },
  },
  {
    name: 'legacy minutes: the 6.10 rule no longer moves a 3 x 500 rower to minutes, and still moves 3 x 20',
    run() {
      const out = moveOldCopiesToMinutesMode([
        row('a', 'Rowing, Stationary', 'reps_first', 500),
        row('b', 'Rowing, Stationary', 'reps_first', 20),
        row('c', 'Stairmaster (Moderate)', 'bodyweight', 200),
      ]);
      assert.deepEqual(out.map((entry) => entry.trackingMode), ['reps_first', 'duration_minutes', 'duration_minutes']);
    },
  },
  {
    name: 'legacy minutes: a database the 6.10 run already moved gets its 3 x 500 rower back, once, and nothing else changes',
    run() {
      const database = loadModule();
      const rows = [
        row('a', 'Rowing, Stationary', 'duration_minutes', 500),
        row('b', 'Rowing, Stationary', 'duration_minutes', 20, 1),
        row('c', 'Stairmaster (Moderate)', 'duration_minutes', 200, 2),
        row('d', 'Back Squat', 'load_and_reps', 500, 3),
        row('e', 'Bicycling', 'duration_minutes', 150, 4),
      ];
      const loaded = database.normalizeDatabase(blob(rows, [MINUTES_MODE_MIGRATION_ID]));
      assert.deepEqual(
        loaded.exerciseTemplates.map((entry) => entry.trackingMode),
        [null, 'duration_minutes', 'duration_minutes', 'load_and_reps', 'duration_minutes'],
      );
      assert.ok(loaded.appliedMigrations.includes(IMPLAUSIBLE_MINUTES_UNDO_MIGRATION_ID));
      assert.notEqual(playedModes(loaded)[0], 'duration_minutes');

      // Once: a minutes mode stored on purpose after the update stays.
      const later = {
        ...loaded,
        exerciseTemplates: loaded.exerciseTemplates.map((entry, index) => (index === 0 ? { ...entry, trackingMode: 'duration_minutes' } : entry)),
      };
      const reloaded = database.normalizeDatabase(JSON.parse(JSON.stringify({ ...later, exerciseLibrary: [] })));
      assert.equal(reloaded.exerciseTemplates[0].trackingMode, 'duration_minutes');

      // The pure rule hands back the very rows it leaves alone.
      const input = rows.slice(1);
      undoImplausibleMinutesMode(input).forEach((entry, index) => assert.equal(entry, input[index]));
    },
  },
  {
    name: 'legacy minutes: the exercise page takes its unit from the logs, not the name alone',
    run() {
      const source = fs.readFileSync(path.join(ROOT, 'src/screens/ExerciseDetailScreen.tsx'), 'utf8');
      assert.match(
        source,
        /const minutesLift = hasHistory \? logs\.some\(\(log\) => isMinutesLogEntry\(log\)\) : isMinutesExerciseName\(item\.name\);/,
      );
      assert.match(source, /count: bestMinutes/, 'the best is read from the minutes logs alone');
      assert.match(source, /\[\.\.\.unitLogs\]\.reverse\(\)/, 'the line plots the minutes logs alone');
      // The plan export's saved rows: their own module since round 2 (2026-10-08).
      const readouts = fs.readFileSync(path.join(ROOT, 'src/app/usePlanReadouts.tsx'), 'utf8');
      assert.match(readouts, /session\.exercises\.map\(csvExportRowOfSaved\)/);
      const exportRows = fs.readFileSync(path.join(ROOT, 'src/lib/programCsvExport.ts'), 'utf8');
      assert.match(exportRows, /readsAsMinutesByName\(exercise\.name, \[exercise\.repMin, exercise\.repMax\]\)/);
    },
  },
];
