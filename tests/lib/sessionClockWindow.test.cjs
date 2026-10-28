const assert = require('node:assert/strict');

const {
  SESSION_IDLE_MS,
  elapsedSecondsOf,
  sessionHasBegun,
  settleSessionClock,
  workoutSecondsUntil,
} = require('../../src/lib/sessionClock');
const { createCompletedSession, createExercise, createSet } = require('../helpers/workoutFixtures.cjs');

/**
 * Which window of time a workout's duration covers.
 *
 * Live-session audit, 2026-09-20: the clock started when "Start" built the
 * session, while the reader was still on the overview, and every hour the
 * phone spent in a pocket counted. Read in the morning and trained in the
 * evening saved 35 minutes as 633; two sets at night and the rest the next
 * morning saved 921. The rule: the clock starts at the first step, and a
 * stretch of more than two hours with nothing done in it is time away.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const MORNING = Date.parse('2026-09-21T05:00:00.000Z'); // 08:00 in Helsinki
const EVENING = Date.parse('2026-09-21T15:00:00.000Z'); // 18:00
const iso = (ms) => new Date(ms).toISOString();
const IDLE_TIMER = { status: 'idle', exerciseSlotId: null, setIndex: null, startedAtMs: null, endsAtMs: null, durationSeconds: 0 };
const running = (endsAtMs) => ({
  status: 'running',
  exerciseSlotId: 'slot_a',
  setIndex: 0,
  startedAtMs: endsAtMs - 180_000,
  endsAtMs,
  durationSeconds: 180,
});
const pending = (setIndex) =>
  createSet({ setIndex, status: 'pending', actualReps: undefined, actualLoadKg: undefined, completedAt: undefined, edited: false });

/** A live session, one set logged at `loggedAt`, stepped into the player. */
function live(loggedAt, overrides = {}) {
  const base = createCompletedSession();
  return {
    ...base,
    status: 'active',
    completedAt: undefined,
    startedAt: iso(loggedAt - 5 * MIN),
    updatedAt: iso(loggedAt),
    pausedMs: 0,
    pausedAt: null,
    pausedMsAtLastSet: 0,
    restTimer: IDLE_TIMER,
    ui: { ...base.ui, finishSummaryOpen: false, guidedStepIndex: 4 },
    exercises: [createExercise({ status: 'active', sets: [createSet({ completedAt: iso(loggedAt) }), pending(1), pending(2)] })],
    ...overrides,
  };
}

/** Just built by "Start": nothing stepped, nothing settled. */
function unbegun(builtAt) {
  const base = live(builtAt);
  return {
    ...base,
    startedAt: iso(builtAt),
    updatedAt: iso(builtAt),
    pausedMsAtLastSet: undefined,
    ui: { ...base.ui, guidedStepIndex: undefined },
    exercises: [createExercise({ status: 'pending', sets: [pending(0), pending(1), pending(2)] })],
  };
}

