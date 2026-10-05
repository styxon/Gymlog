import { withoutOwedCoachLog } from './aiLogDeletion';
import { currentPeriodEndAt } from './subscriptionTerm';
import { AppPreferences } from '../types/models';

/**
 * One place decides whether the user has Pro, and it grants it from exactly
 * three things: the trial, a recorded purchase, and a promo grant that is
 * still running.
 *
 * The promo grant can no longer be made from inside the app. The codes were a
 * list in the bundle (user 2026-09-15: "promokoodit nyt pois"): anyone who
 * unpacked the APK could read them and redeem without limit, and the screen
 * that took them is gone. The field stays readable so a code redeemed before
 * that keeps what it promised until its own date — after which nothing writes
 * it again until Play's own promo codes, which are checked by Play.
 *
 * There used to be a third — a "premium preview" switch the Pro page's CTA
 * flipped, with a button underneath to flip it back. That is not a paywall,
 * it is a light switch: Pro could be turned on and off for free, from inside
 * the app, as often as you liked. It also never ended, so a cancelled
 * membership kept every feature forever and a "monthly" purchase renewed
 * itself for eternity. All three are gone (user 2026-09-03: "blokataan kaikki
 * suunnat mistä pro-ominaisuudet saa kytkettyä päälle ilman ostoa").
 *
 * The purchase is simulated — there is no billing account to take money yet —
 * but it is simulated the whole way: it records the instant and the term, it
 * renews on its own, cancelling runs it to the end of the period the reader
 * paid for, and then it stops. The only thing the demo build cannot do is
 * charge, which is why extra.demoBuild gates the invented card and receipt
 * (see subscriptionView.showsMockBilling) and releaseReadiness fails if that
 * flag disappears while no billing library is installed.
 */
export interface ProEntitlement {
  unlocked: boolean;
  /** Why it is unlocked, so a screen can be truthful about it. */
  source: 'promo' | 'trial' | 'purchase' | null;
  /** ISO date the promo runs out; null when Pro is not promo-based. */
  promoUntil: string | null;
  /**
   * ISO date a cancelled purchase stops working. Null while it is still
   * renewing, for lifetime, and when Pro is not purchase-based — "End
   * membership on {date}" is this value, not a date written into copy.
   */
  purchaseEndsAt: string | null;
}

type ProPreferences = Pick<
  AppPreferences,
  | 'promoProUntil'
  | 'proTrialUntil'
  | 'mockSubscriptionPurchasedAt'
  | 'mockSubscriptionTerm'
  | 'mockSubscriptionCancelledAt'
>;

const NOT_UNLOCKED: ProEntitlement = { unlocked: false, source: null, promoUntil: null, purchaseEndsAt: null };

export function resolveProEntitlement(
  preferences: ProPreferences,
  now: Date = new Date(),
): ProEntitlement {
  const promoUntil = preferences.promoProUntil;
  const promoTime = promoUntil ? new Date(promoUntil).getTime() : Number.NaN;
  if (Number.isFinite(promoTime) && promoTime > now.getTime()) {
    return { unlocked: true, source: 'promo', promoUntil, purchaseEndsAt: null };
  }

  // The trial, which unlocks exactly like a promo and expires on its own. Kept
  // as its own field so a warning about a trial ending is never sent to
  // somebody who redeemed a code.
  const trialUntil = preferences.proTrialUntil;
  const trialTime = trialUntil ? new Date(trialUntil).getTime() : Number.NaN;
  if (Number.isFinite(trialTime) && trialTime > now.getTime()) {
    return { unlocked: true, source: 'trial', promoUntil: trialUntil, purchaseEndsAt: null };
  }

  return resolvePurchaseEntitlement(preferences, now);
}

/**
 * The purchase alone, whatever promo or trial runs beside it. Resume asks this
 * one: a trial checked first hid a paid, cancelled-but-running subscription,
 * and Resume sent its payer to the paywall to buy it again (bug hunt,
 * 2026-10-05).
 */
