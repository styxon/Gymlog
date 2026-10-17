import React from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { Theme, useThemedStyles } from '../theming';

interface PrimaryCTAButtonProps {
  title: string;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Names what is still missing; shown under the button while disabled. */
  hint?: string | null;
  /** A screen's own face (StartPath's Manrope) for the label. */
  fontFamily?: string;
}

export function PrimaryCTAButton({
  title,
  onPress,
  disabled = false,
  style,
  hint,
  fontFamily,
}: PrimaryCTAButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const pressProgress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (disabled) {
      pressProgress.setValue(0);
    }
  }, [disabled, pressProgress]);

  const animatePress = (toValue: number) => {
    Animated.timing(pressProgress, {
      toValue,
      duration: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  // Interpolated once — per-render interpolations leak native animated nodes
  // (Fabric disconnectAnimatedNodes crash), and this button renders on
  // frequently updating screens.
  const animatedScale = React.useRef(
    pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }),
  ).current;
  const animatedOpacity = React.useRef(
    pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }),
  ).current;

  // With a hint the caller's style (width, margins) goes on the wrapper, so
  // the line lines up under the button instead of beside a narrowed one.
  const withHint = disabled && Boolean(hint);

  const button = (
    <Animated.View
      style={[
        styles.button,
        disabled && styles.buttonDisabled,
        !disabled && {
          opacity: animatedOpacity,
          transform: [{ scale: animatedScale }],
        },
        withHint ? null : style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => animatePress(1)}
        onPressOut={() => animatePress(0)}
        style={styles.pressable}
      >
        <Text style={[styles.label, fontFamily ? { fontFamily } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
      </Pressable>
    </Animated.View>
  );

  if (!withHint) {
    return button;
  }

  return (
    <View style={[styles.withHint, style]}>
      {button}
      <Text style={styles.hint} numberOfLines={2} accessibilityLiveRegion="polite">
        {hint}
      </Text>
    </View>
  );
}

// Flat CTA from the redesign handoff (onb-shared CTA spec): 56px pill, 17/800
// label. Orange: orange is what can be pressed and violet is the brand around
// it (user 2026-10-17 — #384 had taken it back to violet the day before).
// Disabled is the same orange dimmed, never grey.
const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      width: '100%',
      height: 56,
      borderRadius: 18,
      backgroundColor: theme.orange,
      shadowColor: theme.orange,
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 14 },
      elevation: 10,
    },
    buttonDisabled: {
      opacity: 0.4,
      shadowOpacity: 0,
      elevation: 0,
    },
    pressable: {
      width: '100%',
      height: '100%',
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    label: {
      // onHighlight is the label colour made for orange in both themes.
      color: theme.onHighlight,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '800',
      letterSpacing: 0.17,
      textAlign: 'center',
    },
    withHint: {
      width: '100%',
      gap: 8,
    },
    hint: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
