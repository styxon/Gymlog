const assert = require('node:assert/strict');

const { workoutReducer } = require('../../../.test-dist/features/workout/workoutState');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../../.test-dist/features/workout/workoutAppAdapter');
const { elapsedSecondsOf, sessionLastActiveMs } = require('../../../.test-dist/lib/sessionClock.js');
const { MINUTES_DIAL } = require('../../../.test-dist/lib/weightDial.js');
const { stopwatchForSet } = require('../../../.test-dist/lib/minutesExercises.js');

/**
 * The minutes clock against the rest of the session (hunt, 2026-10-07).
 *
 * - A bout dispatches nothing while it runs, and a stretch past
 *   SESSION_IDLE_MS (2 h) with nothing dispatched was time away: a 150-minute
 *   ride saved the workout as one minute, and the header read 0:00 from the
 *   two-hour mark. A running clock now counts as in use, as far past its start
 *   as the minutes dial reaches; starting or pausing it is the reader doing
 *   something (updatedAt moves).
 * - Remove set left the clock on the set it took off, and "+ set" put the same
 *   index back with the old bout's minutes on it.
 * - Warm-ups kept through a swap (a set was logged before it) went to the new
 *   lift once that set was taken back: a barbell warm-up saved under a
 *   dumbbell lift.
 */

const MIN = 60_000;
const T0 = Date.parse('2026-10-11T07:00:00.000Z');

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
    substitutionGroup: 'press',
    ...overrides,
  };
}

const bike = (sets = 1) =>
  exercise('ride', 'Bicycling', {
    trackingMode: 'duration_minutes',
    sets,
    repsMin: 150,
    repsMax: 150,
    substitutionGroup: 'cardio',
  });

/** Runs `body` with Date.now() / new Date() at `clock.now`. */
function withNow(body) {
  const RealDate = Date;
  const clock = { now: T0 };
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(clock.now);
      else super(...args);
    }
    static now() {
      return clock.now;
    }
  };
  try {
    return body(clock);
  } finally {
    global.Date = RealDate;
  }
}

function start(exercises) {
  let state = workoutReducer(EMPTY, {
    type: 'session/startFromRuntimeTemplate',
    payload: {
      template: {
        id: 'tpl_own',
        name: 'Own - Day 1',
        defaultScheduleMode: 'weekly',
        sessions: [{ id: 'day_1', name: 'Day 1', orderIndex: 0, exercises }],
      },
      sessionOrderIndex: 1,
      unitPreference: 'kg',
    },
  });
  // Into the player: the workout's clock starts here.
  state = workoutReducer(state, { type: 'session/setGuidedStep', payload: { stepIndex: 1, nowMs: Date.now() } });
  return state;
}

const slotOf = (state, name) => state.activeSession.exercises.find((e) => e.exerciseName === name || e.sourceExerciseName === name).slotId;

function startClock(state, slotId, setIndex, exerciseName, accumulatedMs = 0) {
  return workoutReducer(state, {
    type: 'session/setMinutesClock',
    payload: { clock: { slotId, setIndex, exerciseName, plannedMinutes: 150, accumulatedMs, runningSinceMs: Date.now() }, nowMs: Date.now() },
  });
}

function log(state, slotId, setIndex, repsText, loadText) {
  const drafted = workoutReducer(state, {
    type: 'set/updateDraft',
    payload: { slotId, setIndex, patch: { repsText, loadText } },
  });
  return workoutReducer(drafted, {
    type: 'set/complete',
    payload: { slotId, setIndex, nowMs: Date.now(), unitPreference: 'kg' },
  });
}

function setOf(state, slotId, setIndex) {
  return state.activeSession.exercises.find((e) => e.slotId === slotId).sets.find((s) => s.setIndex === setIndex);
}

