import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, { Path } from 'react-native-svg';

import { PageHeader } from '../components/BackButton';
import { CoachHighlightedText } from '../components/CoachHighlightedText';
import { SectionLabel } from '../components/SettingsUi';
import { t } from '../lib/i18n';
import { SessionAnalysis, SessionTrend, describeVolumeChange } from '../lib/sessionAnalysis';
import { layout } from '../theme';
import { Theme, aw3ForTheme, darkTheme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

interface SessionAnalysisScreenProps {
  analysis: SessionAnalysis | null;
  language?: AppLanguage;
  onBack: () => void;
  onAskCoach: () => void;
}

const BAR_HEIGHT = 96;

/**
 * Gold as text.
 *
 * The screen used to wear the fixed dark coach palette in both themes, so under
 * the light theme a dark page sat above a light tab bar, reached from a coach
 * screen that had already gone light (user 2026-09-13: "outo"). Gold as a fill
 * reads on either ground; gold as small type on the pale light page does not,
 * so light sets its labels in the palette's deep gold ink instead.
 */
function goldText(theme: Theme) {
  return theme === darkTheme ? theme.gold : theme.amberInk;
}

/** A palette colour as a wash, so tints move with the theme they come from. */
function tint(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** The trend as a fill — the observation squares — where the raw accents read on either ground. */
function toneColor(theme: Theme, trend: SessionTrend) {
  return trend === 'up' ? theme.green : trend === 'down' ? theme.amber : goldText(theme);
}

/**
 * The trend as small type.
 *
 * The same swap as gold, for the same reason: green and amber are ~2.7:1 on the
 * light page at 10–12px (PR review). Light reads their inks; flat goes quiet
 * rather than sharing the amber ink with "down". Dark keeps the accents.
 */
function toneInk(theme: Theme, trend: SessionTrend) {
  if (theme === darkTheme) {
    return toneColor(theme, trend);
  }
  return trend === 'up' ? theme.greenInk : trend === 'down' ? theme.amberInk : theme.muted;
}

function toneMark(trend: SessionTrend) {
  // Flat has no mark: its label is a word, and an "=" in front of it read as a
  // stutter ("= =") when the label was one too.
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '';
}

export function SessionAnalysisScreen({
  analysis,
  language = 'en',
  onBack,
  onAskCoach,
}: SessionAnalysisScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const bars = analysis?.volumeBars ?? [];
  const volumeChange = describeVolumeChange(analysis?.volumeChangePercent ?? null, language);
  // Scale from just under the smallest bar rather than zero: on real training
  // data every bar is a large number, and a zero baseline flattens the very
  // trend the chart exists to show.
  const values = bars.map((bar) => bar.volumeKg);
  const maxValue = values.length ? Math.max(...values) : 0;
  const minValue = values.length ? Math.min(...values) : 0;
  const baseline = values.length ? Math.max(0, minValue - (maxValue - minValue) * 0.35 - 1) : 0;
  const span = Math.max(maxValue - baseline, 1);

  return (
    <View style={styles.screen}>
      <PageHeader
        style={styles.header}
        title={t(language, 'analysis.title')}
        onBack={onBack}
        backLabel={t(language, 'common.back')}
      />

      {!analysis ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t(language, 'analysis.empty')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          {/* 1 · session hero */}
          <Text style={styles.eyebrow}>{analysis.eyebrow}</Text>
          <Text style={styles.title}>{analysis.title}</Text>
          {analysis.metaParts.length > 0 ? (
            <Text style={styles.meta}>{analysis.metaParts.join('  ·  ')}</Text>
          ) : null}

          {/* 2 · verdict */}
          {analysis.verdict ? (
            <View style={styles.verdictCard}>
              <View style={styles.verdictTagRow}>
                <Text style={styles.verdictSparkle}>✦</Text>
                <Text style={styles.verdictTag}>{t(language, analysis.verdictTagKey)}</Text>
              </View>
              <CoachHighlightedText
                text={analysis.verdict.text}
                highlights={analysis.verdict.highlights}
                style={styles.verdictBody}
                highlightStyle={styles.gold}
              />
            </View>
          ) : null}

          {/* 3 · key numbers */}
          {analysis.keyNumbers.length > 0 ? (
            <View style={styles.section}>
              <SectionLabel style={styles.label} label={t(language, 'analysis.key.label')} />
              <View style={styles.metricRow}>
                {analysis.keyNumbers.map((metric) => (
                  <View key={metric.labelKey} style={[styles.metricCell, { flex: metric.grow }]}>
                    <Text style={styles.metricKey}>{t(language, metric.labelKey)}</Text>
                    {/* "60 kg × 8" is one reading, so it never wraps; if the
                        cell is too narrow the type shrinks instead. */}
                    <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {metric.value}
                    </Text>
                    {metric.sub ? (
                      <Text style={styles.metricSub} numberOfLines={2}>
                        {metric.sub}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* 4 · volume over comparable sessions */}
          {bars.length > 0 ? (
            <View style={styles.section}>
              <SectionLabel
                style={styles.label}
                label={t(language, 'analysis.volumeLabel')}
                right={volumeChange ? (
                  <View
                    style={[
                      styles.changePill,
                      volumeChange.kind === 'down' && styles.changePillDown,
                      volumeChange.kind === 'flat' && styles.changePillFlat,
                    ]}
                  >
                    <Text
                      style={[
                        styles.changePillText,
                        volumeChange.kind === 'down' && styles.changePillTextDown,
                        volumeChange.kind === 'flat' && styles.changePillTextFlat,
                      ]}
                    >
                      {volumeChange.text}
                    </Text>
                  </View>
                ) : null}
              />

              <View style={styles.barRow}>
                {bars.map((bar) => {
                  const height = Math.max(
                    6,
                    ((bar.volumeKg - baseline) / span) * BAR_HEIGHT,
                  );
                  return (
                    <View key={bar.sessionId} style={styles.barSlot}>
                      <View
                        style={[styles.bar, { height }, bar.isCurrent && styles.barCurrent]}
                      />
                      <Text style={[styles.barLabel, bar.isCurrent && styles.barLabelCurrent]}>
                        {bar.label}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {bars.length === 1 ? (
                <Text style={styles.sectionNote}>{t(language, 'analysis.volumeSingle')}</Text>
              ) : null}
            </View>
          ) : null}

          {/* 5 · exercise breakdown */}
          {analysis.exercises.length > 0 ? (
            <View style={styles.section}>
              <SectionLabel style={styles.label} label={t(language, 'analysis.breakdown')} />
              {analysis.exercises.map((row) => (
                <View key={row.key} style={styles.exerciseRow}>
                  <View style={styles.exerciseCopy}>
                    <Text style={styles.exerciseName}>{row.name}</Text>
                    <Text style={styles.exerciseDetail}>
                      {row.detail}
                      {row.topSet ? `  ·  ${row.topSet}` : ''}
                    </Text>
                  </View>
                  {row.trend && row.trendLabel ? (
                    <View style={styles.trendPill}>
                      {toneMark(row.trend) ? (
                        <Text style={[styles.trendMark, { color: toneInk(theme, row.trend) }]}>
                          {toneMark(row.trend)}
                        </Text>
                      ) : null}
                      <Text style={[styles.trendText, { color: toneInk(theme, row.trend) }]}>
                        {row.trendLabel}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.trendAbsent}>{t(language, 'analysis.noCompare')}</Text>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {/* 6 · what the coach noticed */}
          {analysis.observations.length > 0 ? (
            <View style={styles.section}>
              <SectionLabel style={styles.label} label={t(language, 'analysis.noticed')} />
              {analysis.observations.map((entry, index) => (
                <View key={`${entry.trend}:${index}`} style={styles.observationRow}>
                  <View style={[styles.observationSquare, { backgroundColor: toneColor(theme, entry.trend) }]} />
                  <CoachHighlightedText
                    text={entry.body.text}
                    highlights={entry.body.highlights}
                    style={styles.observationText}
                    highlightStyle={styles.observationStrong}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {/* 7 · next session */}
          {analysis.nextActions.length > 0 ? (
            <View style={styles.section}>
              <SectionLabel style={styles.label} label={t(language, 'analysis.next')} />
              <View style={styles.nextCard}>
                {analysis.nextActions.map((action, index) => (
                  <View key={index} style={styles.nextRow}>
                    <View style={styles.nextCheck}>
                      <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M5 12l5 5L19 7"
                          stroke={goldText(theme)}
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    </View>
                    <CoachHighlightedText
                      text={action.text}
                      highlights={action.highlights}
                      style={styles.nextText}
                      highlightStyle={styles.goldMono}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* 8 · recovery note */}
          <View style={styles.recoveryCard}>
            <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
              <Path
                d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"
                stroke={theme.purple}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.recoveryText}>{t(language, 'analysis.recovery')}</Text>
          </View>

          {/* 9 · back to the coach */}
          <Pressable
            accessibilityRole="button"
            onPress={onAskCoach}
            style={({ pressed }) => [styles.askButton, pressed && styles.pressed]}
          >
            <Text style={styles.askButtonText}>{t(language, 'analysis.askCoach')}</Text>
          </Pressable>
          <Text style={styles.footnote}>{t(language, 'analysis.footnote')}</Text>
        </ScrollView>
      )}
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
    paddingTop: layout.pageHeaderTop,
    paddingBottom: 6,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: layout.screenGutter,
    // The tab bar floats over this screen, so the last card needs to clear it.
    paddingBottom: layout.bottomTabBarReserve,
  },
  eyebrow: {
    color: goldText(theme),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    marginTop: 4,
  },
  title: {
    color: theme.ink,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 6,
  },
  meta: {
    color: theme.muted,
    fontFamily: 'JetBrainsMono',
    fontSize: 12.5,
    marginTop: 8,
  },
  verdictCard: {
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    backgroundColor: theme.purpleSoft,
    padding: 16,
  },
  verdictTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 9,
  },
  verdictSparkle: {
    color: goldText(theme),
    fontSize: 12,
  },
  verdictTag: {
    color: goldText(theme),
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  verdictBody: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '700',
    lineHeight: 22,
  },
  gold: {
    color: goldText(theme),
    fontWeight: '800',
  },
  goldMono: {
    color: goldText(theme),
    fontFamily: 'JetBrainsMono',
  },
  section: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: aw3ForTheme(theme).hair,
    paddingTop: 18,
  },
  // The shared label; each block below keeps the gap it already had to it.
  label: {
    paddingBottom: 0,
  },
  sectionNote: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 12,
  },
  metricCell: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 15,
    padding: 13,
  },
  metricKey: {
    color: theme.faint,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  metricValue: {
    color: theme.ink,
    fontFamily: 'JetBrainsMono',
    fontSize: 17,
    marginTop: 6,
  },
  metricSub: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  changePill: {
    backgroundColor: theme.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  changePillDown: {
    backgroundColor: theme.amberSoft,
  },
  // Nothing changed, so nothing is claimed: the badge goes quiet rather than
  // wearing the green that promises growth.
  changePillFlat: {
    backgroundColor: theme.surfaceSoft,
  },
  changePillText: {
    color: toneInk(theme, 'up'),
    fontFamily: 'JetBrainsMono',
    fontSize: 12,
  },
  changePillTextDown: {
    color: toneInk(theme, 'down'),
  },
  changePillTextFlat: {
    color: theme.muted,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 16,
    height: BAR_HEIGHT + 24,
  },
  barSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  bar: {
    width: '100%',
    borderRadius: 6,
    backgroundColor: tint(theme.purple, theme === darkTheme ? 0.35 : 0.2),
  },
  barCurrent: {
    backgroundColor: theme.gold,
  },
  barLabel: {
    color: theme.faint,
    fontFamily: 'JetBrainsMono',
    fontSize: 10,
  },
  barLabelCurrent: {
    color: goldText(theme),
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: aw3ForTheme(theme).hair,
  },
  exerciseCopy: {
    flex: 1,
    minWidth: 0,
  },
  exerciseName: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  exerciseDetail: {
    color: theme.muted,
    fontFamily: 'JetBrainsMono',
    fontSize: 12,
    marginTop: 5,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  trendMark: {
    fontSize: 10,
    fontWeight: '800',
  },
  trendText: {
    fontFamily: 'JetBrainsMono',
    fontSize: 12,
  },
  trendAbsent: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '700',
  },
  observationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 13,
  },
  observationSquare: {
    width: 9,
    height: 9,
    borderRadius: 2,
    marginTop: 6,
  },
  observationText: {
    flex: 1,
    color: theme.muted,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
  },
  observationStrong: {
    color: theme.ink,
    fontWeight: '800',
  },
  nextCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 15,
    marginTop: 12,
    gap: 12,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  nextCheck: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: tint(theme.gold, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    flex: 1,
    color: theme.ink,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
  },
  recoveryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    backgroundColor: theme.surfaceSoft,
    borderRadius: 16,
    padding: 15,
    marginTop: 22,
  },
  recoveryText: {
    flex: 1,
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  // Pressable, so it wears the theme's action colour like every other button.
  askButton: {
    backgroundColor: theme.highlight,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 22,
  },
  askButtonText: {
    color: theme.onHighlight,
    fontSize: 15,
    fontWeight: '800',
  },
  footnote: {
    color: theme.faint,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 13,
  },
  pressed: {
    opacity: 0.85,
  },
});
