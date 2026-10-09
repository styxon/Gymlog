import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Gradient is drawn at a fixed size and clipped by the hero (overflow hidden),
// which is more reliable than a percentage-height Svg against a dynamic parent.
const HERO_GRADIENT_WIDTH = Dimensions.get('window').width;
const HERO_GRADIENT_HEIGHT = 360;

import { formatTime, formatWeight, getDateTimeFormat, removeTrailingZeros } from '../lib/format';
import { bodyPartLabel, t } from '../lib/i18n';
import { Movement, WhatMovedRow } from '../lib/sessionMovement';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { localizeSessionName } from '../lib/sessionNameLabel';
import { SESSION_FEEL_LABEL_KEY, SESSION_FEEL_SCALE, sessionFeelColor } from '../lib/sessionFeel';
import { MuscleFocusRow } from '../lib/workoutCompleteView';
import { WorkoutCompletionExerciseCard, WorkoutCompletionPrCard } from '../lib/workoutCompletionSummary';
import { ProMomentContent } from '../lib/proInsights';
import { CoachDemoSheet } from '../components/CoachDemoSheet';
import { ProLockedCard } from '../components/ProLockedCard';
import { ProMomentSheet } from '../components/ProMomentSheet';
import { KitSheet } from '../components/sheetKit';
import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { AppLanguage, SessionFeel } from '../types/models';
import { haptics } from '../utils/haptics';
import { sound } from '../utils/sound';
import { queryReduceMotion } from '../utils/reduceMotion';

// Workout Complete palette extensions (design_handoff_workout_complete).
const GOLD = '#B7791F';
const GOLD_SOFT = '#FBF1DA';
const HAIRLINE = '#EEEAF7';
const HERO_STOPS = ['#8B5CF6', '#7C3AED', '#6D28D9'] as const;

/**
 * One colour per muscle group, so the same body part reads the same across
 * sessions — a rank-based ramp made "Legs" change colour week to week.
 * buildMuscleFocus emits the English group labels these keys mirror.
 */
const MUSCLE_COLORS: Record<string, string> = {
  Chest: '#7C3AED',
  Back: '#2563EB',
  Legs: '#0EA5A5',
  Glutes: '#0891B2',
  Shoulders: '#D97706',
  Biceps: '#DB2777',
  Triceps: '#E11D48',
  Core: '#16A34A',
  'Full body': '#6D28D9',
};
const MUSCLE_COLOR_FALLBACK = '#8B7BA8';

function muscleColor(name: string): string {
  return MUSCLE_COLORS[name] ?? MUSCLE_COLOR_FALLBACK;
}

const RISE_EASING = Easing.bezier(0.22, 1, 0.36, 1);
// Rise slots: hero title, hero subtitle, PR/quiet, stats, muscle, exercises, actions.
const RISE_DELAYS_MS = [300, 380, 440, 520, 600, 680, 760] as const;

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The hero's four faces: light and dark, with a record and without.
 *
 * Two strengths of the same colour rather than two colours. A record gets gold
 * as a surface — a metal sweep, a filled seal, a warm glow; a session without
 * one gets it as a hint, on cream or on the app's own dark. If every workout
 * celebrated equally, a record would stop meaning anything, and the record card
 * directly under this hero is the thing that would stop being seen.
 */
