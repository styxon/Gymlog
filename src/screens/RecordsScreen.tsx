import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { Seg } from '../components/Seg';
import { FREE_RECORD_MONTHS, isRecordLocked } from '../lib/historyWindow';
import { I18nKey, t } from '../lib/i18n';
import { libraryLabel } from '../lib/libraryLabel';
import { CutSurface } from '../components/CutSurface';
import { groupRecordsByMonth, PersonalRecord, RecordKind } from '../lib/personalRecords';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { AppLanguage } from '../types/models';
import { formatDateNumeric, removeTrailingZeros } from '../lib/format';

/**
 * Your bests, in three kinds.
 *
 * "Best" means three different things and a single list would have to pick
 * one: the heaviest set, the most reps in a set, and the hardest session for
 * that lift. A bodyweight program has no weight records at all, so the kinds
 * are a segmented control rather than a sort order — switching is the point,
 * not a refinement.
 *
 * Grouped by the month the record was SET, newest first, because the question
 * this screen answers is "what have I done lately" and not "which lift is
 * heaviest" — the reader already knows the second one.
 *
 * On the free tier, records older than three months keep their row and lose
 * their figure. Dropping them instead would leave a screen headed "records"
 * whose numbers are not the reader's records, and the app would be stating
 * that as if it were.
 */

const KIND_LABELS: Record<RecordKind, I18nKey> = {
  weight: 'pr.kind.weight',
  reps: 'pr.kind.reps',
  volume: 'pr.kind.volume',
};

const KINDS: RecordKind[] = ['weight', 'reps', 'volume'];

const MONTHS: Record<AppLanguage, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fi: ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'],
};

function decimal(value: number, language: AppLanguage) {
  // Hundredths, not tenths: the dial steps 1.25 kg and 61.25 is not "61,3".
  return removeTrailingZeros(Math.round(value * 100) / 100);
}

function thousands(value: number, language: AppLanguage) {
  return Math.round(value).toLocaleString(language === 'fi' ? 'fi-FI' : 'en-GB');
}

function formatDay(iso: string, language: AppLanguage) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateNumeric(date, language);
}

function recordValue(record: PersonalRecord, language: AppLanguage) {
  if (record.kind === 'volume') {
    return t(language, 'pr.value.volume', { volume: thousands(record.value, language) });
  }
  if (record.kind === 'weight') {
    return t(language, 'pr.value.weight', {
      weight: decimal(record.value, language),
      reps: record.companion ?? 0,
    });
  }
  // A bodyweight set has no load to name, and "0 kg" is not what happened.
  return record.companion === null
    ? t(language, 'pr.value.repsBodyweight', { reps: record.value })
    : t(language, 'pr.value.reps', { reps: record.value, weight: decimal(record.companion, language) });
}

function recordDelta(record: PersonalRecord, language: AppLanguage) {
  if (record.previous === null || record.value <= record.previous) {
    return null;
  }
  const delta = record.value - record.previous;
  if (record.kind === 'reps') {
    return t(language, 'pr.delta.reps', { delta });
  }
  return t(language, 'pr.delta.weight', {
    delta: record.kind === 'volume' ? thousands(delta, language) : decimal(delta, language),
  });
}

