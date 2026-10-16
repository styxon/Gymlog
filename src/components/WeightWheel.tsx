import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { CutSurface } from './CutSurface';
import {
  WHEEL_OFFSETS,
  WheelBounds,
  WheelColumn,
  dragSteps,
  stepWeight,
  tenthRows,
  wholeRows,
} from '../lib/weightWheel';
import { haptics } from '../utils/haptics';

/**
 * "Rulla": whole kg and tenths as two wheels under one selection band.
 *
 * Tap a row to select it, or drag a column (one step per 50 px). Every step
 * ticks the central haptics gate. The wheel is always dark: it sits on its own
 * violet ground so it reads the same in either app theme.
 */

const MONO = 'JetBrainsMono';
const ROW_H = 50;
const AREA_H = 250;

const COLORS = {
  ground: '#191436',
  band: '#2C2350',
  ink: '#F4F1FF',
  muted: '#A79FC4',
};

/** Size, colour and opacity by distance from the middle row. */
const BY_DISTANCE = [
  { size: 40, color: COLORS.ink, opacity: 1 },
  { size: 26, color: COLORS.muted, opacity: 0.6 },
  { size: 20, color: COLORS.muted, opacity: 0.25 },
] as const;

interface WeightWheelProps extends WheelBounds {
  value: number;
  onChange: (kg: number) => void;
  accessibilityLabel: string;
  /** The label font (Manrope), for the unit. */
  fontFamily?: string;
}

export function WeightWheel({ value, min, max, onChange, accessibilityLabel, fontFamily }: WeightWheelProps) {
  const bounds = useMemo(() => ({ min, max }), [min, max]);
  const live = useRef({ value, onChange, bounds });
  live.current = { value, onChange, bounds };

  const move = (column: WheelColumn, from: number, steps: number) => {
    const next = stepWeight(from, column, steps, live.current.bounds);
    if (next !== live.current.value) {
      haptics.select();
      live.current.value = next;
      live.current.onChange(next);
    }
  };

  const wholes = wholeRows(value, bounds);
  const tenths = tenthRows(value, bounds);

  return (
    <View
      style={styles.panel}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: `${value} kg` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => move('tenth', live.current.value, event.nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      <View style={styles.area}>
        <View style={styles.band} pointerEvents="none">
          <CutSurface size="md" fill={COLORS.band} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.columns}>
          <View style={styles.wholeCol}>
            <Column
              column="whole"
              labels={wholes.map((w) => (w === null ? '' : String(w)))}
              align="flex-end"
              onMove={move}
              liveValue={live}
            />
          </View>
          <View style={styles.dotCol}>
            <Text style={styles.dot}>.</Text>
          </View>
          <View style={styles.tenthCol}>
            <Column
              column="tenth"
              labels={tenths.map(String)}
              align="flex-start"
              onMove={move}
              liveValue={live}
            />
          </View>
          <View style={styles.unitCol}>
            <Text style={[styles.unit, { fontFamily }]}>kg</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

interface ColumnProps {
  column: WheelColumn;
  labels: string[];
  align: 'flex-start' | 'flex-end';
  onMove: (column: WheelColumn, from: number, steps: number) => void;
  liveValue: React.MutableRefObject<{ value: number; bounds: WheelBounds }>;
}

function Column({ column, labels, align, onMove, liveValue }: ColumnProps) {
  const startValue = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startValue.current = liveValue.current.value;
        },
        onPanResponderMove: (_e, g) => {
          onMove(column, startValue.current, dragSteps(g.dy));
        },
      }),
    // The handlers read refs; the responder itself never needs rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [column],
  );

  return (
    <View style={styles.column} {...responder.panHandlers}>
      {WHEEL_OFFSETS.map((offset, index) => {
        const look = BY_DISTANCE[Math.abs(offset)];
        const label = labels[index];
        return (
          <Pressable
            key={offset}
            accessible={false}
            importantForAccessibility="no"
            disabled={offset === 0 || label === ''}
            onPress={() => onMove(column, liveValue.current.value, offset)}
            style={[styles.row, { alignItems: align }]}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontWeight: '800',
                fontSize: look.size,
                color: look.color,
                opacity: look.opacity,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: COLORS.ground,
    borderRadius: 20,
    overflow: 'hidden',
    marginTop: 14,
  },
  area: {
    height: AREA_H,
    marginTop: 0,
  },
  band: {
    position: 'absolute',
    top: 101,
    left: 0,
    right: 0,
    height: 48,
  },
  columns: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  wholeCol: { width: 110 },
  dotCol: { width: 16, justifyContent: 'center', alignItems: 'center' },
  tenthCol: { width: 56 },
  unitCol: { width: 50, justifyContent: 'center' },
  column: { height: AREA_H },
  row: { height: ROW_H, justifyContent: 'center', paddingHorizontal: 4 },
  dot: { fontFamily: MONO, fontWeight: '800', fontSize: 34, color: COLORS.ink, lineHeight: 40 },
  unit: { fontWeight: '800', fontSize: 18, color: COLORS.muted },
});