function goldHeroFace(dark: boolean, record: boolean) {
  if (dark && record) {
    return {
      // SVG takes a vector where CSS takes an angle; 170deg is very nearly
      // straight down, with the warm corner pulled to the left.
      groundAngle: ['0.17', '0.99'] as const,
      ground: [
        { offset: '0', color: '#2B2113' },
        { offset: '0.58', color: '#1D1633' },
        { offset: '1', color: '#171130' },
      ],
      glow: {
        cx: '50%',
        cy: '16%',
        rx: '78%',
        ry: '62%',
        stops: [
          { offset: '0', color: '#E4B14C', opacity: 0.42 },
          { offset: '0.62', color: '#E4B14C', opacity: 0.05 },
          { offset: '1', color: '#E4B14C', opacity: 0 },
        ],
      },
      sheenColor: '#FFEEC8',
      sheenPeak: 0.1,
      sealFill: '#EFC96F',
      sealRing: 'rgba(255,236,190,0.35)',
      sealBorder: 2,
      check: '#2A1D06',
      kicker: 'rgba(240,228,200,0.62)',
      title: '#FFF6E2',
      rule: 'rgba(228,177,76,0.34)',
      meta: '#F0E4C8',
      metaQuiet: 'rgba(240,228,200,0.62)',
    };
  }
  if (dark) {
    return {
      groundAngle: ['0', '1'] as const,
      ground: [
        { offset: '0', color: '#1C1638' },
        { offset: '1', color: '#171130' },
      ],
      glow: {
        cx: '50%',
        cy: '18%',
        rx: '66%',
        ry: '52%',
        stops: [
          { offset: '0', color: '#E4B14C', opacity: 0.14 },
          { offset: '1', color: '#E4B14C', opacity: 0 },
        ],
      },
      sheenColor: '#FFEEC8',
      sheenPeak: 0,
      // A ring and a mark, nothing filled: the quiet session's whole treatment.
      sealFill: 'transparent',
      sealRing: 'rgba(228,177,76,0.55)',
      sealBorder: 1.5,
      check: '#E4B14C',
      kicker: 'rgba(228,177,76,0.75)',
      title: '#F4F1FF',
      rule: 'rgba(255,255,255,0.08)',
      meta: '#DCD6F2',
      metaQuiet: '#A79FC4',
    };
  }
  if (record) {
    return {
      groundAngle: ['0.37', '0.93'] as const,
      ground: [
        { offset: '0', color: '#FFF6DC' },
        { offset: '0.46', color: '#F3D68B' },
        { offset: '1', color: '#E4B863' },
      ],
      glow: {
        cx: '50%',
        cy: '22%',
        rx: '70%',
        ry: '55%',
        stops: [
          { offset: '0', color: '#FFFFFF', opacity: 0.65 },
          { offset: '1', color: '#FFFFFF', opacity: 0 },
        ],
      },
      sheenColor: '#FFFFFF',
      sheenPeak: 0.55,
      sealFill: '#2E2107',
      sealRing: 'rgba(255,255,255,0.55)',
      sealBorder: 2,
      check: '#F5D68A',
      kicker: 'rgba(62,44,9,0.62)',
      title: '#2E2007',
      rule: 'rgba(138,90,18,0.30)',
      meta: '#3E2C09',
      metaQuiet: 'rgba(62,44,9,0.66)',
    };
  }
  return {
    groundAngle: ['0', '1'] as const,
    ground: [
      { offset: '0', color: '#FFFCF3' },
      { offset: '1', color: '#FAF3E2' },
    ],
    glow: {
      cx: '50%',
      cy: '20%',
      rx: '62%',
      ry: '52%',
      stops: [
        { offset: '0', color: '#E8BE63', opacity: 0.2 },
        { offset: '1', color: '#E8BE63', opacity: 0 },
      ],
    },
    sheenColor: '#FFFFFF',
    sheenPeak: 0,
    sealFill: '#FFFFFF',
    sealRing: 'rgba(183,121,31,0.45)',
    sealBorder: 1.5,
    check: GOLD,
    kicker: 'rgba(183,121,31,0.85)',
    title: '#17131F',
    rule: '#EFE1C4',
    meta: '#3B3550',
    metaQuiet: '#5E5670',
  };
}


interface WorkoutCompletionScreenProps {
  workoutName: string;
  performedAt: string;
  durationMinutes: number;
  setsCompleted: number;
  exercisesLogged: number;
  muscles: MuscleFocusRow[];
  exerciseCards: WorkoutCompletionExerciseCard[];
  prCards: WorkoutCompletionPrCard[];
  /**
   * The lifts the session moved, heaviest jump first.
   *
   * The payoff, and the only part of this screen that is about next week
   * rather than about the last hour. Empty hides the card — a session that
   * held everything steady moved nothing, and saying so with an empty card
   * would be worse than not saying it.
   */
  whatMoved?: WhatMovedRow[];
  /** Per-lift comparison against last session, keyed by the card's id. */
  movementById?: Record<string, Movement>;
  /** This week's completed/target — moved here from the guided finish step. */
  weekProgress?: { weekLabel: string; done: number; target: number } | null;
  /** The next planned session, same source the guided finish used. */
  nextUp?: { name: string; weekday: string } | null;
  language?: AppLanguage;
  /**
   * Done asks "miltä treeni tuntui" on the way out (user 2026-08-23) and
   * hands the answer here; null = skipped, and skipping costs one tap.
   */
  onDone: (feel: SessionFeel | null) => void;
  /**
   * Paywall moment 1: the coach's one change for next time. The blurred lines
   * are the REAL deterministic conclusion; null hides the lock entirely (fresh
   * users and Pro users see nothing extra here).
   */
  lockedInsight?: { teaser: string; body: string; moment: ProMomentContent } | null;
  onOpenPremium?: () => void;
  /**
   * A coach demo moment that came due with this session (lib/coachDemoMoments).
   *
   * Three of these exist per install, ever. The question is shown before it
   * is sent and the reader is the one who sends it — the app asking on
   * someone’s behalf without a tap would be putting words in their mouth.
   *
   * Declining costs nothing and needs no handler: the dialog closes and the
   * offer comes back after the next session. Only sending has a consequence,
   * so only sending has a callback.
   */
  demoQuestion?: string | null;
  onSendDemoQuestion?: () => void;
}

