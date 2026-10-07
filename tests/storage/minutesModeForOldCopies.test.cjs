const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { WORKOUT_TEMPLATES_V1 } = require(path.join(DIST, 'features', 'workout', 'workoutCatalog.js'));
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(path.join(DIST, 'features', 'workout', 'customWorkoutAdapter.js'));
const { MINUTES_EXERCISE_NAME_LIST } = require(path.join(DIST, 'lib', 'minutesExercises.js'));
const { MINUTES_MODE_MIGRATION_ID, moveOldCopiesToMinutesMode } = require(path.join(DIST, 'lib', 'minutesModeMigration.js'));

/**
 * A copy of a ready programme made before steady cardio was logged in minutes
 * keeps asking for repetitions: customWorkoutAdapter.getTrackingMode returns
 * the stored mode first, and the old catalogue stored 'bodyweight' for the
 * stair machine and the easy bike, 'reps_first' for the run blocks. Read from
 * origin/main's catalogues, written here by hand because that is what a phone
 * holds. The loader moves them to minutes once per database.
 */

const OLD_CATALOGUE_MODE = {
  'Stairmaster (Moderate)': 'bodyweight',
  'Stationary Bike (Easy Pace)': 'bodyweight',
  'Easy Run Blocks': 'reps_first',
  'Tempo Run Blocks': 'reps_first',
};

function loadModule() {
  const fake = createFakeAsyncStorage();
  return loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
}

function row(id, name, trackingMode, extra = {}) {
  return {
    id,
    workoutTemplateId: 't',
    workoutTemplateSessionId: 's',
    name,
    targetSets: extra.targetSets ?? 1,
    repMin: extra.repMin ?? 20,
    repMax: extra.repMax ?? 20,
    restSeconds: null,
    trackedDefault: true,
    orderIndex: extra.orderIndex ?? 0,
    libraryItemId: null,
    trackingMode,
    supersetGroup: null,
  };
}

function blob(exerciseTemplates) {
  return {
    workoutTemplates: [
      { id: 't', name: 'Old copy', sessions: [{ id: 's', name: 'A', orderIndex: 0, exerciseIds: exerciseTemplates.map((entry) => entry.id) }], origin: 'authored' },
    ],
    exerciseTemplates,
  };
}

/** The mode each lift of the stored programme is played in. */
function playedModes(loaded) {
  const template = loaded.workoutTemplates[0];
  const sessions = template.sessions.map((session) => ({
    ...session,
    exercises: loaded.exerciseTemplates.filter((entry) => entry.workoutTemplateSessionId === session.id),
  }));
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, loaded.exerciseLibrary, 90);
  return runtime.sessions.flatMap((session) => session.exercises).map((entry) => [entry.exerciseName, entry.trackingMode]);
}

