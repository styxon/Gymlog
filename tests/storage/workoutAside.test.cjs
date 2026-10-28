const assert = require('node:assert/strict');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');
const { STORAGE_CHUNK_CHARS } = require('../../src/lib/storageChunks');

/**
 * Putting the workout bundle aside from the crash screen (2026-10-03).
 *
 * The rule under test: the live bundle is removed only after its copy has
 * resolved, and a copy that fails leaves the live data exactly as it was.
 */

const LIVE = '@vinha/workout/v1';
const LEGACY = '@gymlog/workout/v1';
const ASIDE = '@vinha/workout/aside';

function load() {
  const fake = createFakeAsyncStorage();
  // One require pass, so the module under test and `large` share a largeItem.
  const { aside, large } = loadAgainstFake(fake, (requireDist) => ({
    aside: requireDist('storage/workoutAside.js'),
    large: requireDist('storage/largeItem.js'),
  }));
  return { fake, ...aside, large };
}

const bundle = JSON.stringify({ activeSession: { id: 's1' }, history: { sessions: [], slotHistory: {} } });

module.exports = [
  {
    name: 'workout aside: the bundle is copied under its own key, then the live key goes; nothing else is touched',
    async run() {
      const { fake, setWorkoutBundleAside, hasWorkoutToPutAside } = load();
      fake.rows.set(LIVE, bundle);
      fake.rows.set('@vinha/database/v1', '{"db":true}');

      assert.equal(await hasWorkoutToPutAside(), true);
      assert.equal(await setWorkoutBundleAside(), true);

      assert.equal(fake.rows.get(ASIDE), bundle, 'the copy is byte for byte');
      assert.equal(fake.rows.has(LIVE), false);
      assert.equal(fake.rows.get('@vinha/database/v1'), '{"db":true}', 'the database is not the workout');
      assert.equal(await hasWorkoutToPutAside(), false);
    },
  },
  {
    name: 'workout aside: a copy that fails keeps the live bundle, rejects, and removes nothing',
    async run() {
      const { fake, setWorkoutBundleAside } = load();
      fake.rows.set(LIVE, bundle);
      const order = [];
      const setItem = fake.setItem;
      const removeItem = fake.removeItem;
      fake.setItem = async (key, value) => {
        order.push(`set ${key}`);
        if (key === ASIDE) {
          throw new Error('database or disk is full');
        }
        return setItem(key, value);
      };
      fake.removeItem = async (key) => {
        order.push(`remove ${key}`);
        return removeItem(key);
      };

      await assert.rejects(setWorkoutBundleAside(), /disk is full/);

      assert.equal(fake.rows.get(LIVE), bundle, 'the live bundle moved though the copy failed');
      assert.equal(fake.rows.has(ASIDE), false);
      assert.deepEqual(order.filter((step) => step.startsWith('remove')), [], 'something was removed after a failed copy');
    },
  },
  {
    name: 'workout aside: the live key is removed only after the copy resolved (a slow copy still sees the live rows)',
    async run() {
      const { fake, setWorkoutBundleAside } = load();
      fake.rows.set(LIVE, bundle);
      const setItem = fake.setItem;
      let liveWhileCopying = null;
      fake.setItem = async (key, value) => {
        if (key === ASIDE) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          liveWhileCopying = fake.rows.get(LIVE);
        }
        return setItem(key, value);
      };
      await setWorkoutBundleAside();
      assert.equal(liveWhileCopying, bundle);
      assert.equal(fake.rows.has(LIVE), false);
    },
  },
  {
    name: 'workout aside: a long bundle in parts is copied whole and every live part goes',
    async run() {
      const { fake, large, setWorkoutBundleAside } = load();
      const big = JSON.stringify({ activeSession: { id: 'big' }, body: '€'.repeat(STORAGE_CHUNK_CHARS * 3) });
      await large.setLargeItem(LIVE, big);
      assert.ok([...fake.rows.keys()].some((key) => key.startsWith(`${LIVE}#`)), 'the fixture was not split');

      assert.equal(await setWorkoutBundleAside(), true);

      assert.equal(await large.getLargeItem(ASIDE), big);
      assert.deepEqual([...fake.rows.keys()].filter((key) => key.startsWith(`${LIVE}`)), []);
    },
  },
  {
    name: 'workout aside: a bundle only under the pre-rename key is moved too, and no bundle is a no-op',
    async run() {
      const { fake, setWorkoutBundleAside, hasWorkoutToPutAside } = load();
      assert.equal(await hasWorkoutToPutAside(), false, 'nothing stored: the screen hides the action');
      assert.equal(await setWorkoutBundleAside(), false);
      assert.equal(fake.rows.size, 0, 'no copy of nothing');

      fake.rows.set(LEGACY, bundle);
      assert.equal(await setWorkoutBundleAside(), true);
      assert.equal(fake.rows.get(ASIDE), bundle);
      assert.equal(fake.rows.has(LEGACY), false, 'left behind, it would load again as the live bundle');
    },
  },
  {
    name: 'workout aside: a damaged split bundle is kept as the readable remains, never dropped',
    async run() {
      const { fake, setWorkoutBundleAside } = load();
      fake.rows.set(LIVE, 'vinha-chunks:3:700000');
      fake.rows.set(`${LIVE}#0`, '{"a":"part zero"}');

      assert.equal(await setWorkoutBundleAside(), true);
      assert.ok(fake.rows.get(ASIDE).includes('part zero'), 'the part that was there is not in the copy');
      assert.equal(fake.rows.has(LIVE), false);
    },
  },
  {
    name: 'workout aside: a second use never overwrites the first copy — an empty bundle saved after the remount is not copied and not offered',
    async run() {
      // The review's repro: aside, the remount hydrates an empty bundle and the
      // provider saves it, a crash from elsewhere shows the action again.
      const { fake, large, setWorkoutBundleAside, hasWorkoutToPutAside } = load();
      fake.rows.set(LIVE, bundle);
      await setWorkoutBundleAside();

      const empty = JSON.stringify({
        activeSession: null,
        history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
        activeCardio: null,
        freestyleDraft: null,
      });
      await large.setLargeItem(LIVE, empty);

      assert.equal(await hasWorkoutToPutAside(), false, 'an empty bundle offers nothing to put aside');
      await setWorkoutBundleAside();
      assert.equal(fake.rows.get(ASIDE), bundle, 'the only copy of the real workout was overwritten');
      assert.equal(fake.rows.has(`${ASIDE}/1`), false, 'an empty bundle was copied to a slot of its own');
      assert.equal(fake.rows.has(LIVE), false);
    },
  },
  {
    name: 'workout aside: a second non-empty bundle goes to its own slot beside the first, and a retry does not copy twice',
    async run() {
      const { fake, setWorkoutBundleAside } = load();
      const second = JSON.stringify({ activeSession: { id: 's2' }, history: { sessions: [], slotHistory: {} } });
      fake.rows.set(LIVE, bundle);
      await setWorkoutBundleAside();
      fake.rows.set(LIVE, second);
      await setWorkoutBundleAside();

      assert.equal(fake.rows.get(ASIDE), bundle);
      assert.equal(fake.rows.get(`${ASIDE}/1`), second);

      // The copy landed but the removal did not: the retry finds it and moves on.
      fake.rows.set(LIVE, second);
      await setWorkoutBundleAside();
      assert.equal(fake.rows.has(`${ASIDE}/2`), false, 'a retry copied the same bundle again');
      assert.equal(fake.rows.has(LIVE), false);
    },
  },
  {
    name: 'workout aside: a pre-rename bundle beside a live one is copied too, not deleted',
    async run() {
      const { fake, setWorkoutBundleAside } = load();
      const old = JSON.stringify({ activeSession: null, history: { sessions: [], slotHistory: { old: [1] } } });
      fake.rows.set(LIVE, bundle);
      fake.rows.set(LEGACY, old);
      await setWorkoutBundleAside();
      const copies = [fake.rows.get(ASIDE), fake.rows.get(`${ASIDE}/1`)];
      assert.ok(copies.includes(bundle) && copies.includes(old), 'a copy is missing');
      assert.equal(fake.rows.has(LEGACY), false);
    },
  },
  {
    name: 'workout aside: Reset all data erases every aside copy — numbered slots and their parts included',
    async run() {
      const fake = createFakeAsyncStorage();
      const { aside, large, persistence } = loadAgainstFake(fake, (requireDist) => ({
        aside: requireDist('storage/workoutAside.js'),
        large: requireDist('storage/largeItem.js'),
        persistence: requireDist('features/workout/workoutPersistence.js'),
      }));
      const big = JSON.stringify({ activeSession: { id: 'big' }, body: '€'.repeat(STORAGE_CHUNK_CHARS * 3) });
      await large.setLargeItem(LIVE, bundle);
      await aside.setWorkoutBundleAside();
      await large.setLargeItem(LIVE, big);
      await aside.setWorkoutBundleAside();
      assert.ok([...fake.rows.keys()].filter((key) => key.startsWith(ASIDE)).length >= 5, 'the fixture left too few rows');

      await persistence.clearWorkoutBundle();

      assert.deepEqual([...fake.rows.keys()].filter((key) => key.includes('workout')), []);
    },
  },
  {
    name: 'workout aside: what counts as empty — every kept field, and text that does not parse is kept',
    run() {
      const { isEmptyBundleText } = load();
      assert.equal(isEmptyBundleText('{}'), true);
      assert.equal(isEmptyBundleText(JSON.stringify({ history: { sessions: [], slotHistory: {} } })), true);
      for (const kept of [
        { activeSession: { id: 'x' } },
        { activeCardio: { id: 'x' } },
        { freestyleDraft: { id: 'x' } },
        { history: { sessions: [{ id: 'x' }] } },
        { history: { slotHistory: { a: [1] } } },
        { history: { lastSelectedTemplateId: 'x' } },
      ]) {
        assert.equal(isEmptyBundleText(JSON.stringify(kept)), false, JSON.stringify(kept));
      }
      assert.equal(isEmptyBundleText('vinha-chunks:3:70'), false);
      assert.equal(isEmptyBundleText('[]'), false);
    },
  },
  {
    name: 'workout aside: a reset whose key listing fails still removes the pre-rename bundle, and fails loudly',
    async run() {
      const fake = createFakeAsyncStorage();
      const { persistence } = loadAgainstFake(fake, (requireDist) => ({
        persistence: requireDist('features/workout/workoutPersistence.js'),
      }));
      fake.rows.set(LEGACY, bundle);
      fake.getAllKeys = async () => {
        throw new Error('getAllKeys failed');
      };
      const warn = console.warn;
      console.warn = () => {};
      try {
        await assert.rejects(persistence.clearWorkoutBundle(), /getAllKeys failed/);
      } finally {
        console.warn = warn;
      }
      assert.equal(fake.rows.has(LEGACY), false, 'the old bundle would load again after a failed reset');
    },
  },
  {
    // Bug hunt 5 (2026-10-03), user decision: the copy the crash screen makes comes back from Settings, and the
    // rule stays "copy first, never delete".
    name: 'workout aside: a copy is brought back with what the app holds now copied aside first, and its slot goes only after it is shown',
    async run() {
      const { fake, setWorkoutBundleAside, bringBackWorkoutAside, hasWorkoutAsideCopy } = load();
      fake.rows.set(LIVE, bundle);
      await setWorkoutBundleAside();
      assert.equal(await hasWorkoutAsideCopy(), true);

      // Logged since: the app now holds other history.
      const since = JSON.stringify({ activeSession: null, history: { sessions: [{ id: 'later' }], slotHistory: {} } });
      const order = [];
      const setItem = fake.setItem;
      const removeItem = fake.removeItem;
      fake.setItem = async (key, value) => {
        order.push(`set ${key}`);
        return setItem(key, value);
      };
      fake.removeItem = async (key) => {
        order.push(`remove ${key}`);
        return removeItem(key);
      };
      const shown = [];
      const result = await bringBackWorkoutAside(since, JSON.parse, async (value) => {
        order.push('show');
        shown.push(value);
      });
      assert.equal(result, 'restored');
      assert.deepEqual(shown, [JSON.parse(bundle)], 'the copy, as it was put aside');
      assert.equal(fake.rows.get(`${ASIDE}/1`), since, 'what the app held is a copy now, beside the first');
      assert.equal(fake.rows.has(ASIDE), false, 'the brought-back copy left its slot');
      assert.deepEqual(order, [`set ${ASIDE}/1`, 'show', `remove ${ASIDE}`], 'copy first, shown, and only then removed');
      // The copy that was the app's a moment ago comes back next: one at a time, the latest first.
      const again = [];
      assert.equal(await bringBackWorkoutAside(JSON.stringify({}), JSON.parse, async (value) => again.push(value)), 'restored');
      assert.deepEqual(again, [JSON.parse(since)]);
      assert.equal(await hasWorkoutAsideCopy(), false, 'an empty bundle was not copied aside');
      assert.equal(await bringBackWorkoutAside(since, JSON.parse, async () => assert.fail('nothing to show')), 'none');
    },
  },
  {
    name: 'workout aside: a restore whose copy will not parse, or whose write is refused, leaves every copy where it was',
    async run() {
      const { fake, bringBackWorkoutAside } = load();
      // An unreadable newest copy is passed over for an older one that reads; that older one comes back.
      const older = load();
      older.fake.rows.set(ASIDE, bundle);
      older.fake.rows.set(`${ASIDE}/1`, 'garbage');
      const back = [];
      assert.equal(await older.bringBackWorkoutAside('{}', JSON.parse, async (value) => back.push(value)), 'restored');
      assert.deepEqual(back, [JSON.parse(bundle)]);
      assert.equal(older.fake.rows.get(`${ASIDE}/1`), 'garbage', 'the unreadable copy stays');

      fake.rows.set(ASIDE, 'not json, but the reader\'s');
      const live = JSON.stringify({ history: { sessions: [{ id: 'now' }] } });
      assert.equal(await bringBackWorkoutAside(live, JSON.parse, async () => assert.fail('shown')), 'unreadable');
      assert.equal(fake.rows.get(ASIDE), 'not json, but the reader\'s');
      assert.equal(fake.rows.has(`${ASIDE}/1`), false, 'nothing moved for a copy that cannot come back');

      // Showing (the stored bundle's write) refused: the app's data has been copied, and the copy stays too.
      fake.rows.set(ASIDE, bundle);
      await assert.rejects(
        bringBackWorkoutAside(live, JSON.parse, async () => {
          throw new Error('database or disk is full');
        }),
        /disk is full/,
      );
      assert.equal(fake.rows.get(ASIDE), bundle, 'the copy is still there');
      assert.equal(fake.rows.get(`${ASIDE}/1`), live);

      // Copying the app's data aside refused: nothing is shown, nothing removed.
      const second = load();
      second.fake.rows.set(ASIDE, bundle);
      const setItem = second.fake.setItem;
      second.fake.setItem = async (key, value) => {
        if (key.startsWith(ASIDE)) {
          throw new Error('database or disk is full');
        }
        return setItem(key, value);
      };
      await assert.rejects(
        second.bringBackWorkoutAside(live, JSON.parse, async () => assert.fail('shown over a copy that failed')),
        /disk is full/,
      );
      assert.equal(second.fake.rows.get(ASIDE), bundle);
    },
  },
];
