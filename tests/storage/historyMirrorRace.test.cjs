const assert = require('node:assert/strict');

const { workoutSessionRepository } = require('../../src/storage/repositories');
const { makeDatabase, session, withWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The mirror's rebuild and a commit's apply never interleave. The app does not
 * wait for the mirror, so a commit can land while a rebuild is half way; the
 * queue runs them one after the other, and the rebuild copies the newest memory
 * taken inside the queue, not the memory of the moment it was asked for.
 */

/** An opener that reports any transaction that starts while another is open, or a bare call during one. */
function watchedOpener(world, report) {
  const state = { activeTransactions: 0 };
  return {
    state,
    destroy: world.faults.opener.destroy,
    async open() {
      const real = await world.faults.opener.open();
      const check = (what) => {
        if (state.activeTransactions > 0) {
          report.push(`${what} while a transaction was open on another path`);
        }
      };
      return {
        ...real,
        exec: (...args) => (check('exec'), real.exec(...args)),
        run: (...args) => (check('run'), real.run(...args)),
        all: (...args) => (check('all'), real.all(...args)),
        async transaction(work) {
          if (state.activeTransactions > 0) {
            report.push('two transactions at once');
          }
          state.activeTransactions += 1;
          try {
            return await real.transaction(work);
          } finally {
            state.activeTransactions -= 1;
          }
        },
      };
    },
  };
}

module.exports = [
  {
    name: 'historyMirror race: commits fired while the first rebuild runs land after it, in order, and the store equals memory',
    async run() {
      await withWorld({ database: makeDatabase(150) }, async (world) => {
        const report = [];
        const mirror = world.newMirror({ opener: watchedOpener(world, report) });
        const started = mirror.start();
        let applies = [];
        for (let i = 0; i < 12; i += 1) {
          const previous = world.state.database;
          const next = i % 3 === 2 ? workoutSessionRepository.remove(previous, previous.workoutSessions[0].id) : workoutSessionRepository.append(previous, session(500 + i));
          world.state.database = next;
          applies.push(mirror.apply(previous, next));
        }
        const result = await started;
        await Promise.all(applies);
        assert.equal(result.status, 'rebuilt');
        assert.deepEqual(report, []);
        assert.ok(world.matches(), 'the store differs from the newest memory');
      });
    },
  },
  {
    name: 'historyMirror race: a rebuild copies the memory of the moment it runs, not the moment it was asked for',
    async run() {
      await withWorld({ database: makeDatabase(5) }, async (world) => {
        const first = world.state.database;
        const mirror = world.newMirror();
        const started = mirror.start();
        // Memory moves on before the queue has begun.
        const second = workoutSessionRepository.append(first, session(900));
        world.state.database = second;
        await started;
        assert.ok(world.matches(second));
        // The apply for that commit, arriving late, finds nothing left to do.
        const steps = world.faults.steps;
        await mirror.apply(first, second);
        assert.equal(world.faults.steps, steps);
        assert.ok(world.matches(second));
      });
    },
  },
  {
    name: 'historyMirror race: applies that arrive before the start are covered by the start, not lost or doubled',
    async run() {
      await withWorld({ database: makeDatabase(4) }, async (world) => {
        const mirror = world.newMirror();
        const before = world.state.database;
        const after = workoutSessionRepository.append(before, session(901));
        world.state.database = after;
        await mirror.apply(before, after);
        assert.equal(world.faults.steps, 0, 'nothing opened yet, nothing written');
        await mirror.start();
        assert.ok(world.matches(after));
      });
    },
  },
  {
    name: 'historyMirror race: a restore in the middle of commits leaves the store equal to the newest memory',
    async run() {
      await withWorld({ database: makeDatabase(6) }, async (world) => {
        const report = [];
        const mirror = world.newMirror({ opener: watchedOpener(world, report) });
        await mirror.start();
        const jobs = [];
        let db = world.state.database;
        for (let i = 0; i < 4; i += 1) {
          const next = workoutSessionRepository.append(db, session(700 + i));
          world.state.database = next;
          jobs.push(mirror.apply(db, next));
          db = next;
        }
        const restored = makeDatabase(9);
        world.state.database = restored;
        jobs.push(mirror.replaceAll(restored));
        db = restored;
        for (let i = 0; i < 3; i += 1) {
          const next = workoutSessionRepository.append(db, session(800 + i));
          world.state.database = next;
          jobs.push(mirror.apply(db, next));
          db = next;
        }
        await Promise.all(jobs);
        assert.deepEqual(report, []);
        assert.ok(world.matches(db));
      });
    },
  },
  {
    name: 'historyMirror race: a start asked for twice opens once',
    async run() {
      await withWorld({}, async (world) => {
        let opens = 0;
        const opener = {
          destroy: world.faults.opener.destroy,
          open: async () => {
            opens += 1;
            return world.faults.opener.open();
          },
        };
        const mirror = world.newMirror({ opener });
        const [a, b] = await Promise.all([mirror.start(), mirror.start()]);
        assert.equal(a.status, 'rebuilt');
        assert.equal(b.status, 'unchanged');
        // One main connection and one verifier for the rebuild.
        assert.equal(opens, 2);
      });
    },
  },
];
