const assert = require('node:assert/strict');

const { createFakeAsyncStorage, loadAgainstFake, CURSOR_WINDOW_BYTES } = require('./fakeAsyncStorage.cjs');

/**
 * A year of training opens on Home, not on the welcome screen.
 *
 * Measured on the emulator on 2026-09-14: a database of 273 logged sessions
 * (2.2 MB) could not be read back, `loadDatabase` rejected, and the app opened
 * as a new install over every byte of it — the first save after onboarding
 * would have written an empty history on top. These run the real
 * `saveDatabase` / `loadDatabase` against a storage that refuses big rows the
 * same way.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function loadStorageModules(fake) {
  return loadAgainstFake(fake, (requireDist) => ({
    database: requireDist('storage/database.js'),
    workout: requireDist('features/workout/workoutPersistence.js'),
  }));
}

/** Sessions shaped like the ones the guided player writes, seven lifts of three sets each. */
function buildHistory(sessionCount) {
  const lifts = ['Bench Press', 'Back Squat', 'Romanian Deadlift', 'Pull-Up', 'Overhead Press', 'Barbell Row', 'Leg Press'];
  const start = Date.parse('2026-09-13T09:00:00.000Z');
  const workoutSessions = [];
  const exerciseLogs = [];

  for (let index = 0; index < sessionCount; index += 1) {
    const performedAt = new Date(start - index * 2 * DAY_MS).toISOString();
    const sessionId = `workout_session_${index}`;
    workoutSessions.push({
      id: sessionId,
      workoutTemplateId: 'workout_long_history',
      workoutTemplateSessionId: 'long_history_day_1',
      workoutNameSnapshot: 'Rintamassa · Advanced - Day 1: Upper Body',
      sessionNotes: index % 10 === 0 ? 'Hyvä päivä 💪' : null,
      performedAt,
      startedAt: performedAt,
      durationMinutes: 57,
      setsCompleted: 21,
      exercisesCompleted: 7,
      totalVolumeKg: 9630,
      feel: 'right',
    });
    lifts.forEach((name, orderIndex) => {
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '_');
      exerciseLogs.push({
        id: `log_${index}_${orderIndex}`,
        sessionId,
        exerciseTemplateId: `long_history_day_1_${slug}`,
        exerciseNameSnapshot: name,
        weight: 80,
        repsPerSet: [8, 8, 9],
        sets: [0, 1, 2].map((setIndex) => ({
          orderIndex: setIndex,
          weight: 80,
          reps: 8 + (setIndex === 2 ? 1 : 0),
          kind: 'working',
          outcome: 'completed',
          status: 'completed',
          effort: null,
          completedAt: performedAt,
          skippedReason: null,
        })),
        tracked: true,
        orderIndex,
        skipped: false,
        sessionInserted: false,
        status: 'completed',
        slotId: `workout_long_history:long_history_day_1:custom_slot_long_history_day_1_${slug}`,
        templateSlotId: `custom_slot_long_history_day_1_${slug}`,
        templateExerciseId: `long_history_day_1_${slug}`,
        notes: null,
        swappedFrom: null,
      });
    });
  }
  return { workoutSessions, exerciseLogs };
}

