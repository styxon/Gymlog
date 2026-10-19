import React, { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PageHeader } from '../components/BackButton';
import { CARD_SHADOW, ChevronIcon, SectionLabel } from '../components/SettingsUi';
import { t } from '../lib/i18n';
import { buildProgramCsv, CsvExportSession, summarizeExportSessions } from '../lib/programCsvExport';
import { buildWorkoutLogCsv, summarizeWorkoutLog, WorkoutLogCsvInput } from '../lib/workoutLogCsvExport';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage } from '../types/models';

/**
 * Above this, a refused share is credibly about the size.
 *
 * Android carries an intent's extras through a Binder transaction with about a
 * megabyte to share between everything in flight, and a share is refused well
 * before that. 200k characters is roughly 110 logged workouts — comfortably
 * under where the refusals start, and comfortably over anything that fails for
 * another reason.
 */
const LOG_SHARE_SIZE_HINT = 200_000;

export interface ExportablePlan {
  id: string;
  name: string;
  sessions: CsvExportSession[];
}

/**
 * "1 päivä · 13 liikettä". Each half is pluralised on its own count — Finnish
 * needs the singular for exactly one, and a shared template would print
 * "1 päivää".
 */
function countLabel(language: AppLanguage, dayCount: number, exerciseCount: number) {
  const days =
    dayCount === 1 ? t(language, 'export.meta.day') : t(language, 'export.meta.days', { count: dayCount });
  const exercises =
    exerciseCount === 1
      ? t(language, 'export.meta.exercise')
      : t(language, 'export.meta.exercises', { count: exerciseCount });
  return `${days} · ${exercises}`;
}

interface ExportPlanScreenProps {
  language?: AppLanguage;
  /** The user's own plans plus the ready program they are running, if any. */
  plans: ExportablePlan[];
  /**
   * Every logged set. This screen exported the plan and nothing else, while
   * the free tier had begun promising the log was "readable and exportable
   * forever" — half of which was true.
   */
  log: WorkoutLogCsvInput;
  onBack: () => void;
}

/**
 * "Export plan (CSV)" from Settings.
 *
 * The row used to promise a local download. There is no storage the user can
 * reach and no file-share dependency, so this hands the plan to the system
 * share sheet as text instead — mail it to yourself, drop it in Sheets, or
 * paste it straight back into the importer.
 */
