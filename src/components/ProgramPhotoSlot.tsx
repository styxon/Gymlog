import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Circle, Path } from 'react-native-svg';
import { Theme, useTheme, useThemedStyles } from '../theming';

/**
 * Placeholder for a real gym photo that will be shot later (source photos are
 * 9504x6336 = 3:2). Every surface that will eventually show a photo renders
 * this slot so the photo work is a drop-in swap. Target crops:
 *  - program detail hero: 16:9
 *  - explore/cover cards: 4:5 (portrait)
 *  - result-screen cards: 16:9
 */
export function ProgramPhotoSlot({
  label = 'Photo coming soon',
  aspectRatio = 16 / 9,
  compact = false,
}: {
  label?: string;
  aspectRatio?: number;
  compact?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.slot, { aspectRatio }, compact && styles.slotCompact]}>
      <Svg width={compact ? 18 : 28} height={compact ? 18 : 28} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4 8a2 2 0 0 1 2-2h1.5l1.4-1.6a1 1 0 0 1 .75-.4h4.7a1 1 0 0 1 .75.4L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"
          stroke={theme.faint}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <Circle cx={12} cy={12.5} r={3.2} stroke={theme.faint} strokeWidth={1.8} />
      </Svg>
      {!compact ? <Text style={styles.slotLabel}>{label}</Text> : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  slot: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.border,
    backgroundColor: theme.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  slotCompact: {
    borderRadius: 12,
    gap: 0,
  },
  slotLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.muted,
    letterSpacing: 0.3,
  },
});
