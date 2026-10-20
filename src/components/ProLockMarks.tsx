import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Path, Rect } from 'react-native-svg';

import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * The padlock and the PRO pill every locked surface wears.
 *
 * Their own module because both locked cards need them and one of those cards
 * needs the other's blur: ProLockedCard imports BlurredPreview, BlurredPreview
 * imports these, and with the marks living in ProLockedCard that was a cycle.
 */
export function ProLockIcon({ color: colorProp, size = 13 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.proInk;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={11} width={14} height={9} rx={2.5} stroke={color} strokeWidth={2.3} />
      <Path d="M8.5 11V8a3.5 3.5 0 017 0v3" stroke={color} strokeWidth={2.3} strokeLinecap="round" />
    </Svg>
  );
}

export function ProPill({ label = 'PRO' }: { label?: string }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pill: {
      // The white-label violet (accessibility audit, 2026-09-21).
      backgroundColor: theme.purpleFill,
      borderRadius: 6,
      paddingVertical: 3,
      paddingHorizontal: 7,
    },
    pillText: {
      color: '#FFFFFF',
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 1,
    },
  });
