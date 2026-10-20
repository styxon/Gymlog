import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import { AppLanguage } from '../types/models';
import { spacing } from '../theme';
import { Theme, useThemedStyles } from '../theming';

/**
 * The older screen header, still used by twelve screens.
 *
 * It used to take a `tone` prop defaulting to 'light', where "light" meant the
 * near-white text of the legacy dark theme. Every single caller passed
 * `tone="dark"` to get readable text, so the default branch never rendered —
 * it was a trap waiting for the thirteenth caller to fall into. The prop and
 * the unreachable branch are gone; the colours come from the shared palette
 * like everything else.
 *
 * `backLabel` was the same shape and outlived that fix: it defaulted to the
 * English literal 'Back', no caller ever passed it, and `common.back` had a
 * Finnish translation nobody could reach. Ten screens said "Back" in a Finnish
 * app. It is derived from `language` now, and `language` is required — so the
 * type checker, not a screenshot, is what catches the eleventh screen.
 */
interface ScreenHeaderProps {
  title: string;
  language: AppLanguage;
  subtitle?: string;
  onBack?: () => void;
  /** Overrides the default "Takaisin"/"Back" — e.g. a named destination. */
  backLabel?: string;
  rightActionLabel?: string;
  onRightActionPress?: () => void;
}

export function ScreenHeader({
  title,
  language,
  subtitle,
  onBack,
  backLabel,
  rightActionLabel,
  onRightActionPress,
}: ScreenHeaderProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrapper}>
      <View style={styles.topRow}>
        <View style={styles.titleRow}>
          {onBack ? (
            <Pressable hitSlop={10} onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>{backLabel ?? t(language, 'common.back')}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        {rightActionLabel && onRightActionPress ? (
          <Pressable hitSlop={10} onPress={onRightActionPress} style={styles.action}>
            <Text style={styles.actionText}>{rightActionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// Module scope on purpose: useThemedStyles caches per factory, and a factory
// created inside the component would be a new one on every render.
const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrapper: {
      gap: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    titleRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    backButton: {
      minWidth: 70,
      minHeight: 40,
      paddingHorizontal: spacing.sm,
      marginLeft: -spacing.sm,
      borderRadius: 999,
      justifyContent: 'center',
    },
    backText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
    title: {
      flex: 1,
      color: theme.ink,
      fontSize: 24,
      fontWeight: '900',
      letterSpacing: -0.6,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 18,
    },
    action: {
      minHeight: 40,
      paddingHorizontal: spacing.xs,
      justifyContent: 'center',
    },
    actionText: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '800',
    },
  });
