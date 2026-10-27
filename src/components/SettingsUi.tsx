import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from './AppText';
import Svg, { Path } from 'react-native-svg';

import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * Shared list primitives for the Profile / Settings suite. Extracted from
 * ProfileScreen so the pushed Settings screen renders identical rows instead of
 * a second, drifting copy.
 */

/**
 * THE section label (owner-approved, 2026-10-19): 11/800 uppercase, wide
 * tracking, `muted`, with an optional action on the right in `highlight`.
 * History, Progress, ExerciseDetail, Programs, Records and the library each
 * had a local copy; they all go through this one.
 */
export function SectionLabel({
  label,
  actionLabel,
  onAction,
  actionTestID,
  right,
  spaced,
  style,
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
  /** For the UI-check walk (.maestro/ui-check): the action found by id, not by its words. */
  actionTestID?: string;
  /** A non-text right side (a count, a link with a chevron); wins over `actionLabel`. */
  right?: React.ReactNode;
  /** Sits under a card or another block: adds the shared gap above the label. */
  spaced?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.sectionHead, spaced && styles.sectionSpaced, style]}>
      <Text accessibilityRole="header" numberOfLines={2} style={styles.sectionLabel}>
        {label}
      </Text>
      {typeof right === 'string' ? (
        <View style={styles.sectionActionWrap}>
          <Text style={styles.sectionAction}>{right}</Text>
        </View>
      ) : (
        right ??
        (actionLabel ? (
          <Pressable
            testID={actionTestID}
            accessibilityRole="button"
            onPress={onAction}
            hitSlop={8}
            style={styles.sectionActionWrap}
          >
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </Pressable>
        ) : null)
      )}
    </View>
  );
}

export function ToggleSwitch({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={[styles.toggleTrack, value && styles.toggleTrackOn]}
      hitSlop={8}
    >
      <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
    </Pressable>
  );
}

export function ChevronIcon({ color }: { color?: string }) {
  // A parameter default is not a place a hook can reach, so the fallback is
  // resolved in the body instead.
  const theme = useTheme();

  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={color ?? theme.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The suite's card shadow (mock: 0 6px 18px rgba(120,80,200,.06)). */
export const CARD_SHADOW = {
  boxShadow: '0 6px 18px rgba(120, 80, 200, 0.06)',
} as const;

export const makeSettingsStyles = (theme: Theme) => StyleSheet.create({
  section: {
    marginTop: 22,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 4,
    ...CARD_SHADOW,
  },
});

const makeStyles = (theme: Theme) => StyleSheet.create({
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 11,
  },
  sectionSpaced: {
    marginTop: 22,
  },
  sectionActionWrap: {
    flexShrink: 0,
    marginLeft: 12,
  },
  sectionLabel: {
    flexShrink: 1,
    color: theme.muted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  sectionAction: {
    color: theme.highlight,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: theme.switchOff,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: theme.purple,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: theme.surface,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
  },
});
