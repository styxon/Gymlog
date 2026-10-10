process.env.TZ = 'Europe/Helsinki';
const assert = require('node:assert/strict');

const { setsOfCurrentLift, splitExerciseByLift } = require('../../.test-dist/lib/liftSegments.js');
const { buildExerciseSheetHistory, gateExerciseSheetHistory } = require('../../.test-dist/lib/exerciseSheetHistory.js');
const { resolveGuidedSetPlan, buildGuidedSteps, getGuidedNextName } = require('../../.test-dist/lib/guidedPlayer.js');
const { guidedTodayLoadKg } = require('../../.test-dist/lib/guidedSetRow.js');
const {
  isLoggableTypedReps,
  REPS_DIAL,
  HOLD_DIAL,
  MINUTES_DIAL,
  WARMUP_REPS_DIAL,
} = require('../../.test-dist/lib/weightDial.js');
const { exerciseCardAccessibilityLabel } = require('../../.test-dist/lib/accessibilityLabels.js');
const { exerciseNameLabel, PLAIN_EXERCISE_NAMES } = require('../../.test-dist/lib/exerciseNameLabel.js');
const { workoutReducer, workoutInitialState } = require('../../.test-dist/features/workout/workoutState.js');

// Programmed as Barbell Bench Press; set 0 done at 100 x 5, then swapped to
// Dumbbell Bench Press; set 1 done at 32 x 8; set 2 still to do.
const set = (i, status, load, reps, loggedAs) => ({
  setIndex: i,
  status,
  actualLoadKg: load,
  actualReps: reps,
  plannedRepsMin: 8,
  plannedRepsMax: 8,
  draftLoadText: '',
  draftRepsText: '',
  ...(loggedAs ? { loggedAs } : {}),
});
const swapped = () => ({
  exerciseName: 'Dumbbell Bench Press',
  sourceExerciseName: 'Barbell Bench Press',
  trackingMode: 'load_and_reps',
  swappedAfterSetIndex: 0,
  sets: [
    set(0, 'completed', 100, 5, { exerciseName: 'Barbell Bench Press', trackingMode: 'load_and_reps' }),
    set(1, 'completed', 32, 8, { exerciseName: 'Dumbbell Bench Press', trackingMode: 'load_and_reps' }),
    set(2, 'pending'),
  ],
});

