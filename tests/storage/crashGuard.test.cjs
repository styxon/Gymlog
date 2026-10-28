const assert = require('node:assert/strict');

const guard = require('../../src/lib/historyMirrorGuard');
const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { createEmptyDatabase } = require('../../src/data/seed');
const { withWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The crash guard. A native module that dies in open() takes the process with
 * it, so the attempt is written before the open and taken off after the first
 * query; two launches that find it still written switch the mirror off, and
 * the app runs on the blob alone.
 */

function tick(times = 20) {
  return (async () => {
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
}

/** An opener whose open() never returns: the native module has taken the process down. */
function dyingOpener(counter) {
  return {
    open() {
      counter.opens += 1;
      return new Promise(() => {});
    },
  };
}

module.exports = [
  {
    name: 'crashGuard: whatever is stored, the state read back is well formed',
    run() {
      for (const junk of [null, undefined, '', 'not json', '[]', '"x"', '7', 'null', '{"attempt":"1"}', '{"attempt":-3,"crashes":1.5,"disabled":"yes"}']) {
        assert.deepEqual(guard.parseMirrorGuard(junk), guard.emptyMirrorGuard(), String(junk));
      }
      const big = guard.parseMirrorGuard('{"attempt":99999999,"crashes":2,"stale":true,"disabled":true,"rebuildFailures":1}');
      assert.equal(big.attempt, 1000, 'counters are capped');
      assert.deepEqual({ ...big, attempt: 0 }, { attempt: 0, crashes: 2, rebuildFailures: 1, disabled: true, stale: true, purgePending: false });
      assert.deepEqual(guard.parseMirrorGuard(guard.serializeMirrorGuard(big)), big);
    },
  },
  {
    name: 'crashGuard: the transitions count crashes, switch off at two, and a good rebuild forgives failures only',
    run() {
      let state = guard.emptyMirrorGuard();
      assert.equal(guard.guardAtLaunch(state), state, 'no attempt standing, nothing counted');
      state = guard.guardBeginOpen(state);
      assert.equal(state.attempt, 1);
      assert.equal(guard.guardOpenSucceeded(state).attempt, 0);

      const first = guard.guardAtLaunch(state);
      assert.deepEqual([first.crashes, first.disabled, first.attempt], [1, false, 0]);
      const second = guard.guardAtLaunch(guard.guardBeginOpen(first));
      assert.deepEqual([second.crashes, second.disabled], [2, true]);

      let failing = guard.emptyMirrorGuard();
      failing = guard.guardRebuildFailed(failing);
      failing = guard.guardRebuildFailed(failing);
      assert.equal(failing.disabled, false);
      assert.equal(failing.stale, true);
      assert.equal(guard.guardRebuildFailed(failing).disabled, true);
      const healed = guard.guardRebuildSucceeded(failing);
      assert.deepEqual([healed.rebuildFailures, healed.stale, healed.disabled], [0, false, false]);
      assert.equal(guard.guardRebuildSucceeded({ ...second }).disabled, true, 'a rebuild does not undo a crash switch-off');
      assert.equal(guard.guardMarkStale(healed).stale, true);
    },
  },
  {
    name: 'crashGuard: the attempt is on disk before the open, and gone after the first query',
    async run() {
      await withWorld({}, async (world) => {
        let attemptDuringOpen = null;
        const opener = {
          async open() {
            attemptDuringOpen = attemptDuringOpen ?? world.guardState().attempt;
            return world.faults.opener.open();
          },
          destroy: world.faults.opener.destroy,
        };
        const mirror = world.newMirror({ opener });
        await mirror.start();
        assert.equal(attemptDuringOpen, 1, 'written before open() was called');
        assert.equal(world.guardState().attempt, 0);
        assert.equal(world.guardState().crashes, 0);
      });
    },
  },
  {
    name: 'crashGuard: two launches that die inside open() switch the mirror off, and a third never calls open()',
    async run() {
      await withWorld({}, async (world) => {
        const counter = { opens: 0 };
        const dying = dyingOpener(counter);

        // Launch 1 dies in open().
        world.newMirror({ opener: dying }).start();
        await tick();
        assert.equal(counter.opens, 1);
        assert.equal(world.guardState().attempt, 1);

        // Launch 2 finds the attempt: one crash counted, tries again, dies again.
        world.newMirror({ opener: dying }).start();
        await tick();
        assert.equal(counter.opens, 2);
        assert.equal(world.guardState().crashes, 1);
        assert.equal(world.guardState().disabled, false);

        // Launch 3 finds it again: that is two. Off, and open() is not called.
        const third = world.newMirror({ opener: dying });
        const result = await third.start();
        assert.equal(result.status, 'disabled');
        assert.equal(result.reason, 'crash-guard');
        assert.equal(counter.opens, 2);
        assert.equal(world.guardState().disabled, true);
        assert.equal(world.guardState().attempt, 0);

        // Later launches stay off, even with a healthy driver, and touch nothing.
        const steps = world.faults.steps;
        const fourth = world.newMirror();
        assert.equal((await fourth.start()).status, 'disabled');
        assert.equal(world.faults.steps, steps);
      });
    },
  },
  {
    name: 'crashGuard: one crash is forgiven in the sense that the mirror still runs afterwards',
    async run() {
      await withWorld({}, async (world) => {
        world.newMirror({ opener: dyingOpener({ opens: 0 }) }).start();
        await tick();
        const next = world.newMirror();
        const result = await next.start();
        assert.equal(result.status, 'rebuilt');
        assert.equal(world.guardState().crashes, 1);
        assert.equal(world.guardState().disabled, false);
        assert.ok(world.matches());
      });
    },
  },
  {
    name: 'crashGuard: a junk guard row is the empty state, and a guard that cannot be written means no open',
    async run() {
      await withWorld({}, async (world) => {
        world.guard.cell.value = '{{{ not json';
        const mirror = world.newMirror();
        assert.equal((await mirror.start()).status, 'rebuilt');
        await mirror.close();
      });
      await withWorld({}, async (world) => {
        let opened = 0;
        const mirror = world.newMirror({
          opener: {
            open: async () => {
              opened += 1;
              return world.faults.opener.open();
            },
          },
          guardStore: {
            read: async () => null,
            write: async () => {
              throw new Error('storage full');
            },
          },
        });
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.equal(result.reason, 'guard-unwritable');
        assert.equal(opened, 0, 'without the attempt on disk a crash would not be counted: do not open');
      });
      await withWorld({}, async (world) => {
        // A read that fails must not be taken for an empty row (the counts would be forgotten).
        world.guard.cell.value = JSON.stringify({ attempt: 0, crashes: 1, rebuildFailures: 0, disabled: false, stale: false });
        let writes = 0;
        const mirror = world.newMirror({
          guardStore: {
            read: async () => {
              throw new Error('read failed');
            },
            write: async () => {
              writes += 1;
            },
          },
        });
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.equal(result.reason, 'guard-unreadable');
        assert.equal(writes, 0);
        assert.equal(world.guardState().crashes, 1);
      });
    },
  },
  {
    name: 'crashGuard: the AsyncStorage guard row is one small plain key, and Reset leaves it alone',
    async run() {
      const fake = createFakeAsyncStorage();
      const target = require.resolve('../../src/storage/sqlite/asyncStorageGuardStore');
      delete require.cache[target];
      const store = loadAgainstFake(fake, (requireDist) => requireDist('storage/sqlite/asyncStorageGuardStore.js').createAsyncStorageGuardStore());
      delete require.cache[target];
      assert.equal(guard.MIRROR_GUARD_STORAGE_KEY, '@vinha/sqlite/guard/v1');
      assert.equal(await store.read(), null);
      await store.write(guard.serializeMirrorGuard({ ...guard.emptyMirrorGuard(), crashes: 1 }));
      assert.equal(fake.rows.size, 1);
      assert.equal(guard.parseMirrorGuard(await store.read()).crashes, 1);

      const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
      await database.resetDatabase(createEmptyDatabase('en').preferences);
      assert.equal(guard.parseMirrorGuard(fake.rows.get(guard.MIRROR_GUARD_STORAGE_KEY)).crashes, 1, 'Reset kept the guard row');
    },
  },
];
