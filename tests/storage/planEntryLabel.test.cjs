const assert = require('node:assert/strict');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('../storage/fakeAsyncStorage.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');

/**
 * Bug hunt, 2026-10-05 (app update over an old install).
 *
 * `normalizeDatabase` checks every list it loads except one: a stored plan is
 * kept as `{ ...plan, entries: entries.map(e => ({ ...e, workoutTemplateSessionId })) }`
 * and an entry's `label` is never looked at. Home's `getNextWorkoutCandidate`
 * (reached from getHomeSummary, which the Home screen and the coach context
 * both build on every render) calls `label.trim()` for a weekday-mode plan, so
 * one entry whose label is not a string is a throw on the first render after
 * launch: the loader did not throw, so nothing is set aside, and the reader is
 * on the crash screen on every launch until the row is repaired by hand.
 *
 * No released build wrote such a label; this is the loader's own N3 promise
 * ("one bad field degrades that field only") not extending to the consumer
 * side. The loader gives the label a string now.
 */

function normalize() {
  const fake = createFakeAsyncStorage();
  return loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js')).normalizeDatabase;
}

function databaseWithWeekdayPlan(label) {
  return {
    workoutTemplates: [
      { id: 'tpl_a', name: 'A', exerciseIds: [], sessions: [], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 'tpl_b', name: 'B', exerciseIds: [], sessions: [], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    ],
    workoutPlans: [
      {
        id: 'plan_1',
        name: 'My week',
        mode: 'weekday',
        isActive: true,
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-01T10:00:00.000Z',
        entries: [
          { id: 'e1', workoutTemplateId: 'tpl_a', label: 'Monday', orderIndex: 0, workoutTemplateSessionId: null },
          { id: 'e2', workoutTemplateId: 'tpl_b', label, orderIndex: 1, workoutTemplateSessionId: null },
        ],
      },
    ],
    preferences: { activePlanId: 'plan_1', activePlanIds: ['plan_1'] },
  };
}

module.exports = [
  {
    name: 'loader: a plan entry with a label that is not a string loads, and Home summary still builds',
    run() {
      const normalizeDatabase = normalize();
      const { getHomeSummary } = require(path.join(DIST, 'lib', 'dashboard.js'));
      for (const label of [null, 5, [], {}]) {
        const database = normalizeDatabase(databaseWithWeekdayPlan(label));
        assert.equal(database.workoutPlans.length, 1, 'the plan loads');
        assert.doesNotThrow(
          () => getHomeSummary(database, 'kg', new Date('2026-10-05T10:00:00')),
          `Home summary threw for a plan entry labelled ${JSON.stringify(label)}`,
        );
      }
    },
  },
];
