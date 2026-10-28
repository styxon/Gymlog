const assert = require('node:assert/strict');

const {
  createFakeAsyncStorage,
  createFakeIosAsyncStorage,
  loadAgainstFake,
  CURSOR_WINDOW_BYTES,
} = require('./fakeAsyncStorage.cjs');
const { STORAGE_CHUNK_CHARS } = require('../../src/lib/storageChunks');

/**
 * The splitting reader and writer against a storage that refuses big rows.
 *
 * Behavioural rather than source-level: the fake rejects a read past the
 * cursor window the way the phone did, so a regression here is the same
 * welcome screen a user with a long history would see.
 */

const KEY = '@vinha/database/v1';

function load() {
  const fake = createFakeAsyncStorage();
  const largeItem = loadAgainstFake(fake, (requireDist) => requireDist('storage/largeItem.js'));
  return { fake, ...largeItem };
}

/** The same layer on iOS: Platform.OS 'ios' over a storage whose multiSet is not one transaction. */
function loadIos() {
  const fake = createFakeIosAsyncStorage();
  const largeItem = loadAgainstFake(fake, (requireDist) => requireDist('storage/largeItem.js'), {
    platform: 'ios',
  });
  return { fake, ...largeItem };
}

/**
 * A JSON-shaped value that splits into exactly `count` parts.
 *
 * Three-byte characters, so even three parts are past the single-row limit;
 * anything smaller is stored as one row and has no parts to test.
 */
function valueOfParts(count) {
  assert.ok(count >= 3, 'fewer than three parts of this value fit one row and are not split');
  return JSON.stringify({ body: '€'.repeat(STORAGE_CHUNK_CHARS * count - 20) });
}

function partKeys(fake, key = KEY) {
  return [...fake.rows.keys()].filter((candidate) => candidate.startsWith(`${key}#`)).sort();
}

/** Count how often `getAllKeys` runs while `task` does. */
async function countingGetAllKeys(fake, task) {
  const original = fake.getAllKeys;
  let calls = 0;
  fake.getAllKeys = (...args) => {
    calls += 1;
    return original.apply(fake, args);
  };
  try {
    await task();
  } finally {
    fake.getAllKeys = original;
  }
  return calls;
}

