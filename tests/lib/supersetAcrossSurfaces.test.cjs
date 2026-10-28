const assert = require('node:assert/strict');

const { applyProgramSessionEdit } = require('../../src/lib/programSessionEdit');
const { estimateSessionSeconds } = require('../../src/lib/sessionDuration');
const { freestyleRestSecondsForTick } = require('../../src/lib/emptyWorkoutSession');

function idFactory() {
  let next = 0;
  return () => {
    next += 1;
    return `g${next}`;
  };
}

function lift(id, name, overrides = {}) {
  return {
    id,
    name,
    targetSets: 3,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    trackedDefault: true,
    libraryItemId: `lib_${id}`,
    supersetGroup: null,
    ...overrides,
  };
}

function day(...exercises) {
  return [{ id: 'day_1', name: 'Upper', exercises }];
}

function groupsOf(result) {
  return result.sessions[0].exercises.map((exercise) => exercise.supersetGroup ?? null);
}

function freestyleLift(localKey, overrides = {}) {
  return {
    localKey,
    name: localKey,
    libraryItemId: null,
    imageUrl: null,
    repMin: 8,
    repMax: 12,
    restSeconds: 90,
    trackedDefault: true,
    supersetGroup: null,
    sets: [{ localKey: `${localKey}_s1`, kg: '60', reps: '8', done: false }],
    ...overrides,
  };
}