export function ExportPlanScreen({ language = 'en', plans, log, onBack }: ExportPlanScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  async function sharePlan(plan: ExportablePlan) {
    try {
      await Share.share({
        title: plan.name,
        message: buildProgramCsv(plan.sessions),
      });
    } catch {
      // Dismissed, or no share target — nothing to recover from.
    }
  }

  const logSummary = summarizeWorkoutLog(log);
  // Cardio is logged work too: the check used sets alone, and a runner was
  // told "Nothing logged yet" with the row switched off.
  const logEmpty = logSummary.sets === 0 && logSummary.cardio === 0;
  const logMeta = [
    logSummary.sets > 0
      ? t(language, 'export.log.meta', { sessions: logSummary.sessions, sets: logSummary.sets })
      : null,
    logSummary.cardio === 1
      ? t(language, 'export.log.cardioOne')
      : logSummary.cardio > 1
        ? t(language, 'export.log.cardioMany', { count: logSummary.cardio })
        : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  /*
   * The log goes out as text in a share intent, and a long enough log does not
   * fit in one.
   *
   * Android passes an intent's extras through a Binder transaction with about
   * a megabyte to share between everything in flight, so a large EXTRA_TEXT is
   * refused rather than truncated. Measured with the real builder: 273 logged
   * workouts at 25 sets each is 507 kB, 500 is 928 kB — and 273 is not a
   * number out of the air, it is the history this app has already seen split
   * across storage rows for the same reason.
   *
   * That refusal used to land in the catch below beside a dismissed sheet,
   * under "nothing to recover from". So the reader with the most to lose
   * pressed the one button that backs up "your log is yours" and watched
   * nothing happen at all (audit 3, 2026-09-19).
   *
   * Saying so is the fix that can be made here. Handing over a FILE instead
   * would lift the limit — the reader picks a folder and the CSV is written
   * into it — and that needs `StorageAccessFramework` and a device to test on;
   * it is written up as the follow-up rather than shipped untested.
   */
  const [logError, setLogError] = useState<string | null>(null);

  async function shareLog() {
    setLogError(null);
    let csv: string;
    try {
      csv = buildWorkoutLogCsv(log);
    } catch (error) {
      // Building it is not sharing it: a throw here is malformed stored data,
      // and blaming the size would be a confident wrong answer.
      console.error('Failed to build the training log', error);
      setLogError(t(language, 'export.log.failed'));
      return;
    }
    try {
      const result = await Share.share({
        title: t(language, 'export.log.title'),
        message: csv,
      });
      // `dismissedAction` is the reader closing the sheet; anything else is a
      // target that took it.
      if (result.action === Share.dismissedAction) {
        return;
      }
    } catch (error) {
      console.error('Failed to share the training log', error);
      // Size is named only when the size can carry the blame. A share can also
      // fail with no target at all or a refused permission, and the sentence
      // below does not merely say "it failed" — it asserts a cause and gives
      // advice premised on it, so a small log failing for another reason would
      // be told to wait for a feature that would not help it (CI review of
      // #146). Characters rather than bytes: this is a threshold for choosing
      // a sentence, not a limit to enforce.
      setLogError(
        t(language, csv.length > LOG_SHARE_SIZE_HINT ? 'export.log.tooBig' : 'export.log.failed'),
      );
    }
  }

  return (
    <View style={styles.screen}>
      <PageHeader
        style={styles.header}
        title={t(language, 'export.title')}
        onBack={onBack}
        backLabel={t(language, 'common.back')}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t(language, 'export.intro')}</Text>

        {plans.length === 0 ? (
          <View style={[styles.card, styles.emptyCard]}>
            <Text style={styles.emptyTitle}>{t(language, 'export.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t(language, 'export.emptyBody')}</Text>
          </View>
        ) : (
          <View style={styles.section}>
            <SectionLabel label={t(language, 'export.section')} />
            <View style={styles.card}>
              {plans.map((plan, index) => {
                const { dayCount, exerciseCount } = summarizeExportSessions(plan.sessions);
                return (
                  <Pressable
                    key={plan.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(language, 'export.shareA11y', { name: plan.name })}
                    onPress={() => void sharePlan(plan)}
                    style={({ pressed }) => [
                      styles.row,
                      index !== plans.length - 1 && styles.rowDivider,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{plan.name}</Text>
                      <Text style={styles.rowSub}>{countLabel(language, dayCount, exerciseCount)}</Text>
                    </View>
                    <ChevronIcon />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/*
          The log, above the plans on purpose. A program is a thing you can
          rebuild; the sets you lifted are not, and this is the one row that
          makes "your log is yours" a claim you can check rather than take on
          trust. Free tier, always — an export you have to pay for is a
          hostage negotiation.
        */}
        <View style={styles.section}>
          <SectionLabel spaced label={t(language, 'export.log.section')} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'export.log.title')}
            disabled={logEmpty}
            onPress={() => void shareLog()}
            style={({ pressed }) => [
              styles.card,
              styles.row,
              logEmpty && { opacity: 0.55 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{t(language, 'export.log.title')}</Text>
              <Text style={styles.rowSub}>{logEmpty ? t(language, 'export.log.empty') : logMeta}</Text>
            </View>
            {logEmpty ? null : <ChevronIcon />}
          </Pressable>
          {logError ? <Text style={styles.rowError}>{logError}</Text> : null}
        </View>

        <Text style={styles.footer}>{t(language, 'export.footer')}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: 8,
    paddingBottom: 6,
  },
  body: {
    paddingTop: 4,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: layout.bottomTabBarReserve,
  },
  intro: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    paddingHorizontal: 2,
    marginBottom: 20,
  },
  section: {
    marginTop: 0,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    ...CARD_SHADOW,
  },
  emptyCard: {
    padding: 18,
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyBody: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  rowSub: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  rowError: {
    color: theme.danger,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  footer: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 24,
    paddingHorizontal: 10,
  },
});
