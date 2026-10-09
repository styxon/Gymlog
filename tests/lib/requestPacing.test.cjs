const assert = require('node:assert/strict');
const path = require('node:path');

const { createHookRuntime, flush, requireWithStubs } = require('../helpers/hookHarness.cjs');

const DIST = path.join(__dirname, '..', '..', '.test-dist');
const {
  AI_LOG_RETRY_PACING,
  ANALYTICS_FLUSH_PACING,
  AUTO_BACKUP_PACING,
  EMPTY_PACING,
  failureBackoffMs,
  notePacingOutcome,
  notePacingSent,
  pacingWaitMs,
} = require(path.join(DIST, 'lib', 'requestPacing.js'));

/**
 * The ceiling under every trigger that talks to our server (lib/requestPacing).
 *
 * serverCallsAreBounded names what bounds each call site. This runs the
 * ceiling: a trigger that fires as often as it possibly can - the way a bug
 * in an effect would make it - is let through only as often as the policy
 * says, over a simulated day, against the compiled client and hooks.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fires `attempt` as fast as the pacing allows for `span`, recording the starts. */
function hammer(policy, span, { failing }) {
  let state = EMPTY_PACING;
  let now = 1_000_000_000_000;
  const end = now + span;
  const starts = [];
  while (now < end) {
    const wait = pacingWaitMs(state, policy, now);
    if (wait > 0) {
      now += wait;
      continue;
    }
    state = notePacingSent(state, policy, now);
    starts.push(now);
    state = notePacingOutcome(state, !failing, now);
    // A runaway trigger asks again a millisecond later.
    now += 1;
  }
  return starts;
}

