const assert = require('node:assert/strict');

const {
  APP_OPEN_AWAY_MS,
  countsAsAppOpen,
  countsAsPaywallView,
  joinedRunningSet,
} = require('../../src/lib/analyticsMoments');

const MINUTE = 60 * 1000;
const LEFT = Date.UTC(2026, 8, 21, 9, 0);

module.exports = [
  {
    name: 'analytics moments: a return is an open only after half an hour away',
    run() {
      assert.equal(APP_OPEN_AWAY_MS, 30 * MINUTE);
      // The photo picker, a permission dialog, the settings the app sent the
      // reader to: back within minutes, the same sitting.
      assert.equal(countsAsAppOpen(LEFT, LEFT + 20 * 1000), false);
      assert.equal(countsAsAppOpen(LEFT, LEFT + 29 * MINUTE), false);
      assert.equal(countsAsAppOpen(LEFT, LEFT + 30 * MINUTE), true);
      assert.equal(countsAsAppOpen(LEFT, LEFT + 9 * 60 * MINUTE), true);
      // Never in the background since the last return: nothing to count.
      assert.equal(countsAsAppOpen(null, LEFT + 9 * 60 * MINUTE), false);
      // A clock that went backwards proves no absence.
      assert.equal(countsAsAppOpen(LEFT, LEFT - 60 * MINUTE), false);
      assert.equal(countsAsAppOpen(Number.NaN, LEFT), false);
    },
  },
  {
    name: 'analytics moments: the paywall is viewed on arrival, by a reader it is a paywall for',
    run() {
      assert.equal(countsAsPaywallView({ paywallWasOpen: false, onPaywall: true, proUnlocked: false }), true);
      // A Pro member sees their membership, not an offer.
      assert.equal(countsAsPaywallView({ paywallWasOpen: false, onPaywall: true, proUnlocked: true }), false);
      // Back from the terms page opened on top of it: the same visit.
      assert.equal(countsAsPaywallView({ paywallWasOpen: true, onPaywall: true, proUnlocked: false }), false);
      assert.equal(countsAsPaywallView({ paywallWasOpen: false, onPaywall: false, proUnlocked: false }), false);
    },
  },
  {
    name: 'analytics moments: an adoption is a plan the running set did not hold',
    run() {
      assert.equal(joinedRunningSet([], ['ready_plan_a']), true);
      assert.equal(joinedRunningSet(['ready_plan_a'], ['ready_plan_a', 'ready_plan_b']), true);
      // Switched on while already running — made the lead, nothing added.
      assert.equal(joinedRunningSet(['ready_plan_a', 'ready_plan_b'], ['ready_plan_a', 'ready_plan_b']), false);
      // Onboarding writing over its own untouched programme keeps the id.
      assert.equal(joinedRunningSet(['onboarding_plan_x', 'ready_plan_a'], ['ready_plan_a', 'onboarding_plan_x']), false);
      // A new onboarding programme replacing the last run's: same size, one new plan.
      assert.equal(joinedRunningSet(['onboarding_plan_x', 'ready_plan_a'], ['ready_plan_a', 'onboarding_plan_y']), true);
      // Stopping one is not an adoption.
      assert.equal(joinedRunningSet(['ready_plan_a', 'ready_plan_b'], ['ready_plan_a']), false);
    },
  },
];