function formatWhenLabel(performedAt: string, language: AppLanguage) {
  const performed = new Date(performedAt);
  const now = new Date();
  const sameDay =
    performed.getFullYear() === now.getFullYear() &&
    performed.getMonth() === now.getMonth() &&
    performed.getDate() === now.getDate();
  const day = sameDay
    ? t(language, 'common.today')
    : language === 'fi'
      ? `${performed.getDate()}.${performed.getMonth() + 1}.`
      : getDateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(performed);
  return `${day} · ${formatTime(performedAt, language)}`;
}

/**
 * The set that earned the record. Its own line.
 *
 * Name and numbers used to share one line clipped to numberOfLines={1}, and a
 * long lift name ate the half worth reading: "Lantionnosto laitteessa · 38,75
 * …" is a record banner that does not say what the record was (#bugs
 * 2026-08-26). The name can wrap to two; the set never truncates.
 */
function formatPrSet(pr: WorkoutCompletionPrCard) {
  return `${formatWeight(pr.performedWeightKg)} × ${pr.performedReps}`;
}

function formatPrNote(pr: WorkoutCompletionPrCard, language: AppLanguage) {
  if (pr.previousBestWeightKg === null) {
    return t(language, 'complete.pr.first');
  }
  // Same weight, more reps is a record too (2026-09-26) — and "+0 kg" would
  // say it was not one. The reps are what moved.
  if (pr.performedWeightKg === pr.previousBestWeightKg && pr.previousBestReps !== null) {
    return t(language, 'complete.pr.moreReps', {
      delta: pr.performedReps - pr.previousBestReps,
      weight: removeTrailingZeros(pr.performedWeightKg),
    });
  }
  const delta = pr.performedWeightKg - pr.previousBestWeightKg;
  // The delta alone made the reader do the arithmetic mid-celebration
  // (user 2026-08-23): the number they want is the new best itself.
  return t(language, 'complete.pr.delta', {
    // Hundredths: a 1.25 kg step is "+1,25 kg", not "+1,3".
    delta: removeTrailingZeros(Number(delta.toFixed(2))),
    max: removeTrailingZeros(Number(pr.performedWeightKg.toFixed(2))),
  });
}

