import React, { useEffect, useRef } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Circle, Path } from 'react-native-svg';

import { t } from '../lib/i18n';
import { formatClock as formatTimer, formatEndsAt } from '../lib/restSchedule';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

interface RestBarProps {
  totalSeconds: number;
  remainingSeconds: number;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
  language?: AppLanguage;
  /**
   * The wall-clock end, when known. The eyebrow then reads "REST · ENDS 18:42"
   * — checkable against the gym clock, which a countdown alone never is after
   * any gap (design: Background Timer, "wall-clock bar").
   */
  endsAtMs?: number | null;
  /**
   * Seconds past the end. When set and > 0 the bar is in its DONE state: "REST
   * DONE · 2:14 AGO" with one action, log the set. Overrun is data, not an
   * error — the phone was in a pocket, and this is how long the rest really was.
   */
  overrunSeconds?: number | null;
  /** The done state's one action. */
  onLogSet?: () => void;
  /** What the done state names, e.g. "Set 3 · 60 kg × 8". */
  doneLabel?: string | null;
  /**
   * The bar's laid-out height, so the list behind it can reserve exactly that
   * much room. It is not a constant: the copy scales with the system font
   * size, and a screen that hard-codes a number gets covered at the large
   * accessibility sizes.
   */
  onMeasure?: (height: number) => void;
}

/**
 * How far the bar floats above the bottom of its container. Exported because
 * the room reserved for it is `REST_BAR_BOTTOM + measured height`, and the two
 * numbers have to agree.
 */
export const REST_BAR_BOTTOM = 30;

const formatClock = formatTimer;

/**
 * The pills are 34 tall, under the 44 a thumb needs. The slop makes up the
 * difference vertically; sideways it stops at 3 so two pills' slop never
 * meets across the 7 between them (accessibility audit, 2026-09-21).
 */
const PILL_SLOP = { top: 5, bottom: 5, left: 3, right: 3 } as const;

/**
 * Slim floating rest bar (AW3 design language): a violet pill above the
 * home indicator with the countdown, ±15s adjusters, Skip, and a thin
 * progress line. Shared by the freestyle logger; Active Workout v3 will
 * reuse it.
 */
