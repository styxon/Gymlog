const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const { workoutReducer } = require('../../../.test-dist/features/workout/workoutState');
const { normalizeWorkoutBundle } = require('../../../.test-dist/features/workout/workoutPersistence');
const {
  minutesBoutDueMs,
  minutesToLog,
  normalizeSessionMinutesClock,
  startStopwatch,
  stopwatchElapsedMs,
  stopwatchForSet,
} = require('../../../.test-dist/lib/minutesExercises.js');

/**
 * #bugs 2026-10-06: a bout of minutes (bike, stair machine, run block) kept
 * its stopwatch in the set screen's state alone. Android killing the app
 * twenty minutes into a ride started the clock again from zero, and the dial
 * logged the prescription instead of the minutes ridden. And a running clock
 * was not activity, so the idle nudge asked "still training?" 25 minutes into
 * a 40-minute ride.
 *
 * The clock now lives on the session: started and paused through the
 * reducer, stored with the session, read back by the set it belongs to.
 */

const MIN = 60_000;
const ROOT = path.join(__dirname, '..', '..', '..');

const EMPTY = {
  hydrated: true,
  isRestoring: false,
  activeSession: null,
  activeCardio: null,
  freestyleDraft: null,
  completionSummary: null,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
};

function exercise(id, name, overrides = {}) {
  return {
    id,
    exerciseName: name,
    slotId: id,
    role: 'primary',
    progressionPriority: 'high',
    trackingMode: 'load_and_reps',
    sets: 3,
    repsMin: 6,
    repsMax: 8,
    restSecondsMin: 120,
    restSecondsMax: 150,
    substitutionGroup: 'squat',
    ...overrides,
  };
}

function start() {
  return workoutReducer(EMPTY, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: {
        id: 'tpl_own',
        name: 'Own - Day 1',
        defaultScheduleMode: 'weekly',
        sessions: [
          {
            id: 'day_1',
            name: 'Day 1',
            orderIndex: 0,
            exercises: [
              exercise('squat', 'Back Squat'),
              exercise('bike', 'Stationary Bike', {
                trackingMode: 'duration_minutes',
                sets: 1,
                repsMin: 20,
                repsMax: 20,
                substitutionGroup: 'cardio',
              }),
            ],
          },
        ],
      },
      sessionOrderIndex: 1,
      unitPreference: 'kg',
    },
  });
}

/** Through storage and back, as a cold start does. */
function coldStart(state) {
  const bundle = normalizeWorkoutBundle(
    JSON.parse(JSON.stringify({ activeSession: state.activeSession, history: state.history })),
  );
  return workoutReducer({ ...EMPTY, hydrated: false }, { type: 'session/hydrate', payload: bundle });
}

const T0 = Date.parse('2026-10-07T15:00:00.000Z');
const bikeSet = { slotId: 'bike', setIndex: 0, exerciseName: 'Stationary Bike' };
const runningBike = (sinceMs, accumulatedMs = 0) => ({
  ...bikeSet,
  plannedMinutes: 20,
  accumulatedMs,
  runningSinceMs: sinceMs,
});