export function WorkoutCompletionScreen({
  workoutName,
  performedAt,
  durationMinutes,
  setsCompleted,
  exercisesLogged,
  muscles,
  exerciseCards,
  prCards,
  language = 'en',
  whatMoved = [],
  movementById = {},
  weekProgress = null,
  nextUp = null,
  onDone,
  lockedInsight = null,
  demoQuestion = null,
  onSendDemoQuestion,
  onOpenPremium,
}: WorkoutCompletionScreenProps) {
  const theme = useTheme();
  const themeName = useThemeName();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [momentSheetVisible, setMomentSheetVisible] = useState(false);
  /**
   * The demo dialog opens on a beat rather than instantly.
   *
   * Landing on top of the summary the moment it renders steps on the one
   * screen in the app whose job is to say well done. The delay is short
   * enough that it still reads as part of finishing, long enough that the
   * numbers register first.
   */
  const [demoSheetVisible, setDemoSheetVisible] = useState(false);
  useEffect(() => {
    if (!demoQuestion) {
      return undefined;
    }
    const timer = setTimeout(() => setDemoSheetVisible(true), 900);
    return () => clearTimeout(timer);
  }, [demoQuestion]);
  /**
   * The "miltä treeni tuntui" ask, shown when Done is pressed. Closing it
   * writes nothing and leaves the summary where it was: Done pressed by
   * accident had no way back, only four answers and Skip (#bugs 2026-09-24).
   */
  const [feelSheetVisible, setFeelSheetVisible] = useState(false);
  const pr = prCards[0] ?? null;

  // The workout is saved by the time this screen mounts — mark the moment.
  useEffect(() => {
    void haptics.success();
    sound.finish();
  }, []);

  const riseValues = useRef(RISE_DELAYS_MS.map(() => new Animated.Value(0))).current;
  const badgePop = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const checkDraw = useRef(new Animated.Value(40)).current;
  const barAnims = useRef(muscles.map(() => new Animated.Value(0))).current;
  // Every interpolation built once — per-render interpolations leak native
  // animated nodes (Fabric disconnectAnimatedNodes crash).
  const riseStyles = useRef(
    riseValues.map((value) => ({
      opacity: value,
      transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    })),
  ).current;
  const ringStyle = useRef({
    opacity: ringAnim.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.55, 0] }),
    transform: [{ scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
  }).current;
  const badgeStyle = useRef({
    opacity: badgePop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: badgePop.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.4, 1.12, 1] }) }],
  }).current;
  const barFillWidths = useRef(
    barAnims.map((value, index) =>
      value.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', `${Math.max(4, muscles[index]?.sharePercent ?? 4)}%`],
      }),
    ),
  ).current;

  useEffect(() => {
    let mounted = true;
    queryReduceMotion()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(Boolean(enabled));
        }
      })
      .catch(() => {
        if (mounted) {
          setReduceMotion(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) {
      return;
    }
    if (reduceMotion) {
      riseValues.forEach((value) => value.setValue(1));
      badgePop.setValue(1);
      ringAnim.setValue(0);
      checkDraw.setValue(0);
      barAnims.forEach((value) => value.setValue(1));
      return;
    }
    Animated.parallel([
      ...riseValues.map((value, index) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 460,
          delay: RISE_DELAYS_MS[index],
          easing: RISE_EASING,
          useNativeDriver: true,
        }),
      ),
      Animated.timing(badgePop, {
        toValue: 1,
        duration: 520,
        easing: Easing.bezier(0.22, 1.2, 0.36, 1),
        useNativeDriver: true,
      }),
      // A few celebratory pulses instead of an infinite loop.
      Animated.loop(
        Animated.sequence([
          Animated.delay(240),
          Animated.timing(ringAnim, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringAnim, { toValue: 0, duration: 1, useNativeDriver: true }),
        ]),
        { iterations: 3 },
      ),
      Animated.timing(checkDraw, {
        toValue: 0,
        duration: 460,
        delay: 360,
        easing: Easing.ease,
        useNativeDriver: false,
      }),
      ...barAnims.map((value, index) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 620,
          delay: RISE_DELAYS_MS[4] + 120 + index * 90,
          easing: RISE_EASING,
          useNativeDriver: false,
        }),
      ),
    ]).start();
  }, [badgePop, barAnims, checkDraw, reduceMotion, ringAnim, riseValues]);

  const rise = (index: number) => riseStyles[index];
  const gold = goldHeroFace(themeName === 'dark', pr !== null);

  return (
    <View style={styles.screenBackground}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 26 }]}>
        {/* The hero runs under the status bar, so nothing dark caps the screen.

            Gold, and two strengths of it. Purple was the app's own colour on
            every other screen, so the one screen that exists to say "you did
            it" said it in the same voice as a settings row. Gold is already
            what this app means by an achievement — the record card below uses
            it — which is also why a session with no record gets it as a hint
            rather than a surface: if every workout celebrates equally, the
            record stops meaning anything. Design: "GAINER Treeni valmis". */}
        <View style={[styles.hero, { paddingTop: insets.top + 26 }]}>
          <Svg
            style={StyleSheet.absoluteFill}
            width={HERO_GRADIENT_WIDTH}
            height={HERO_GRADIENT_HEIGHT}
            viewBox={`0 0 ${HERO_GRADIENT_WIDTH} ${HERO_GRADIENT_HEIGHT}`}
          >
            <Defs>
              <SvgLinearGradient
                id="completeHeroGround"
                x1="0"
                y1="0"
                x2={gold.groundAngle[0]}
                y2={gold.groundAngle[1]}
              >
                {gold.ground.map((stop) => (
                  <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
                ))}
              </SvgLinearGradient>
              <RadialGradient
                id="completeHeroGlow"
                cx={gold.glow.cx}
                cy={gold.glow.cy}
                rx={gold.glow.rx}
                ry={gold.glow.ry}
              >
                {gold.glow.stops.map((stop) => (
                  <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
                ))}
              </RadialGradient>
              <SvgLinearGradient id="completeHeroSheen" x1="0" y1="0" x2="0.93" y2="0.38">
                <Stop offset="0.26" stopColor={gold.sheenColor} stopOpacity={0} />
                <Stop offset="0.44" stopColor={gold.sheenColor} stopOpacity={gold.sheenPeak} />
                <Stop offset="0.6" stopColor={gold.sheenColor} stopOpacity={0} />
              </SvgLinearGradient>
            </Defs>
            <Rect width={HERO_GRADIENT_WIDTH} height={HERO_GRADIENT_HEIGHT} fill="url(#completeHeroGround)" />
            <Rect width={HERO_GRADIENT_WIDTH} height={HERO_GRADIENT_HEIGHT} fill="url(#completeHeroGlow)" />
            {/* The single sweep of light that makes gold read as metal rather
                than as beige. A quiet session does not get it. */}
            {gold.sheenPeak > 0 ? (
              <Rect width={HERO_GRADIENT_WIDTH} height={HERO_GRADIENT_HEIGHT} fill="url(#completeHeroSheen)" />
            ) : null}
          </Svg>

          <View style={styles.badgeWrap}>
            <Animated.View style={[styles.badgeRing, ringStyle, { backgroundColor: gold.sealRing }]} />
            <Animated.View
              style={[
                styles.badge,
                badgeStyle,
                gold.sealFill === 'transparent' ? null : styles.badgeLift,
                { backgroundColor: gold.sealFill, borderColor: gold.sealRing, borderWidth: gold.sealBorder },
              ]}
            >
              <Svg width={40} height={40} viewBox="0 0 24 24" fill="none">
                <AnimatedPath
                  d="M5 12.5l4.5 4.5L19 7"
                  stroke={gold.check}
                  strokeWidth={2.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={40}
                  strokeDashoffset={checkDraw}
                />
              </Svg>
            </Animated.View>
          </View>

          <Animated.Text style={[styles.heroKicker, { color: gold.kicker }, rise(0)]}>
            {t(language, pr ? 'complete.kicker.record' : 'complete.kicker.done')}
          </Animated.Text>
          <Animated.Text style={[styles.heroTitle, { color: gold.title }, rise(0)]}>
            {t(language, 'complete.title')}
          </Animated.Text>
          <Animated.View style={[styles.heroRule, { backgroundColor: gold.rule }, rise(1)]} />
          <Animated.View style={[styles.heroSubRow, rise(1)]}>
            <Text style={[styles.heroSubName, { color: gold.meta }]}>
              {localizeSessionName(workoutName, language)}
            </Text>
            <Text style={[styles.heroSubWhen, { color: gold.metaQuiet }]}>
              {formatWhenLabel(performedAt, language)}
            </Text>
          </Animated.View>
        </View>

        <View style={styles.body}>
          {weekProgress ? (
            /* Directly under the title (design: session flow, screen 10).
               It sat below the exercise list, which put "2 of 5 done" — the
               one line that says where this session lands in the week — at
               the bottom of a screen most readers finish from the top. */
            <Animated.View style={[styles.weekCard, styles.weekCardTop, rise(2)]}>
              <View style={styles.weekHeadRow}>
                <Text style={styles.weekKicker}>{weekProgress.weekLabel}</Text>
                <Text style={styles.weekCount}>
                  {weekProgress.done}/{weekProgress.target}
                </Text>
              </View>
              <View style={styles.weekBarRow}>
                {Array.from({ length: Math.max(weekProgress.target, weekProgress.done, 1) }).map(
                  (_, index) => (
                    <View
                      key={index}
                      style={[styles.weekBar, index < weekProgress.done && styles.weekBarDone]}
                    />
                  ),
                )}
              </View>
            </Animated.View>
          ) : null}

          {/* Only a PR earns a card here. A session with nothing special in it
              says nothing — the stats below already report what happened. */}
          {pr ? (
            <Animated.View style={[styles.noteCard, rise(2)]}>
              <View style={[styles.noteIconTile, styles.noteIconTileGold]}>
                <Svg width={24} height={24} viewBox="0 0 24 24">
                  <Path d="M12 2l2.5 5 5.5.8-4 3.9.95 5.5L12 20.5 7.05 17.2 8 11.7l-4-3.9L9.5 7z" fill={GOLD} />
                </Svg>
              </View>
              <View style={styles.noteCopy}>
                <Text style={styles.prEyebrow}>{t(language, 'complete.pr.eyebrow')}</Text>
                <Text style={styles.noteTitle} numberOfLines={2}>
                  {exerciseNameLabel(language, pr.exerciseName)}
                </Text>
                <Text style={styles.prSet}>{formatPrSet(pr)}</Text>
                <Text style={styles.noteSub} numberOfLines={2}>
                  {formatPrNote(pr, language)}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <Animated.View style={[styles.statsCard, rise(3)]}>
            <View style={styles.statCell}>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                {durationMinutes}
                <Text style={styles.statUnit}> min</Text>
              </Text>
              <Text style={styles.statLabel}>{t(language, 'complete.stat.duration')}</Text>
            </View>
            {/* No volume cell (user 2026-08-23): three things to follow —
                duration, sets, exercises. Volume is a training-nerd number
                and it lives in Progress for whoever wants it. */}
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{setsCompleted}</Text>
              <Text style={styles.statLabel}>
                {t(language, setsCompleted === 1 ? 'complete.stat.setsOne' : 'complete.stat.sets')}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{exercisesLogged}</Text>
              <Text style={styles.statLabel}>
                {t(language, exercisesLogged === 1 ? 'complete.stat.exercisesOne' : 'complete.stat.exercises')}
              </Text>
            </View>
          </Animated.View>

          {muscles.length > 0 ? (
            <Animated.View style={rise(4)}>
              <Text style={styles.sectionLabel}>{t(language, 'complete.muscleFocus')}</Text>
              <View style={styles.sectionCard}>
                {muscles.map((muscle, index) => (
                  <View key={muscle.name} style={[styles.muscleRow, index > 0 && styles.muscleRowSpaced]}>
                    <View style={styles.muscleTopRow}>
                      <View style={styles.muscleNameRow}>
                        <View style={[styles.muscleSwatch, { backgroundColor: muscleColor(muscle.name) }]} />
                        <Text style={styles.muscleName}>{bodyPartLabel(language, muscle.name)}</Text>
                      </View>
                      <View style={styles.muscleMetaRow}>
                        <Text style={[styles.musclePercent, { color: muscleColor(muscle.name) }]}>
                          {muscle.sharePercent} %
                        </Text>
                        <Text style={styles.muscleMeta}>
                          {t(language, muscle.sets === 1 ? 'complete.exerciseSetsOne' : 'complete.exerciseSetsMany', { count: muscle.sets })}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.muscleTrack}>
                      <Animated.View
                        style={[
                          styles.muscleFill,
                          { backgroundColor: muscleColor(muscle.name), width: barFillWidths[index] },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {/* The payoff. An accent-tinted card because it is the one thing on
              this screen that is not a tally of what already happened. */}
          {whatMoved.length > 0 ? (
            <Animated.View style={rise(4)}>
              <Text style={styles.sectionLabel}>{t(language, 'complete.moved.title')}</Text>
              <View style={styles.movedCard}>
                {/* Keyed by position, not by name: a day can hold the same
                    lift in two slots, and both of them can move. */}
                {whatMoved.map((row, index) => (
                  <View key={`${row.exerciseName}-${index}`} style={index > 0 ? styles.movedRowDivided : undefined}>
                    <View style={styles.movedHeadRow}>
                      <Text style={styles.movedName} numberOfLines={1}>
                        {exerciseNameLabel(language, row.exerciseName)}
                      </Text>
                      <Text style={styles.movedDelta}>{row.deltaLabel}</Text>
                    </View>
                    <Text style={styles.movedNudge}>{row.nudge}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          <Animated.View style={rise(5)}>
            <Text style={styles.sectionLabel}>{t(language, 'complete.moved.did')}</Text>
            <View style={[styles.sectionCard, styles.exercisesCard]}>
              {exerciseCards.map((exercise, index) => {
                // A row with no logged set was skipped, and reads so. Every
                // row used to get the green check — five skipped lifts ticked
                // as done next to a tile that said 0 sets.
                const wasDone = exercise.completedSets > 0;
                return (
                <View key={exercise.id} style={[styles.exerciseRow, index > 0 && styles.exerciseRowDivided]}>
                  <View style={[styles.exerciseCheckTile, !wasDone && styles.exerciseSkippedTile]}>
                    {wasDone ? (
                      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                        <Path d="M5 12.5l4.5 4.5L19 7" stroke={theme.green} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    ) : (
                      <View style={styles.exerciseSkippedDash} />
                    )}
                  </View>
                  <View style={styles.exerciseCopy}>
                    <View style={styles.exerciseNameRow}>
                      <Text style={[styles.exerciseName, !wasDone && styles.exerciseNameSkipped]} numberOfLines={1}>
                        {exerciseNameLabel(language, exercise.name)}
                      </Text>
                      {exercise.isPr ? (
                        <View style={styles.prBadge}>
                          <Text style={styles.prBadgeText}>PR</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.exerciseSets}>
                      {wasDone
                        ? t(language, exercise.completedSets === 1 ? 'complete.exerciseSetsOne' : 'complete.exerciseSetsMany', { count: exercise.completedSets })
                        : t(language, 'complete.exerciseSkipped')}
                    </Text>
                  </View>
                  {exercise.topSetLabel ? (
                    <View style={styles.exerciseTopSet}>
                      <Text style={styles.exerciseTopSetValue}>{exercise.topSetLabel}</Text>
                      {/* The comparison, where the caption used to be. "Top
                          set" named the number; this says what happened to
                          it, which is the half the reader came for. */}
                      {(() => {
                        const movement = movementById[exercise.id] ?? null;
                        if (!movement || movement.label === null) {
                          return (
                            <Text style={styles.exerciseTopSetLabel}>{t(language, 'complete.topSet')}</Text>
                          );
                        }
                        return (
                          <Text
                            style={[
                              styles.exerciseTopSetLabel,
                              movement.kind === 'up' && { color: theme.greenInk },
                              movement.kind === 'down' && { color: theme.muted },
                            ]}
                          >
                            {movement.label}
                          </Text>
                        );
                      })()}
                    </View>
                  ) : null}
                </View>
                );
              })}
            </View>
          </Animated.View>

          {/* Paywall moment 1: one locked recommendation right after the free
              insight, while the data is fresh. Never shown without real data. */}
          {lockedInsight ? (
            // The card had no margin at all, so it sat flush against the cards
            // above and below while everything else in the list breathes. Same
            // rhythm as the rest now: a section's worth of air above, a card's
            // worth below.
            <Animated.View style={[styles.lockedCardWrap, rise(5)]}>
              <ProLockedCard
                language={language}
                teaser={lockedInsight.teaser}
                body={lockedInsight.body}
                onPress={() => setMomentSheetVisible(true)}
              />
            </Animated.View>
          ) : null}

          {/* Both of these lived on the guided finish step, which showed the
              same duration/sets/volume/coach as this screen and then handed
              straight over to it. They are the two things it had that this one
              did not, so they came across and that screen became the save. */}

          {nextUp ? (
            <Animated.View style={[styles.nextCard, rise(6)]}>
              <View style={styles.weekHeadRow}>
                <Text style={styles.nextKicker}>{t(language, 'complete.nextUp')}</Text>
                <Text style={styles.nextWeekday}>{nextUp.weekday.toUpperCase()}</Text>
              </View>
              <Text style={styles.nextName} numberOfLines={2}>
                {localizeSessionName(nextUp.name, language)}
              </Text>
            </Animated.View>
          ) : null}

          <Animated.View style={rise(6)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'complete.finish')}
              onPress={() => setFeelSheetVisible(true)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>{t(language, 'complete.finish')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </ScrollView>

      {/* One question on the way out (user 2026-08-23): how did it feel?
          Four colour-coded answers, and skipping costs one tap. The verdict
          is written onto the saved session.

          The ✕, the backdrop and Android's back close the sheet and nothing
          else — no answer is written, the summary is still there under it,
          and Done asks again. The backdrop once called onDone(null) and threw
          the answer away (user 2026-09-01), then refused with a shake, which
          left an accidental Done with no way back (#bugs 2026-09-24). Closing
          is the refusal that costs nothing. */}
      <KitSheet
        visible={feelSheetVisible}
        onClose={() => setFeelSheetVisible(false)}
        title={t(language, 'complete.feel.title')}
        bottomInset={insets.bottom}
        closeLabel={t(language, 'common.close')}
        reduceMotion={reduceMotion}
      >
        <View style={styles.feelOptions}>
          {/* Built from the shared scale so the sheet that collects the
              answer and the history that reads it back cannot drift — same
              four steps, same order, same colours. */}
          {SESSION_FEEL_SCALE.map((feel) => {
            const color = sessionFeelColor(theme, feel);
            const label = t(language, SESSION_FEEL_LABEL_KEY[feel]);
            return (
              <Pressable
                key={feel}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                  void haptics.select();
                  onDone(feel);
                }}
                style={({ pressed }) => [
                  styles.feelOption,
                  { borderColor: color },
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.feelDot, { backgroundColor: color }]} />
                <Text style={styles.feelOptionText}>{label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() => onDone(null)}
            style={styles.feelSkip}
            hitSlop={8}
          >
            <Text style={styles.feelSkipText}>{t(language, 'complete.feel.skip')}</Text>
          </Pressable>
        </View>
      </KitSheet>

      {lockedInsight ? (
        <ProMomentSheet
          visible={momentSheetVisible}
          content={lockedInsight.moment}
          language={language}
          bottomInset={insets.bottom}
          onClose={() => setMomentSheetVisible(false)}
          onSeePro={() => {
            setMomentSheetVisible(false);
            onOpenPremium?.();
          }}
        />
      ) : null}

      {/* The demo moment interrupts, on purpose. As a row in the list above it
          could be scrolled past, and three times per install is not something
          a reader may miss by not scrolling. `insets.bottom` is read HERE and
          passed down: inside a Modal this app measures it as zero. */}
      {demoQuestion ? (
        <CoachDemoSheet
          visible={demoSheetVisible}
          question={demoQuestion}
          language={language}
          bottomInset={insets.bottom}
          onSend={() => {
            setDemoSheetVisible(false);
            onSendDemoQuestion?.();
          }}
          onDismiss={() => setDemoSheetVisible(false)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  feelOptions: {
    paddingHorizontal: 18,
    gap: 10,
  },
  feelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: theme.surfaceSoft,
  },
  feelDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  feelOptionText: {
    color: theme.ink,
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '700',
  },
  feelSkip: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  feelSkipText: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  content: {
    paddingBottom: 26,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  hero: {
    overflow: 'hidden',
    alignItems: 'center',
    paddingBottom: 30,
    paddingHorizontal: 22,
  },
  badgeWrap: {
    width: 86,
    height: 86,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  badge: {
    width: 86,
    height: 86,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The lift is applied only to a FILLED seal. Android draws an elevation
  // shadow from the view's outline, and on a transparent circle it came out as
  // a dark octagon sitting behind the ring — a shape nobody drew, visible on
  // the phone and on nothing else.
  badgeLift: {
    shadowColor: '#5A3C0A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    elevation: 8,
  },
  heroKicker: {
    marginTop: 20,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 2.1,
    textTransform: 'uppercase',
  },
  heroTitle: {
    marginTop: 7,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  heroRule: {
    width: 34,
    height: 1,
    marginTop: 16,
    marginBottom: 14,
  },
  // A row with no give: a long program name ("Strong Chest Amateur — Päivä 1:
  // Kyykky & Penkki") pushed past both screen edges and the date went with it.
  // It wraps now, and the name can wrap inside itself, so nothing is ever cut.
  // A column, not a row: the design stacks the name over the date, and a long
  // programme name ("Strong Chest Amateur — Päivä 1: Kyykky & Penkki") used to
  // push both past the screen edges when they shared a line.
  heroSubRow: {
    alignItems: 'center',
    gap: 5,
  },
  heroSubName: {
    textAlign: 'center',
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },

  heroSubWhen: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  lockedCardWrap: {
    marginTop: 20,
    marginBottom: 12,
  },
  weekCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  /** At the top of the body it needs no lead-in gap; below it did. */
  weekCardTop: { marginTop: 0 },
  weekHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekKicker: {
    color: theme.purpleDark,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  weekCount: {
    color: theme.muted,
    fontSize: 11.5,
    fontWeight: '800',
  },
  weekBarRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 10,
  },
  weekBar: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: theme.border,
  },
  weekBarDone: {
    backgroundColor: theme.green,
  },
  nextCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  nextKicker: {
    color: theme.greenInk,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  nextWeekday: {
    color: theme.muted,
    fontSize: 11.5,
    fontWeight: '800',
  },
  nextName: {
    color: theme.ink,
    fontSize: 15.5,
    fontWeight: '800',
    marginTop: 6,
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  // Flat since 2026-08-23 ("voisiko olla vain asiat ilman laatikoita"):
  // the gold tile and the words carry the moment; the box carried nothing.
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 4,
  },
  noteIconTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteIconTileGold: {
    backgroundColor: GOLD_SOFT,
  },
  noteCopy: {
    flex: 1,
    minWidth: 0,
  },
  prEyebrow: {
    color: GOLD,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  noteTitle: {
    marginTop: 2,
    color: theme.ink,
    fontSize: 16.5,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  // The number the banner exists for: never clipped, and heavy enough to be
  // read before the sentence under it.
  prSet: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  noteSub: {
    marginTop: 2,
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  // Flat: three figures and their dividers, no box around them.
  statsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 17,
    paddingHorizontal: 6,
    marginTop: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: theme.ink,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  statLabel: {
    marginTop: 5,
    color: theme.faint,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  statDivider: {
    width: 1,
    height: 40,
    marginTop: 1,
    backgroundColor: HAIRLINE,
  },
  movedCard: {
    backgroundColor: theme.highlightSoft,
    borderWidth: 1,
    borderColor: theme.highlight,
    borderRadius: 18,
    padding: 14,
  },
  movedRowDivided: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 10, paddingTop: 10 },
  movedHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  movedName: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '800', color: theme.ink },
  movedDelta: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.highlight,
    fontVariant: ['tabular-nums'],
  },
  movedNudge: { marginTop: 4, fontSize: 13.5, fontWeight: '600', color: theme.muted, lineHeight: 19 },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 9,
    marginHorizontal: 4,
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  // Flat: the section label above already frames the content.
  sectionCard: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  exercisesCard: {
    paddingVertical: 6,
  },
  muscleRow: {},
  muscleRowSpaced: {
    marginTop: 13,
  },
  muscleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  muscleNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  muscleSwatch: { width: 9, height: 9, borderRadius: 999 },
  muscleName: {
    color: theme.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  muscleMetaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  musclePercent: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  muscleMeta: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  muscleTrack: {
    height: 9,
    borderRadius: 999,
    backgroundColor: theme.purpleSoft,
    overflow: 'hidden',
  },
  muscleFill: {
    height: 9,
    borderRadius: 999,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  exerciseRowDivided: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  exerciseCheckTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    // theme.greenSoft is the old fixed #E8F7EE in light; that left a pale tile
    // under a light-green tick in dark, 1.8:1 (#bugs 2026-10-01 audit).
    backgroundColor: theme.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseSkippedTile: {
    backgroundColor: theme.border,
  },
  exerciseSkippedDash: {
    width: 12,
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.muted,
  },
  exerciseNameSkipped: {
    color: theme.muted,
    fontWeight: '600',
  },
  exerciseCopy: {
    flex: 1,
    minWidth: 0,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  exerciseName: {
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  prBadge: {
    borderRadius: 999,
    backgroundColor: GOLD_SOFT,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  prBadgeText: {
    color: GOLD,
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  exerciseSets: {
    marginTop: 2,
    color: theme.faint,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  exerciseTopSet: {
    alignItems: 'flex-end',
  },
  exerciseTopSetValue: {
    color: theme.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  exerciseTopSetLabel: {
    color: theme.faint,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  primaryButton: {
    height: 54,
    borderRadius: 16,
    // The white-label violet: white on the dark theme's purpleBright is 2.7:1
    // (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    shadowColor: theme.purpleBright,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 26,
    elevation: 5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16.5,
    lineHeight: 21,
    fontWeight: '800',
  },
});