export function RestBar({
  totalSeconds,
  remainingSeconds,
  onAdjust,
  onSkip,
  language = 'en',
  endsAtMs = null,
  overrunSeconds = null,
  onLogSet,
  doneLabel = null,
  onMeasure,
}: RestBarProps) {
  const styles = useThemedStyles(makeStyles);
  const measuredRef = useRef<number | null>(null);
  const handleLayout = (event: LayoutChangeEvent) => {
    // Fires every second the countdown re-renders; only a real change is worth
    // pushing up, or the list's padding restarts its layout pass each tick.
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (measuredRef.current !== height) {
      measuredRef.current = height;
      onMeasure?.(height);
    }
  };
  const slideIn = useRef(new Animated.Value(0)).current;
  // Interpolated once: the bar re-renders every second while the timer runs,
  // and a per-render interpolate leaks native nodes (disconnectAnimatedNodes).
  const slideInTranslate = useRef(
    slideIn.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }),
  ).current;

  useEffect(() => {
    Animated.timing(slideIn, {
      toValue: 1,
      duration: 380,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [slideIn]);

  const fraction = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 0;
  const done = typeof overrunSeconds === 'number' && overrunSeconds >= 0 && remainingSeconds <= 0;

  if (done) {
    return (
      <Animated.View
        style={[
          styles.bar,
          styles.barDone,
          { opacity: slideIn, transform: [{ translateY: slideInTranslate }] },
        ]}
        onLayout={handleLayout}
      >
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, styles.eyebrowDone]}>
              {t(language, 'rest.bar.doneAgo', { ago: formatClock(overrunSeconds ?? 0) })}
            </Text>
            <Text style={styles.time} numberOfLines={1}>
              {doneLabel ?? t(language, 'rest.bar.logSet')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'rest.bar.logSet')}
            hitSlop={{ top: 2, bottom: 2 }}
            onPress={onLogSet ?? onSkip}
            style={[styles.pill, styles.pillDone]}
          >
            <Text style={[styles.pillText, styles.pillTextOnGreen]}>{t(language, 'rest.bar.logSet')}</Text>
          </Pressable>
        </View>
        <View style={[styles.progressTrack, styles.progressTrackDone]} />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.bar,
        { opacity: slideIn, transform: [{ translateY: slideInTranslate }] },
      ]}
      onLayout={handleLayout}
    >
      <View style={styles.row}>
        <Svg viewBox="0 0 24 24" width={19} height={19} style={styles.clockIcon}>
          <Circle cx={12} cy={13.5} r={7} stroke="#FFFFFF" strokeWidth={2} fill="none" />
          <Path
            d="M10 2.5h4M12 2.5v4M12 10.5v3.5l2.2 1.6"
            stroke="#FFFFFF"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{t(language, 'rest.eyebrow')}</Text>
          <Text style={styles.time}>{formatClock(remainingSeconds)}</Text>
          {/* The wall-clock end on its own line: the copy column is narrow
              next to three pills, and "REST · ENDS 18:42" as one eyebrow wrapped
              to three lines on a 360dp phone. */}
          {endsAtMs ? (
            <Text style={styles.endsAt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {t(language, 'rest.bar.ends', { time: formatEndsAt(endsAtMs) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.pillRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'rest.a11y.shorten')} hitSlop={PILL_SLOP} onPress={() => onAdjust(-15)} style={styles.pill}>
            <Text style={styles.pillText}>−15s</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'rest.a11y.extend')} hitSlop={PILL_SLOP} onPress={() => onAdjust(15)} style={styles.pill}>
            <Text style={styles.pillText}>+15s</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(language, 'rest.a11y.skip')} hitSlop={PILL_SLOP} onPress={onSkip} style={[styles.pill, styles.pillSolid]}>
            <Text style={[styles.pillText, styles.pillTextSolid]}>{t(language, 'rest.skip')}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${fraction * 100}%` }]} />
      </View>
    </Animated.View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: REST_BAR_BOTTOM,
    zIndex: 8,
    borderRadius: 20,
    overflow: 'hidden',
    // The white-label violet (accessibility audit, 2026-09-21). On the dark
    // theme's purpleDark (#8B5CF6) the eyebrow was 2.69:1, "Päättyy" 2.58 and
    // the pills 3.29; everything written on this bar is white.
    backgroundColor: theme.purpleFill,
    shadowColor: '#3C1690',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 34,
    elevation: 12,
  },
  // Done: dark field, green edge — the same bar after the phone was in a
  // pocket. Not an alarm colour: the rest is over, nothing is wrong.
  barDone: {
    backgroundColor: '#1D1630',
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.35)',
    shadowColor: '#140C28',
  },
  eyebrowDone: {
    color: '#22C55E',
  },
  // #15803D, the light theme's action green: white on #16A34A was 3.30:1
  // (accessibility audit, 2026-09-21). The edge and the track below keep the
  // brighter green — nothing is written on them.
  pillDone: {
    backgroundColor: '#15803D',
    height: 40,
    paddingHorizontal: 16,
  },
  progressTrackDone: {
    backgroundColor: '#16A34A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  clockIcon: {
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  // .65 and .62 → .90 (accessibility audit, 2026-09-21): 10px type needs
  // 4.5:1, and the translucent whites were under it on the dark theme's bar.
  // .90 is 4.91 on the dark fill and 6.0 on the light one; the clock above
  // is still the brightest thing on the bar.
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.05,
    color: 'rgba(255,255,255,0.90)',
  },
  endsAt: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: 'rgba(255,255,255,0.90)',
    marginTop: 2,
  },
  time: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    lineHeight: 23,
  },
  // Padded and pulled back by the same 5, so the row is 44 tall without
  // moving: Android clips a hitSlop to its parent, and a 34-tall row would
  // have cut the pills' slop back to 34 (accessibility audit, 2026-09-21).
  pillRow: {
    flexDirection: 'row',
    gap: 7,
    paddingVertical: PILL_SLOP.top,
    marginVertical: -PILL_SLOP.top,
  },
  // The wash is .10, not .16: a lighter pill is a lower-contrast pill, and
  // white on .16 over the dark fill was 4.26:1. .10 is 4.77.
  pill: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  // Skip is the solid one of the three, and it is solid WHITE rather than
  // theme.surface. The bar it sits on is purple in both themes, so its
  // contents cannot follow the theme: surface is #FFFFFF on light — which is
  // what this was designed against — and #191436 on dark, where the pill
  // turned into a near-black hole punched in the bar, lettered in the same
  // purple as the bar behind it. Reported as "ohita nappi oudon värinen"
  // (2026-08-28) and confirmed on the emulator.
  pillSolid: {
    backgroundColor: '#FFFFFF',
  },
  pillText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pillTextSolid: {
    color: '#4C1D95',
  },
  // The done pill is green, not white: purpleDark on green is barely legible.
  pillTextOnGreen: {
    color: '#FFFFFF',
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  // Same rule as pillSolid: a light fill on the translucent white track. On
  // dark theme.surface drew the elapsed part of the rest almost black.
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
});
