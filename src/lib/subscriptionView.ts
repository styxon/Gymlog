import { I18nKey } from './i18n';
import { ProEntitlement } from './proEntitlement';
import { SubscriptionTermKey, currentPeriodEndAt } from './subscriptionTerm';

/**
 * What the subscription screen may say, and where each sentence comes from.
 *
 * The screen has two kinds of fact on it and they must not be confused:
 *
 *   REAL — resolved from the entitlement. Whether Pro is on, why, and the date
 *   a promo runs out. These the app actually knows.
 *
 *   MOCK — everything downstream of billing: which term the reader is on, when
 *   the next charge lands, the card it lands on, and the receipts behind it.
 *   None of it exists. There is no billing library installed, no store account
 *   to ask, and no charge has ever been made.
 *
 * The mock half is here, in one module, with one name (`MOCK_BILLING`), so that
 * the day billing lands the work is to delete this block and implement the same
 * shape against the store — not to hunt interpolated strings through a screen.
 * `tests/releaseReadiness` fails if this ships outside a demo build.
 *
 * Design source: "Vinha Tilaus - hallinta" (vinha-subs.jsx). Its own note is
 * the rule the screen follows: no price list here, because a price list on a
 * management screen is half a paywall in the wrong place. One route to Pro,
 * and it goes where everyone else buys.
 */

export type { SubscriptionTermKey } from './subscriptionTerm';

/**
 * The three terms, and what each one implies about renewal.
 *
 * `renews: false` on lifetime is the one that matters — it is not a shorter
 * subscription, it is the absence of one, so every "next payment" line has to
 * read differently rather than showing a date far away.
 */
export interface SubscriptionTerm {
  key: SubscriptionTermKey;
  nameKey: I18nKey;
  labelKey: I18nKey;
  ctaKey: I18nKey;
  noteKey: I18nKey;
  priceKey: I18nKey;
  perKey: I18nKey;
  renews: boolean;
  /**
   * Yearly carries the same saving the paywall computes; lifetime carries its
   * payback. Both are arithmetic — a badge on this screen has to be something
   * a reader could check, and it has to agree with the paywall's own badge for
   * the same plan: the two are read minutes apart (PR #62 review).
   */
  badgeKey?: I18nKey;
}

export const SUBSCRIPTION_TERMS: Record<SubscriptionTermKey, SubscriptionTerm> = {
  monthly: {
    key: 'monthly',
    nameKey: 'subs.term.monthly',
    labelKey: 'subs.term.monthlyLabel',
    ctaKey: 'subs.term.monthlyCta',
    noteKey: 'subs.term.monthlyNote',
    priceKey: 'paywall.plan.monthly.price',
    perKey: 'pro.v3.unit.month',
    renews: true,
  },
  yearly: {
    key: 'yearly',
    nameKey: 'subs.term.yearly',
    labelKey: 'subs.term.yearlyLabel',
    ctaKey: 'subs.term.yearlyCta',
    noteKey: 'subs.term.yearlyNote',
    priceKey: 'paywall.plan.yearly.price',
    perKey: 'pro.v3.unit.year',
    renews: true,
    badgeKey: 'subs.term.yearlyBadge',
  },
  lifetime: {
    key: 'lifetime',
    nameKey: 'subs.term.lifetime',
    labelKey: 'subs.term.lifetimeLabel',
    ctaKey: 'subs.term.lifetimeCta',
    noteKey: 'subs.term.lifetimeNote',
    priceKey: 'pro.page.perLifetime',
    perKey: 'pro.v3.unit.lifetime',
    renews: false,
    badgeKey: 'pro.page.bestValue',
  },
};

export const SUBSCRIPTION_TERM_ORDER: SubscriptionTermKey[] = ['yearly', 'monthly', 'lifetime'];


/**
 * ── MOCK BILLING ─────────────────────────────────────────────────────────────
 *
 * Everything below this line is invented. It is here because the design calls
 * for a management screen that looks like a management screen, and because a
 * demo build is where you find out whether that screen reads right before you
 * have a store to plug into.
 *
 * Two properties keep it from becoming a lie that ships:
 *   1. It is reachable only while DEMO_BUILD is true (releaseReadiness guards).
 *   2. It is one export. Deleting `MOCK_BILLING` breaks compilation everywhere
 *      it is read, which is the point — no quiet survival into a real release.
 */
