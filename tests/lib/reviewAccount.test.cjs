const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createEmptyDatabase } = require('../../.test-dist/data/seed');
const {
  REVIEW_ACCOUNT_HASHES,
  isReviewAccount,
  reviewAccountFlag,
  sha256Hex,
} = require('../../.test-dist/lib/reviewAccount.js');
const {
  DEVICE_ONLY_PREFERENCE_FIELDS,
  keepDeviceEntitlement,
  resolveProEntitlement,
  trialEndingAtMs,
} = require('../../.test-dist/lib/proEntitlement.js');
const { resolveSubscriptionView } = require('../../.test-dist/lib/subscriptionView.js');
const { resolveMembershipEndPlan } = require('../../.test-dist/lib/proBenefits.js');
const { loadAgainstFake, createFakeAsyncStorage } = require('../storage/fakeAsyncStorage.cjs');

/**
 * Play's review account (lib/reviewAccount): Pro while a Google account whose
 * email or sub hashes to a listed value is signed in. The real values are not
 * in this file - only fixtures computed here with node:crypto, run through the
 * injectable list.
 */

const nodeSha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const FIXTURE_EMAIL = 'Reviewer.Fixture@example.test';
const FIXTURE_SUB = '104857600123456789012';
const EMAIL_LIST = [nodeSha('reviewer.fixture@example.test')];
const SUB_LIST = [nodeSha(FIXTURE_SUB)];
const BOTH_LIST = [...EMAIL_LIST, ...SUB_LIST];

const NOW = new Date('2026-10-14T10:00:00.000Z');
const FAR = '9999-01-01T00:00:00.000Z';

function preferences(overrides) {
  return { ...createEmptyDatabase('en').preferences, ...overrides };
}

