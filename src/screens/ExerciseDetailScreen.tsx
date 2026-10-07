import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SimpleLineChart } from '../components/SimpleLineChart';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { getExerciseInstructions } from '../lib/exerciseInstructions';
import { countRemainingStatements } from '../lib/exerciseLearning';
import { getComparableLogSets } from '../lib/exerciseLog';
import { isMinutesExerciseName, isMinutesLogEntry } from '../lib/minutesExercises';
import { getExerciseTeaching, shouldShowTeachingCaution } from '../lib/exerciseTeaching';
import { calendarDaysBetween } from '../lib/completedSessions';
import { convertWeightFromKg, formatShortDate, removeTrailingZeros } from '../lib/format';
import { t } from '../lib/i18n';
import { exerciseMechanic, exerciseTypeOf } from '../lib/exerciseClassification';
import { exercisePickerLabel } from '../lib/exercisePicker';
import { ExerciseProgressSummary } from '../lib/progression';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage, ExerciseLibraryItem, SetupCautionFlag, UnitPreference } from '../types/models';


interface ExerciseDetailScreenProps {
  item: ExerciseLibraryItem;
  history?: ExerciseProgressSummary | null;
  unitPreference?: UnitPreference;
  language?: AppLanguage;
  onBack: () => void;
  /**
   * What the reader flagged in setup. Only used to decide whether this lift's
   * caution is for them — a warning everyone sees is furniture.
   */
  cautionFlags?: SetupCautionFlag[];
  /** Opens the easier/harder alternative on its own screen. */
  onOpenExercise?: (exerciseName: string) => void;
  /** Statement indexes this reader has ticked for this lift. */
  checkedStatements?: number[];
  onToggleStatement?: (index: number) => void;
  learned?: boolean;
  onToggleLearned?: () => void;
}

function toLabel(value: string | null | undefined, language: AppLanguage) {
  if (!value) {
    return '';
  }

  // The words every picker's row and chip use (exercisePickerLabel): this page
  // kept its own map, and said "Perusliike" and "Käsipaino" under a row that
  // read "Moninivel · Käsipainot" (#bugs 2026-10-06). The muscles, the raw
  // source equipment ("kettlebells", "body only") and the source levels are
  // in the same map; anything it does not know capitalises itself.
  return exercisePickerLabel(value, language);
}

function formatLastDone(iso: string, language: AppLanguage) {
  // Calendar days, not 24-hour spans: done at 21:00 yesterday is "yesterday"
  // at 09:00 today, not "today".
  const days = calendarDaysBetween(iso, Date.now());
  if (days <= 0) {
    return t(language, 'common.today');
  }
  if (days === 1) {
    return t(language, 'common.yesterday');
  }
  if (days < 7) {
    return t(language, 'common.daysAgo', { count: days });
  }
  if (days < 14) {
    return t(language, 'exDetail.lastWeek');
  }
  return formatShortDate(iso, language);
}

function ChevronLeftIcon() {
  const theme = useTheme();

  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path d="M15 6l-6 6 6 6" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}


function DumbbellIcon({ color: colorProp, size = 30 }: { color?: string; size?: number }) {
  const theme = useTheme();
  const color = colorProp ?? theme.faint;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function HeroImage({ uri }: { uri?: string | null }) {
  const styles = useThemedStyles(makeStyles);

  const [state, setState] = useState<'loading' | 'ok' | 'err'>(uri ? 'loading' : 'err');
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setState(uri ? 'loading' : 'err');
    opacity.setValue(0);
  }, [uri, opacity]);

  return (
    <View style={styles.hero}>
      {state !== 'ok' ? (
        <View style={styles.heroSkeleton}>
          {state === 'err' ? <DumbbellIcon /> : null}
        </View>
      ) : null}
      {uri ? (
        <Animated.Image
          source={{ uri }}
          resizeMode="cover"
          style={[styles.heroImage, { opacity }]}
          onLoad={() => {
            setState('ok');
            Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
          }}
          onError={() => setState('err')}
        />
      ) : null}
    </View>
  );
}

