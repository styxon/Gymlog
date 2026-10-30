import React from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { Theme, useTheme, useThemedStyles } from '../theming';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { niceTicks } from '../lib/chartTicks';
import { removeTrailingZeros } from '../lib/format';
import { colors, radii, spacing } from '../theme';

interface SimpleLineChartProps {
  points: { label: string; value: number }[];
  accent?: string;
  unitLabel?: string;
  yTickValues?: number[];
  formatValueLabel?: (value: number, unitLabel: string) => string;
  emptyLabel?: string;
  showLine?: boolean;
  footerLabels?: string[];
  tooltipFormatter?: (point: { label: string; value: number; index: number }) => { title: string; value?: string };
  showFooter?: boolean;
}

export function SimpleLineChart({
  points,
  accent = '#16A34A',
  unitLabel = 'kg',
  yTickValues,
  formatValueLabel,
  emptyLabel = 'No data yet',
  showLine = true,
  footerLabels,
  tooltipFormatter,
  showFooter = true,
}: SimpleLineChartProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [width, setWidth] = React.useState(0);
  const [selectedPointIndex, setSelectedPointIndex] = React.useState<number | null>(null);
  const height = 220;
  const leftAxisWidth = 44;
  const chartPadding = 16;
  const plotWidth = Math.max(width - leftAxisWidth - chartPadding, 1);
  const plotHeight = height - chartPadding * 2;
  const values = points.map((point) => point.value);
  // A metric that is zero everywhere has no trend to draw, and the scale code
  // below cannot say so: with every value at 0 it pads to a 0–1 kg axis, which
  // reads as "your squat is somewhere under a kilo". Real case, not a corner
  // one — bodyweight work, or any session logged without entering loads.
  const hasSomethingToPlot = values.some((value) => value !== 0);
  const firstValue = values[0] ?? 0;
  const explicitTickMin = yTickValues?.length ? Math.min(...yTickValues) : null;
  const explicitTickMax = yTickValues?.length ? Math.max(...yTickValues) : null;
  const rawMax = values.length ? Math.max(...values) : firstValue;
  const rawMin = values.length ? Math.min(...values) : firstValue;
  const rawSpread = Math.max(Math.abs(rawMax - rawMin), Math.max(1, Math.abs(firstValue) * 0.08));
  const padding = Math.max(1, rawSpread * 0.18);
  // Without caller ticks the axis runs on rounded values (70 / 72.5 / 75),
  // not on the padded data range (68.88 / 71.71 ...).
  const niceAxis =
    !(yTickValues && yTickValues.length > 1) && hasSomethingToPlot
      ? niceTicks(Math.max(0, rawMin - padding), rawMax + padding, 5)
      : [];
  const useNiceAxis = niceAxis.length > 1;
  const max = explicitTickMax ?? (useNiceAxis ? niceAxis[niceAxis.length - 1] : rawMax + padding);
  const min = explicitTickMin ?? (useNiceAxis ? niceAxis[0] : Math.max(0, rawMin - padding));
  const spread = Math.max(max - min, 1);
  const plotLeft = leftAxisWidth;
  const tickRatios = [0, 1 / 3, 2 / 3, 1];
  const axisValues = yTickValues && yTickValues.length > 1 ? yTickValues : useNiceAxis ? niceAxis : null;
  // The unit is said once, above the axis, when the ticks are bare numbers.
  const unitOnCaption = !formatValueLabel && useNiceAxis;
  const yTicks =
    axisValues
      ? axisValues.map((value) => ({
          y: chartPadding + plotHeight - ((value - min) / spread) * plotHeight,
          value,
        }))
      : tickRatios.map((ratio) => ({
          ratio,
          y: chartPadding + plotHeight * ratio,
          value: max - spread * ratio,
        }));

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const coordinates = points.map((point, index) => {
    const x = plotLeft + (points.length === 1 ? plotWidth / 2 : (index / Math.max(points.length - 1, 1)) * plotWidth);
    const y = chartPadding + plotHeight - ((point.value - min) / spread) * plotHeight;
    return { ...point, x, y };
  });
  const selectedPoint = selectedPointIndex !== null ? coordinates[selectedPointIndex] : null;
  const tooltip = selectedPoint && tooltipFormatter
    ? tooltipFormatter({ label: selectedPoint.label, value: selectedPoint.value, index: selectedPointIndex ?? 0 })
    : null;
  const resolvedFooterLabels = footerLabels?.filter(Boolean).length
    ? footerLabels.filter(Boolean)
    : [points[0]?.label ?? '', points[points.length - 1]?.label ?? ''].filter(Boolean);

  React.useEffect(() => {
    setSelectedPointIndex(null);
  }, [points]);

  return (
    <View style={styles.wrapper}>
      {unitOnCaption && points.length && unitLabel ? <Text style={styles.unitCaption}>{unitLabel}</Text> : null}
      {/* Measured here, not on the wrapper: onLayout reports the border box,
          so measuring the padded wrapper made the Svg ~2x padding too wide and
          the last point was drawn past the card and clipped away. */}
      <View style={styles.chartFrame} onLayout={handleLayout}>
        {width > 0 ? (
          <>
            {points.length && hasSomethingToPlot ? (
              <>
                <View pointerEvents="none" style={styles.axisLabels}>
                  {yTicks.map((tick) => (
                    <Text
                      key={`${tick.value}`}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={[styles.valueLabel, { top: tick.y - 8 }]}
                    >
                      {formatValueLabel
                        ? formatValueLabel(tick.value, unitLabel)
                        : unitOnCaption
                          ? removeTrailingZeros(tick.value)
                          : `${removeTrailingZeros(tick.value)} ${unitLabel}`}
                    </Text>
                  ))}
                </View>
                <Svg width={width} height={height}>
                  {yTicks.map((tick) => (
                    <Line
                      key={`${tick.value}`}
                      x1={plotLeft}
                      x2={width - chartPadding}
                      y1={tick.y}
                      y2={tick.y}
                      stroke={theme.border}
                      strokeWidth={1}
                    />
                  ))}
                  {/* A line needs two entries to mean anything. With one, a
                      stroke would imply a trend across a span the user has not
                      logged, so a single entry stays a lone dot. */}
                  {showLine && coordinates.length > 1 ? (
                    <Polyline
                      points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      stroke={accent}
                      strokeWidth={3}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ) : null}
                  {/* Every logged entry gets its own marker, so the line reads
                      as the entries it was drawn from rather than a smooth
                      curve with invented points along the way.

                      Two passes rather than a Fragment per point: react-native-svg
                      does not render Fragments as children, and wrapping the pair
                      silently dropped every marker. */}
                  {coordinates.map((point, index) => (
                    <Circle
                      key={`halo-${point.label}-${point.value}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={7}
                      fill="#FFFFFF"
                    />
                  ))}
                  {coordinates.map((point, index) => (
                    <Circle
                      key={`dot-${point.label}-${point.value}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r={coordinates.length === 1 ? 6 : 4.5}
                      fill={accent}
                      onPress={() => setSelectedPointIndex((current) => (current === index ? null : index))}
                    />
                  ))}
                </Svg>
                {tooltip && selectedPoint ? (
                  <Pressable
                    style={[
                      styles.tooltipBubble,
                      {
                        left: Math.min(Math.max(selectedPoint.x - 52, plotLeft), Math.max(plotLeft, width - 112)),
                        top: Math.max(4, selectedPoint.y - 58),
                      },
                    ]}
                    onPress={() => setSelectedPointIndex(null)}
                  >
                    <Text style={styles.tooltipTitle}>{tooltip.title}</Text>
                    {tooltip.value ? <Text style={styles.tooltipValue}>{tooltip.value}</Text> : null}
                  </Pressable>
                ) : null}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{emptyLabel}</Text>
              </View>
            )}
          </>
        ) : null}
      </View>
      {points.length && hasSomethingToPlot && showFooter ? (
        <View
          style={[
            styles.footer,
            resolvedFooterLabels.length === 1 && styles.footerSingle,
            resolvedFooterLabels.length === 3 && styles.footerThreeUp,
          ]}
        >
          {resolvedFooterLabels.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              style={[
                styles.dateLabel,
                resolvedFooterLabels.length === 3 && index === 1 && styles.dateLabelCentered,
              ]}
            >
              {label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrapper: {
      overflow: 'hidden',
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    chartFrame: {
      minHeight: 220,
    },
    emptyState: {
      minHeight: 220,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: theme.muted,
      fontSize: 13,
      fontWeight: '700',
    },
    axisLabels: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 44,
      height: 220,
    },
    unitCaption: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: '700',
    },
    valueLabel: {
      position: 'absolute',
      left: 0,
      width: 40,
      color: theme.muted,
      fontSize: 11,
      fontWeight: '600',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingLeft: 44,
    },
    footerSingle: {
      justifyContent: 'center',
      paddingLeft: 0,
    },
    footerThreeUp: {
      alignItems: 'center',
    },
    tooltipBubble: {
      position: 'absolute',
      minWidth: 96,
      maxWidth: 128,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#DCFCE7',
      backgroundColor: theme.greenSoft,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 3,
    },
    tooltipTitle: {
      color: theme.greenInk,
      fontSize: 11,
      fontWeight: '800',
    },
    tooltipValue: {
      color: theme.ink,
      fontSize: 12,
      fontWeight: '900',
      marginTop: 2,
    },
    dateLabel: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '600',
    },
    dateLabelCentered: {
      textAlign: 'center',
    },
  });