export interface MockPaymentMethod {
  id: string;
  titleKey: I18nKey;
  subKey: I18nKey;
  icon: 'card' | 'wallet';
}

export interface MockReceipt {
  /** ISO, so the screen formats it in the reader's language. */
  paidAt: string;
  priceKey: I18nKey;
  termKey: SubscriptionTermKey;
}

export const MOCK_BILLING = {
  /** The card every "Maksutapa" row shows. */
  methods: [
    { id: 'card', titleKey: 'subs.pay.card', subKey: 'subs.pay.cardSub', icon: 'card' },
    { id: 'gplay', titleKey: 'subs.pay.gplay', subKey: 'subs.pay.gplaySub', icon: 'wallet' },
  ] as MockPaymentMethod[],
  defaultMethodId: 'card',
  /** When the reader supposedly joined — the "Jäsenenä" row. */
  memberSince: '2025-08-15T00:00:00.000Z',
  /** The charge the term rows count from. */
  lastChargedAt: '2026-08-15T00:00:00.000Z',
  receipts: {
    yearly: [
      { paidAt: '2026-08-15T00:00:00.000Z', priceKey: 'paywall.plan.yearly.price', termKey: 'yearly' },
      { paidAt: '2025-08-15T00:00:00.000Z', priceKey: 'paywall.plan.yearly.price', termKey: 'yearly' },
    ],
    monthly: [
      { paidAt: '2026-08-15T00:00:00.000Z', priceKey: 'paywall.plan.monthly.price', termKey: 'monthly' },
      { paidAt: '2026-07-15T00:00:00.000Z', priceKey: 'paywall.plan.monthly.price', termKey: 'monthly' },
      { paidAt: '2026-06-15T00:00:00.000Z', priceKey: 'paywall.plan.monthly.price', termKey: 'monthly' },
    ],
    lifetime: [
      { paidAt: '2026-08-15T00:00:00.000Z', priceKey: 'pro.page.perLifetime', termKey: 'lifetime' },
    ],
  } as Record<SubscriptionTermKey, MockReceipt[]>,
} as const;

/**
 * The next charge date and the current period's end are counted, not written,
 * and they live in subscriptionTerm: the entitlement needs them too, and this
 * module hands ProEntitlement a type, so importing a value back would be a
 * runtime cycle. Re-exported because every caller imports them from here.
 */
export { currentPeriodEndAt, isSubscriptionTermKey, nextChargeAt } from './subscriptionTerm';

/** ── end mock billing ──────────────────────────────────────────────────────── */

export type SubscriptionState = 'active' | 'lapsed' | 'none';

export interface SubscriptionView {
  state: SubscriptionState;
  /** Which term the active card describes. Null unless active. */
  term: SubscriptionTermKey | null;
  /** True when the reader has cancelled but Pro is still running. */
  cancelled: boolean;
  /**
   * When Pro stops. For a promo or the trial this is the real expiry; for mock
   * billing it is the derived next-charge date, which is also when a cancelled
   * term lapses.
   */
  endsAt: string | null;
  /** When the next charge lands. Null when cancelled, lifetime, a grant, or not active. */
  nextChargeAt: string | null;
  /**
   * What Pro runs on when it is not a purchase: a promo code or the free
   * trial. Both are real grants on a real clock — nothing to manage, nothing to
   * cancel, and no billing rows may be shown even in a demo build, so the
   * screen must not dress either in an invented card and receipt history.
   * `lapsed` keeps the grant that ran out — an expired promo or an expired
   * trial are the lapses the app can prove. Null for a purchase and for never
   * subscribed.
   */
  grant: 'promo' | 'trial' | null;
}

/**
 * The screen's whole state, from the entitlement plus the two mock switches.
 *
 * `lapsed` is the one state that is genuinely knowable today: a promoProUntil
 * or a proTrialUntil in the past means this reader really did have Pro and
 * really did lose it. The app can say so without inventing anything, which is
 * why it gets its own state rather than collapsing into `none`. (A purchase
 * that ran out is not provable: the store clears its record.) The trial is the
 * common one — it lives in proTrialUntil, not promoProUntil, and a reader whose
 * 14 days were over was told "No active subscription" and sold Pro, not told
 * that their history is all here (bug hunt, 2026-10-09).
 */
