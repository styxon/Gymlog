const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  restSecondsLeft,
  restTimerHasEnded,
  sessionLastActiveMs,
} = require('../../src/lib/sessionClock');
const { workoutReducer, workoutInitialState } = require('../../src/features/workout/workoutState');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../src/features/workout/workoutAppAdapter');
const { createCompletedSession, createExercise, createSet } = require('../helpers/workoutFixtures.cjs');

/**
 * A running rest ticked the whole app once a second (2026-09-16): every tick
 * was a new reducer state, so every consumer of the workout provider
 * re-rendered and the persistence effect rewrote the workout bundle, history
 * and all. The shared state now hears about a rest once, when it ends.
 */

const IDLE = { status: 'idle', exerciseSlotId: null, setIndex: null, startedAtMs: null, endsAtMs: null, durationSeconds: 0 };
const T0 = Date.parse('2026-09-16T15:00:00.000Z');
const running = (endsAtMs) => ({
  status: 'running',
  exerciseSlotId: 'slot_a',
  setIndex: 0,
  startedAtMs: endsAtMs - 90_000,
  endsAtMs,
  durationSeconds: 90,
});
const resting = (overrides = {}) =>
  createCompletedSession({
    status: 'active',
    completedAt: undefined,
    startedAt: '2026-09-16T14:30:00.000Z',
    updatedAt: new Date(T0).toISOString(),
    pausedMs: 0,
    pausedAt: null,
    restTimer: running(T0 + 90_000),
    exercises: [createExercise({ sets: [createSet({ setIndex: 0, completedAt: new Date(T0).toISOString() })] })],
    ...overrides,
  });

