const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { createEmptyDatabase } = require('../../src/data/seed');
const seam = require('../../src/storage/historyMirror');

/**
 * The history mirror is a seam with nothing behind it yet. These pin what the
 * seam promises: with no mirror installed it does nothing at all, with one it is
 * told only after the blob write, and it never changes the outcome of a commit
 * or a reset.
 */

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8');
}

function recorder(overrides = {}) {
  const calls = [];
  const mirror = {
    calls,
    async apply(previous, next) {
      calls.push(['apply', previous, next]);
    },
    async replaceAll(next) {
      calls.push(['replaceAll', next]);
    },
    async clear() {
      calls.push(['clear']);
    },
    ...overrides,
  };
  return mirror;
}

function withMirror(mirror, body) {
  seam.setHistoryMirror(mirror);
  const restore = () => seam.setHistoryMirror(null);
  let result;
  try {
    result = body();
  } catch (error) {
    restore();
    throw error;
  }
  return Promise.resolve(result).finally(restore);
}

module.exports = [
  {
    name: 'historyMirror: the default is the no-op, and notifying it calls nothing',
    run() {
      assert.equal(seam.getHistoryMirror(), seam.noopHistoryMirror);
      let asked = false;
      seam.notifyHistoryMirror(() => {
        asked = true;
        return Promise.resolve();
      });
      assert.equal(asked, false, 'with no mirror installed the send function is never even called');
      assert.equal(seam.clearHistoryMirror(), null, 'a reset has nothing to wait for');
    },
  },
  {
    name: 'historyMirror: an installed mirror is told, a failure is dropped, and null restores the no-op',
    async run() {
      const good = recorder();
      await withMirror(good, async () => {
        seam.notifyHistoryMirror((mirror) => mirror.apply('a', 'b'));
        assert.deepEqual(good.calls, [['apply', 'a', 'b']]);
      });
      assert.equal(seam.getHistoryMirror(), seam.noopHistoryMirror);

      const rejecting = recorder({ apply: async () => Promise.reject(new Error('disk full')) });
      const throwing = recorder({
        apply() {
          throw new Error('native');
        },
      });
      for (const mirror of [rejecting, throwing]) {
        await withMirror(mirror, async () => {
          assert.doesNotThrow(() => seam.notifyHistoryMirror((m) => m.apply('a', 'b')));
          await new Promise((resolve) => setImmediate(resolve));
        });
      }
    },
  },
  {
    name: 'historyMirror: reset empties an installed mirror before the reset write, and a failing mirror does not block the reset',
    async run() {
      const fake = createFakeAsyncStorage();
      const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
      const before = createEmptyDatabase('en');
      await database.saveDatabase({ ...before, workoutSessions: [{ id: 's1', performedAt: '2026-09-15T09:00:00.000Z' }] });

      const order = [];
      for (const method of ['setItem', 'multiSet']) {
        const real = fake[method];
        fake[method] = async (...args) => {
          order.push('write');
          return real.apply(fake, args);
        };
      }
      const mirror = recorder({
        async clear() {
          order.push('clear');
        },
      });
      await withMirror(mirror, () => database.resetDatabase(before.preferences));
      assert.equal(order[0], 'clear', 'the mirror is emptied before any write of the reset blob');
      assert.ok(order.includes('write'));
      assert.equal((await database.loadDatabase()).workoutSessions.length, 0);

      const broken = recorder({ clear: async () => Promise.reject(new Error('locked')) });
      await withMirror(broken, () => database.resetDatabase(before.preferences));
      assert.equal((await database.loadDatabase()).workoutSessions.length, 0);
    },
  },
  {
    name: 'historyMirror: commit tells the mirror only after saveDatabase resolved, outside the rollback, without awaiting it',
    run() {
      const provider = source('src', 'state', 'AppProvider.tsx');
      const start = provider.indexOf('async function commit(');
      const end = provider.indexOf('const runExclusiveRef', start);
      assert.ok(start >= 0, 'anchor "async function commit(" not found');
      assert.ok(end > start, 'anchor "const runExclusiveRef" not found after commit');
      const body = provider.slice(start, end);
      const save = body.indexOf('await saveDatabase(');
      const rollback = body.indexOf('throw error;');
      const notify = body.indexOf('notifyHistoryMirror(');
      assert.ok(save > 0 && rollback > save && notify > rollback, 'order: save, then the catch that rolls back, then the mirror');
      assert.doesNotMatch(body, /await\s+(notifyHistoryMirror|mirror\.)/, 'the mirror is never awaited on the commit path');
      assert.match(body, /options\.replaceAll \? mirror\.replaceAll\(nextDatabase\) : mirror\.apply\(previous, nextDatabase\)/);
      assert.equal(body.split('notifyHistoryMirror(').length, 2, 'one call site');
    },
  },
  {
    name: 'historyMirror: a restore and its rollback swap the whole database; every other commit is a diff',
    run() {
      const provider = source('src', 'state', 'AppProvider.tsx');
      const restoreStart = provider.indexOf('function restoreDatabaseFromBackup(');
      const restoreEnd = provider.indexOf("A session's logs");
      assert.ok(restoreStart >= 0, 'anchor "function restoreDatabaseFromBackup(" not found');
      assert.ok(restoreEnd > restoreStart, 'anchor "A session\'s logs" not found after restore');
      const restore = provider.slice(restoreStart, restoreEnd);
      assert.match(restore, /await commit\(exact, \{ replaceAll: true \}\)/);
      assert.match(restore, /await commit\(next, \{ replaceAll: true \}\)/);
      assert.equal(provider.split('replaceAll: true').length - 1, 2, 'no other caller asks for a replacement');
    },
  },
  {
    name: 'historyMirror: the seam is reached from the app only through commit and resetDatabase, and loads nothing native',
    run() {
      const seamSource = source('src', 'storage', 'historyMirror.ts');
      assert.doesNotMatch(seamSource, /^import (?!type )/m, 'type imports only: no module is pulled in at load');
      assert.match(source('src', 'storage', 'database.ts'), /const mirrorCleared = clearHistoryMirror\(\);[\s\S]*await saveDatabase\(empty, \{ withPreferences: true \}\)/);
    },
  },
  {
    name: 'historyMirror: two overlapping commits reach a slow mirror in order, one at a time',
    async run() {
      const events = [];
      let running = 0;
      let overlapped = false;
      const slow = recorder({
        async apply(previous, next) {
          running += 1;
          overlapped = overlapped || running > 1;
          events.push(`start ${next}`);
          await new Promise((resolve) => setTimeout(resolve, next === 'first' ? 30 : 1));
          events.push(`end ${next}`);
          running -= 1;
        },
      });
      await withMirror(slow, async () => {
        seam.notifyHistoryMirror((m) => m.apply('a', 'first'));
        seam.notifyHistoryMirror((m) => m.apply('first', 'second'));
        await seam.clearHistoryMirror();
      });
      assert.deepEqual(events, ['start first', 'end first', 'start second', 'end second']);
      assert.equal(overlapped, false);
    },
  },
  {
    name: 'historyMirror: a reset after an unfinished apply runs clear after it',
    async run() {
      const events = [];
      const mirror = recorder({
        async apply() {
          events.push('apply start');
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push('apply end');
        },
        async clear() {
          events.push('clear');
        },
      });
      await withMirror(mirror, async () => {
        seam.notifyHistoryMirror((m) => m.apply('a', 'b'));
        const cleared = seam.clearHistoryMirror();
        assert.ok(cleared, 'a mirror is installed, so there is something to wait for');
        await cleared;
      });
      assert.deepEqual(events, ['apply start', 'apply end', 'clear']);
    },
  },
  {
    name: 'historyMirror: reset waits for a slow clear to settle before the reset write',
    async run() {
      const fake = createFakeAsyncStorage();
      const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'), { locale: 'en_US' });
      const before = createEmptyDatabase('en');
      await database.saveDatabase({ ...before, workoutSessions: [{ id: 's1', performedAt: '2026-09-15T09:00:00.000Z' }] });

      const order = [];
      for (const method of ['setItem', 'multiSet']) {
        const real = fake[method];
        fake[method] = async (...args) => {
          order.push('write');
          return real.apply(fake, args);
        };
      }
      const mirror = recorder({
        async clear() {
          order.push('clear start');
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push('clear end');
        },
      });
      await withMirror(mirror, () => database.resetDatabase(before.preferences));
      assert.deepEqual(order.slice(0, 2), ['clear start', 'clear end'], 'no write of the reset blob while the clear is still running');
      assert.ok(order.includes('write'));
    },
  },
  {
    name: 'historyMirror: once the chain has drained, the next call starts at once',
    async run() {
      const mirror = recorder();
      await withMirror(mirror, async () => {
        seam.notifyHistoryMirror((m) => m.apply('a', 'one'));
        await seam.clearHistoryMirror();
        const before = mirror.calls.length;
        seam.notifyHistoryMirror((m) => m.apply('a', 'two'));
        assert.equal(mirror.calls.length, before + 1, 'an idle chain reaches the mirror synchronously, not a microtask later');
        await seam.clearHistoryMirror();
      });
    },
  },
  {
    name: 'historyMirror: a rejecting or throwing call does not break later calls',
    async run() {
      let n = 0;
      const seen = [];
      const mirror = recorder({
        async apply(previous, next) {
          n += 1;
          if (n === 1) {
            throw new Error('disk full');
          }
          if (n === 2) {
            return Promise.reject(new Error('locked'));
          }
          seen.push(next);
        },
      });
      await withMirror(mirror, async () => {
        seam.notifyHistoryMirror((m) => m.apply('a', 'one'));
        seam.notifyHistoryMirror((m) => m.apply('a', 'two'));
        seam.notifyHistoryMirror(() => {
          throw new Error('sync');
        });
        seam.notifyHistoryMirror((m) => m.apply('a', 'three'));
        await seam.clearHistoryMirror();
      });
      assert.deepEqual(seen, ['three']);
      assert.ok(mirror.calls.some((c) => c[0] === 'clear'), 'clear still ran after the failures');
    },
  },
];
