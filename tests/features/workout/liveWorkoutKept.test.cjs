const assert = require('node:assert/strict');

// workoutPersistence reaches storage/largeItem, which reads Platform from react-native.
require('../../helpers/reactNativeStub.cjs').installReactNativeStub();

const { workoutReducer } = require('../../../src/features/workout/workoutState');
const { adaptCompletedWorkoutSessionForAppDatabase } = require('../../../src/features/workout/workoutAppAdapter');
const { elapsedSecondsOf } = require('../../../src/lib/sessionClock');
const { normalizeWorkoutBundle } = require('../../../src/features/workout/workoutPersistence');

/**
 * Live-session audit, 2026-09-20: what the guided player does between Start
 * and the save has to keep what the reader did, and the saved duration has to
 * cover the time they trained.
 *
 * The reducer stamps `updatedAt` with its own clock in most cases, so these
 * run on a clock the test moves.
 */

const MIN = 60_000;
const RealDate = Date;
function onClock(startMs, body) {
  let now = startMs;
  class TestDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else {
        super(...args);
      }
    }
    static now() {
      return now;
    }
  }
  global.Date = TestDate;
  try {
    return body({
      at: (ms) => {
        now = ms;
      },
      wait: (ms) => {
        now += ms;
      },
      now: () => now,
    });
  } finally {
    global.Date = RealDate;
  }
}

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

/** "Start" on a programme day: the session is built and the overview opens. */
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
            exercises: [exercise('squat', 'Back Squat'), exercise('press', 'Bench Press', { substitutionGroup: 'press' })],
          },
        ],
      },
      sessionOrderIndex: 1,
      unitPreference: 'kg',
    },
  });
}

// The provider's methods, as they dispatch now.
const step = (state, stepIndex) =>
  workoutReducer(state, { type: 'session/setGuidedStep', payload: { stepIndex, anchor: { type: 'set', stepIndex }, nowMs: Date.now() } });
const pause = (state) => workoutReducer(state, { type: 'session/pause' });
const resume = (state) => workoutReducer(state, { type: 'session/resume', payload: { nowMs: Date.now() } });
function log(state, slotId, setIndex) {
  const drafted = workoutReducer(state, { type: 'set/updateDraft', payload: { slotId, setIndex, patch: { loadText: '60', repsText: '8' } } });
  return workoutReducer(drafted, { type: 'set/complete', payload: { slotId, setIndex, nowMs: Date.now(), unitPreference: 'kg' } });
}
const setsOf = (state, slotId) =>
  state.activeSession.exercises.find((item) => item.slotId === slotId).sets.map((set) => set.status);
const slotOf = (state, index) => state.activeSession.exercises[index].slotId;

