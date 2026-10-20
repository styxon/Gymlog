import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { removeTrailingZeros } from '../lib/format';
import { rulerIndexOf, rulerStepCount, rulerValueAt, stepRulerValue } from '../lib/rulerValue';
import { haptics } from '../utils/haptics';
import { Theme, useThemedStyles, useTheme } from '../theming';

/**
 * The dragged ruler from Home Workout's weight logger (teardown 2026-08-13 —
 * the user's verdict on it was "erittäin hyvät loggaus järjestelmät ja tosi
 * selkeät", so it is taken as-is rather than reinterpreted).
 *
 * Why a ruler and not a text field: the app already asks for weight with a
 * numeric keypad, and a keypad is the wrong instrument for a number that moves
 * by 0.1 from a value you already know. The ruler opens ON the last value, so
 * the common case — "about the same as last time, maybe a little less" — is a
 * thumb-flick instead of a keyboard, a select-all and a retype.
 *
 * Built on a horizontal ScrollView rather than a PanResponder: the scroll view
 * brings momentum, deceleration and `snapToInterval` for free, and those three
 * are most of what makes the reference feel like a physical dial.
 */

/** Pixels between two steps. Wide enough that a 0.1 kg step is thumb-sized. */
const TICK_GAP = 12;
const MINOR_HEIGHT = 14;
const MAJOR_HEIGHT = 26;
const LABEL_HEIGHT = 22;
/**
 * The ruler's exact height, and the ScrollView is pinned to it.
 *
 * Letting the wrap be taller than the scroll view was the first version's bug:
 * the scroll view stretched to fill, its content stayed top-aligned inside it,
 * and the absolutely-positioned needle — anchored to the WRAP's bottom — ended
 * up hanging below the ticks it was supposed to be pointing at.
 */
const RULER_HEIGHT = LABEL_HEIGHT + MAJOR_HEIGHT + 6;
const TICK_WIDTH = 1.5;
/** Ticks kept rendered beyond each edge so a fast flick never shows a gap. */
const WINDOW_BUFFER = 24;
/** How far the scroll must travel before the window is recomputed. */
const WINDOW_STRIDE = 12;

interface RulerPickerProps {
  min: number;
  max: number;
  /** Smallest change the ruler can express — 0.1 for kg, 1 for cm. */
  step: number;
  /** How many steps between labelled major ticks. */
  majorEvery: number;
  value: number;
  onChange: (value: number) => void;
  /** Label under a major tick. Defaults to the rounded number. */
  formatMajor?: (value: number) => string;
  /**
   * What the ruler is standing on.
   *
   * 'surface' is the sheets' own ground, where grey ticks on white read fine.
   * 'inverse' is for a coloured panel — onboarding puts the dial on the brand
   * violet, and there the grey ticks all but vanished (user, 2026-09-09). The
   * marks separate by opacity instead of by hue, which is what works on a
   * saturated ground.
   */
  tone?: 'surface' | 'inverse';
  /**
   * What the ruler measures, for a screen reader — "Paino", "Pituus", the
   * measure's name. Required: the ruler is an adjustable control now, and an
   * adjustable with no name is "slider, 75 kg" of nothing in particular.
   */
  accessibilityLabel: string;
  /** Spoken after the value: "kg", "cm", "%". */
  unit: string;
}

