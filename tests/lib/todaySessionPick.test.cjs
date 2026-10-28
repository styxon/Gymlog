const assert = require('node:assert/strict');

const { resolveTodaySessionPick } = require('../../src/lib/todaySessionPick');

const TODAY = new Date(2026, 7, 26).getTime();
const SESSIONS = [{ id: 'hiit' }, { id: 'legs' }];

/** ms into today → an ISO stamp, so a test reads like a clock. */
function at(hour, minute = 0) {
  return new Date(2026, 7, 26, hour, minute).toISOString();
}

function resolve(pick, completed = []) {
  return resolveTodaySessionPick({
    pick,
    sessions: SESSIONS,
    todayDayStart: TODAY,
    completed,
    toDayStart: (performedAt) => {
      const date = new Date(performedAt);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    },
  });
}

module.exports = [
  {
    name: "the reader's pick beats the rotation for the day it was given",
    run() {
      assert.deepEqual(resolve({ dayStart: TODAY, sessionId: 'hiit', pickedAt: at(8) }), { id: 'hiit' });
    },
  },
  {
    name: 'a pick from another day is ignored rather than carried forward',
    run() {
      const yesterday = new Date(2026, 7, 25).getTime();
      assert.equal(resolve({ dayStart: yesterday, sessionId: 'hiit', pickedAt: yesterday }), null);
    },
  },
  {
    name: 'training the picked session answers the pick',
    run() {
      // Picked at 08:00, trained at 08:30: the question "what am I doing
      // today" has been answered, and leaving it standing offered the
      // finished workout again.
      const pick = { dayStart: TODAY, sessionId: 'hiit', pickedAt: Date.parse(at(8)) };
      assert.equal(resolve(pick, [{ workoutTemplateSessionId: 'hiit', performedAt: at(8, 30) }]), null);
    },
  },
  {
    name: 'picking a session you already trained today means "again"',
    run() {
      // The whole bug: trained at 08:30, picked again at 09:00. Discarding by
      // date alone made a repeat impossible from anywhere in the app
      // (user 2026-08-26).
      const pick = { dayStart: TODAY, sessionId: 'hiit', pickedAt: Date.parse(at(9)) };
      assert.deepEqual(resolve(pick, [{ workoutTemplateSessionId: 'hiit', performedAt: at(8, 30) }]), {
        id: 'hiit',
      });
    },
  },
  {
    name: 'a different session finished today does not answer this pick',
    run() {
      const pick = { dayStart: TODAY, sessionId: 'hiit', pickedAt: Date.parse(at(8)) };
      assert.deepEqual(resolve(pick, [{ workoutTemplateSessionId: 'legs', performedAt: at(8, 30) }]), {
        id: 'hiit',
      });
    },
  },
  {
    name: 'the same session finished on another day does not answer it either',
    run() {
      const pick = { dayStart: TODAY, sessionId: 'hiit', pickedAt: Date.parse(at(8)) };
      const yesterday = new Date(2026, 7, 25, 18).toISOString();
      assert.deepEqual(resolve(pick, [{ workoutTemplateSessionId: 'hiit', performedAt: yesterday }]), {
        id: 'hiit',
      });
    },
  },
  {
    name: 'a pick naming a session the plan no longer has is dropped',
    run() {
      assert.equal(resolve({ dayStart: TODAY, sessionId: 'gone', pickedAt: at(8) }), null);
    },
  },
  {
    name: 'an unreadable completion timestamp counts, rather than reviving a stale pick',
    run() {
      const pick = { dayStart: TODAY, sessionId: 'hiit', pickedAt: Date.parse(at(9)) };
      // toDayStart is the caller's, and a corrupt stamp that it still places
      // today must not become a way to keep a spent pick alive.
      const answered = resolveTodaySessionPick({
        pick,
        sessions: SESSIONS,
        todayDayStart: TODAY,
        completed: [{ workoutTemplateSessionId: 'hiit', performedAt: 'not-a-date' }],
        toDayStart: () => TODAY,
      });
      assert.equal(answered, null);
    },
  },
];