module.exports = [
  {
    name: 'large items: the fake refuses what the phone refused — one 2.2 MB row cannot be read',
    async run() {
      // Without this the rest proves nothing: a fake that reads anything would
      // pass a writer that never splits.
      const { fake } = load();
      const big = valueOfParts(3);
      assert.ok(Buffer.byteLength(big, 'utf8') > CURSOR_WINDOW_BYTES);
      await fake.setItem(KEY, big);
      await assert.rejects(fake.getItem(KEY), /Row too big to fit into CursorWindow/);
    },
  },
  {
    name: 'large items: a long history is written in parts and reads back whole',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      const big = valueOfParts(5);

      await setLargeItem(KEY, big);

      assert.equal(await getLargeItem(KEY), big);
      assert.match(fake.rows.get(KEY), /^vinha-chunks:5:\d+$/);
      assert.equal(partKeys(fake).length, 5);
      for (const key of partKeys(fake)) {
        await assert.doesNotReject(fake.getItem(key), `${key} is too big for the phone to read`);
      }
    },
  },
  {
    name: 'large items: a value that fits is stored exactly as before, and an old install reads unchanged',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      const small = JSON.stringify({ workoutSessions: [{ id: 'a' }] });

      await setLargeItem(KEY, small);
      assert.equal(fake.rows.get(KEY), small, 'a value that fits must not grow a manifest');
      assert.deepEqual(partKeys(fake), []);

      // Well past one part, still a row an older build can read: a manifest
      // here would be read by that build as a corrupt database.
      const readableByOldBuilds = JSON.stringify({ body: 'x'.repeat(1_600_000) });
      await setLargeItem(KEY, readableByOldBuilds);
      assert.equal(fake.rows.get(KEY), readableByOldBuilds);
      assert.deepEqual(partKeys(fake), []);

      // Written by a build that predates splitting.
      await fake.setItem('@vinha/workout/v1', '{"history":{}}');
      assert.equal(await getLargeItem('@vinha/workout/v1'), '{"history":{}}');
      assert.equal(await getLargeItem('@vinha/nothing'), null);
    },
  },
  {
    name: 'large items: parts a shorter value no longer needs are removed',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();

      await setLargeItem(KEY, valueOfParts(5));
      assert.equal(partKeys(fake).length, 5);
      const three = valueOfParts(3);
      await setLargeItem(KEY, three);
      assert.equal(await getLargeItem(KEY), three);
      assert.deepEqual(partKeys(fake), [`${KEY}#0`, `${KEY}#1`, `${KEY}#2`], 'parts past the new end are still on disk');

      const small = '{"workoutSessions":[]}';
      await setLargeItem(KEY, small);
      assert.equal(await getLargeItem(KEY), small);
      assert.deepEqual(partKeys(fake), []);
    },
  },
  {
    name: 'large items: leftovers from an earlier launch are swept by the first write',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      // A crash between a write and its sweep, in a launch this module never saw.
      await fake.setItem(KEY, '{"old":true}');
      await fake.setItem(`${KEY}#0`, 'stale');
      await fake.setItem(`${KEY}#7`, 'stale');

      await setLargeItem(KEY, '{"new":true}');

      assert.equal(await getLargeItem(KEY), '{"new":true}');
      assert.deepEqual(partKeys(fake), []);
    },
  },
  {
    name: 'large items: a save that cannot have left parts behind does not list every key',
    async run() {
      // The workout bundle is saved once a second during a session.
      const { fake, setLargeItem } = load();
      await setLargeItem(KEY, '{"tick":0}');

      const calls = await countingGetAllKeys(fake, async () => {
        for (let tick = 1; tick <= 30; tick += 1) {
          await setLargeItem(KEY, `{"tick":${tick}}`);
        }
        // Growing into parts overwrites every part there was: nothing to sweep.
        await setLargeItem(KEY, valueOfParts(3));
        await setLargeItem(KEY, valueOfParts(4));
      });
      assert.equal(calls, 0, `${calls} getAllKeys calls for writes that could not leave anything behind`);

      // Shrinking can, and still sweeps.
      const shrinking = await countingGetAllKeys(fake, () => setLargeItem(KEY, valueOfParts(3)));
      assert.equal(shrinking, 1);
      assert.equal(partKeys(fake).length, 3);
    },
  },
  {
    name: 'large items: a write that fails leaves the previous value whole',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      const before = valueOfParts(4);
      await setLargeItem(KEY, before);

      fake.faults.multiSet = 1;
      await assert.rejects(setLargeItem(KEY, valueOfParts(6)), /disk is full/);

      assert.equal(await getLargeItem(KEY), before);
    },
  },
  {
    name: 'large items: writes and reads fired together still land in order',
    async run() {
      const { getLargeItem, setLargeItem } = load();
      const long = valueOfParts(6);
      const short = '{"short":true}';
      const middle = valueOfParts(3);

      // Nothing awaited between them — the way a save and a reload can overlap.
      const writes = [setLargeItem(KEY, long), setLargeItem(KEY, short)];
      const readBetween = getLargeItem(KEY);
      writes.push(setLargeItem(KEY, middle));
      await Promise.all(writes);

      assert.equal(await readBetween, short, 'a read between two writes saw neither whole value');
      assert.equal(await getLargeItem(KEY), middle);
    },
  },
  {
    name: 'large items: a missing part is an error carrying what is left, never a shorter history',
    async run() {
      const { fake, getLargeItem, setLargeItem, MissingPartsError } = load();
      await setLargeItem(KEY, valueOfParts(4));
      const kept = fake.rows.get(`${KEY}#3`);
      fake.rows.delete(`${KEY}#2`);

      const error = await getLargeItem(KEY).then(
        () => assert.fail('a value with a part missing was read back'),
        (rejection) => rejection,
      );
      assert.ok(error instanceof MissingPartsError, `rejected with ${error}`);
      assert.throws(() => JSON.parse(error.readable), 'the remains parse, so a loader would take them as a history');
      assert.ok(error.readable.includes(kept), 'the parts that were there are not in the remains');
    },
  },
  {
    name: 'large items: a failed sweep does not fail the write, and the next write sweeps again',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      await setLargeItem(KEY, valueOfParts(4));
      const value = '{"small":true}';
      fake.faults.getAllKeys = 1;
      const warn = console.warn;
      console.warn = () => {};
      try {
        await setLargeItem(KEY, value);
      } finally {
        console.warn = warn;
      }
      assert.equal(await getLargeItem(KEY), value);
      assert.equal(partKeys(fake).length, 4, 'the fault did not happen, so this proves nothing');

      await setLargeItem(KEY, value);
      assert.deepEqual(partKeys(fake), [], 'a sweep that failed once is never retried');
    },
  },
  {
    name: 'large items: removing a value removes every part of it',
    async run() {
      const { fake, getLargeItem, removeLargeItem, setLargeItem } = load();
      await setLargeItem(KEY, valueOfParts(4));
      await setLargeItem('@vinha/workout/v1', valueOfParts(3));

      await removeLargeItem(KEY);

      assert.equal(await getLargeItem(KEY), null);
      assert.deepEqual(partKeys(fake), []);
      assert.ok(partKeys(fake, '@vinha/workout/v1').length > 0, 'another key lost its parts');
    },
  },
  {
    name: 'large items on iOS: a value of any size is one row — no manifest, no parts',
    async run() {
      // iOS has no cursor window and its multiSet is not a transaction, so a
      // split there can be torn by a kill between two part files (hunt 3,
      // 2026-10-03). The same value on Android is split, which the test above
      // already holds.
      const { fake, getLargeItem, setLargeItem } = loadIos();
      for (const parts of [1, 3, 5]) {
        const big = parts === 1 ? JSON.stringify({ body: 'x'.repeat(5000) }) : valueOfParts(parts);
        await setLargeItem(KEY, big);
        assert.equal(fake.rows.get(KEY), big, `${parts}-part-sized value was not stored as itself`);
        assert.deepEqual(partKeys(fake), [], `${parts}-part-sized value left parts behind`);
        assert.equal(await getLargeItem(KEY), big);
      }
    },
  },
  {
    name: 'large items on iOS: a save killed mid-way leaves one whole value, never a splice of two saves',
    async run() {
      // The hunt's repro (scratchpad hunt3/verify-D/splice.cjs): v1 saved, then
      // the process dies after k file writes of v2. Split, k = 1 left v2's
      // first part under v1's head.
      const { fake, getLargeItem, setLargeItem } = loadIos();
      const v1 = JSON.stringify({ tag: 'v1', body: '€'.repeat(STORAGE_CHUNK_CHARS * 3) });
      const v2 = JSON.stringify({ tag: 'v2', body: '€'.repeat(STORAGE_CHUNK_CHARS * 3 + 17) });
      await setLargeItem(KEY, v1);

      for (const killAfterFiles of [0, 1, 2, 3]) {
        fake.faults.killAfterFiles = killAfterFiles;
        await setLargeItem(KEY, v2).catch(() => undefined);
        fake.faults.killAfterFiles = Infinity;
        const read = await getLargeItem(KEY);
        assert.ok(read === v1 || read === v2, `killed after ${killAfterFiles} files: neither save came back whole`);
        await setLargeItem(KEY, v1);
      }
    },
  },
  {
    name: 'large items on iOS: the preferences row still travels in the same call, and an Android-split value still reads',
    async run() {
      const { fake, getLargeItem, setLargeItem } = loadIos();
      const big = valueOfParts(3);
      await setLargeItem(KEY, big, [['@vinha/preferences/v1', '{"setupCompleted":true}']]);
      assert.equal(fake.rows.get('@vinha/preferences/v1'), '{"setupCompleted":true}');
      assert.equal(await getLargeItem(KEY), big);

      // The reader keeps understanding the splitting layout: a manifest and its
      // parts (written by an Android build, or restored from one) read whole.
      const android = load();
      const split = valueOfParts(4);
      await android.setLargeItem(KEY, split);
      const ios = loadIos();
      for (const [key, value] of android.fake.rows) {
        await ios.fake.setItem(key, value);
      }
      assert.match(ios.fake.rows.get(KEY), /^vinha-chunks:4:\d+$/);
      assert.equal(await ios.getLargeItem(KEY), split);
    },
  },
  {
    name: 'large items on Android: the long history is still split in parts, in one multiSet with the preferences',
    async run() {
      const { fake, getLargeItem, setLargeItem } = load();
      const big = valueOfParts(4);
      let calls = 0;
      const multiSet = fake.multiSet;
      fake.multiSet = (...args) => {
        calls += 1;
        return multiSet.apply(fake, args);
      };
      await setLargeItem(KEY, big, [['@vinha/preferences/v1', '{}']]);
      assert.equal(calls, 1);
      assert.match(fake.rows.get(KEY), /^vinha-chunks:4:\d+$/);
      assert.equal(partKeys(fake).length, 4);
      assert.equal(await getLargeItem(KEY), big);
    },
  },
];