module.exports = [
  {
    name: 'minutes clock: a 150-minute ride timed on the clock is workout time, on the header and in the save',
    run() {
      withNow((clock) => {
        let state = start([bike()]);
        const ride = slotOf(state, 'Bicycling');
        clock.now += MIN;
        state = startClock(state, ride, 0, 'Bicycling');
        clock.now += 150 * MIN;
        const header = Math.round(elapsedSecondsOf(state.activeSession, clock.now) / 60);
        assert.ok(header >= 150, `the header reads ${header} min 150 minutes into the ride`);
        state = log(state, ride, 0, '150');
        assert.equal(setOf(state, ride, 0).status, 'completed');
        assert.equal(state.activeSession.pausedMs ?? 0, 0, 'none of the ride is taken off as time away');
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now);
        assert.ok(saved.durationMinutes >= 150, `the workout saves as ${saved.durationMinutes} min with a 150-minute ride`);
      });
    },
  },
  {
    name: 'minutes clock: a bout started after a long look at the step counts from the bout, not from the look',
    run() {
      withNow((clock) => {
        let state = start([bike()]);
        const ride = slotOf(state, 'Bicycling');
        // The session sits on the bike's step for two and a half hours, then the ride starts.
        clock.now += 150 * MIN;
        state = startClock(state, ride, 0, 'Bicycling');
        assert.equal(Date.parse(state.activeSession.updatedAt), clock.now, 'starting the bout is the reader doing something');
        clock.now += 40 * MIN;
        state = log(state, ride, 0, '40');
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now);
        assert.ok(
          saved.durationMinutes >= 39 && saved.durationMinutes <= 41,
          `a 40-minute ride after 150 minutes away saves as ${saved.durationMinutes} min`,
        );
      });
    },
  },
  {
    name: 'minutes clock: pausing the bout moves updatedAt; a clock that neither starts nor stops leaves it',
    run() {
      withNow((clock) => {
        let state = start([bike()]);
        const ride = slotOf(state, 'Bicycling');
        clock.now += MIN;
        state = startClock(state, ride, 0, 'Bicycling');
        const running = state.activeSession.minutesClock;
        clock.now += 30 * MIN;
        const same = workoutReducer(state, { type: 'session/setMinutesClock', payload: { clock: { ...running }, nowMs: clock.now } });
        assert.equal(same.activeSession.updatedAt, state.activeSession.updatedAt, 'the same running clock again is not an action');
        state = workoutReducer(state, {
          type: 'session/setMinutesClock',
          payload: { clock: { ...running, accumulatedMs: 30 * MIN, runningSinceMs: null }, nowMs: clock.now },
        });
        assert.equal(Date.parse(state.activeSession.updatedAt), clock.now, 'pausing the bout is the reader doing something');
      });
    },
  },
  {
    name: 'minutes clock: a clock left running and forgotten counts only as far as the minutes dial reaches',
    run() {
      const session = {
        sessionId: 's',
        status: 'active',
        pausedAt: null,
        startedAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0).toISOString(),
        restTimer: { status: 'idle', endsAtMs: null },
        minutesClock: { slotId: 'ride', setIndex: 0, exerciseName: 'Bicycling', plannedMinutes: 60, accumulatedMs: 0, runningSinceMs: T0 },
        exercises: [],
        ui: {},
      };
      const dialMs = MINUTES_DIAL.max * MIN;
      assert.equal(sessionLastActiveMs(session, T0 + 100 * MIN), T0 + 100 * MIN, 'in use while it runs');
      assert.equal(sessionLastActiveMs(session, T0 + dialMs + 180 * MIN), T0 + dialMs, 'no further than the dial reaches');
      assert.equal(
        sessionLastActiveMs({ ...session, minutesClock: { ...session.minutesClock, runningSinceMs: null, accumulatedMs: 20 * MIN } }, T0 + 100 * MIN),
        T0,
        'a stopped clock is not in use',
      );
      assert.equal(sessionLastActiveMs({ ...session, status: 'paused' }, T0 + 100 * MIN), T0, 'nor one in a paused workout');
      // Forgotten for three hours past the dial: those three hours are time away, the ride up to the dial is not.
      const header = elapsedSecondsOf(session, T0 + dialMs + 180 * MIN);
      assert.equal(header, MINUTES_DIAL.max * 60, 'the header holds the dial\'s reach and no more');
    },
  },
  {
    name: 'minutes clock: Remove set takes the clock of the set it removes, and the set put back starts at zero',
    run() {
      withNow((clock) => {
        let state = start([bike(3)]);
        const ride = slotOf(state, 'Bicycling');
        clock.now += MIN;
        state = startClock(state, ride, 2, 'Bicycling');
        clock.now += 3 * MIN;
        state = workoutReducer(state, { type: 'exercise/removeSet', payload: { slotId: ride } });
        assert.equal(state.activeSession.exercises[0].sets.length, 2, 'the last set came off');
        assert.equal(state.activeSession.minutesClock, null, 'and its clock with it');
        state = workoutReducer(state, { type: 'exercise/addSet', payload: { slotId: ride } });
        assert.ok(setOf(state, ride, 2), 'the same index is back');
        assert.deepEqual(
          stopwatchForSet(state.activeSession.minutesClock, { slotId: ride, setIndex: 2, exerciseName: 'Bicycling' }),
          { accumulatedMs: 0, runningSinceMs: null },
          'the new set opens on a stopped clock',
        );

        // A clock on another set of the lift stays.
        state = startClock(state, ride, 0, 'Bicycling');
        state = workoutReducer(state, { type: 'exercise/removeSet', payload: { slotId: ride } });
        assert.equal(state.activeSession.minutesClock?.setIndex, 0, 'a clock on a set still there is kept');
      });
    },
  },
  {
    name: 'warm-ups: taking back the last set of a lift swapped away drops its warm-ups, as the swap does',
    run() {
      withNow((clock) => {
        let state = start([exercise('bench', 'Bench Press')]);
        const bench = slotOf(state, 'Bench Press');
        clock.now += MIN;
        const warmAt = new Date(clock.now).toISOString();
        state = workoutReducer(state, { type: 'exercise/logWarmup', payload: { slotId: bench, loadKg: 40, reps: 10, completedAt: warmAt } });
        clock.now += MIN;
        state = log(state, bench, 0, '5', '80');
        state = workoutReducer(state, {
          type: 'exercise/swap',
          payload: { slotId: bench, exerciseName: 'Dumbbell Bench Press', substitutionGroup: 'press', unitPreference: 'kg' },
        });
        assert.equal(state.activeSession.exercises[0].warmups?.length, 1, 'kept through the swap: the bench set holds its row');
        state = workoutReducer(state, { type: 'set/undo', payload: { slotId: bench, setIndex: 0 } });
        assert.equal(state.activeSession.exercises[0].warmups, undefined, 'the bench has no row left, nor its warm-ups');
        assert.ok(state.activeSession.takenBackAt.includes(warmAt), 'remembered as taken back, for a finish merged with a stored one');
        clock.now += MIN;
        state = log(state, bench, 0, '10', '30');
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now);
        const warm = saved.logs.flatMap((l) => l.sets.filter((s) => s.kind === 'warmup').map(() => l.exerciseNameSnapshot));
        assert.deepEqual(warm, [], 'no barbell warm-up is saved under the dumbbell lift');
      });
    },
  },
  {
    name: 'warm-ups: the new lift\'s own warm-ups, or a bench set still logged, keep them through an undo',
    run() {
      withNow((clock) => {
        // Swapped first, then warmed up for the new lift: those are its warm-ups.
        let state = start([exercise('bench', 'Bench Press')]);
        const bench = slotOf(state, 'Bench Press');
        state = workoutReducer(state, {
          type: 'exercise/swap',
          payload: { slotId: bench, exerciseName: 'Dumbbell Bench Press', substitutionGroup: 'press', unitPreference: 'kg' },
        });
        clock.now += MIN;
        state = workoutReducer(state, {
          type: 'exercise/logWarmup',
          payload: { slotId: bench, loadKg: 12.5, reps: 10, completedAt: new Date(clock.now).toISOString() },
        });
        clock.now += MIN;
        state = log(state, bench, 0, '8', '25');
        state = workoutReducer(state, { type: 'set/undo', payload: { slotId: bench, setIndex: 0 } });
        assert.equal(state.activeSession.exercises[0].warmups?.length, 1, 'the dumbbell lift keeps its own warm-up');

        // Two bench sets, a swap, the second taken back: the first still holds the bench's row.
        state = start([exercise('bench', 'Bench Press')]);
        clock.now += MIN;
        state = workoutReducer(state, {
          type: 'exercise/logWarmup',
          payload: { slotId: bench, loadKg: 40, reps: 10, completedAt: new Date(clock.now).toISOString() },
        });
        clock.now += MIN;
        state = log(state, bench, 0, '5', '80');
        clock.now += MIN;
        state = log(state, bench, 1, '5', '80');
        state = workoutReducer(state, {
          type: 'exercise/swap',
          payload: { slotId: bench, exerciseName: 'Dumbbell Bench Press', substitutionGroup: 'press', unitPreference: 'kg' },
        });
        state = workoutReducer(state, { type: 'set/undo', payload: { slotId: bench, setIndex: 1 } });
        assert.equal(state.activeSession.exercises[0].warmups?.length, 1, 'a bench set is still logged: its warm-ups stay');
      });
    },
  },
  {
    name: 'minutes clock: a bout is stamped with the time on its action, not the wall clock (review, 2026-10-08)',
    run() {
      // The reducer read new Date() for updatedAt, so replaying the same
      // action gave a different state. The dispatcher stamps the action now,
      // the way set/repeatLast does, and the reducer only reads it.
      withNow((clock) => {
        let state = start([bike()]);
        const ride = slotOf(state, 'Bicycling');
        const stampedAt = clock.now + 7 * MIN;
        clock.now += 90 * MIN;
        const clockValue = { slotId: ride, setIndex: 0, exerciseName: 'Bicycling', plannedMinutes: 150, accumulatedMs: 0, runningSinceMs: stampedAt };
        const action = { type: 'session/setMinutesClock', payload: { clock: clockValue, nowMs: stampedAt } };
        const once = workoutReducer(state, action);
        assert.equal(Date.parse(once.activeSession.updatedAt), stampedAt, 'updatedAt is the nowMs on the action');
        clock.now += 30 * MIN;
        assert.deepEqual(workoutReducer(state, action), once, 'the same action on the same state is the same state');
      });
      const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../src/features/workout/workoutState.ts'), 'utf8');
      const branch = source.slice(source.indexOf("case 'session/setMinutesClock': {"), source.indexOf("case 'exercise/removeWarmup': {"));
      assert.doesNotMatch(branch.replace(/\/\/.*$/gm, ''), /new Date\(\)|Date\.now\(\)/, 'the reducer reads no clock of its own');
      const provider = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../../src/features/workout/WorkoutProvider.tsx'), 'utf8');
      assert.match(provider, /dispatch\(\{ type: 'session\/setMinutesClock', payload: \{ clock, nowMs: Date\.now\(\) \} \}\)/);
    },
  },
];
