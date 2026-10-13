const assert = require('node:assert/strict');

const {
  EMPTY_SESSION_ADAPTATION,
  applySessionAdaptation,
  hasSessionAdaptation,
} = require('../../.test-dist/lib/sessionAdaptation.js');

const DAY = [
  { slotId: 'primary_squat', role: 'primary', sets: 4 },
  { slotId: 'secondary_press', role: 'secondary', sets: 3 },
  { slotId: 'accessory_curl', role: 'accessory', sets: 3 },
  { slotId: 'accessory_calf', role: 'accessory', sets: 3 },
];

function template(exercises = DAY) {
  return {
    id: 'tpl_1',
    name: 'Plan - Day 1: Legs',
    defaultScheduleMode: 'rolling_sequence',
    sessions: [
      {
        id: 'day_1',
        name: 'Legs',
        orderIndex: 0,
        exercises: exercises.map((exercise, index) => ({
          id: `ex_${index}`,
          exerciseName: `Lift ${index}`,
          slotId: exercise.slotId,
          role: exercise.role,
          progressionPriority: 'medium',
          trackingMode: 'load_and_reps',
          sets: exercise.sets,
          repsMin: 6,
          repsMax: 8,
          restSecondsMin: 90,
          restSecondsMax: 120,
          substitutionGroup: 'squat_pattern',
        })),
      },
    ],
  };
}

