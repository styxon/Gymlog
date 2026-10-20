import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from './AppText';

import { CutSurface } from './CutSurface';
import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * Nothing here yet, said once.
 *
 * The Progress tab's grammar for an empty chart, from the brief: "Empty is a
 * dashed box with one mono line — never a full-height card holding the words
 * 'No entries'." A card the size of the thing that is missing advertises the
 * hole; a dashed box says the shape is reserved and moves on.
 *
 * Mono because the line is standing in for a number. Every value on this tab
 * is JetBrainsMono, so the placeholder sits where the reading will.
 *
 * One line, not two. A second line explaining the first is how the full-height
 * card started.
 */
export function EmptyBox({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();

  return (
    <CutSurface
      size="lg"
      fill="transparent"
      stroke={theme.border}
      strokeWidth={1.5}
      dashed
      style={styles.box}
    >
      <Text style={styles.label}>{label}</Text>
    </CutSurface>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  box: {
    marginTop: 14,
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  label: {
    fontFamily: 'JetBrainsMono',
    textAlign: 'center',
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.faint,
  },
});
