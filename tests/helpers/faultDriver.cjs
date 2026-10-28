const { nodeSqliteOpener } = require('./nodeSqliteDriver.cjs');

/**
 * A SqlOpener that wraps the node:sqlite driver and breaks it on command.
 *
 * Every call that reaches the engine counts as one STEP: opening a
 * connection, each exec/run/all, the BEGIN of a transaction, its COMMIT, and
 * closing. A test arms one of two faults by step number:
 *
 * - failAt(n): the n-th step from now throws once (a disk-full, a locked
 *   file) and the process lives on, so the code under test must cope.
 * - crashAt(n): the process DIES at the n-th step, before it runs. Every
 *   connection is closed on the spot (an open transaction is rolled back, as a
 *   kill leaves it) and from then on every call, from this opener and from the
 *   guard store made by world.guardStore(), throws: whatever the dying code
 *   tries next never reaches the disk. revive() starts the "next launch".
 *
 * The same pattern as faults.multiSet / killAfterFiles in
 * tests/storage/fakeAsyncStorage.cjs, for SQL.
 */
class InjectedCrash extends Error {
  constructor(step) {
    super(`injected crash at step ${step}`);
    this.name = 'InjectedCrash';
  }
}

class InjectedFailure extends Error {
  constructor(step) {
    super(`injected IO failure at step ${step}`);
    this.name = 'InjectedFailure';
  }
}

function createFaultWorld(file) {
  const base = nodeSqliteOpener(file);
  const connections = new Set();
  const world = {
    file,
    steps: 0,
    dead: false,
    failAtStep: null,
    crashAtStep: null,
    log: [],

    /** The n-th step from now fails once. */
    failAt(n) {
      world.failAtStep = world.steps + n;
    },
    /** The process dies at the n-th step from now. */
    crashAt(n) {
      world.crashAtStep = world.steps + n;
    },
    disarm() {
      world.failAtStep = null;
      world.crashAtStep = null;
    },
    /** The next launch: alive again, nothing armed, connections gone. */
    revive() {
      world.kill();
      world.dead = false;
      world.disarm();
    },
    kill() {
      world.dead = true;
      for (const connection of [...connections]) {
        try {
          if (connection.raw.isOpen) {
            connection.raw.close();
          }
        } catch {
          // Already gone.
        }
      }
      connections.clear();
    },
    step(label) {
      if (world.dead) {
        throw new InjectedCrash(world.steps);
      }
      world.steps += 1;
      world.log.push(label);
      if (world.crashAtStep !== null && world.steps === world.crashAtStep) {
        world.kill();
        throw new InjectedCrash(world.steps);
      }
      if (world.failAtStep !== null && world.steps === world.failAtStep) {
        world.failAtStep = null;
        throw new InjectedFailure(world.steps);
      }
    },
    /** Wrap a key-value guard store so it dies with the process. */
    guardStore(store) {
      return {
        async read() {
          if (world.dead) throw new InjectedCrash(world.steps);
          return store.read();
        },
        async write(value) {
          if (world.dead) throw new InjectedCrash(world.steps);
          return store.write(value);
        },
      };
    },
    opener: {
      async open() {
        world.step('open');
        const connection = await base.open();
        connections.add(connection);
        const exec = (sql) => {
          world.step(`exec ${sql.slice(0, 40)}`);
          return connection.exec(sql);
        };
        const run = (sql, params) => {
          world.step(`run ${sql.slice(0, 40)}`);
          return connection.run(sql, params);
        };
        const all = (sql, params) => {
          world.step(`all ${sql.slice(0, 40)}`);
          return connection.all(sql, params);
        };
        const executor = { exec, run, all };
        return {
          raw: connection.raw,
          ...executor,
          async transaction(work) {
            world.step('begin');
            await connection.raw.exec('BEGIN IMMEDIATE');
            let result;
            try {
              result = await work(executor);
            } catch (error) {
              try {
                connection.raw.exec('ROLLBACK');
              } catch {
                // A killed connection has nothing to roll back.
              }
              throw error;
            }
            world.step('commit');
            connection.raw.exec('COMMIT');
            return result;
          },
          async close() {
            if (world.dead) {
              throw new InjectedCrash(world.steps);
            }
            await connection.close();
            connections.delete(connection);
          },
        };
      },
      async destroy() {
        world.step('destroy');
        for (const connection of [...connections]) {
          try {
            connection.raw.close();
          } catch {
            // Already closed.
          }
        }
        connections.clear();
        await base.destroy();
      },
    },
  };
  return world;
}

module.exports = { createFaultWorld, InjectedCrash, InjectedFailure };
