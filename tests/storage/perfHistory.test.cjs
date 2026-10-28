const assert = require('node:assert/strict');

const { historyContentHash } = require('../../src/lib/historyContentHash');
const { workoutSessionRepository } = require('../../src/storage/repositories');
const { createEmptyDatabase } = require('../../src/data/seed');
const { session, log, withWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * A regression guard for the mirror's cost on long histories, not a budget:
 * Node is roughly twenty times faster than Hermes without a JIT, so these
 * limits only catch a change that makes a pass quadratic or reads the whole
 * table where it used to touch a row. The numbers a phone gives come from
 * `npm run measure:startup` and the device list in the plan.
 *
 * What is held:
 * - a rebuild (write, read back on a second connection, fingerprint, digests)
 *   grows about linearly with the history;
 * - the start-up comparison of an unchanged store is cheaper than the rebuild;
 * - one commit (a prepend, an edit, a delete) costs the same at 3000 sessions
 *   as at 300: it touches rows, not the table.
 */
const SIZES = [300, 1000, 3000];

function longHistory(sessions) {
  const database = createEmptyDatabase();
  database.workoutSessions = Array.from({ length: sessions }, (_, i) =>
    session(sessions - i, { sessionNotes: 'x'.repeat(200), workoutNameSnapshot: `Upper body ${i}` }),
  );
  database.exerciseLogs = Array.from({ length: sessions * 6 }, (_, i) =>
    log(i + 1, (i % sessions) + 1, { sets: Array.from({ length: 4 }, (_, s) => ({ weight: 60 + s, reps: 8, id: `set_${i}_${s}` })) }),
  );
  return database;
}

async function timed(work) {
  const start = performance.now();
  await work();
  return performance.now() - start;
}

module.exports = [
  {
    name: 'perfHistory: rebuild and start-up comparison at 300 / 1000 / 3000 sessions stay within regression bounds',
    async run() {
      const rebuildMs = [];
      for (const size of SIZES) {
        const database = longHistory(size);
        await withWorld({ database }, async (world) => {
          const mirror = world.newMirror();
          const rebuild = await timed(async () => {
            const result = await mirror.start();
            assert.equal(result.status, 'rebuilt');
          });
          await mirror.close();
          const compare = world.newMirror();
          const check = await timed(async () => {
            assert.equal((await compare.start()).status, 'unchanged');
          });
          const hash = await timed(async () => {
            historyContentHash(database);
          });
          rebuildMs.push(rebuild);
          assert.ok(rebuild < 30_000, `rebuild of ${size} sessions took ${Math.round(rebuild)} ms`);
          assert.ok(check < 15_000, `comparison of ${size} sessions took ${Math.round(check)} ms`);
          assert.ok(check < rebuild * 1.5 + 50, `the comparison (${Math.round(check)} ms) should not cost more than the rebuild (${Math.round(rebuild)} ms)`);
          assert.ok(hash < 5_000, `hashing ${size} sessions took ${Math.round(hash)} ms`);
          await compare.close();
        });
      }
      // Ten times the history is nowhere near a hundred times the time.
      assert.ok(rebuildMs[2] < Math.max(rebuildMs[0], 30) * 60, `rebuild grew faster than linearly: ${rebuildMs.map(Math.round).join(' / ')} ms`);
    },
  },
  {
    name: 'perfHistory: one commit costs the same on a long history as on a short one',
    async run() {
      const costs = [];
      for (const size of [300, 3000]) {
        await withWorld({ database: longHistory(size) }, async (world) => {
          const mirror = world.newMirror();
          await mirror.start();
          const db = world.state.database;
          const prepend = workoutSessionRepository.append(db, session(99_001));
          const edited = workoutSessionRepository.update(prepend, 'ws_5', { sessionNotes: 'edited' });
          const removed = workoutSessionRepository.remove(edited, 'ws_7');
          let total = 0;
          let previous = db;
          for (const next of [prepend, edited, removed]) {
            world.state.database = next;
            total += await timed(() => mirror.apply(previous, next));
            previous = next;
          }
          assert.ok(world.matches(), `store differs after the commits at ${size}`);
          costs.push(total);
        });
      }
      assert.ok(costs[1] < Math.max(costs[0] * 8, 400), `three commits cost ${Math.round(costs[0])} ms at 300 sessions and ${Math.round(costs[1])} ms at 3000`);
    },
  },
];
