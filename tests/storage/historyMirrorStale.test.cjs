const assert = require('node:assert/strict');
const fs = require('node:fs');

const { workoutSessionRepository } = require('../../src/storage/repositories');
const seam = require('../../src/storage/historyMirror');
const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { createEmptyDatabase } = require('../../src/data/seed');
const { makeDatabase, session, storeTexts, withWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The mirror falls behind: a write to it fails after the blob write already
 * resolved. The commit has succeeded and stays succeeded (memory does not roll
 * back, the blob is written), the mirror marks itself stale in the guard row,
 * stops applying, and the next launch rebuilds it from memory.
 */

async function commit(world, mirror, next) {
  const previous = world.state.database;
  world.state.database = next;
  await mirror.apply(previous, next);
}

module.exports = [
  {
    name: 'historyMirror stale: a failed apply does not reject, does not undo memory, and marks the guard stale',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        const next = workoutSessionRepository.append(world.state.database, session(70));
        world.faults.failAt(3);
        await assert.doesNotReject(commit(world, mirror, next));
        assert.equal(world.state.database, next, 'memory is what the commit made it');
        assert.equal(world.guardState().stale, true);
        assert.equal(world.matches(), false, 'the mirror is behind');

        // While stale it stops applying: a later commit writes nothing (and cannot make a hole).
        const steps = world.faults.steps;
        await commit(world, mirror, workoutSessionRepository.append(next, session(71)));
        assert.equal(world.faults.steps, steps);

        // The next launch repairs it.
        await mirror.close();
        const again = world.newMirror();
        const result = await again.start();
        assert.equal(result.status, 'rebuilt');
        assert.equal(result.reason, 'stale');
        assert.ok(world.matches());
        assert.equal(world.guardState().stale, false);
        assert.equal(world.meta().last_rebuild_reason, 'stale');
      });
    },
  },
  {
    name: 'historyMirror stale: the same, through the seam (the way commit calls it)',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        seam.setHistoryMirror(mirror);
        try {
          const previous = world.state.database;
          const next = workoutSessionRepository.append(previous, session(72));
          world.state.database = next;
          world.faults.failAt(2);
          assert.doesNotThrow(() => seam.notifyHistoryMirror((m) => m.apply(previous, next)));
          await mirror.close();
        } finally {
          seam.setHistoryMirror(null);
        }
        assert.equal(world.guardState().stale, true);
        const again = world.newMirror();
        assert.equal((await again.start()).status, 'rebuilt');
        assert.ok(world.matches());
      });
    },
  },
  {
    name: 'historyMirror stale: a failed restore swap leaves the guard stale, and the next launch rebuilds',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        const restored = makeDatabase(5);
        world.state.database = restored;
        world.faults.failAt(6);
        await mirror.replaceAll(restored);
        assert.equal(world.guardState().stale, true);
        await mirror.close();
        const again = world.newMirror();
        assert.equal((await again.start()).status, 'rebuilt');
        assert.ok(world.matches(restored));
      });
    },
  },
  {
    name: 'historyMirror stale: a rebuild that fails three times in a row switches the mirror off',
    async run() {
      await withWorld({}, async (world) => {
        // Every rebuild fails at the same point: the write of the rows.
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const mirror = world.newMirror();
          world.faults.failAt(30);
          const result = await mirror.start();
          assert.equal(result.status, 'failed', `attempt ${attempt}`);
          assert.equal(world.guardState().rebuildFailures, attempt);
          await mirror.close();
          world.faults.disarm();
        }
        assert.equal(world.guardState().disabled, true);
        assert.equal(world.meta().state, 'writing', 'the store says it was never finished');

        // Switched off: it opens nothing, applies nothing, and a start says so.
        const off = world.newMirror();
        const steps = world.faults.steps;
        assert.equal((await off.start()).status, 'disabled');
        await commit(world, off, workoutSessionRepository.append(world.state.database, session(73)));
        await off.replaceAll(world.state.database);
        assert.equal(world.faults.steps, steps, 'a switched-off mirror touches nothing');
      });
    },
  },
  {
    name: 'historyMirror stale: a rebuild that fails once and then succeeds clears the failure count',
    async run() {
      await withWorld({}, async (world) => {
        const first = world.newMirror();
        world.faults.failAt(30);
        assert.equal((await first.start()).status, 'failed');
        assert.equal(world.guardState().rebuildFailures, 1);
        await first.close();
        const second = world.newMirror();
        assert.equal((await second.start()).status, 'rebuilt');
        const guard = world.guardState();
        assert.equal(guard.rebuildFailures, 0);
        assert.equal(guard.stale, false);
        assert.equal(guard.disabled, false);
        assert.ok(world.matches());
      });
    },
  },
  {
    name: 'historyMirror stale: a read-back that differs from memory fails the rebuild (verification is not decoration)',
    async run() {
      await withWorld({}, async (world) => {
        // A driver that corrupts what it stores: every session row loses a character.
        const opener = {
          async open() {
            const real = await world.faults.opener.open();
            return {
              ...real,
              transaction: (work) =>
                real.transaction((tx) =>
                  work({
                    ...tx,
                    run: (sql, params) =>
                      tx.run(
                        sql,
                        /^INSERT INTO workout_sessions/.test(sql)
                          ? params.map((value, index) =>
                              index === params.length - 1 && typeof value === 'string' ? value.replace('Workout', 'Workou') : value,
                            )
                          : params,
                      ),
                  }),
                ),
            };
          },
          destroy: world.faults.opener.destroy,
        };
        const mirror = world.newMirror({ opener });
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.notEqual(world.meta().state, 'verified');
        assert.equal(world.guardState().stale, true);
      });
    },
  },
  {
    name: 'historyMirror stale: reset with a real mirror installed empties its rows before the reset write, and survives a failing mirror',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        assert.ok(world.matches());

        const fake = createFakeAsyncStorage();
        const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
        const empty = createEmptyDatabase('en');
        await database.saveDatabase({ ...empty, workoutSessions: world.state.database.workoutSessions });

        seam.setHistoryMirror(mirror);
        try {
          let rowsAtFirstWrite = null;
          const realMultiSet = fake.multiSet;
          fake.multiSet = async (...args) => {
            if (rowsAtFirstWrite === null) {
              rowsAtFirstWrite = storeTexts(world.file);
            }
            return realMultiSet.apply(fake, args);
          };
          await database.resetDatabase(empty.preferences);
          assert.ok(rowsAtFirstWrite, 'the reset wrote something');
          assert.ok(
            Object.values(rowsAtFirstWrite).every((rows) => rows.length === 0),
            'the mirror was already empty when the reset write began',
          );
          assert.equal((await database.loadDatabase()).workoutSessions.length, 0);

          // A mirror that cannot clear does not block a reset.
          await mirror.close();
          const broken = world.newMirror();
          await broken.start();
          seam.setHistoryMirror(broken);
          world.faults.failAt(2);
          await database.resetDatabase(empty.preferences);
          assert.equal((await database.loadDatabase()).workoutSessions.length, 0);
        } finally {
          seam.setHistoryMirror(null);
        }
      });
    },
  },
  {
    name: 'historyMirror restart: rows are bound in ord order, not row_key order (a prepend then a delete after a restart)',
    async run() {
      await withWorld({}, async (world) => {
        const first = world.newMirror();
        await first.start();
        // The prepended session gets the lowest ord but the highest row_key.
        await commit(world, first, workoutSessionRepository.append(world.state.database, session(70)));
        assert.ok(world.matches());
        await first.close();

        const second = world.newMirror();
        assert.equal((await second.start()).status, 'unchanged');
        const [, ...rest] = world.state.database.workoutSessions;
        await commit(world, second, { ...world.state.database, workoutSessions: rest });
        assert.ok(world.matches(), 'the prepended row went, not another');
      });
    },
  },
  {
    name: 'historyMirror replaceAll: with no connection it does nothing and cannot count toward the kill switch',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        const steps = world.faults.steps;
        for (let i = 0; i < 5; i += 1) {
          await mirror.replaceAll(makeDatabase(2));
        }
        assert.equal(world.guard.cell.value, null, 'the guard row was never written');
        assert.equal(world.faults.steps, steps);
        assert.equal((await mirror.start()).status, 'rebuilt', 'the mirror still starts');
      });
    },
  },
  {
    name: 'historyMirror clear: a failure marks the guard stale and propagates, at every step',
    async run() {
      let rejected = 0;
      for (let step = 1; step <= 12; step += 1) {
        await withWorld({}, async (world) => {
          const mirror = world.newMirror();
          await mirror.start();
          world.faults.failAt(step);
          let failed = false;
          try {
            await mirror.clear();
          } catch {
            failed = true;
          }
          world.faults.disarm();
          if (failed) {
            rejected += 1;
            assert.equal(world.guardState().stale, true, `step ${step}`);
            // And it stops applying until the next start rebuilds.
            const steps = world.faults.steps;
            await commit(world, mirror, workoutSessionRepository.append(world.state.database, session(80)));
            assert.equal(world.faults.steps, steps, `step ${step}`);
          }
        });
      }
      assert.ok(rejected >= 6, `clear failed at ${rejected} steps`);
    },
  },
  {
    name: 'historyMirror clear: a busy checkpoint is a failure (deleted rows must not stay in the log)',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        const reader = await world.faults.opener.open();
        await reader.exec('BEGIN');
        await reader.all('SELECT COUNT(*) FROM workout_sessions');
        try {
          await assert.rejects(mirror.clear());
          assert.equal(world.guardState().stale, true);
        } finally {
          await reader.exec('ROLLBACK');
          await reader.close();
        }
      });
    },
  },
  {
    name: 'historyMirror replaceAll: a busy checkpoint after the rewrite fails the rebuild',
    async run() {
      await withWorld({}, async (world) => {
        const mirror = world.newMirror();
        await mirror.start();
        const reader = await world.faults.opener.open();
        await reader.exec('BEGIN');
        await reader.all('SELECT COUNT(*) FROM workout_sessions');
        try {
          await mirror.replaceAll(makeDatabase(1));
          assert.equal(world.guardState().stale, true);
          assert.equal(world.guardState().rebuildFailures, 1);
        } finally {
          await reader.exec('ROLLBACK');
          await reader.close();
        }
      });
    },
  },
  {
    name: 'historyMirror clear: a switched-off mirror whose file cannot be removed removes it at the next start',
    async run() {
      await withWorld({}, async (world) => {
        // Switched off by the crash guard, with a populated file left behind.
        const seed = world.newMirror();
        await seed.start();
        await seed.close();
        assert.ok(world.matches());
        world.guard.cell.value = JSON.stringify({ attempt: 0, crashes: 2, rebuildFailures: 0, disabled: true, stale: false });

        const off = world.newMirror();
        assert.equal((await off.start()).status, 'disabled');
        world.faults.failAt(1);
        await off.clear();
        world.faults.disarm();
        assert.equal(world.guardState().purgePending, true);
        assert.ok(world.matches(), 'the destroy failed, rows are still there');

        // The same launch, then the next launch: either one removes the file.
        assert.equal((await off.start()).status, 'disabled');
        assert.equal(world.guardState().purgePending, false);
        assert.ok(!fs.existsSync(world.file), 'the history file is gone');
      });
    },
  },
  {
    name: 'historyMirror clear: the removal is retried by a later launch, not only the same one',
    async run() {
      await withWorld({}, async (world) => {
        const seed = world.newMirror();
        await seed.start();
        await seed.close();
        world.guard.cell.value = JSON.stringify({ attempt: 0, crashes: 2, rebuildFailures: 0, disabled: true, stale: false, purgePending: true });
        const next = world.newMirror();
        assert.equal((await next.start()).status, 'disabled');
        assert.ok(!fs.existsSync(world.file));
        assert.equal(world.guardState().purgePending, false);
        assert.equal(world.guardState().disabled, true, 'it stays off');
      });
    },
  },
];
