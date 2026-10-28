const assert = require('node:assert/strict');

const {
  applyProgramSessionEdit,
  canStepProgramPrescription,
  stepProgramPrescription,
  PROGRAM_REST_RANGE,
  PROGRAM_REPS_RANGE,
  PROGRAM_SETS_RANGE,
} = require('../../src/lib/programSessionEdit');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { functionBody } = require('../helpers/sourceSlices.cjs');

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
    ...overrides,
  };
}

function programme() {
  return [
    { id: 'day_1', name: 'Glutes', exercises: [lift('e1', 'Hip Thrust'), lift('e2', 'Sumo Deadlift')] },
    { id: 'day_2', name: 'Chest', exercises: [lift('e3', 'Bench Press')] },
  ];
}

module.exports = [
  {
    name: 'removing a lift touches only its own day',
    run() {
      const result = applyProgramSessionEdit(programme(), 'day_1', { kind: 'remove', exerciseId: 'e1' });
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions.map((session) => session.exercises.map((exercise) => exercise.name)),
        [['Sumo Deadlift'], ['Bench Press']],
      );
    },
  },
  /**
   * "Sarja/toisto määrää mahdoton muuttaa" (#bugs 2026-08-27). The numbers
   * were a rendered string on a read-out screen — the catalog's dose, shown
   * and not offered. These four hold the rules the stepper is trusted with.
   */
  {
    name: 'changing the dose changes the dose and nothing else about the row',
    run() {
      const before = programme()[0].exercises[1];
      const result = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'prescribe',
        exerciseId: 'e2',
        prescription: { targetSets: 5, repMin: 6, repMax: 6 },
      });
      assert.equal(result.kind, 'save');
      const after = result.sessions[0].exercises[1];
      assert.deepEqual(
        { targetSets: after.targetSets, repMin: after.repMin, repMax: after.repMax },
        { targetSets: 5, repMin: 6, repMax: 6 },
      );
      // The lift, its library link and its rest are not part of this edit.
      assert.equal(after.name, before.name);
      assert.equal(after.libraryItemId, before.libraryItemId);
      assert.equal(after.restSeconds, before.restSeconds);
      // And the row beside it is untouched.
      assert.equal(result.sessions[0].exercises[0].targetSets, 3);
    },
  },
  {
    name: 'a rep range moves as a block, keeping the span the programme wrote',
    run() {
      const range = { targetSets: 3, repMin: 6, repMax: 8 };
      assert.deepEqual(stepProgramPrescription(range, 'reps', 1), { targetSets: 3, repMin: 7, repMax: 9 });
      assert.deepEqual(stepProgramPrescription(range, 'reps', -1), { targetSets: 3, repMin: 5, repMax: 7 });
    },
  },
  {
    /**
     * Clamping one end and not the other would flatten "1–3" into "1–2" and
     * then "1–1" — a stepper quietly rewriting the programme's intent while
     * appearing to do nothing.
     */
    name: 'a step that would push either end past the bounds is refused whole',
    run() {
      const atFloor = { targetSets: 3, repMin: PROGRAM_REPS_RANGE.min, repMax: 3 };
      assert.deepEqual(stepProgramPrescription(atFloor, 'reps', -1), atFloor);
      assert.equal(canStepProgramPrescription(atFloor, 'reps', -1), false);
      assert.equal(canStepProgramPrescription(atFloor, 'reps', 1), true);

      const atCeiling = { targetSets: PROGRAM_SETS_RANGE.max, repMin: 8, repMax: 8 };
      assert.deepEqual(stepProgramPrescription(atCeiling, 'sets', 1), atCeiling);
      assert.equal(canStepProgramPrescription(atCeiling, 'sets', 1), false);
    },
  },
  /**
   * "Järjestyksen muutos täälläkin" (#bugs 2026-08-27).
   */
  {
    name: 'a drag lands where it let go, as one edit',
    run() {
      const three = [
        { id: 'day_1', name: 'Glutes', exercises: [lift('e1', 'A'), lift('e2', 'B'), lift('e3', 'C')] },
      ];
      // The whole journey in one write: top to bottom is one reorder, not
      // two moves racing each other through the queue.
      const down = applyProgramSessionEdit(three, 'day_1', { kind: 'reorder', exerciseId: 'e1', toIndex: 2 });
      assert.deepEqual(down.sessions[0].exercises.map((exercise) => exercise.name), ['B', 'C', 'A']);
      const up = applyProgramSessionEdit(three, 'day_1', { kind: 'reorder', exerciseId: 'e3', toIndex: 1 });
      assert.deepEqual(up.sessions[0].exercises.map((exercise) => exercise.name), ['A', 'C', 'B']);
      // A finger that overshoots the list still means "last": the target is
      // clamped, never refused.
      const past = applyProgramSessionEdit(three, 'day_1', { kind: 'reorder', exerciseId: 'e1', toIndex: 99 });
      assert.deepEqual(past.sessions[0].exercises.map((exercise) => exercise.name), ['B', 'C', 'A']);
    },
  },
  {
    name: 'the other days keep their own order while one day is reordered',
    run() {
      const result = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'reorder',
        exerciseId: 'e2',
        toIndex: 0,
      });
      assert.deepEqual(
        result.sessions.map((session) => session.exercises.map((exercise) => exercise.name)),
        [['Sumo Deadlift', 'Hip Thrust'], ['Bench Press']],
      );
    },
  },
  {
    name: 'a drop that changes nothing is not a save',
    run() {
      // Dropped back where it started — including via a clamped overshoot on
      // the last row — reads as no edit, so nothing is written and the
      // screen cannot confirm an edit it did not make.
      const same = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'reorder',
        exerciseId: 'e1',
        toIndex: 0,
      });
      assert.equal(same.kind, 'skip');
      assert.equal(same.reason, 'alreadyAtEdge');
      const clamped = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'reorder',
        exerciseId: 'e2',
        toIndex: 9,
      });
      assert.equal(clamped.kind, 'skip');
      assert.equal(clamped.reason, 'alreadyAtEdge');
      const gone = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'reorder',
        exerciseId: 'nope',
        toIndex: 0,
      });
      assert.equal(gone.reason, 'exerciseMissing');
    },
  },
  {
    name: 'emptying a day is refused rather than saved',
    run() {
      const result = applyProgramSessionEdit(programme(), 'day_2', { kind: 'remove', exerciseId: 'e3' });
      assert.equal(result.kind, 'skip');
      assert.equal(result.reason, 'lastExerciseInDay');
    },
  },
  {
    name: 'a swap changes the lift and its library row, never the prescription',
    run() {
      const result = applyProgramSessionEdit(programme(), 'day_1', {
        kind: 'replace',
        exerciseId: 'e2',
        exerciseName: 'Trap Bar Deadlift',
        libraryItemId: 'lib_trap',
      });
      assert.equal(result.kind, 'save');
      const swapped = result.sessions[0].exercises[1];
      assert.equal(swapped.name, 'Trap Bar Deadlift');
      assert.equal(swapped.libraryItemId, 'lib_trap');
      // The dose is the programme's, not the lift's.
      assert.equal(swapped.targetSets, 3);
      assert.equal(swapped.repMin, 8);
      assert.equal(swapped.repMax, 12);
      assert.equal(swapped.restSeconds, 90);
      // The day it was not on is untouched.
      assert.deepEqual(result.sessions[1].exercises.map((exercise) => exercise.name), ['Bench Press']);
    },
  },
  {
    name: 'added lifts land at the end of the day they were added from',
    run() {
      const result = applyProgramSessionEdit(programme(), 'day_2', {
        kind: 'add',
        exercises: [lift('e4', 'Incline Press'), lift('e5', 'Cable Fly')],
      });
      assert.equal(result.kind, 'save');
      assert.deepEqual(
        result.sessions.map((session) => session.exercises.map((exercise) => exercise.name)),
        [
          ['Hip Thrust', 'Sumo Deadlift'],
          ['Bench Press', 'Incline Press', 'Cable Fly'],
        ],
      );
    },
  },
  {
    /**
     * The morning of 2026-08-27: lifts were added, and then they were gone.
     * Each edit rebuilt the whole programme from the screen's copy of it, so a
     * second edit that started before the first had been painted wrote the
     * first one out of existence. Edits have to compose.
     */
    name: 'a second edit builds on the first instead of replacing it',
    run() {
      const first = applyProgramSessionEdit(programme(), 'day_2', {
        kind: 'add',
        exercises: [lift('e4', 'Incline Press')],
      });
      assert.equal(first.kind, 'save');
      const second = applyProgramSessionEdit(first.sessions, 'day_2', {
        kind: 'add',
        exercises: [lift('e5', 'Cable Fly')],
      });
      assert.equal(second.kind, 'save');
      assert.deepEqual(second.sessions[1].exercises.map((exercise) => exercise.name), [
        'Bench Press',
        'Incline Press',
        'Cable Fly',
      ]);
    },
  },
  {
    /**
     * The composing above is only worth anything if the app hands it fresh
     * days. Reading them from the rendered state is exactly the bug: the read
     * has to happen inside the write, which is what editWorkoutTemplateSessions
     * is for. This pins the three handlers that change a stored programme onto
     * it, so the next one written cannot quietly go back to the old shape.
     */
    name: 'programme edits go through the provider, not through render state',
    run() {
      const source = readAppWiring();
      // Each handler's own body, not a fixed 2,600-character window: the
      // window let handleEditProgramExercise pass on its neighbour's write and
      // ran handleSaveEmphasis into the next module (#bugs 2026-10-01).
      //
      // handleEditProgramExercise does not write: it queues the edit, and the
      // write is runProgramExerciseEdit's. So the queue is pinned to that
      // function and the write is checked where it actually happens.
      const queue = functionBody(source, 'function handleEditProgramExercise(');
      assert.match(
        queue,
        /programEditQueue\.current\.then\(\(\) =>\s*runProgramExerciseEdit\(programType, programId, sessionId, exerciseId, edit\),?\s*\)/,
        'handleEditProgramExercise must hand every edit to runProgramExerciseEdit',
      );
      assert.ok(
        !queue.includes('getWorkoutTemplateSessions('),
        'handleEditProgramExercise must not rebuild a programme from rendered state — that is the lost-exercise bug',
      );
      for (const signature of [
        'async function runProgramExerciseEdit(',
        'async function handleSaveEmphasis(',
        'async function handleRenameProgramSession(',
      ]) {
        const body = functionBody(source, signature);
        assert.ok(
          body.includes('editWorkoutTemplateSessions('),
          `${signature} must edit a stored programme through editWorkoutTemplateSessions`,
        );
        assert.ok(
          !body.includes('getWorkoutTemplateSessions('),
          `${signature} must not rebuild a programme from rendered state — that is the lost-exercise bug`,
        );
      }
    },
  },
  {
    /**
     * Editing a ready programme copies it — that is what "editing" one means,
     * and the copy costs a slot against the free cap. So a press that changes
     * nothing must be answered before the copy is built, not after: "up" on
     * the top row would otherwise hand the reader a whole second programme
     * that reads exactly like the first.
     */
    name: 'a drop with nowhere to go never copies the catalog programme',
    run() {
      const source = readAppWiring();
      // Inside the function that does the copying (handleEditProgramExercise
      // only queues it), so a later module cannot supply either anchor.
      const edit = functionBody(source, 'async function runProgramExerciseEdit(');
      const copyAt = edit.indexOf('buildDuplicatedCustomProgramDraft(');
      const guardAt = edit.indexOf("if (edit.kind === 'reorder') {");
      assert.ok(guardAt > -1, 'the ready branch should answer a no-op drop');
      assert.ok(copyAt > -1, 'the ready branch should still copy the catalog programme');
      assert.ok(
        guardAt < copyAt,
        'the reorder guard must run before the programme is duplicated, not after',
      );
    },
  },
  {
    /**
     * Reordering writes positions, and the position a row is stored at is the
     * one it is drawn at. Splicing the array without re-numbering leaves the
     * list correct on screen and wrong the next time it is read back.
     */
    name: 'a reordered day is re-numbered before it is stored',
    run() {
      const source = readAppWiring();
      assert.match(source, /exercises\.map\(\(exercise, orderIndex\) => \(\{ \.\.\.exercise, orderIndex \}\)\)/);
    },
  },
  {
    name: 'rest steps by its own grid, and a missing rest cannot be stepped',
    run() {
      // 15 s rather than the design's 30, because the catalogue's own rests
      // are not multiples of 30 — 45 and 75 are everywhere — and a stepper
      // whose first press snaps a stored value to a grid has edited more
      // than the reader asked it to.
      const dose = { targetSets: 3, repMin: 8, repMax: 8, restSeconds: 90 };
      assert.deepEqual(stepProgramPrescription(dose, 'rest', 1), { ...dose, restSeconds: 105 });
      assert.deepEqual(stepProgramPrescription(dose, 'rest', -1), { ...dose, restSeconds: 75 });

      const atFloor = { ...dose, restSeconds: PROGRAM_REST_RANGE.min };
      assert.deepEqual(stepProgramPrescription(atFloor, 'rest', -1), atFloor);
      const atCeiling = { ...dose, restSeconds: PROGRAM_REST_RANGE.max };
      assert.deepEqual(stepProgramPrescription(atCeiling, 'rest', 1), atCeiling);

      // No number, no step: inventing one here would write it.
      const noRest = { ...dose, restSeconds: null };
      assert.equal(stepProgramPrescription(noRest, 'rest', 1), noRest);
      assert.equal(canStepProgramPrescription(noRest, 'rest', 1), false);
    },
  },
  {
    name: 'prescribe writes rest only when the sheet had a number to step',
    run() {
      const sessions = [
        {
          id: 'day_1',
          name: 'Day 1',
          exercises: [
            { id: 'a', name: 'Back Squat', targetSets: 4, repMin: 5, repMax: 5, restSeconds: 120, trackedDefault: true },
          ],
        },
      ];

      // A real rest travels with the dose.
      const withRest = applyProgramSessionEdit(sessions, 'day_1', {
        kind: 'prescribe',
        exerciseId: 'a',
        prescription: { targetSets: 4, repMin: 5, repMax: 5, restSeconds: 150 },
      });
      assert.equal(withRest.kind, 'save');
      assert.equal(withRest.sessions[0].exercises[0].restSeconds, 150);

      // Null means the stored value stays — the sheet never had a number, so
      // saving sets and reps must not blank the rest behind them.
      const withoutRest = applyProgramSessionEdit(sessions, 'day_1', {
        kind: 'prescribe',
        exerciseId: 'a',
        prescription: { targetSets: 5, repMin: 5, repMax: 5, restSeconds: null },
      });
      assert.equal(withoutRest.kind, 'save');
      assert.equal(withoutRest.sessions[0].exercises[0].restSeconds, 120);
      assert.equal(withoutRest.sessions[0].exercises[0].targetSets, 5);
    },
  },
  {
    name: 'an edit aimed at a day or a lift that is not there is refused, not confirmed',
    run() {
      // A ready programme's page keeps showing the catalog after the reader's
      // copy exists, so an edit from it named ids the copy has never heard of.
      // Every edit but reorder and superset-link rebuilt the programme
      // unchanged and came back as a save: the screen buzzed, the write
      // happened, and the number the reader pressed never moved.
      const missingDay = applyProgramSessionEdit(programme(), 'day_9', { kind: 'remove', exerciseId: 'e1' });
      assert.equal(missingDay.kind, 'skip');
      assert.equal(missingDay.reason, 'exerciseMissing');

      for (const edit of [
        { kind: 'remove', exerciseId: 'nope' },
        { kind: 'replace', exerciseId: 'nope', exerciseName: 'Leg Press', libraryItemId: null },
        { kind: 'prescribe', exerciseId: 'nope', prescription: { targetSets: 4, repMin: 6, repMax: 8, restSeconds: 120 } },
      ]) {
        const result = applyProgramSessionEdit(programme(), 'day_1', edit);
        assert.equal(result.kind, 'skip', `${edit.kind} confirmed an edit it could not make`);
        assert.equal(result.reason, 'exerciseMissing');
      }

      // Adding names the day and nothing else, so a real day still saves.
      const added = applyProgramSessionEdit(programme(), 'day_2', {
        kind: 'add',
        exercises: [lift('e4', 'Incline Press')],
      });
      assert.equal(added.kind, 'save');
      const addedToNothing = applyProgramSessionEdit(programme(), 'day_9', {
        kind: 'add',
        exercises: [lift('e4', 'Incline Press')],
      });
      assert.equal(addedToNothing.kind, 'skip');
    },
  },
  {
    // A14-8: the reps stepper refused every step when either end was outside
    // 1-50, so a 30-60 s plank or a 60 m farmer's walk could not move at all,
    // not even down toward the bound.
    name: 'the reps stepper moves a row above 50 toward its bound, and a hold up to its own',
    run() {
      const plank = { targetSets: 3, repMin: 30, repMax: 60, restSeconds: 60 };
      const seconds = { timed: true };
      assert.equal(canStepProgramPrescription(plank, 'reps', -1, seconds), true);
      assert.equal(canStepProgramPrescription(plank, 'reps', 1, seconds), true);
      assert.deepEqual(stepProgramPrescription(plank, 'reps', 1, seconds), { ...plank, repMin: 31, repMax: 61 });

      // A counted row above the bound: down moves toward it, up is refused.
      const walk = { targetSets: 3, repMin: 60, repMax: 60, restSeconds: 90 };
      assert.equal(canStepProgramPrescription(walk, 'reps', -1), true);
      assert.deepEqual(stepProgramPrescription(walk, 'reps', -1), { ...walk, repMin: 59, repMax: 59 });
      assert.equal(canStepProgramPrescription(walk, 'reps', 1), false);

      // Unchanged: a counted row at the ceiling, at the floor, and in the middle.
      const atCeiling = { targetSets: 3, repMin: 1, repMax: PROGRAM_REPS_RANGE.max, restSeconds: 60 };
      assert.equal(canStepProgramPrescription(atCeiling, 'reps', 1), false);
      const atFloor = { targetSets: 3, repMin: 1, repMax: 3, restSeconds: 60 };
      assert.equal(canStepProgramPrescription(atFloor, 'reps', -1), false);
      const middle = { targetSets: 3, repMin: 8, repMax: 12, restSeconds: 60 };
      assert.deepEqual(stepProgramPrescription(middle, 'reps', 1), { ...middle, repMin: 9, repMax: 13 });
      assert.deepEqual(stepProgramPrescription(middle, 'reps', -1), { ...middle, repMin: 7, repMax: 11 });

      // A hold and a minutes row have their own ceilings, still finite.
      const longHold = { targetSets: 1, repMin: 600, repMax: 600, restSeconds: 60 };
      assert.equal(canStepProgramPrescription(longHold, 'reps', 1, seconds), false);
      assert.equal(canStepProgramPrescription(longHold, 'reps', -1, seconds), true);
      const ride = { targetSets: 1, repMin: 60, repMax: 60, restSeconds: null };
      assert.equal(canStepProgramPrescription(ride, 'reps', 1, { minutes: true }), true);
      assert.equal(canStepProgramPrescription({ ...ride, repMin: 300, repMax: 300 }, 'reps', 1, { minutes: true }), false);
    },
  },
];