export function RulerPicker({
  min,
  max,
  step,
  majorEvery,
  value,
  onChange,
  tone = 'surface',
  formatMajor,
  accessibilityLabel,
  unit,
}: RulerPickerProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [windowStart, setWindowStart] = useState(0);
  // The value the ruler last REPORTED. Without this the scroll handler fights
  // the prop on every frame: the parent re-renders, the effect below scrolls
  // back to the prop, and the dial sticks.
  const reportedRef = useRef(value);
  const settledRef = useRef(false);

  // The arithmetic lives in lib/rulerValue, shared with the screen-reader
  // steps below. Values are rebuilt from the index rather than accumulated,
  // so 0.1 steps do not drift into 74.30000000000001.
  const bounds = { min, max, step };
  const stepCount = rulerStepCount(bounds);
  const indexFor = (candidate: number) => rulerIndexOf(candidate, bounds);
  const valueFor = (index: number) => rulerValueAt(index, bounds);

  /**
   * A screen reader's swipe up or down: one mark, then the ruler scrolls to
   * it, exactly as if a thumb had moved it there (accessibility audit,
   * 2026-09-21). Reported first, so the scroll that follows reads as the
   * value already reported and does not call onChange a second time.
   */
  const stepBy = (direction: -1 | 1) => {
    const next = stepRulerValue(reportedRef.current, direction, bounds);
    if (Math.abs(next - reportedRef.current) < step / 2) {
      return;
    }
    reportedRef.current = next;
    const index = indexFor(next);
    if (width > 0) {
      setWindowStart(Math.max(0, index - Math.ceil(width / TICK_GAP / 2)));
      scrollRef.current?.scrollTo({ x: index * TICK_GAP, animated: false });
    }
    haptics.select();
    onChange(next);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 1 ? current : next));
  };

  // Jump to the incoming value once the width is known, and again whenever the
  // parent changes it from the outside (a unit switch rebuilds the scale).
  useEffect(() => {
    if (width <= 0) {
      return;
    }
    if (settledRef.current && Math.abs(reportedRef.current - value) < step / 2) {
      return;
    }
    const index = indexFor(value);
    reportedRef.current = value;
    settledRef.current = true;
    // Window first, then scroll: jumping to an offset whose ticks have not been
    // rendered yet shows an empty ruler for a frame.
    setWindowStart(Math.max(0, index - Math.ceil(width / TICK_GAP / 2)));
    scrollRef.current?.scrollTo({ x: index * TICK_GAP, animated: false });
  }, [value, width, min, max, step]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (width <= 0) {
        return;
      }
      const index = Math.min(stepCount, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / TICK_GAP)));
      // Re-window in chunks, not per step: sixty views is cheap to render, but
      // doing it on every one of the sixteen scroll events a second is not.
      setWindowStart((current) => {
        const anchor = Math.max(0, index - Math.ceil(width / TICK_GAP / 2));
        return Math.abs(anchor - current) >= WINDOW_STRIDE ? anchor : current;
      });
      const next = valueFor(index);
      if (Math.abs(next - reportedRef.current) < step / 2) {
        return;
      }
      reportedRef.current = next;
      // One tick of feedback per step, like a physical dial. `select` is the
      // lightest of the three and the only one that survives being fired
      // dozens of times in a flick without turning into a buzz.
      haptics.select();
      onChange(next);
    },
    [onChange, step, stepCount, width],
  );

  // Only the ticks near the viewport exist as views.
  //
  // THIS is what made the ruler feel dead on a real thumb. Weight runs 30–250
  // kg in 0.1 steps: 2201 tick views in a 26 412 px-wide scroll view. A
  // synthetic `adb input swipe` still moved it — the OS sets scroll offsets
  // whether or not the UI keeps up — so the failure never showed up in
  // automated checks and showed up on every finger. Windowing turns 2201 views
  // into about sixty and the arithmetic is the same either way, because ticks
  // are positioned by index rather than laid out in a row.
  const visibleFrom = Math.max(0, windowStart - WINDOW_BUFFER);
  const visibleTo = Math.min(stepCount, windowStart + Math.ceil(width / TICK_GAP) + WINDOW_BUFFER);
  const ticks = [];
  for (let index = visibleFrom; index <= visibleTo; index += 1) {
    const isMajor = index % majorEvery === 0;
    ticks.push(
      <View
        key={index}
        style={[
          styles.tick,
          {
            left: index * TICK_GAP - TICK_WIDTH / 2,
            height: isMajor ? MAJOR_HEIGHT : MINOR_HEIGHT,
            backgroundColor:
              tone === 'inverse'
                ? isMajor
                  ? 'rgba(255,255,255,0.92)'
                  : 'rgba(255,255,255,0.42)'
                : isMajor
                  ? theme.muted
                  : theme.border,
          },
        ]}
      />,
    );
  }

  const firstMajor = Math.floor(visibleFrom / majorEvery);
  const lastMajor = Math.ceil(visibleTo / majorEvery);
  const labels = [];
  for (let major = firstMajor; major <= lastMajor; major += 1) {
    const index = major * majorEvery;
    if (index > stepCount) {
      break;
    }
    const labelWidth = majorEvery * TICK_GAP;
    labels.push(
      <Text
        key={major}
        style={[
          styles.majorLabel,
          { width: labelWidth, left: index * TICK_GAP - labelWidth / 2 },
          tone === 'inverse' && styles.majorLabelInverse,
        ]}
      >
        {formatMajor ? formatMajor(valueFor(index)) : String(Math.round(valueFor(index)))}
      </Text>,
    );
  }

  return (
    // The ruler as ONE adjustable control. It was a bare horizontal scroll
    // view — no role, no value, no way to move it without a finger — and
    // About you keeps Continue shut until the weight is moved, so a
    // screen-reader user could not get past it (accessibility audit,
    // 2026-09-21).
    <View
      style={styles.wrap}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: `${removeTrailingZeros(value)} ${unit}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') {
          stepBy(1);
        } else if (event.nativeEvent.actionName === 'decrement') {
          stepBy(-1);
        }
      }}
    >
      {/* Labels ride above the ticks in the same coordinate space, so a label
          and its tick cannot drift apart when the font metrics change. */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        decelerationRate="fast"
        snapToInterval={TICK_GAP}
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: width / 2 }}
      >
        {/* Explicit width: with every child absolutely positioned there is
            nothing left to measure the scrollable extent from. */}
        <View style={{ width: stepCount * TICK_GAP + TICK_WIDTH, height: RULER_HEIGHT }}>
          {labels}
          {ticks}
        </View>
      </ScrollView>

      {/* The needle. Fixed, centred, drawn over the scroll view — the value is
          whatever is under it, which is what makes the thing read as a dial
          rather than as a slider with a handle. */}
      <View style={[styles.needle, tone === 'inverse' && styles.needleInverse]} pointerEvents="none" />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  wrap: {
    height: RULER_HEIGHT,
  },
  scroll: {
    height: RULER_HEIGHT,
  },
  majorLabel: {
    position: 'absolute',
    top: 0,
    textAlign: 'center',
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  tick: {
    position: 'absolute',
    // Positioned by index rather than laid out in a row: that is what lets the
    // window render sixty ticks and still have every one land on the pixel the
    // needle expects (content x = index * TICK_GAP).
    top: LABEL_HEIGHT,
    width: TICK_WIDTH,
    borderRadius: 1,
  },
  majorLabelInverse: {
    color: '#FFFFFF',
  },
  /** Solid white against ticks that are not: the needle wins on opacity. */
  needleInverse: {
    backgroundColor: '#FFFFFF',
  },
  needle: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1.25,
    // Exactly the major ticks' span: a needle that overshoots the scale reads
    // as a stray line rather than as the thing being pointed at.
    bottom: 6,
    width: 2.5,
    height: MAJOR_HEIGHT,
    borderRadius: 2,
    backgroundColor: theme.highlight,
  },
});
