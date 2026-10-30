const assert = require('node:assert/strict');

const {
  isProUnlocked,
  resolveProEntitlement,
  resolveProgressionOptions,
} = require('../../src/lib/proEntitlement');

const NOW = new Date('2026-07-25T12:00:00.000Z');

function prefs(overrides) {
  return {
    promoProUntil: null,
    mockSubscriptionPurchasedAt: null,
    mockSubscriptionTerm: 'yearly',
    mockSubscriptionCancelledAt: null,
    ...overrides,
  };
}

/**
 * Two doors into Pro, and no third (user 2026-09-03). The suite is written as
 * a list of ways in, so adding one without adding a case here is the thing it
 * is meant to make hard.
 */
module.exports = [
  {
    name: 'a fresh account has no Pro',
    run() {
      const entitlement = resolveProEntitlement(prefs({}), NOW);
      assert.equal(entitlement.unlocked, false);
      assert.equal(entitlement.source, null);
      assert.equal(entitlement.promoUntil, null);
      assert.equal(entitlement.purchaseEndsAt, null);
    },
  },
  {
    name: 'an unexpired promo unlocks Pro and says so',
    run() {
      const entitlement = resolveProEntitlement(
        prefs({ promoProUntil: '2026-08-24T12:00:00.000Z' }),
        NOW,
      );
      assert.equal(entitlement.unlocked, true);
      assert.equal(entitlement.source, 'promo');
      assert.equal(entitlement.promoUntil, '2026-08-24T12:00:00.000Z');
    },
  },
  {
    name: 'an expired or unreadable promo does not unlock Pro',
    run() {
      assert.equal(isProUnlocked(prefs({ promoProUntil: '2026-07-24T12:00:00.000Z' }), NOW), false);
      assert.equal(isProUnlocked(prefs({ promoProUntil: 'not-a-date' }), NOW), false);
    },
  },
  {
    name: 'a recorded purchase unlocks Pro, and an unreadable one does not',
    run() {
      const bought = resolveProEntitlement(
        prefs({ mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z' }),
        NOW,
      );
      assert.equal(bought.unlocked, true);
      assert.equal(bought.source, 'purchase');
      // Still renewing, so there is no end date to name.
      assert.equal(bought.purchaseEndsAt, null);

      assert.equal(isProUnlocked(prefs({ mockSubscriptionPurchasedAt: 'whenever' }), NOW), false);
    },
  },
  {
    name: 'cancelling runs the purchase to the end of the period, and then it stops',
    run() {
      // Bought 1 July, cancelled: a yearly term keeps working until 1 July next
      // year. This is the sentence the End membership screen makes.
      const cancelled = resolveProEntitlement(
        prefs({
          mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
          mockSubscriptionCancelledAt: NOW.toISOString(),
        }),
        NOW,
      );
      assert.equal(cancelled.unlocked, true);
      assert.equal(cancelled.purchaseEndsAt, '2027-07-01T09:00:00.000Z');

      // The day after that period ends, it is over.
      assert.equal(
        isProUnlocked(
          prefs({
            mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
            mockSubscriptionCancelledAt: NOW.toISOString(),
          }),
          new Date('2027-07-02T09:00:00.000Z'),
        ),
        false,
      );

      // A monthly bought three months ago has renewed twice, so cancelling it
      // today runs to the end of the CURRENT month, not to a date in the past.
      const monthly = resolveProEntitlement(
        prefs({
          mockSubscriptionPurchasedAt: '2026-04-10T09:00:00.000Z',
          mockSubscriptionTerm: 'monthly',
          mockSubscriptionCancelledAt: NOW.toISOString(),
        }),
        NOW,
      );
      assert.equal(monthly.unlocked, true);
      assert.equal(monthly.purchaseEndsAt, '2026-08-10T09:00:00.000Z');

      // Lifetime is one payment with nothing running to stop: a cancellation
      // stamp does not take it away (it did, at once, until the bug hunt of
      // 2026-10-05 — one tap of End membership locked a lifetime holder out).
      const cancelledLifetime = resolveProEntitlement(
        prefs({
          mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
          mockSubscriptionTerm: 'lifetime',
          mockSubscriptionCancelledAt: NOW.toISOString(),
        }),
        new Date('2099-01-01T00:00:00.000Z'),
      );
      assert.deepEqual([cancelledLifetime.unlocked, cancelledLifetime.source, cancelledLifetime.purchaseEndsAt], [true, 'purchase', null]);
      // Uncancelled, it never ends.
      assert.equal(
        isProUnlocked(
          prefs({ mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z', mockSubscriptionTerm: 'lifetime' }),
          new Date('2099-01-01T00:00:00.000Z'),
        ),
        true,
      );
    },
  },
  {
    name: 'a purchase that outlasts a running promo is the stated reason; a promo that outlasts the purchase stays',
    run() {
      const entitlement = resolveProEntitlement(
        prefs({
          promoProUntil: '2026-08-24T12:00:00.000Z',
          mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
        }),
        NOW,
      );
      assert.equal(entitlement.source, 'purchase');
      const outlasted = resolveProEntitlement(
        prefs({
          promoProUntil: '2027-08-24T12:00:00.000Z',
          mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
          mockSubscriptionCancelledAt: '2026-07-10T09:00:00.000Z',
          mockSubscriptionTerm: 'monthly',
        }),
        NOW,
      );
      assert.equal(outlasted.source, 'promo');
    },
  },
  {
    name: 'nothing else in preferences can unlock Pro',
    run() {
      // The demo build used to carry a preview switch the Pro page flipped, and
      // a button under it to flip it back — Pro for free, from inside the app,
      // as often as you liked. Anything shaped like that must not work.
      for (const stowaway of [
        { adaptiveCoachPremiumUnlocked: true },
        { selectedAccessTier: 'pro' },
        { proUnlocked: true },
        { premium: true },
        { mockSubscriptionTerm: 'lifetime' },
        { mockSubscriptionCancelledAt: null },
      ]) {
        assert.equal(
          isProUnlocked(prefs(stowaway), NOW),
          false,
          `${JSON.stringify(stowaway)} unlocked Pro without a promo or a purchase`,
        );
      }
    },
  },
  {
    name: 'progression options: the toggle only progresses with Pro, and Pro never overrides OFF',
    run() {
      const base = { automatedProgressionEnabled: true, setupLevel: 'beginner' };

      // Free user, toggle on: stored choice respected, prefill must not move.
      assert.deepEqual(resolveProgressionOptions(prefs(base), NOW), {
        automatedProgressionEnabled: false,
        setupLevel: 'beginner',
        cautionFlags: [],
      });

      // Paying user, toggle on: the paid feature runs.
      assert.deepEqual(
        resolveProgressionOptions(
          prefs({ ...base, mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z' }),
          NOW,
        ),
        { automatedProgressionEnabled: true, setupLevel: 'beginner', cautionFlags: [] },
      );

      // Paying user, toggle off: paying does not force progression on.
      assert.deepEqual(
        resolveProgressionOptions(
          prefs({
            ...base,
            automatedProgressionEnabled: false,
            mockSubscriptionPurchasedAt: '2026-07-01T09:00:00.000Z',
          }),
          NOW,
        ),
        { automatedProgressionEnabled: false, setupLevel: 'beginner', cautionFlags: [] },
      );

      // A promo grant counts as Pro here exactly like everywhere else.
      assert.equal(
        resolveProgressionOptions(prefs({ ...base, promoProUntil: '2026-08-24T12:00:00.000Z' }), NOW)
          .automatedProgressionEnabled,
        true,
      );

      // The setup flags ride along with the gate they limit, whatever the tier.
      const flags = [{ area: 'knees', level: 'careful', refinements: [] }];
      assert.deepEqual(resolveProgressionOptions(prefs({ ...base, setupCautionFlags: flags }), NOW).cautionFlags, flags);

      // And an expired promo does not.
      assert.equal(
        resolveProgressionOptions(prefs({ ...base, promoProUntil: '2026-07-24T12:00:00.000Z' }), NOW)
          .automatedProgressionEnabled,
        false,
      );
    },
  },
  {
    name: 'resume sees a paid, cancelled-but-running subscription under a trial or a promo (bug hunt 2026-10-05)',
    run() {
      const { canResumePurchase } = require('../../src/lib/proEntitlement');
      const now = new Date('2026-10-05T12:00:00.000Z');
      const paidCancelled = {
        mockSubscriptionTerm: 'yearly',
        mockSubscriptionPurchasedAt: '2026-10-01T00:00:00.000Z',
        mockSubscriptionCancelledAt: '2026-10-02T00:00:00.000Z',
      };
      for (const grant of [{ proTrialUntil: '2026-10-10T00:00:00.000Z' }, { promoProUntil: '2026-12-01T00:00:00.000Z' }]) {
        const both = prefs({ ...paidCancelled, ...grant });
        assert.equal(canResumePurchase(both, now), true);
      }
      // Owner decision D6-5 (2026-10-12): with Play Billing live, an active
      // store purchase wins over a running device trial as the stated reason,
      // so the subscription page shows the plan rather than "trial ends ...".
      // This test used to pin the trial as the reason. The purchase here runs
      // to 2027-10-01, past the trial's 2026-10-10.
      assert.equal(
        resolveProEntitlement(prefs({ ...paidCancelled, proTrialUntil: '2026-10-10T00:00:00.000Z' }), now).source,
        'purchase',
      );
      // The same rule for a leftover promo: the purchase runs to 2027-10-01,
      // past the promo's 2026-12-01, so the purchase is the reason.
      assert.equal(
        resolveProEntitlement(prefs({ ...paidCancelled, promoProUntil: '2026-12-01T00:00:00.000Z' }), now).source,
        'purchase',
      );
      // A lapsed purchase is still not resumable, grant or not.
      const lapsed = prefs({ ...paidCancelled, mockSubscriptionTerm: 'monthly', mockSubscriptionPurchasedAt: '2026-01-01T00:00:00.000Z', mockSubscriptionCancelledAt: '2026-01-02T00:00:00.000Z', proTrialUntil: '2026-10-10T00:00:00.000Z' });
      assert.equal(canResumePurchase(lapsed, now), false);
    },
  },
  {
    name: 'a store purchase that outlasts a running trial is the stated reason, and the page shows its plan (D6-5)',
    run() {
      const { resolveSubscriptionView } = require('../../src/lib/subscriptionView');
      const now = new Date('2026-10-19T07:00:00.000Z');
      const trial = { proTrialUntil: '2026-10-22T07:00:00.000Z' };
      const yearly = { mockSubscriptionPurchasedAt: '2026-10-19T07:00:00.000Z', mockSubscriptionTerm: 'yearly' };

      // Renewing yearly bought mid-trial: the purchase, with the plan and a next charge.
      const paid = resolveProEntitlement(prefs({ ...trial, ...yearly }), now);
      assert.deepEqual(paid, { unlocked: true, source: 'purchase', promoUntil: null, purchaseEndsAt: null });
      const view = resolveSubscriptionView({
        entitlement: paid,
        mockTerm: 'yearly',
        mockCancelled: false,
        purchasedAt: yearly.mockSubscriptionPurchasedAt,
        now,
      });
      assert.equal(view.grant, null);
      assert.equal(view.term, 'yearly');
      assert.notEqual(view.nextChargeAt, null);

      // Lifetime outlasts anything.
      assert.equal(
        resolveProEntitlement(prefs({ ...trial, ...yearly, mockSubscriptionTerm: 'lifetime' }), now).source,
        'purchase',
      );

      // A monthly cancelled so it ends 2026-10-20, before the trial's 22nd:
      // the trial is what keeps Pro on, so it stays the reason.
      const shortPaid = prefs({
        ...trial,
        mockSubscriptionPurchasedAt: '2026-09-20T07:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: '2026-10-01T07:00:00.000Z',
      });
      assert.equal(resolveProEntitlement(shortPaid, now).source, 'trial');

      // No purchase: the trial, as before.
      assert.equal(resolveProEntitlement(prefs(trial), now).source, 'trial');
    },
  },
  {
    name: 'the trial-ending notice time is null when a purchase or a later promo keeps Pro on (D6-1)',
    run() {
      const { trialEndingAtMs } = require('../../src/lib/proEntitlement');
      const { buildNotificationPlan } = require('../../src/lib/notificationPlan');
      const trialEnd = '2026-10-22T07:00:00.000Z';
      const base = prefs({ proTrialUntil: trialEnd });

      // Trial alone: the end, as the notice was promised.
      assert.equal(trialEndingAtMs(base), Date.parse(trialEnd));
      // No trial or an unreadable one: nothing.
      assert.equal(trialEndingAtMs(prefs({ proTrialUntil: null })), null);
      assert.equal(trialEndingAtMs(prefs({ proTrialUntil: 'garbage' })), null);

      // A renewing purchase made during the trial: Pro is not closing.
      const paid = { ...base, mockSubscriptionPurchasedAt: '2026-10-19T07:00:00.000Z', mockSubscriptionTerm: 'yearly' };
      assert.equal(trialEndingAtMs(paid), null);
      // Cancelled, but paid to a date past the trial: still not closing.
      assert.equal(trialEndingAtMs({ ...paid, mockSubscriptionCancelledAt: '2026-10-20T07:00:00.000Z' }), null);
      // A monthly cancelled so it ends before the trial does: the trial's end is the end.
      assert.equal(
        trialEndingAtMs({
          ...base,
          mockSubscriptionPurchasedAt: '2026-09-20T07:00:00.000Z',
          mockSubscriptionTerm: 'monthly',
          mockSubscriptionCancelledAt: '2026-10-01T07:00:00.000Z',
        }),
        Date.parse(trialEnd),
      );
      // A promo running past the trial: not closing. One that ends first: closing.
      assert.equal(trialEndingAtMs({ ...base, promoProUntil: '2027-01-01T00:00:00.000Z' }), null);
      assert.equal(trialEndingAtMs({ ...base, promoProUntil: '2026-10-20T00:00:00.000Z' }), Date.parse(trialEnd));

      // And the plan built from it carries no trial note for the payer.
      const planFor = (p) =>
        buildNotificationPlan({
          nowMs: Date.parse('2026-10-19T07:00:00.000Z'),
          prefs: {
            pushEnabled: true,
            level: 'normal',
            personalRecords: false,
            weeklySummary: false,
            comebackNudge: false,
            sessionReminders: false,
            reminderTime: '18:00',
            weighInReminder: false,
            measurementReminderKind: null,
            measurementReminderDay: 1,
          },
          language: 'en',
          schedule: { kind: 'none' },
          onTrainingBreak: true,
          lastSessionAtMs: null,
          lastWorkoutAtMs: null,
          weekSessionCount: 0,
          weekVolumeKg: 0,
          latestPr: null,
          proTrialEndsAtMs: trialEndingAtMs(p),
        }).filter((note) => note.category === 'trial');
      assert.equal(planFor(base).length, 1);
      assert.equal(planFor(paid).length, 0);

      // The hook reads the rule, not the raw field, and re-plans on the purchase fields.
      const hook = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', '..', 'src', 'hooks', 'useScheduledNotifications.ts'),
        'utf8',
      );
      assert.match(hook, /trialEndingAtMs\(/);
      assert.match(hook, /trialEndingAtMs\(database\.preferences\)/);
      const memo = hook.slice(hook.indexOf('trialEndingAtMs(database.preferences)'));
      const deps = memo.slice(0, memo.indexOf(');'));
      for (const field of ['proTrialUntil', 'promoProUntil', 'mockSubscriptionPurchasedAt', 'mockSubscriptionTerm', 'mockSubscriptionCancelledAt']) {
        assert.match(deps, new RegExp(`database\\.preferences\\.${field},`), `${field} is not a dep of the trial notice`);
      }
    },
  },
  {
    name: 'a lifetime holder is offered no End membership, and an old cancellation stamp is not shown',
    run() {
      const { resolveSubscriptionView } = require('../../src/lib/subscriptionView');
      const entitlement = { unlocked: true, source: 'purchase', promoUntil: null, purchaseEndsAt: null };
      const view = resolveSubscriptionView({ entitlement, mockTerm: 'lifetime', mockCancelled: true, purchasedAt: '2026-07-01T09:00:00.000Z' });
      assert.equal(view.cancelled, false);
      const screen = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'screens', 'SubscriptionScreen.tsx'), 'utf8');
      assert.match(screen, /\) : lifetime \? null : model\.cancelled \? \(/);
    },
  },
];