module.exports = [
  {
    name: 'minutes clock: a cold start mid-ride opens on the clock still running, and logs the minutes ridden',
    run() {
      let state = start();
      state = workoutReducer(state, { type: 'session/setMinutesClock', payload: { clock: runningBike(T0) } });

      // Killed with the screen off; the screen mounts again 22 minutes in.
      const restored = coldStart(state);
      const watch = stopwatchForSet(restored.activeSession.minutesClock, bikeSet);
      assert.equal(watch.runningSinceMs, T0, 'the clock comes back running from when it started');
      const elapsedMs = stopwatchElapsedMs(watch, T0 + 22 * MIN);
      assert.equal(elapsedMs, 22 * MIN);
      assert.equal(minutesToLog({ plannedMinutes: 20, elapsedMs }), 22, 'the dial follows the ride, not the plan');
    },
  },
  {
    name: 'minutes clock: a paused clock keeps its minutes across a cold start',
    run() {
      let state = start();
      state = workoutReducer(state, {
        type: 'session/setMinutesClock',
        payload: { clock: { ...runningBike(null, 7 * MIN) } },
      });
      const watch = stopwatchForSet(coldStart(state).activeSession.minutesClock, bikeSet);
      assert.deepEqual(watch, { accumulatedMs: 7 * MIN, runningSinceMs: null });
    },
  },
  {
    name: 'minutes clock: another set, or another bout swapped into the slot, starts at zero',
    run() {
      const clock = runningBike(T0, 3 * MIN);
      const stopped = { accumulatedMs: 0, runningSinceMs: null };
      assert.deepEqual(stopwatchForSet(clock, { ...bikeSet, setIndex: 1 }), stopped);
      assert.deepEqual(stopwatchForSet(clock, { ...bikeSet, slotId: 'squat' }), stopped);
      assert.deepEqual(stopwatchForSet(clock, { ...bikeSet, exerciseName: 'Rowing, Stationary' }), stopped);
      assert.deepEqual(stopwatchForSet(null, bikeSet), stopped);
      assert.deepEqual(stopwatchForSet(clock, bikeSet), { accumulatedMs: 3 * MIN, runningSinceMs: T0 });
    },
  },
  {
    name: 'minutes clock: logging the set the clock belongs to clears it; logging another set does not',
    run() {
      let state = start();
      const squat = state.activeSession.exercises[0].slotId;
      state = workoutReducer(state, {
        type: 'session/setMinutesClock',
        payload: { clock: { ...runningBike(T0), slotId: squat, exerciseName: 'Back Squat' } },
      });
      const completed = (current) =>
        current.activeSession.exercises[0].sets.filter((set) => set.status === 'completed').length;
      const log = (current, slotId, setIndex) => {
        const drafted = workoutReducer(current, {
          type: 'set/updateDraft',
          payload: { slotId, setIndex, patch: { loadText: '60', repsText: '8' } },
        });
        return workoutReducer(drafted, {
          type: 'set/complete',
          payload: { slotId, setIndex, nowMs: T0 + MIN, unitPreference: 'kg' },
        });
      };
      state = log(state, squat, 1);
      assert.equal(completed(state), 1, 'the other set was logged');
      assert.notEqual(state.activeSession.minutesClock, null, 'a different set leaves the clock alone');
      state = log(state, squat, 0);
      assert.equal(completed(state), 2, 'the timed set was logged');
      assert.equal(state.activeSession.minutesClock, null, 'the set it timed is logged');
    },
  },
  {
    name: 'minutes clock: a session stored before the clock existed, or with a damaged one, opens with none',
    run() {
      const state = start();
      const old = { ...state.activeSession };
      delete old.minutesClock;
      const fromOld = normalizeWorkoutBundle(JSON.parse(JSON.stringify({ activeSession: old, history: state.history })));
      assert.ok(fromOld.activeSession, 'the session itself is kept');
      assert.equal(fromOld.activeSession.minutesClock ?? null, null);

      for (const junk of [
        'running',
        { slotId: 'bike', setIndex: 0, exerciseName: 'Stationary Bike', accumulatedMs: 'lots', runningSinceMs: null },
        { slotId: 'bike', setIndex: -1, exerciseName: 'Stationary Bike', accumulatedMs: 0, runningSinceMs: null },
        { slotId: 'bike', setIndex: 0, exerciseName: 'Stationary Bike', accumulatedMs: 0, runningSinceMs: 'now' },
        { setIndex: 0, exerciseName: 'Stationary Bike', accumulatedMs: 0, runningSinceMs: null },
      ]) {
        const damaged = normalizeWorkoutBundle(
          JSON.parse(JSON.stringify({ activeSession: { ...old, minutesClock: junk }, history: state.history })),
        );
        assert.ok(damaged.activeSession, `a damaged clock does not cost the session: ${JSON.stringify(junk)}`);
        assert.equal(damaged.activeSession.minutesClock ?? null, null);
      }
      // A clock without a usable prescription is still a clock.
      assert.equal(
        normalizeSessionMinutesClock({ ...runningBike(T0), plannedMinutes: 'x' }).plannedMinutes,
        0,
      );
    },
  },
  {
    name: 'minutes clock: a running bout is due back when its minutes are in; stopped, it is not waited for',
    run() {
      assert.equal(minutesBoutDueMs(runningBike(T0)), T0 + 20 * MIN);
      // Resumed after 12 minutes already ridden: eight more.
      assert.equal(minutesBoutDueMs(runningBike(T0, 12 * MIN)), T0 + 8 * MIN);
      // Already past the plan: due now, from the moment it was resumed.
      assert.equal(minutesBoutDueMs(runningBike(T0, 30 * MIN)), T0);
      assert.equal(minutesBoutDueMs(runningBike(null, 5 * MIN)), null);
      assert.equal(minutesBoutDueMs(null), null);
      const started = startStopwatch({ accumulatedMs: 0, runningSinceMs: null }, T0);
      assert.equal(started.runningSinceMs, T0);
    },
  },
  {
    name: 'minutes clock: the set screen reads the session clock and writes every start and pause; the idle nudge waits for the bout',
    run() {
      const screen = fs.readFileSync(path.join(ROOT, 'src/screens/GuidedPlayerScreen.tsx'), 'utf8');
      assert.match(screen, /stopwatchForSet\(minutesClock,/, 'the screen opens on the session clock');
      assert.doesNotMatch(screen, /setWatch\(STOPPED_STOPWATCH\)/, 'a new step reads the session, not a fresh zero');
      assert.match(screen, /onMinutesClockChange=\{workout\.setMinutesClock\}/, 'the player hands starts and pauses to the session');
      assert.match(screen, /minutesClock=\{workout\.activeSession\?\.minutesClock/, 'the player hands the kept clock to the set');

      const nudge = fs.readFileSync(path.join(ROOT, 'src/app/useSessionNotifications.ts'), 'utf8');
      assert.match(nudge, /idleNudgeAtMs\(Math\.max\(lastActivityAtRef\.current, boutDueMs \?\? 0\)\)/);
      assert.match(
        nudge,
        /lastActivityAtRef\.current = Date\.now\(\);\s*\}, \[minutesClock\?\.runningSinceMs, minutesClock\?\.accumulatedMs\]\);/,
        'starting or pausing the clock is the reader being there',
      );
      assert.match(nudge, /preferences\.appLanguage,\s*boutDueMs,\s*\]\);/, 'the nudge is armed again when the bout changes');
    },
  },
];
