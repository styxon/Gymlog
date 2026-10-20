import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AnimatedText } from '../components/AnimatedText';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VinhaWordmark } from '../components/VinhaWordmark';
import {
  EASE_ARRIVE,
  EASE_SETTLE,
  EASE_STREAK,
  EASE_SWEEP,
  HANDOFF_NUDGE,
  MARK_CENTER_SPLASH,
  MARK_CENTER_WELCOME,
  MARK_SIZE,
  STREAKS,
  T,
  markSlotTop,
  scaleY,
} from '../components/vinhaMotion';
import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { queryReduceMotion } from '../utils/reduceMotion';

/**
 * The launch sequence (spec: "Vinha — splash & welcome animation spec").
 *
 * Objects streak past at different speeds and the wordmark arrives last and
 * fastest: the name is *vinha*, so it is demonstrated rather than explained.
 *
 * Three details carry the whole thing:
 *
 *   The mark overshoots. It passes centre by 16 px and comes back, which is
 *   what makes it read as having travelled rather than faded in.
 *
 *   The ghosts die 4 px short of centre, so only the real mark lands.
 *
 *   At the hand-off the mark decelerates while the "app" tag accelerates away.
 *   Same 700 ms, opposite feel — one is arriving, the other is leaving.
 *
 * This runs after the native splash, not instead of it, and it never blocks:
 * the screen only mounts once the app is already ready to draw.
 */
interface VinhaSplashScreenProps {
  language?: AppLanguage;
  /** Called once the mark has settled where Welcome will draw it. */
  onDone: () => void;
}