module.exports = [
  {
    name: 'session clock: a rest has ended at its end, and counts whole seconds down to it',
    run() {
      const timer = running(T0 + 90_000);
      assert.equal(restTimerHasEnded(timer, T0), false);
      assert.equal(restTimerHasEnded(timer, T0 + 89_999), false);
      assert.equal(restTimerHasEnded(timer, T0 + 90_000), true);
      assert.equal(restTimerHasEnded({ ...timer, status: 'paused' }, T0 + 200_000), false);
      assert.equal(restTimerHasEnded(IDLE, T0), false);

      assert.equal(restSecondsLeft(timer, T0), 90);
      assert.equal(restSecondsLeft(timer, T0 + 89_001), 1);
      assert.equal(restSecondsLeft(timer, T0 + 95_000), 0);
      assert.equal(restSecondsLeft(IDLE, T0), 0);
    },
  },
  {
    name: 'session clock: a resting session is in use up to now, or up to the rest’s end',
    run() {
      const session = resting();
      // Mid-rest: now.
      assert.equal(sessionLastActiveMs(session, T0 + 30_000), T0 + 30_000);
      // Long after the rest ended: the end, not now.
      assert.equal(sessionLastActiveMs(session, T0 + 3_600_000), T0 + 90_000);
      // No rest, or a paused session: the last action.
      assert.equal(sessionLastActiveMs(resting({ restTimer: IDLE }), T0 + 30_000), T0);
      assert.equal(sessionLastActiveMs(resting({ status: 'paused' }), T0 + 30_000), T0);
      // A session built without a timer reads as its last action.
      assert.equal(sessionLastActiveMs(resting({ restTimer: null }), T0 + 30_000), T0);
      assert.equal(adaptCompletedWorkoutSessionForAppDatabase(resting({ restTimer: undefined }), T0 + 30_000).performedAt, new Date(T0).toISOString());
      // A later action outranks the rest.
      const later = resting({ updatedAt: new Date(T0 + 120_000).toISOString() });
      assert.equal(sessionLastActiveMs(later, T0 + 30_000), T0 + 120_000);
    },
  },
  {
    name: 'session clock: a tick with nothing to do returns the same state, so nothing re-renders',
    run() {
      const state = { ...workoutInitialState, activeSession: resting() };
      // Before the rest ends: the very same object.
      assert.equal(workoutReducer(state, { type: 'session/tick', payload: { nowMs: T0 + 30_000 } }), state);
      // No session, or a paused one: the same object too.
      const empty = { ...workoutInitialState, activeSession: null };
      assert.equal(workoutReducer(empty, { type: 'session/tick', payload: { nowMs: T0 } }), empty);
      const paused = { ...state, activeSession: resting({ status: 'paused', pausedAt: new Date(T0).toISOString() }) };
      assert.equal(workoutReducer(paused, { type: 'session/tick', payload: { nowMs: T0 + 3_600_000 } }), paused);

      // After the end: the rest is put away, once, dated to its end.
      const woke = T0 + 10 * 60_000;
      const settled = workoutReducer(state, { type: 'session/tick', payload: { nowMs: woke } });
      assert.notEqual(settled, state);
      assert.equal(settled.activeSession.restTimer.status, 'idle');
      assert.equal(settled.activeSession.updatedAt, new Date(T0 + 90_000).toISOString());
      assert.equal(settled.activeSession.elapsedSeconds, Math.floor((woke - Date.parse('2026-09-16T14:30:00.000Z')) / 1000));
      assert.equal(workoutReducer(settled, { type: 'session/tick', payload: { nowMs: woke + 1000 } }), settled);
    },
  },
  {
    name: 'session clock: pausing a rest keeps the seconds left at the moment of the pause',
    run() {
      // The time comes with the action: the shared state keeps no clock.
      const state = { ...workoutInitialState, activeSession: resting() };
      assert.equal('nowMs' in workoutInitialState, false);
      const paused = workoutReducer(state, { type: 'timer/pause', payload: { nowMs: T0 + 30_000 } });
      assert.equal(paused.activeSession.restTimer.status, 'paused');
      assert.equal(paused.activeSession.restTimer.durationSeconds, 60);
    },
  },
  {
    name: 'session clock: finishing mid-rest still ends the workout now',
    run() {
      // The tick used to move updatedAt to now while the rest ran; the save
      // read it as the finish. Now the rest is read at the finish.
      const session = resting();
      const midRest = adaptCompletedWorkoutSessionForAppDatabase(session, T0 + 45_000);
      assert.equal(midRest.performedAt, new Date(T0 + 45_000).toISOString());
      // After the rest ran out unseen: its end.
      const late = adaptCompletedWorkoutSessionForAppDatabase(session, T0 + 30 * 60_000);
      assert.equal(late.performedAt, new Date(T0 + 90_000).toISOString());
      // No rest: the stored string, untouched.
      const idle = adaptCompletedWorkoutSessionForAppDatabase(resting({ restTimer: IDLE }), T0 + 45_000);
      assert.equal(idle.performedAt, new Date(T0).toISOString());
    },
  },
  {
    name: 'session clock: the provider sets one timer for the rest’s end, and no second hand',
    run() {
      const source = fs
        .readFileSync(path.join(__dirname, '..', '..', 'src', 'features', 'workout', 'WorkoutProvider.tsx'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(source, /setInterval\(/);
      assert.doesNotMatch(source, /needsClock/);
      // Settling is the provider's own business: no tick() for a caller to put on an interval.
      assert.doesNotMatch(source, /\btick\(\)/);
      assert.match(source, /const timeout = setTimeout\(settle, Math\.max\(0, restEndsAtMs - Date\.now\(\)\)\);/);
      assert.match(source, /AppState\.addEventListener\('change', \(next\) => \{\s*if \(next === 'active'\) \{\s*settle\(\);/);
      assert.match(source, /clearTimeout\(timeout\);\s*subscription\.remove\(\);/);
      assert.match(source, /\}, \[state\.hydrated, restEndsAtMs\]\);/);
      // Only an active session's running rest arms it.
      assert.match(
        source,
        /state\.activeSession\?\.status === 'active' && state\.activeSession\.restTimer\.status === 'running'\s*\? state\.activeSession\.restTimer\.endsAtMs\s*: null;/,
      );
      assert.match(source, /dispatch\(\{ type: 'timer\/pause', payload: \{ nowMs: Date\.now\(\) \} \}\);/);
    },
  },
];
