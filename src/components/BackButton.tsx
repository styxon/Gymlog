import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * The pushed screen's way back (owner-approved, 2026-10-19): a round 40px
 * button, `surfaceSoft`, no border, an ink chevron. The label is the caller's
 * (`t(language, 'common.back')`), since a component has no language of its own.
 */
export function BackButton({
  onPress,
  accessibilityLabel,
  style,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.back, style, pressed && styles.pressed]}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d="M15 5l-7 7 7 7" stroke={theme.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

/**
 * The header row of a list/menu screen: a left-aligned 28/800 title and, on a
 * pushed screen, the round back button on the SAME row. Both are ordinary
 * flex children, so neither can sit over the other (headerBackReachable).
 * No decorative subtitle: a screen that needs one says it in its content.
 */
export function PageHeader({
  title,
  onBack,
  backLabel,
  backTestID,
  right,
  style,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  backTestID?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.header, style]}>
      {onBack ? <BackButton onPress={onBack} accessibilityLabel={backLabel ?? ''} testID={backTestID} /> : null}
      <Text accessibilityRole="header" style={styles.title}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: theme.controlFill,
    borderWidth: 1,
    borderColor: theme.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
});
