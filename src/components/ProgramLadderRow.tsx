import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { I18nKey, t } from '../lib/i18n';
import { formatWeeklyLoad, shouldShowLevelBadge } from '../lib/programLadder';
import { ProgramCoverStyle } from '../lib/programVisualIdentity';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { WorkoutLevel } from '../features/workout/workoutTypes';
import type { AppLanguage } from '../types/models';

/**
 * One programme, as a row.
 *
 * The category sheet and the catalog screen are two doors onto the same 57
 * programmes, and a reader who meets STRONG in both should meet the same
 * STRONG: the same cover, the same week drawn on it, the same level badge,
 * the same sentence underneath. That only stays true if there is one row, so
 * this is it.
 */

export interface ProgramRowItem {
  id: string;
  name: string;
  blurb: string;
  days: number;
  minutes: number;
  weeks: number;
  level: WorkoutLevel;
  cover: ProgramCoverStyle;
  /** The programme's week as bar heights — see lib/programFingerprint. */
  fingerprint: number[];
}

/**
 * The programme's identity ramp with its week drawn on it in white bars.
 *
 * 74px, and the size is not a parameter: two rows of the same programme at
 * different sizes read as two different programmes.
 */
export function ProgramRowCover({
  style,
  fingerprint,
}: {
  style: ProgramCoverStyle;
  fingerprint: number[];
}) {
  const gid = `row-${style.cover[0]}`.replace(/[^a-zA-Z0-9]/g, '');
  const size = 74;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0.2" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={style.cover[0]} />
          <Stop offset="1" stopColor={style.cover[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} rx={14} fill={`url(#${gid})`} />
      {fingerprint.map((ratio, index) => {
        const slot = (size - 16) / Math.max(1, fingerprint.length);
        const barWidth = Math.max(2, slot - 2.5);
        const barHeight = Math.max(4, ratio * 42);
        return (
          <Rect
            key={index}
            x={8 + index * slot}
            y={size - 9 - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1.5}
            fill="#FFFFFF"
            fillOpacity={0.85}
          />
        );
      })}
    </Svg>
  );
}

export const PROGRAM_LEVEL_STYLES: Record<WorkoutLevel, { bg: string; ink: string; key: I18nKey }> = {
  beginner: { bg: '#E8F7EE', ink: '#007633', key: 'programs.level.beginner' },
  intermediate: { bg: '#EFE7FF', ink: '#5B21B6', key: 'programs.level.intermediate' },
  advanced: { bg: '#FFE1DB', ink: '#A52A24', key: 'programs.level.advanced' },
};

export function ProgramLadderRow({
  item,
  language,
  levelFilter = null,
  accessibilityLabel,
  onPress,
}: {
  item: ProgramRowItem;
  language: AppLanguage;
  /**
   * The level the reader has filtered to, so the badge can stay quiet.
   *
   * With "Advanced" selected, an ADVANCED badge on all eleven rows is the
   * reader's own choice read back to them eleven times.
   */
  levelFilter?: WorkoutLevel | null;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const levelStyle = PROGRAM_LEVEL_STYLES[item.level];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <ProgramRowCover style={item.cover} fingerprint={item.fingerprint} />
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          <Text style={styles.name} numberOfLines={2}>
            {item.name}
          </Text>
          {shouldShowLevelBadge(item.level, levelFilter) ? (
            <View style={[styles.levelBadge, { backgroundColor: levelStyle.bg }]}>
              <Text style={[styles.levelBadgeText, { color: levelStyle.ink }]}>
                {t(language, levelStyle.key).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
        {/* One line. Two lines of blurb on rows that differ by a single day
            pushed the number that actually differs below the fold. */}
        <Text style={styles.blurb} numberOfLines={1}>
          {item.blurb}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatWeeklyLoad(item.days, item.minutes, language)}</Text>
          {/* The two things the sheet's sorts sort by. */}
          {item.weeks > 0 ? (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.meta}>{t(language, 'programs.weeksShort', { count: item.weeks })}</Text>
            </>
          ) : null}
        </View>
      </View>
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
        <Path
          d="m9 6 6 6-6 6"
          stroke={theme.faint}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
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
      flexWrap: 'wrap',
      columnGap: 7,
      rowGap: 3,
    },
    name: {
      flexShrink: 1,
      color: theme.ink,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    levelBadge: {
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    levelBadgeText: {
      fontSize: 9.5,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    blurb: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      marginTop: 3,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginTop: 11,
    },
    meta: {
      color: theme.muted,
      fontSize: 11.5,
      lineHeight: 15,
      fontWeight: '700',
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 999,
      backgroundColor: theme.faint,
    },
  });
