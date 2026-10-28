const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PRO_LIVE_BENEFITS,
  PRO_UNLOCK_CARDS,
  resolveMembershipEndPlan,
} = require('../../src/lib/proBenefits');

const root = path.join(__dirname, '..', '..');
const i18nSource = fs.readFileSync(path.join(root, 'src', 'lib', 'i18n.ts'), 'utf8');

/** Every .ts/.tsx under src/, flattened, so a gate can be looked for by name. */
function readSourceTree(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return readSourceTree(full);
    }
    return /\.tsx?$/.test(entry.name) ? [fs.readFileSync(full, 'utf8')] : [];
  });
}

const sourceTree = readSourceTree(path.join(root, 'src')).join('\n');

module.exports = [
  {
    name: 'the what-you-lose list only names benefits the code really gates',
    run() {
      assert.ok(PRO_LIVE_BENEFITS.length > 0);

      // This used to check that each benefit appeared in the Pro page's own
      // feature list. The Pro page (v3) sells five reasons instead of twelve,
      // so that anchor is gone — and it was always the weaker one. What makes
      // a "you will lose this" line honest is not that a sales page repeats
      // it, it is that a gate in the code enforces it. That is exactly what
      // ProBenefit.gate names, so this reads the gate instead.
      for (const benefit of PRO_LIVE_BENEFITS) {
        assert.ok(
          sourceTree.includes(benefit.gate),
          `${benefit.titleKey} claims to be gated by ${benefit.gate}, which is nowhere in src/`,
        );
        // Both halves of the copy still have to exist, in both languages —
        // an unlock card announcing a missing key renders an empty row.
        for (const key of [benefit.titleKey, benefit.bodyKey]) {
          const lines = i18nSource
            .split('\n')
            .filter((line) => line.includes(`'${key}':`));
          assert.equal(lines.length, 2, `${key} should exist in both languages`);
        }
      }

      // Cloud backup is the one thing the app promises and does not have. It
      // left the Pro page with the SOON badge, and it must never wander into
      // the list of things you lose — you cannot lose what never shipped.
      assert.ok(
        !PRO_LIVE_BENEFITS.some((benefit) => /backup/i.test(benefit.titleKey)),
        'cloud backup is unbuilt and cannot be sold as a live benefit',
      );
    },
  },
  {
    name: 'ending Pro only offers an action the app can actually carry out',
    run() {
      // A promo lapses; there is nothing to cancel, so no button.
      const promo = resolveMembershipEndPlan('promo', '2026-09-01T00:00:00.000Z');
      assert.equal(promo.canEndNow, false);
      assert.equal(promo.lapsesOn, '2026-09-01T00:00:00.000Z');

      // A purchase can be cancelled, and then it runs to the end of the period
      // already paid for — which is the date "You keep all of it until then"
      // names. The demo switch this used to describe is gone (2026-09-03).
      const purchase = resolveMembershipEndPlan('purchase', null, '2027-07-01T09:00:00.000Z');
      assert.equal(purchase.canEndNow, true);
      assert.equal(purchase.lapsesOn, '2027-07-01T09:00:00.000Z');

      // No Pro at all: no end button and no date to promise.
      const none = resolveMembershipEndPlan('none', null);
      assert.equal(none.canEndNow, false);
      assert.equal(none.lapsesOn, null);

      // A promo outranks a purchase in resolveProEntitlement, so 'promo' must
      // never be given the turn-off button by mistake.
      assert.equal(resolveMembershipEndPlan('promo', null).canEndNow, false);
    },
  },
  {
    name: 'the unlock cards announce every live benefit exactly once',
    run() {
      // This is the guard that was missing when the adaptive set coach was
      // deleted: the unlock screen kept announcing it for a day because its
      // card list lived apart from PRO_LIVE_BENEFITS. Now the union of the
      // cards' gates must equal the benefit list exactly — remove a benefit
      // and the card announcing it fails here, loudly.
      const announced = PRO_UNLOCK_CARDS.flatMap((card) => card.gates);
      const sold = PRO_LIVE_BENEFITS.map((benefit) => benefit.titleKey);

      assert.deepEqual(
        [...announced].sort(),
        [...sold].sort(),
        'the unlock cards and PRO_LIVE_BENEFITS disagree about what Pro is',
      );
      assert.equal(
        new Set(announced).size,
        announced.length,
        'a benefit is announced by two different cards',
      );
    },
  },
];