function LockGlyph({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={10} width={16} height={11} rx={3} stroke={color} strokeWidth={2.2} />
      <Path d="M8 10V7a4 4 0 018 0v3" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function RecordRow({
  record,
  language,
  locked = false,
  onPress,
}: {
  record: PersonalRecord;
  language: AppLanguage;
  /** Set beyond the free window: the row stays, the figure does not. */
  locked?: boolean;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const delta = recordDelta(record, language);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        record.fresh && !locked && styles.rowFresh,
        locked && styles.rowLocked,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={[styles.rowName, locked && styles.rowNameLocked]} numberOfLines={1}>
            {exerciseNameLabel(language, record.name)}
          </Text>
          {record.fresh && !locked ? (
            <View style={styles.freshTag}>
              <Text style={styles.freshTagText}>{t(language, 'pr.new')}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[
            record.bodyPart ? libraryLabel(record.bodyPart, language) : null,
            formatDay(record.performedAt, language),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {locked ? (
        <View style={styles.lockPill}>
          <LockGlyph color={theme.muted} />
          <Text style={styles.lockPillText}>{t(language, 'pr.locked.value')}</Text>
        </View>
      ) : (
        <View style={styles.rowValueBlock}>
          <Text style={styles.rowValue}>{recordValue(record, language)}</Text>
          {delta ? <Text style={styles.rowDelta}>{delta}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

interface RecordsListProps {
  language?: AppLanguage;
  /** Every lift's record, per kind. Empty arrays are a real state. */
  records: Record<RecordKind, PersonalRecord[]>;
  proUnlocked: boolean;
  onStartWorkout: () => void;
  onOpenExercise?: (key: string) => void;
  onOpenPro: () => void;
}

/**
 * The records tab's body. A list rather than a screen: it lives inside
 * Progress's own tabs, so it brings no header and no back button of its own.
 */
export function RecordsList({
  language = 'en',
  records,
  proUnlocked,
  onStartWorkout,
  onOpenExercise,
  onOpenPro,
}: RecordsListProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const [kind, setKind] = useState<RecordKind>('weight');

  const shown = records[kind];
  const groups = groupRecordsByMonth(shown);
  const lockedCount = shown.filter((record) =>
    isRecordLocked(record.performedAt, proUnlocked),
  ).length;

  return (
    <>
      <View style={styles.kindRow}>
        {/* The SAME control as the trend switch and the two range rows, not a
            second one that looks nearly like it. This was hand-built here with
            its own fill and its own inner surface, which is what the brief
            means by "the tab has one widget instead of three". Theme tokens
            either way — the hardcoded lilac-and-white pair glowed on the dark
            theme (user 2026-08-23, "sama tausta ongelma"). */}
        <Seg
          options={KINDS.map((entry) => ({ key: entry, label: t(language, KIND_LABELS[entry]) }))}
          value={kind}
          onChange={setKind}
        />
        {shown.length > 0 ? (
          <Text style={styles.liftCount}>{t(language, 'pr.liftCount', { count: shown.length })}</Text>
        ) : null}
      </View>

      {shown.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Svg width={27} height={27} viewBox="0 0 24 24" fill="none">
              <Path
                d="M8 4h8v5a4 4 0 01-8 0z M8 6H5v1a3 3 0 003 3M16 6h3v1a3 3 0 01-3 3 M12 13v4M9 20h6"
                stroke={theme.purple}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.emptyTitle}>{t(language, 'pr.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t(language, 'pr.empty.body')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onStartWorkout}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            {/* The one orange thing on the empty screen. The icon above stays
                violet — the brief keeps the accent for the action and the
                brand colour for the ornament. */}
            <CutSurface size="lg" fill={theme.highlight} style={styles.emptyCta}>
              <Text style={styles.emptyCtaText}>{t(language, 'pr.empty.cta')}</Text>
            </CutSurface>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Stated once at the top, rather than left to be inferred from
              the rows. */}
          {lockedCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenPro}
              style={({ pressed }) => [styles.lockCard, pressed && styles.pressed]}
            >
              <View style={styles.lockCardIcon}>
                <LockGlyph color={theme.purple} size={16} />
              </View>
              <View style={styles.lockCardCopy}>
                <Text style={styles.lockCardTitle}>
                  {lockedCount === 1
                    ? t(language, 'pr.locked.titleOne')
                    : t(language, 'pr.locked.title', { count: lockedCount })}
                </Text>
                <Text style={styles.lockCardBody}>
                  {t(language, 'pr.locked.body', { months: FREE_RECORD_MONTHS })}
                </Text>
              </View>
              <Text style={styles.lockCardCta}>{t(language, 'pr.locked.cta')}</Text>
            </Pressable>
          ) : null}
          {groups.map((group) => (
            <View key={`${group.year}-${group.month}`} style={styles.group}>
              <Text style={styles.groupLabel}>
                {`${MONTHS[language][group.month]} ${group.year}`.toUpperCase()}
              </Text>
              <View style={styles.groupRows}>
                {group.records.map((record) => {
                  const locked = isRecordLocked(record.performedAt, proUnlocked);
                  return (
                    <RecordRow
                      key={`${record.key}-${record.kind}`}
                      record={record}
                      language={language}
                      locked={locked}
                      onPress={
                        locked
                          ? onOpenPro
                          : onOpenExercise
                            ? () => onOpenExercise(record.key)
                            : undefined
                      }
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}
    </>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  pressed: {
    opacity: 0.85,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  liftCount: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  group: {
    marginBottom: 20,
  },
  groupLabel: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  groupRows: {
    gap: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  rowFresh: {
    borderColor: theme.purple,
  },
  rowLocked: {
    backgroundColor: theme.bg,
    borderStyle: 'dashed',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  rowName: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  rowNameLocked: {
    color: theme.muted,
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  lockPillText: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  lockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.purple,
    backgroundColor: theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 18,
  },
  lockCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  lockCardTitle: {
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  lockCardBody: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  lockCardCta: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '900',
    flexShrink: 0,
  },
  freshTag: {
    borderRadius: 5,
    // The white-label violet (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
  },
  freshTagText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
  rowMeta: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 3,
  },
  rowValueBlock: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  rowValue: {
    color: theme.ink,
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  rowDelta: {
    color: '#157A3A',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    marginTop: 3,
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 17.5,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 16,
  },
  emptyBody: {
    color: theme.muted,
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 260,
  },
  emptyCta: {
    marginTop: 18,
    height: 46,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaText: {
    // The ink the fill was paired with, not white. theme.highlight is orange
    // on the dark theme, and white on that orange is the lower-contrast of
    // the two — the same pairing the library's eye button already uses.
    color: theme.onHighlight,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
});
