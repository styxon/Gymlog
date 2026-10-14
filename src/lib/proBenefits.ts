import { FREE_ACTIVE_PROGRAM_CAP, PRO_ACTIVE_PROGRAM_CAP } from './activeProgramSet';
import { PRO_COACH_QUESTIONS_PER_MONTH } from './aiCoachQuota';
import { FREE_TREND_MONTHS } from './historyWindow';
import { I18nKey } from './i18n';
import { FREE_CUSTOM_PROGRAM_LIMIT } from './programSlots';

/**
 * What Pro actually gives you today — the live half of the Pro page.
 *
 * This exists so the "what you lose" screen cannot invent a loss. Every entry
 * here is a benefit the code really gates: strike through something the app
 * never enforced and the screen becomes a threat about nothing, which is worse
 * than not showing it at all. Items the Pro page marks SOON are deliberately
 * absent — you cannot lose what you never had.
 *
 * The keys are the Pro page's own, and tests/lib/proBenefits pins every one of
 * them to a GROUPS entry with no `soon` flag. When a SOON feature ships, add it
 * in both places; when a gate is removed, this list has to shrink with it.
 */
export interface ProBenefit {
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /** The module that enforces it, so the claim can be checked against code. */
  gate: string;
}

export const PRO_LIVE_BENEFITS: ProBenefit[] = [
  {
    titleKey: 'pro.v2.coach.progression.t',
    bodyKey: 'pro.v2.coach.progression.b',
    gate: 'resolveProgressionOptions',
  },
  {
    // Same gate as the increase, deliberately: the hold IS automated
    // progression, deciding not to move. Two gates for one decision would be
    // two places to drift.
    titleKey: 'pro.v2.coach.session.t',
    bodyKey: 'pro.v2.coach.session.b',
    gate: 'resolveProgressionOptions',
  },
  { titleKey: 'pro.v2.plan.coach.t', bodyKey: 'pro.v2.plan.coach.b', gate: 'aiCoachQuota' },
  { titleKey: 'pro.v2.plan.builder.t', bodyKey: 'pro.v2.plan.builder.b', gate: 'coachProUnlocked' },
  { titleKey: 'pro.v2.plan.programs.t', bodyKey: 'pro.v2.plan.programs.b', gate: 'resolveActiveProgramCap' },
  { titleKey: 'pro.v2.read.analysis.t', bodyKey: 'pro.v2.read.analysis.b', gate: 'coachProUnlocked' },
  { titleKey: 'pro.v2.read.why.t', bodyKey: 'pro.v2.read.why.b', gate: 'proInsights' },
  { titleKey: 'pro.v2.read.records.t', bodyKey: 'pro.v2.read.records.b', gate: 'isRecordLocked' },
  { titleKey: 'pro.v2.read.setlog.t', bodyKey: 'pro.v2.read.setlog.b', gate: 'isSetLogLocked' },
  { titleKey: 'pro.v2.read.recovery.t', bodyKey: 'pro.v2.read.recovery.b', gate: 'proInsights' },
  // The dark theme was here until 2026-08-23, gated by resolveThemeName. It
  // is free now and that function no longer reads the entitlement, so the
  // claim had nothing enforcing it — a benefit whose gate is gone is a
  // promise the paywall cannot keep.
];

/**
 * The unlock moment's cards, defined next to the list they announce.
 *
 * The unlock screen used to carry its own parallel card list, and that is how
 * it kept selling the adaptive set coach for a day after the feature was
 * deleted — the removal sweep cleaned every surface that read from here and
 * missed the one that did not. Each card names the benefits it covers, and the
 * test asserts the union of `gates` equals PRO_LIVE_BENEFITS exactly: remove a
 * benefit and the card announcing it fails loudly instead of lying quietly.
 */
export interface ProUnlockCard {
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /** Where the feature lives, so "what happens next" answers itself. */
  placeKey: I18nKey;
  /**
   * The free-tier limit, struck through, and what replaced it.
   *
   * The old screen listed what Pro has. This states the *difference*, which is
   * the only thing a reader who just paid is actually asking about — and it is
   * checkable: every `was` is a number the code enforces, interpolated from
   * the constant rather than typed.
   */
  wasKey: I18nKey;
  nowKey: I18nKey;
  /** titleKeys of the PRO_LIVE_BENEFITS entries this card announces. */
  gates: I18nKey[];
}