module.exports = [
  {
    name: 'review account: the pure SHA-256 matches node:crypto (empty, ASCII, UTF-8, padding edges, >64 bytes)',
    run() {
      const inputs = [
        '',
        'abc',
        'a@b.c',
        'ääkkönen',
        'Ünïcödé ✓ 日本語',
        '😀 astral plane',
        'x'.repeat(55),
        'x'.repeat(56),
        'x'.repeat(63),
        'x'.repeat(64),
        'x'.repeat(65),
        'The quick brown fox jumps over the lazy dog, and keeps going well past one sixty-four byte block.',
        'y'.repeat(1000),
      ];
      for (const input of inputs) {
        assert.equal(sha256Hex(input), nodeSha(input), `sha256 of ${JSON.stringify(input.slice(0, 20))} (${input.length})`);
      }
    },
  },
  {
    name: 'review account: the shipped list holds only 64-hex hashes, nothing readable, and not the superseded one',
    run() {
      assert.ok(REVIEW_ACCOUNT_HASHES.length >= 1);
      for (const hash of REVIEW_ACCOUNT_HASHES) {
        assert.match(hash, /^[0-9a-f]{64}$/);
      }
      assert.equal(new Set(REVIEW_ACCOUNT_HASHES).size, REVIEW_ACCOUNT_HASHES.length);
      assert.ok(!REVIEW_ACCOUNT_HASHES.some((hash) => hash.startsWith('cee13c28')));
    },
  },
  {
    name: 'review account: the email matches after trim and lowercase, in any case',
    run() {
      assert.equal(isReviewAccount({ email: FIXTURE_EMAIL }, EMAIL_LIST), true);
      assert.equal(isReviewAccount({ email: `  ${FIXTURE_EMAIL.toUpperCase()}\n` }, EMAIL_LIST), true);
      assert.equal(isReviewAccount({ email: 'reviewer.fixture@example.test', sub: 'other' }, EMAIL_LIST), true);
    },
  },
  {
    name: 'review account: the sub matches as stored, with no email at all',
    run() {
      assert.equal(isReviewAccount({ email: null, sub: FIXTURE_SUB }, SUB_LIST), true);
      assert.equal(isReviewAccount({ sub: ` ${FIXTURE_SUB} ` }, SUB_LIST), true);
      assert.equal(isReviewAccount({ email: 'someone@else.test', sub: FIXTURE_SUB }, BOTH_LIST), true);
      // Either path is enough, neither is required.
      assert.equal(isReviewAccount({ email: FIXTURE_EMAIL, sub: 'different-sub' }, BOTH_LIST), true);
    },
  },
  {
    name: 'review account: nothing else matches (null, empty, other email, other sub, a hash given as the identity)',
    run() {
      assert.equal(isReviewAccount({}, BOTH_LIST), false);
      assert.equal(isReviewAccount({ email: null, sub: null }, BOTH_LIST), false);
      assert.equal(isReviewAccount({ email: '', sub: '' }, BOTH_LIST), false);
      assert.equal(isReviewAccount({ email: '   ', sub: '  ' }, BOTH_LIST), false);
      assert.equal(isReviewAccount({ email: 'other@example.test', sub: '1' }, BOTH_LIST), false);
      assert.equal(
        isReviewAccount({ email: 'reviewer.fixture@example.test.evil', sub: `${FIXTURE_SUB}0` }, BOTH_LIST),
        false,
      );
      // Knowing the hash is not a way in.
      assert.equal(isReviewAccount({ email: EMAIL_LIST[0], sub: SUB_LIST[0] }, BOTH_LIST), false);
      // The email's hash does not count when the list holds the sub's, and the reverse.
      assert.equal(isReviewAccount({ email: FIXTURE_EMAIL }, SUB_LIST), false);
      assert.equal(isReviewAccount({ sub: FIXTURE_SUB }, EMAIL_LIST), false);
      assert.equal(isReviewAccount({ email: FIXTURE_EMAIL, sub: FIXTURE_SUB }, []), false);
    },
  },
  {
    name: 'review account: the stored flag is for a signed-in Google account only',
    run() {
      const who = { email: FIXTURE_EMAIL, sub: FIXTURE_SUB };
      assert.equal(reviewAccountFlag({ ...who, status: 'signed_in', provider: 'google' }, BOTH_LIST), true);
      assert.equal(reviewAccountFlag({ ...who, status: 'signed_in', provider: 'apple' }, BOTH_LIST), false);
      for (const status of ['signed_out', 'loading', 'unavailable']) {
        assert.equal(reviewAccountFlag({ ...who, status, provider: 'google' }, BOTH_LIST), false, status);
      }
      assert.equal(
        reviewAccountFlag({ email: 'x@y.test', sub: '1', status: 'signed_in', provider: 'google' }, BOTH_LIST),
        false,
      );
    },
  },
  {
    name: 'review account entitlement: the flag unlocks Pro with source review and no dates',
    run() {
      const result = resolveProEntitlement(preferences({ reviewProAccount: true }), NOW);
      assert.deepEqual(result, { unlocked: true, source: 'review', promoUntil: null, purchaseEndsAt: null });
    },
  },
  {
    name: 'review account entitlement: without the flag nothing changes (free, promo, trial, purchase)',
    run() {
      assert.equal(createEmptyDatabase('en').preferences.reviewProAccount, false);
      assert.deepEqual(resolveProEntitlement(preferences({}), NOW), {
        unlocked: false,
        source: null,
        promoUntil: null,
        purchaseEndsAt: null,
      });
      assert.equal(resolveProEntitlement(preferences({ reviewProAccount: false, promoProUntil: FAR }), NOW).source, 'promo');
      assert.equal(resolveProEntitlement(preferences({ proTrialUntil: FAR }), NOW).source, 'trial');
      assert.equal(
        resolveProEntitlement(preferences({ mockSubscriptionPurchasedAt: '2026-10-01T00:00:00.000Z' }), NOW).source,
        'purchase',
      );
      // Preferences from before the field existed read as no.
      const { reviewProAccount, ...old } = preferences({});
      assert.equal(resolveProEntitlement(old, NOW).unlocked, false);
    },
  },
  {
    name: 'review account entitlement: a real purchase keeps its own name, a promo or trial yields to the review',
    run() {
      const bought = preferences({
        reviewProAccount: true,
        mockSubscriptionPurchasedAt: '2026-10-01T00:00:00.000Z',
        mockSubscriptionTerm: 'yearly',
      });
      assert.equal(resolveProEntitlement(bought, NOW).source, 'purchase');
      // A purchase that has run out no longer outranks it.
      const lapsed = preferences({
        reviewProAccount: true,
        mockSubscriptionPurchasedAt: '2025-01-01T00:00:00.000Z',
        mockSubscriptionTerm: 'monthly',
        mockSubscriptionCancelledAt: '2025-01-05T00:00:00.000Z',
      });
      assert.equal(resolveProEntitlement(lapsed, NOW).source, 'review');
      assert.equal(resolveProEntitlement(preferences({ reviewProAccount: true, promoProUntil: FAR }), NOW).source, 'review');
      assert.equal(resolveProEntitlement(preferences({ reviewProAccount: true, proTrialUntil: FAR }), NOW).source, 'review');
    },
  },
  {
    name: 'review account entitlement: no trial-ending notice is planned for it',
    run() {
      const trialEnds = '2026-10-20T00:00:00.000Z';
      assert.equal(trialEndingAtMs(preferences({ proTrialUntil: trialEnds })), new Date(trialEnds).getTime());
      assert.equal(trialEndingAtMs(preferences({ proTrialUntil: trialEnds, reviewProAccount: true })), null);
    },
  },
  {
    name: 'review account screens: the subscription view and the membership plan state no plan, price, end or cancel',
    run() {
      const entitlement = resolveProEntitlement(preferences({ reviewProAccount: true }), NOW);
      const view = resolveSubscriptionView({ entitlement, mockTerm: 'yearly', mockCancelled: false, now: NOW });
      assert.deepEqual(view, {
        state: 'active',
        term: null,
        cancelled: false,
        endsAt: null,
        nextChargeAt: null,
        grant: 'review',
      });
      assert.deepEqual(resolveMembershipEndPlan('review', null, null), { canEndNow: false, lapsesOn: null });
    },
  },
  {
    name: 'review account restore: the device keeps its own flag, whichever way it differs from the backup',
    run() {
      assert.ok(DEVICE_ONLY_PREFERENCE_FIELDS.includes('reviewProAccount'));
      const withFlag = preferences({ reviewProAccount: true });
      const without = preferences({ reviewProAccount: false });
      // A backup from the review phone does not hand Pro to another phone...
      const onOtherPhone = keepDeviceEntitlement(withFlag, without);
      assert.equal(onOtherPhone.reviewProAccount, false);
      assert.equal(resolveProEntitlement(onOtherPhone, NOW).unlocked, false);
      // ...and a backup made elsewhere does not take it from the review phone.
      assert.equal(keepDeviceEntitlement(without, withFlag).reviewProAccount, true);
    },
  },
  {
    name: 'review account storage: a missing or malformed stored flag loads as false, a stored true stays',
    run() {
      const fake = createFakeAsyncStorage();
      const database = loadAgainstFake(fake, (requireDist) => requireDist('storage/database.js'));
      const load = (value, present = true) => {
        const base = createEmptyDatabase('en');
        const prefs = { ...base.preferences };
        delete prefs.reviewProAccount;
        if (present) {
          prefs.reviewProAccount = value;
        }
        return database.normalizeDatabase({ ...base, preferences: prefs }).preferences.reviewProAccount;
      };
      assert.equal(load(undefined, false), false, 'missing');
      for (const garbage of ['true', 1, 'yes', {}, [], null]) {
        assert.equal(load(garbage), false, JSON.stringify(garbage));
      }
      assert.equal(load(false), false);
      assert.equal(load(true), true);
    },
  },
];
