const assert = require('node:assert/strict');
const path = require('node:path');

const { requireWithStubs } = require('../../helpers/hookHarness.cjs');
const { createFakeAsyncStorage } = require('../../storage/fakeAsyncStorage.cjs');

const STORE = path.join(__dirname, '..', '..', '..', 'src', 'features', 'account', 'accountStore.js');
const KEY = '@vinha/account/signedout/v1';

/**
 * The real store behind "whose data is on this phone", against in-memory
 * AsyncStorage. The hook suite stubs it, so its reading of old and broken
 * rows was run nowhere (review of the invariant fix, 2026-09-28).
 */
function load() {
  const fake = createFakeAsyncStorage();
  const store = requireWithStubs(STORE, {
    '@react-native-async-storage/async-storage': { __esModule: true, default: fake },
  });
  return { fake, store };
}

module.exports = [
  {
    name: 'signed-out accounts: each sign-out is added once, and forgetting clears them all',
    async run() {
      const { fake, store } = load();
      assert.deepEqual(await store.loadSignedOutAccounts(), []);
      await store.rememberSignedOutAccount('a');
      await store.rememberSignedOutAccount('b');
      await store.rememberSignedOutAccount('a');
      assert.deepEqual(await store.loadSignedOutAccounts(), ['a', 'b']);
      await store.forgetSignedOutAccount();
      assert.deepEqual(await store.loadSignedOutAccounts(), []);
      assert.equal(fake.rows.has(KEY), false);
    },
  },
  {
    // The same day's earlier build stored one bare identifier.
    name: 'signed-out accounts: a bare identifier from the earlier build reads as one account, and the next sign-out adds to it',
    async run() {
      const { fake, store } = load();
      fake.rows.set(KEY, 'sub-old');
      assert.deepEqual(await store.loadSignedOutAccounts(), ['sub-old']);
      await store.rememberSignedOutAccount('sub-new');
      assert.deepEqual(await store.loadSignedOutAccounts(), ['sub-old', 'sub-new']);
    },
  },
  {
    name: 'signed-out accounts: a broken row reads as unknown (it asks), never as nobody, and junk entries are dropped',
    async run() {
      const { fake, store } = load();
      const unknown = [store.UNKNOWN_SIGNED_OUT_ACCOUNT];
      fake.rows.set(KEY, '[not json');
      assert.deepEqual(await store.loadSignedOutAccounts(), unknown);
      fake.rows.set(KEY, JSON.stringify(['a', 3, null, '', 'b']));
      assert.deepEqual(await store.loadSignedOutAccounts(), ['a', 'b']);
      fake.rows.set(KEY, JSON.stringify({ a: 1 }));
      assert.deepEqual(await store.loadSignedOutAccounts(), unknown);
      fake.rows.set(KEY, JSON.stringify([3, null]));
      assert.deepEqual(await store.loadSignedOutAccounts(), unknown);
    },
  },
  {
    name: 'signed-out accounts: an unreadable list asks (unknown) and is never rewritten from nothing',
    async run() {
      const { fake, store } = load();
      await store.rememberSignedOutAccount('a');
      const row = fake.rows.get(KEY);
      const realGet = fake.getItem;
      fake.getItem = async (key) => {
        if (key === KEY) {
          throw new Error('Row too big to fit into CursorWindow');
        }
        return realGet.call(fake, key);
      };
      // Fail closed: "could not read" is somebody's data, not nobody's.
      assert.deepEqual(await store.loadSignedOutAccounts(), [store.UNKNOWN_SIGNED_OUT_ACCOUNT]);
      // And a remember on top of it does not replace the entries with [sub].
      await assert.rejects(() => store.rememberSignedOutAccount('b'));
      assert.equal(fake.rows.get(KEY), row, 'the list was rewritten after a failed read');
      fake.getItem = realGet;
      assert.deepEqual(await store.loadSignedOutAccounts(), ['a']);
      // An unknown mark survives the next sign-out being added to it.
      fake.rows.set(KEY, '[not json');
      await store.rememberSignedOutAccount('b');
      assert.deepEqual(await store.loadSignedOutAccounts(), [store.UNKNOWN_SIGNED_OUT_ACCOUNT, 'b']);
    },
  },
];
