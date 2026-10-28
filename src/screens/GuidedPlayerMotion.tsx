import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/* ── icons ── */
export function GPIcon({ name, size = 22, color = '#fff', sw = 2.2 }: { name: string; size?: number; color?: string; sw?: number }) {
  const paths: Record<string, React.ReactNode> = {
    x: <Path d="M6 6l12 12M18 6L6 18" />,
    pause: <Path d="M9 5v14M15 5v14" />,
    play: <Path d="M8 5l11 7-11 7z" />,
    skip: <Path d="M5 5l9 7-9 7zM18 5v14" />,
    back: <Path d="M19 5l-9 7 9 7zM6 5v14" />,
    check: <Path d="M4.5 12.5l5 5L19.5 7" />,
    chevR: <Path d="M9 6l6 6-6 6" />,
    chevD: <Path d="M6 9l6 6 6-6" />,
    sound: (
      <>
        <Path d="M4 9v6h4l5 4V5L8 9z" />
        <Path d="M16.5 8.5a5 5 0 010 7" />
      </>
    ),
    mute: (
      <>
        <Path d="M4 9v6h4l5 4V5L8 9z" />
        <Path d="M17 9l4 6M21 9l-4 6" />
      </>
    ),
    plus: <Path d="M12 5v14M5 12h14" />,
    minus: <Path d="M5 12h14" />,
    // Pencil: the "this card opens" mark on a closed dial.
    edit: <Path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3" />,
    arrowUp: <Path d="M12 19V5M6 11l6-6 6 6" />,
    arrowDown: <Path d="M12 5v14M6 13l6 6 6-6" />,
    list: <Path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    // Two arrows passing: swapping one lift for another.
    swap: <Path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />,
    // The actions menu. It shared the list glyph with the swap button, and two
    // identical icons side by side is two buttons that look like one.
    dots: <Path d="M5 12h.01M12 12h.01M19 12h.01" />,
    video: (
      <>
        <Rect x="3" y="6.5" width="12.5" height="11" rx="3" />
        <Path d="M15.5 10.5l5-2.6v8.2l-5-2.6z" />
      </>
    ),
    clock: (
      <>
        <Circle cx="12" cy="12" r="8.5" />
        <Path d="M12 7.5V12l3 2" />
      </>
    ),
    shield: <Path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z" />,
    info: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 11v5.5M12 7.6v.1" />
      </>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}

/**
 * Whether the phone asks for less motion. StepIn and PopIn ran on every step
 * of every session regardless (accessibility audit, 2026-09-21). The exported
 * screen asks once — utils/reduceMotion, which always answers — and hands the
 * answer down here, rather than every StepIn asking the OS on every step
 * change. False until the answer comes: the entrance plays, the helper's safe
 * default.
 */
export const ReducedMotionContext = React.createContext(false);

/**
 * The ring's clock under the system font size. 76px in a 244dp ring had room
 * for about one step of scaling: at the accessibility sizes the digits ran
 * into the stroke and off the ring (accessibility audit, 2026-09-21). Capped
 * at 1.3×, and shrunk to fit beyond that rather than clipped.
 */
export const RING_CLOCK_FIT = {
  maxFontSizeMultiplier: 1.3,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.6,
} as const;

/* ── step entrance: fade + 14px rise ── */
export function StepIn({ children, stepKey, style }: { children: React.ReactNode; stepKey: string; style?: object }) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useContext(ReducedMotionContext);
  // Interpolated once: the player re-renders every second on the timer, and a
  // per-render interpolate leaks native nodes (disconnectAnimatedNodes crash).
  const translateY = useRef(anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })).current;
  useEffect(() => {
    // Reduced motion: the step is simply there. Also the answer arriving
    // mid-entrance, which finishes it at once.
    if (reduceMotion) {
      anim.stopAnimation();
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [anim, stepKey, reduceMotion]);
  return (
    <Animated.View style={[{ flex: 1, opacity: anim, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

/* ── pop-in for countdown digits / badges ── */
export function PopIn({ children, popKey }: { children: React.ReactNode; popKey: string | number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useContext(ReducedMotionContext);
  // Same rule as StepIn: one interpolation per value, never per render.
  const popStyle = useRef({
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  }).current;
  useEffect(() => {
    // A digit that scales up from 0.6 every second is exactly what reduced
    // motion asks to stop.
    if (reduceMotion) {
      anim.stopAnimation();
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 420,
      easing: Easing.bezier(0.3, 1.4, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [anim, popKey, reduceMotion]);
  return <Animated.View style={popStyle}>{children}</Animated.View>;
}
