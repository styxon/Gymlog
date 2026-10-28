const assert = require('node:assert/strict');

const { logRecordedWork, sessionRecordedWork } = require('../../src/lib/exerciseLog');
const { getTrackedExerciseProgress } = require('../../src/lib/progression');

function set(reps, weight, status) {
  return { orderIndex: 0, weight, reps, kind: 'working', outcome: null, status, effort: null, completedAt: null, skippedReason: null };
}

function db(logs, strengthGoals = []) {
  return {
    exerciseTemplates: [],
    exerciseLibrary: [],
    workoutSessions: [{ id: 's1', performedAt: new Date(2026, 7, 6, 12).toISOString() }],
    exerciseLogs: logs,
    preferences: { strengthGoals },
  };
}

module.exports = [
  {
    name: 'a workout of skips, swaps and notes with no set done recorded no work (#bugs 2026-10-01)',
    run() {
      const skipped = { sets: [set(5, 80, 'completed')], skipped: true };
      const untouched = { sets: [set(0, 0, 'pending'), set(0, 0, 'skipped')] };
      // Drafts carry no flat weight or reps — the sets do.
      assert.equal(sessionRecordedWork([skipped, untouched]), false);
      assert.equal(sessionRecordedWork([]), false);
      assert.equal(sessionRecordedWork([untouched, { sets: [set(6, 60, 'completed')] }]), true);
    },
  },
  {
    name: 'a set nobody did is not work; a bodyweight set is',
    run() {
      // The rows an abandoned workout leaves behind: on the board, never done.
      assert.equal(
        logRecordedWork({ sets: [set(0, 0, 'active'), set(0, 0, 'active')], weight: 0, repsPerSet: [0, 0] }),
        false,
      );
      // Zero kilos is a real pull-up, so the test is reps and not weight.
      assert.equal(logRecordedWork({ sets: [set(8, 0, 'completed')], weight: 0, repsPerSet: [8] }), true);
      assert.equal(logRecordedWork({ sets: [set(5, 80, 'completed')], weight: 80, repsPerSet: [5] }), true);
      assert.equal(logRecordedWork(null), false);
      assert.equal(
        logRecordedWork({ sets: [set(5, 80, 'completed')], weight: 80, repsPerSet: [5], skipped: true }),
        false,
      );
    },
  },
  {
    name: 'an abandoned exercise does not drag a lift down to zero',
    run() {
      // Exactly the shape that shipped: bench at 80 kg, then the same lift put
      // on the board in a later session and never performed.
      const summaries = getTrackedExerciseProgress(
        db([
          {
            id: 'l1',
            sessionId: 's1',
            exerciseNameSnapshot: 'Barbell Bench Press',
            weight: 80,
            repsPerSet: [5],
            sets: [set(5, 80, 'completed')],
            tracked: true,
            skipped: false,
            status: 'completed',
          },
          {
            id: 'l2',
            sessionId: 's1',
            exerciseNameSnapshot: 'Barbell Bench Press',
            weight: 0,
            repsPerSet: [0, 0, 0],
            sets: [set(0, 0, 'active'), set(0, 0, 'active'), set(0, 0, 'active')],
            tracked: true,
            skipped: false,
            status: 'active',
          },
        ]),
      );

      const bench = summaries.find((summary) => summary.name.includes('Bench'));
      assert.ok(bench, 'the lift is still tracked');
      assert.equal(bench.logs.length, 1, 'only the session that happened counts');
      assert.equal(bench.latestWeight, 80, 'not 0 — the headline said "0 kg x 0" before this');
    },
  },
  {
    // Nothing seeds this lift now that the library's star is gone: only a
    // TARGET puts an unlogged lift on Progress, and there is none here.
    name: 'a lift that was only ever put on the board is not tracked at all',
    run() {
      const summaries = getTrackedExerciseProgress(
        db([
          {
            id: 'l1',
            sessionId: 's1',
            exerciseNameSnapshot: 'Barbell Squat',
            weight: 0,
            repsPerSet: [0],
            sets: [set(0, 0, 'active')],
            tracked: true,
            skipped: false,
            status: 'active',
          },
        ]),
      );
      assert.deepEqual(summaries, [], 'it appeared in the list reading "0 kg x 0"');
    },
  },
  {
    /**
     * A target puts its lift on Progress before the first session.
     *
     * This was the library's star, whose only effect was this line — a control
     * on one tab that changed another, and which asked for nothing back. It is
     * a target now, so the empty row arrives with a number to move towards
     * (user, 2026-09-01).
     */
    name: 'a lift you have set a target on is tracked before you have logged it',
    run() {
      const withGoal = getTrackedExerciseProgress(
        db([], [{ exerciseName: 'Barbell Squat', targetKg: 140, createdAt: '2026-09-01T00:00:00.000Z' }]),
      );
      assert.equal(withGoal.length, 1, 'a target did not put its lift on Progress');
      assert.equal(withGoal[0].name, 'Barbell Squat');
      assert.deepEqual(withGoal[0].logs, [], 'the row is there, with nothing logged yet');
      assert.equal(withGoal[0].latestWeight, null, 'an unlogged lift must not read as 0 kg');

      // And a target on a lift already logged does not double it.
      const logged = getTrackedExerciseProgress(
        db(
          [
            {
              id: 'l1',
              sessionId: 's1',
              exerciseNameSnapshot: 'Barbell Squat',
              weight: 100,
              repsPerSet: [5],
              sets: [set(5, 100, 'completed')],
              tracked: true,
              skipped: false,
              status: 'completed',
            },
          ],
          [{ exerciseName: 'Barbell Squat', targetKg: 140, createdAt: '2026-09-01T00:00:00.000Z' }],
        ),
      );
      assert.equal(logged.length, 1, 'the target added a second row for a lift already there');
      assert.equal(logged[0].logs.length, 1);

      // No target, no logs, no row — the star used to be able to make one.
      assert.deepEqual(getTrackedExerciseProgress(db([], [])), []);
    },
  },
];