module.exports = [
  {
    name: 'long history: a database past the cursor window loads back with every session',
    async run() {
      const { createEmptyDatabase } = require('../../src/data/seed');
      const fake = createFakeAsyncStorage();
      const { database } = loadStorageModules(fake);

      const empty = createEmptyDatabase('fi');
      const history = buildHistory(320);
      const stored = {
        ...empty,
        ...history,
        preferences: { ...empty.preferences, onboardingCompleted: true },
      };

      await database.saveDatabase(stored);

      const bytes = [...fake.rows]
        .filter(([key]) => key.startsWith('@vinha/database/v1'))
        .reduce((sum, [, value]) => sum + Buffer.byteLength(value, 'utf8'), 0);
      assert.ok(bytes > CURSOR_WINDOW_BYTES, `the history is only ${bytes} bytes — the test proves nothing below 2 MB`);

      const loaded = await database.loadDatabase();
      assert.equal(loaded.workoutSessions.length, 320);
      assert.equal(loaded.exerciseLogs.length, 320 * 7);
      assert.equal(loaded.preferences.onboardingCompleted, true, 'the app would open on the welcome screen');
      assert.equal(
        loaded.workoutSessions.find((session) => session.id === 'workout_session_0').sessionNotes,
        'Hyvä päivä 💪',
      );
      assert.equal(fake.rows.has('@vinha/database/corrupt'), false, 'a long history was treated as a corrupt one');
    },
  },
  {
    name: 'long history: the workout bundle past the cursor window loads back too',
    async run() {
      const fake = createFakeAsyncStorage();
      const { workout } = loadStorageModules(fake);

      // Ten entries a slot, but slots accumulate with every programme.
      const slotHistory = {};
      for (let slot = 0; slot < 900; slot += 1) {
        const slotId = `workout_${slot}:session_${slot}:custom_slot_${slot}_bench_press`;
        slotHistory[slotId] = Array.from({ length: 10 }, (_, entry) => ({
          slotId,
          templateId: `workout_${slot}`,
          templateName: 'Rintamassa · Advanced - Day 1: Upper Body',
          exerciseName: 'Bench Press',
          substitutionGroup: 'horizontal_press',
          performedAt: new Date(Date.parse('2026-09-13T09:00:00.000Z') - entry * 7 * DAY_MS).toISOString(),
          sessionId: `workout_session_${slot}_${entry}`,
          sets: [0, 1, 2].map((setIndex) => ({ setIndex, loadKg: 80, reps: 8, completedAt: '2026-09-13T08:48:55.629Z', effort: null })),
          skipped: false,
        }));
      }
      const bundle = {
        activeSession: null,
        history: { sessions: [], slotHistory, lastSelectedTemplateId: null },
        activeCardio: null,
      };

      await workout.saveWorkoutBundle(bundle);
      assert.ok(Buffer.byteLength(JSON.stringify(bundle), 'utf8') > CURSOR_WINDOW_BYTES);

      const loaded = await workout.loadWorkoutBundle();
      assert.equal(Object.keys(loaded.history.slotHistory).length, 900);
    },
  },
  {
    name: 'long history: a database with a part missing is set aside like a corrupt one, not thrown',
    async run() {
      const { createEmptyDatabase } = require('../../src/data/seed');
      const fake = createFakeAsyncStorage();
      const { database } = loadStorageModules(fake);
      await database.saveDatabase({ ...createEmptyDatabase('fi'), ...buildHistory(320) });
      const survivor = fake.rows.get('@vinha/database/v1#0');
      fake.rows.delete('@vinha/database/v1#2');

      // Thrown, the provider opened an empty database in memory and its first
      // save swept every part that was left, with nothing kept.
      const loaded = await database.loadDatabase();

      assert.equal(loaded.workoutSessions.length, 0);
      const quarantined = await loadAgainstFake(fake, (requireDist) =>
        requireDist('storage/largeItem.js').getLargeItem('@vinha/database/corrupt'),
      );
      assert.ok(quarantined, 'nothing was set aside');
      assert.ok(quarantined.includes(survivor), 'the parts that were left are not in the quarantined copy');
      assert.deepEqual(
        [...fake.rows.keys()].filter((key) => key.startsWith('@vinha/database/v1#')),
        [],
        'the broken parts outlive the empty database that replaced them',
      );
    },
  },
  {
    name: 'long history: a workout bundle with a part missing opens empty instead of never hydrating',
    async run() {
      const fake = createFakeAsyncStorage();
      const { workout } = loadStorageModules(fake);
      await workout.saveWorkoutBundle({
        activeSession: null,
        history: { sessions: [], slotHistory: { big: [{ note: '€'.repeat(1_000_000) }] }, lastSelectedTemplateId: null },
        activeCardio: null,
      });
      fake.rows.delete('@vinha/workout/v1#1');

      const loaded = await workout.loadWorkoutBundle();
      assert.deepEqual(loaded.history.slotHistory, {});
      assert.equal(loaded.activeSession, null);
    },
  },
  {
    name: 'long history: reset leaves no part of the old database behind',
    async run() {
      const { createEmptyDatabase } = require('../../src/data/seed');
      const fake = createFakeAsyncStorage();
      const { database, workout } = loadStorageModules(fake);
      const empty = createEmptyDatabase('fi');

      await database.saveDatabase({ ...empty, ...buildHistory(320) });
      await fake.setItem('@vinha/database/corrupt#0', 'left by a quarantine');
      await workout.saveWorkoutBundle({
        activeSession: null,
        history: { sessions: [], slotHistory: { big: [{ note: 'x'.repeat(3 * 1024 * 1024) }] }, lastSelectedTemplateId: null },
        activeCardio: null,
      });

      await database.resetDatabase(empty.preferences);
      await workout.clearWorkoutBundle();

      const leftovers = [...fake.rows.keys()].filter((key) => key.includes('#'));
      assert.deepEqual(leftovers, [], `erased data survives under ${leftovers.join(', ')}`);
      const reloaded = await database.loadDatabase();
      assert.equal(reloaded.workoutSessions.length, 0);
    },
  },
];
