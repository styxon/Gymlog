const assert = require('node:assert/strict');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../helpers/reactNativeStub.cjs').installReactNativeStub();

const D = '../../.test-dist/';
const limits = require(D + 'lib/weightLimits.js');
const { HOLD_DIAL } = require(D + 'lib/weightDial.js');
const { isIsoDateString } = require(D + 'lib/isoDate.js');
const { normalizeStoredRestSeconds, normalizeDefaultRestSeconds } = require(D + 'lib/restPreference.js');
const { savedRestSeconds } = require(D + 'lib/singleRepTarget.js');
const { buildLoggedSetPlan, normalizeLoggedSetPlan } = require(D + 'lib/loggedSetPlan.js');
const { normalizeExerciseLog } = require(D + 'lib/exerciseLog.js');
const { normalizeWorkoutBundle } = require(D + 'features/workout/workoutPersistence.js');
const { adaptLegacyWorkoutTemplateToRuntimeTemplate } = require(D + 'features/workout/customWorkoutAdapter.js');

/**
 * One validator per stored quantity, shared by every loader that reads it
 * (duplicate sweep 13, area a6). Each case below hands the same number to
 * every reader of that quantity and asserts they answer alike.
 */

function log(extra) {
  return {
    id: 'l1',
    sessionId: 's1',
    exerciseNameSnapshot: 'Bench Press',
    orderIndex: 0,
    ...extra,
  };
}

function set(weight, reps, extra = {}) {
  return { orderIndex: 0, weight, reps, kind: 'working', outcome: 'completed', status: 'completed', ...extra };
}

function bundleWith(entry) {
  return normalizeWorkoutBundle({
    activeSession: null,
    history: {
      sessions: [],
      slotHistory: { slot: [{ performedAt: '2026-10-01T10:00:00.000Z', sets: [], ...entry }] },
      lastSelectedTemplateId: null,
    },
  }).history.slotHistory.slot;
}

