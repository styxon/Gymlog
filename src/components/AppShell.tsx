import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Edge, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { radii, spacing } from '../theme';

interface AppShellProps {
  children: React.ReactNode;
  tabBar?: React.ReactNode;
  /**
   * Drawn after the bar, so it can point at the bar. The first-run tour is
   * the one thing here; it is `box-none`, so it never takes a touch the page
   * or the bar was going to get.
   */
  overlay?: React.ReactNode;
  /**
   * Over everything, the status bar and the home indicator included, outside
   * the safe area and the keyboard lift: what would otherwise be a Modal. See
   * InTreeLayer for why a wall is drawn here on iOS rather than presented.
   */
  topLayer?: React.ReactNode;
  /**
   * Something in `topLayer` is up: the rest of the shell is hidden from
   * VoiceOver and TalkBack, as a Modal would hide it.
   */
  topLayerActive?: boolean;
  toastMessage?: string | null;
  safeAreaEdges?: Edge[];
  statusBarStyleOverride?: 'light' | 'dark';
  statusBarBackgroundColor?: string;
  statusBarTranslucent?: boolean;
  shellBackgroundColor?: string;
}

export function AppShell({
  children,
  tabBar,
  overlay,
  topLayer,
  topLayerActive = false,
  toastMessage,
  safeAreaEdges = ['top', 'left', 'right', 'bottom'],
  statusBarStyleOverride,
  statusBarBackgroundColor,
  statusBarTranslucent = false,
  shellBackgroundColor,
}: AppShellProps) {
  const theme = useTheme();
  const themeName = useThemeName();
  const styles = useThemedStyles(makeStyles);
  const shellBackground = shellBackgroundColor ?? theme.bg;
  // Status-bar icons follow the theme, not a fixed default. Hardcoding 'dark'
  // here was right while the app was light-only; under the dark theme it would
  // paint near-black icons on a near-black bar. Screens that want the other
  // treatment — the gradient heroes — still override it explicitly.
  const statusBarStyle = statusBarStyleOverride ?? (themeName === 'dark' ? 'light' : 'dark');

  return (
    <SafeAreaProvider style={[styles.root, { backgroundColor: shellBackground }]}>
      <StatusBar
        style={statusBarStyle}
        translucent={statusBarTranslucent}
        backgroundColor={statusBarBackgroundColor ?? shellBackground}
      />
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: shellBackground }]}
        edges={safeAreaEdges}
        accessibilityElementsHidden={topLayerActive}
        importantForAccessibility={topLayerActive ? 'no-hide-descendants' : 'auto'}
      >
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', android: undefined })}
          style={styles.keyboardArea}
        >
          <View style={styles.content}>{children}</View>
          {toastMessage ? (
            // Above the tab bar, not behind it: the bar is an absolutely
            // positioned floating pill, so a toast in normal flow rendered at
            // the same bottom edge — the reader pressed "Back up now" and the
            // confirmation landed underneath the pill, unreadable.
            <View pointerEvents="none" style={[styles.toast, tabBar ? styles.toastAboveTabBar : null]}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          ) : null}
          {tabBar}
          {overlay}
        </KeyboardAvoidingView>
      </SafeAreaView>
      {topLayer ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {topLayer}
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  keyboardArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  // A dark pill over light content, the ordinary snackbar shape — built from
  // the palette rather than from the retired dark theme. Absolutely positioned
  // because the tab bar is too: flow order alone cannot keep it visible.
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: theme.ink,
  },
  // The floating pill is ~80px of bar plus its lift off the edge; the toast
  // clears it with room for the shadow.
  toastAboveTabBar: {
    bottom: 108,
  },
  toastText: {
    // ink/surface are the flipping pair: the pill is ink, so the text is
    // surface. Hardcoded white read fine on light theme's dark ink and turned
    // near-invisible on dark theme's light ink — the reader pressed "Back up
    // now" and could not tell success from failure.
    color: theme.surface,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
  },
});