function TickIcon({ color: colorProp }: { color?: string }) {
  const theme = useTheme();

  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 12.5l5 5L19.5 7"
        stroke={colorProp ?? theme.onHighlight}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Chip({ label, filled }: { label: string; filled?: boolean }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.chip, filled ? styles.chipFilled : styles.chipSoft]}>
      <Text style={[styles.chipText, filled ? styles.chipTextFilled : styles.chipTextSoft]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

function StatCard({ label, value, meta }: { label: string; value: string; meta?: string }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={styles.statMeta}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

export function ExerciseDetailScreen({
  item,
  history = null,
  unitPreference = 'kg',
  language = 'en',
  onBack,
  cautionFlags = [],
  onOpenExercise,
  checkedStatements = [],
  onToggleStatement,
  learned = false,
  onToggleLearned,
}: ExerciseDetailScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  /**
   * What is written about this lift, beyond the order of the steps.
   *
   * Null for most of the library, and that is the designed state: the screen
   * renders the sections it has content for and is simply shorter otherwise.
   * An empty "THREE CUES" heading would be worse than no heading.
   */
  const teaching = getExerciseTeaching(item.name, language);
  const caution = shouldShowTeachingCaution(teaching?.caution, cautionFlags) ? teaching?.caution : null;
  const remainingChecks = teaching ? countRemainingStatements(teaching.check.length, checkedStatements) : 0;

  const bodyPartLabel = toLabel(item.bodyPart, language) || exercisePickerLabel('full body', language);
  const equipmentLabel =
    toLabel(item.sourceEquipment ?? item.equipment, language) || exercisePickerLabel('bodyweight', language);
  // The type the row prints (exerciseTypeOf) — a tyre flip is a specialty
  // movement here too — and, where it would repeat the body part, the
  // mechanic instead, as the row does (exerciseRowMetaValues).
  const rowType = exerciseTypeOf(item);
  const mechanicLabel =
    toLabel(rowType === item.bodyPart ? exerciseMechanic(item) ?? rowType : rowType, language) ||
    exercisePickerLabel('compound', language);
  const levelLabel = toLabel(item.sourceLevel ?? 'beginner', language) || t(language, 'myData.level.beginner');

  const primaryMuscles = (item.primaryMuscles ?? []).filter(Boolean);
  const secondaryMuscles = (item.secondaryMuscles ?? []).filter(Boolean);
  const primaryChips = primaryMuscles.length
    ? primaryMuscles.map((muscle) => toLabel(muscle, language))
    : [bodyPartLabel];

  const instructions = getExerciseInstructions(item.name, item.instructions, language);

  const logs = history?.logs ?? [];
  const hasHistory = logs.length > 0;

  const unloaded = (history?.bestWeight ?? 0) <= 0 && (history?.bestReps ?? 0) > 0;
  /*
   * The same rule for the line: an unloaded lift plots the reps it actually
   * did, rather than a row of zeroes with a date under each one.
   *
   * Through `getComparableLogSets`, which is what `bestReps` above is counted
   * from. A raw sum over `log.sets` counts warm-up sets too — a Hevy import
   * writes each set's `kind` — so the line could rise above the personal best
   * printed directly over it (CI review of #147).
   */
  const chartPoints = useMemo(
    () =>
      [...logs].reverse().map((log) => ({
        label: formatShortDate(log.performedAt, language),
        value: unloaded
          ? getComparableLogSets(log).reduce((sum, set) => sum + (set.reps ?? 0), 0)
          : convertWeightFromKg(log.weight, unitPreference),
      })),
    [language, logs, unloaded, unitPreference],
  );

  const trendDelta = useMemo(() => {
    if (chartPoints.length < 2) {
      return null;
    }
    return chartPoints[chartPoints.length - 1].value - chartPoints[0].value;
  }, [chartPoints]);

  /*
   * A lift with no bar is measured in reps, not in kilograms.
   *
   * `bestWeight` is 0 for a pull-up, not null, so `!= null` was true and the
   * card printed "0 kg" — under it a chart flat on the axis and "+0 kg since
   * start", to a reader who had gone from 21 reps to 33 (audit 3,
   * 2026-09-19). The library already answers this: `finalizeExerciseSummary`
   * computes `bestReps` and `latestValue` for exactly the unloaded case, and
   * Home's stat cards filter on `bestWeight > 0` for the same reason. This
   * screen was the one place printing the raw kilogram.
   */
  // A bike or a stair machine is measured in minutes: "20 min", not "20 reps"
  // — on the card, the trend and the chart's axis alike. Its logs say so when
  // there are any: a rower logged at 500 before the unit existed was metres,
  // and printed "500 min" when the name alone decided (#bugs 2026-10-07).
  const minutesLift = hasHistory ? logs.some((log) => isMinutesLogEntry(log)) : isMinutesExerciseName(item.name);
  const unloadedUnit = minutesLift ? 'min' : t(language, 'exDetail.repsUnit');
  const personalBest = unloaded
    ? minutesLift
      ? t(language, 'logger.minutesValue', { count: history?.bestReps ?? 0 })
      : t(language, 'exDetail.bestReps', { count: history?.bestReps ?? 0 })
    : history?.bestWeight != null && history.bestWeight > 0
      ? `${removeTrailingZeros(convertWeightFromKg(history.bestWeight, unitPreference))} ${unitPreference}`
      : '—';

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.iconButton}>
          <ChevronLeftIcon />
        </Pressable>
        <Text style={styles.topBarTitle}>{t(language, 'exDetail.title')}</Text>
        {/* The star was here too, and it went with the library's
            (2026-09-01). Its one effect — putting the lift on Progress before
            it had been logged — belongs to a target now, which names a number
            with it. The spacer keeps the title centred, and is only a width:
            it used to keep the button's surface and border too, and drew an
            empty square where the star had been. */}
        <View style={styles.iconSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <HeroImage uri={item.imageUrls?.[0] ?? null} />

        <View style={styles.titleBlock}>
          <Text style={styles.title}>{exerciseNameLabel(language, item.name)}</Text>
          <View style={styles.chipRow}>
            <Chip label={bodyPartLabel} filled />
            <Chip label={equipmentLabel} />
            <Chip label={mechanicLabel} />
            <Chip label={levelLabel} />
          </View>
        </View>

        {teaching ? (
          <>
            <View style={styles.section}>
              <SectionLabel>{t(language, 'exDetail.cues')}</SectionLabel>
              <View style={styles.teachCard}>
                {teaching.cues.map((cue, index) => (
                  <View
                    key={`cue-${index}`}
                    style={[styles.cueRow, index === teaching.cues.length - 1 && styles.cueRowLast]}
                  >
                    <Text style={styles.cueNumber}>{index + 1}</Text>
                    <Text style={styles.cueText}>{cue}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <SectionLabel>{t(language, 'exDetail.mistakes')}</SectionLabel>
              <View style={styles.mistakeCard}>
                {teaching.mistakes.map((entry, index) => (
                  <View
                    key={`mistake-${index}`}
                    style={[styles.mistakeRow, index === teaching.mistakes.length - 1 && styles.mistakeRowLast]}
                  >
                    <Text style={styles.mistakeTitle}>
                      {'×  '}
                      {entry.mistake}
                    </Text>
                    <Text style={styles.mistakeFix}>{entry.fix}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <SectionLabel>{t(language, 'exDetail.feel')}</SectionLabel>
              <View style={styles.feelCard}>
                <Text style={styles.feelText}>{teaching.feel}</Text>
                <View style={styles.tempoRow}>
                  {teaching.tempo.map((phrase) => (
                    <View key={phrase} style={styles.tempoChip}>
                      <Text style={styles.tempoChipText}>{phrase}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* Only for the reader who flagged this area in setup. */}
              {caution ? (
                <View style={styles.cautionCard}>
                  <Text style={styles.cautionText}>{caution.text}</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        <View style={styles.section}>
          <SectionLabel>{t(language, 'exDetail.yourHistory')}</SectionLabel>
          {hasHistory ? (
            <>
              <View style={styles.statGrid}>
                <StatCard
                  label={t(language, 'exDetail.personalBest')}
                  value={personalBest}
                  meta={t(language, unloaded ? 'exDetail.bestSession' : 'exDetail.topSet')}
                />
                <StatCard
                  label={t(language, 'exDetail.lastDone')}
                  value={history?.latestLog ? formatLastDone(history.latestLog.performedAt, language) : '—'}
                  meta={history?.latestLog?.workoutNameSnapshot ?? undefined}
                />
                <StatCard
                  label={t(language, 'detail.sessions').toUpperCase()}
                  value={`${logs.length}`}
                  meta={t(language, 'exDetail.logged')}
                />
              </View>
              <View style={styles.workingWeightHeader}>
                <Text style={styles.workingWeightLabel}>
                  {t(language, unloaded ? 'exDetail.repsPerSession' : 'progress.workingWeight')}
                </Text>
                {trendDelta != null ? (
                  <Text style={[styles.workingWeightDelta, trendDelta < 0 && styles.workingWeightDeltaDown]}>
                    {trendDelta >= 0 ? '+' : ''}
                    {/* The unit follows the measure, not the setting. The card
                        above says "33 toistoa" for an unloaded lift, and this
                        read "+12 kg" beside it (CI review of #147). */}
                    {removeTrailingZeros(trendDelta)}{' '}
                    {unloaded ? unloadedUnit : unitPreference}{' '}
                    {t(language, 'exDetail.sinceStart')}
                  </Text>
                ) : null}
              </View>
              <SimpleLineChart
                points={chartPoints}
                accent={theme.purple}
                unitLabel={unloaded ? unloadedUnit : unitPreference}
                emptyLabel={t(language, 'progress.noEntries')}
              />
            </>
          ) : (
            <View style={styles.emptyHistoryCard}>
              <DumbbellIcon color={theme.faint} size={28} />
              <Text style={styles.emptyHistoryTitle}>{t(language, 'exDetail.noHistory')}</Text>
              <Text style={styles.emptyHistoryBody}>{t(language, 'exDetail.noHistoryBody')}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionLabel>{t(language, 'exDetail.targetMuscles')}</SectionLabel>
          <View style={styles.musclesCard}>
            <Text style={styles.musclesGroupLabel}>{t(language, 'exDetail.primary')}</Text>
            <View style={styles.chipRow}>
              {primaryChips.map((muscle) => (
                <Chip key={`p-${muscle}`} label={muscle} filled />
              ))}
            </View>
            {secondaryMuscles.length ? (
              <>
                <Text style={[styles.musclesGroupLabel, styles.musclesGroupLabelSpaced]}>
                  {t(language, 'exDetail.secondary')}
                </Text>
                <View style={styles.chipRow}>
                  {secondaryMuscles.map((muscle) => (
                    <Chip key={`s-${muscle}`} label={toLabel(muscle, language)} />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </View>

        {teaching && teaching.swaps.length > 0 ? (
          <View style={styles.section}>
            <SectionLabel>{t(language, 'exDetail.swaps')}</SectionLabel>
            <View style={{ gap: 10 }}>
              {teaching.swaps.map((swap) => (
                <Pressable
                  key={`${swap.direction}-${swap.exerciseName}`}
                  accessibilityRole="button"
                  disabled={!onOpenExercise}
                  onPress={() => onOpenExercise?.(swap.exerciseName)}
                  style={({ pressed }) => [styles.swapCard, pressed && styles.swapCardPressed]}
                >
                  {/* Green for easier, orange for harder: the direction is the
                      first thing to read, before the name. */}
                  <View
                    style={[
                      styles.swapRail,
                      { backgroundColor: swap.direction === 'easier' ? theme.green : theme.highlight },
                    ]}
                  />
                  <View style={styles.swapBody}>
                    <Text style={styles.swapDirection}>
                      {t(language, swap.direction === 'easier' ? 'exDetail.easier' : 'exDetail.harder')}
                    </Text>
                    <Text style={styles.swapName}>{exerciseNameLabel(language, swap.exerciseName)}</Text>
                    <Text style={styles.swapWhy}>{swap.why}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionLabel>{t(language, 'exDetail.howTo')}</SectionLabel>
          <View style={styles.howToCard}>
            {instructions.length ? (
              instructions.map((step, index) => (
                <View
                  key={`step-${index}`}
                  style={[styles.howToStep, index === instructions.length - 1 && styles.howToStepLast]}
                >
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))
            ) : (
              <View style={[styles.howToStep, styles.howToStepLast]}>
                <Text style={styles.stepTextMuted}>{t(language, 'exDetail.noSteps')}</Text>
              </View>
            )}
          </View>
        </View>

        {teaching && teaching.check.length > 0 ? (
          <View style={styles.section}>
            <SectionLabel>{t(language, 'exDetail.check')}</SectionLabel>
            <View style={styles.checkCard}>
              {teaching.check.map((statement, index) => {
                const ticked = checkedStatements.includes(index);
                return (
                  <Pressable
                    key={`check-${index}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: ticked }}
                    accessibilityLabel={statement}
                    disabled={!onToggleStatement}
                    onPress={() => onToggleStatement?.(index)}
                    style={({ pressed }) => [
                      styles.checkRow,
                      index === teaching.check.length - 1 && styles.checkRowLast,
                      pressed && styles.checkRowPressed,
                    ]}
                  >
                    <View style={[styles.checkBox, ticked && styles.checkBoxTicked]}>
                      {ticked ? <TickIcon /> : null}
                    </View>
                    <Text style={[styles.checkText, ticked && styles.checkTextTicked]}>{statement}</Text>
                  </Pressable>
                );
              })}
              {/* Not a score. The statements you cannot tick are the ones
                  worth filming — so the counter names what is left, and stops
                  talking once nothing is. */}
              {remainingChecks > 0 ? (
                <Text style={styles.checkHint}>
                  {t(language, 'exDetail.checkRemaining', { count: remainingChecks })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {onToggleLearned ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: learned }}
            onPress={onToggleLearned}
            style={({ pressed }) => [
              styles.learnedButton,
              learned && styles.learnedButtonOn,
              pressed && { opacity: 0.9 },
            ]}
          >
            {learned ? <TickIcon color={theme.onHighlight} /> : null}
            <Text style={[styles.learnedText, learned && styles.learnedTextOn]}>
              {t(language, learned ? 'exDetail.learned' : 'exDetail.markLearned')}
            </Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>{t(language, 'exDetail.footnote')}</Text>
      </ScrollView>

      {/*
        No "Add to workout" bar.

        It opened the logger prefilled with this one lift — a workout of a
        single exercise, which is not a thing anyone comes to a reference page
        to start (user 2026-08-31). It was the last door of the same routing
        the library's "+" used, and it went out with it.

        What this screen is for is reading: the loop, the cues, what goes
        wrong, your own history. Adding a lift to something belongs where that
        something exists — the day you are editing, or the session you are in.
      */}
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSpacer: {
    width: 38,
    height: 38,
  },
  topBarTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.faint,
  },
  scroll: {
    flex: 1,
  },
  teachCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
  },
  cueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  cueRowLast: {
    borderBottomWidth: 0,
  },
  cueNumber: {
    color: theme.purpleBright,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
    minWidth: 12,
    fontVariant: ['tabular-nums'],
  },
  cueText: {
    flex: 1,
    color: theme.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  // Warm ground, not red: these are the ordinary ways a lift goes wrong, not
  // an error state. Red is what the discard button owns.
  mistakeCard: {
    backgroundColor: theme.amberSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    paddingHorizontal: 16,
  },
  mistakeRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.amberBorder,
    gap: 4,
  },
  mistakeRowLast: {
    borderBottomWidth: 0,
  },
  mistakeTitle: {
    color: theme.amberInk,
    fontSize: 14.5,
    fontWeight: '800',
    lineHeight: 20,
  },
  mistakeFix: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  feelCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 12,
  },
  feelText: {
    color: theme.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  tempoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tempoChip: {
    backgroundColor: theme.surfaceSoft,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tempoChipText: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  cautionCard: {
    marginTop: 10,
    backgroundColor: theme.amberSoft,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: theme.amber,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cautionText: {
    color: theme.amberInk,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '600',
  },
  swapCard: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  swapCardPressed: {
    opacity: 0.85,
  },
  swapRail: {
    width: 4,
  },
  swapBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 3,
  },
  swapDirection: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  swapName: {
    color: theme.ink,
    fontSize: 15.5,
    fontWeight: '800',
  },
  swapWhy: {
    color: theme.muted,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '600',
  },
  checkCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  checkRowLast: {
    borderBottomWidth: 0,
  },
  checkRowPressed: {
    opacity: 0.7,
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.8,
    borderColor: theme.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxTicked: {
    backgroundColor: theme.highlight,
    borderColor: theme.highlight,
  },
  checkText: {
    flex: 1,
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
  },
  checkTextTicked: {
    color: theme.muted,
  },
  checkHint: {
    color: theme.faint,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
    paddingBottom: 12,
  },
  learnedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 52,
    marginHorizontal: 18,
    marginTop: 22,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.purpleDark,
    backgroundColor: theme.surface,
  },
  learnedButtonOn: {
    backgroundColor: theme.highlight,
    borderColor: theme.highlight,
  },
  learnedText: {
    color: theme.purpleBright,
    fontSize: 15.5,
    fontWeight: '800',
  },
  learnedTextOn: {
    color: theme.onHighlight,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
    // The pinned CTA bar used to stand between the last line and the bottom
    // of the screen. With it gone the footnote ran into Android's gesture
    // strip, so the space it was providing stays as padding.
    paddingBottom: 40,
  },
  hero: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
  },
  heroSkeleton: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  titleBlock: {
    marginTop: 15,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 25,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  // The white-label violet (accessibility audit, 2026-09-21).
  chipFilled: {
    backgroundColor: theme.purpleFill,
  },
  chipSoft: {
    backgroundColor: theme.purpleLight,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextFilled: {
    color: '#FFFFFF',
  },
  chipTextSoft: {
    color: theme.purpleDark,
  },
  section: {
    marginTop: 24,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 11,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.faint,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  statLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    color: theme.faint,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: -0.3,
    marginTop: 5,
  },
  statMeta: {
    fontSize: 10.5,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 2,
  },
  workingWeightHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  workingWeightLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.ink,
  },
  workingWeightDelta: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.greenInk,
  },
  workingWeightDeltaDown: {
    color: theme.muted,
  },
  emptyHistoryCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingVertical: 26,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyHistoryTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.ink,
  },
  emptyHistoryBody: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
  musclesCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
  },
  musclesGroupLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: theme.faint,
  },
  musclesGroupLabelSpaced: {
    marginTop: 15,
  },
  howToCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  howToStep: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  howToStepLast: {
    borderBottomWidth: 0,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: theme.purpleDark,
  },
  stepText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: theme.ink,
    lineHeight: 21,
  },
  stepTextMuted: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: theme.muted,
    lineHeight: 21,
  },
  footnote: {
    fontSize: 11.5,
    fontWeight: '600',
    color: theme.faint,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 16,
  },
});
