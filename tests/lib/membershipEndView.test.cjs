const assert = require('node:assert/strict');

const { resolveMembershipEndView } = require('../../src/lib/membershipEndView');
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
];
