const assert = require('node:assert/strict');

const { prescriptionAfterSwap, trackingModeAfterSwap } = require('../../src/lib/catalogExercisePools');
const { WORKOUT_TEMPLATES_V1 } = require('../../src/features/workout/workoutCatalog');
const { buildSwapOptionsForSlot } = require('../../src/lib/tailoringFit');
const { isTimedTrackingMode, isUnloadedTrackingMode } = require('../../src/features/workout/workoutTypes');

/**
 * A swap takes on the incoming lift's tracking mode (swap audit, 2026-09-21).
 * The slot's mode is how its PROGRAMMED lift is logged; kept through a swap, a
 * pull-up swapped for a lat pulldown hid the weight dial and saved 0 kg × 12,
 * and a glute bridge hold swapped for a barbell hip thrust counted seconds.
 */

const kind = (mode) => `${isUnloadedTrackingMode(mode) ? 'unloaded' : 'loaded'}/${isTimedTrackingMode(mode) ? 'timed' : 'reps'}`;

module.exports = [
  {
    name: 'swap tracking: the lift coming in decides whether the set asks for a weight',
    run() {
      assert.equal(trackingModeAfterSwap('bodyweight', 'Lat Pulldown (Wide Grip)'), 'load_and_reps');
      assert.equal(trackingModeAfterSwap('hold', 'Barbell Hip Thrust'), 'load_and_reps');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Pull-Up'), 'bodyweight');
      assert.equal(trackingModeAfterSwap('reps_first', 'Hanging Knee Raise'), 'bodyweight');
      assert.equal(trackingModeAfterSwap('bodyweight', 'Plank'), 'hold');
    },
  },
  {
    name: 'swap tracking: the programmes answer for their own names before the library does',
    run() {
      const { getCatalogTrackingMode } = require('../../src/lib/catalogExercisePools');
      // The library files the Russian twist under "bodyweight"; the
      // programmes load it. Asked of the library first, a swap to it from an
      // unloaded slot would have hidden the weight dial. (The example was the
      // trap bar deadlift until the library filed it as loaded, 2026-09-21.)
      assert.equal(getCatalogTrackingMode('Russian Twist'), 'bodyweight');
      assert.equal(trackingModeAfterSwap('bodyweight', 'Russian Twist'), 'load_and_reps');
      assert.equal(getCatalogTrackingMode('Trap Bar Deadlift'), 'load_and_reps');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Trap Bar Deadlift'), 'load_and_reps');
      // "Pull-Up" is not the library's spelling, so the library answers
      // "load" by not finding it.
      assert.equal(getCatalogTrackingMode('Pull-Up'), 'load_and_reps');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Pull-Up'), 'bodyweight');
      // A name only the library knows is answered by the library — into an
      // unloaded slot. (This read `load_and_reps` → "Pullups" → bodyweight
      // until the CI review of #170: from a loaded slot the library's
      // "bodyweight" no longer takes the dial away; see the next suite.)
      assert.equal(trackingModeAfterSwap('hold', 'Pullups'), 'bodyweight');
      assert.equal(trackingModeAfterSwap('bodyweight', 'Barbell Squat'), 'load_and_reps');
    },
  },
  {
    name: 'swap tracking: the library alone never takes the weight dial away',
    run() {
      // CI review of #170. The library files these clearly loaded lifts as
      // "bodyweight", and the sheet's library search offers every one of
      // them; a loaded slot swapped to one hid the dial and saved 0 kg.
      for (const name of [
        'Weighted Squat',
        'Bench Press - With Bands',
        'Axle Deadlift',
        'Car Deadlift',
        'Rickshaw Deadlift',
        'Svend Press',
        'Front Plate Raise',
        'Weighted Bench Dip',
      ]) {
        assert.equal(trackingModeAfterSwap('load_and_reps', name), 'load_and_reps', name);
        assert.equal(trackingModeAfterSwap('reps_first', name), 'reps_first', name);
      }
      // Towards a weight it may move a slot: the mistake that costs nothing.
      assert.equal(trackingModeAfterSwap('bodyweight', 'Barbell Squat'), 'load_and_reps');
      // The programmes' own answer still decides both ways, and a hold is
      // still counted in seconds.
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Pull-Up'), 'bodyweight');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Plank'), 'hold');
    },
  },
  {
    name: 'swap tracking: a lift logged the same way keeps the slot its own mode',
    run() {
      // Only the kind of set changes hands: a reps-first accessory swapped for
      // another loaded lift stays reps-first.
      assert.equal(trackingModeAfterSwap('reps_first', 'Leg Press'), 'reps_first');
      assert.equal(trackingModeAfterSwap('load_and_reps', 'Leg Press'), 'load_and_reps');
      assert.equal(trackingModeAfterSwap('hold', 'Side Plank'), 'hold');
    },
  },
  {
    name: 'swap tracking: every swap a programme offers lands on the kind of set the programmes log that lift as',
    run() {
      const kindsByName = new Map();
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            const kinds = kindsByName.get(exercise.exerciseName) ?? new Set();
            kinds.add(kind(exercise.trackingMode));
            kindsByName.set(exercise.exerciseName, kinds);
          }
        }
      }
      const wrong = new Set();
      let crossing = 0;
      for (const template of WORKOUT_TEMPLATES_V1) {
        for (const session of template.sessions) {
          for (const exercise of session.exercises) {
            for (const option of buildSwapOptionsForSlot(exercise.substitutionGroup, exercise.exerciseName, null)) {
              const kinds = kindsByName.get(option.exerciseName);
              if (!kinds || kinds.size !== 1) {
                continue;
              }
              const [expected] = [...kinds];
              if (expected !== kind(exercise.trackingMode)) {
                crossing += 1;
              }
              const landed = kind(trackingModeAfterSwap(exercise.trackingMode, option.exerciseName));
              if (landed !== expected) {
                wrong.add(`${exercise.exerciseName} -> ${option.exerciseName}: ${landed}, programmes log it ${expected}`);
              }
            }
          }
        }
      }
      // The premise: the audit found hundreds of these.
      assert.ok(crossing > 400, `only ${crossing} programme-offered swaps cross a kind of set`);
      assert.deepEqual([...wrong], []);
    },
  },
  {
    name: 'swap prescription: numbers written in seconds are not read as repetitions, or the other way round',
    run() {
      const rowsOf = (name) =>
        WORKOUT_TEMPLATES_V1.flatMap((template) =>
          template.sessions.flatMap((session) =>
            session.exercises
              .filter((exercise) => exercise.exerciseName === name)
              .map((exercise) => `${exercise.repsMin}-${exercise.repsMax}`),
          ),
        );
      const asText = ({ repsMin, repsMax }) => `${repsMin}-${repsMax}`;

      // A 60-second hold swapped for a hip thrust opened the reps dial at 60.
      // It takes a prescription the programmes write for the hip thrust.
      const thrust = prescriptionAfterSwap('hold', 'load_and_reps', { repsMin: 30, repsMax: 60 }, 'Barbell Hip Thrust');
      assert.ok(rowsOf('Barbell Hip Thrust').includes(asText(thrust)), asText(thrust));
      // And the other way: ten reps of something swapped for a plank is not a
      // ten-second plank.
      const plank = prescriptionAfterSwap('bodyweight', 'hold', { repsMin: 10, repsMax: 10 }, 'Plank');
      assert.ok(rowsOf('Plank').includes(asText(plank)), asText(plank));
      assert.ok(plank.repsMin >= 20);
      // The lift's own prescription, not merely one of the right kind: the
      // programmes write this hold one way only, and not the way they write
      // holds in general.
      const bridgeHold = prescriptionAfterSwap('load_and_reps', 'hold', { repsMin: 8, repsMax: 8 }, 'Glute Bridge Hold');
      assert.deepEqual(rowsOf('Glute Bridge Hold').filter((row, index, all) => all.indexOf(row) === index), [asText(bridgeHold)]);

      // Same unit, same numbers: a swap keeps the slot's prescription.
      const kept = { repsMin: 6, repsMax: 8 };
      assert.equal(prescriptionAfterSwap('load_and_reps', 'bodyweight', kept, 'Pull-Up'), kept);
      assert.equal(prescriptionAfterSwap('hold', 'hold', kept, 'Side Plank'), kept);

      // A name no programme writes gets what they write for that kind of set:
      // seconds for a hold, a rep count for anything else — never the old unit.
      const unknownTimed = prescriptionAfterSwap('load_and_reps', 'hold', { repsMin: 10, repsMax: 10 }, 'A Hold Nobody Writes');
      const unknownCounted = prescriptionAfterSwap('hold', 'load_and_reps', { repsMin: 60, repsMax: 60 }, 'A Lift Nobody Writes');
      assert.ok(unknownTimed.repsMin >= 20, asText(unknownTimed));
      assert.ok(unknownCounted.repsMax <= 20, asText(unknownCounted));
    },
  },
];