export function VinhaSplashScreen({ language = 'en', onDone }: VinhaSplashScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  // The slogan sat at a fixed distance from the bottom EDGE and the Android
  // navigation bar covered it. Welcome's tagline already adds the inset.
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  // Held in a ref: the parent passes a fresh closure every render, and
  // depending on it restarted the hand-off timer each time.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const streaks = useRef(STREAKS.map(() => new Animated.Value(0))).current;
  const mark = useRef(new Animated.Value(0)).current;
  const ghosts = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const slogan = useRef(new Animated.Value(0)).current;
  const handoff = useRef(new Animated.Value(0)).current;

  // Travel is measured on the reference canvas and stretched to the device, so
  // a wider screen does not leave the bars finishing early.
  const travelIn = -220 - width * 0.1;
  const travelOut = width + 40;

  const geometry = useMemo(
    () => ({
      slotFrom: markSlotTop(height, MARK_CENTER_SPLASH),
      slotTo: markSlotTop(height, MARK_CENTER_WELCOME),
      sloganBottom: scaleY(height, 34) + insets.bottom,
    }),
    [height, insets.bottom],
  );

  const streakSweeps = useMemo(
    () =>
      STREAKS.map((_, index) =>
        streaks[index].interpolate({ inputRange: [0, 1], outputRange: [travelIn, travelOut] }),
      ),
    [streaks, travelIn, travelOut],
  );
  const streakFades = useMemo(
    () =>
      STREAKS.map((bar, index) =>
        streaks[index].interpolate({
          inputRange: [0, 0.12, 0.8, 1],
          outputRange: [0, bar.opacity, bar.opacity, 0],
        }),
      ),
    [streaks],
  );

  // Interpolated once — an inline .interpolate() rebuilds native animated nodes
  // every frame, which is the crash this app already paid for.
  const markX = useRef(mark.interpolate({ inputRange: [0, 0.72, 1], outputRange: [-340, 16, 0] })).current;
  const markSkew = useRef(
    mark.interpolate({ inputRange: [0, 0.72, 1], outputRange: ['-16deg', '-3deg', '0deg'] }),
  ).current;
  const markFade = useRef(mark.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] })).current;

  const ghostX = useRef(
    ghosts.map((value) => value.interpolate({ inputRange: [0, 1], outputRange: [-380, -4] })),
  ).current;
  const ghostSkew = useRef(
    ghosts.map((value) =>
      value.interpolate({ inputRange: [0, 0.8, 1], outputRange: ['-16deg', '-3deg', '0deg'] }),
    ),
  ).current;
  const ghostFade = useRef(
    ghosts.map((value) =>
      value.interpolate({ inputRange: [0, 0.35, 0.8, 1], outputRange: [0, 0.9, 0.25, 0] }),
    ),
  ).current;

  const sweepX = useRef(sweep.interpolate({ inputRange: [0, 1], outputRange: [-200, width + 110] })).current;
  const sweepFade = useRef(sweep.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] })).current;
  const sloganY = useRef(slogan.interpolate({ inputRange: [0, 1], outputRange: [10, 0] })).current;

  // The hand-off. The mark lifts to Welcome's anchor and nudges right as the
  // tag leaves, which re-centres the lockup optically once "app" is gone.
  const slotTop = useRef(
    handoff.interpolate({ inputRange: [0, 1], outputRange: [geometry.slotFrom, geometry.slotTo] }),
  ).current;
  const handoffX = useRef(
    handoff.interpolate({ inputRange: [0, 1], outputRange: [0, HANDOFF_NUDGE] }),
  ).current;
  const sloganOut = useRef(handoff.interpolate({ inputRange: [0, 0.29, 1], outputRange: [1, 0, 0] })).current;
  const sloganOpacity = useRef(Animated.multiply(slogan, sloganOut)).current;

  useEffect(() => {
    let cancelled = false;
    queryReduceMotion().then((enabled) => {
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

    // Reduced motion keeps only the slogan fade and the cross-fade to Welcome:
    // the streaks, the overshoot, the ghosts and the sweep are skipped, and the
    // mark simply sits where it belongs.
    if (reduceMotion) {
      mark.setValue(1);
      Animated.timing(slogan, { toValue: 1, duration: 400, useNativeDriver: false }).start();
      const timer = setTimeout(() => {
        Animated.timing(handoff, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start(() => onDoneRef.current());
      }, 900);
      return () => clearTimeout(timer);
    }

    Animated.parallel([
      ...STREAKS.map((bar, index) =>
        Animated.timing(streaks[index], {
          toValue: 1,
          duration: bar.ms,
          delay: bar.delay,
          easing: EASE_STREAK,
          useNativeDriver: true,
        }),
      ),
      // JS driver, deliberately: this group animates skewX and, at the
      // hand-off, `top` — neither of which the native driver accepts — and
      // every value here shares a transform array with the others. Mixing the
      // two drivers in one array is a hard crash, not a degradation.
      ...ghosts.map((value, index) =>
        Animated.timing(value, {
          toValue: 1,
          duration: T.markDuration,
          delay: T.markDelay + index * T.ghostStagger,
          easing: EASE_ARRIVE,
          useNativeDriver: false,
        }),
      ),
      Animated.timing(mark, {
        toValue: 1,
        duration: T.markDuration,
        delay: T.markDelay,
        easing: EASE_ARRIVE,
        useNativeDriver: false,
      }),
      Animated.timing(sweep, {
        toValue: 1,
        duration: T.sweepDuration,
        delay: T.sweepDelay,
        easing: EASE_SWEEP,
        useNativeDriver: true,
      }),
      // Shares its opacity with the hand-off value, so it follows that driver.
      Animated.timing(slogan, {
        toValue: 1,
        duration: T.sloganDuration,
        delay: T.sloganDelay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();

    const timer = setTimeout(() => {
      // `top` is not a transform, so this one leaves the native driver. It is a
      // single element for 700 ms, which is the price of the mark not jumping.
      Animated.timing(handoff, {
        toValue: 1,
        duration: T.handoffDuration,
        easing: EASE_SETTLE,
        useNativeDriver: false,
      }).start(() => onDoneRef.current());
    }, T.handoffAt);
    return () => clearTimeout(timer);
  }, [ghosts, handoff, mark, reduceMotion, slogan, streaks, sweep]);

  if (reduceMotion === null) {
    return <View style={styles.screen} />;
  }

  return (
    <View style={styles.screen}>
      {!reduceMotion
        ? STREAKS.map((bar, index) => (
            <Animated.View
              key={bar.y}
              style={[
                styles.bar,
                {
                  top: scaleY(height, bar.y),
                  width: bar.width,
                  height: bar.height,
                  opacity: streakFades[index],
                  backgroundColor: bar.accent ? styles.accent.color : styles.ink.color,
                  transform: [{ translateX: streakSweeps[index] }],
                },
              ]}
            />
          ))
        : null}

      <Animated.View style={[styles.markSlot, { top: slotTop, height: MARK_SIZE }]}>
        {!reduceMotion
          ? ghosts.map((_, index) => (
              <Animated.View
                key={index}
                pointerEvents="none"
                style={[
                  styles.ghost,
                  {
                    opacity: ghostFade[index],
                    transform: [{ translateX: ghostX[index] }, { skewX: ghostSkew[index] }],
                  },
                ]}
              >
                <VinhaWordmark
                  size={MARK_SIZE}
                  fitness
                  color={styles.ghostInk.color}
                  accentColor={styles.ghostAccent.color}
                />
              </Animated.View>
            ))
          : null}

        <Animated.View
          style={{
            opacity: markFade,
            transform: [{ translateX: markX }, { translateX: handoffX }, { skewX: markSkew }],
          }}
        >
          {/* The full lockup (brand variant A): this is the first time the
              name is said, so it is said in full. Inside the app it is "Vinha". */}
          <VinhaWordmark size={MARK_SIZE} fitness />
        </Animated.View>
      </Animated.View>

      {!reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.sweep, { opacity: sweepFade, transform: [{ translateX: sweepX }] }]}
        >
          <Svg width={180} height={height}>
            <Defs>
              <LinearGradient id="vinhaSweep" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={styles.accent.color} stopOpacity={0} />
                <Stop offset="0.6" stopColor={styles.accent.color} stopOpacity={0.1} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.9} />
              </LinearGradient>
            </Defs>
            <Rect width={180} height={height} fill="url(#vinhaSweep)" />
          </Svg>
        </Animated.View>
      ) : null}

      <AnimatedText
        style={[
          styles.slogan,
          { bottom: geometry.sloganBottom, opacity: sloganOpacity, transform: [{ translateY: sloganY }] },
        ]}
      >
        {t(language, 'brand.tagline')}
      </AnimatedText>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
      overflow: 'hidden',
    },
    bar: {
      position: 'absolute',
      left: 0,
      borderRadius: 999,
    },
    // `color` rather than backgroundColor: these are read as values, not applied.
    accent: {
      color: theme.purple,
    },
    ink: {
      color: theme.ink,
    },
    ghostInk: {
      color: theme.faint,
    },
    ghostAccent: {
      color: theme.purpleLight,
    },
    markSlot: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghost: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sweep: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: 180,
    },
    slogan: {
      position: 'absolute',
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: 12.5,
      fontWeight: '700',
      letterSpacing: 2.7,
      textTransform: 'uppercase',
      color: theme.faint,
    },
  });