module.exports = [
  {
    name: 'live workout: pause, then Log keeps the set — the resume closes the pause on the session in the store',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), (clock) => {
        let state = step(start(), 3);
        const squat = slotOf(state, 0);
        clock.wait(MIN);
        state = pause(state);
        const pausedSnapshot = state.activeSession;
        clock.wait(2 * MIN);
        // One tap: the set is logged, then goTo resumes and moves to the rest.
        state = log(state, squat, 0);
        state = resume(state);
        state = step(state, 4);
        assert.deepEqual(setsOf(state, squat), ['completed', 'pending', 'pending']);
        assert.equal(state.activeSession.pausedAt, null);
        assert.equal(state.activeSession.status, 'active');
        assert.equal(state.activeSession.pausedMs, 2 * MIN);

        // The action carried the render's session; one that still does is
        // not read, so the set logged after that render stays logged.
        let replay = log(pause(step(start(), 3)), slotOf(state, 0), 0);
        replay = workoutReducer(replay, { type: 'session/resume', payload: { nowMs: Date.now(), session: pausedSnapshot } });
        assert.deepEqual(setsOf(replay, slotOf(replay, 0)), ['completed', 'pending', 'pending']);
      });
    },
  },
  {
    name: 'live workout: pause, then Swap or Skip exercise keeps the swap and the skip',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), () => {
        const paused = pause(step(start(), 3));
        const squat = slotOf(paused, 0);

        const swapped = resume(
          workoutReducer(paused, {
            type: 'exercise/swap',
            payload: { slotId: squat, exerciseName: 'Leg Press', substitutionGroup: 'squat', unitPreference: 'kg' },
          }),
        );
        assert.equal(swapped.activeSession.exercises[0].exerciseName, 'Leg Press');
        assert.equal(swapped.activeSession.pausedAt, null);

        const skipped = resume(workoutReducer(paused, { type: 'exercise/skip', payload: { slotId: squat } }));
        assert.equal(skipped.activeSession.exercises[0].status, 'skipped');
        assert.equal(skipped.activeSession.pausedAt, null);
      });
    },
  },
  {
    name: 'live workout: a pause longer than the idle limit comes off once, not again as time away',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), (clock) => {
        let state = step(start(), 3);
        const squat = slotOf(state, 0);
        clock.wait(10 * MIN);
        state = pause(state);
        clock.wait(180 * MIN);
        state = resume(state);
        clock.wait(MIN);
        state = log(state, squat, 0);
        assert.equal(state.activeSession.pausedMs, 180 * MIN);
        assert.equal(elapsedSecondsOf(state.activeSession, clock.now()), 11 * 60);
      });
    },
  },
  {
    name: 'live workout: resuming with nothing paused changes nothing',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), () => {
        // The player resumes on every step it moves to; each of those was a
        // new state object, a re-render of the app and a bundle write.
        const state = step(start(), 3);
        assert.equal(resume(state), state);
        assert.equal(resume(EMPTY), EMPTY);
      });
    },
  },
  {
    name: 'live workout: moving to another step is the reader doing something; staying on one is not',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), (clock) => {
        let state = step(start(), 3);
        clock.wait(90_000);
        state = step(state, 4);
        assert.equal(state.activeSession.updatedAt, new Date(clock.now()).toISOString());
        clock.wait(90_000);
        assert.equal(
          workoutReducer(state, { type: 'session/setGuidedStep', payload: { stepIndex: 4, anchor: { type: 'set', stepIndex: 4 }, nowMs: Date.now() } }),
          state,
        );
      });
    },
  },
  {
    name: 'live workout: read in the morning, trained in the evening, saved as the evening',
    run() {
      onClock(Date.parse('2026-09-21T05:00:00.000Z'), (clock) => {
        // Start at 08:00 opens the overview; X leaves it, the session kept.
        let state = start();
        // Home's "Resume" at 18:00, and the first step.
        clock.at(Date.parse('2026-09-21T15:00:00.000Z'));
        state = resume(state);
        state = step(state, 0);
        let index = 1;
        for (const item of state.activeSession.exercises) {
          for (const set of item.sets) {
            clock.wait(150_000);
            state = step(state, index++);
            state = log(state, item.slotId, set.setIndex);
          }
        }
        clock.wait(MIN);
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now());
        // Six sets, two and a half minutes each. It was 633 minutes.
        assert.equal(saved.durationMinutes, 15);
        assert.equal(saved.startedAt, '2026-09-21T15:00:00.000Z');
      });
    },
  },
  {
    name: 'live workout: two sets at night and the rest the next morning is the time trained, not the night',
    run() {
      onClock(Date.parse('2026-09-20T15:00:00.000Z'), (clock) => {
        let state = step(start(), 0);
        const squat = slotOf(state, 0);
        clock.wait(5 * MIN);
        state = log(state, squat, 0);
        clock.wait(3 * MIN);
        state = log(state, squat, 1);
        // Killed with the rest running; opened next morning at nine.
        const bundle = normalizeWorkoutBundle(JSON.parse(JSON.stringify({ activeSession: state.activeSession, history: state.history })));
        clock.at(Date.parse('2026-09-21T06:00:00.000Z'));
        state = workoutReducer(state, { type: 'session/hydrate', payload: bundle });
        state = workoutReducer(state, { type: 'session/tick', payload: { nowMs: Date.now() } });
        state = resume(state);
        const restEndedAt = Date.parse(state.activeSession.updatedAt);
        clock.wait(MIN);
        state = log(state, squat, 2);
        const press = slotOf(state, 1);
        for (let setIndex = 0; setIndex < 3; setIndex += 1) {
          clock.wait(2 * MIN);
          state = log(state, press, setIndex);
        }
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now() + MIN);
        // The night: start to the end of the rest after set two. The morning:
        // nine o'clock and a minute to the last set. It was 921 minutes.
        const night = (restEndedAt - Date.parse('2026-09-20T15:00:00.000Z')) / MIN;
        assert.equal(saved.durationMinutes, Math.round(night + 6));
        assert.ok(saved.durationMinutes < 20, `saved ${saved.durationMinutes} minutes`);
      });
    },
  },
  {
    name: 'live workout: the cool-down walked after the last set is in the saved duration',
    run() {
      onClock(Date.parse('2026-09-21T15:00:00.000Z'), (clock) => {
        let state = step(start(), 0);
        let index = 1;
        for (const item of state.activeSession.exercises) {
          for (const set of item.sets) {
            clock.wait(2 * MIN);
            state = log(state, item.slotId, set.setIndex);
            state = step(state, index++);
          }
        }
        // Six cool-down drills of half a minute, then the finish screen.
        for (let drill = 0; drill < 6; drill += 1) {
          clock.wait(30_000);
          state = step(state, index++);
        }
        const onScreen = Math.round(elapsedSecondsOf(state.activeSession, clock.now()) / 60);
        clock.wait(20_000);
        const saved = adaptCompletedWorkoutSessionForAppDatabase(state.activeSession, clock.now());
        assert.equal(onScreen, 15);
        assert.equal(saved.durationMinutes, onScreen);
        assert.equal(saved.performedAt, new Date(clock.now() - 20_000).toISOString());
      });
    },
  },
];