/** A client whose clock, timers and network the test drives. */
async function driveAnalytics(answers, work) {
  const saved = {
    now: Date.now,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    fetch: globalThis.fetch,
    url: process.env.EXPO_PUBLIC_ANALYTICS_URL,
  };
  const clock = { t: 1_800_000_000_000 };
  const timers = [];
  const fetched = [];
  const items = new Map();
  const storage = {
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
  Date.now = () => clock.t;
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  globalThis.clearTimeout = () => undefined;
  globalThis.fetch = async () => {
    fetched.push(clock.t);
    const answer = answers(fetched.length);
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  process.env.EXPO_PUBLIC_ANALYTICS_URL = 'https://api.example.test/events';
  try {
    const client = requireWithStubs(path.join(DIST, 'features', 'analytics', 'analyticsClient.js'), {
      '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    });
    client.setUsageStatisticsEnabled(true);
    await flush();
    /** One more event, then let the timer it armed run: returns the delay it was armed with. */
    async function step() {
      client.trackEvent('app_open');
      await flush();
      await flush();
      const armed = timers.splice(0);
      assert.equal(armed.length, 1, 'one tracked event arms exactly one flush');
      clock.t += armed[0].ms;
      armed[0].fn();
      await flush();
      await flush();
      return armed[0].ms;
    }
    /** The timers armed now, as {fn, ms}, taken off the list. */
    const takeArmed = () => timers.splice(0);
    /** Runs every armed timer after the clock has moved by the longest delay (or by `moveBy`). */
    async function fire(moveBy) {
      const armed = takeArmed();
      if (armed.length === 0) {
        return null;
      }
      const ms = Math.max(...armed.map((timer) => timer.ms));
      clock.t += moveBy ?? ms;
      for (const timer of armed) {
        timer.fn();
      }
      await flush();
      await flush();
      return ms;
    }
    await work({ step, fetched, clock, fire, takeArmed, client });
    client.setUsageStatisticsEnabled(false);
  } finally {
    Date.now = saved.now;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) {
      delete process.env.EXPO_PUBLIC_ANALYTICS_URL;
    } else {
      process.env.EXPO_PUBLIC_ANALYTICS_URL = saved.url;
    }
  }
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ACCEPTED = json(200, { ok: true, accepted: 1, dropped: 0 });
const UNAVAILABLE = json(503, { ok: false, error: 'STORE_UNAVAILABLE' });

module.exports = [
  {
    name: 'request pacing: the failure backoff doubles from its base to its cap and is nothing for no failures',
    run() {
      const policy = { backoffBaseMs: 60_000, backoffMaxMs: 15 * MINUTE };
      assert.equal(failureBackoffMs(0, policy), 0);
      assert.equal(failureBackoffMs(1, policy), 60_000);
      assert.equal(failureBackoffMs(2, policy), 120_000);
      assert.equal(failureBackoffMs(3, policy), 240_000);
      assert.equal(failureBackoffMs(5, policy), 15 * MINUTE);
      assert.equal(failureBackoffMs(1000, policy), 15 * MINUTE, 'a long run of failures stays at the cap');
      assert.equal(failureBackoffMs(4, { backoffBaseMs: 0, backoffMaxMs: 0 }), 0, 'a policy without backoff has none');
    },
  },
  {
    name: 'request pacing: a minimum gap, a budget per window and a backoff after failures each hold a request back',
    run() {
      const policy = { minGapMs: 5000, maxPerWindow: 3, windowMs: HOUR, backoffBaseMs: 10_000, backoffMaxMs: 40_000 };
      const t0 = 5_000_000;
      assert.equal(pacingWaitMs(EMPTY_PACING, policy, t0), 0, 'nothing sent yet: go');

      let state = notePacingSent(EMPTY_PACING, policy, t0);
      assert.equal(pacingWaitMs(state, policy, t0 + 1000), 4000, 'the minimum gap');
      assert.equal(pacingWaitMs(state, policy, t0 + 5000), 0);

      state = notePacingSent(state, policy, t0 + 5000);
      state = notePacingSent(state, policy, t0 + 10_000);
      // Three in the window: the next slot opens when the first leaves it.
      assert.equal(pacingWaitMs(state, policy, t0 + 15_000), HOUR - 15_000, 'the budget');
      assert.equal(pacingWaitMs(state, policy, t0 + HOUR), 0, "a start leaves the window the moment it is an hour old");
      assert.equal(pacingWaitMs(state, policy, t0 + HOUR + 5000), 0, 'the first start has left the window');

      let failing = notePacingSent(EMPTY_PACING, policy, t0);
      failing = notePacingOutcome(failing, false, t0);
      assert.equal(pacingWaitMs(failing, policy, t0 + 5000), 5000, 'a failure waits out its backoff, not just the gap');
      failing = notePacingOutcome(failing, false, t0 + 10_000);
      assert.equal(pacingWaitMs(failing, policy, t0 + 10_000), 20_000, 'the second failure doubles it');
      failing = notePacingOutcome(failing, true, t0 + 30_000);
      assert.equal(pacingWaitMs(failing, policy, t0 + 30_000), 0, 'a success clears it');
    },
  },
  {
    name: 'request pacing: a clock set back does not strand a request, and the history it keeps stays within the budget',
    run() {
      const policy = { minGapMs: 5000, maxPerWindow: 4, windowMs: HOUR, backoffBaseMs: 0, backoffMaxMs: 0 };
      let state = EMPTY_PACING;
      for (let index = 0; index < 50; index += 1) {
        state = notePacingSent(state, policy, 1_000_000 + index * 10_000);
      }
      assert.ok(state.sentAt.length <= 4, 'the kept starts are no more than the budget can look back on');
      // The phone's clock jumped back a day: starts "in the future" count as now.
      const wait = pacingWaitMs(state, policy, 1_000_000 - DAY);
      assert.ok(wait <= HOUR + 5000, `waited ${wait} ms after the clock moved back`);
    },
  },
  {
    name: 'request pacing: a trigger that fires as fast as it can is held to the policy over a day',
    run() {
      // Always succeeding: the budget is the ceiling.
      const analytics = hammer(ANALYTICS_FLUSH_PACING, DAY, { failing: false });
      assert.ok(analytics.length <= 30 * 24 + 30, `analytics sent ${analytics.length} batches in a day`);
      assert.ok(analytics.length >= 30 * 24 - 30, 'the budget is a ceiling, not a stop');
      const backup = hammer(AUTO_BACKUP_PACING, DAY, { failing: false });
      assert.ok(backup.length <= 60 * 24 + 60, `auto backup started ${backup.length} times in a day`);

      // Always failing: the backoff, not the budget, is the ceiling.
      const analyticsFailing = hammer(ANALYTICS_FLUSH_PACING, DAY, { failing: true });
      assert.ok(analyticsFailing.length <= 1 + 4 + (DAY - 15 * MINUTE) / (15 * MINUTE) + 2, `failing analytics sent ${analyticsFailing.length} in a day`);
      const retry = hammer(AI_LOG_RETRY_PACING, DAY, { failing: true });
      assert.ok(retry.length <= 1 + 6 + DAY / (15 * MINUTE), `the failing delete retry started ${retry.length} times in a day`);
      assert.ok(retry.length >= 20, 'and it does keep trying');

      // Never within the gap of the start before it, whatever the policy.
      for (let index = 1; index < analytics.length; index += 1) {
        assert.ok(analytics[index] - analytics[index - 1] >= ANALYTICS_FLUSH_PACING.minGapMs);
      }
    },
  },
  {
    name: 'analytics client: a failing server is not asked again every five seconds - the wait doubles - and a success ends it',
    async run() {
      await driveAnalytics(
        (call) => (call <= 3 ? UNAVAILABLE : ACCEPTED),
        async ({ step }) => {
          assert.equal(await step(), 5000, 'a healthy phone batches behind five seconds');
          assert.ok((await step()) >= 60 * SECOND, 'after one failure the next batch waits a minute');
          assert.ok((await step()) >= 120 * SECOND, 'after two, two minutes');
          assert.ok((await step()) >= 240 * SECOND, 'after three, four');
          // The fourth try was accepted: back to the plain wait.
          assert.equal(await step(), 5000);
        },
      );
    },
  },
  {
    // Review of #346: the delay scheduleFlush armed was the only enforcement,
    // computed before an in-flight batch recorded its start.
    name: 'analytics client: a flush that starts early or twice sends nothing before its pacing allows, and re-arms for the wait that is left',
    async run() {
      await driveAnalytics(
        () => ACCEPTED,
        async ({ step, fetched, fire, takeArmed, client }) => {
          await step();
          assert.equal(fetched.length, 1);

          // A timer that fires with the clock where it was: not a minute gap later, no request.
          client.trackEvent('app_open');
          await flush();
          await flush();
          assert.equal(await fire(0), 5000);
          assert.equal(fetched.length, 1, 'a flush that ran inside the minimum gap sent a batch');
          const rearmed = takeArmed();
          assert.equal(rearmed.length, 1, 'and it must be tried again');
          assert.equal(rearmed[0].ms, 5000, 'for the wait that was left');

          // Two flushes at the same moment: one batch.
          const clockAfter = fetched.length;
          const again = rearmed[0];
          // (the clock moves on, then the same timer function is run twice in one turn)
          again.fn();
          again.fn();
          await flush();
          await flush();
          assert.equal(fetched.length, clockAfter, 'still inside the gap: no batch');
        },
      );

      // Two flushes racing for the same batch while the gap is open.
      await driveAnalytics(
        () => ACCEPTED,
        async ({ fetched, fire, takeArmed, client, clock }) => {
          client.trackEvent('app_open');
          await flush();
          await flush();
          const [timer] = takeArmed();
          clock.t += timer.ms;
          timer.fn();
          timer.fn();
          await flush();
          await flush();
          assert.equal(fetched.length, 1, 'two flushes started in one turn sent two batches');
          assert.equal(await fire(), null, 'nothing left to arm');
        },
      );
    },
  },
  {
    // Review of #346: after a failed batch nothing re-armed; events waited for
    // the next tracked event, and a comment promised a foreground that is not there.
    name: 'analytics client: a failed batch is retried after its backoff, a bounded number of times, then left to the next event',
    async run() {
      await driveAnalytics(
        () => UNAVAILABLE,
        async ({ step, fetched, fire, takeArmed, client }) => {
          // One event, no more events after it.
          assert.equal(await step(), 5000);
          assert.equal(fetched.length, 1);
          const delays = [];
          for (let guard = 0; guard < 20; guard += 1) {
            const ms = await fire();
            if (ms === null) {
              break;
            }
            delays.push(ms);
          }
          assert.equal(fetched.length, 5, `1 + 4 timer-driven retries, got ${fetched.length}`);
          assert.deepEqual(delays.map((ms) => ms / MINUTE), [1, 2, 4, 8], 'each retry waits out the doubled backoff');
          assert.equal(takeArmed().length, 0, 'and then it stops');

          // The next tracked event is what starts it again.
          client.trackEvent('app_open');
          await flush();
          await flush();
          const [armed] = takeArmed();
          assert.ok(armed && armed.ms >= 15 * MINUTE, 'at the backoff cap');
        },
      );

      // A success in between ends the run of retries.
      await driveAnalytics(
        (call) => (call === 1 ? UNAVAILABLE : ACCEPTED),
        async ({ step, fetched, fire, takeArmed }) => {
          await step();
          assert.equal(await fire(), MINUTE);
          assert.equal(fetched.length, 2);
          assert.equal(takeArmed().length, 0, 'sent: nothing more to retry');
        },
      );
    },
  },
  {
    name: 'analytics client: an event raised in a loop for a day sends no more batches than the hourly budget',
    async run() {
      await driveAnalytics(
        () => ACCEPTED,
        async ({ step, fetched, clock }) => {
          const start = clock.t;
          let steps = 0;
          while (clock.t - start < DAY && steps < 5000) {
            await step();
            steps += 1;
          }
          assert.ok(fetched.length <= 30 * 24 + 30, `${fetched.length} requests in a simulated day`);
          assert.ok(fetched.length > 100, 'and it does keep sending');
          // And in any one hour, at most the budget.
          for (let index = 0; index + 30 < fetched.length; index += 1) {
            assert.ok(fetched[index + 30] - fetched[index] >= HOUR, 'more than 30 requests inside one hour');
          }
        },
      );
    },
  },
  {
    name: 'pending coach-log deletes: a server that keeps refusing is asked on a return to the app only after its backoff',
    async run() {
      const A = '0123abcd-0000-4000-8000-00000000000a';
      const runtime = createHookRuntime();
      const listeners = new Set();
      const answers = { forget: { ok: false, removed: 0 }, calls: 0, carriedAt: null };
      const realNow = Date.now;
      let now = 1_900_000_000_000;
      Date.now = () => now;
      try {
        const { usePendingAiLogDeletions } = requireWithStubs(path.join(DIST, 'hooks', 'usePendingAiLogDeletions.js'), {
          react: runtime.react,
          'react-native': {
            AppState: {
              addEventListener(_type, listener) {
                listeners.add(listener);
                return { remove: () => listeners.delete(listener) };
              },
            },
          },
          '../lib/aiCoachClient': {
            isAiCoachLiveConfigured: () => true,
            lastAiLogCarriedAt: () => answers.carriedAt,
            async forgetAiCoachLog() {
              answers.calls += 1;
              return answers.forget;
            },
          },
        });
        const props = { hydrated: true, pending: [A], clear: async () => undefined };
        const foreground = async () => {
          for (const listener of [...listeners]) {
            listener('background');
            listener('active');
          }
          await flush();
        };

        runtime.render(usePendingAiLogDeletions, props);
        await flush();
        assert.equal(answers.calls, 1, 'the start-up retry');

        // Ten returns to the app inside the backoff: nothing.
        for (let index = 0; index < 10; index += 1) {
          now += 2 * SECOND;
          await foreground();
        }
        assert.equal(answers.calls, 1, 'every foreground asked again');

        now += 30 * SECOND;
        await foreground();
        assert.equal(answers.calls, 2, 'after the backoff the next return asks');
        now += 31 * SECOND;
        await foreground();
        assert.equal(answers.calls, 2, 'and the backoff doubled');
        now += 30 * SECOND;
        await foreground();
        assert.equal(answers.calls, 3);

        // A delete the server confirmed that is still inside its write window
        // is owed, but it was answered: it does not grow the backoff.
        // (Review of #346.)
        answers.forget = { ok: true, removed: 1 };
        now += 20 * MINUTE;
        answers.carriedAt = now - 10 * SECOND;
        const beforeUnsettled = answers.calls;
        await foreground();
        assert.equal(answers.calls, beforeUnsettled + 1);
        now += 2 * SECOND;
        answers.carriedAt = now - 5 * SECOND;
        await foreground();
        assert.equal(answers.calls, beforeUnsettled + 2, 'a confirmed-but-unsettled delete was counted as a failure');
        answers.carriedAt = null;
        answers.forget = { ok: false, removed: 0 };
        now += 20 * MINUTE;
        await foreground();

        // A day of a return every minute: bounded by the backoff, not by the minutes.
        const before = answers.calls;
        for (let minute = 0; minute < 24 * 60; minute += 1) {
          now += MINUTE;
          await foreground();
        }
        assert.ok(answers.calls - before <= 24 * 4 + 6, `${answers.calls - before} retries in a day of returns`);

        // The server comes back: the very next return deletes, and a confirmed delete is not held back.
        answers.forget = { ok: true, removed: 3 };
        now += 20 * MINUTE;
        await foreground();
        const confirmed = answers.calls;
        now += 2 * SECOND;
        await foreground();
        assert.equal(answers.calls, confirmed + 1, 'a success cleared the backoff');
      } finally {
        Date.now = realNow;
        runtime.unmount();
      }
    },
  },
];
