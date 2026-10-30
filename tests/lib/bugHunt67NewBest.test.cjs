const assert = require('node:assert/strict');

const { getTrackedExerciseProgress, getExerciseProgressSignal } = require('../../src/lib/progression');
const { buildLiftHistories } = require('../../src/lib/trainingHistory');
const { buildWeeklyRead } = require('../../src/lib/proInsights');

const at = (m, d) => new Date(2026, m - 1, d, 18, 0, 0, 0).toISOString();
const set = (weight, reps, i = 0) => ({ orderIndex: i, weight, reps, kind: 'working', outcome: 'completed', status: 'completed' });

function log(id, sessionId, name, weight, reps, extra = {}) {
  return {
    id,
    sessionId,
    exerciseTemplateId: null,
    exerciseNameSnapshot: name,
    weight,
    repsPerSet: reps,
    sets: reps.map((r, i) => set(weight, r, i)),
    tracked: true,
    orderIndex: 0,
    skipped: false,
    ...extra,
  };
}

function db(sessions, logs) {
  return {
    exerciseTemplates: [],
    workoutSessions: sessions.map(([id, performedAt]) => ({ id, performedAt, workoutNameSnapshot: 'W' })),
    exerciseLogs: logs,
    preferences: { strengthGoals: [] },
  };
}

function signalOf(database) {
  const rows = getTrackedExerciseProgress(database);
  assert.equal(rows.length, 1);
  return getExerciseProgressSignal(rows[0], 'en').kind;
}

module.exports = [
  {
    name: 'first weighted session after bodyweight sessions reads new best',
    run() {
      const database = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [log('l1', 's1', 'Pull-Up', 0, [8, 8]), log('l2', 's2', 'Pull-Up', 10, [5, 5])],
      );
      assert.equal(signalOf(database), 'new_best');
    },
  },
  {
    name: 'a first-ever weighted session is not a new best',
    run() {
      const database = db([['s1', at(10, 1)]], [log('l1', 's1', 'Pull-Up', 10, [5, 5])]);
      assert.notEqual(signalOf(database), 'new_best');
    },
  },
  {
    name: 'hold and minutes lifts do not get new best from seconds read as reps',
    run() {
      const plank = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [log('l1', 's1', 'Plank', 10, [45]), log('l2', 's2', 'Plank', 10, [60])],
      );
      assert.notEqual(signalOf(plank), 'new_best');
      const bike = db(
        [['s1', at(10, 1)], ['s2', at(10, 8)]],
        [
          log('l1', 's1', 'Bike', 10, [45], { repsUnit: 'minutes' }),
          log('l2', 's2', 'Bike', 10, [60], { repsUnit: 'minutes' }),
        ],
      );
      assert.notEqual(signalOf(bike), 'new_best');
    },
  },
  {
    name: 'the same lift twice in one session gives the same signal in either log order',
    run() {
      const sessions = [['s1', at(10, 1)]];
      const a = log('l1', 's1', 'Bench Press', 80, [5]);
      const b = log('l2', 's1', 'Bench Press', 80, [8]);
      assert.notEqual(signalOf(db(sessions, [a, b])), 'new_best');
      assert.notEqual(signalOf(db(sessions, [b, a])), 'new_best');
    },
  },
  {
    name: 'weekly read ranks lifts by sessions, so a double-logged lift does not take a slot',
    run() {
      const sessions = [];
      const logs = [];
      for (let i = 1; i <= 3; i += 1) {
        sessions.push([`s${i}`, at(10, i * 2)]);
        logs.push(log(`b${i}`, `s${i}`, 'Row', 60 + i, [8]));
        logs.push(log(`c${i}`, `s${i}`, 'Curl', 20 + i, [8]));
      }
      for (let i = 1; i <= 2; i += 1) {
        logs.push(log(`a${i}x`, `s${i}`, 'Squat', 100 + i, [5]));
        logs.push(log(`a${i}y`, `s${i}`, 'Squat', 100 + i, [5], { orderIndex: 1 }));
      }
      const histories = buildLiftHistories(
        sessions.map(([id, performedAt]) => ({ id, performedAt, workoutNameSnapshot: 'W' })),
        logs,
      );
      const rows = buildWeeklyRead(histories, null, 'en', null);
      const names = rows.map((row) => row.name).sort();
      assert.deepEqual(names, ['Curl', 'Row']);
    },
  },
];
