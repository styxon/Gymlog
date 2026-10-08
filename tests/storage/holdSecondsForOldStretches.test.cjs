const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(path.join(DIST, 'features', 'workout', 'customWorkoutAdapter.js'));
const { createSeedDatabase } = require(path.join(DIST, 'data', 'seed.js'));
const { DEFAULT_HOLD_SECONDS } = require(path.join(DIST, 'lib', 'holdExercises.js'));

/**
 * A stretch picked from the library before 2026-10-05 opened a reps dial and
 * was stored "3 × 12" with no mode. Since the name rule (lib/holdExercises)
 * made the name a hold, the same row asks for 3 × 12 SECONDS. The loader
 * rewrites such a row, once per database, to the editor's hold default.
 */

function loadModule() {
  const fake = createFakeAsyncStorage();
  return { fake, database: loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js')) };
}

function row(id, name, extra = {}) {
  return {
    id,
    workoutTemplateId: 't',
    workoutTemplateSessionId: 's',
    name,
    targetSets: extra.targetSets ?? 3,
    repMin: extra.repMin ?? 12,
    repMax: extra.repMax ?? 12,
    restSeconds: extra.restSeconds ?? 60,
    trackedDefault: false,
    orderIndex: extra.orderIndex ?? 0,
    libraryItemId: extra.libraryItemId ?? null,
    trackingMode: extra.trackingMode ?? null,
    supersetGroup: null,
  };
}

function blob(exerciseTemplates, extra = {}) {
  return {
    workoutTemplates: [
      {
        id: 't',
        name: 'Mine',
        sessions: [{ id: 's', name: 'A', orderIndex: 0, exerciseIds: exerciseTemplates.map((entry) => entry.id) }],
        origin: 'authored',
      },
    ],
    exerciseTemplates,
    ...extra,
  };
}

/** Each lift of the stored programme as the player runs it: name, mode, sets × min-max. */
function played(loaded) {
  const template = loaded.workoutTemplates[0];
  const sessions = template.sessions.map((session) => ({
    ...session,
    exercises: loaded.exerciseTemplates.filter((entry) => entry.workoutTemplateSessionId === session.id),
  }));
  const runtime = adaptLegacyWorkoutTemplateToRuntimeTemplate(template, sessions, loaded.exerciseLibrary, 90);
  return Object.fromEntries(
    runtime.sessions
      .flatMap((session) => session.exercises)
      .map((entry) => [entry.exerciseName, `${entry.trackingMode} ${entry.sets}x${entry.repsMin}-${entry.repsMax}`]),
  );
}

const HOLD = `${DEFAULT_HOLD_SECONDS.min}-${DEFAULT_HOLD_SECONDS.max}`;

module.exports = [
  {
    name: 'hold seconds for old stretches: a library stretch stored at a reps count is played at the editor hold default, sets and rest kept',
    run() {
      const { database } = loadModule();
      const loaded = database.normalizeDatabase(
        blob([
          row('a', 'Hamstring Stretch', { libraryItemId: 'free_hamstring_stretch', restSeconds: 45 }),
          // The library's own held rows (the list beside the name rule) and a foam-roller row.
          row('b', 'Seated Hamstring', { repMin: 10, repMax: 10, orderIndex: 1, targetSets: 2 }),
          row('c', 'Calves-SMR', { repMin: 8, repMax: 12, orderIndex: 2 }),
        ]),
      );
      assert.deepEqual(played(loaded), {
        'Hamstring Stretch': `hold 3x${HOLD}`,
        'Seated Hamstring': `hold 2x${HOLD}`,
        'Calves-SMR': `hold 3x${HOLD}`,
      });
      const stretch = loaded.exerciseTemplates.find((entry) => entry.id === 'a');
      assert.equal(stretch.restSeconds, 45, 'the rest is the reader\'s and is not a count');
      assert.equal(stretch.trackingMode, null, 'the mode stays derived from the name');
    },
  },
  {
    name: 'hold seconds for old stretches: nothing else moves - seconds a reader set, a stored mode, holds that were always holds, reps stretches, lifts',
    run() {
      const { database } = loadModule();
      const rows = [
        // Already seconds: 20 and up is a hold the programmes themselves prescribe.
        row('a', 'Hamstring Stretch', { repMin: 30, repMax: 30 }),
        row('b', 'Hamstring Stretch', { repMin: 20, repMax: 20, orderIndex: 1 }),
        // The writer's own answer outranks the name: still repetitions.
        row('c', 'Hamstring Stretch', { trackingMode: 'reps_first', orderIndex: 2 }),
        // On the hold list from the start, so its numbers were seconds all along.
        row('d', 'Plank', { repMin: 15, repMax: 15, orderIndex: 3 }),
        row('e', 'L-Sit Hold', { repMin: 10, repMax: 10, orderIndex: 4 }),
        // Named for a stretch, moved through in repetitions.
        row('f', 'Isometric Wipers', { orderIndex: 5 }),
        row('g', 'Dynamic Back Stretch', { orderIndex: 6 }),
        row('h', 'Barbell Curl', { orderIndex: 7 }),
      ];
      const loaded = database.normalizeDatabase(blob(rows));
      assert.deepEqual(
        loaded.exerciseTemplates.map((entry) => [entry.id, entry.repMin, entry.repMax, entry.trackingMode]),
        [
          ['a', 30, 30, null],
          ['b', 20, 20, null],
          ['c', 12, 12, 'reps_first'],
          ['d', 15, 15, null],
          ['e', 10, 10, null],
          ['f', 12, 12, null],
          ['g', 12, 12, null],
          ['h', 12, 12, null],
        ],
      );
    },
  },
  {
    name: 'hold seconds for old stretches: logged sets are history and keep the numbers they were logged with',
    run() {
      const { database } = loadModule();
      const log = {
        id: 'log1',
        sessionId: 'w1',
        exerciseTemplateId: 'a',
        exerciseNameSnapshot: 'Hamstring Stretch',
        weight: 0,
        repsPerSet: [12, 12, 12],
        sets: [0, 1, 2].map((orderIndex) => ({ orderIndex, weight: 0, reps: 12, kind: 'working', outcome: null })),
        tracked: false,
        orderIndex: 0,
      };
      const loaded = database.normalizeDatabase(
        blob([row('a', 'Hamstring Stretch')], {
          workoutSessions: [
            { id: 'w1', workoutTemplateId: 't', workoutNameSnapshot: 'Mine', performedAt: '2026-09-01T10:30:00.000Z' },
          ],
          exerciseLogs: [log],
        }),
      );
      assert.equal(loaded.exerciseTemplates[0].repMax, DEFAULT_HOLD_SECONDS.max);
      const back = loaded.exerciseLogs.find((entry) => entry.id === 'log1');
      assert.ok(back, 'the log survives the load');
      assert.deepEqual(back.repsPerSet, [12, 12, 12]);
      assert.deepEqual(back.sets.map((set) => set.reps), [12, 12, 12]);
    },
  },
  {
    name: 'hold seconds for old stretches: once per database - 12 s set after the update is the reader\'s and stays',
    run() {
      const { database } = loadModule();
      const first = database.normalizeDatabase(blob([row('a', 'Hamstring Stretch')]));
      assert.deepEqual([first.exerciseTemplates[0].repMin, first.exerciseTemplates[0].repMax], [DEFAULT_HOLD_SECONDS.min, DEFAULT_HOLD_SECONDS.max]);
      assert.deepEqual(database.normalizeDatabase(first), first, 'normalized twice is normalized once');
      const edited = {
        ...first,
        exerciseTemplates: first.exerciseTemplates.map((entry) => ({ ...entry, repMin: 12, repMax: 12 })),
      };
      const reloaded = database.normalizeDatabase(JSON.parse(JSON.stringify({ ...edited, exerciseLibrary: [] })));
      assert.deepEqual([reloaded.exerciseTemplates[0].repMin, reloaded.exerciseTemplates[0].repMax], [12, 12]);
    },
  },
  {
    name: 'hold seconds for old stretches: load, save and load again reads the hold default and carries the marker',
    async run() {
      const { fake, database } = loadModule();
      fake.rows.set(
        '@vinha/database/v1',
        JSON.stringify({
          ...blob([row('a', 'Hamstring Stretch', { libraryItemId: 'free_hamstring_stretch' }), row('b', 'Barbell Curl', { orderIndex: 1 })]),
          workoutPlans: [],
          workoutSessions: [],
          exerciseLogs: [],
          preferences: createSeedDatabase().preferences,
        }),
      );
      const loaded = await database.loadDatabase();
      assert.deepEqual(played(loaded), { 'Hamstring Stretch': `hold 3x${HOLD}`, 'Barbell Curl': 'load_and_reps 3x12-12' });
      await database.saveDatabase(loaded);
      const again = await database.loadDatabase();
      assert.deepEqual(again.exerciseTemplates, loaded.exerciseTemplates);
      assert.deepEqual(again.appliedMigrations, loaded.appliedMigrations);
      assert.deepEqual(played(again), { 'Hamstring Stretch': `hold 3x${HOLD}`, 'Barbell Curl': 'load_and_reps 3x12-12' });
    },
  },
];
