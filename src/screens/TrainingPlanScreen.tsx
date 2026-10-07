import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NewProgramSheet } from '../components/NewProgramSheet';
import { ChevronIcon, SectionLabel, makeSettingsStyles } from '../components/SettingsUi';
import { CsvLibraryEntry } from '../lib/csvProgramImport';
import { I18nKey, t } from '../lib/i18n';
import type { ProgramImageImportResult } from '../utils/programImagePicker';
import { cycleSchedule, patternFromOnOff, trainsOn } from '../lib/trainingSchedule';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import type { AppLanguage, ExerciseLibraryItem, SetupWeekday, WorkoutTemplateDraft, ExerciseNameBookEntry } from '../types/models';

const WEEKDAY_CHIPS: Array<{ day: SetupWeekday; labelKey: I18nKey }> = [
  { day: 'mon', labelKey: 'weekday.mon' },
  { day: 'tue', labelKey: 'weekday.tue' },
  { day: 'wed', labelKey: 'weekday.wed' },
  { day: 'thu', labelKey: 'weekday.thu' },
  { day: 'fri', labelKey: 'weekday.fri' },
  { day: 'sat', labelKey: 'weekday.sat' },
  { day: 'sun', labelKey: 'weekday.sun' },
];

/** Same bounds the onboarding day question enforces. */
const MIN_TRAINING_DAYS = 2;
const MAX_TRAINING_DAYS = 6;

/**
 * How long a cycle may get.
 *
 * Not a rule about training, a rule about the editor: a stepper is a poor way
 * to reach twelve, and nobody keeping a rhythm that long is describing it as
 * "days on, days off". Reported rhythms are two-on-one-off and three-on-one-off.
 */
const MAX_CYCLE_ON = 6;
const MAX_CYCLE_OFF = 4;

/** Today's cycle preview, and the six days that follow it. */
const CYCLE_PREVIEW_DAYS = 7;

export interface TrainingCycleValue {
  pattern: boolean[];
  anchorDayStart: number;
}

