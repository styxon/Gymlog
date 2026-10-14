import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { FREE_ACTIVE_PROGRAM_CAP } from '../lib/activeProgramSet';
import { t } from '../lib/i18n';
import { PRO_TRIAL_DAYS, PRO_TRIAL_ENABLED } from '../lib/proEntitlement';
import {
  PRO_TIER_ORDER,
  PRO_TIERS,
  ProPlanId,
  ProTier,
  ProTierKey,
  defaultPlanForTier,
  resolveTierCtaKey,
  resolveTierFineKey,
} from '../lib/proTiers';
import { PRO_SURFACE, PRO_TIER } from '../theme';
import { AppLanguage } from '../types/models';

/**
 * The Pro page, v6 (design: "Vinha Pro v6 — kolme tasoa").
 *
 * One screen, three tabs. Everything that decides a purchase — the tier, the
 * price, the button, the terms — is visible at once, and only the benefit list
 * scrolls. v4 was a long scrolling pitch with the plan tiles pinned at the
 * foot; a reader had to travel to compare tiers, and comparing is the thing
 * this page is for.
 *
 * WHAT LEFT WITH v4, and why, because both were deliberate:
 *
 * - The ProChatHero. v3 moved the personal proof off this page, v4 put it
 *   back, and v6 takes it off again — this time on the argument that the proof
 *   is not missing, it is elsewhere and better placed. The withheld
 *   conclusions on Home, Progress and Workout Complete are built from the same
 *   log and appear at the moment the reader actually hits the wall. This page
 *   closes; it does not have to prove. (proSurfaces guards that the proof is
 *   REAL wherever it lives — that rule outlives the component.)
 * - The DELTA table. The rows now come from lib/proTiers, where each one names
 *   the gate that makes it true and tests/lib/proTiers checks that the gate
 *   exists. That is the same rule DELTA carried, applied to three tabs.
 *
 * The copy corrections v6 ships with are documented in lib/proTiers: the
 * reference design sold the dark theme, the widget and cloud backup as Pro,
 * and all three are free.
 *
 * The page is deliberately dark in both themes — see PRO_TIER in theme.ts.
 */
export type PlanId = 'monthly' | 'yearly' | 'lifetime';

interface PremiumScreenProps {
  /**
   * What sent the reader here, when something specific did. A paywall that
   * opens after a refusal and then talks about something else reads as a
   * random toll gate.
   */
  reason?: 'program_cap' | null;
  /** Whether Pro is actually on — the entitlement's answer: trial, purchase or promo grant. */
  proUnlocked: boolean;
  /**
   * Whether this install may still start the trial. Once it has been used the
   * button is a purchase, and has to say so: the trial wording on a press that
   * buys would be a receipt for something never offered.
   */
  trialAvailable?: boolean;
  language?: AppLanguage;
  onBack: () => void;
  /** Receives the package the reader had selected when they pressed buy. */
  /**
   * Buys Pro. One direction only — this page sells, it does not cancel.
   * Ending a membership lives on the subscription screen, where the reader
   * can see what they are giving up and when it stops.
   *
   * May return the write it waits on; the button ignores presses until it
   * settles.
   */
  onPurchase: (plan: PlanId) => void | Promise<void>;
  /** Where an existing subscriber goes instead of the buy CTA. */
  onManageSubscription: () => void;
  onOpenLegal: (document: 'privacy' | 'terms') => void;
}