module.exports = [
  {
    name: 'session clock: the workout starts at its first step, not when Start built it',
    run() {
      const built = unbegun(MORNING);
      assert.equal(sessionHasBegun(built), false);

      // Something on the overview that is not a step leaves the clock alone.
      const drafted = { ...built, updatedAt: iso(MORNING + 2 * MIN) };
      assert.equal(settleSessionClock(built, drafted), drafted);

      // Closed with X in the morning, "Start" pressed at six in the evening.
      const stepped = { ...built, updatedAt: iso(EVENING), ui: { ...built.ui, guidedStepIndex: 0 } };
      const settled = settleSessionClock(built, stepped);
      assert.equal(settled.startedAt, iso(EVENING));
      assert.equal(settled.pausedMs, 0);
      assert.equal(elapsedSecondsOf(settled, EVENING + 35 * MIN), 35 * 60);

      // Once begun, a later step does not start it over.
      const nextStep = { ...settled, updatedAt: iso(EVENING + MIN), ui: { ...settled.ui, guidedStepIndex: 1 } };
      assert.equal(settleSessionClock(settled, nextStep).startedAt, iso(EVENING));
    },
  },
  {
    name: 'session clock: a player that opened straight onto a set starts the clock at that set',
    run() {
      const built = unbegun(MORNING);
      const at = EVENING + 3 * MIN;
      const logged = {
        ...built,
        updatedAt: iso(at),
        // The stamp as the reducer writes it: every pause since the build.
        pausedMsAtLastSet: 7 * MIN,
        pausedMs: 7 * MIN,
        exercises: [createExercise({ status: 'active', sets: [createSet({ completedAt: iso(at) }), pending(1), pending(2)] })],
      };
      const settled = settleSessionClock(built, logged);
      assert.equal(settled.startedAt, iso(at));
      assert.equal(settled.pausedMs, 0);
      assert.equal(settled.pausedMsAtLastSet, 0);
    },
  },
  {
    name: 'session clock: more than two hours with nothing done comes off at the next thing done',
    run() {
      // Two sets at night; the app was killed; the rest the next morning.
      const night = live(EVENING + 8 * MIN, { startedAt: iso(EVENING) });
      const morning = EVENING + 15 * HOUR;
      const next = { ...night, updatedAt: iso(morning), ui: { ...night.ui, guidedStepIndex: 5 } };
      const settled = settleSessionClock(night, next);
      assert.equal(settled.pausedMs, morning - (EVENING + 8 * MIN));
      assert.equal(settled.startedAt, iso(EVENING));
      assert.equal(elapsedSecondsOf(settled, morning + 20 * MIN), (8 + 20) * 60);

      // Up to the limit it is still the workout: an hour on the bike as a
      // cool-down of the reader's own tells the store nothing until it ends.
      assert.equal(SESSION_IDLE_MS, 2 * HOUR);
      const bike = { ...night, updatedAt: iso(EVENING + 8 * MIN + 70 * MIN) };
      assert.equal(settleSessionClock(night, bike), bike);
      const limit = { ...night, updatedAt: iso(EVENING + 8 * MIN + SESSION_IDLE_MS) };
      assert.equal(settleSessionClock(night, limit), limit);
    },
  },
  {
    name: 'session clock: a rest still running counts as in use up to its end',
    run() {
      const setAt = EVENING;
      const restEnds = setAt + 3 * MIN;
      const resting = live(setAt, { restTimer: running(restEnds) });

      // Past the limit after the set, inside it after the rest ran out.
      const soon = { ...resting, updatedAt: iso(setAt + SESSION_IDLE_MS + 2 * MIN) };
      assert.equal(settleSessionClock(resting, soon), soon);

      // Past it: the gap is counted from the rest's end, not the set.
      const late = setAt + 5 * HOUR;
      const settled = settleSessionClock(resting, { ...resting, updatedAt: iso(late) });
      assert.equal(settled.pausedMs, late - restEnds);
    },
  },
  {
    name: 'session clock: time spent paused is not taken off a second time',
    run() {
      const paused = live(EVENING, { status: 'paused', pausedAt: iso(EVENING + MIN) });
      const later = { ...paused, updatedAt: iso(EVENING + 5 * HOUR) };
      assert.equal(settleSessionClock(paused, later), later);
    },
  },
  {
    name: 'session clock: a set logged after the gap carries the gap, so a finish at that set is right too',
    run() {
      const night = live(EVENING + 8 * MIN, { startedAt: iso(EVENING) });
      const morning = EVENING + 15 * HOUR;
      const logged = {
        ...night,
        updatedAt: iso(morning),
        exercises: [
          createExercise({
            status: 'active',
            sets: [createSet({ completedAt: iso(EVENING + 8 * MIN) }), createSet({ setIndex: 1, completedAt: iso(morning) }), pending(2)],
          }),
        ],
      };
      const settled = settleSessionClock(night, logged);
      const gap = morning - (EVENING + 8 * MIN);
      assert.equal(settled.pausedMsAtLastSet, gap);
      // Ended at that set (left open, finished days later): eight minutes.
      assert.equal(workoutSecondsUntil(settled, morning), 8 * 60);

      // A change that logs nothing leaves the last set's stamp alone.
      const stepped = settleSessionClock(night, { ...night, updatedAt: iso(morning), ui: { ...night.ui, guidedStepIndex: 9 } });
      assert.equal(stepped.pausedMsAtLastSet, 0);
    },
  },
  {
    name: 'session clock: the clock on screen already leaves out a long idle stretch still running',
    run() {
      const s = live(EVENING + 10 * MIN, { startedAt: iso(EVENING) });
      // Under the limit it is training, and the clock runs.
      assert.equal(elapsedSecondsOf(s, EVENING + 40 * MIN), 40 * 60);
      assert.equal(elapsedSecondsOf(s, EVENING + 100 * MIN), 100 * 60);
      // Picked up five hours later: the clock stands where it was left,
      // instead of reading five hours and dropping back at the first tap.
      const later = EVENING + 10 * MIN + 5 * HOUR;
      assert.equal(elapsedSecondsOf(s, later), 10 * 60);
      const settled = settleSessionClock(s, { ...s, updatedAt: iso(later) });
      assert.equal(elapsedSecondsOf(settled, later), 10 * 60);
      assert.equal(elapsedSecondsOf(settled, later + 2 * MIN), 12 * 60);
      // Paused, the pause is what stops it — not both.
      const paused = { ...s, status: 'paused', pausedAt: iso(EVENING + 10 * MIN) };
      assert.equal(elapsedSecondsOf(paused, later), 10 * 60);
    },
  },
  {
    name: 'session clock: a finished session, or a different one, is left as it is',
    run() {
      const s = live(EVENING);
      const finished = { ...s, status: 'completed', updatedAt: iso(EVENING + 5 * HOUR) };
      assert.equal(settleSessionClock(s, finished), finished);
      const another = { ...s, sessionId: 'workout_session_002', updatedAt: iso(EVENING + 5 * HOUR) };
      assert.equal(settleSessionClock(s, another), another);
      assert.equal(settleSessionClock(null, s), s);
      assert.equal(settleSessionClock(s, null), null);
    },
  },
];
