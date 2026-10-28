const assert = require('node:assert/strict');

const { setNumberLanguage } = require('../../src/lib/format');
setNumberLanguage('en');

const {
  buildPreviousTopSets,
  buildWhatMoved,
  resolveMovement,
} = require('../../src/lib/sessionMovement');

const log = (sessionId, name, weight, reps = [8]) => ({
  sessionId,
  exerciseNameSnapshot: name,
  weight,
  repsPerSet: reps,
});

const PERFORMED = {
  s1: '2026-08-13T18:00:00.000Z',
  s2: '2026-08-20T18:00:00.000Z',
  s3: '2026-08-27T18:00:00.000Z',
  today: '2026-09-04T18:00:00.000Z',
};

module.exports = [
  {
    name: 'last time means the last session, not the best one',
    run() {
      const tops = buildPreviousTopSets({
        logs: [
          log('s1', 'Bench Press', 70),
          log('s2', 'Bench Press', 60),
          log('s3', 'Bench Press', 62.5),
          log('today', 'Bench Press', 65),
        ],
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      // 62.5 from the most recent past session — not 70, the all-time best,
      // and not 65, which is today.
      assert.equal(tops['bench press'], 62.5);
    },
  },
  {
    name: 'the session that just finished is not its own history',
    run() {
      const tops = buildPreviousTopSets({
        logs: [log('today', 'Bench Press', 65)],
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      assert.deepEqual(tops, {});
    },
  },
  {
    name: 'per-set rows win over the log-level weight, and junk is skipped',
    run() {
      const tops = buildPreviousTopSets({
        logs: [
          {
            sessionId: 's3',
            exerciseNameSnapshot: 'Squat',
            weight: 100,
            repsPerSet: [5, 5],
            sets: [
              { weight: 100, reps: 5 },
              { weight: 110, reps: 3 },
            ],
          },
          // No session date on record, and a bodyweight lift with no load.
          log('unknown-session', 'Squat', 200),
          log('s3', 'Pullups', 0),
        ],
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      assert.equal(tops.squat, 110);
      assert.equal(tops.pullups, undefined);
    },
  },
  {
    name: 'a lift reads as up, same, down or new — and says which',
    run() {
      const row = (todayTopKg, previousTopKg) => ({
        exerciseName: 'Bench Press',
        todayTopKg,
        todayTopReps: 7,
        previousTopKg,
      });
      assert.deepEqual(resolveMovement(row(62.5, 60), 'en'), {
        exerciseName: 'Bench Press',
        kind: 'up',
        deltaKg: 2.5,
        label: '+2.5 kg',
      });
      assert.equal(resolveMovement(row(60, 60), 'en').kind, 'same');
      assert.equal(resolveMovement(row(60, 60), 'en').label, 'same');
      assert.equal(resolveMovement(row(60, 60), 'fi').label, 'sama');
      const down = resolveMovement(row(57.5, 60), 'en');
      assert.equal(down.kind, 'down');
      assert.equal(down.deltaKg, -2.5);
      assert.equal(down.label, '−2.5 kg');
      // Nothing to compare against makes no claim at all.
      assert.equal(resolveMovement(row(60, null), 'en').kind, 'new');
      assert.equal(resolveMovement(row(60, null), 'en').label, null);
      assert.equal(resolveMovement(row(0, 60), 'en').kind, 'new');
    },
  },
  {
    name: 'what moved lists only the lifts that went up, biggest jump first',
    run() {
      const moved = buildWhatMoved(
        [
          { exerciseName: 'Bench Press', todayTopKg: 62.5, todayTopReps: 7, previousTopKg: 60 },
          { exerciseName: 'Row', todayTopKg: 70, todayTopReps: 8, previousTopKg: 60 },
          { exerciseName: 'Curl', todayTopKg: 20, todayTopReps: 12, previousTopKg: 20 },
          { exerciseName: 'Fly', todayTopKg: 15, todayTopReps: 12, previousTopKg: 17.5 },
          { exerciseName: 'New Lift', todayTopKg: 40, todayTopReps: 10, previousTopKg: null },
        ],
        'en',
      );
      assert.deepEqual(moved.map((row) => row.exerciseName), ['Row', 'Bench Press']);
      assert.equal(moved[0].deltaLabel, '+10 kg');
      // The nudge names what was done and what to try next.
      assert.equal(moved[1].nudge, '62.5 × 7 — next time aim for 8.');
      assert.equal(
        buildWhatMoved(
          [{ exerciseName: 'Bench Press', todayTopKg: 62.5, todayTopReps: 7, previousTopKg: 60 }],
          'fi',
        )[0].nudge,
        '62.5 × 7 — ensi kerralla tavoittele 8.',
      );
      // A session that held everything steady has no card.
      assert.deepEqual(
        buildWhatMoved([{ exerciseName: 'Curl', todayTopKg: 20, todayTopReps: 12, previousTopKg: 20 }], 'en'),
        [],
      );
    },
  },
  {
    /*
     * Audit round 4 (2026-09-20): a 120 typed and never ticked beside a done
     * 100 read as last time's top set, so today's 105 came out "−15 kg" and
     * the lift went missing from WHAT MOVED. A pending or skipped row is a
     * number typed, not a bar lifted.
     */
    name: 'last time is the heaviest set that was done, not the heaviest one typed',
    run() {
      const tops = buildPreviousTopSets({
        logs: [
          {
            ...log('s3', 'Bench Press', 100),
            sets: [
              { weight: 100, reps: 8, status: 'completed' },
              { weight: 120, reps: 8, status: 'pending' },
              { weight: 110, reps: 8, status: 'skipped' },
            ],
          },
          log('today', 'Bench Press', 105),
        ],
        performedAtBySessionId: PERFORMED,
        excludeSessionId: 'today',
      });
      assert.equal(tops['bench press'], 100);
    },
  },
];