/** Local midnight, the anchor a cycle counts from. */
function todayStart(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Reads "two on, one off" back out of a stored pattern, for the steppers. */
function onOffOf(cycle: TrainingCycleValue | null): { on: number; off: number } {
  if (!cycle) {
    return { on: 2, off: 1 };
  }
  const on = cycle.pattern.filter(Boolean).length;
  return { on: Math.max(1, on), off: Math.max(0, cycle.pattern.length - on) };
}

export interface TrainingPlanSessionItem {
  id: string;
  title: string;
  exerciseCount: number;
  totalSets: number;
  isNext: boolean;
}

interface TrainingPlanScreenProps {
  planName: string | null;
  planType: 'ready' | 'custom' | null;
  planDaysPerWeek: number | null;
  planExerciseCount: number | null;
  sessions: TrainingPlanSessionItem[];
  trainingDays: SetupWeekday[];
  /**
   * A rhythm that does not fit inside a week, when the reader keeps one. Null =
   * plain weekdays, and the weekday chips are the whole truth.
   */
  trainingCycle?: TrainingCycleValue | null;
  exerciseLibrary: ExerciseLibraryItem[];
  /** The reader's own lift names, for the CSV importer's matcher. */
  nameBook?: readonly ExerciseNameBookEntry[];
  onTeachName?: (wrote: string, exercise: CsvLibraryEntry) => Promise<void> | void;
  onPickImage?: () => Promise<ProgramImageImportResult>;
  language?: AppLanguage;
  onBack: () => void;
  /**
   * Opens straight into the weekday editor. Home sends the user here when the
   * week is unknown, and "Pick your training days" that lands on a read-only
   * schedule with an Edit button is a promise the screen did not keep.
   */
  startEditingSchedule?: boolean;
  onChangeTrainingDays: (days: SetupWeekday[]) => void;
  /** Null turns the cycle off and hands the week back to the weekday chips. */
  onChangeTrainingCycle?: (cycle: TrainingCycleValue | null) => void;
  /** Present only for custom plans — ready programs are immutable. */
  onEditCustomPlan?: () => void;
  onAiAssisted: () => void;
  /**
   * The catalog door. The same sheet opens here and on the Programs tab, and
   * a reader who creates programmes from this screen should not be the one
   * who never learns the ready catalog exists.
   */
  onBrowseCatalog?: () => void;
  /** How many ready programmes that door is promising. */
  catalogCount?: number;
  /** Whether AI-assisted composition is unlocked, or wears the padlock. */
  proUnlocked?: boolean;
  /** Where the padlock leads. */
  onOpenPaywall?: () => void;
  onBuildYourself: () => void;
  onImportProgram: (draft: WorkoutTemplateDraft) => Promise<boolean | void> | boolean | void;
}

function SessionTile({ title }: { title: string }) {
  const styles = useThemedStyles(makeStyles);

  const letter = title.trim().charAt(0).toUpperCase() || 'S';
  return (
    <View style={styles.sessionTile}>
      <Text style={styles.sessionTileText}>{letter}</Text>
    </View>
  );
}

/**
 * Screen 2 of the profile suite, V1 scope: view the active plan, edit the
 * weekly schedule (the single source of truth for training days), and start a
 * new plan. Session editing goes through the existing template editor and is
 * custom-only — ready programs stay immutable.
 */
export function TrainingPlanScreen({
  planName,
  planType,
  planDaysPerWeek,
  planExerciseCount,
  sessions,
  trainingDays,
  trainingCycle = null,
  exerciseLibrary,
  nameBook,
  onTeachName,
  onPickImage,
  language = 'en',
  onBack,
  startEditingSchedule = false,
  onChangeTrainingDays,
  onChangeTrainingCycle,
  onEditCustomPlan,
  onAiAssisted,
  onBrowseCatalog,
  catalogCount = 0,
  proUnlocked = true,
  onOpenPaywall,
  onBuildYourself,
  onImportProgram,
}: TrainingPlanScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const settingsStyles = useThemedStyles(makeSettingsStyles);
  // Read here, on the screen: inside NewProgramSheet's own Modal,
  // useSafeAreaInsets itself always answers 0.
  const insets = useSafeAreaInsets();
  const [editingSchedule, setEditingSchedule] = useState(startEditingSchedule);
  const [draftDays, setDraftDays] = useState<SetupWeekday[]>(trainingDays);
  const [createOpen, setCreateOpen] = useState(false);
  // The rhythm editor's own draft. Kept apart from the weekday draft so that
  // switching mode and back does not spend the days the reader had picked.
  const [draftCycleOn, setDraftCycleOn] = useState(trainingCycle !== null);
  const [draftOnOff, setDraftOnOff] = useState(() => onOffOf(trainingCycle));

  // A cycle overrides the weekdays everywhere else in the app, so the chips are
  // hidden rather than shown greyed: two rhythms on one card, one of them
  // inert, is how a screen ends up disagreeing with itself.
  const showCycle = editingSchedule ? draftCycleOn : trainingCycle !== null;
  const shownDays = editingSchedule ? draftDays : trainingDays;
  const draftValid = draftDays.length >= MIN_TRAINING_DAYS && draftDays.length <= MAX_TRAINING_DAYS;
  const draftDirty = [...draftDays].sort().join(',') !== [...trainingDays].sort().join(',');
  const draftPattern = patternFromOnOff(draftOnOff.on, draftOnOff.off);
  const cycleDirty =
    draftCycleOn !== (trainingCycle !== null) ||
    (draftCycleOn && draftPattern.join(',') !== (trainingCycle?.pattern ?? []).join(','));

  const beginEditingSchedule = () => {
    setDraftDays(trainingDays);
    setDraftCycleOn(trainingCycle !== null);
    setDraftOnOff(onOffOf(trainingCycle));
    setEditingSchedule(true);
  };

  const finishEditingSchedule = () => {
    if (cycleDirty && onChangeTrainingCycle) {
      // Today, not the day the plan was made: the reader is telling us where
      // they are in their rhythm right now, and an older anchor would put them
      // somewhere else in it.
      onChangeTrainingCycle(draftCycleOn ? { pattern: draftPattern, anchorDayStart: todayStart() } : null);
    }
    // The weekday list stays written even while a cycle overrides it — it is
    // what the reminders and the recommender read, and the cycle can be turned
    // off again.
    if (draftDirty) {
      if (!draftValid) {
        return; // Done stays disabled — the caption explains the 2–6 rule.
      }
      onChangeTrainingDays(draftDays);
    }
    setEditingSchedule(false);
  };

  const stepOnOff = (key: 'on' | 'off', delta: number) => {
    setDraftOnOff((current) => {
      const max = key === 'on' ? MAX_CYCLE_ON : MAX_CYCLE_OFF;
      const min = key === 'on' ? 1 : 0;
      return { ...current, [key]: Math.min(max, Math.max(min, current[key] + delta)) };
    });
  };

  const toggleDraftDay = (day: SetupWeekday) => {
    setDraftDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    );
  };

  const dayCountCaption = (count: number) =>
    t(language, count === 1 ? 'plan.dayCountOne' : 'plan.dayCount', { days: count, rest: 7 - count });

  const cyclePattern = showCycle
    ? editingSchedule
      ? draftPattern
      : trainingCycle?.pattern ?? draftPattern
    : draftPattern;
  const cycleOn = cyclePattern.filter(Boolean).length;

  const scheduleCaption = showCycle
    ? t(language, 'plan.rhythm.summary', {
        on: cycleOn,
        off: cyclePattern.length - cycleOn,
        length: cyclePattern.length,
      })
    : editingSchedule
      ? draftValid || draftDays.length === 0
        ? dayCountCaption(draftDays.length)
        : t(language, 'plan.pickDays', { min: MIN_TRAINING_DAYS, max: MAX_TRAINING_DAYS })
      : trainingDays.length > 0
        ? dayCountCaption(trainingDays.length)
        : t(language, 'plan.noDays');

  /**
   * The next week under the rhythm as it currently stands.
   *
   * Days-on-days-off is easy to get wrong in the head and impossible to get
   * wrong when you can see it: this is the only part of the editor that proves
   * the setting means what the reader thinks it means.
   */
  const cyclePreview = (() => {
    if (!showCycle) {
      return [];
    }
    const anchor = editingSchedule || !trainingCycle ? todayStart() : trainingCycle.anchorDayStart;
    const schedule = cycleSchedule(cyclePattern, anchor);
    const now = new Date();
    return Array.from({ length: CYCLE_PREVIEW_DAYS }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      return {
        key: date.getTime(),
        label: t(language, WEEKDAY_CHIPS[date.getDay() === 0 ? 6 : date.getDay() - 1].labelKey),
        training: trainsOn(schedule, date),
      };
    });
  })();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'common.back')}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path d="M15 5l-7 7 7 7" stroke={theme.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text style={styles.headerTitle}>{t(language, 'plan.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {planName ? (
          <>
            {/* ACTIVE PLAN */}
            <View style={styles.activeCard}>
              <View style={styles.activeTopRow}>
                <View style={styles.activePill}>
                  <View style={styles.activeDot} />
                  <Text style={styles.activePillText}>{t(language, 'plan.active')}</Text>
                </View>
                {planDaysPerWeek ? (
                  <Text style={styles.activeMeta}>
                    {t(language, 'plan.perWeek', { count: planDaysPerWeek })}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.activeName}>{planName}</Text>
              {/* No session-name caption here: the TREENIT list right below
                  carries the days in full, and this line truncated them into
                  "Koko keho + H..." (#bugs 2026-08-25). */}
              {planExerciseCount ? (
                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {t(language, planExerciseCount === 1 ? 'plan.exerciseCountOne' : 'plan.exerciseCount', { count: planExerciseCount })}
                    </Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {t(language, planType === 'ready' ? 'plan.readyProgram' : 'plan.customPlan')}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* SCHEDULE */}
            <View style={settingsStyles.section}>
              <SectionLabel
                label={t(language, 'plan.schedule')}
                actionLabel={
                  editingSchedule
                    ? draftDirty && !draftValid
                      ? undefined
                      : t(language, 'plan.done')
                    : t(language, 'plan.edit')
                }
                onAction={editingSchedule ? finishEditingSchedule : beginEditingSchedule}
              />
              <View style={[settingsStyles.card, styles.scheduleCard]}>
                {/* RHYTHM SWITCH — only while editing. Read-only, the card says
                    what the rhythm IS; a pair of tabs would invite a tap that
                    changes nothing. */}
                {editingSchedule && onChangeTrainingCycle ? (
                  <View style={styles.rhythmTabs}>
                    {([false, true] as const).map((cycle) => (
                      <Pressable
                        key={cycle ? 'cycle' : 'weekdays'}
                        accessibilityRole="button"
                        accessibilityState={{ selected: draftCycleOn === cycle }}
                        onPress={() => setDraftCycleOn(cycle)}
                        style={[styles.rhythmTab, draftCycleOn === cycle && styles.rhythmTabActive]}
                      >
                        <Text
                          style={[styles.rhythmTabText, draftCycleOn === cycle && styles.rhythmTabTextActive]}
                        >
                          {t(language, cycle ? 'plan.rhythm.cycle' : 'plan.rhythm.weekdays')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {showCycle ? (
                  <>
                    {editingSchedule ? (
                      <View style={styles.stepperGroup}>
                        {([
                          { key: 'on' as const, labelKey: 'plan.rhythm.onDays' as const, a11y: 'plan.rhythm.a11yOn' as const },
                          { key: 'off' as const, labelKey: 'plan.rhythm.offDays' as const, a11y: 'plan.rhythm.a11yOff' as const },
                        ]).map((row) => (
                          <View key={row.key} style={styles.stepperRow}>
                            <Text style={styles.stepperLabel}>{t(language, row.labelKey)}</Text>
                            <View
                              accessibilityLabel={t(language, row.a11y, { count: draftOnOff[row.key] })}
                              style={styles.stepper}
                            >
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t(language, 'plan.rhythm.less')}
                                onPress={() => stepOnOff(row.key, -1)}
                                style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.6 }]}
                              >
                                <Text style={styles.stepperButtonText}>-</Text>
                              </Pressable>
                              <Text style={styles.stepperValue}>{draftOnOff[row.key]}</Text>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t(language, 'plan.rhythm.more')}
                                onPress={() => stepOnOff(row.key, 1)}
                                style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.6 }]}
                              >
                                <Text style={styles.stepperButtonText}>+</Text>
                              </Pressable>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* The next seven days, drawn. A rhythm stated in numbers is
                        easy to misread; the same rhythm laid on real weekdays is
                        not. */}
                    <View style={styles.weekdayRow}>
                      {cyclePreview.map((day) => (
                        <View key={day.key} style={styles.weekdayCell}>
                          <View style={[styles.weekdayChip, day.training && styles.weekdayChipActive]}>
                            <Text
                              style={[styles.weekdayChipText, day.training && styles.weekdayChipTextActive]}
                            >
                              {day.label}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                    {editingSchedule ? (
                      <Text style={styles.scheduleCaption}>{t(language, 'plan.rhythm.startsToday')}</Text>
                    ) : null}
                  </>
                ) : (
                <View style={styles.weekdayRow}>
                  {WEEKDAY_CHIPS.map((chip) => {
                    const active = shownDays.includes(chip.day);
                    const inner = (
                      <View
                        style={[
                          styles.weekdayChip,
                          active && styles.weekdayChipActive,
                          editingSchedule && styles.weekdayChipEditing,
                        ]}
                      >
                        <Text style={[styles.weekdayChipText, active && styles.weekdayChipTextActive]}>
                          {t(language, chip.labelKey)}
                        </Text>
                      </View>
                    );

                    return editingSchedule ? (
                      <Pressable
                        key={chip.day}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={t(language, 'plan.trainingDay', {
                          day: t(language, chip.labelKey),
                        })}
                        onPress={() => toggleDraftDay(chip.day)}
                        style={styles.weekdayCell}
                      >
                        {inner}
                      </Pressable>
                    ) : (
                      <View key={chip.day} style={styles.weekdayCell}>
                        {inner}
                      </View>
                    );
                  })}
                </View>
                )}
                <Text style={styles.scheduleCaption}>{scheduleCaption}</Text>
              </View>
            </View>

            {/* SESSIONS */}
            <View style={settingsStyles.section}>
              <SectionLabel label={t(language, 'plan.sessions')} />
              <View style={settingsStyles.card}>
                {sessions.map((session, index) => {
                  const row = (
                    <View
                      style={[styles.sessionRow, index === sessions.length - 1 && styles.sessionRowLast]}
                    >
                      <SessionTile title={session.title} />
                      <View style={styles.sessionCopy}>
                        <View style={styles.sessionTitleRow}>
                          <Text numberOfLines={2} style={styles.sessionTitle}>
                            {session.title}
                          </Text>
                          {session.isNext ? (
                            <View style={styles.nextBadge}>
                              <Text style={styles.nextBadgeText}>{t(language, 'plan.upNext')}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.sessionMeta}>
                          {t(language, 'plan.sessionMeta', {
                            exercises: session.exerciseCount,
                            sets: session.totalSets,
                          })}
                        </Text>
                      </View>
                      {onEditCustomPlan ? <ChevronIcon /> : null}
                    </View>
                  );

                  return onEditCustomPlan ? (
                    <Pressable
                      key={session.id}
                      accessibilityRole="button"
                      onPress={onEditCustomPlan}
                      style={({ pressed }) => pressed && { opacity: 0.65 }}
                    >
                      {row}
                    </Pressable>
                  ) : (
                    <View key={session.id}>{row}</View>
                  );
                })}
              </View>
              {/* "Tee tästä oma versio" stood under this note. Removed with
                  the other two: a fixed programme is now changed by changing a
                  lift in it, and the copy happens underneath that. */}
              {!onEditCustomPlan ? (
                <Text style={styles.readOnlyNote}>{t(language, 'plan.readOnlyNote')}</Text>
              ) : null}
            </View>

          </>
        ) : (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>{t(language, 'plan.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t(language, 'plan.emptyBody')}</Text>
          </View>
        )}

        {/* CREATE */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setCreateOpen(true)}
          style={({ pressed }) => [styles.createButton, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.createButtonText}>{t(language, 'plan.createNew')}</Text>
        </Pressable>
        <Text style={styles.footNote}>{t(language, 'plan.footNote')}</Text>
      </ScrollView>

      <NewProgramSheet
        language={language}
        visible={createOpen}
        exerciseLibrary={exerciseLibrary}
        nameBook={nameBook}
        onTeachName={onTeachName}
        onPickImage={onPickImage}
        bottomInset={insets.bottom}
        onClose={() => setCreateOpen(false)}
        onAiAssisted={() => {
          setCreateOpen(false);
          onAiAssisted();
        }}
        onBrowseCatalog={
          onBrowseCatalog
            ? () => {
                setCreateOpen(false);
                onBrowseCatalog();
              }
            : undefined
        }
        catalogCount={catalogCount}
        proUnlocked={proUnlocked}
        onOpenPaywall={onOpenPaywall}
        onBuildYourself={() => {
          setCreateOpen(false);
          onBuildYourself();
        }}
        onImportProgram={onImportProgram}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 40,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: layout.bottomTabBarReserve,
  },
  activeCard: {
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.purple,
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
    shadowColor: theme.purple,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  activeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#E4F6EA',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1FA64E',
  },
  activePillText: {
    color: '#157A3A',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  activeMeta: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '700',
  },
  activeName: {
    color: theme.ink,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: theme.purpleDark,
    fontSize: 12,
    fontWeight: '800',
  },
  scheduleCard: {
    paddingVertical: 15,
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rhythmTabs: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: theme.surfaceSoft,
    borderRadius: 12,
    padding: 3,
    marginBottom: 14,
  },
  rhythmTab: {
    flex: 1,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rhythmTabActive: {
    backgroundColor: theme.surface,
  },
  rhythmTabText: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '800',
  },
  rhythmTabTextActive: {
    color: theme.ink,
  },
  stepperGroup: {
    gap: 10,
    marginBottom: 14,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stepperLabel: {
    // flexShrink, not flex:1 — a two-line Finnish label must be allowed to wrap
    // rather than push the stepper off the card.
    flexShrink: 1,
    color: theme.ink,
    fontSize: 13.5,
    fontWeight: '700',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceSoft,
    borderRadius: 12,
  },
  // 44 square, drawn and touched. A hitSlop would not do here: the pill
  // behind the two buttons is their parent, Android clips a slop to it, and
  // a 34-tall pill would have cut the target straight back to 38×34
  // (accessibility audit, 2026-09-21).
  stepperButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: '800',
    // The glyphs sit high in the line box at this weight; nudged so the row
    // does not read as top-aligned against the number beside it.
    marginTop: -2,
  },
  stepperValue: {
    minWidth: 22,
    textAlign: 'center',
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  weekdayCell: {
    flex: 1,
  },
  weekdayChip: {
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The calendar colour logic, worn by the week strip too: a training day is
  // the highlight, a rest day stays quiet (user 2026-08-25).
  weekdayChipActive: {
    backgroundColor: theme.highlightSoft,
  },
  weekdayChipEditing: {
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  weekdayChipText: {
    color: theme.faint,
    fontSize: 12.5,
    fontWeight: '800',
  },
  weekdayChipTextActive: {
    color: theme.highlight,
  },
  scheduleCaption: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 12,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  sessionRowLast: {
    borderBottomWidth: 0,
  },
  sessionTile: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionTileText: {
    color: theme.purpleDark,
    fontSize: 16,
    fontWeight: '800',
  },
  sessionCopy: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionTitle: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  nextBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
  },
  nextBadgeText: {
    color: theme.purpleDark,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sessionMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  readOnlyNote: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  emptyBlock: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 20,
  },
  createButton: {
    height: 50,
    borderRadius: 15,
    // The white-label violet (accessibility audit, 2026-09-21).
    backgroundColor: theme.purpleFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  footNote: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
  },
});
