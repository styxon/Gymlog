const assert = require('node:assert/strict');

const { loadWithRetry, LOAD_ATTEMPTS } = require('../../src/storage/loadWithRetry');

/**
 * Both providers wrote the same retry loop out in full; this is it, once.
 */

function scripted(outcomes) {
  let calls = 0;
  const load = async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };
  return { load, calls: () => calls };
}

module.exports = [
  {
    name: 'loadWithRetry: a busy store is tried again, with a growing wait',
    async run() {
      const waits = [];
      const errors = [];
      const store = scripted([new Error('locked'), new Error('busy'), 'db']);
      const result = await loadWithRetry(store.load, {
        isCancelled: () => false,
        onError: (error, attempt) => errors.push([error.message, attempt]),
        wait: async (ms) => {
          waits.push(ms);
        },
      });
      assert.deepEqual(result, { kind: 'loaded', value: 'db' });
      assert.equal(store.calls(), 3);
      assert.deepEqual(waits, [400, 800]);
      assert.deepEqual(errors, [['locked', 1], ['busy', 2]]);
    },
  },
  {
    name: 'loadWithRetry: three refusals are a failure, never an empty store',
    async run() {
      const refused = new Error('refused');
      const store = scripted([refused]);
      const waits = [];
      const result = await loadWithRetry(store.load, {
        isCancelled: () => false,
        wait: async (ms) => {
          waits.push(ms);
        },
      });
      assert.equal(LOAD_ATTEMPTS, 3);
      assert.deepEqual(result, { kind: 'failed', error: refused });
      assert.equal(store.calls(), 3);
      // No wait after the last attempt.
      assert.deepEqual(waits, [400, 800]);
    },
  },
  {
    name: 'loadWithRetry: a cancelled load does not land, at any await',
    async run() {
      // Cancelled while the read was out: the value is dropped.
      let cancelled = false;
      const late = await loadWithRetry(
        async () => {
          cancelled = true;
          return 'db';
        },
        { isCancelled: () => cancelled, wait: async () => {} },
      );
      assert.deepEqual(late, { kind: 'cancelled' });

      // Cancelled while waiting to retry: no second read.
      cancelled = false;
      const store = scripted([new Error('busy'), 'db']);
      const waiting = await loadWithRetry(store.load, {
        isCancelled: () => cancelled,
        wait: async () => {
          cancelled = true;
        },
      });
      assert.deepEqual(waiting, { kind: 'cancelled' });
      assert.equal(store.calls(), 1);

      // Cancelled when the read failed: no wait, no failure reported.
      cancelled = false;
      let waited = false;
      const failing = await loadWithRetry(
        async () => {
          cancelled = true;
          throw new Error('busy');
        },
        {
          isCancelled: () => cancelled,
          wait: async () => {
            waited = true;
          },
        },
      );
      assert.deepEqual(failing, { kind: 'cancelled' });
      assert.equal(waited, false);
    },
  },
];