function resolvePurchaseEntitlement(preferences: ProPreferences, now: Date): ProEntitlement {
  const purchasedAt = preferences.mockSubscriptionPurchasedAt;
  if (!purchasedAt || Number.isNaN(new Date(purchasedAt).getTime())) {
    return NOT_UNLOCKED;
  }

  const purchased = { unlocked: true, source: 'purchase' as const, promoUntil: null };
  const cancelledAt = preferences.mockSubscriptionCancelledAt;
  if (!cancelledAt || Number.isNaN(new Date(cancelledAt).getTime())) {
    // Still renewing, so there is no end to name.
    return { ...purchased, purchaseEndsAt: null };
  }

  // Lifetime is one payment with nothing running to stop. It read as "no
  // period left", so a cancellation took it away at once — a lifetime holder
  // lost Pro on one tap of End membership (bug hunt, 2026-10-05). What ends a
  // lifetime purchase is a refund, which the store reports, not this field.
  if (preferences.mockSubscriptionTerm === 'lifetime') {
    return { ...purchased, purchaseEndsAt: null };
  }

  // Cancelled. The period it runs to is the one it was cancelled IN —
  // measured from the cancellation, not from now, or the subscription
  // would keep renewing after it was cancelled.
  const endsAt = currentPeriodEndAt(
    preferences.mockSubscriptionTerm,
    purchasedAt,
    new Date(cancelledAt),
  );
  if (endsAt === null) {
    return NOT_UNLOCKED;
  }
  if (new Date(endsAt).getTime() <= now.getTime()) {
    return NOT_UNLOCKED;
  }
  return { ...purchased, purchaseEndsAt: endsAt };
}

export function isProUnlocked(preferences: ProPreferences, now: Date = new Date()) {
  return resolveProEntitlement(preferences, now).unlocked;
}

/**
 * May the reader take a cancelled subscription back?
 *
 * Only while the period they paid for is still running — which is what
 * resuming means, and what real billing allows. Once it has lapsed there is
 * nothing to resume: coming back is a purchase, and it has to go through the
 * page that sells one.
 *
 * Without this, Resume was a free Pro button. It cleared the cancellation, and
 * a purchase with no cancellation never ends, so a subscription that ran out
 * months ago came back permanently.
 */
export function canResumePurchase(preferences: ProPreferences, now: Date = new Date()): boolean {
  return resolvePurchaseEntitlement(preferences, now).source === 'purchase';
}

type ProgressionPreferences = ProPreferences &
  Pick<AppPreferences, 'automatedProgressionEnabled' | 'setupLevel'> &
  Partial<Pick<AppPreferences, 'setupCautionFlags'>>;

/**
 * Automated progression is a Pro feature (user decision 2026-07-28: the
 * post-onboarding paywall sells it, so the gate has to be real). This is the
 * one place that combines the user's toggle with the entitlement — every
 * startWorkout/startCustomWorkout call site goes through here, so no screen
 * can accidentally hand a free user a paid prefill or a Pro user a dead
 * toggle. The toggle itself stays the user's choice: Pro OFF still means OFF.
 */
export function resolveProgressionOptions(
  preferences: ProgressionPreferences,
  now: Date = new Date(),
): {
  automatedProgressionEnabled: boolean;
  setupLevel: AppPreferences['setupLevel'];
  cautionFlags: AppPreferences['setupCautionFlags'];
} {
  return {
    automatedProgressionEnabled:
      preferences.automatedProgressionEnabled && isProUnlocked(preferences, now),
    setupLevel: preferences.setupLevel,
    // Rides along with the gate it limits: a lift that loads a flagged area
    // is never raised, which is what onboarding tells the reader.
    cautionFlags: preferences.setupCautionFlags ?? [],
  };
}

/**
 * The onboarding paywall's free trial.
 *
 * It grants Pro the same way a promo code does — a stretch of days from this
 * moment, expiring on its own — rather than being a button that only navigates.
 * That is what makes "Start 7 days free" a true sentence: the seven days are
 * real and the features really unlock. What the screen still cannot deliver is
 * the sentence after it ("then 79,90 € / year"): there is no billing to charge
 * anyone, which is why that copy lives behind the demo-build guard.
 */
