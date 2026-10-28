const assert = require('node:assert/strict');
const fs = require('node:fs');

const { HISTORY_COLLECTIONS } = require('../../src/lib/historyRowCodec');
const { workoutSessionRepository } = require('../../src/storage/repositories');
const { InjectedCrash } = require('../helpers/faultDriver.cjs');
const { makeDatabase, session, storeTexts, createWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The crash matrix. Every operation of the mirror is run once to count its
 * steps (each call that reaches the SQL engine), then again for each step with
 * the process killed right before that step (or, in the second mode, with that
 * one step failing and the process living on).
 *
 * Whatever step it was:
 *   1. The store is never half a database: it holds the earlier content, the
 *      new content, or nothing, and a store that says 'verified' holds one of
 *      the two contents.
 *   2. The blob is never touched: the in-memory database the mirror was given
 *      is the same after as before (the mirror has no other door to it).
 *   3. The next launch ends in a store that equals memory and says 'verified',
 *      by rebuilding when it has to, without help, and without the mirror
 *      switching itself off.
 */

function isEmptyStore(file) {
  const texts = storeTexts(file);
  return HISTORY_COLLECTIONS.every((collection) => texts[collection].length === 0);
}

function storeKind(world, oldDb, newDb) {
  if (!fs.existsSync(world.file)) {
    return 'nofile';
  }
  try {
    if (world.matches(newDb)) return 'new';
    if (oldDb && world.matches(oldDb)) return 'old';
    if (isEmptyStore(world.file)) return 'empty';
    return 'other';
  } catch {
    // The file exists but has no tables yet.
    return 'nofile';
  }
}

async function swallow(promise) {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

/**
 * scenario: { oldDb, newDb, setup(world) -> mirror|null, operate(world, mirror) }
 * `setup` runs undisturbed; `operate` is where the fault lands.
 */
async function runMatrix(scenario, mode) {
  const probe = createWorld({ database: scenario.oldDb });
  let steps;
  try {
    const mirror = await scenario.setup(probe);
    probe.state.database = scenario.newDb;
    const before = probe.faults.steps;
    await scenario.operate(probe, mirror);
    steps = probe.faults.steps - before;
  } finally {
    probe.cleanup();
  }
  assert.ok(steps >= 5, `${scenario.name}: the operation took only ${steps} steps`);

  for (let k = 1; k <= steps; k += 1) {
    const world = createWorld({ database: scenario.oldDb });
    try {
      const mirror = await scenario.setup(world);
      world.state.database = scenario.newDb;
      const memoryBefore = JSON.stringify(world.state.database);
      if (mode === 'crash') {
        world.faults.crashAt(k);
      } else {
        world.faults.failAt(k);
      }
      await swallow(scenario.operate(world, mirror));
      const where = `${scenario.name}, ${mode} at step ${k}/${steps} (${world.faults.log[world.faults.steps - 1] || '?'})`;

      // 2. The blob side: memory is as it was.
      assert.equal(JSON.stringify(world.state.database), memoryBefore, `${where}: memory changed`);

      // 1. The store is whole. A live process may still hold a lock for a moment; a dead one cannot.
      if (mode === 'crash') {
        const kind = storeKind(world, scenario.oldDb, scenario.newDb);
        assert.notEqual(kind, 'other', `${where}: the store is neither old, new nor empty`);
        if (kind !== 'nofile') {
          const state = world.meta().state;
          if (state === 'verified') {
            assert.ok(kind === 'old' || kind === 'new' || kind === 'empty', `${where}: verified but ${kind}`);
          }
        }
      } else {
        await swallow(mirror && mirror.close());
        world.faults.disarm();
      }

      // 3. The next launch.
      world.faults.revive();
      const next = world.newMirror();
      const result = await next.start();
      assert.ok(result.status === 'unchanged' || result.status === 'rebuilt', `${where}: next start ${result.status} (${result.reason})`);
      assert.ok(world.matches(scenario.newDb), `${where}: the store does not equal memory after the next start`);
      assert.equal(world.meta().state, 'verified', `${where}: not verified after the next start`);
      const guard = world.guardState();
      assert.equal(guard.disabled, false, `${where}: the mirror switched itself off`);
      assert.equal(guard.attempt, 0, `${where}: an open attempt is still written`);
      assert.equal(guard.stale, false, `${where}: still stale after a good rebuild`);
      await next.close();
    } finally {
      world.cleanup();
    }
  }
  return steps;
}

const older = makeDatabase(3);
const newer = (() => {
  let db = workoutSessionRepository.append(older, session(40));
  db = workoutSessionRepository.remove(db, 'ws_1');
  db = { ...db, measurementEntries: [...db.measurementEntries].reverse() };
  return db;
})();
const unrelated = makeDatabase(2);

const SCENARIOS = [
  {
    name: 'first rebuild from an absent store',
    oldDb: null,
    newDb: older,
    setup: async () => null,
    operate: async (world) => world.newMirror().start(),
  },
  {
    name: 'rebuild over a verified store of other content',
    oldDb: older,
    newDb: unrelated,
    setup: async (world) => {
      const mirror = world.newMirror();
      await mirror.start();
      await mirror.close();
      return null;
    },
    operate: async (world) => world.newMirror().start(),
  },
  {
    name: 'apply of a prepend, a delete with its logs and a reorder',
    oldDb: older,
    newDb: newer,
    setup: async (world) => {
      const mirror = world.newMirror();
      await mirror.start();
      return mirror;
    },
    operate: async (world, mirror) => mirror.apply(older, newer),
  },
  {
    name: 'replaceAll (a restore)',
    oldDb: older,
    newDb: unrelated,
    setup: async (world) => {
      const mirror = world.newMirror();
      await mirror.start();
      return mirror;
    },
    operate: async (world, mirror) => mirror.replaceAll(unrelated),
  },
  {
    name: 'clear (a reset)',
    oldDb: older,
    newDb: makeDatabase(0),
    setup: async (world) => {
      const mirror = world.newMirror();
      await mirror.start();
      return mirror;
    },
    operate: async (world, mirror) => mirror.clear(),
  },
];

module.exports = [
  ...SCENARIOS.flatMap((scenario) => [
    {
      name: `historyMirror crash matrix: ${scenario.name}, killed at every step`,
      async run() {
        await runMatrix(scenario, 'crash');
      },
    },
    {
      name: `historyMirror crash matrix: ${scenario.name}, one IO failure at every step`,
      async run() {
        await runMatrix(scenario, 'fail');
      },
    },
  ]),
  {
    name: 'historyMirror crash matrix: the harness really kills (a dead process cannot write afterwards)',
    async run() {
      const world = createWorld({ database: older });
      try {
        const mirror = world.newMirror();
        world.faults.crashAt(3);
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.equal(world.faults.dead, true);
        await assert.rejects(() => world.faults.opener.open(), InjectedCrash);
        // The attempt written before the open is all the dying code left behind.
        assert.equal(world.guardState().attempt, 1);
      } finally {
        world.cleanup();
      }
    },
  },
];
