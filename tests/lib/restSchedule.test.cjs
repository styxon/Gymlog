const assert = require('node:assert/strict');

const {
  describeRest,
  extendRest,
  formatClock,
  formatEndsAt,
  restAlertTimes,
  idleNudgeAtMs,
  REST_WARNING_SECONDS,
  REST_REPEAT_AFTER_SECONDS,
  IDLE_NUDGE_MINUTES,
} = require('../../src/lib/restSchedule');

module.exports = [
  {
    name: 'a rest is running until its end and counts overrun after it',
    run() {
      const end = 1_000_000;
      assert.deepEqual(describeRest(end, end - 72_000), { phase: 'running', remainingSeconds: 72, overrunSeconds: 0 });
      assert.deepEqual(describeRest(end, end), { phase: 'done', remainingSeconds: 0, overrunSeconds: 0 });
      // Rule 04: overrun is data. 2:14 past the end is 134 s, not an error.
      assert.deepEqual(describeRest(end, end + 134_000), { phase: 'done', remainingSeconds: 0, overrunSeconds: 134 });
      // Half a second shy of the end still reads as running with 1 s left, not 0.
      assert.equal(describeRest(end, end - 600).remainingSeconds, 1);
    },
  },
  {
    name: 'the clock formats like a timer, hours only when there are hours',
    run() {
      assert.equal(formatClock(72), '1:12');
      assert.equal(formatClock(8), '0:08');
      assert.equal(formatClock(0), '0:00');
      assert.equal(formatClock(3760), '1:02:40');
      assert.equal(formatClock(-5), '0:00');
    },
  },
  {
    name: 'the end time is the wall clock, zero-padded',
    run() {
      const d = new Date(2026, 9, 14, 18, 42, 0);
      assert.equal(formatEndsAt(d.getTime()), '18:42');
      const e = new Date(2026, 9, 14, 9, 5, 0);
      assert.equal(formatEndsAt(e.getTime()), '09:05');
    },
  },
  {
    name: 'warning fires 10 s before the end, the repeat 30 s after, the idle nudge at 25 min',
    run() {
      const end = 5_000_000;
      const t = restAlertTimes(end);
      assert.equal(t.warningAtMs, end - REST_WARNING_SECONDS * 1000);
      assert.equal(t.repeatAtMs, end + REST_REPEAT_AFTER_SECONDS * 1000);
      assert.equal(REST_WARNING_SECONDS, 10);
      assert.equal(REST_REPEAT_AFTER_SECONDS, 30);
      assert.equal(IDLE_NUDGE_MINUTES, 25);
      assert.equal(idleNudgeAtMs(1_000_000), 1_000_000 + 25 * 60_000);
    },
  },
  {
    /*
     * Audit round 4 and the review of it (2026-09-20). "+15 s" on a rest
     * thirty seconds overdue extended from an end already gone by and gave
     * one second; rebasing only the end then left the total at the old rest
     * plus fifteen, so the bar reopened "0:15" one fifth full and drained
     * from there, contradicting the countdown it had just restarted.
     */
    name: 'a rest is extended from now once it is overdue, and both of its numbers say the same span',
    run() {
      const now = 1_700_000_000_000;
      const running = { totalSeconds: 60, endsAtMs: now + 20_000, startedAtMs: now - 40_000 };
      const longer = extendRest(running, 15, now);
      assert.equal(longer.endsAtMs, now + 35_000, 'a running rest ends fifteen seconds later');
      assert.equal(longer.totalSeconds, 75, 'and the whole rest is fifteen seconds longer');
      assert.equal(longer.startedAtMs, running.startedAtMs, 'it is the same rest');

      const overdue = { totalSeconds: 60, endsAtMs: now - 30_000, startedAtMs: now - 90_000 };
      const restarted = extendRest(overdue, 15, now);
      assert.equal(restarted.endsAtMs, now + 15_000, 'an overdue rest gets the whole fifteen seconds');
      assert.equal(restarted.totalSeconds, 15, 'and the bar draws fifteen seconds, not seventy-five');
      assert.equal(restarted.startedAtMs, overdue.startedAtMs, 'still the same rest');

      const shortened = extendRest(running, -30, now);
      assert.equal(shortened.endsAtMs, now + 1000, 'a rest never ends the instant it is adjusted');
      assert.ok(shortened.totalSeconds >= 1, 'and never draws a span of nothing');
    },
  },
];