module.exports = [
  {
    name: 'hunt 11 #1: after a swap, today means the sets logged as the lift in the slot now',
    run() {
      const instance = swapped();
      assert.deepEqual(setsOfCurrentLift(instance).map((s) => s.setIndex), [1, 2]);
      // Agrees with the save's own split.
      assert.deepEqual(
        splitExerciseByLift(instance).find((segment) => segment.current).sets.map((s) => s.actualReps),
        [8, undefined],
      );

      const past = [{ performedAt: '2026-10-01T10:00:00Z', sets: [{ loadKg: 30, reps: 10 }] }];
      const todaySets = setsOfCurrentLift(instance)
        .filter((s) => s.status === 'completed')
        .map((s) => ({ loadKg: s.actualLoadKg, reps: s.actualReps }));
      const history = gateExerciseSheetHistory(
        buildExerciseSheetHistory(past, { performedAt: new Date().toISOString(), sets: todaySets }, 'en', 'load_and_reps'),
        true,
      );
      assert.equal(history.rows[0].loadLabel, '32 kg');
      assert.equal(history.bestSetLabel, '32 kg \u00d7 8');

      // The card's TODAY chips and its weight.
      assert.deepEqual(
        resolveGuidedSetPlan(setsOfCurrentLift(instance), 2, 'load_and_reps', 0).map((chip) => chip.status),
        ['done', 'current'],
      );
      const heaviest = guidedTodayLoadKg({
        sets: setsOfCurrentLift(instance),
        currentSetIndex: 2,
        currentKg: null,
        trackingMode: 'load_and_reps',
        swappedAfterSetIndex: 0,
      });
      assert.equal(heaviest, 32);
    },
  },
  {
    name: 'hunt 11 #1: a slot that was never swapped keeps every set; a swap back counts the sets done as this lift',
    run() {
      const plain = {
        exerciseName: 'Barbell Bench Press',
        trackingMode: 'load_and_reps',
        sets: [set(0, 'completed', 100, 5), set(1, 'pending')],
      };
      assert.equal(setsOfCurrentLift(plain).length, 2);
      const back = swapped();
      back.exerciseName = 'Barbell Bench Press';
      back.sets[1].loggedAs = { exerciseName: 'Dumbbell Bench Press', trackingMode: 'load_and_reps' };
      assert.deepEqual(setsOfCurrentLift(back).map((s) => s.setIndex), [0, 2]);
    },
  },
  {
    name: 'hunt 11 #2: typed reps the dial would clamp are not loggable',
    run() {
      for (const text of ['0', '350', '1000', '', '--', 'abc']) {
        assert.equal(isLoggableTypedReps(text, REPS_DIAL), false, text);
      }
      for (const text of ['1', '8', '300', '12']) {
        assert.equal(isLoggableTypedReps(text, REPS_DIAL), true, text);
      }
      assert.equal(isLoggableTypedReps('3', HOLD_DIAL), false);
      assert.equal(isLoggableTypedReps('5', HOLD_DIAL), true);
      assert.equal(isLoggableTypedReps('45', HOLD_DIAL), true);
      assert.equal(isLoggableTypedReps('301', MINUTES_DIAL), false);
      assert.equal(isLoggableTypedReps('20', MINUTES_DIAL), true);
    },
  },
  {
    name: 'hunt 11 #3: the warm-up dial stops where the store does',
    run() {
      assert.equal(isLoggableTypedReps('100', WARMUP_REPS_DIAL), true);
      assert.equal(isLoggableTypedReps('101', WARMUP_REPS_DIAL), false);
      const session = { exercises: [{ slotId: 's1', sets: [], warmups: undefined }], takenBackAt: [] };
      const state = { ...workoutInitialState, activeSession: session };
      const log = (reps) =>
        workoutReducer(state, {
          type: 'exercise/logWarmup',
          payload: { slotId: 's1', loadKg: 40, reps, completedAt: '2026-10-10T10:00:00Z' },
        });
      assert.equal(log(WARMUP_REPS_DIAL.max).activeSession.exercises[0].warmups.length, 1);
      assert.equal(log(WARMUP_REPS_DIAL.max + 1), state);
    },
  },
  {
    name: 'hunt 11 #4: the set card is read in minutes or seconds, not reps, for a bout or a hold',
    run() {
      const bike = exerciseCardAccessibilityLabel(
        'fi',
        'KuntopyorÃ¤',
        { sets: [{ loadKg: 0, reps: 20 }], borrowed: false },
        null,
        'minutes',
      );
      assert.match(bike, /20 min/);
      assert.doesNotMatch(bike, /toistot/);
      const plank = exerciseCardAccessibilityLabel(
        'en',
        'Plank',
        { sets: [{ loadKg: 0, reps: 60 }, { loadKg: 0, reps: 45 }], borrowed: false },
        [60, 60],
        'seconds',
      );
      assert.match(plank, /60 s, 45 s/);
      assert.match(plank, /Today: 60 s, 60 s/);
      assert.doesNotMatch(plank, /reps/);
      // Reps unchanged.
      const squat = exerciseCardAccessibilityLabel(
        'en',
        'Squat',
        { sets: [{ loadKg: 80, reps: 5 }], borrowed: false },
        [5, null],
      );
      assert.match(squat, /reps 5/);
      assert.match(squat, /Today: 5, /);
    },
  },
  {
    name: 'hunt 11 #8: the next lift is named once through the table, so the OS card matches the rest screen',
    run() {
      let checked = 0;
      for (const name of Object.keys(PLAIN_EXERCISE_NAMES)) {
        const { steps } = buildGuidedSteps(
          {
            warmup: [],
            exercises: [{ slotId: 'a', name, restSeconds: 90, setCount: 3, skipped: false, supersetGroup: null }],
            cooldown: [],
          },
          'fi',
        );
        const restIndex = steps.findIndex((s) => s.type === 'rest');
        assert.equal(getGuidedNextName(steps, restIndex, 'fi'), exerciseNameLabel('fi', name), name);
        checked += 1;
      }
      assert.ok(checked > 0);
      // The trap the screen fell into: English display name first, Finnish of that second.
      assert.notEqual(
        exerciseNameLabel('fi', exerciseNameLabel('en', 'Front Barbell Squat')),
        exerciseNameLabel('fi', 'Front Barbell Squat'),
      );
    },
  },
];