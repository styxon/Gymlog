const assert = require('node:assert/strict');

const { repointPlanEntrySessions, reorderPlanWeek } = require('../../.test-dist/lib/planSessionOrder.js');
const { resolveNextPlanEntryIndex } = require('../../.test-dist/lib/planRotation.js');

const plan = () => [
  { orderIndex: 0, label: 'mon', workoutTemplateSessionId: 'a' },
  { orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
  { orderIndex: 2, label: 'thu', workoutTemplateSessionId: 'c' },
];

module.exports = [
  {
    name: 'the plan follows the programme order, and the weekdays stay where the reader put them',
    run() {
      // The programme's days were dragged into c, a, b.
      const result = repointPlanEntrySessions(plan(), ['c', 'a', 'b']);
      assert.equal(result.kind, 'repointed');
      assert.deepEqual(
        result.entries.map((entry) => entry.workoutTemplateSessionId),
        ['c', 'a', 'b'],
      );
      // Moving a day changes WHICH session lands on Thursday, never whether
      // Thursday is a training day at all.
      assert.deepEqual(
        result.entries.map((entry) => entry.label),
        ['mon', 'wed', 'thu'],
      );
      assert.deepEqual(
        result.entries.map((entry) => entry.orderIndex),
        [0, 1, 2],
      );
    },
  },
  {
    name: 'entries are read in stored order, not in the order the store returned them',
    run() {
      const shuffled = [
        { orderIndex: 2, label: 'thu', workoutTemplateSessionId: 'c' },
        { orderIndex: 0, label: 'mon', workoutTemplateSessionId: 'a' },
        { orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
      ];
      const result = repointPlanEntrySessions(shuffled, ['b', 'c', 'a']);
      assert.deepEqual(
        result.entries.map((entry) => [entry.label, entry.workoutTemplateSessionId]),
        [
          ['mon', 'b'],
          ['wed', 'c'],
          ['thu', 'a'],
        ],
      );
    },
  },
  {
    name: 'an order that changes nothing is not a write',
    run() {
      assert.deepEqual(repointPlanEntrySessions(plan(), ['a', 'b', 'c']), {
        kind: 'skip',
        reason: 'unchanged',
      });
    },
  },
  {
    name: 'sessions the plan never ran are ignored, and it still has to come out even',
    run() {
      // A session with no exercises never reached the plan at adoption. It may
      // sit anywhere in the programme; it must not become a training day here.
      const result = repointPlanEntrySessions(plan(), ['empty', 'c', 'a', 'b']);
      assert.equal(result.kind, 'repointed');
      assert.deepEqual(
        result.entries.map((entry) => entry.workoutTemplateSessionId),
        ['c', 'a', 'b'],
      );

      // But a programme missing one of the plan's own sessions is a pair of
      // records that no longer describe the same thing. Refuse rather than
      // scramble: a cosmetic reorder is better than a wrong training week.
      assert.deepEqual(repointPlanEntrySessions(plan(), ['c', 'a']), {
        kind: 'skip',
        reason: 'countMismatch',
      });
    },
  },
  {
    name: 'an entry that stands for the whole template is left alone',
    run() {
      // planRotation reads a null session id as "any session of this template".
      // Re-pointing it would silently narrow the entry to one day.
      const loose = [
        { orderIndex: 0, label: 'mon', workoutTemplateSessionId: null },
        { orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
      ];
      assert.deepEqual(repointPlanEntrySessions(loose, ['b', 'a']), {
        kind: 'skip',
        reason: 'noSessionIds',
      });
      // A plan with no entries has nothing to re-point, which is a no-op
      // rather than a disagreement.
      assert.deepEqual(repointPlanEntrySessions([], ['a']), {
        kind: 'skip',
        reason: 'unchanged',
      });
    },
  },
  {
    name: 'a reorder turns the week so the session Home offers next sits on the next training day',
    run() {
      const week = () => [
        { id: 'e1', workoutTemplateId: 't', orderIndex: 0, label: 'mon', workoutTemplateSessionId: 'a' },
        { id: 'e2', workoutTemplateId: 't', orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
        { id: 'e3', workoutTemplateId: 't', orderIndex: 2, label: 'fri', workoutTemplateSessionId: 'c' },
      ];
      // A was logged on Monday; on Tuesday the reader drags C to the top.
      const logged = [{ workoutTemplateId: 't', workoutTemplateSessionId: 'a', performedAt: '2026-09-14T08:00:00.000Z' }];
      const tuesday = new Date(2026, 8, 15, 12, 0);
      const dayOf = (entries, sessionId) => entries.find((entry) => entry.workoutTemplateSessionId === sessionId).label;

      // Re-dealing alone: Home offers B, the entry after A, and B sits on
      // Friday — while Wednesday, the next training day, holds A.
      const dealt = repointPlanEntrySessions(week(), ['c', 'a', 'b']);
      const offeredBefore = dealt.entries[resolveNextPlanEntryIndex(dealt.entries, logged)];
      assert.equal(offeredBefore.workoutTemplateSessionId, 'b');
      assert.equal(offeredBefore.label, 'fri');
      assert.equal(dayOf(dealt.entries, 'a'), 'wed');

      const turned = reorderPlanWeek(week(), ['c', 'a', 'b'], logged, tuesday);
      assert.equal(turned.kind, 'repointed');
      const offered = turned.entries[resolveNextPlanEntryIndex(turned.entries, logged)];
      assert.equal(offered.workoutTemplateSessionId, 'b');
      assert.equal(offered.label, 'wed');
      // The rest follow in the programme's new order, on the same three days.
      assert.deepEqual(
        turned.entries.map((entry) => [entry.workoutTemplateSessionId, entry.label]),
        [['c', 'fri'], ['a', 'mon'], ['b', 'wed']],
      );
      assert.deepEqual(turned.entries.map((entry) => entry.orderIndex), [0, 1, 2]);
    },
  },
  {
    name: 'a reorder on the day the first session was trained puts the next one on the next training day, not today',
    run() {
      // Bug hunt, 2026-10-04: today counted as open although its session was done.
      const week = [
        { workoutTemplateId: 't', orderIndex: 0, label: 'mon', workoutTemplateSessionId: 'a' },
        { workoutTemplateId: 't', orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
        { workoutTemplateId: 't', orderIndex: 2, label: 'fri', workoutTemplateSessionId: 'c' },
      ];
      const monday = new Date(2026, 8, 14, 18, 0);
      const logged = [
        { workoutTemplateId: 't', workoutTemplateSessionId: 'a', performedAt: new Date(2026, 8, 14, 9, 0).toISOString() },
      ];
      const turned = reorderPlanWeek(week, ['a', 'c', 'b'], logged, monday);
      const offered = turned.entries[resolveNextPlanEntryIndex(turned.entries, logged)];
      assert.equal(offered.workoutTemplateSessionId, 'c');
      assert.equal(offered.label, 'wed');
    },
  },
  {
    name: 'with nothing logged, the new first session takes the next training day',
    run() {
      const week = [
        { workoutTemplateId: 't', orderIndex: 0, label: 'mon', workoutTemplateSessionId: 'a' },
        { workoutTemplateId: 't', orderIndex: 1, label: 'wed', workoutTemplateSessionId: 'b' },
        { workoutTemplateId: 't', orderIndex: 2, label: 'fri', workoutTemplateSessionId: 'c' },
      ];
      const turned = reorderPlanWeek(week, ['c', 'a', 'b'], [], new Date(2026, 8, 15, 12, 0));
      assert.deepEqual(
        turned.entries.map((entry) => [entry.workoutTemplateSessionId, entry.label]),
        [['c', 'wed'], ['a', 'fri'], ['b', 'mon']],
      );
    },
  },
  {
    name: 'a week whose labels name no weekday is re-dealt and left unturned, and refusals pass through',
    run() {
      const byPosition = [
        { workoutTemplateId: 't', orderIndex: 0, label: 'Day 1', workoutTemplateSessionId: 'a' },
        { workoutTemplateId: 't', orderIndex: 1, label: 'Day 2', workoutTemplateSessionId: 'b' },
      ];
      const turned = reorderPlanWeek(byPosition, ['b', 'a'], [], new Date(2026, 8, 15, 12, 0));
      assert.deepEqual(
        turned.entries.map((entry) => [entry.workoutTemplateSessionId, entry.label]),
        [['b', 'Day 1'], ['a', 'Day 2']],
      );
      assert.deepEqual(reorderPlanWeek(plan().map((entry) => ({ ...entry, workoutTemplateId: 't' })), ['a', 'b', 'c'], [], new Date()), {
        kind: 'skip',
        reason: 'unchanged',
      });
    },
  },
];
