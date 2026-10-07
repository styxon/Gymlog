const assert = require('node:assert/strict');

const { isMinutesLogEntry } = require('../../.test-dist/lib/minutesExercises.js');
const { buildRepsLiftHistories } = require('../../.test-dist/lib/trainingHistory.js');
const { getMilestoneFacts } = require('../../.test-dist/lib/milestoneFacts.js');
const { recordSetsOfLog } = require('../../.test-dist/lib/personalRecords.js');
const { getLifetimeTrainingSummary } = require('../../.test-dist/lib/lifetimeSummary.js');

/**
 * Whether a log is minutes is one question with one answer: the log's own unit
 * says so for anything saved since 2026-10-06, and its name says so for a log
 * saved before the unit existed. Four readers used to disagree — the records
 * and the coach's context asked both, the rep histories and the milestone
 * totals asked only the unit — so an old Stairmaster log was "20 reps" on the
 * milestone card and "20 minutes" in the records.
 */

function setRow(reps, orderIndex = 0) {
  return { orderIndex, weight: 0, reps, kind: 'working', outcome: 'completed', status: 'completed' };
}

function log(overrides = {}) {
  return {
    id: 'log_1',
    sessionId: 's1',
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Stairmaster (Moderate)',
    weight: 0,
    repsPerSet: [20],
    sets: [setRow(20)],
    tracked: true,
    orderIndex: 0,
    ...overrides,
  };
}

const OLD_STAIRMASTER = log();
const NEW_STAIRMASTER = log({ id: 'log_2', repsUnit: 'minutes' });
const PULL_UPS = log({ id: 'log_3', exerciseNameSnapshot: 'Pull-Up', repsPerSet: [8], sets: [setRow(8)] });

function sessionRow(id, performedAt) {
  return { id, workoutTemplateId: 'tpl', workoutNameSnapshot: 'Day', performedAt, durationMinutes: 45, totalVolumeKg: 0 };
}

module.exports = [
  {
    name: 'minutes log entry: the unit says so, the name says so for a log saved before the unit, and neither means reps',
    run() {
      assert.equal(isMinutesLogEntry({ repsUnit: 'minutes', exerciseNameSnapshot: 'Pull-Up' }), true);
      assert.equal(isMinutesLogEntry({ exerciseNameSnapshot: 'Stairmaster (Moderate)' }), true);
      assert.equal(isMinutesLogEntry({ exerciseNameSnapshot: '  stationary bike (easy pace) ' }), true);
      assert.equal(isMinutesLogEntry({ repsUnit: 'minutes' }), true);
      assert.equal(isMinutesLogEntry({ exerciseNameSnapshot: 'Pull-Up' }), false);
      assert.equal(isMinutesLogEntry({ repsUnit: 'hours', exerciseNameSnapshot: 'Pull-Up' }), false);
      assert.equal(isMinutesLogEntry({}), false);
      assert.equal(isMinutesLogEntry(null), false);
      assert.equal(isMinutesLogEntry(undefined), false);
    },
  },
  {
    name: 'minutes log entry: an old log named like a minutes lift is no rep trajectory, as a new one is not',
    run() {
      const sessions = [sessionRow('s1', '2026-10-01T10:00:00.000Z'), sessionRow('s2', '2026-10-03T10:00:00.000Z')];
      const logs = [
        log({ id: 'a1', sessionId: 's1' }),
        log({ id: 'a2', sessionId: 's2', repsPerSet: [25], sets: [setRow(25)] }),
        log({ id: 'n1', sessionId: 's1', repsUnit: 'minutes', exerciseNameSnapshot: 'Some Trail', orderIndex: 1 }),
        log({ id: 'p1', sessionId: 's1', exerciseNameSnapshot: 'Pull-Up', repsPerSet: [8], sets: [setRow(8)], orderIndex: 2 }),
        log({ id: 'p2', sessionId: 's2', exerciseNameSnapshot: 'Pull-Up', repsPerSet: [10], sets: [setRow(10)], orderIndex: 1 }),
      ];
      const histories = buildRepsLiftHistories(sessions, logs);
      assert.deepEqual(histories.map((history) => history.name), ['Pull-Up'], 'only the counted lift has a rep trajectory');
    },
  },
  {
    name: 'minutes log entry: a milestone reps total leaves out an old minutes log, and still counts its set',
    run() {
      const fixture = (logs) => ({
        workoutTemplates: [],
        exerciseTemplates: [],
        workoutPlans: [],
        exerciseLibrary: [],
        workoutSessions: [sessionRow('s1', '2026-08-03T12:00:00.000Z')],
        cardioSessions: [],
        exerciseLogs: logs,
        bodyweightEntries: [],
        measurementEntries: [],
        exerciseNameBook: [],
        preferences: {},
      });
      const totals = (logs) => {
        const database = fixture(logs);
        const lifetime = getLifetimeTrainingSummary(database, new Date('2026-08-26T12:00:00.000Z'));
        const facts = getMilestoneFacts(database, lifetime, []);
        const last = (timeline) => (timeline.length ? timeline[timeline.length - 1].total : 0);
        return { reps: last(facts.timelines.reps), sets: last(facts.timelines.sets) };
      };
      const withOld = totals([PULL_UPS, OLD_STAIRMASTER]);
      const withNew = totals([PULL_UPS, NEW_STAIRMASTER]);
      assert.deepEqual(withOld, withNew, 'old and new minutes logs read the same');
      assert.deepEqual(withOld, { reps: 8, sets: 2 }, 'twenty minutes is not twenty reps');
    },
  },
  {
    name: 'minutes log entry: the records agree with the histories and the milestones on the same logs',
    run() {
      assert.deepEqual(recordSetsOfLog(OLD_STAIRMASTER), []);
      assert.deepEqual(recordSetsOfLog(NEW_STAIRMASTER), []);
      assert.equal(recordSetsOfLog(PULL_UPS).length, 1);
    },
  },
];