module.exports = [
  {
    name: 'an adaptation applies swaps to the runtime template',
    run() {
      const source = template();
      const adapted = applySessionAdaptation(source, {
        swaps: { primary_squat: 'Hack Squat' },
        drops: [],
      });

      const exercises = adapted.sessions[0].exercises;
      assert.equal(exercises[0].exerciseName, 'Hack Squat');
      // Swapping does not change the prescription — same sets, same reps, same
      // slot. It is the same work done on something else.
      assert.equal(exercises[0].sets, 4);
      assert.equal(exercises[0].slotId, 'primary_squat');

      // The source template is a catalog object shared across sessions; it must
      // come back unchanged.
      assert.equal(source.sessions[0].exercises[0].exerciseName, 'Lift 0');
    },
  },
  {
    name: 'no adaptation is a no-op, by identity',
    run() {
      const source = template();
      assert.equal(hasSessionAdaptation(EMPTY_SESSION_ADAPTATION), false);
      assert.equal(hasSessionAdaptation(null), false);
      assert.equal(hasSessionAdaptation({ swaps: { a: 'B' }, drops: [] }), true);
      assert.equal(hasSessionAdaptation({ swaps: {}, drops: ['accessory_curl'] }), true);
      // The set trim went with the Adapt sheet that was its only way in
      // (2026-08-30), so "nothing to apply" is now swaps and drops alone.
      assert.equal(hasSessionAdaptation({ swaps: {}, drops: [] }), false);

      // Same object back, not a copy: the ordinary start path pays nothing.
      assert.equal(applySessionAdaptation(source, EMPTY_SESSION_ADAPTATION), source);
      assert.equal(applySessionAdaptation(source, null), source);
    },
  },
  {
    name: 'a swap made before the start is the lift coming in: its tracking mode, and the programmed lift on record',
    run() {
      // Swap audit, 2026-09-21: the name was the only thing that changed, so
      // a pull-up swapped for a lat pulldown here started with no weight dial,
      // and the save could not tell it had been a swap at all.
      const source = template([{ slotId: 'primary_pull', role: 'primary', sets: 3 }]);
      source.sessions[0].exercises[0].exerciseName = 'Pull-Up';
      source.sessions[0].exercises[0].trackingMode = 'bodyweight';
      const adapted = applySessionAdaptation(source, { swaps: { primary_pull: 'Lat Pulldown (Wide Grip)' }, drops: [] });
      const row = adapted.sessions[0].exercises[0];
      assert.equal(row.exerciseName, 'Lat Pulldown (Wide Grip)');
      assert.equal(row.trackingMode, 'load_and_reps');
      assert.equal(row.sourceExerciseName, 'Pull-Up');

      // A swap that keeps the unit keeps the numbers.
      assert.deepEqual([row.repsMin, row.repsMax], [6, 8]);

      // Picking the lift that is already there is not a swap.
      const same = applySessionAdaptation(source, { swaps: { primary_pull: 'pull-up ' }, drops: [] });
      assert.equal(same.sessions[0].exercises[0], source.sessions[0].exercises[0]);

      // A hold swapped for a hip thrust: seconds are not repetitions.
      const hold = template([{ slotId: 'glute_hold', role: 'accessory', sets: 3 }]);
      Object.assign(hold.sessions[0].exercises[0], { exerciseName: 'Glute Bridge Hold', trackingMode: 'hold', repsMin: 30, repsMax: 60 });
      const thrust = applySessionAdaptation(hold, { swaps: { glute_hold: 'Barbell Hip Thrust' }, drops: [] }).sessions[0].exercises[0];
      assert.equal(thrust.trackingMode, 'load_and_reps');
      assert.ok(thrust.repsMax <= 15, `${thrust.repsMin}-${thrust.repsMax}`);
    },
  },
  {
    name: 'held adaptations: a swap and a drop made for one day are not read for another day of the programme',
    run() {
      const { getWorkoutTemplateById } = require('../../.test-dist/features/workout/workoutCatalog.js');
      const { buildReadySessionRuntimeTemplate } = require('../../.test-dist/lib/programDetails.js');
      const {
        heldAdaptationFor,
        NO_HELD_SESSION_ADAPTATIONS,
        updateHeldAdaptation,
        withSessionDrop,
        withSessionSwap,
      } = require('../../.test-dist/lib/sessionAdaptation.js');

      // The audit's case. Full Body A and B share their slot ids: A's back
      // squat and B's leg press are both `primary_squat_1`, A's bench and B's
      // overhead press both `primary_press_1`.
      const programme = getWorkoutTemplateById('tpl_3_day_full_body_v1');
      const dayA = { programId: programme.id, sessionId: 'full_body_a' };
      const dayB = { programId: programme.id, sessionId: 'full_body_b' };
      const today = new Date(2026, 8, 21).getTime();
      let held = updateHeldAdaptation(NO_HELD_SESSION_ADAPTATIONS, dayA, today, (current) =>
        withSessionSwap(current, 'primary_squat_1', 'Goblet Squat'),
      );
      held = updateHeldAdaptation(held, dayA, today, (current) => withSessionDrop(current, 'primary_press_1'));

      const started = (sessionId, adaptation) =>
        applySessionAdaptation(buildReadySessionRuntimeTemplate(programme, sessionId), adaptation).sessions[0].exercises.map(
          (exercise) => exercise.exerciseName,
        );
      // B picked for today instead: B is B.
      assert.deepEqual(started('full_body_b', heldAdaptationFor(held, dayB, today)), [
        'Leg Press',
        'Overhead Press',
        'Lat Pulldown',
        'Reverse Lunge',
        // FIT's day B closes on run blocks since 2026-10-12 (was a triceps
        // pushdown); the case is about the shared slot ids, not this row.
        'Easy Run Blocks',
      ]);
      // A still gets what was chosen for it.
      const dayAToday = started('full_body_a', heldAdaptationFor(held, dayA, today));
      assert.equal(dayAToday[0], 'Goblet Squat');
      assert.equal(dayAToday.includes('Bench Press'), false);
    },
  },
  {
    name: 'held adaptations: an answer about today is gone tomorrow, and spent when its session starts',
    run() {
      const {
        heldAdaptationFor,
        NO_HELD_SESSION_ADAPTATIONS,
        spendHeldAdaptation,
        updateHeldAdaptation,
        withSessionSwap,
      } = require('../../.test-dist/lib/sessionAdaptation.js');
      const dayA = { programId: 'tpl', sessionId: 'a' };
      const dayB = { programId: 'tpl', sessionId: 'b' };
      const today = new Date(2026, 8, 21).getTime();
      const tomorrow = new Date(2026, 8, 22).getTime();
      let held = updateHeldAdaptation(NO_HELD_SESSION_ADAPTATIONS, dayA, today, (current) =>
        withSessionSwap(current, 'squat', 'Goblet Squat'),
      );
      held = updateHeldAdaptation(held, dayB, today, (current) => withSessionSwap(current, 'squat', 'Hack Squat'));

      // The app left open past midnight reads the next day's nothing.
      assert.deepEqual(heldAdaptationFor(held, dayA, tomorrow), EMPTY_SESSION_ADAPTATION);
      // And the first change made tomorrow lets yesterday's go.
      const nextDay = updateHeldAdaptation(held, dayB, tomorrow, (current) => withSessionSwap(current, 'press', 'Dip'));
      assert.deepEqual(Object.keys(nextDay.bySession).length, 1);
      assert.deepEqual(heldAdaptationFor(nextDay, dayB, tomorrow).swaps, { press: 'Dip' });

      // Starting A spends A's, and only A's.
      const afterA = spendHeldAdaptation(held, dayA);
      assert.deepEqual(heldAdaptationFor(afterA, dayA, today), EMPTY_SESSION_ADAPTATION);
      assert.deepEqual(heldAdaptationFor(afterA, dayB, today).swaps, { squat: 'Hack Squat' });
      // Nothing held for a session: the same object back.
      assert.equal(spendHeldAdaptation(afterA, dayA), afterA);
      // No session to read for (Home with no programme): nothing.
      assert.deepEqual(heldAdaptationFor(held, null, today), EMPTY_SESSION_ADAPTATION);
    },
  },
  {
    name: 'held adaptations: a drop is listed once, put back cleanly, and a kept swap stops being an override',
    run() {
      const {
        heldAdaptationFor,
        NO_HELD_SESSION_ADAPTATIONS,
        updateHeldAdaptation,
        withoutSessionDrop,
        withoutSessionSwapsTo,
        withSessionDrop,
        withSessionSwap,
      } = require('../../.test-dist/lib/sessionAdaptation.js');
      const day = { programId: 'tpl', sessionId: 'a' };
      const today = new Date(2026, 8, 21).getTime();
      const twice = withSessionDrop(withSessionDrop(EMPTY_SESSION_ADAPTATION, 'curl'), 'curl');
      assert.deepEqual(twice.drops, ['curl']);
      assert.deepEqual(withoutSessionDrop(twice, 'curl').drops, []);

      const swapped = withSessionSwap(withSessionSwap(EMPTY_SESSION_ADAPTATION, 'squat', 'Goblet Squat'), 'press', 'Dip');
      assert.deepEqual(withoutSessionSwapsTo(swapped, 'Goblet Squat').swaps, { press: 'Dip' });

      // Emptied, the session holds nothing rather than an empty record.
      let held = updateHeldAdaptation(NO_HELD_SESSION_ADAPTATIONS, day, today, (current) => withSessionDrop(current, 'curl'));
      held = updateHeldAdaptation(held, day, today, (current) => withoutSessionDrop(current, 'curl'));
      assert.deepEqual(held.bySession, {});
      assert.deepEqual(heldAdaptationFor(held, day, today), EMPTY_SESSION_ADAPTATION);
    },
  },
];