/** 24x24 stroke glyphs, one per row icon. `spark` is the only filled one. */
const GLYPH: Record<string, string> = {
  arrow: 'M7 17L17 7M9 7h8v8',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lines: 'M4 7h16M4 12h11M4 17h7',
  rows: 'M4 5h16v5H4zM4 14h16v5H4z',
  clock: 'M12 7v5l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
  heart: 'M12 20s-7-4.4-7-9a4 4 0 017-2.6A4 4 0 0119 11c0 4.6-7 9-7 9z',
  lock: 'M7 10V8a5 5 0 0110 0v2M5.5 10h13v10h-13z',
  cloud: 'M6 17h11a3.5 3.5 0 000-7 5 5 0 00-9.6-1.2A3.4 3.4 0 006 17z',
  pencil: 'M4 20h4L19.5 8.5l-4-4L4 16v4zM14.5 5.5l4 4',
  quill: 'M7 3h8l3 3v15H7zM10 12h6M10 16h4',
  // Was `circ` — a circle with a diagonal through it, which is the universal
  // NO sign. On the row that says "everything in Pro" it read as the opposite
  // of what it labelled.
  check: 'M12 21a9 9 0 100-18 9 9 0 000 18M8.2 12.2l2.6 2.7 5-5.8',
  infin: 'M8.5 12a3 3 0 11.9 2.1c-1.2 1.2-2 2.4-3.4 2.4a3.5 3.5 0 010-7c1.4 0 2.2 1.2 3.4 2.4M15.5 12a3 3 0 10-.9 2.1c1.2 1.2 2 2.4 3.4 2.4a3.5 3.5 0 000-7c-1.4 0-2.2 1.2-3.4 2.4',
};

const SPARK = 'M12 2.6l2.1 5.6 5.4 1.9-5.4 1.9-2.1 5.6-2.1-5.6L4.5 10.1l5.4-1.9z';

function RowGlyph({ name }: { name: string }) {
  if (name === 'spark') {
    return (
      <Svg width={19} height={19} viewBox="0 0 24 24">
        <Path d={SPARK} fill={PRO_SURFACE.ink} />
      </Svg>
    );
  }
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Path
        d={GLYPH[name] ?? GLYPH.grid}
        stroke={PRO_SURFACE.ink}
        strokeWidth={1.9}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The tier's sky: colour at the top running to black at the bottom, with two
 * radial washes over it.
 *
 * The Svg is given explicit pixel dimensions rather than percentages. A
 * percentage-sized Svg with no intrinsic size collapses on Android, and the
 * washes then paint over the whole screen instead of the top third — the same
 * trap the Workout Complete hero hit.
 */
function HeroSky({ tier, width }: { tier: ProTierKey; width: number }) {
  const skin = PRO_TIER[tier];
  // The sky ends at 470, but the canvas runs to 540 so the scrim has somewhere
  // to finish. Ending both at 470 left the lower nebula only half damped, and
  // on a device that reads as a coloured band across the top of the benefit
  // card rather than as a glow behind the wordmark — worst on Lifetime, whose
  // second wash is violet against an orange sky.
  const height = 470;
  const canvas = 540;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={canvas} viewBox={`0 0 ${width} ${canvas}`}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={skin.sky[0]} />
            <Stop offset="0.78" stopColor={skin.sky[1]} />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
          <RadialGradient id="neb" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={skin.neb} />
            <Stop offset="0.72" stopColor={skin.neb} stopOpacity={0} />
          </RadialGradient>
          {/* The second wash is damped to just over half strength, and this is
              not taste. The reference is a web mock where it carries
              `filter: blur(10px)`; React Native has no backdrop or layer blur,
              so the same alpha over a crisp radial reads as a coloured BAND
              rather than a glow — most visibly on Lifetime, where a violet
              wash crosses an orange sky right under the tab switcher. The
              token keeps the design's value; only the paint is softened. */}
          <RadialGradient id="neb2" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={skin.neb2} stopOpacity={0.55} />
            <Stop offset="0.62" stopColor={skin.neb2} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity={0} />
            <Stop offset="0.62" stopColor="#000000" stopOpacity={0.85} />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
        <Rect x={-width * 0.3} y={-110} width={width * 1.6} height={420} fill="url(#neb)" />
        {/* Lifted from y=120 to y=30. At the reference offset its centre lands
            at 250dp, which on a real phone is level with the top of the
            benefit card rather than behind the wordmark — the wash has to sit
            in the hero it belongs to, not over the content below it. */}
        <Rect x={-width * 0.1} y={30} width={width * 1.2} height={230} fill="url(#neb2)" />

        {/* Three thin arcs. They read as a horizon rather than as decoration,
            which is what keeps the top from looking like a stock gradient. */}
        <Path
          d={`M-20 210 C ${width * 0.23} 90, ${width * 0.64} 300, ${width + 28} 130`}
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1.2}
        />
        <Path
          d={`M-20 250 C ${width * 0.28} 140, ${width * 0.66} 340, ${width + 28} 180`}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={1}
        />
        <Path
          d={`M-20 165 C ${width * 0.26} 60, ${width * 0.61} 250, ${width + 28} 90`}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1}
        />

        <Rect x={0} y={300} width={width} height={240} fill="url(#scrim)" />
      </Svg>
    </View>
  );
}

