import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ListCard } from '../components/ListCard';
import { PageHeader } from '../components/BackButton';
import { SectionLabel, makeSettingsStyles } from '../components/SettingsUi';
import { t } from '../lib/i18n';
import { LifetimeTrainingSummary } from '../lib/lifetimeSummary';
import { MilestoneLedger } from '../lib/milestoneFacts';
import { buildMilestoneLedgerRows } from '../lib/profileMilestoneRows';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage, UnitPreference } from '../types/models';

interface MilestonesScreenProps {
  language?: AppLanguage;
  lifetime: LifetimeTrainingSummary;
  ledger: MilestoneLedger;
  unitPreference: UnitPreference;
  onBack: () => void;
}

/**
 * Every rung that has fallen, with the day it fell, and every family's next
 * one (user 2026-09-03: "kerätään omalle sivulle nämä tehdyt milestonet").
 *
 * The reached list is the page's reason to exist and comes first. It is a
 * record, not a display case: a name and a date per row, the tier as a word,
 * no medals and nothing greyed out for not being reached yet. UP NEXT below
 * it is the Profile card's grammar with every family instead of three —
 * the same rows, the same bars, so a reader who opened this from the card
 * finds what they left.
 */
export function MilestonesScreen({ language = 'en', lifetime, ledger, unitPreference, onBack }: MilestonesScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const settingsStyles = useThemedStyles(makeSettingsStyles);

  const rows = useMemo(
    () => buildMilestoneLedgerRows({ ledger, lifetime, unitPreference, language }),
    [language, ledger, lifetime, unitPreference],
  );

  return (
    <View style={styles.screen}>
      <PageHeader
        style={styles.header}
        title={t(language, 'milestones.title')}
        onBack={onBack}
        backLabel={t(language, 'common.back')}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.summary}>{rows.summary}</Text>

        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'milestones.section.reached')} />
          {/* No speed line: a list of dates is read, and the stripe crossed
              the words (user 2026-09-03: "poista tuo korostusviiva"). */}
          <ListCard divided={false} style={styles.card}>
            {rows.reached.length === 0 ? (
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{t(language, 'milestones.emptyTitle')}</Text>
                <Text style={styles.rowMeta}>{t(language, 'milestones.emptyBody')}</Text>
              </View>
            ) : (
              rows.reached.map((row, index) => (
                <View key={row.key} style={[styles.row, index > 0 && styles.rowDivider]}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowMeta}>{row.meta}</Text>
                </View>
              ))
            )}
          </ListCard>
        </View>

        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'milestones.section.upNext')} />
          <ListCard divided={false} style={styles.card}>
            {rows.upcoming.map((row, index) => (
              <View key={row.key} style={[styles.progressRow, index > 0 && styles.rowDivider]}>
                <View style={styles.progressHead}>
                  <Text style={styles.progressTitle}>{row.title}</Text>
                  {row.remainder ? <Text style={styles.progressRemainder}>{row.remainder}</Text> : null}
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${row.fillPercent}%`, backgroundColor: index === 0 ? theme.highlight : theme.purpleBright },
                    ]}
                  />
                </View>
                <Text style={styles.rowMeta}>{row.meta}</Text>
              </View>
            ))}
          </ListCard>
        </View>
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
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
  },
  body: {
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: layout.bottomTabBarReserve,
  },
  summary: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    paddingVertical: 12,
    gap: 3,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  rowTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '700',
  },
  rowMeta: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '500',
  },
  progressRow: {
    paddingVertical: 12,
    gap: 7,
  },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  progressTitle: {
    flex: 1,
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '700',
  },
  progressRemainder: {
    color: theme.highlight,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  track: {
    height: 7,
    borderRadius: 99,
    backgroundColor: theme.surfaceSoft,
    overflow: 'hidden',
  },
  fill: {
    height: 7,
    borderRadius: 99,
  },
});
