const assert = require('node:assert/strict');

const {
  MOCK_BILLING,
  SUBSCRIPTION_TERMS,
  isSubscriptionTermKey,
  nextChargeAt,
  resolveSubscriptionView,
  showsMockBilling,
} = require('../../src/lib/subscriptionView');

const NONE = { unlocked: false, source: null, promoUntil: null };
const PREVIEW = { unlocked: true, source: 'preview', promoUntil: null };
const promo = (until) => ({ unlocked: true, source: 'promo', promoUntil: until });
// resolveProEntitlement carries the trial's end in promoUntil, as it does a promo's.
const trial = (until) => ({ unlocked: true, source: 'trial', promoUntil: until, purchaseEndsAt: null });
const PURCHASE = { unlocked: true, source: 'purchase', promoUntil: null, purchaseEndsAt: null };

const base = { mockTerm: 'yearly', mockCancelled: false };

module.exports = [
  {
    name: 'subscription: never subscribed is its own state, not a broken active one',
    run() {
      // The state that looks dead and is not. Home's PRO pill does send a free
      // reader to the paywall — but Settings → Account → Subscription is an
      // unconditional row, so this is what a reader who has never paid sees.
      const view = resolveSubscriptionView({ ...base, entitlement: NONE });
      assert.equal(view.state, 'none');
      assert.equal(view.term, null);
      assert.equal(view.endsAt, null);
      assert.equal(view.nextChargeAt, null);
    },
  },
  {
    name: 'subscription: an expired promo is lapsed, and a live one is active',
    run() {
      // "Lapsed" is the one state the app can prove today: a promoProUntil in
      // the past means this reader really did have Pro and really did lose it.
      const lapsed = resolveSubscriptionView({
        ...base,
        entitlement: NONE,
        lapsedPromoUntil: '2026-07-15T00:00:00.000Z',
      });
      assert.equal(lapsed.state, 'lapsed');
      assert.equal(lapsed.endsAt, '2026-07-15T00:00:00.000Z');

      const live = resolveSubscriptionView({
        ...base,
        entitlement: promo('2026-09-15T00:00:00.000Z'),
      });
      assert.equal(live.state, 'active');
      assert.equal(live.endsAt, '2026-09-15T00:00:00.000Z');
    },
  },
  {
    name: 'subscription: promo Pro is never dressed in invented billing',
    run() {
      // A promo is real Pro on a real clock. Putting a Visa and a renewal date
      // on top of it would be inventing billing over a fact the reader can
      // check against the code they redeemed.
      const view = resolveSubscriptionView({
        ...base,
        entitlement: promo('2026-09-15T00:00:00.000Z'),
      });
      assert.equal(view.grant, 'promo');
      assert.equal(view.term, null);
      assert.equal(view.nextChargeAt, null);
      // ...and the gate refuses the billing rows even in a demo build.
      assert.equal(showsMockBilling(view, true), false);
    },
  },
  {
    name: 'subscription: the free trial is its own state — it ends on its date and nothing is charged',
    run() {
      // The trial fell through to the purchase branch: "Yearly · active", a
      // next payment of 79,90 €, a Visa and a member-since date, for a reader
      // who had started fourteen free days (audit 2026-09-16). It is a dated
      // grant, like a promo, and the screen says exactly that.
      const until = '2026-09-30T08:00:00.000Z';
      const view = resolveSubscriptionView({
        entitlement: trial(until),
        mockTerm: 'monthly',
        mockCancelled: false,
        now: new Date('2026-09-17T08:00:00.000Z'),
      });
      assert.equal(view.state, 'active');
      assert.equal(view.grant, 'trial');
      assert.equal(view.term, null, 'a trial is on no billing term');
      assert.equal(view.cancelled, false);
      assert.equal(view.endsAt, until, 'it ends when the trial ends');
      assert.equal(view.nextChargeAt, null, 'and nothing is charged');
      // No card, no receipts, no term switcher — even in a demo build.
      assert.equal(showsMockBilling(view, true), false);
      assert.equal(showsMockBilling(view, false), false);

      // The real entitlement gives the trial exactly this shape, so the two
      // cannot drift: the view reads the trial's date from promoUntil.
      const { resolveProEntitlement } = require('../../src/lib/proEntitlement');
      const entitlement = resolveProEntitlement(
        {
          promoProUntil: null,
          proTrialUntil: until,
          mockSubscriptionPurchasedAt: null,
          mockSubscriptionTerm: 'yearly',
          mockSubscriptionCancelledAt: null,
        },
        new Date('2026-09-17T08:00:00.000Z'),
      );
      const fromReal = resolveSubscriptionView({ entitlement, mockTerm: 'yearly', mockCancelled: false });
      assert.equal(fromReal.grant, 'trial');
      assert.equal(fromReal.endsAt, until);
      assert.equal(fromReal.term, null);
    },
  },
  {
    name: 'subscription: only a purchase may show billing, and only in a demo build',
    run() {
      const cases = [
        ['none', resolveSubscriptionView({ ...base, entitlement: NONE }), false],
        ['lapsed', resolveSubscriptionView({ ...base, entitlement: NONE, lapsedPromoUntil: '2026-07-15T00:00:00.000Z' }), false],
        ['promo', resolveSubscriptionView({ ...base, entitlement: promo('2026-12-01T00:00:00.000Z') }), false],
        ['trial', resolveSubscriptionView({ ...base, entitlement: trial('2026-12-01T00:00:00.000Z') }), false],
        ['purchase', resolveSubscriptionView({ ...base, entitlement: PURCHASE }), true],
      ];
      for (const [label, view, demo] of cases) {
        assert.equal(showsMockBilling(view, true), demo, `${label} in a demo build`);
        assert.equal(showsMockBilling(view, false), false, `${label} in a release build`);
      }
    },
  },
  {
    name: 'subscription: the next charge is counted, never written',
    run() {
      // The shape real billing will have to fill: a purchase instant plus a
      // period, from which the date is derived. Writing the date into copy is
      // the bug #bugs logged against the unlock receipt.
      assert.equal(nextChargeAt('yearly', '2026-08-15T00:00:00.000Z'), '2027-08-15T00:00:00.000Z');
      assert.equal(nextChargeAt('monthly', '2026-08-15T00:00:00.000Z'), '2026-09-15T00:00:00.000Z');
      // Lifetime does not renew at all — not "renews far away".
      assert.equal(nextChargeAt('lifetime', '2026-08-15T00:00:00.000Z'), null);
      assert.equal(nextChargeAt('yearly', 'not-a-date'), null);
    },
  },
  {
    name: 'subscription: the renewal date follows the reader’s own purchase instant',
    run() {
      // The requirement #bugs locked: store the purchase instant and the term,
      // then COUNT the date. The receipt shipped a hardcoded "15.9.2026" once,
      // which is the one kind of lie a reader can check against a calendar.
      //
      // This is also the single seam billing has to fill — the store supplies
      // purchasedAt, and every renewal line in the app moves with it.
      const march = resolveSubscriptionView({
        entitlement: PREVIEW,
        mockTerm: 'yearly',
        mockCancelled: false,
        purchasedAt: '2027-03-04T09:00:00.000Z',
      });
      assert.equal(march.nextChargeAt, '2028-03-04T09:00:00.000Z');

      const monthly = resolveSubscriptionView({
        entitlement: PREVIEW,
        mockTerm: 'monthly',
        mockCancelled: false,
        purchasedAt: '2027-03-04T09:00:00.000Z',
      });
      assert.equal(monthly.nextChargeAt, '2027-04-04T09:00:00.000Z');

      // No record — a reader who had Pro before the field existed — falls back
      // to the mock instant rather than showing nothing.
      const legacy = resolveSubscriptionView({ ...base, entitlement: PREVIEW });
      assert.equal(legacy.nextChargeAt, nextChargeAt('yearly', MOCK_BILLING.lastChargedAt));
    },
  },
  {
    name: 'subscription: the period arithmetic survives DST and short months',
    run() {
      // Both of these were real: setMonth works in local time, so a March
      // purchase renewed into April came out an hour early — invisible in a
      // formatted date until the purchase sits near midnight, and then it is a
      // whole day wrong. And JS rolls month overflow forward rather than
      // clamping, so the 31st plus a month is the 3rd.
      assert.equal(nextChargeAt('monthly', '2027-03-04T09:00:00.000Z'), '2027-04-04T09:00:00.000Z');
      assert.equal(nextChargeAt('monthly', '2027-10-04T09:00:00.000Z'), '2027-11-04T09:00:00.000Z');
      // 31 Jan + 1 month = 28 Feb, not 3 March.
      assert.equal(nextChargeAt('monthly', '2027-01-31T09:00:00.000Z'), '2027-02-28T09:00:00.000Z');
      // ...and the leap year gets its extra day.
      assert.equal(nextChargeAt('monthly', '2028-01-31T09:00:00.000Z'), '2028-02-29T09:00:00.000Z');
      // A leap day plus a year has nowhere to land either.
      assert.equal(nextChargeAt('yearly', '2028-02-29T09:00:00.000Z'), '2029-02-28T09:00:00.000Z');
    },
  },
  {
    name: 'subscription: cancelling keeps Pro until the period ends',
    run() {
      // The end-membership page promises Pro works until the date two lines
      // above the button. A cancel that switched it off on the spot would
      // contradict the screen the reader is standing on.
      const view = resolveSubscriptionView({
        entitlement: PREVIEW,
        mockTerm: 'yearly',
        mockCancelled: true,
      });
      assert.equal(view.state, 'active');
      assert.equal(view.cancelled, true);
      assert.equal(view.endsAt, '2027-08-15T00:00:00.000Z');
      // Nothing more is owed, but Pro is still on.
      assert.equal(view.nextChargeAt, null);
    },
  },
  {
    name: 'subscription: clearing the demo flag takes every invented row away',
    run() {
      // The release valve. showsMockBilling is the only thing the screen asks,
      // so one flag removes the card, the receipts and the term switcher
      // without anyone editing the screen.
      const view = resolveSubscriptionView({ ...base, entitlement: PREVIEW });
      assert.equal(showsMockBilling(view, true), true);
      assert.equal(showsMockBilling(view, false), false);

      const none = resolveSubscriptionView({ ...base, entitlement: NONE });
      assert.equal(showsMockBilling(none, true), false);
    },
  },
  {
    name: 'subscription: every term has a price, a unit and an honest renewal flag',
    run() {
      for (const key of ['monthly', 'yearly', 'lifetime']) {
        const term = SUBSCRIPTION_TERMS[key];
        assert.equal(term.key, key);
        assert.ok(term.priceKey && term.perKey && term.labelKey);
        assert.equal(typeof term.renews, 'boolean');
        assert.ok(isSubscriptionTermKey(key));
      }
      // The one that decides how three different screens phrase themselves.
      assert.equal(SUBSCRIPTION_TERMS.lifetime.renews, false);
      assert.equal(SUBSCRIPTION_TERMS.yearly.renews, true);
      assert.equal(isSubscriptionTermKey('weekly'), false);
      assert.equal(isSubscriptionTermKey(null), false);
    },
  },
  {
    name: 'subscription: the mock prices come from the dictionary, not from here',
    run() {
      // Every price on this screen is an i18n key, so the one price set the
      // proSurfaces guard pins is also the one this screen quotes. A number
      // typed into MOCK_BILLING would be a second price set nobody guards.
      const serialized = JSON.stringify(MOCK_BILLING);
      assert.doesNotMatch(serialized, /\d+,\d\d\s?€/, 'MOCK_BILLING must not carry literal prices');
      for (const term of ['yearly', 'monthly', 'lifetime']) {
        for (const receipt of MOCK_BILLING.receipts[term]) {
          assert.match(receipt.priceKey, /^(paywall\.plan|pro\.page\.per)/);
          assert.ok(!Number.isNaN(Date.parse(receipt.paidAt)));
        }
      }
    },
  },
  {
    /**
     * A badge on the plan cards is a sales claim, and this screen is where a
     * reader decides to hand over money. Both badges here are arithmetic they
     * could check against the prices printed next to them. "Most popular" was
     * asked for and is the one that cannot be: nothing has been sold, so it
     * would describe buyers who do not exist.
     */
    name: 'subscription: every plan badge is arithmetic, not a claim about other buyers',
    run() {
      const fs = require('node:fs');
      const path = require('node:path');
      const root = path.join(__dirname, '..', '..');
      const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

      // Lifetime earns a badge: 179,00 against 79,90 a year pays back in a
      // little over two.
      assert.equal(SUBSCRIPTION_TERMS.lifetime.badgeKey, 'pro.page.bestValue');
      assert.equal(SUBSCRIPTION_TERMS.yearly.badgeKey, 'subs.term.yearlyBadge');
      // Monthly is the baseline the others are measured against, so it has
      // nothing to claim.
      assert.equal(SUBSCRIPTION_TERMS.monthly.badgeKey, undefined);

      // The Pro page states the same arithmetic, in the form v6 gives it: the
      // lifetime tile carries no badge at all, and the payback is said in
      // words under the price instead. The rule survives the change of shape —
      // what the page claims about lifetime is a division anyone can redo, not
      // a statement about how many people bought it.
      const tiers = read('src/lib/proTiers.ts');
      assert.match(tiers, /id: 'lifetime',[\s\S]{0,240}?subKey: 'pro\.v6\.sub\.lifetime'/);
      const payback = read('src/lib/i18n.ts')
        .split('\n')
        .filter((line) => line.includes("'pro.v6.sub.lifetime':"));
      assert.equal(payback.length, 2, 'needs both languages');
      for (const line of payback) {
        assert.match(line, /two years|kahden vuoden/, 'the lifetime claim must stay the arithmetic');
      }

      const i18nSource = read('src/lib/i18n.ts');
      assert.equal(i18nSource.split("'pro.page.bestValue':").length - 1, 2, 'needs both languages');
      // The claim nobody can check stays out of the shipped strings.
      assert.doesNotMatch(i18nSource, /'pro\.page\.mostPopular'/);
    },
  },
];