/**
 * The fade at the foot of the benefit list.
 *
 * The list scrolls and the card clips it, so without this the last visible row
 * is cut clean through the middle of a word — which reads as a layout bug
 * rather than as "there is more below". Painted over the list, not inside it,
 * so it does not scroll away with the content.
 */
function CardFade({ width }: { width: number }) {
  return (
    <View style={styles.cardFade} pointerEvents="none">
      <Svg width={width} height={44} viewBox={`0 0 ${width} 44`}>
        <Defs>
          <LinearGradient id="cardFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#16141E" stopOpacity={0} />
            <Stop offset="0.85" stopColor="#100E16" stopOpacity={0.95} />
            <Stop offset="1" stopColor="#100E16" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={44} fill="url(#cardFade)" />
      </Svg>
    </View>
  );
}

export function PremiumScreen({
  reason = null,
  proUnlocked,
  trialAvailable = true,
  language = 'en',
  onBack,
  onPurchase,
  onManageSubscription,
  onOpenLegal,
}: PremiumScreenProps) {
  const [tab, setTab] = useState<ProTierKey>('pro');
  const [plan, setPlan] = useState<ProPlanId>(() => defaultPlanForTier('pro'));
  const purchasing = useRef(false);
  const { width } = useWindowDimensions();

  const tier: ProTier = PRO_TIERS[tab];
  const skin = PRO_TIER[tab];
  const activePlan = useMemo(
    () => tier.plans.find((entry) => entry.id === plan) ?? tier.plans[0],
    [tier, plan],
  );

  const pickTab = (next: ProTierKey) => {
    setTab(next);
    setPlan(defaultPlanForTier(next));
  };

  const trialOffered = PRO_TRIAL_ENABLED && trialAvailable;
  const ctaKey = resolveTierCtaKey(tier, trialOffered);
  const fineKey = resolveTierFineKey(tier, activePlan.id, trialOffered);

  const buy = () => {
    // The free tab sells nothing. Its button is the honest exit, which is the
    // same thing "Ohita" does — a CTA that flipped the preview switch here
    // would turn Pro ON for someone who just chose Free.
    if (tier.key === 'free') {
      onBack();
      return;
    }
    // One at a time. The unlock screen waits for the write that turns Pro on,
    // so this page stays up while it lands, and a second tap in that moment
    // would start a second write and push a second unlock screen.
    if (purchasing.current) {
      return;
    }
    purchasing.current = true;
    void (async () => {
      try {
        await onPurchase(activePlan.id as PlanId);
      } catch (error) {
        console.error('Pro purchase failed', error);
      } finally {
        purchasing.current = false;
      }
    })();
  };

  return (
    <View style={styles.root}>
      <HeroSky tier={tab} width={width} />


      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'pro.v6.skip')}
          onPress={onBack}
          style={({ pressed }) => [styles.skipPill, pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.skipText}>{t(language, 'pro.v6.skip')}</Text>
        </Pressable>
      </View>

      <View style={styles.headBlock}>
        <View style={styles.wordmarkRow}>
          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.wordmark}>Vinha</Text>
          {tier.badgeKey ? (
            <View style={[styles.tierBadge, { borderColor: skin.ring }]}>
              <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.tierBadgeText}>{t(language, tier.badgeKey)}</Text>
            </View>
          ) : null}
        </View>
        <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.head}>{t(language, tier.headKey)}</Text>
      </View>

      {reason === 'program_cap' ? (
        <View style={styles.reasonRow}>
          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.reasonText}>
            {t(language, 'programs.cap.paywall', { cap: FREE_ACTIVE_PROGRAM_CAP })}
          </Text>
        </View>
      ) : null}

      <View style={styles.segmentWrap}>
        <View style={[styles.segment, { borderColor: skin.ring }]}>
          {PRO_TIER_ORDER.map((key) => {
            const on = key === tab;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => pickTab(key)}
                style={[styles.segmentTab, on && styles.segmentTabOn]}
              >
                <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {t(language, PRO_TIERS[key].tabKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* The only scrolling region. Its parent is flex:1 inside a bounded
          column — a flex child in a column that is not itself bounded
          collapses to zero height on RN, which is how the set-screen dials
          disappeared once. */}
      <View style={styles.cardWrap}>
        <View style={styles.card}>
          <View style={[styles.cardHair, { backgroundColor: skin.accent }]} />
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator={false}
          >
            {tier.rows.map((row) => (
              <View key={row.key} style={styles.row}>
                <View style={styles.rowIcon}>
                  <RowGlyph name={row.icon} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{t(language, row.titleKey, row.vars)}</Text>
                  {row.bodyKey ? (
                    <Text style={styles.rowSub}>{t(language, row.bodyKey, row.vars)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <CardFade width={width} />
        </View>
      </View>

      <View style={styles.foot}>
        {proUnlocked ? (
          <View style={styles.activeCard}>
            <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.activeText}>{t(language, 'pro.page.proOn')}</Text>
            {/* One door while Pro is on, and it goes to management. The old
                second branch here turned Pro OFF from the paywall — free, from
                inside the app, as often as you liked. A page that sells a
                subscription cannot also be the switch that cancels it. */}
            <Pressable
              accessibilityRole="button"
              onPress={onManageSubscription}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.ctaText}>{t(language, 'subs.manageMembership')}</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={styles.planRow}>
              {tier.plans.map((entry) => {
                const on = tier.plans.length === 1 || entry.id === activePlan.id;
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setPlan(entry.id)}
                    style={[styles.planTile, on && { backgroundColor: PRO_SURFACE.tileOn, borderColor: skin.ring }]}
                  >
                    <View style={styles.planTop}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                        maxFontSizeMultiplier={FIXED_FONT_CAP}
                        style={[styles.planName, on && styles.planNameOn]}
                      >
                        {t(language, entry.nameKey)}
                      </Text>
                      {entry.badgeKey ? (
                        <View style={[styles.planBadge, { backgroundColor: skin.accent }]}>
                          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.planBadgeText}>{t(language, entry.badgeKey)}</Text>
                        </View>
                      ) : null}
                    </View>
                    {/* One line that shrinks to fit: wrapped, "/ year" took a
                        line of its own and the taller tile pushed the legal row
                        off the screen (emulator check, 2026-10-13). */}
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      maxFontSizeMultiplier={FIXED_FONT_CAP}
                      style={styles.priceRow}
                    >
                      <Text style={[styles.price, on && styles.priceOn]}>{t(language, entry.priceKey)}</Text>
                      <Text style={styles.priceUnit}>{` ${t(language, entry.unitKey)}`}</Text>
                    </Text>
                    {/* Always drawn, blank when the plan has no second
                        line. Free is the only tier whose plan carries none, so
                        its price tile was a line shorter than Pro's and
                        Lifetime's. Reserving the line rather than measuring
                        it: the space stays right if the type ever changes.
                        Not capped at one line: at the large font sizes the
                        cap cut the price terms off mid-word, and the row
                        stretches every tile to the tallest (accessibility
                        audit, 2026-09-21). */}
                    <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.priceSub}>
                      {entry.subKey ? t(language, entry.subKey) : ' '}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={buy}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
            >
              {/* The number comes from the constant, not from the string:
                  the copy said "7 päivän" while PRO_TRIAL_DAYS said 14, and
                  a promise in a translation file drifts from the code that
                  keeps it. */}
              <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.ctaText}>{t(language, ctaKey, { days: PRO_TRIAL_DAYS })}</Text>
            </Pressable>

            {/* And the same for the fine print, which is what actually
                moved the button: `foot` sits against the bottom edge, so a
                tier missing this line does not get a shorter footer — it gets
                its button pushed DOWN into the space the line would have
                taken. Free has no recurring terms to state, so its "Continue
                for free" landed lower than "Get Pro" and "Get Lifetime"
                (user 2026-09-01). */}
            <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.fine}>{fineKey ? t(language, fineKey) : ' '}</Text>
          </View>
        )}

        <View style={styles.legalRow}>
          <Pressable accessibilityRole="link" onPress={() => onOpenLegal('terms')} hitSlop={8}>
            <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.legalLink}>{t(language, 'pro.page.terms')}</Text>
          </Pressable>
          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.legalDot}>·</Text>
          <Pressable accessibilityRole="link" onPress={() => onOpenLegal('privacy')} hitSlop={8}>
            <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.legalLink}>{t(language, 'pro.page.privacy')}</Text>
          </Pressable>
          <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.legalDot}>·</Text>
          <Pressable accessibilityRole="link" onPress={onManageSubscription} hitSlop={8}>
            <Text maxFontSizeMultiplier={FIXED_FONT_CAP} style={styles.legalLink}>{t(language, 'pro.page.restore')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const RADIUS = 26;

/**
 * Only the card in the middle scrolls: the head above it and the foot under
 * it (the plan tiles, the button, the terms and the legal row) are always on
 * screen, which is what a paywall owes the reader — Restore purchase above
 * all. At a 1.5 system font on a 720x1280 phone they no longer fit: "Yearly"
 * cut to "Ye..", the yearly price ran past its tile, and the legal row fell
 * off the bottom with the card squeezed to nothing (small-screen sweep,
 * 2026-10-13). The fixed parts' text grows to 1.3x and no further, the cap the
 * player's clock already uses; the card's rows, which scroll, grow freely.
 */
const FIXED_FONT_CAP = 1.3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  pressed: { opacity: 0.85 },

  topRow: { paddingHorizontal: 18, paddingTop: 10, alignItems: 'flex-end' },
  skipPill: {
    paddingHorizontal: 19,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: PRO_SURFACE.glass,
    borderWidth: 1,
    borderColor: PRO_SURFACE.glassEdge,
  },
  skipText: { fontSize: 15.5, fontWeight: '700', color: PRO_SURFACE.ink },

  headBlock: { paddingHorizontal: 20, paddingTop: 10, alignItems: 'center' },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wordmark: { fontSize: 38, fontWeight: '800', letterSpacing: -1.7, color: PRO_SURFACE.ink },
  tierBadge: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: PRO_SURFACE.glassEdge,
    borderWidth: 1,
  },
  tierBadgeText: { fontSize: 15, fontWeight: '700', color: PRO_SURFACE.ink },
  head: {
    fontSize: 19,
    fontWeight: '700',
    color: PRO_SURFACE.inkDim,
    marginTop: 7,
    lineHeight: 24,
    textAlign: 'center',
  },

  reasonRow: { paddingHorizontal: 22, paddingTop: 10 },
  reasonText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: PRO_SURFACE.inkMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  segmentWrap: { paddingHorizontal: 22, paddingTop: 15 },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
  },
  // minHeight, not height: at the large font sizes a fixed 40 clipped the
  // tab's own word (accessibility audit, 2026-09-21).
  segmentTab: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTabOn: { backgroundColor: 'rgba(255,255,255,0.15)' },
  // .30 → .62 (accessibility audit, 2026-09-21): the tiers you are not on
  // were 2.6:1 on the sky, a tab row you could see was there and not read.
  // .62 is 5.9–6.3:1 on all three skies; the pill behind the chosen one and
  // its .88 still say which is picked.
  segmentText: { fontSize: 14.5, fontWeight: '700', color: 'rgba(255,255,255,0.62)', textAlign: 'center' },
  segmentTextOn: { color: 'rgba(255,255,255,0.88)' },

  cardWrap: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  card: {
    flex: 1,
    borderRadius: RADIUS,
    backgroundColor: PRO_SURFACE.card,
    borderWidth: 1,
    borderColor: PRO_SURFACE.cardEdge,
    overflow: 'hidden',
  },
  cardHair: { height: 2, marginHorizontal: '22%', opacity: 0.85 },
  cardFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44 },
  cardScroll: { flex: 1 },
  cardContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 18, gap: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: PRO_SURFACE.ink, lineHeight: 19 },
  rowSub: { fontSize: 13, fontWeight: '500', color: PRO_SURFACE.inkFaint, lineHeight: 17, marginTop: 1 },

  foot: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
  planRow: {
    flexDirection: 'row',
    borderRadius: 22,
    backgroundColor: PRO_SURFACE.tile,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 4,
  },
  planTile: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  planName: { fontSize: 13.5, fontWeight: '700', color: PRO_SURFACE.inkGhost, flexShrink: 1 },
  planNameOn: { color: PRO_SURFACE.ink },
  planBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  planBadgeText: { fontSize: 10.5, fontWeight: '800', color: PRO_SURFACE.badgeInk },
  priceRow: { marginTop: 1 },
  price: { fontSize: 22, fontWeight: '800', letterSpacing: -1, color: 'rgba(255,255,255,0.55)' },
  priceOn: { color: PRO_SURFACE.ink },
  priceUnit: { fontSize: 13.5, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  // lineHeight is explicit so the blank stand-in reserves exactly what the
  // real line takes, on every device font scale.
  priceSub: { fontSize: 12.5, lineHeight: 16, fontWeight: '600', color: PRO_SURFACE.inkFaint, marginTop: 0 },

  activeCard: { paddingBottom: 2 },
  activeText: {
    fontSize: 15,
    fontWeight: '700',
    color: PRO_SURFACE.ink,
    textAlign: 'center',
    marginBottom: 12,
  },

  cta: {
    height: 56,
    borderRadius: 999,
    backgroundColor: PRO_SURFACE.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  ctaText: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: PRO_SURFACE.ctaInk },

  fine: {
    fontSize: 13,
    fontWeight: '600',
    color: PRO_SURFACE.inkMuted,
    textAlign: 'center',
    marginTop: 11,
    lineHeight: 18,
    paddingHorizontal: 6,
  },
  forever: {
    fontSize: 12.5,
    fontWeight: '600',
    color: PRO_SURFACE.inkFaint,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 17,
    paddingHorizontal: 6,
  },
  notice: {
    fontSize: 11.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.34)',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
    paddingHorizontal: 6,
  },

  // The footer lost two lines of prose, so the fine print and the links ended
  // up stacked tight under the button. The gap keeps the terms of the sale and
  // the legal links reading as two things rather than one paragraph.
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 },
  legalLink: { fontSize: 12.5, fontWeight: '600', color: PRO_SURFACE.inkMuted },
  legalDot: { fontSize: 12.5, color: 'rgba(255,255,255,0.3)' },
});