module.exports = [
  {
    name: 'stored reps: one ceiling, the hold dial\'s, for every loader (D6-3)',
    run() {
      // Holds store seconds in reps: a ceiling under the hold dial would drop real holds.
      assert.equal(limits.MAX_STORED_REPS, HOLD_DIAL.max);

      // The logged plan: a load past the dial is no plan (it kept 700 kg under a 1000 kg copy).
      const plan = { basis: 'repeat', repsMin: 8, repsMax: 8, loadKg: 700, targetReps: null, fromKg: null, fromReps: null, cautionArea: null };
      assert.equal(normalizeLoggedSetPlan(plan), null);
      assert.equal(normalizeLoggedSetPlan({ ...plan, loadKg: 600 }).loadKg, 600);
      assert.equal(buildLoggedSetPlan({ plannedRepsMin: 8, plannedRepsMax: 8, plannedLoadKg: 700 }).loadKg, null);
      // A 1200 s hold target is kept (it was dropped over 1000).
      assert.equal(normalizeLoggedSetPlan({ ...plan, loadKg: null, targetReps: 1200 }).targetReps, 1200);
      assert.equal(normalizeLoggedSetPlan({ ...plan, loadKg: null, targetReps: 1801 }), null);

      // The "last time" rep target: the same ceiling.
      assert.equal(bundleWith({ targetReps: 1200 })[0].targetReps, 1200);
      assert.equal(bundleWith({ targetReps: 1801 })[0].targetReps, undefined);
    },
  },
  {
    name: 'stored reps: a negative count is no set, in the log and in "last time" alike (D6-2)',
    run() {
      // The verifier's case: the -10 set summed into a negative volume.
      const loaded = normalizeExerciseLog(log({ sets: [set(100, -10), set(100, 5, { orderIndex: 1 })] }));
      assert.deepEqual(loaded.sets.map((s) => s.reps), [5]);
      assert.deepEqual(loaded.repsPerSet, [5]);

      for (const reps of [-3, -0.5, Number.POSITIVE_INFINITY]) {
        assert.equal(limits.isRecordedReps(reps), false, String(reps));
        assert.equal(limits.isPlannedReps(reps), false, String(reps));
        assert.deepEqual(normalizeExerciseLog(log({ weight: 100, repsPerSet: [reps] })).sets, [], `legacy kept ${reps}`);
        const history = bundleWith({ sets: [{ setIndex: 0, loadKg: 100, reps }] });
        assert.deepEqual(history[0].sets, [], `history kept ${reps}`);
      }
      for (const reps of [-3, -0.5]) {
        assert.deepEqual(normalizeExerciseLog(log({ sets: [set(100, reps)] })).sets, [], `log kept ${reps}`);
      }
      // What the dials write, and what the Hevy import writes past them (a
      // 2000-rep jump rope, review R1), loads in all three: a recorded set has
      // no ceiling. Only a plan's target stops at the dial's.
      for (const reps of [1, 12, 300, 1800, 1801, 2000, 5000]) {
        assert.equal(limits.isRecordedReps(reps), true, String(reps));
        assert.equal(limits.isPlannedReps(reps), reps <= limits.MAX_STORED_REPS, `plan ${reps}`);
        assert.deepEqual(normalizeExerciseLog(log({ sets: [set(0, reps)] })).sets.map((s) => s.reps), [reps], `log dropped ${reps}`);
        assert.deepEqual(normalizeExerciseLog(log({ weight: 0, repsPerSet: [reps] })).sets.map((s) => s.reps), [reps], `legacy dropped ${reps}`);
        assert.deepEqual(bundleWith({ sets: [{ setIndex: 0, loadKg: 0, reps }] })[0].sets.map((s) => s.reps), [reps], `history dropped ${reps}`);
      }
      // A pending set with no reps yet is still a set.
      assert.equal(normalizeExerciseLog(log({ sets: [set(60, 0, { status: 'pending', outcome: null })] })).sets.length, 1);
    },
  },
  {
    name: 'stored planned sets: one rule, a whole count up to a programme\'s, in the log and in "last time" (D6-8)',
    run() {
      for (const [value, expected] of [[3, 3], [20, 20], [50, undefined], [2.5, undefined], [0, undefined], ['3', undefined]]) {
        assert.equal(normalizeExerciseLog(log({ plannedSets: value, sets: [set(60, 5)] })).plannedSets, expected, `log ${value}`);
        assert.equal(bundleWith({ plannedSets: value })[0].plannedSets, expected, `history ${value}`);
        assert.equal(limits.positiveWholeCount(value), expected, `helper ${value}`);
      }
    },
  },
  {
    name: 'stored rest seconds: the loader, the writer and the adapter read one rule (D6-4)',
    run() {
      const cases = [
        [-30, null],
        [99999, 3600],
        // An imported 15-minute rest is kept: a loader cap would be saved back over it.
        [900, 900],
        [2.5, 3],
        [0, 0],
        [90, 90],
        [Number.NaN, null],
        ['90', null],
        [null, null],
        [undefined, null],
      ];
      for (const [value, expected] of cases) {
        assert.equal(normalizeStoredRestSeconds(value), expected, `rule ${value}`);
        assert.equal(savedRestSeconds(value), expected, `writer ${value}`);
      }
      // The default rest keeps its own floor: 0 is no default.
      assert.equal(normalizeDefaultRestSeconds(0, 120), 120);

      const adapt = (restSeconds) =>
        adaptLegacyWorkoutTemplateToRuntimeTemplate(
          { id: 't1', name: 'T' },
          [
            {
              id: 's1',
              name: 'S',
              orderIndex: 0,
              exercises: [
                { id: 'e1', workoutTemplateId: 't1', workoutTemplateSessionId: 's1', name: 'Bench Press', targetSets: 3, repMin: 8, repMax: 8, restSeconds, trackedDefault: true, orderIndex: 0, libraryItemId: null, trackingMode: null },
              ],
            },
          ],
          [],
          120,
        ).sessions[0].exercises[0];
      assert.equal(adapt(-30).restSecondsMin, 120);
      assert.equal(adapt(99999).restSecondsMax, 3600);
      assert.equal(adapt(900).restSecondsMax, 900);
      assert.equal(adapt(0).restSecondsMin, 0);
      assert.equal(adapt(null).restSecondsMin, 120);
    },
  },
  {
    name: 'stored dates and body weights: one question each (D6-6, D6-7)',
    run() {
      assert.equal(isIsoDateString('2026-10-01T10:00:00.000Z'), true);
      assert.equal(isIsoDateString('2026-10-01'), true);
      for (const junk of ['garbage', '', null, undefined, 1759312800000, {}]) {
        assert.equal(isIsoDateString(junk), false, String(junk));
      }
      // "Last time" drops an entry with an unreadable date, and a bad start time.
      assert.equal(bundleWith({ performedAt: 'garbage' }).length, 0);
      assert.equal(bundleWith({ startedAt: 'nope' })[0].startedAt, undefined);

      for (const kg of [20, 28, 80, 260, 400]) {
        assert.equal(limits.isPlausibleBodyweightKg(kg), true, String(kg));
      }
      for (const kg of [-80, 0, 19.9, 400.5, 5000, Number.NaN, '80']) {
        assert.equal(limits.isPlausibleBodyweightKg(kg), false, String(kg));
      }
    },
  },
];