export const PRO_UNLOCK_CARDS: ProUnlockCard[] = [
  {
    titleKey: 'unlock.ai.t',
    bodyKey: 'unlock.ai.b',
    placeKey: 'unlock.ai.to',
    wasKey: 'unlock.ai.was',
    nowKey: 'unlock.ai.now',
    gates: ['pro.v2.plan.coach.t', 'pro.v2.plan.builder.t'],
  },
  {
    titleKey: 'unlock.progression.t',
    bodyKey: 'unlock.progression.b',
    placeKey: 'unlock.progression.to',
    wasKey: 'unlock.progression.was',
    nowKey: 'unlock.progression.now',
    gates: ['pro.v2.coach.progression.t', 'pro.v2.coach.session.t'],
  },
  {
    titleKey: 'unlock.reads.t',
    bodyKey: 'unlock.reads.b',
    placeKey: 'unlock.reads.to',
    wasKey: 'unlock.reads.was',
    nowKey: 'unlock.reads.now',
    gates: ['pro.v2.read.analysis.t', 'pro.v2.read.why.t', 'pro.v2.read.recovery.t'],
  },
  {
    // Split out of the reads card, because the window is a different promise
    // from the reading: the charts and records were narrowed, the reads were
    // shut. One row cannot strike through two different limits.
    titleKey: 'unlock.history.t',
    bodyKey: 'unlock.history.b',
    placeKey: 'unlock.history.to',
    wasKey: 'unlock.history.was',
    nowKey: 'unlock.history.now',
    gates: ['pro.v2.read.records.t', 'pro.v2.read.setlog.t'],
  },
  {
    titleKey: 'unlock.programs.t',
    bodyKey: 'unlock.programs.b',
    placeKey: 'unlock.programs.to',
    wasKey: 'unlock.programs.was',
    nowKey: 'unlock.programs.now',
    gates: ['pro.v2.plan.programs.t'],
  },
  // No theme card: the unlock screen announces what just changed, and since
  // 2026-08-23 the theme did not — it was already the reader's to pick.
];

/**
 * How Pro is being kept on, which decides what "ending it" can honestly offer.
 *
 * A promo cannot be cancelled — it runs out. The demo switch can be flipped
 * back. A paid subscription would be neither: it lives in the store. Modelling
 * this as one enum keeps the screen from offering a button that does nothing.
 */
/**
 * The numbers behind the struck-through limits, from the modules that enforce
 * them. A limit typed into copy is a limit that drifts the day someone changes
 * the gate.
 *
 * Shared rather than owned by the unlock screen, because two screens now read
 * the same pairs in opposite directions: the unlock screen says "3 questions a
 * week → Unlimited", and the end-membership page says "Unlimited → 3 questions
 * a week". One map means the arrow can reverse but the numbers cannot disagree.
 */
export const PRO_UNLOCK_LIMIT_VARS: Record<string, Record<string, string | number>> = {
  'unlock.ai.now': { count: PRO_COACH_QUESTIONS_PER_MONTH },
  'unlock.ai.b': { count: PRO_COACH_QUESTIONS_PER_MONTH },
  'unlock.history.was': { months: FREE_TREND_MONTHS },
  'unlock.programs.was': { active: FREE_ACTIVE_PROGRAM_CAP, own: FREE_CUSTOM_PROGRAM_LIMIT },
  'unlock.programs.now': { proActive: PRO_ACTIVE_PROGRAM_CAP },
  'unlock.programs.t': { proActive: PRO_ACTIVE_PROGRAM_CAP },
  'unlock.programs.b': { active: FREE_ACTIVE_PROGRAM_CAP, proActive: PRO_ACTIVE_PROGRAM_CAP },
};

export type MembershipSource = 'promo' | 'trial' | 'purchase' | 'review' | 'none';

export interface MembershipEndPlan {
  /** True when the user can end Pro from inside the app, right now. */
  canEndNow: boolean;
  /** ISO date it lapses on its own; null when nothing is scheduled. */
  lapsesOn: string | null;
}

/**
 * What ending a membership can actually do, per source.
 *
 * A promo runs to its own date and cannot be handed back early — there is
 * nothing to cancel, only a code that expires. A purchase can be cancelled,
 * and then it runs to the end of the period already paid for: `lapsesOn` is
 * that date, which is what "You keep all of it until then" means. It used to
 * say `canEndNow: true, lapsesOn: null` for the demo switch, which was honest
 * about a light switch and would have been a lie about a purchase.
 */
export function resolveMembershipEndPlan(
  source: MembershipSource,
  promoUntil: string | null,
  periodEndsAt: string | null = null,
): MembershipEndPlan {
  // A trial is a promo with a different name on it: a stretch of days that
  // runs out on its own, with nothing to cancel and nothing to hand back.
  if (source === 'promo' || source === 'trial') {
    return { canEndNow: false, lapsesOn: promoUntil };
  }
  if (source === 'purchase') {
    return { canEndNow: true, lapsesOn: periodEndsAt };
  }
  // The review account has nothing to end: it goes when the account signs out.
  return { canEndNow: false, lapsesOn: null };
}
