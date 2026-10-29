const assert = require('node:assert/strict');

const { resolveMembershipEndCard, resolveMembershipEndView } = require('../../src/lib/membershipEndView');
const { resolveMembershipEndPlan } = require('../../src/lib/proBenefits');

module.exports = [
  {
    name: 'a renewing purchase offers the keep / end decision',
    run() {
      assert.deepEqual(resolveMembershipEndView({ canEndNow: true, cancelled: false }), {
        mode: 'decide',
        alreadyCancelled: false,
        billingIssue: false,
      });
    },
  },
  {
    name: 'an already cancelled purchase offers only a way back, even though the plan could end it',
    run() {
      const plan = resolveMembershipEndPlan('purchase', null, '2026-12-01');
      assert.equal(plan.canEndNow, true);
      assert.deepEqual(resolveMembershipEndView({ canEndNow: plan.canEndNow, cancelled: true }), {
        mode: 'back',
        alreadyCancelled: true,
        billingIssue: false,
      });
    },
  },
  {
    name: 'promo, trial and review have nothing to decide',
    run() {
      for (const source of ['promo', 'trial', 'review', 'none']) {
        const plan = resolveMembershipEndPlan(source, '2026-12-01');
        assert.deepEqual(resolveMembershipEndView({ canEndNow: plan.canEndNow, cancelled: false }), {
          mode: 'back',
          alreadyCancelled: false,
          billingIssue: false,
        });
      }
    },
  },
  {
    name: 'card: only a renewing purchase lists the losses',
    run() {
      const card = (view, lapsesOn = null) => resolveMembershipEndCard(view, lapsesOn);
      const renewing = resolveMembershipEndView({ canEndNow: true, cancelled: false });
      assert.deepEqual(card(renewing, '2026-12-01'), { notice: 'renewing', showLosses: true, showKeeps: true });
      // Cancellation is a moment, not a flag: afterwards the card does not
      // remind the reader what they are about to lose.
      const cancelled = resolveMembershipEndView({ canEndNow: true, cancelled: true });
      assert.deepEqual(card(cancelled, '2026-12-01'), { notice: 'cancelled', showLosses: false, showKeeps: true });
      const billing = resolveMembershipEndView({ canEndNow: true, cancelled: true, billingIssue: true });
      assert.deepEqual(card(billing, '2026-12-01'), { notice: 'billing', showLosses: false, showKeeps: true });
    },
  },
  {
    name: 'card: a promo names its date, nothing to cancel says so without a keeps line',
    run() {
      const promo = resolveMembershipEndView({ canEndNow: false, cancelled: false });
      assert.deepEqual(resolveMembershipEndCard(promo, '2026-12-01'), {
        notice: 'promo',
        showLosses: false,
        showKeeps: true,
      });
      assert.deepEqual(resolveMembershipEndCard(promo, null), {
        notice: 'nothing',
        showLosses: false,
        showKeeps: false,
      });
    },
  },
];
