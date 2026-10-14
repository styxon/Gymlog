import { FREE_TREND_MONTHS } from './historyWindow';
import { I18nKey } from './i18n';
import { FREE_CUSTOM_PROGRAM_LIMIT } from './programSlots';
import { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';

/**
 * What each tier is sold as (design: "Vinha Pro v6 — kolme tasoa").
 *
 * The v6 page is one screen with a three-way switcher, so all three tiers are
 * on the same surface and a reader can flip between them in a second. That is
 * exactly why the copy has to be checkable: a claim that only appears on one
 * tab used to be a claim nobody compared against the others.
 *
 * Every row carries a `proof` — the identifier in `src/` that makes the row
 * true. For a Pro row that is the gate enforcing it; for a Free row it is the
 * constant or module that delivers it. `tests/lib/proTiers` asserts each one
 * exists, which is the same discipline PRO_LIVE_BENEFITS already applies to
 * the what-you-lose list, for the same reason: the paywall is the one screen
 * where a stale sentence costs money rather than confusing someone.
 *
 * Three rows from the reference design are deliberately absent, and it is
 * worth saying why here rather than in a commit nobody re-reads:
 *
 * - "Tumma teema ja widgetit" sat on the Pro tab. Both are free — the theme
 *   since 2026-08-23, the widget always. proBenefits.ts already carries the
 *   note this repeats: a benefit whose gate is gone is a promise the paywall
 *   cannot keep.
 * - "Varmuuskopio kaikille laitteille" sat on the Pro tab too. Cloud backup is
 *   not entitlement-gated anywhere in the code, and proBenefits.test.cjs fails
 *   the build if backup is ever sold as a live benefit.
 * - The Free tab gained the ready catalogue, which the design left out. It is
 *   the largest thing the free tier gives away and no competitor matches it.
 */

/** Every ready programme is free in both tiers — see programSlots.ts. */
export const READY_PROGRAM_COUNT = WORKOUT_TEMPLATES_V1.length;

export type ProTierKey = 'free' | 'pro' | 'life';

/** Plan ids the CTA can buy. 'free' buys nothing and dismisses the page. */
export type ProPlanId = 'free' | 'monthly' | 'yearly' | 'lifetime';

export interface ProTierRow {
  key: string;
  /** Glyph name in the screen's own icon table. */
  icon: string;
  titleKey: I18nKey;
  bodyKey?: I18nKey;
  vars?: Record<string, string | number>;
  /**
   * The identifier in src/ that makes this row true — a gate for a Pro row, a
   * constant or module for a free one. Checked by the suite, never rendered.
   */
  proof: string;
}

export interface ProTierPlan {
  id: ProPlanId;
  nameKey: I18nKey;
  priceKey: I18nKey;
  unitKey: I18nKey;
  subKey?: I18nKey;
  badgeKey?: I18nKey;
  /**
   * The line under the CTA. It belongs to the PLAN, not the tier: a monthly
   * buyer reading a yearly renewal price is the exact mistake this shape
   * prevents, and the terms genuinely differ per plan.
   *
   * Absent on Free, and deliberately: there are no terms to state when nothing
   * is being sold, and the line that used to sit there ("no card and no trial
   * period") was answering a question the 0 € tile has already answered.
   */
  fineKey?: I18nKey;
  /** Used only while PRO_TRIAL_ENABLED — the "then …" wording. */
  trialFineKey?: I18nKey;
}

export interface ProTier {
  key: ProTierKey;
  tabKey: I18nKey;
  /** Pill beside the wordmark. Free wears none — it is the default state. */
  badgeKey: I18nKey | null;
  headKey: I18nKey;
  rows: ProTierRow[];
  plans: ProTierPlan[];
  ctaKey: I18nKey;
  /** Used only while PRO_TRIAL_ENABLED, on tiers a trial can apply to. */
  trialCtaKey?: I18nKey;
}

export const PRO_TIER_ORDER: ProTierKey[] = ['free', 'pro', 'life'];

export const PRO_TIERS: Record<ProTierKey, ProTier> = {
  free: {
    key: 'free',
    tabKey: 'pro.v6.tab.free',
    badgeKey: null,
    headKey: 'pro.v6.free.head',
    rows: [
      // Titles only: the Free tab is a list a reader scans in two seconds.
      {
        key: 'logging',
        icon: 'lines',
        titleKey: 'pro.v6.free.logging.t',
        // Nothing gates the log. The proof is the module that would have to
        // start reading entitlement for that to stop being true.
        proof: 'isTrendRangeLocked',
      },
      {
        // The title says a literal "50+"; READY_PROGRAM_COUNT >= 50 is pinned
        // by tests/lib/proTiers.
        key: 'ready',
        icon: 'grid',
        titleKey: 'pro.v6.free.ready.t',
        proof: 'WORKOUT_TEMPLATES_V1',
      },
      {
        key: 'own',
        icon: 'pencil',
        titleKey: 'pro.v6.free.own.t',
        vars: { cap: FREE_CUSTOM_PROGRAM_LIMIT },
        proof: 'FREE_CUSTOM_PROGRAM_LIMIT',
      },
      {
        key: 'history',
        icon: 'clock',
        titleKey: 'pro.v6.free.history.t',
        vars: { months: FREE_TREND_MONTHS },
        proof: 'FREE_TREND_MONTHS',
      },
      {
        // Three real answers at moments the app picks, which is what
        // coachDemoMoments delivers.
        key: 'coach',
        icon: 'spark',
        titleKey: 'pro.v6.free.coach.t',
        proof: 'resolveDueCoachDemoMoment',
      },
      {
        key: 'offline',
        icon: 'moon',
        titleKey: 'pro.v6.free.offline.t',
        proof: 'resolveLiveAiCoachUrl',
      },
      {
        key: 'yours',
        icon: 'lock',
        titleKey: 'pro.v6.free.yours.t',
        proof: 'WORKOUT_LOG_CSV_HEADER',
      },
      {
        key: 'noads',
        icon: 'check',
        titleKey: 'pro.v6.free.noads.t',
        // No ad SDK exists; the ungated log is the nearest thing to prove.
        proof: 'isTrendRangeLocked',
      },
    ],
    plans: [
      {
        id: 'free',
        nameKey: 'pro.v6.plan.always',
        priceKey: 'pro.v6.price.free',
        unitKey: 'pro.v6.unit.forever',
        badgeKey: 'pro.v6.badge.free',
      },
    ],
    ctaKey: 'pro.v6.cta.free',
  },
  pro: {
    key: 'pro',
    tabKey: 'pro.v6.tab.pro',
    badgeKey: 'pro.v6.badge.pro',
    headKey: 'pro.v6.pro.head',
    rows: [
      {
        key: 'coach',
        icon: 'spark',
        titleKey: 'pro.v6.pro.coach.t',
        bodyKey: 'pro.v6.pro.coach.b',
        proof: 'resolveCoachQuota',
      },
      {
        key: 'progression',
        icon: 'arrow',
        titleKey: 'pro.v6.pro.progression.t',
        bodyKey: 'pro.v6.pro.progression.b',
        proof: 'resolveProgressionOptions',
      },
      {
        key: 'programs',
        icon: 'grid',
        titleKey: 'pro.v6.pro.programs.t',
        proof: 'resolveProgramSlots',
      },
      {
        key: 'history',
        icon: 'clock',
        titleKey: 'pro.v6.pro.history.t',
        proof: 'isRecordLocked',
      },
      {
        // Replaces the design's "Varmuuskopio", which is not gated at all.
        key: 'analysis',
        icon: 'quill',
        titleKey: 'pro.v6.pro.analysis.t',
        proof: 'buildSessionAnalysis',
      },
      {
        key: 'allfree',
        icon: 'check',
        titleKey: 'pro.v6.pro.allfree.t',
        proof: 'resolveProEntitlement',
      },
    ],
    // One price set for the whole app: these are the same keys the v4 page
    // read, which is what keeps a figure from being typed into a second place
    // and drifting. proSurfaces pins "no price outside the dictionary".
    plans: [
      {
        id: 'monthly',
        nameKey: 'pro.page.monthly',
        priceKey: 'paywall.plan.monthly.price',
        unitKey: 'pro.v3.unit.month',
        fineKey: 'pro.v3.fine.recurring',
        trialFineKey: 'pro.v2.ctaSubMonthly',
      },
      {
        id: 'yearly',
        nameKey: 'pro.page.yearly',
        priceKey: 'paywall.plan.yearly.price',
        unitKey: 'pro.v3.unit.year',
        subKey: 'pro.v6.sub.yearly',
        badgeKey: 'pro.page.save',
        fineKey: 'pro.v3.fine.recurring',
        trialFineKey: 'pro.v2.ctaSubYearly',
      },
    ],
    ctaKey: 'pro.v6.cta.pro',
    trialCtaKey: 'pro.v2.cta',
  },
  life: {
    key: 'life',
    tabKey: 'pro.v6.tab.life',
    badgeKey: 'pro.v6.badge.life',
    headKey: 'pro.v6.life.head',
    rows: [
      {
        key: 'all',
        icon: 'check',
        titleKey: 'pro.v6.life.all.t',
        proof: 'resolveProEntitlement',
      },
      {
        key: 'norenew',
        icon: 'infin',
        titleKey: 'pro.v6.life.norenew.t',
        proof: 'resolveNextRenewal',
      },
      {
        key: 'future',
        icon: 'arrow',
        titleKey: 'pro.v6.life.future.t',
        proof: 'resolveProEntitlement',
      },
      {
        key: 'support',
        icon: 'heart',
        titleKey: 'pro.v6.life.support.t',
        proof: 'SUBSCRIPTION_TERM_ORDER',
      },
    ],
    plans: [
      {
        id: 'lifetime',
        nameKey: 'pro.v6.plan.once',
        priceKey: 'pro.page.perLifetime',
        unitKey: 'pro.v3.unit.lifetime',
        subKey: 'pro.v6.sub.lifetime',
        fineKey: 'pro.v3.fine.lifetime',
        trialFineKey: 'pro.v2.ctaSubLifetime',
      },
    ],
    ctaKey: 'pro.v6.cta.life',
  },
};

/**
 * The fine print under the CTA for the plan the reader has selected.
 *
 * Pro is the only tier whose terms differ by plan, and getting this wrong is
 * how a monthly buyer reads a yearly renewal price. Falls back to the tier's
 * first plan rather than to an empty string: no fine print at all under a
 * subscription CTA is the one output that must never happen.
 */
export function resolveTierFineKey(
  tier: ProTier,
  planId: ProPlanId,
  trialEnabled: boolean,
): I18nKey | null {
  const plan = tier.plans.find((entry) => entry.id === planId) ?? tier.plans[0];
  if (trialEnabled && plan.trialFineKey) {
    return plan.trialFineKey;
  }
  return plan.fineKey ?? null;
}

/**
 * The CTA label. While the trial is switched off, a tier that would have sold
 * "start 7 days free" sells the term instead — the flat CTA is not a fallback
 * for a missing string, it is the honest button when there is no trial to
 * start. See PRO_TRIAL_ENABLED for why the switch exists at all.
 */
export function resolveTierCtaKey(tier: ProTier, trialEnabled: boolean): I18nKey {
  return trialEnabled && tier.trialCtaKey ? tier.trialCtaKey : tier.ctaKey;
}

/** The plan a tab opens on: the year for Pro, the only one everywhere else. */
export function defaultPlanForTier(key: ProTierKey): ProPlanId {
  const tier = PRO_TIERS[key];
  const yearly = tier.plans.find((plan) => plan.id === 'yearly');
  return yearly ? yearly.id : tier.plans[0].id;
}
