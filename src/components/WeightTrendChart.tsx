/*
 * Violet, like every other chart on the tab.
 *
 * This line was theme.highlight, which is orange on the dark theme — so the
 * body-weight screen had an orange curve, an orange Log button and an orange
 * BMI band all claiming the same emphasis. The brief settles it: "The chart
 * line goes violet like every other chart, so the only orange thing on the
 * screen is Log."
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { WEIGHT_LABEL_WIDTH, WeightWindowDay, buildWeightAxisTicks, weightLabelIndexes, weightMarkersFit } from '../lib/bodyweightCard';
import { removeTrailingZeros } from '../lib/format';
import { queryReduceMotion } from '../utils/reduceMotion';
import { Theme, useTheme, useThemedStyles } from '../theming';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The weight curve over a run of CALENDAR days.
 *
 * Its own chart rather than `SimpleLineChart`, for one reason the shared one
 * cannot give: a day with no weigh-in has to keep its slot on the axis and
 * carry no point. The shared chart takes `{label, value}[]` and spaces the
 * entries evenly, so a gap of three weeks drew the same as a gap of one day —
 * and a single entry drew a flat line from edge to edge instead of one dot.
 */

const HEIGHT = 190;
const AXIS_WIDTH = 44;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
/**
 * Room for the newest dot.
 *
 * Every slot is drawn at its own centre, so the last one lands half a slot from
 * the right edge — fine at seven slots, and at ninety that half-slot is four
 * pixels and the dot (r5 + a 3px stroke) is sliced in half by the card. Read as
 * "pallo on ihan väärässä kohtaan" (user, 2026-08-25): it was not misplaced,
 * it was clipped.
 */
const PAD_RIGHT = 10;

interface WeightTrendChartProps {
  days: WeightWindowDay[];
}

export function WeightTrendChart({ days }: WeightTrendChartProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 1 ? current : next));
  };

  /**
   * The newest reading lands, it does not just be there. Saving a weigh-in no
   * longer shows a toast (user 2026-08-25) — the confirmation IS the dot
   * arriving on the line, so the latest dot scales in when its identity
   * changes. Keyed on the day and value, not on pixels: a relayout must not
   * replay the landing. One Animated.Value, driving props on ONE circle —
   * a node shared across views is the crash this app has already had.
   */
  const newest = [...days].reverse().find((day) => day.value !== null) ?? null;
  const newestKey = newest ? `${newest.dayStart}:${newest.value}` : null;
  const landAnim = useRef(new Animated.Value(1)).current;
  const seenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!newestKey || seenKeyRef.current === newestKey) {
      return;
    }
    const isFirstRender = seenKeyRef.current === null;
    seenKeyRef.current = newestKey;
    if (isFirstRender) {
      // Opening the screen is not a save; the chart arrives settled.
      landAnim.setValue(1);
      return;
    }
    let cancelled = false;
    void queryReduceMotion().then((reduced) => {
      if (cancelled) {
        return;
      }
      if (reduced) {
        landAnim.setValue(1);
        return;
      }
      landAnim.setValue(0);
      Animated.timing(landAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.3, 1.3, 0.5, 1),
        // SVG props cannot ride the native driver.
        useNativeDriver: false,
      }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [landAnim, newestKey]);

  const values = days.map((day) => day.value).filter((value): value is number => value !== null);
  const ticks = buildWeightAxisTicks(values);
  const axisWidth = AXIS_WIDTH;
  const plotWidth = Math.max(width - axisWidth - PAD_RIGHT, 1);
  const markersFit = weightMarkersFit(days.filter((day) => day.value !== null).length, plotWidth);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const max = ticks.length ? ticks[0] : 1;
  const min = ticks.length ? ticks[ticks.length - 1] : 0;
  const span = Math.max(max - min, 0.1);

  // Each day owns a slot and sits in its middle, so the first and last dots do
  // not hug the card's edges.
  const slot = plotWidth / days.length;
  const xFor = (index: number) => axisWidth + slot * index + slot / 2;
  const yFor = (value: number) => PAD_TOP + plotHeight - ((value - min) / span) * plotHeight;

  const plotted = days
    .map((day, index) => (day.value === null ? null : { x: xFor(index), y: yFor(day.value) }))
    .filter((point): point is { x: number; y: number } => point !== null);

  // Which days are labelled — the stride, today, and no neighbour under
  // today's label. The rule lives in the lib, where it is tested.
  const labelIndexes = new Set(
    weightLabelIndexes(
      days.length,
      days.findIndex((day) => day.isToday),
      plotWidth,
    ),
  );
  const showLabel = (_day: WeightWindowDay, index: number) => labelIndexes.has(index);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 ? (
        <>
          <Svg width={width} height={HEIGHT}>
            {ticks.map((tick) => (
              <Line
                key={tick}
                x1={axisWidth}
                x2={width}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke={theme.border}
                strokeWidth={1}
              />
            ))}
            {/* Two or more days with entries make a line; one makes a dot. */}
            {plotted.length > 1 ? (
              <Polyline
                points={plotted.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={theme.purple}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {/* The rings go when they stop fitting; the line does not change,
                and the newest weigh-in keeps its marker because it is the
                number the card is about. */}
            {plotted.map((point, index) =>
              index === plotted.length - 1 ? (
                <AnimatedCircle
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={landAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 5] })}
                  opacity={landAnim}
                  fill={theme.surface}
                  stroke={theme.purple}
                  strokeWidth={3}
                />
              ) : markersFit ? (
                <Circle
                  key={`${point.x}-${point.y}`}
                  cx={point.x}
                  cy={point.y}
                  r={5}
                  fill={theme.surface}
                  stroke={theme.purple}
                  strokeWidth={3}
                />
              ) : null,
            )}
          </Svg>

          {/* Numbers only. The unit was repeated on all seven ticks and
              wrapped onto its own line at "58,3 / cm", turning the axis into a
              column of debris — user, 2026-08-25 ("vasemmalla mittayksikkö
              pois"). The card's headline above already says the unit, once. */}
          <View style={styles.axisLabels} pointerEvents="none">
            {ticks.map((tick) => (
              <Text key={tick} style={[styles.axisLabel, { top: yFor(tick) - 8, width: axisWidth - 8 }]}>
                {removeTrailingZeros(tick)}
              </Text>
            ))}
          </View>

          <View style={styles.footer} pointerEvents="none">
            {days.map((day, index) =>
              showLabel(day, index) ? (
                <Text
                  key={day.dayStart}
                  style={[styles.footerLabel, day.isToday && styles.footerLabelToday, { left: xFor(index) - WEIGHT_LABEL_WIDTH / 2 }]}
                >
                  {day.label}
                </Text>
              ) : null,
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  wrap: {
    height: HEIGHT,
    marginTop: 12,
  },
  axisLabels: {
    ...StyleSheet.absoluteFillObject,
  },
  axisLabel: {
    position: 'absolute',
    left: 0,
    width: AXIS_WIDTH - 8,
    textAlign: 'right',
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.muted,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 2,
    height: 18,
  },
  footerLabel: {
    position: 'absolute',
    top: 0,
    // "26.7." needs more room than a bare day number did.
    width: WEIGHT_LABEL_WIDTH,
    textAlign: 'center',
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.faint,
  },
  footerLabelToday: {
    color: theme.purple,
    fontWeight: '800',
  },
});