export const PRO_TRIAL_DAYS = 14;

/**
 * ON since 2026-09-09, at the user's decision, and at fourteen days.
 *
 * It was off while the free tier was walked end to end: a trial makes every
 * new account a Pro account, and nobody could see the locks. That walk is
 * done, and the hand-off screen now offers the trial in words ("14 days free,
 * and we tell you when two days are left"), so the days have to be real.
 *
 * What this flag does NOT buy is the sentence after it. There is no billing,
 * so nothing charges anyone when the fourteen days run out — Pro simply
 * lapses. Any copy that promises a charge stays behind the demo-build guard
 * until Play Billing exists.
 *
 * The consequence to keep in mind: a fresh install no longer sees the free
 * tier for two weeks. That is the point of a trial, and it is also why this
 * was off.
 */
export const PRO_TRIAL_ENABLED = true;

/**
 * Whether this install may still start the trial.
 *
 * Once. The CTA used to mint fourteen fresh days on every press, which made
 * the trial a subscription nobody paid for. Play Billing grants one per
 * account; until then it is one per install, marked by `proTrialStartedAt`.
 */
export function canStartProTrial(preferences: Pick<AppPreferences, 'proTrialStartedAt'>): boolean {
  return PRO_TRIAL_ENABLED && preferences.proTrialStartedAt === null;
}

/**
 * The fields that decide what Pro and the free tier hand out, and are
 * therefore not taken from a backup.
 *
 * The backup endpoint stores whatever a signed-in caller uploads and checks
 * its size, not its contents, so a payload with a promo date far in the
 * future was a permanent Pro for the price of one PUT — and one with an empty
 * `coachDemoMomentsUsed` was three more free model calls, as often as wanted.
 * A restore keeps the device's own entitlement and meters and takes
 * everything else. With Play Billing the store answers the Pro question
 * anyway; the meters are per install by definition.
 *
 * One more field rides here for the same reason: `pendingAiLogDeletions`, the
 * coach-log deletes this install still owes (lib/aiLogDeletion). It is this
 * phone's errand — a restore must not replace it with another phone's list or
 * an empty one, and a reset, which keeps this whole list, must not drop it.
 *
 * And `seenServerNoticeIds`, the server notices this phone's reader has
 * closed: a restore or a reset that blanked it showed a closed notice again.
 */
export const DEVICE_ONLY_PREFERENCE_FIELDS = [
  'promoProUntil',
  'proTrialUntil',
  'proTrialStartedAt',
  'mockSubscriptionPurchasedAt',
  'mockSubscriptionTerm',
  'mockSubscriptionCancelledAt',
  'aiCoachProQuota',
  'coachDemoMomentsUsed',
  'firstLaunchAt',
  'pendingAiLogDeletions',
  'seenServerNoticeIds',
] as const;

export function keepDeviceEntitlement<
  T extends Pick<
    AppPreferences,
    | (typeof DEVICE_ONLY_PREFERENCE_FIELDS)[number]
    | 'aiLogId'
    | 'aiLogChatConsent'
    | 'aiLogComposerConsent'
    | 'aiLogPhotoConsent'
  >,
>(
  restored: T,
  device: Pick<AppPreferences, (typeof DEVICE_ONLY_PREFERENCE_FIELDS)[number]>,
): T {
  const kept = { ...restored };
  for (const field of DEVICE_ONLY_PREFERENCE_FIELDS) {
    (kept as Record<string, unknown>)[field] = device[field];
  }
  // And the one thing the device's list says about the rest: a label this
  // phone owes a delete for is not handed back to the coach by a backup.
  return withoutOwedCoachLog(kept);
}

/** The date Pro should run until, or null when the trial is switched off. */
export function resolveTrialProUntil(now: Date = new Date()): string | null {
  if (!PRO_TRIAL_ENABLED) {
    return null;
  }
  const until = new Date(now.getTime());
  until.setDate(until.getDate() + PRO_TRIAL_DAYS);
  return until.toISOString();
}
