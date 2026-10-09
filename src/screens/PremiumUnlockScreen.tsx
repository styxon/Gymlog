import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { isStoreBillingConfigured } from '../features/billing/storeBilling';
import { paymentsAreLive } from '../lib/billingCopy';
import { isDemoBuild } from '../lib/demoMode';
import { formatDate, formatTime } from '../lib/format';
import { countWord } from '../lib/countWord';
import { CutSurface } from '../components/CutSurface';
import { I18nKey, t } from '../lib/i18n';
import { PRO_UNLOCK_CARDS, PRO_UNLOCK_LIMIT_VARS } from '../lib/proBenefits';
import { PRO_TRIAL_DAYS } from '../lib/proEntitlement';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';

const IC: Record<string, { path: string; filled?: boolean }> = {
  'unlock.ai.t': { path: 'M12 2.5l2.1 5.6L19.5 10l-5.4 1.9L12 17.5l-2.1-5.6L4.5 10l5.4-1.9z', filled: true },
  'unlock.progression.t': { path: 'M7 17L17 7M9 7h8v8' },
  'unlock.reads.t': { path: 'M4 7h16M4 12h11M4 17h7' },
  'unlock.history.t': { path: 'M12 7v5l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  'unlock.programs.t': { path: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
};

const RECEIPT: Record<string, { nameKey: I18nKey; priceKey: I18nKey; unitKey: I18nKey }> = {
  monthly: {
    nameKey: 'unlock.receipt.monthly',
    priceKey: 'paywall.plan.monthly.price',
    unitKey: 'pro.v3.unit.month',
  },
  yearly: {
    nameKey: 'unlock.receipt.yearly',
    priceKey: 'paywall.plan.yearly.price',
    unitKey: 'pro.v3.unit.year',
  },
  lifetime: {
    nameKey: 'unlock.receipt.lifetime',
    priceKey: 'pro.page.perLifetime',
    unitKey: 'pro.v3.unit.lifetime',
  },
};

/**
 * What happens the moment Pro turns on (design: "Vinha Pro — oston jälkeen").
 *
 * Two earlier versions are worth remembering. The first opened with a
 * 2.2-second splash whose centrepiece was a next-load pill — a feature deleted
 * the day before — and ended in two buttons that were the same navigation
 * wearing different clothes. The second listed what Pro has.
 *
 * This one states the *difference*. Every row sets the free limit in grey and
 * what replaced it in violet, which is the app's state colour (design
 * 2026-09-02: no gold, no green — one filled action in the accent). That is
 * the only thing a reader who just paid is actually asking, and unlike a
 * feature list it is checkable: every old value is interpolated from the
 * constant that enforced it, so the screen cannot claim a limit the app never
 * had.
 *
 * The rows come from PRO_UNLOCK_CARDS, whose `gates` must partition
 * PRO_LIVE_BENEFITS exactly (proBenefits.test.cjs). That is what stops this
 * screen outliving a feature, which is exactly how version one broke.
 *
 * Themed rather than dark-only (design offered both). The original reason was
 * a theme row on this screen: announcing "dark is now available" on an
 * already-dark screen read as "it is on". That row is gone — dark stopped
 * being a perk on 2026-08-23 — but staying themed is still right, because a
 * screen that ignores the theme the reader just picked is the same lie in
 * reverse. Forcing dark is one line; going back would be a rewrite.
 */
interface PremiumUnlockScreenProps {
  language?: AppLanguage;
  onDone: () => void;
  /**
   * The coach's read of the user's own log; null when there is no data. The
   * card simply does not render without it — no invented specimen.
   */
  coachSpecimen?: string | null;
  /**
   * Which package the reader chose on the paywall. Carried on the route rather
   * than inferred, because nothing else in the app knows: there is no billing
   * to ask.
   */
  plan?: 'monthly' | 'yearly' | 'lifetime';
  /** Opens the full analysis behind the specimen. */
  onOpenAnalysis?: () => void;
  /** Opens subscription management from the receipt. */
  onManageSubscription?: () => void;
  /** The quiet link under the action: the full Pro page, for the curious. */
  onSeeEverything?: () => void;
  /**
   * When Pro went live, ISO — the purchase instant when there is one. The
   * state badge names the moment ("Pro · live since 18.52") because a state
   * with a time is checkable; a bare "Pro on" is a claim.
   */
  liveSince?: string | null;
  /**
   * When this package renews, ISO — counted from the purchase instant plus the
   * term's length (lib/subscriptionView), never written. Null for lifetime,
   * and null when there is no purchase record to count from.
   *
   * The design asked for "Renews 15.9.2026" and #bugs locked the requirement
   * that the date be *derived*: a hardcoded one is a lie the reader can check
   * against a calendar. This is that requirement met as far as it can be
   * without billing — the arithmetic is real and the caveat below still says
   * no money moves.
   */
  renewsAt?: string | null;
  /**
   * When the free trial this press started ends, ISO; null for a purchase.
   *
   * Set, the receipt is the trial's: its length, the day it ends and that
   * nothing is charged — no price, no renewal, no preview-price caveat. The
   * trial used to get the purchase receipt for whichever plan was selected.
   */
  trialEndsAt?: string | null;
}

/** Gap between one row landing and the next — slow enough to watch. */
const ROW_STAGGER_MS = 430;
const ROW_IN_MS = 420;

export function PremiumUnlockScreen({
  language = 'en',
  onDone,
  coachSpecimen = null,
  plan = 'yearly',
  onOpenAnalysis,
  onManageSubscription,
  onSeeEverything,
  liveSince = null,
  renewsAt = null,
  trialEndsAt = null,
}: PremiumUnlockScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  // One value per row plus the header, the specimen and the receipt.
  const stops = PRO_UNLOCK_CARDS.length + 3;
  const rise = useRef(Array.from({ length: stops }, () => new Animated.Value(0))).current;

  useEffect(() => {
    let cancelled = false;
    void queryReduceMotion().then((enabled) => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) {
      return;
    }
    if (reduceMotion) {
      // Settled instantly: the animation is never the thing hiding the content.
      rise.forEach((value) => value.setValue(1));
      return;
    }
    Animated.stagger(
      ROW_STAGGER_MS,
      rise.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: ROW_IN_MS,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [reduceMotion, rise]);

  const riseStyle = (index: number) => ({
    opacity: rise[index],
    transform: [
      { translateY: rise[index].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
    ],
  });

  const receipt = RECEIPT[plan] ?? RECEIPT.yearly;
  const rowVars = useMemo(
    () => (key: I18nKey) => PRO_UNLOCK_LIMIT_VARS[key as string],
    [],
  );

  // reduceMotion is resolved before anything animates, but the content is
  // never gated on it: a pending answer must not blank the screen.
  const ready = reduceMotion !== null;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* The violet state badge carries the fact (design: GAINER Pro
            screens, 01) — a green pip said "on", which is a switch; this is
            a moment, and it names when. Gold, green and filled red are out:
            Pro is the same app with more of it. */}
        <Animated.View style={[styles.statusRow, ready && riseStyle(0)]}>
          <View style={styles.stateBadge}>
            <Text style={styles.stateBadgeText}>
              {liveSince
                ? t(language, 'unlock.state.liveSince', { time: formatTime(liveSince, language) })
                : t(language, 'unlock.state.live')}
            </Text>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.headline, ready && riseStyle(0)]}>
          {/* Derived, not typed: a hardcoded "five" lies the day a row moves. */}
          {t(language, 'unlock.headline', { count: countWord(PRO_UNLOCK_CARDS.length, language) })}
        </Animated.Text>
        <Animated.Text style={[styles.lead, ready && riseStyle(0)]}>
          {/* "You just made the next stretch possible" thanks a payment; a
              trial made none. */}
          {trialEndsAt
            ? t(language, 'unlock.body.trial', { days: PRO_TRIAL_DAYS })
            : t(language, 'unlock.body')}
        </Animated.Text>

        <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.card}>
          {PRO_UNLOCK_CARDS.map((row, index) => (
            <Animated.View
              key={row.titleKey}
              style={[styles.row, index > 0 && styles.rowDivided, ready && riseStyle(index + 1)]}
            >
              <View style={styles.rowIcon}>
                <Svg width={17} height={17} viewBox="0 0 24 24">
                  <Path
                    d={IC[row.titleKey]?.path ?? ''}
                    fill={IC[row.titleKey]?.filled ? theme.purple : 'none'}
                    stroke={IC[row.titleKey]?.filled ? 'none' : theme.purple}
                    strokeWidth={2.1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowTitle}>
                    {t(language, row.titleKey, rowVars(row.titleKey))}
                  </Text>
                  <Text style={styles.rowPlace}>{t(language, row.placeKey)}</Text>
                </View>
                <View style={styles.deltaRow}>
                  <Text style={styles.was}>{t(language, row.wasKey, rowVars(row.wasKey))}</Text>
                  <Svg width={13} height={13} viewBox="0 0 24 24">
                    <Path
                      d="M5 12h13M13 7l5 5-5 5"
                      stroke={theme.faint}
                      strokeWidth={2.6}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                  <View style={styles.nowChip}>
                    <Text style={styles.nowChipText}>
                      {t(language, row.nowKey, rowVars(row.nowKey))}
                    </Text>
                  </View>
                </View>
                <Text style={styles.rowText}>{t(language, row.bodyKey, rowVars(row.bodyKey))}</Text>
              </View>
            </Animated.View>
          ))}
        </CutSurface>

        {/*
          Proof rather than a promise: the reads just opened, and this is the
          first one, computed from this reader's own log by proInsights. With
          no data the card does not render — there is no sample version of it.
        */}
        {coachSpecimen ? (
          <Animated.View style={[styles.specimen, ready && riseStyle(stops - 2)]}>
            <Text style={styles.specimenTitle}>{t(language, 'unlock.specimen.title')}</Text>
            <Text style={styles.specimenText}>{coachSpecimen}</Text>
            <Pressable accessibilityRole="button" onPress={onOpenAnalysis} hitSlop={6}>
              <Text style={styles.specimenCta}>{t(language, 'unlock.specimen.cta')}</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {/*
          The package, and the truth about it. The design put a renewal date
          here ("renews 15.9.2026"); the renewal below is counted from the
          store's own purchase record, never invented. The "payments are not
          live" note belongs to a build with no billing behind it and goes the
          moment one has charged the reader (hunt 9, 2026-10-09).
        */}
        <Animated.View style={[styles.receipt, ready && riseStyle(stops - 1)]}>
          {trialEndsAt ? (
            <>
              <View style={styles.receiptHead}>
                <Text style={styles.receiptName}>
                  {t(language, 'unlock.receipt.trial', { days: PRO_TRIAL_DAYS })}
                </Text>
              </View>
              <Text style={styles.receiptRenews}>
                {t(language, 'unlock.receipt.trialEnds', { date: formatDate(trialEndsAt, language) })}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.receiptHead}>
                <Text style={styles.receiptName}>{t(language, receipt.nameKey)}</Text>
                <Text style={styles.receiptPrice}>{t(language, receipt.priceKey)}</Text>
              </View>
              <Text style={styles.receiptUnit}>{t(language, receipt.unitKey)}</Text>
              {/*
                The renewal line, counted rather than written. Lifetime says so
                instead: it is not a renewal far away, it is the absence of one.
              */}
              <Text style={styles.receiptRenews}>
                {plan === 'lifetime' || !renewsAt
                  ? t(language, 'unlock.receipt.noRenewal')
                  : t(language, 'unlock.receipt.renews', {
                      date: formatDate(renewsAt, language),
                      price: t(language, receipt.priceKey),
                    })}
              </Text>
              {paymentsAreLive(isDemoBuild(), isStoreBillingConfigured()) ? null : (
                <Text style={styles.receiptNote}>{t(language, 'pro.v3.notice')}</Text>
              )}
            </>
          )}
          <Pressable accessibilityRole="button" onPress={onManageSubscription} hitSlop={6}>
            <Text style={styles.receiptManage}>{t(language, 'unlock.receipt.manage')}</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
        {/* One filled action, and it goes home — the screen is about what
            changed, not about today. The whole list is a quiet link. */}
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
        >
          <Text style={styles.ctaText}>{t(language, 'unlock.cta')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingHorizontal: 16,
    // Flat, not `insets.top + 10`: AppShell wraps this route in a SafeAreaView
    // with the top edge, so the drawable area already starts below the status
    // bar — and useSafeAreaInsets reports the full window inset regardless. The
    // same double count as the Pro footer (895c196), pointing the other way.
    paddingTop: 10,
    paddingBottom: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // State is violet — the same chip the rows use for "what is on".
  stateBadge: {
    backgroundColor: theme.purpleLight,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  stateBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: theme.purpleDark,
    textTransform: 'uppercase',
  },
  headline: {
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 31,
    color: theme.ink,
    marginTop: 13,
  },
  lead: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
    color: theme.muted,
    marginTop: 8,
  },
  // The surface draws the shape, the fill and the border. overflow:hidden is
  // gone with them: it clips to the rectangle, not to the cut path, so it was
  // never what kept the rows inside.
  card: {
    marginTop: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  rowDivided: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: theme.ink,
  },
  rowPlace: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: theme.faint,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
    marginTop: 7,
  },
  was: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.faint,
    textDecorationLine: 'line-through',
  },
  // Violet, not gold: the new value is a STATE — what is on, what is yours.
  nowChip: {
    backgroundColor: theme.purpleLight,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  nowChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: theme.purpleDark,
  },
  rowText: {
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 18,
    color: theme.muted,
    marginTop: 7,
  },
  specimen: {
    marginTop: 12,
    backgroundColor: theme.purpleLight,
    borderWidth: 1,
    borderColor: theme.purpleSoft,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  specimenTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
    color: theme.purpleDark,
  },
  specimenText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    color: theme.ink,
    marginTop: 8,
  },
  specimenCta: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: theme.purple,
    marginTop: 10,
  },
  receipt: {
    marginTop: 12,
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  receiptHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  receiptName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: theme.ink,
  },
  receiptPrice: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: theme.ink,
  },
  receiptUnit: {
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.muted,
    marginTop: 2,
  },
  receiptRenews: {
    color: theme.ink,
    fontSize: 12.5,
    fontWeight: '800',
    marginTop: 7,
  },
  receiptNote: {
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 17,
    color: theme.faint,
    marginTop: 6,
  },
  receiptManage: {
    fontSize: 11.5,
    fontWeight: '800',
    color: theme.purple,
    marginTop: 9,
  },
  footer: {
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingHorizontal: 16,
    paddingTop: 13,
    /**
     * Its own breathing room, and nothing else — the same flat number the Pro
     * footer settled on.
     *
     * This was `insets.bottom + 12`, which counted the system bar twice: the
     * SafeAreaView above has already stopped the drawable area short of it.
     * On a gesture-navigation emulator the surplus is ~24dp and reads as
     * generous. On a three-button phone it is ~48dp of dead space under the
     * button, which is what "the CTA sits too high" actually was.
     */
    paddingBottom: 20,
  },
  cta: {
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: theme.onHighlight,
  },
  quietLink: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 2,
  },
  quietLinkText: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.purple,
  },
  pressed: {
    opacity: 0.85,
  },
});
