import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { Theme, useThemedStyles } from '../theming';
import { ChevronIcon } from './SettingsUi';

/**
 * The one list surface (owner-approved, 2026-10-19).
 *
 * A list is ONE rounded card, not one bordered card per row: `surface` fill,
 * a 1px `border`, radius 18, clipped. The rows inside are told apart by a
 * hairline in the border colour. The A3 cut stays on actions (buttons, chips,
 * Seg, the tab bar); a list is content, and content is not cut.
 *
 * Children are the rows, as direct children or as one mapped array. A
 * fragment counts as ONE child, so do not wrap rows in one.
 */
export function ListCard({
  children,
  style,
  divided = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** False when the rows draw their own dividers (SettingsRow). */
  divided?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  if (!divided) {
    return <View style={[styles.card, style]}>{children}</View>;
  }
  const rows = React.Children.toArray(children);

  return (
    <View style={[styles.card, style]}>
      {rows.map((row, index) => (
        <React.Fragment key={React.isValidElement(row) && row.key != null ? String(row.key) : index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

export type ListRowTone = 'neutral' | 'positive';

/**
 * Row anatomy: 56 high at least, 14 x 16 padding, a 15/800 title, a 13 faint
 * meta line, an optional trailing value (mono, 14/700) with a small delta line
 * under it, and a chevron only when the row opens something.
 */
export function ListRow({
  title,
  meta,
  detail,
  metaDot,
  trailing,
  delta,
  deltaTone = 'positive',
  leading,
  accessory,
  right,
  action,
  onPress,
  chevron,
  muted = false,
  accessibilityLabel,
}: {
  title: string;
  /** Date and details. */
  meta?: string | null;
  /** One more faint line under the meta (a top lift, a note). */
  detail?: string | null;
  /** A small dot before the meta line (History's feel colour). */
  metaDot?: string | null;
  /** The row's figure, in mono. */
  trailing?: string | null;
  /** A small line under the figure; green when positive. */
  delta?: string | null;
  deltaTone?: ListRowTone;
  /** Before the copy: an icon tile. */
  leading?: React.ReactNode;
  /** Sits beside the title (a badge that is an exception, not the rule). */
  accessory?: React.ReactNode;
  /** Replaces the figure: a lock pill, a delete button. */
  right?: React.ReactNode;
  /** After the figure, kept beside it: a delete button. */
  action?: React.ReactNode;
  onPress?: () => void;
  /** Defaults to "only when the row opens something". */
  chevron?: boolean;
  /** A row whose figure is withheld reads one step quieter. */
  muted?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const showChevron = chevron ?? Boolean(onPress);

  const body = (
    <>
      {leading}
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, muted && styles.titleMuted]} numberOfLines={1}>
            {title}
          </Text>
          {accessory}
        </View>
        {meta ? (
          <View style={styles.metaLine}>
            {metaDot ? <View style={[styles.metaDot, { backgroundColor: metaDot }]} /> : null}
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        ) : null}
        {detail ? (
          <Text style={styles.meta} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ??
        (trailing ? (
          <View style={styles.figure}>
            <Text style={styles.trailing} numberOfLines={1}>
              {trailing}
            </Text>
            {delta ? (
              <Text style={[styles.delta, deltaTone === 'positive' && styles.deltaPositive]}>{delta}</Text>
            ) : null}
          </View>
        ) : null)}
      {action}
      {showChevron ? <ChevronIcon /> : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: theme.border,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  title: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  titleMuted: {
    color: theme.muted,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  meta: {
    flexShrink: 1,
    color: theme.faint,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  figure: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  trailing: {
    color: theme.ink,
    fontFamily: 'JetBrainsMono',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  delta: {
    marginTop: 2,
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  deltaPositive: {
    color: theme.greenInk,
  },
});
