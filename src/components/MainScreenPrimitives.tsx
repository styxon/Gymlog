import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { colors, radii, spacing } from '../theme';

export type SurfaceAccent = 'blue' | 'rose' | 'orange' | 'neutral';

const accentTokens: Record<SurfaceAccent, { border: string; accent: string; wash: string; kicker: string }> = {
  blue: {
    border: 'rgba(85, 138, 189, 0.30)',
    accent: colors.accentAlt,
    wash: 'rgba(85, 138, 189, 0.08)',
    kicker: '#9ACCFF',
  },
  rose: {
    border: 'rgba(191, 74, 105, 0.30)',
    accent: colors.feature,
    wash: 'rgba(191, 74, 105, 0.08)',
    kicker: '#F39AB2',
  },
  orange: {
    border: 'rgba(240, 106, 57, 0.30)',
    accent: '#F06A39',
    wash: 'rgba(240, 106, 57, 0.08)',
    kicker: '#FFB389',
  },
  neutral: {
    border: 'rgba(255,255,255,0.10)',
    accent: 'rgba(255,255,255,0.20)',
    wash: 'rgba(255,255,255,0.02)',
    kicker: colors.textMuted,
  },
};

export function BadgePill({
  label,
  accent = 'neutral',
  style,
  textStyle,
}: {
  label: string;
  accent?: SurfaceAccent;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const accentToken = accentTokens[accent];
  return (
    <View style={[styles.badge, { borderColor: accentToken.border, backgroundColor: accentToken.wash }, style]}>
      <Text style={[styles.badgeText, { color: accentToken.kicker }, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    justifyContent: 'center',
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