export function resolveSubscriptionView(input: {
  entitlement: ProEntitlement;
  /** The reader's stored mock term. Ignored for promo-backed Pro. */
  mockTerm: SubscriptionTermKey;
  mockCancelled: boolean;
  /**
   * When this reader actually turned Pro on, ISO.
   *
   * The renewal date is counted from here plus the term's length. Falls back to
   * MOCK_BILLING's fixed instant only for a reader who had Pro before the field
   * existed — a real purchase always has one, and billing will fill exactly
   * this.
   */
  purchasedAt?: string | null;
  /** A promoProUntil that has already passed, if any. */
  lapsedPromoUntil?: string | null;
  /** A proTrialUntil that has already passed, if any. */
  lapsedTrialUntil?: string | null;
  now?: Date;
}): SubscriptionView {
  const {
    entitlement,
    mockTerm,
    mockCancelled,
    purchasedAt = null,
    lapsedPromoUntil = null,
    lapsedTrialUntil = null,
    now = new Date(),
  } = input;
  const chargedFrom = purchasedAt ?? MOCK_BILLING.lastChargedAt;

  if (entitlement.unlocked) {
    // A promo is real Pro on a real clock. It has no term, no card and no
    // receipts, and pretending otherwise would put invented billing on top of
    // a fact the reader can check against the code they redeemed.
    //
    // The trial is the same kind of fact. It used to fall through to the
    // purchase branch below, so a reader on day two of a free trial read
    // "Yearly · active", a next payment of 79,90 €, a Visa and a "member
    // since" — a subscription nobody had started, on the one screen they
    // would open to check.
    if (entitlement.source === 'promo' || entitlement.source === 'trial') {
      return {
        state: 'active',
        term: null,
        cancelled: false,
        endsAt: entitlement.promoUntil,
        nextChargeAt: null,
        grant: entitlement.source,
      };
    }

    // The end of the CURRENT period, rolled forward through renewals. One
    // period after the original purchase was months in the past for anyone
    // who had renewed, and that was the date the End membership page printed
    // as the day they keep it until.
    const charge = currentPeriodEndAt(mockTerm, chargedFrom, now);
    // A lifetime purchase cannot be cancelled (proEntitlement): a stamp left
    // by an older build is not a cancellation to show.
    const cancelled = mockCancelled && mockTerm !== 'lifetime';
    return {
      state: 'active',
      term: mockTerm,
      cancelled,
      endsAt: charge,
      nextChargeAt: cancelled ? null : charge,
      grant: null,
    };
  }

  // Whichever grant ran out last is the one that ended the reader's Pro.
  const promoTime = lapsedPromoUntil ? new Date(lapsedPromoUntil).getTime() : Number.NaN;
  const trialTime = lapsedTrialUntil ? new Date(lapsedTrialUntil).getTime() : Number.NaN;
  const trialLast = Number.isFinite(trialTime) && (!Number.isFinite(promoTime) || trialTime > promoTime);
  const lapsed = Number.isFinite(promoTime) || Number.isFinite(trialTime);

  return {
    state: lapsed ? 'lapsed' : 'none',
    term: null,
    cancelled: false,
    endsAt: !lapsed ? null : trialLast ? lapsedTrialUntil : lapsedPromoUntil,
    nextChargeAt: null,
    grant: !lapsed ? null : trialLast ? 'trial' : 'promo',
  };
}

/**
 * Whether the billing rows may render at all.
 *
 * Three things have to be true together: the reader has Pro, it came from a
 * purchase rather than a promo or the trial, and this is a demo build. The
 * last one is the release valve — clearing extra.demoBuild takes every
 * invented card and receipt off the screen in one move rather than requiring
 * a screen edit.
 */
export function showsMockBilling(view: SubscriptionView, demoBuild: boolean): boolean {
  return demoBuild && view.state === 'active' && view.grant === null;
}