module.exports = [
  {
    name: 'the day view pairs a lift with the one below it',
    run() {
      const result = applyProgramSessionEdit(
        day(lift('e1', 'Bench Press'), lift('e2', 'Barbell Row')),
        'day_1',
        { kind: 'supersetLink', exerciseId: 'e1', linked: true },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(groupsOf(result), ['g1', 'g1']);
    },
  },
  {
    name: 'the bottom lift of a day has nothing below it to run into',
    run() {
      const result = applyProgramSessionEdit(
        day(lift('e1', 'Bench Press'), lift('e2', 'Barbell Row')),
        'day_1',
        { kind: 'supersetLink', exerciseId: 'e2', linked: true },
        idFactory(),
      );
      assert.deepEqual(result, { kind: 'skip', reason: 'noRowBelow' });
    },
  },
  {
    name: 'removing one half of a pair ends the pair',
    run() {
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { supersetGroup: 'a' }),
          lift('e3', 'Curl'),
        ),
        'day_1',
        { kind: 'remove', exerciseId: 'e2' },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(groupsOf(result), [null, null]);
    },
  },
  {
    name: 'dragging a lift out from between a pair does not pair the wrong two',
    run() {
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { supersetGroup: 'a' }),
          lift('e3', 'Curl'),
        ),
        'day_1',
        { kind: 'reorder', exerciseId: 'e3', toIndex: 1 },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.id),
        ['e1', 'e3', 'e2'],
      );
      // Bench and Row are no longer next to each other, so they are no longer
      // a superset — and Curl did not inherit the pairing it landed inside.
      assert.deepEqual(groupsOf(result), [null, null, null]);
    },
  },
  {
    /**
     * Linking makes one block of two lifts, and a block has one set count.
     * The first lift decides, because it is the one the block is built on.
     */
    name: 'linking gives both lifts the first one’s set count',
    run() {
      const result = applyProgramSessionEdit(
        day(lift('e1', 'Bench Press', { targetSets: 4 }), lift('e2', 'Barbell Row', { targetSets: 3 })),
        'day_1',
        { kind: 'supersetLink', exerciseId: 'e1', linked: true },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.targetSets),
        [4, 4],
      );
    },
  },
  {
    name: 'unlinking leaves both doses exactly where they were',
    run() {
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { targetSets: 4, supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { targetSets: 4, supersetGroup: 'a' }),
        ),
        'day_1',
        { kind: 'supersetLink', exerciseId: 'e1', linked: false },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.targetSets),
        [4, 4],
      );
    },
  },
  {
    name: 're-dosing one lift of a superset re-doses the block',
    run() {
      // And the EDITED row is the anchor: overwriting it with the other
      // lift's count would undo the edit the reader is watching.
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { targetSets: 4, supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { targetSets: 4, supersetGroup: 'a' }),
          lift('e3', 'Curl', { targetSets: 2 }),
        ),
        'day_1',
        { kind: 'prescribe', exerciseId: 'e2', prescription: { targetSets: 5, repMin: 10, repMax: 10, restSeconds: null } },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.targetSets),
        [5, 5, 2],
      );
      // Reps stay the edited lift's own: two lifts in one block do the same
      // number of rounds, not the same number of reps.
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.repMax),
        [12, 10, 12],
      );
    },
  },
  {
    /**
     * Rest travels with the sets. A block rests once per round, as long as its
     * most demanding lift asks for, so a rest written to one lift and not the
     * other is a number the session would never use.
     */
    name: 're-dosing a superset carries the rest across the block',
    run() {
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { restSeconds: 120, supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { restSeconds: 45, supersetGroup: 'a' }),
          lift('e3', 'Curl', { restSeconds: 60 }),
        ),
        'day_1',
        {
          kind: 'prescribe',
          exerciseId: 'e1',
          prescription: { targetSets: 3, repMin: 8, repMax: 12, restSeconds: 90 },
        },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.restSeconds),
        [90, 90, 60],
      );
    },
  },
  {
    name: 'a rest left untouched by the sheet stays where it was',
    run() {
      const result = applyProgramSessionEdit(
        day(
          lift('e1', 'Bench Press', { restSeconds: 120, supersetGroup: 'a' }),
          lift('e2', 'Barbell Row', { restSeconds: 45, supersetGroup: 'a' }),
        ),
        'day_1',
        {
          kind: 'prescribe',
          exerciseId: 'e1',
          prescription: { targetSets: 3, repMin: 8, repMax: 12, restSeconds: null },
        },
        idFactory(),
      );
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions[0].exercises.map((exercise) => exercise.restSeconds),
        [120, 45],
      );
    },
  },
  {
    name: 'a superset rests once per round, not once per lift',
    run() {
      const paired = estimateSessionSeconds({
        exercises: [
          { sets: 3, reps: 10, restSeconds: 90, supersetGroup: 'a' },
          { sets: 3, reps: 10, restSeconds: 90, supersetGroup: 'a' },
        ],
      });
      const apart = estimateSessionSeconds({
        exercises: [
          { sets: 3, reps: 10, restSeconds: 90 },
          { sets: 3, reps: 10, restSeconds: 90 },
        ],
      });
      // Four rests apart, two rests paired: three minutes of the estimate.
      assert.equal(apart - paired, 2 * 90);
    },
  },
  {
    name: 'a skipped half of a pair leaves the other resting on its own',
    run() {
      const seconds = estimateSessionSeconds({
        exercises: [
          { sets: 3, reps: 10, restSeconds: 90, supersetGroup: 'a' },
          { sets: 3, reps: 10, restSeconds: 90, supersetGroup: 'a', skipped: true },
        ],
      });
      const alone = estimateSessionSeconds({ exercises: [{ sets: 3, reps: 10, restSeconds: 90 }] });
      assert.equal(seconds, alone);
    },
  },
  {
    name: 'ticking A1 in a free workout starts no rest',
    run() {
      const exercises = [
        freestyleLift('a', { supersetGroup: 'g1' }),
        freestyleLift('b', { supersetGroup: 'g1' }),
      ];
      assert.equal(freestyleRestSecondsForTick(exercises[0], exercises[0].sets[0], 90, exercises), null);
    },
  },
  {
    name: 'ticking the last lift of the pair rests for the longer of the two',
    run() {
      const exercises = [
        freestyleLift('a', { supersetGroup: 'g1', restSeconds: 150 }),
        freestyleLift('b', { supersetGroup: 'g1', restSeconds: 45 }),
      ];
      assert.equal(freestyleRestSecondsForTick(exercises[1], exercises[1].sets[0], 90, exercises), 150);
    },
  },
  {
    name: 'an unpaired free workout rests exactly as it did before',
    run() {
      const exercises = [freestyleLift('a', { restSeconds: 120 }), freestyleLift('b')];
      assert.equal(freestyleRestSecondsForTick(exercises[0], exercises[0].sets[0], 90, exercises), 120);
    },
  },
  {
    name: 'un-ticking a set inside a superset starts nothing either',
    run() {
      const exercises = [
        freestyleLift('a', { supersetGroup: 'g1', sets: [{ localKey: 'x', kg: '60', reps: '8', done: true }] }),
        freestyleLift('b', { supersetGroup: 'g1' }),
      ];
      assert.equal(freestyleRestSecondsForTick(exercises[0], exercises[0].sets[0], 90, exercises), null);
    },
  },
];
