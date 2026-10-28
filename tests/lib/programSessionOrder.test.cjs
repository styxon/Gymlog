const assert = require('node:assert/strict');

const { reorderProgramSessions } = require('../../src/lib/programSessionOrder');

const days = () => [
  { id: 'a', orderIndex: 0, name: 'Upper (Heavy)' },
  { id: 'b', orderIndex: 1, name: 'Lower (Heavy)' },
  { id: 'c', orderIndex: 2, name: 'Upper (Pressure)' },
  { id: 'd', orderIndex: 3, name: 'Accessory' },
];

module.exports = [
  {
    name: 'a day travels to where it was dropped, and every orderIndex follows the new list',
    run() {
      const result = reorderProgramSessions(days(), 'd', 0);
      assert.equal(result.kind, 'reordered');
      assert.deepEqual(
        result.sessions.map((session) => session.id),
        ['d', 'a', 'b', 'c'],
      );
      // Stored order is re-stamped from the position, not nudged — a list
      // whose indexes disagree with its order is the bug this prevents.
      assert.deepEqual(
        result.sessions.map((session) => session.orderIndex),
        [0, 1, 2, 3],
      );
      // The rows themselves are untouched apart from their number.
      assert.equal(result.sessions[0].name, 'Accessory');

      // And the other direction.
      assert.deepEqual(
        reorderProgramSessions(days(), 'a', 3).sessions.map((session) => session.id),
        ['b', 'c', 'd', 'a'],
      );
    },
  },
  {
    name: 'a drop that changes nothing is not a write',
    run() {
      // Dropping a row on itself would otherwise re-stamp every index in the
      // programme for a list that looks exactly as it did.
      assert.deepEqual(reorderProgramSessions(days(), 'b', 1), {
        kind: 'skip',
        reason: 'alreadyThere',
      });
      // Overshooting past the end of the list from the last row is the same
      // no-op, once the destination is clamped.
      assert.deepEqual(reorderProgramSessions(days(), 'd', 9), {
        kind: 'skip',
        reason: 'alreadyThere',
      });
    },
  },
  {
    name: 'a finger that overshoots still means the end of the list',
    run() {
      assert.deepEqual(
        reorderProgramSessions(days(), 'a', 99).sessions.map((session) => session.id),
        ['b', 'c', 'd', 'a'],
      );
      assert.deepEqual(
        reorderProgramSessions(days(), 'd', -4).sessions.map((session) => session.id),
        ['d', 'a', 'b', 'c'],
      );
      // A half-pixel destination is a row, not an error.
      assert.deepEqual(
        reorderProgramSessions(days(), 'a', 1.6).sessions.map((session) => session.id),
        ['b', 'c', 'a', 'd'],
      );
    },
  },
  {
    name: 'the array is read in stored order, however it arrives',
    run() {
      // Repositories hand rows back in whatever order the store felt like.
      // Reading position from the unsorted array would move the wrong day.
      const shuffled = [
        { id: 'c', orderIndex: 2 },
        { id: 'a', orderIndex: 0 },
        { id: 'd', orderIndex: 3 },
        { id: 'b', orderIndex: 1 },
      ];
      assert.deepEqual(
        reorderProgramSessions(shuffled, 'c', 0).sessions.map((session) => session.id),
        ['c', 'a', 'b', 'd'],
      );
    },
  },
  {
    name: 'a day that is not in the programme moves nothing',
    run() {
      assert.deepEqual(reorderProgramSessions(days(), 'gone', 0), {
        kind: 'skip',
        reason: 'sessionMissing',
      });
      assert.deepEqual(reorderProgramSessions([], 'a', 0), {
        kind: 'skip',
        reason: 'sessionMissing',
      });
    },
  },
];