module.exports = [
  {
    name: 'minutes mode for old copies: the four programme rows stored in the old catalogue modes load as minutes and are played as minutes',
    run() {
      const database = loadModule();
      const rows = Object.entries(OLD_CATALOGUE_MODE).map(([name, mode], index) => row(`e${index}`, name, mode, { orderIndex: index }));
      const loaded = database.normalizeDatabase(blob(rows));
      assert.deepEqual(
        loaded.exerciseTemplates.map((entry) => [entry.name, entry.trackingMode]),
        Object.keys(OLD_CATALOGUE_MODE).map((name) => [name, 'duration_minutes']),
      );
      assert.deepEqual(
        playedModes(loaded),
        Object.keys(OLD_CATALOGUE_MODE).map((name) => [name, 'duration_minutes']),
      );
      assert.ok(loaded.appliedMigrations.includes(MINUTES_MODE_MIGRATION_ID));
    },
  },
  {
    name: 'minutes mode for old copies: every name on the minutes list moves, whichever of the two old modes a writer stored for it',
    run() {
      const database = loadModule();
      const rows = MINUTES_EXERCISE_NAME_LIST.flatMap((name, index) => [
        row(`b${index}`, name, 'bodyweight', { orderIndex: index * 2 }),
        row(`r${index}`, name, 'reps_first', { orderIndex: index * 2 + 1 }),
      ]);
      const loaded = database.normalizeDatabase(blob(rows));
      assert.ok(loaded.exerciseTemplates.length > 20);
      for (const entry of loaded.exerciseTemplates) {
        assert.equal(entry.trackingMode, 'duration_minutes', entry.name);
      }
    },
  },
  {
    name: 'minutes mode for old copies: nothing else moves - other names, holds, load modes, a stored null and a stored minutes row stay as they are',
    run() {
      const database = loadModule();
      const rows = [
        row('a', 'Stairmaster (Moderate)', null),
        row('b', 'Stairmaster (Moderate)', 'duration_minutes', { orderIndex: 1 }),
        row('c', 'Stairmaster (Moderate)', 'load_and_reps', { orderIndex: 2 }),
        row('d', 'Plank', 'hold', { orderIndex: 3 }),
        row('e', 'Push-Up', 'bodyweight', { orderIndex: 4 }),
        row('f', 'Barbell Curl', 'reps_first', { orderIndex: 5 }),
        row('g', 'Bike HIIT (45s sprint / 15s rest)', 'reps_first', { orderIndex: 6 }),
      ];
      const loaded = database.normalizeDatabase(blob(rows));
      assert.deepEqual(
        loaded.exerciseTemplates.map((entry) => entry.trackingMode),
        [null, 'duration_minutes', 'load_and_reps', 'hold', 'bodyweight', 'reps_first', 'reps_first'],
      );
      // The pure rule hands back the very same rows it did not change.
      const input = rows.slice(1);
      const out = moveOldCopiesToMinutesMode(input);
      out.forEach((entry, index) => assert.equal(entry, input[index]));
    },
  },
  {
    name: 'minutes mode for old copies: once per database - a mode a writer stores after the update is not undone, and the numbers are kept',
    run() {
      const database = loadModule();
      const first = database.normalizeDatabase(blob([row('a', 'Easy Run Blocks', 'reps_first', { targetSets: 4, repMin: 5, repMax: 5 })]));
      assert.equal(first.exerciseTemplates[0].trackingMode, 'duration_minutes');
      // 4 x 5 reads the same as minutes, as the ready row prescribes it.
      assert.deepEqual([first.exerciseTemplates[0].targetSets, first.exerciseTemplates[0].repMin, first.exerciseTemplates[0].repMax], [4, 5, 5]);
      assert.deepEqual(database.normalizeDatabase(first), first, 'normalized twice is normalized once');
      const later = {
        ...first,
        exerciseTemplates: first.exerciseTemplates.map((entry) => ({ ...entry, trackingMode: 'reps_first' })),
      };
      const reloaded = database.normalizeDatabase(JSON.parse(JSON.stringify({ ...later, exerciseLibrary: [] })));
      assert.equal(reloaded.exerciseTemplates[0].trackingMode, 'reps_first');
    },
  },
  {
    name: 'minutes mode for old copies: a copy of each ready programme with its old catalogue modes plays every minutes row the way the ready programme does',
    run() {
      const database = loadModule();
      let checked = 0;
      for (const ready of WORKOUT_TEMPLATES_V1) {
        const readyRows = ready.sessions.flatMap((session) => session.exercises);
        const rows = readyRows.map((exercise, index) =>
          row(`x${index}`, exercise.exerciseName, OLD_CATALOGUE_MODE[exercise.exerciseName] ?? exercise.trackingMode, {
            targetSets: exercise.sets,
            repMin: exercise.repsMin,
            repMax: exercise.repsMax,
            orderIndex: index,
          }),
        );
        const loaded = database.normalizeDatabase(blob(rows));
        readyRows.forEach((exercise, index) => {
          if (exercise.trackingMode === 'duration_minutes') {
            checked += 1;
            assert.equal(loaded.exerciseTemplates[index].trackingMode, 'duration_minutes', `${ready.id}: ${exercise.exerciseName}`);
          }
        });
      }
      assert.ok(checked >= 4, `${checked} minutes rows checked across the ready programmes`);
    },
  },
];
