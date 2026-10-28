const assert = require('node:assert/strict');

const { normalizeExerciseLog, normalizeExerciseSets } = require('../../src/lib/exerciseLog');
const { scrubImpossibleSessionLoads, setCarriesImpossibleLoad } = require('../../src/lib/impossibleLoads');
const { WEIGHT_DIAL_MAX_KG, isLiftableWeight } = require('../../src/lib/weightLimits');

function set(weight, reps, extra = {}) {
  return {
    orderIndex: 0,
    weight,
    reps,
    kind: 'working',
    outcome: 'completed',
    status: 'completed',
    effort: null,
    completedAt: '2026-09-04T07:00:00.000Z',
    skippedReason: null,
    ...extra,
  };
}

function runtimeSet(overrides = {}) {
  return {
    setIndex: 0,
    plannedRepsMin: 6,
    plannedRepsMax: 8,
    draftLoadText: '60',
    draftRepsText: '8',
    status: 'pending',
    edited: false,
    ...overrides,
  };
}

function runtimeSession(sets) {
  return {
    sessionId: 's1',
    templateId: 'tpl',
    templateName: 'Advanced Glutes',
    exercises: [{ slotId: 'a', exerciseName: 'Sumo Deadlift', sets }],
  };
}

module.exports = [
  {
    /**
     * Zero is a real pull-up and 500 kg is a real deadlift; 5122,5 kg is the
     * stuck +5000 button of 2026-08-27, which the dial's ceiling stopped from
     * being written but never stopped from being read back.
     */
    name: 'the ceiling names what could have been lifted, not what is likely',
    run() {
      assert.equal(isLiftableWeight(0), true, 'bodyweight work is zero kilos');
      assert.equal(isLiftableWeight(60), true);
      assert.equal(isLiftableWeight(WEIGHT_DIAL_MAX_KG), true, 'the ceiling itself is reachable');
      assert.equal(isLiftableWeight(WEIGHT_DIAL_MAX_KG + 0.25), false);
      assert.equal(isLiftableWeight(5122.5), false, 'the set that shipped');
      assert.equal(isLiftableWeight(-5), false);
      assert.equal(isLiftableWeight(Number.NaN), false);
      assert.equal(isLiftableWeight('60'), false, 'a string is not a weight');
    },
  },
  {
    name: 'a stored set nobody could have lifted does not survive the loader',
    run() {
      const sets = normalizeExerciseSets([set(60, 8), set(5122.5, 8, { orderIndex: 1 }), set(0, 12, { orderIndex: 2 })]);

      assert.deepEqual(
        sets.map((entry) => entry.weight),
        [60, 0],
        'the impossible set went; the bodyweight set stayed',
      );
    },
  },
  {
    /**
     * The other way in. A log whose rows were all dropped falls back to the
     * legacy weight/repsPerSet pair, and that pair carries the same number —
     * so without this the loader hands straight back what it just discarded.
     */
    name: 'the legacy fallback does not resurrect the number that was just dropped',
    run() {
      assert.deepEqual(normalizeExerciseSets([set(5122.5, 8)], 5122.5, [8, 8]), []);
      assert.deepEqual(normalizeExerciseSets(null, 5122.5, [8, 8]), [], 'no set list at all, same rule');
      assert.equal(normalizeExerciseSets(null, 82.5, [8]).length, 1, 'a real legacy log still rebuilds');
    },
  },
  {
    /**
     * The end of the chain the user actually saw: 123 340 kg in records, and a
     * strength target the app refused because every reachable number was above
     * its own 1000 kg limit. Both read `log.weight`, which is derived here.
     */
    name: 'the log stops reporting a personal best it never held',
    run() {
      const log = normalizeExerciseLog({
        id: 'l1',
        sessionId: 's1',
        exerciseNameSnapshot: 'Sumo Deadlift',
        orderIndex: 0,
        weight: 5122.5,
        repsPerSet: [8, 8],
        sets: [set(60, 8), set(5122.5, 8, { orderIndex: 1 })],
      });

      assert.ok(log, 'the log itself is kept — the reader did train that day');
      assert.equal(log.weight, 60, 'the headline was 5122,5 kg before this');
      assert.deepEqual(log.repsPerSet, [8]);
      assert.equal(log.sets.length, 1);
    },
  },
  {
    /**
     * The live session is the other store, and it is where the number was
     * sitting on 2026-09-05. `draftLoadText` matters most: it is what the dial
     * reads on resume, so a clean numeric field with a dirty draft would write
     * the weight straight back on the next Kirjaa sarja.
     */
    name: 'resuming a workout does not put the impossible load back on the dial',
    run() {
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ plannedLoadKg: 5122.5 })), true);
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ draftLoadText: '5122,5' })), true, 'comma decimals too');
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ actualLoadKg: 5122.5 })), true);
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ autoProgressedFromKg: 5121.25 })), true);
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ plannedLoadKg: 60 })), false);
      assert.equal(setCarriesImpossibleLoad(runtimeSet({ draftLoadText: '' })), false, 'a blank dial is not a bad one');

      const dirty = runtimeSet({ plannedLoadKg: 5122.5, actualLoadKg: 5122.5, draftLoadText: '5122,5', autoProgressedFromKg: 5121.25 });
      const scrubbed = scrubImpossibleSessionLoads(runtimeSession([dirty])).exercises[0].sets[0];

      assert.equal(scrubbed.plannedLoadKg, undefined);
      assert.equal(scrubbed.actualLoadKg, undefined);
      assert.equal(scrubbed.autoProgressedFromKg, undefined);
      assert.equal(scrubbed.draftLoadText, '', 'the dial reads this on resume');
      assert.equal(scrubbed.plannedRepsMax, 8, 'the reps are not the thing in doubt');
    },
  },
  {
    /**
     * The caller validates three string fields and casts the rest, and this
     * scrub runs BEFORE its template lookup — so it sees stored shapes the old
     * code never reached, every custom-programme session among them. A throw
     * here is not one bad session: the only catch is around the whole bundle,
     * so it would take the slot history and the active cardio with it.
     */
    name: 'a half-written session does not take the whole bundle down with it',
    run() {
      const noExercises = { sessionId: 's1', templateId: 't', templateName: 'n' };
      assert.equal(scrubImpossibleSessionLoads(noExercises), noExercises);

      const noSets = runtimeSession([]);
      noSets.exercises = [{ slotId: 'a', exerciseName: 'Sumo Deadlift' }];
      assert.doesNotThrow(() => scrubImpossibleSessionLoads(noSets));

      // And a set with no draft field at all: parseNumberInput calls .replace
      // on whatever it is handed.
      assert.equal(setCarriesImpossibleLoad({ setIndex: 0 }), false);
      assert.equal(setCarriesImpossibleLoad({ setIndex: 0, plannedLoadKg: 5122.5 }), true);
      assert.equal(setCarriesImpossibleLoad(null), false);
    },
  },
  {
    name: 'a session with nothing wrong in it comes back untouched',
    run() {
      const session = runtimeSession([runtimeSet({ plannedLoadKg: 60 }), runtimeSet({ setIndex: 1, plannedLoadKg: 62.5 })]);
      const result = scrubImpossibleSessionLoads(session);

      // Identity, not deep equality: this runs on every resume, and a fresh
      // object for an unchanged board remounts it.
      assert.equal(result, session);
      assert.equal(result.exercises[0], session.exercises[0]);
    },
  },
];
