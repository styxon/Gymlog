const assert = require('node:assert/strict');
const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

/**
 * The quarantine was one key, and a second unreadable blob wrote over the copy
 * of the first — possibly the only copy of a long history (bug hunt,
 * 2026-10-05). Now the first free of five slots, oldest kept.
 */
const DB_KEY = '@vinha/database/v1';
const DB_CORRUPT_KEY = '@vinha/database/corrupt';
const WORKOUT_KEY = '@vinha/workout/v1';

function holdsText(fake, needle) {
  return [...fake.rows.values()].some((value) => value.includes(needle));
}

module.exports = [
  {
    name: 'quarantine: a second corrupt database does not destroy the first set-aside copy',
    async run() {
      const fake = createFakeAsyncStorage();
      const { loadDatabase } = loadAgainstFake(fake, (r) => r('storage/database.js'));
      await fake.setItem(DB_KEY, '{"sessions": [ "FIRST-HISTORY-MARKER", ');
      await loadDatabase();
      await fake.setItem(DB_KEY, '{"sessions": [ "SECOND-MARKER", ');
      await loadDatabase();
      assert.ok(holdsText(fake, 'FIRST-HISTORY-MARKER'), 'the first set-aside copy was overwritten');
      assert.ok(holdsText(fake, 'SECOND-MARKER'));
      assert.ok(fake.rows.get(DB_CORRUPT_KEY).includes('FIRST-HISTORY-MARKER'), 'the oldest copy keeps the first slot');
      assert.ok(fake.rows.get(`${DB_CORRUPT_KEY}/2`).includes('SECOND-MARKER'));
    },
  },
  {
    name: 'quarantine: a second corrupt workout bundle does not destroy the first set-aside copy',
    async run() {
      const fake = createFakeAsyncStorage();
      const { loadWorkoutBundle } = loadAgainstFake(fake, (r) => r('features/workout/workoutPersistence.js'));
      await fake.setItem(WORKOUT_KEY, '{"history": [ "FIRST-HISTORY-MARKER", ');
      await loadWorkoutBundle();
      await fake.setItem(WORKOUT_KEY, '{"history": [ "SECOND-MARKER", ');
      await loadWorkoutBundle();
      assert.ok(holdsText(fake, 'FIRST-HISTORY-MARKER'), 'the first set-aside copy was overwritten');
      assert.ok(holdsText(fake, 'SECOND-MARKER'));
    },
  },
  {
    name: 'quarantine: the same bytes are kept once, five slots at most, the oldest stay, and reset clears them all',
    async run() {
      const fake = createFakeAsyncStorage();
      const { setAsideCorruptCopy, removeCorruptCopies, CORRUPT_COPY_SLOTS } = loadAgainstFake(fake, (r) =>
        r('storage/corruptCopies.js'),
      );
      const base = '@test/corrupt';
      await setAsideCorruptCopy(base, 'copy-1');
      await setAsideCorruptCopy(base, 'copy-1');
      assert.equal(fake.rows.get(`${base}/2`), undefined, 'a retried load does not fill a second slot');
      for (let index = 2; index <= 7; index += 1) {
        await setAsideCorruptCopy(base, `copy-${index}`);
      }
      assert.equal(CORRUPT_COPY_SLOTS, 5);
      assert.deepEqual(
        [base, `${base}/2`, `${base}/3`, `${base}/4`, `${base}/5`].map((key) => fake.rows.get(key)),
        ['copy-1', 'copy-2', 'copy-3', 'copy-4', 'copy-7'],
      );
      assert.equal(fake.rows.get(`${base}/6`), undefined);

      await removeCorruptCopies(base);
      assert.ok(![...fake.rows.keys()].some((key) => key.startsWith(base)), 'reset left a set-aside copy behind');
    },
  },
  {
    name: 'quarantine: reset clears every slot of the database copies',
    async run() {
      const fake = createFakeAsyncStorage();
      const { loadDatabase, resetDatabase } = loadAgainstFake(fake, (r) => r('storage/database.js'));
      let loaded;
      for (const marker of ['ONE', 'TWO', 'THREE']) {
        await fake.setItem(DB_KEY, `{"sessions": [ "${marker}", `);
        loaded = await loadDatabase();
      }
      assert.ok(holdsText(fake, 'THREE'));
      await resetDatabase(loaded.preferences);
      assert.ok(!['ONE', 'TWO', 'THREE'].some((marker) => holdsText(fake, marker)), 'reset left a set-aside copy');
    },
  },
];
