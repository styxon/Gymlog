import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import { VinhaIcon } from '../components/VinhaIcon';
import { EmptyBox } from '../components/EmptyBox';
import { KitRow, KitSheet } from '../components/sheetKit';
import { Seg } from '../components/Seg';
import {
  formatOverviewVolumeTick,
  getOverviewBodyweightTicks,
  getOverviewDurationTicks,
  getOverviewVolumeTicks,
} from '../lib/progressChartTicks';
import { DEFAULT_MEASUREMENT_VALUE, measurementUnitForKind } from '../lib/measurementKinds';
import { SimpleLineChart } from '../components/SimpleLineChart';
import { WeightTrendChart } from '../components/WeightTrendChart';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BmiEditSheet, MeasureLogSheet, WeightLogSheet } from '../components/MeasureRulerSheet';
import { WeightBmiCards } from '../components/WeightBmiCards';
import {
  buildBodyweightCardStats,
  buildValueWindow,
  buildWeightWindow,
  capRangeDays,
  earliestEntryMs,
  measureRangeDays,
  windowValueDelta,
} from '../lib/bodyweightCard';
import type { HomeRecentSessionItem } from './HomeScreen';
import { formatLiftDisplayLabel } from '../lib/displayLabel';
import {
  convertWeightFromKg,
  convertWeightToKg,
  formatCompactVolume,
  formatDate,
  formatDurationMinutes,
  formatShortDate,
  formatSessionDate,
  formatTime,
  formatVolume,
  formatWeight,
  getDateTimeFormat,
  localeFor,
  parseNumberInput,
  removeTrailingZeros,
} from '../lib/format';
import { localDateKey, subtractCalendarMonths } from '../lib/completedSessions';
import { getSummaryChartPoints, getTrackedSummaryValues } from '../lib/progressChartPoints';
import { addCardioMinutesByDay } from '../lib/dashboard';
import { getCombinedActivityMinutes } from '../lib/cardio';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { I18nKey, t } from '../lib/i18n';
import { ProMomentContent, WeeklyReadRow } from '../lib/proInsights';
import { ProLockedCard } from '../components/ProLockedCard';
import { ProMomentSheet } from '../components/ProMomentSheet';
import { RecoverySheet } from '../components/RecoverySheet';
import type { RecoveryActionKind, RecoverySheetModel } from '../lib/recoverySheet';
import { SetLogSheet } from '../components/SetLogSheet';
import { buildExerciseSetLog, ExerciseSetLog } from '../lib/exerciseSetLog';
import { weeklyTrainingStreak } from '../lib/trainingCalendar';
import { PW } from '../lightTheme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import {
  isMeasureRangeLocked,
  isRecordLocked,
  isSetLogLocked,
  isTrendRangeLocked,
  resolveMeasureRange,
  resolveTrendRange,
} from '../lib/historyWindow';
import { getProgressActivityDayStatus } from '../lib/progressActivity';
import type { TrainingSchedule } from '../lib/trainingSchedule';
import type { PersonalRecord, RecordKind, RecordSource } from '../lib/personalRecords';
import { RecordRow, RecordsList } from './RecordsScreen';
import {
  BodyweightProgressSummary,
  ExerciseProgressSummary,
  getExerciseProgressSignal,
} from '../lib/progression';
import { TrainingRhythmSummary } from '../lib/trainingRhythm';
import { layout } from '../theme';
import {
  AppLanguage,
  CardioSession,
  MeasurementEntry,
  MeasurementKind,
  MeasurementUnit,
  UnitPreference,
  WorkoutSession,
} from '../types/models';

// One empty list for every render, so the default does not move the memo.
const EMPTY_CARDIO: Array<Pick<CardioSession, 'performedAt' | 'durationSec'>> = [];

type ProgressSection = 'overview' | 'records' | 'tracked' | 'measures';
type OverviewMetric = 'volume' | 'duration' | 'bodyweight';
type OverviewRange = '7d' | '1m' | '3m' | '6m' | 'all';
type MeasureKey =
  | 'bodyweight'
  | 'bodyfat'
  | 'shoulders'
  | 'chest'
  | 'back'
  | 'arms'
  | 'waist'
  | 'hips'
  | 'thighs'
  | 'calves';
type MeasureRange = '7d' | '3m' | '1y' | 'all';
type MeasureIconName = 'scale' | 'drop' | 'tape';

interface ProgressScreenProps {
  language?: AppLanguage;
  /**
   * One summary per target lift, holding every session logged under any name
   * for that lift and keyed by the lift's own name (App.tsx builds them with
   * getLiftProgress). Absent for a lift nothing was logged or aimed at.
   */
  summaries: ExerciseProgressSummary[];
  /**
   * The lifts a target can be set on, with the target if there is one.
   *
   * The same list the target flow offers — App.tsx builds it once as
   * goalFlowLifts. The tracked section shows these and only these: "tracked
   * sama kuin tavoite" (user, 2026-09-01). Every other logged lift is still
   * in Records, which still opens its set log.
   */
  targetLifts?: Array<{ exerciseName: string; targetKg: number | null; bestKg: number | null }>;
  onSetTarget?: (exerciseName: string) => void;
  bodyweightProgress: BodyweightProgressSummary;
  measurementEntries: MeasurementEntry[];
  /**
   * The completed sessions — getCanonicalCompletedSessions — which is what the
   * activity calendar is marked from. The streak and the month figures beside
   * it count these, so a session saved with nothing done is in neither.
   */
  workoutSessions: WorkoutSession[];
  /** Runs and rides: their minutes belong in the duration chart. */
  cardioSessions?: Array<Pick<CardioSession, 'performedAt' | 'durationSec'>>;
  /**
   * The plan's rhythm — cycle or weekdays — the same schedule Home and the
   * widget mark their calendars from, so all three agree on which day trains.
   */
  trainingSchedule?: TrainingSchedule;
  activityCalendar: {
    monthLabel: string;
    weekdayLabels: string[];
    weeks: Array<
      Array<{
        dayStart: number;
        dayNumber: number;
        active: boolean;
        isToday: boolean;
        inCurrentMonth: boolean;
      }>
    >;
  };
  rhythm: TrainingRhythmSummary;
  weeklyTargetSessions?: number | null;
  unitPreference: UnitPreference;
  initialSection?: ProgressSection;
  /** The measurement the measures section should select on arrival. */
  initialMeasure?: string;
  /**
   * Scroll the overview to a named block on arrival — the widget's calendar
   * tap should land ON the calendar, which lives mid-page (2026-08-25).
   */
  scrollToTarget?: 'activity';
  /**
   * Stamp of the notification tap that opened this route. The section and
   * measure effects listen to it as well as to their values: a second tap for
   * the same destination changes neither value, and the reader may have moved
   * since the first.
   */
  routeOpenedAt?: number;
  selectedExerciseKey?: string;
  /**
   * The three most recent records, and how many there are in total.
   *
   * The overview shows the ones just set; the full list has its own screen,
   * because three kinds of "best" do not fit a section.
   */
  topRecords?: PersonalRecord[];
  recordCount?: number;
  /** Every lift's record, per kind — the Records tab's whole content. */
  records?: Record<RecordKind, PersonalRecord[]>;
  /** One entry per tracked lift, for the set log behind each curve. */
  setLogSources?: RecordSource[];
  /**
   * The set logs the target rows open, one per entry of `summaries`.
   *
   * Separate from `setLogSources` because the two can share a key and not a
   * best: a record is one spelling's best, a target row is the lift under
   * every spelling. Each sheet has to agree with the row it was opened from.
   */
  liftSetLogSources?: RecordSource[];
  onStartWorkout?: () => void;
  showBodyweightDetail?: boolean;
  onAddBodyweight: (weightKg: number) => void;
  /**
   * Taking a reading back.
   *
   * The list below the card is the only place an individual entry has ever
   * been visible: the "all measures" rows show one line per MEASURE, latest
   * value only, so a mistyped 385 cm waist had nowhere to be removed from
   * (#bugs 2026-08-26, "mittaa ei saa poistettua").
   */
  onDeleteMeasurement?: (entryId: string) => void;
  onDeleteBodyweight?: (entryId: string) => void;
  /** Stated height, in cm. Null until the reader gives one — BMI waits for it. */
  heightCm?: number | null;
  onSaveHeight?: (heightCm: number) => void;
  onAddMeasurement: (kind: MeasurementKind, value: number, unit: MeasurementUnit) => Promise<void>;
  recentSessions?: HomeRecentSessionItem[];
  onOpenSessionHistory?: () => void;
  onOpenRecentSession?: (sessionId: string) => void;
  /** Paywall moment 3: traffic-light statuses (free) with Pro conclusions. */
  weeklyRead?: WeeklyReadRow[];
  readMoment?: ProMomentContent | null;
  proUnlocked?: boolean;
  onOpenPremium?: () => void;
  /** What the recovery row opens; null when the row is not there either. */
  recoverySheet?: RecoverySheetModel | null;
  onRecoveryAction?: (kind: RecoveryActionKind) => void;
  onRecoveryUndo?: (kind: 'lighten' | 'restTomorrow') => void;
}

// The activity grid is Monday-first, so these are the one-letter chips in that
// order — Finnish and English disagree on more of them than you would expect.
const PROGRESS_WEEKDAY_KEYS: I18nKey[] = [
  'onb.weekday.mon',
  'onb.weekday.tue',
  'onb.weekday.wed',
  'onb.weekday.thu',
  'onb.weekday.fri',
  'onb.weekday.sat',
  'onb.weekday.sun',
];

/**
 * Four sections, four marks, no words.
 *
 * Four text labels in a 351px row means the selected state is read word by word;
 * four marks are seen at a glance. The label survives as the accessibility name
 * on every tab, which is the part a screen reader needs and the part the eye
 * does not.
 *
 * Same 24-unit drawing language as the program category discs, in stroke-on-light
 * at tab weight. The barbell appears in both families on purpose — it means
 * "exercise" everywhere in this app, and the two rows never meet.
 */
const PROGRESS_SECTIONS: Array<{ key: ProgressSection; labelKey: I18nKey; icon: string }> = [
  {
    key: 'overview',
    labelKey: 'progress.section.overview',
    // A rising trend with a corner arrowhead: the summary answers one question.
    icon: 'M3.4 17.4 9.2 11.4l3.4 3 7.6-7.4M20.6 6.4h-4.4M20.6 6.4v4.4',
  },
  {
    key: 'records',
    labelKey: 'progress.section.records',
    // Trophy with both handles. A star would read as "favourite", and a medal
    // disc collides with the crosshair in the category set.
    icon: 'M7.8 4.2h8.4v3.2a4.2 4.2 0 0 1-8.4 0zM7.8 5.4H5.4a2.4 2.4 0 0 0 2.4 2.4M16.2 5.4h2.4a2.4 2.4 0 0 1-2.4 2.4M12 11.6v3.6M8.8 19.4h6.4',
  },
  {
    key: 'tracked',
    labelKey: 'progress.section.tracked',
    icon: 'M3.6 9.8v4.4M7 7.8v8.4M17 7.8v8.4M20.4 9.8v4.4M7 12h10',
  },
  {
    key: 'measures',
    labelKey: 'progress.section.measures',
    // A ruler edge, drawn open: a closed box fills in and goes solid at 22px.
    icon: 'M2.6 10.2h18.8M6.2 10.2v3.8M10.6 10.2v2.3M15 10.2v3.8M19.4 10.2v2.3',
  },
];

// Bodyweight first (user, 2026-09-02). It is the one a reader checks between
// sessions rather than after one, and it is the only metric here that moves on
// a day nothing was logged.
const OVERVIEW_METRICS: Array<{ key: OverviewMetric; labelKey: I18nKey }> = [
  { key: 'bodyweight', labelKey: 'progress.metric.bodyweight' },
  { key: 'volume', labelKey: 'progress.metric.volume' },
  { key: 'duration', labelKey: 'progress.metric.duration' },
];

// Range chips are numerals with a unit letter — the same in both languages
// except "All", which resolves through the dictionary at render.
// `label` is a language-neutral abbreviation where one exists; the two ranges
// that need a word carry the key instead, so neither can ship untranslated.
const OVERVIEW_RANGES: Array<{ key: OverviewRange; label: string | null; labelKey?: I18nKey }> = [
  { key: '7d', label: null, labelKey: 'progress.range.week' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'all', label: null, labelKey: 'progress.range.all' },
];

const MEASURE_RANGES: Array<{ key: MeasureRange; label: string | null; labelKey?: I18nKey }> = [
  { key: '7d', label: null, labelKey: 'progress.range.week' },
  { key: '3m', label: '3M' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: null, labelKey: 'progress.range.all' },
];

const MEASURE_CONFIG: Array<{
  key: MeasureKey;
  labelKey: I18nKey;
  /** Where to put the tape, shown in the logging sheet. */
  hintKey?: I18nKey;
  icon: MeasureIconName;
  kind: MeasurementKind | null;
  lowerIsBetter: boolean;
}> = [
  { key: 'bodyweight', labelKey: 'progress.measure.bodyweight', icon: 'scale', kind: null, lowerIsBetter: false },
  { key: 'bodyfat', labelKey: 'progress.measure.bodyfat', hintKey: 'progress.measure.hint.bodyfat', icon: 'drop', kind: 'bodyfat', lowerIsBetter: true },
  { key: 'shoulders', labelKey: 'progress.measure.shoulders', hintKey: 'progress.measure.hint.shoulders', icon: 'tape', kind: 'shoulders', lowerIsBetter: false },
  { key: 'chest', labelKey: 'progress.measure.chest', hintKey: 'progress.measure.hint.chest', icon: 'tape', kind: 'chest', lowerIsBetter: false },
  { key: 'back', labelKey: 'progress.measure.back', hintKey: 'progress.measure.hint.back', icon: 'tape', kind: 'back', lowerIsBetter: false },
  { key: 'arms', labelKey: 'progress.measure.arms', hintKey: 'progress.measure.hint.arms', icon: 'tape', kind: 'arms', lowerIsBetter: false },
  { key: 'waist', labelKey: 'progress.measure.waist', hintKey: 'progress.measure.hint.waist', icon: 'tape', kind: 'waist', lowerIsBetter: true },
  { key: 'hips', labelKey: 'progress.measure.hips', hintKey: 'progress.measure.hint.hips', icon: 'tape', kind: 'hips', lowerIsBetter: false },
  { key: 'thighs', labelKey: 'progress.measure.thighs', hintKey: 'progress.measure.hint.thighs', icon: 'tape', kind: 'thighs', lowerIsBetter: false },
  { key: 'calves', labelKey: 'progress.measure.calves', hintKey: 'progress.measure.hint.calves', icon: 'tape', kind: 'calves', lowerIsBetter: false },
];

// Honest signal palette (light) keyed by getExerciseProgressSignal kinds.
const SIGNAL_STYLES: Record<
  ReturnType<typeof getExerciseProgressSignal>['kind'],
  { fg: string; bg: string; dot: string }
> = {
  new_best: { fg: '#157A3A', bg: '#E4F6EA', dot: '#1FA64E' },
  moving_up: { fg: '#157A3A', bg: '#E9F6EE', dot: '#37C46B' },
  building: { fg: '#5B21B6', bg: '#EFE7FF', dot: '#8B5CF6' },
  below_last: { fg: '#9A5B16', bg: '#FBEFDD', dot: '#E0922F' },
  starting: { fg: '#667085', bg: '#EEF0F4', dot: '#98A2B3' },
};

const CM_TO_IN = 0.393700787;

// ── session/date helpers preserved from the previous Progress implementation ──

function getSessionDurationMinutes(session: WorkoutSession) {
  if (typeof session.durationMinutes === 'number' && Number.isFinite(session.durationMinutes)) {
    return Math.max(0, session.durationMinutes);
  }

  if (session.startedAt) {
    const duration = Math.round((new Date(session.performedAt).getTime() - new Date(session.startedAt).getTime()) / 60000);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  }

  return 0;
}

function getSessionVolumeKg(session: WorkoutSession) {
  if (typeof session.totalVolumeKg === 'number' && Number.isFinite(session.totalVolumeKg)) {
    return Math.max(0, session.totalVolumeKg);
  }

  return 0;
}

function getOverviewRangeStart(range: OverviewRange) {
  const now = new Date();
  const start = new Date(now);

  switch (range) {
    case '7d':
      // Six days back plus today — the same seven the weight card draws.
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return start;
    // Through subtractCalendarMonths, not setMonth: on the 31st the raw call
    // asks for a day the target month does not have and JavaScript answers
    // with one in the month after it, so "last month" began three days ago.
    case '1m':
      return subtractCalendarMonths(now, 1);
    case '3m':
      return subtractCalendarMonths(now, 3);
    case '6m':
      return subtractCalendarMonths(now, 6);
    case 'all':
    default:
      return null;
  }
}

function getOverviewBucketKey(dateString: string, range: OverviewRange) {
  // Local days and months: the labels are stored UTC instants, and their first
  // characters name the UTC day.
  const dayKey = localDateKey(dateString);
  if (range === '6m' || range === 'all') {
    return dayKey.slice(0, 7);
  }

  return dayKey;
}

function bucketOverviewPointsByRange(
  points: Array<{ label: string; value: number }>,
  range: OverviewRange,
  strategy: 'latest' | 'sum',
) {
  if ((range === '7d' || range === '1m' || range === '3m') && strategy === 'sum') {
    return points;
  }

  const buckets = new Map<string, { label: string; value: number; timestamp: number }>();

  for (const point of points) {
    const bucketKey = getOverviewBucketKey(point.label, range);
    const timestamp = new Date(point.label).getTime();
    const current = buckets.get(bucketKey);

    if (!current) {
      buckets.set(bucketKey, {
        label: point.label,
        value: point.value,
        timestamp,
      });
      continue;
    }

    if (strategy === 'sum') {
      current.value += point.value;
      if (timestamp > current.timestamp) {
        current.timestamp = timestamp;
        current.label = point.label;
      }
      continue;
    }

    if (timestamp > current.timestamp) {
      current.timestamp = timestamp;
      current.label = point.label;
      current.value = point.value;
    }
  }

  return [...buckets.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map(({ label, value }) => ({ label, value }));
}

function formatDayMonthLabel(dateString: string, language: AppLanguage) {
  const date = new Date(dateString);
  const month = getDateTimeFormat(localeFor(language), { month: 'short' }).format(date);
  return `${date.getDate()} ${month}`;
}

function formatMonthLabel(dateString: string, language: AppLanguage) {
  return getDateTimeFormat(localeFor(language), { month: 'short' }).format(new Date(dateString));
}

function formatMonthYearLabel(dateString: string, language: AppLanguage) {
  return getDateTimeFormat(localeFor(language), { month: 'short', year: '2-digit' }).format(
    new Date(dateString),
  );
}

function formatOverviewChartLabel(dateString: string, range: OverviewRange, language: AppLanguage) {
  switch (range) {
    case '7d':
    case '1m':
    case '3m':
      return formatDayMonthLabel(dateString, language);
    case '6m':
      return formatMonthLabel(dateString, language);
    case 'all':
    default:
      return formatMonthYearLabel(dateString, language);
  }
}

function getOverviewFooterLabels(
  points: Array<{ label: string; value: number }>,
  range: OverviewRange,
  language: AppLanguage,
) {
  if (!points.length) {
    return [];
  }

  if (points.length === 1) {
    return [formatOverviewChartLabel(points[0].label, range, language)];
  }

  const middleIndex = Math.floor((points.length - 1) / 2);
  const labels = [points[0].label];

  if (middleIndex > 0 && middleIndex < points.length - 1) {
    labels.push(points[middleIndex].label);
  }

  labels.push(points[points.length - 1].label);

  return [...new Set(labels)].map((label) => formatOverviewChartLabel(label, range, language));
}

function formatOverviewBodyweightTick(value: number, unitLabel: string) {
  return `${removeTrailingZeros(Number(value.toFixed(unitLabel === 'lb' ? 0 : 1)))} ${unitLabel}`;
}

function formatDurationTick(value: number) {
  if (value === 60) {
    return '1h';
  }
  if (value > 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${value}m`;
}

function convertMeasurementValue(value: number, fromUnit: MeasurementUnit, toUnit: MeasurementUnit) {
  if (fromUnit === toUnit) {
    return value;
  }

  if (fromUnit === '%' || toUnit === '%') {
    return value;
  }

  return fromUnit === 'cm' && toUnit === 'in' ? value * CM_TO_IN : value / CM_TO_IN;
}

function getSignalPriority(kind: ReturnType<typeof getExerciseProgressSignal>['kind']) {
  switch (kind) {
    case 'new_best':
      return 0;
    case 'moving_up':
      return 1;
    case 'below_last':
      return 2;
    case 'building':
      return 3;
    case 'starting':
    default:
      return 4;
  }
}

function compareProgressSummaries(left: ExerciseProgressSummary, right: ExerciseProgressSummary) {
  const priorityDelta =
    getSignalPriority(getExerciseProgressSignal(left).kind) - getSignalPriority(getExerciseProgressSignal(right).kind);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftDate = left.latestLog ? new Date(left.latestLog.performedAt).getTime() : 0;
  const rightDate = right.latestLog ? new Date(right.latestLog.performedAt).getTime() : 0;
  return rightDate - leftDate;
}

function fmtDelta(value: number) {
  return removeTrailingZeros(Number(value.toFixed(1)));
}

// ── glyphs ──

function ChevronRight({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  const theme = useTheme();

  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={open ? { transform: [{ rotate: '180deg' }] } : undefined}>
      <Path d="M6 9l6 6 6-6" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MeasureIcon({ name }: { name: MeasureIconName }) {
  const theme = useTheme();

  const common = { stroke: theme.purpleDark, strokeWidth: 2, fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'scale') {
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Rect x={3} y={3} width={18} height={18} rx={4} {...common} />
        <Path d="M8 8l4 4M8 8h4" {...common} />
      </Svg>
    );
  }
  if (name === 'drop') {
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path d="M12 3c3 4 6 7 6 11a6 6 0 01-12 0c0-4 3-7 6-11z" {...common} />
      </Svg>
    );
  }
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Rect x={3} y={8} width={18} height={8} rx={2} {...common} />
      <Path d="M7 8v4M11 8v4M15 8v4M19 8v4" {...common} />
    </Svg>
  );
}

function ArrowGlyph({ up, color }: { up: boolean; color: string }) {
  return (
    <Svg width={9} height={9} viewBox="0 0 12 12">
      <Path d={up ? 'M6 3l4 5H2z' : 'M6 9L2 4h8z'} fill={color} />
    </Svg>
  );
}

// ── shared light widgets ──

function SectionLabel({ label, right }: { label: string; right?: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadLabel}>{label}</Text>
      {typeof right === 'string' ? (
        <Text style={styles.sectionHeadRight}>{right}</Text>
      ) : (
        right ?? null
      )}
    </View>
  );
}

function SignalBadge({ summary, language }: { summary: ExerciseProgressSummary; language: AppLanguage }) {
  const styles = useThemedStyles(makeStyles);

  const signal = getExerciseProgressSignal(summary, language);
  const palette = SIGNAL_STYLES[signal.kind];
  return (
    <View style={[styles.signalBadge, { backgroundColor: palette.bg }]}>
      <View style={[styles.signalBadgeDot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.signalBadgeText, { color: palette.fg }]}>{signal.label}</Text>
    </View>
  );
}

function DeltaPill({ delta, unit, lowerIsBetter = false }: { delta: number; unit: string; lowerIsBetter?: boolean }) {
  const styles = useThemedStyles(makeStyles);

  const up = delta > 0;
  const good = lowerIsBetter ? !up : up;
  const color = good ? '#157A3A' : '#9A5B16';
  const background = good ? '#E7F6EC' : '#FBEFDD';
  return (
    <View style={[styles.deltaPill, { backgroundColor: background }]}>
      <ArrowGlyph up={up} color={color} />
      <Text style={[styles.deltaPillText, { color }]}>
        {up ? '+' : ''}
        {fmtDelta(delta)}
        {unit ? ` ${unit}` : ''}
      </Text>
    </View>
  );
}

function Sparkline({ values, color, width = 62, height = 28 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) {
    return <View style={{ width, height }} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.001);
  const x = (index: number) => (index / (values.length - 1)) * (width - 4) + 2;
  const y = (value: number) => height - 3 - ((value - min) / spread) * (height - 6);
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Polyline points={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.6} fill={color} />
    </Svg>
  );
}

export function ProgressScreen({
  summaries,
  targetLifts = [],
  onSetTarget,
  bodyweightProgress,
  measurementEntries,
  workoutSessions,
  cardioSessions = EMPTY_CARDIO,
  activityCalendar,
  trainingSchedule,
  rhythm,
  weeklyTargetSessions = null,
  unitPreference,
  language = 'en',
  initialSection,
  scrollToTarget,
  routeOpenedAt,
  initialMeasure,
  selectedExerciseKey,
  topRecords = [],
  recordCount = 0,
  records = { weight: [], reps: [], volume: [] },
  setLogSources = [],
  liftSetLogSources = [],
  onStartWorkout,
  showBodyweightDetail,
  onAddBodyweight,
  onDeleteMeasurement,
  onDeleteBodyweight,
  heightCm = null,
  onSaveHeight,
  onAddMeasurement,
  recentSessions = [],
  onOpenSessionHistory,
  onOpenRecentSession,
  weeklyRead = [],
  recoverySheet = null,
  onRecoveryAction,
  onRecoveryUndo,
  readMoment = null,
  proUnlocked = false,
  onOpenPremium,
}: ProgressScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const [readSheetVisible, setReadSheetVisible] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // Closed with its model: a row that goes and comes back (the model losing
  // and regaining confidence after a sync) must not bring the sheet back up
  // on its own.
  useEffect(() => {
    if (!recoverySheet) {
      setRecoveryOpen(false);
    }
  }, [recoverySheet]);
  const [progressSection, setProgressSection] = useState<ProgressSection>(initialSection ?? 'overview');
  // Which set log is open, and whether a target row opened it — see
  // liftSetLogSources for why the two lists are not one.
  const [setLogTarget, setSetLogTarget] = useState<{ key: string; fromLift: boolean } | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(selectedExerciseKey ?? null);
  const [overviewMetric, setOverviewMetric] = useState<OverviewMetric>('volume');
  // The week opens both charts (user 2026-08-25) — see TrendRange.
  const [overviewRange, setOverviewRange] = useState<OverviewRange>('7d');
  const [selectedMeasure, setSelectedMeasure] = useState<MeasureKey>(showBodyweightDetail ? 'bodyweight' : 'bodyweight');
  const [pendingEntryDelete, setPendingEntryDelete] = useState<string | null>(null);
  const [measureRange, setMeasureRange] = useState<MeasureRange>('7d');
  /**
   * Pro can lapse while this screen is mounted — a promo code expires, the
   * preview switch goes off — and the selected range is component state that
   * knows nothing about it. Resolving on every render means the chart narrows
   * instead of quietly still drawing the paid window.
   */
  const resolvedOverviewRange = resolveTrendRange(overviewRange, proUnlocked);
  const resolvedMeasureRange = resolveMeasureRange(measureRange, proUnlocked);
  const lockedTrendRanges = OVERVIEW_RANGES.map((option) => option.key).filter((key) =>
    isTrendRangeLocked(key, proUnlocked),
  );
  const lockedMeasureRanges = MEASURE_RANGES.map((option) => option.key).filter((key) =>
    isMeasureRangeLocked(key, proUnlocked),
  );
  const [measureSheetVisible, setMeasureSheetVisible] = useState(false);
  const [weightSheetVisible, setWeightSheetVisible] = useState(false);
  const [bmiSheetVisible, setBmiSheetVisible] = useState(false);
  // One press, one entry. A ruler sheet closes on the next render, and a
  // second tap landing before it wrote a second weigh-in a few milliseconds
  // after the first (break round, 2026-09-28). Taken on Save, given back each
  // time a sheet opens.
  const rulerSaveTakenRef = useRef(false);
  useEffect(() => {
    if (weightSheetVisible || measureSheetVisible || bmiSheetVisible) {
      rulerSaveTakenRef.current = false;
    }
  }, [weightSheetVisible, measureSheetVisible, bmiSheetVisible]);
  function takeRulerSave() {
    if (rulerSaveTakenRef.current) {
      return false;
    }
    rulerSaveTakenRef.current = true;
    return true;
  }
  /**
   * Whether the entries list is showing its deletes.
   *
   * The brief: "Entries get the History treatment: no × on a resting row." A
   * delete sitting on every row of a list you are only reading is a mistake
   * waiting for a mis-tap, and this list is three rows of numbers you scroll
   * past on the way to the chart.
   */
  const [entriesEditing, setEntriesEditing] = useState(false);
  /** The picker behind "Track another measure". */
  const [measurePickerVisible, setMeasurePickerVisible] = useState(false);
  const bodyweightStats = useMemo(
    () => buildBodyweightCardStats(bodyweightProgress.entries),
    [bodyweightProgress.entries],
  );
  /**
   * The weight chart's x-axis. Every range trails now, ending today.
   *
   * 7D used to be CENTRED on today, so a reader's very first weigh-in landed
   * in the middle of the card rather than pinned to an edge. It also meant the
   * chip reached three days back and called it a week, which drew an empty
   * chart for someone who had weighed in on Tuesday (#bugs 2026-09-05). The
   * two window builders still differ — the week counts days, the longer ranges
   * derive theirs from the first entry — but they now agree about which end
   * today is on.
   */
  const weightWindowDays = useMemo(() => {
    const nowMs = Date.now();
    if (resolvedMeasureRange === '7d') {
      return buildWeightWindow(bodyweightProgress.entries, nowMs);
    }
    const entries = bodyweightProgress.entries.map((entry) => ({
      recordedAt: entry.recordedAt,
      value: entry.weight,
    }));
    // The summary sorts newest first; the anchor is the earliest weigh-in.
    const first = earliestEntryMs(entries.map((entry) => entry.recordedAt));
    const days = measureRangeDays(resolvedMeasureRange, first, nowMs);
    return buildValueWindow(entries, nowMs, days, language);
  }, [bodyweightProgress.entries, resolvedMeasureRange, language]);
  /**
   * What the rulers open on. Not a default the reader has to correct: their
   * last weigh-in, or the weight onboarding recorded, and only then a middle-
   * of-the-range number that at least costs a short drag rather than a long one.
   */
  const rulerWeightKg = bodyweightStats.currentKg ?? 75;
  const rulerHeightCm = heightCm ?? 175;
  // The list's ref: the widget's calendar jump drives it through here.
  const scrollRef = useRef<ScrollView>(null);

  const trainingStreak = useMemo(
    () => weeklyTrainingStreak(workoutSessions, cardioSessions),
    [cardioSessions, workoutSessions],
  );

  const openSetLog: ExerciseSetLog | null = useMemo(() => {
    if (setLogTarget === null) {
      return null;
    }
    const pool = setLogTarget.fromLift ? liftSetLogSources : setLogSources;
    const source = pool.find((entry) => entry.key === setLogTarget.key);
    return source ? buildExerciseSetLog(source) : null;
  }, [liftSetLogSources, setLogTarget, setLogSources]);

  useEffect(() => {
    if (initialSection) {
      setProgressSection(initialSection);
    }
  }, [initialSection, routeOpenedAt]);

  // The old bodyweight detail route now lands on the Measures tab. Lift deep
  // links are answered below trackedRows, which they need.
  useEffect(() => {
    if (showBodyweightDetail) {
      setProgressSection('measures');
      setSelectedMeasure('bodyweight');
    }
  }, [showBodyweightDetail]);

  // The widget's calendar tap: land ON the calendar, not at the top of the
  // overview it lives halfway down. The block's y is only known once it has
  // laid out, so whichever happens last — the request or the layout — does
  // the scrolling.
  const activityBlockY = useRef<number | null>(null);
  const pendingActivityScroll = useRef(false);
  const scrollToActivityBlock = () => {
    if (activityBlockY.current === null) {
      return;
    }
    pendingActivityScroll.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, activityBlockY.current - 8), animated: true });
  };
  useEffect(() => {
    if (scrollToTarget === 'activity') {
      // The y belongs to an overview that is on screen. Asked from another
      // section it is a leftover of an earlier visit, the block mounts again
      // under a new layout, and the scroll has to wait for that one.
      if (progressSection !== 'overview') {
        activityBlockY.current = null;
      }
      setProgressSection('overview');
      pendingActivityScroll.current = true;
      scrollToActivityBlock();
    }
    // routeOpenedAt: a second tap on the widget's calendar names the same
    // target as the first, and only its stamp says "go there again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToTarget, routeOpenedAt]);

  function switchSection(section: ProgressSection) {
    setProgressSection(section);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  // ── overview data ──

  const prioritizedSummaries = useMemo(() => [...summaries].sort(compareProgressSummaries), [summaries]);

  const calendarMonthLabel = useMemo(() => {
    const currentMonthDay = activityCalendar.weeks.flat().find((day) => day.inCurrentMonth);

    if (!currentMonthDay) {
      return activityCalendar.monthLabel;
    }

    // Hardcoded en-US put "August 2026" above a Finnish calendar, under a
    // Finnish heading, in an otherwise Finnish app.
    return getDateTimeFormat(language === 'fi' ? 'fi-FI' : 'en-US', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(currentMonthDay.dayStart));
  }, [activityCalendar.monthLabel, activityCalendar.weeks, language]);

  const monthStats = useMemo(() => {
    const currentMonthDay = activityCalendar.weeks.flat().find((day) => day.inCurrentMonth);
    const monthStart = currentMonthDay ? new Date(currentMonthDay.dayStart) : new Date();
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const inMonth = (performedAt: string) => {
      const at = new Date(performedAt);
      return at >= monthStart && at < monthEnd;
    };
    const currentMonthSessions = workoutSessions.filter((session) => inMonth(session.performedAt));
    /*
     * The runs count too, because the calendar right beside these figures
     * marks the days they were run on.
     *
     * This read `workoutSessions` alone, so a month of running showed a grid
     * full of marked days over "0 treeniä tässä kuussa" — while the duration
     * chart on the same tab already counted the same runs' minutes. The
     * widget's own month totals fixed exactly this and say so: "Workouts 0 ·
     * Duration 3 h is a contradiction" (audit 3, 2026-09-19).
     *
     * Volume stays strength-only: a run has no tonnage, and adding zero to it
     * would not be counting it, only diluting the average it is not part of.
     */
    const currentMonthCardio = cardioSessions.filter((session) => inMonth(session.performedAt));

    const volumeKg = currentMonthSessions.reduce((sum, session) => sum + getSessionVolumeKg(session), 0);
    const totalDuration = getCombinedActivityMinutes(
      currentMonthSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
      currentMonthCardio,
    );
    const counted = currentMonthSessions.length + currentMonthCardio.length;
    const averageDuration = counted ? Math.round(totalDuration / counted) : 0;

    return {
      sessions: counted,
      volumeKg,
      averageDuration,
    };
  }, [activityCalendar.weeks, cardioSessions, workoutSessions]);

  /**
   * The trend tab's bodyweight grid, on the same calendar-days axis as the
   * weight card. The user put the two side by side and asked why the same
   * weight looks different on different tabs (2026-08-25) — there was no
   * answer, so now it cannot.
   */
  const overviewWeightWindow = useMemo(() => {
    const nowMs = Date.now();
    // This card's chips are its own (7D · 1M · 3M · 6M · All), so the ceilings
    // live here — but the rule that turns a ceiling into a width is the shared
    // one. It used to be inlined, and the copy was a `Math.min(730, ...)` that
    // only ever ran for "All": every other chip took its number raw, which is
    // why THIS card was the one photographed drawing an axis into November.
    const ceilingByRange: Record<string, number> = { '7d': 7, '1m': 31, '3m': 91, '6m': 183 };
    const first = earliestEntryMs(bodyweightProgress.entries.map((entry) => entry.recordedAt));
    const days = capRangeDays(ceilingByRange[resolvedOverviewRange] ?? 730, first, nowMs);
    // The window follows the data, as the weight card's does: the range chip
    // caps the width and the history sets it, so a short history is a short
    // axis rather than eleven empty weeks before the first entry (user
    // 2026-09-03) or ten empty weeks after today (user 2026-09-07).
    return buildValueWindow(
      bodyweightProgress.entries.map((entry) => ({ recordedAt: entry.recordedAt, value: entry.weight })),
      nowMs,
      days,
      language,
    );
  }, [bodyweightProgress.entries, resolvedOverviewRange, language]);

  const overviewChart = useMemo(() => {
    const start = getOverviewRangeStart(resolvedOverviewRange);
    // Seen with the clock 100 days ahead of one logged session: the 3-month
    // window held nothing, and the chart said "no volume data yet" over a log
    // that had some. "Yet" is the empty account's word. When the range is the
    // only thing empty, the chart says that instead — which is also the one
    // honest place to hint at what the longer ranges are for.
    const isBefore = (iso: string) => Boolean(start) && new Date(iso) < (start as Date);

    if (overviewMetric === 'bodyweight') {
      const entries = [...bodyweightProgress.entries]
        .filter((entry) => !start || new Date(entry.recordedAt) >= start)
        .reverse();
      const olderEntriesExist = !entries.length && bodyweightProgress.entries.some((entry) => isBefore(entry.recordedAt));

      const points = bucketOverviewPointsByRange(
        entries.map((entry) => ({
          label: entry.recordedAt,
          value: convertWeightFromKg(entry.weight, unitPreference),
        })),
        resolvedOverviewRange,
        'latest',
      );

      return {
        valueLabel: points.length ? formatWeight(bodyweightStats.currentKg, unitPreference) : t(language, 'progress.noEntries'),
        unitLabel: unitPreference,
        points,
        footerLabels: getOverviewFooterLabels(points, resolvedOverviewRange, language),
        yTickValues: getOverviewBodyweightTicks(points.map((point) => point.value), unitPreference),
        formatValueLabel: (value: number, unitLabel: string) => formatOverviewBodyweightTick(value, unitLabel),
        tooltipFormatter: (point: { label: string; value: number }) => ({
          title: formatDate(point.label, language),
          value: `${formatTime(point.label)} · ${formatWeight(
            unitPreference === 'lb' ? convertWeightToKg(point.value, 'lb') : point.value,
            unitPreference,
          )}`,
        }),
        emptyLabel: t(language, olderEntriesExist ? 'progress.noEntriesRange' : 'progress.noBodyweight'),
      };
    }

    const grouped = new Map<string, { performedAt: string; duration: number; volume: number }>();
    for (const session of workoutSessions) {
      const performedAt = new Date(session.performedAt);
      if (start && performedAt < start) {
        continue;
      }

      const key = localDateKey(performedAt);
      const bucket = grouped.get(key) ?? {
        performedAt: session.performedAt,
        duration: 0,
        volume: 0,
      };

      bucket.duration += getSessionDurationMinutes(session);
      bucket.volume += getSessionVolumeKg(session);
      grouped.set(key, bucket);
    }

    const rows = [...grouped.values()].sort(
      (left, right) => new Date(left.performedAt).getTime() - new Date(right.performedAt).getTime(),
    );
    const olderSessionsExist = !rows.length && workoutSessions.some((session) => isBefore(session.performedAt));

    if (overviewMetric === 'duration') {
      // Cardio time counts here: the activity calendar below marks run days,
      // and a chart that left them out drew a month of running as no time.
      const durationDays = addCardioMinutesByDay(
        rows.map((row) => ({ performedAt: row.performedAt, minutes: row.duration })),
        cardioSessions,
        start ? start.getTime() : null,
      );
      const olderDurationExists =
        !durationDays.length &&
        (olderSessionsExist || cardioSessions.some((session) => isBefore(session.performedAt)));
      const points = bucketOverviewPointsByRange(
        durationDays.map((day) => ({
          label: day.performedAt,
          value: day.minutes,
        })),
        resolvedOverviewRange,
        'sum',
      );
      const totalDuration = points.reduce((sum, point) => sum + point.value, 0);
      return {
        valueLabel: formatDurationMinutes(totalDuration),
        unitLabel: 'min',
        points,
        footerLabels: getOverviewFooterLabels(points, resolvedOverviewRange, language),
        yTickValues: getOverviewDurationTicks(Math.max(...points.map((point) => point.value), 0)),
        formatValueLabel: (value: number) => formatDurationTick(value),
        tooltipFormatter: (point: { label: string; value: number }) => ({
          title: formatDate(point.label, language),
          value: formatDurationMinutes(point.value),
        }),
        emptyLabel: t(language, olderDurationExists ? 'progress.noSessionsRange' : 'progress.noDurations'),
      };
    }

    // Days that lifted nothing are not zero-volume days, they are days with no
    // volume reading — a bodyweight-only session, or one abandoned before a set
    // landed. Plotted as 0 they pin the line to the axis and make the first
    // real reading look like a jump out of nowhere (user, 2026-09-02, on a
    // chart whose first point was 0 t).
    //
    // The same rule progression.ts already states for a lift that is never
    // loaded: reading its weight gives 0 every time, so do not read it.
    const points = bucketOverviewPointsByRange(
      rows
        .filter((row) => row.volume > 0)
        .map((row) => ({
          label: row.performedAt,
          value: convertWeightFromKg(row.volume, unitPreference),
        })),
      resolvedOverviewRange,
      'sum',
    );
    const volumeTicks = getOverviewVolumeTicks(Math.max(...points.map((point) => point.value), 0));
    return {
      valueLabel: formatCompactVolume(rows.reduce((sum, row) => sum + row.volume, 0), unitPreference),
      unitLabel: unitPreference,
      points,
      footerLabels: getOverviewFooterLabels(points, resolvedOverviewRange, language),
      yTickValues: volumeTicks,
      // One unit for the whole axis: formatCompactVolume alone would mix
      // "500 kg" and "1 t" on the same scale. The top tick decides.
      formatValueLabel: (value: number) => formatOverviewVolumeTick(value, volumeTicks),
      tooltipFormatter: (point: { label: string; value: number }) => ({
        title: formatDate(point.label, language),
        value: formatVolume(
          unitPreference === 'lb' ? convertWeightToKg(point.value, 'lb') : point.value,
          unitPreference,
        ),
      }),
      emptyLabel: t(language, olderSessionsExist ? 'progress.noSessionsRange' : 'progress.noVolume'),
    };
  }, [bodyweightProgress.entries, bodyweightStats.currentKg, cardioSessions, overviewMetric, resolvedOverviewRange, unitPreference, workoutSessions]);

  const activityCalendarDays = useMemo(() => activityCalendar.weeks.flat(), [activityCalendar.weeks]);
  // Start of today, so a planned day that has already gone by can be told
  // apart from one still ahead. Recomputed per render is fine — the calendar
  // only re-renders on data changes, and a stale midnight would mislabel a day.
  const todayStartTimestamp = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, [activityCalendar.weeks]);

  // ── tracked data ──

  /**
   * One row per lift a target can be set on, with its history if it has any.
   *
   * The section used to list every lift with a log in it. It is the targets
   * now — "tracked sama kuin tavoite" (user, 2026-09-01) — so the list is
   * fixed at ten, and a lift with no target still gets a row, because the
   * question the section answers is "what could you aim at".
   *
   * Joined on the summary key, which for these summaries is the target lift's
   * own trimmed lowercase name — each one already holds the lift under every
   * name it was logged as (getLiftProgress). A lift that HAS a target has a
   * summary even with nothing logged: the target seeds one.
   */
  const trackedRows = useMemo(() => {
    const byKey = new Map(summaries.map((summary) => [summary.key, summary]));
    return targetLifts.map((lift) => ({
      lift,
      summary: byKey.get(lift.exerciseName.trim().toLowerCase()) ?? null,
    }));
  }, [summaries, targetLifts]);

  /**
   * What the Tracked rows read on every render: the numbers for the sparkline
   * and the start/latest/delta line, oldest first. No dates, so no formatter —
   * the labelled points below are built for the one open row only.
   */
  const trackedValues = useMemo(
    () => getTrackedSummaryValues(trackedRows.map(({ summary }) => summary), unitPreference),
    [trackedRows, unitPreference],
  );

  /**
   * The open row's chart points, labels included. Memoised so the array keeps
   * its identity between renders: SimpleLineChart clears its open tooltip when
   * `points` changes, and a freshly built array did that on every unrelated
   * parent render.
   */
  const expandedTrackedPoints = useMemo(() => {
    const open = expandedKey
      ? trackedRows.find(({ summary }) => summary?.key === expandedKey)?.summary ?? null
      : null;
    return open ? getSummaryChartPoints(open, unitPreference, language) : null;
  }, [expandedKey, trackedRows, unitPreference, language]);

  /**
   * Deep links: a Home lift card and the coach's "review this trend" open
   * progress/detail with a lift key.
   *
   * Both carry the key of any tracked lift, and the Tracked section has held
   * only the target lifts since 2026-09-01 — so a link to a lift without a
   * target switched the tab and expanded nothing (backfill review of #40,
   * 2026-09-16). A target row still opens in place; any other lift opens its
   * own set log, the one Records opens for it, which is the lift the card
   * showed. Keyed on the link alone: data arriving later must not reopen a
   * sheet the reader closed.
   */
  useEffect(() => {
    if (!selectedExerciseKey) {
      return;
    }
    const row = trackedRows.find(({ summary }) => summary?.key === selectedExerciseKey);
    if (row) {
      setProgressSection('tracked');
      setExpandedKey(selectedExerciseKey);
      return;
    }
    if (setLogSources.some((entry) => entry.key === selectedExerciseKey)) {
      setProgressSection('records');
      setSetLogTarget({ key: selectedExerciseKey, fromLift: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExerciseKey]);


  // ── measures data ──

  const measureModels = useMemo(() => {
    return MEASURE_CONFIG.map((config) => {
      if (config.kind === null) {
        const entries = bodyweightProgress.entries;
        const values = [...entries].reverse().map((entry) => convertWeightFromKg(entry.weight, unitPreference));
        const dates = [...entries].reverse().map((entry) => entry.recordedAt);
        // Ids ride along with the values: a chart only needs numbers, but a
        // list you can delete from needs to know which entry each row is.
        const entryIds = [...entries].reverse().map((entry) => entry.id);
        return {
          ...config,
          unit: unitPreference as string,
          values,
          dates,
          entryIds,
        };
      }

      const kindEntries = measurementEntries
        .filter((entry) => entry.kind === config.kind)
        .sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
      const unit: MeasurementUnit =
        config.key === 'bodyfat' ? '%' : kindEntries[kindEntries.length - 1]?.unit === 'in' ? 'in' : 'cm';
      return {
        ...config,
        unit: unit as string,
        values: kindEntries.map((entry) => convertMeasurementValue(entry.value, entry.unit, unit)),
        dates: kindEntries.map((entry) => entry.recordedAt),
        entryIds: kindEntries.map((entry) => entry.id),
      };
    });
  }, [bodyweightProgress.entries, measurementEntries, unitPreference]);

  // A stat card names its measurement; arriving from one selects it, so the
  // input the reader came to use is the one on screen. Only keys this screen
  // knows are honoured — an unknown one leaves the selection alone.
  useEffect(() => {
    if (initialMeasure && measureModels.some((model) => model.key === initialMeasure)) {
      setSelectedMeasure(initialMeasure as MeasureKey);
    }
    // measureModels is stable per language; the key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMeasure, routeOpenedAt]);
  const selectedMeasureModel = measureModels.find((model) => model.key === selectedMeasure) ?? measureModels[0];

  // The unit-follows-the-measure effect went with the text field: the ruler
  // dials the measure's own unit and there is no draft to clear between them.

  /**
   * The same calendar-days axis the weight card draws (the photo the user
   * sent, 2026-08-25, is the reference): orange line, hollow dots, a day per
   * slot so a gap stays a gap. The range picker sets the window's length;
   * "all" reaches back to the first entry.
   */
  const selectedMeasureWindow = useMemo(() => {
    const entries = selectedMeasureModel.values.map((value, index) => ({
      recordedAt: selectedMeasureModel.dates[index],
      value,
    }));
    const nowMs = Date.now();
    const first = earliestEntryMs(entries.map((entry) => entry.recordedAt));
    const days = measureRangeDays(resolvedMeasureRange, first, nowMs);
    return buildValueWindow(entries, nowMs, days, language);
  }, [resolvedMeasureRange, selectedMeasureModel, language]);

  const selectedMeasureLatest = selectedMeasureModel.values.length
    ? selectedMeasureModel.values[selectedMeasureModel.values.length - 1]
    : null;
  // Read off the window the chart beside it draws, so the pill and the line
  // cannot disagree. A range start of its own sent '7d' back twelve months and
  // the pill showed a change since last winter (hunt 10, 2026-10-09).
  const selectedMeasureDelta = windowValueDelta(selectedMeasureWindow);

  async function handleSaveMeasure(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }

    if (selectedMeasureModel.kind === null) {
      onAddBodyweight(convertWeightToKg(value, unitPreference));
    } else {
      // The unit the kind is measured in, not "always centimetres". A body-fat
      // reading is a percentage, and storing it as `cm` made the same measure
      // carry two different units depending on which screen it was entered
      // from — the coach was told "bodyfat, 20 cm" (audit 3, 2026-09-19). The
      // screen already prints `%` for it, which is what hid this from itself.
      await onAddMeasurement(
        selectedMeasureModel.kind,
        value,
        measurementUnitForKind(selectedMeasureModel.kind),
      );
    }
  }

  // ── sections ──

  function renderWeeklyRead() {
    if (weeklyRead.length === 0) {
      return null;
    }
    return (
      <View style={styles.readBlock}>
        <Text style={styles.readTitle}>{t(language, 'pro.read.title')}</Text>
        <View style={styles.readList}>
          {weeklyRead.map((row) => {
            // The dot keeps the paywall palette; the status WORD is text, and
            // reads in the theme's inks. PW green and amber are 3.30 and 3.19:1
            // as text on a light card, PW red 3.64 on a dark one (2026-09-26).
            const tone =
              row.tone === 'green'
                ? { dot: PW.green, soft: PW.greenSoft, ink: theme.greenInk }
                : row.tone === 'amber'
                  ? { dot: PW.amber, soft: PW.amberSoft, ink: theme.amberInk }
                  : { dot: PW.red, soft: PW.redSoft, ink: theme.danger };
            // The row is a door when there is something behind it. The lift's
            // set log opens from the screen's root, so this does not change
            // section — the reader stays on the read and the lift comes to
            // them. Before, tapping a lift here did nothing at all and the
            // only way in was the records tab, then the list, then the lift
            // (user 2026-09-07).
            // The recovery row opens its own sheet (2026-09-26): why the load
            // reads the way it does, and what to do about it.
            const recoveryDoor = row.key === 'recovery' && Boolean(recoverySheet);
            const openable = recoveryDoor || setLogSources.some((entry) => entry.key === row.key);
            return (
              <View key={row.key} style={styles.readRow}>
                <Pressable
                  accessibilityRole={openable ? 'button' : undefined}
                  accessibilityLabel={
                    recoveryDoor
                      ? t(language, 'recovery.a11y.row', { status: row.status })
                      : openable
                        ? row.name
                        : undefined
                  }
                  disabled={!openable}
                  onPress={() =>
                    recoveryDoor ? setRecoveryOpen(true) : setSetLogTarget({ key: row.key, fromLift: false })
                  }
                  style={({ pressed }) => [styles.readRowHead, pressed && openable && styles.readRowPressed]}
                >
                  <View style={[styles.readDotRing, { backgroundColor: tone.soft }]}>
                    <View style={[styles.readDot, { backgroundColor: tone.dot }]} />
                  </View>
                  <View style={styles.readCopy}>
                    {/* The status on its own line: sharing one line with the
                        name, a long lift cut it to "Jumi…" and "Vähis…"
                        (#bugs 2026-10-01). The plateau's "Sama huippusarja × 3"
                        goes for Pro, whose fix under the row says it better;
                        free, that line IS the finding — the fix is blurred. */}
                    <Text style={styles.readName} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={[styles.readStatus, { color: tone.ink }]}>{row.status}</Text>
                    {proUnlocked && row.tone === 'amber' && row.key !== 'recovery' ? null : (
                      <Text style={styles.readMeta}>{row.meta}</Text>
                    )}
                  </View>
                  <View style={styles.readBars}>
                    {row.bars.map((bar, index) => (
                      <View
                        key={index}
                        style={[
                          styles.readBar,
                          {
                            height: `${Math.round(bar * 100)}%`,
                            backgroundColor: index === row.bars.length - 1 ? tone.dot : tone.soft,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  {recoveryDoor ? (
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M9 6l6 6-6 6"
                        stroke={theme.faint}
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  ) : null}
                </Pressable>
                {/* The recovery row's answer lives in its sheet now, lock and
                    all; the row itself stays one line like the lifts. */}
                {row.locked && !recoveryDoor ? (
                  <View style={styles.readLock}>
                    {proUnlocked ? (
                      <View style={styles.readFix}>
                        <Text style={styles.readFixLine}>{row.locked.body}</Text>
                      </View>
                    ) : (
                      <ProLockedCard
                        language={language}
                        compact
                        teaser={t(language, 'pro.read.lockedTeaser')}
                        body={row.locked.body}
                        cta={t(language, 'pro.read.lockedCta')}
                        onPress={() => {
                          if (readMoment) {
                            setReadSheetVisible(true);
                          } else {
                            onOpenPremium?.();
                          }
                        }}
                      />
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  function renderOverview() {
    const maxWeekSessions = Math.max(4, ...rhythm.sessionsPerWeek);

    return (
      <>
        {renderWeeklyRead()}
        {/* The trend chart, and now the first thing on the tab.
            overviewChart, OVERVIEW_METRICS and OVERVIEW_RANGES were all built
            and none of them rendered: the chart was computed into a const
            nobody read, and the metric/range state had setters nobody called.

            Above it sat a "Working weight · <lift>" card showing one lift's
            last load — which for a bodyweight lift is 0, every time, as
            progression.ts says in a comment on latestValue. It was
            photographed on the device reading "0 kg × 15" over a flat line
            from 0 to 0. Gone: the headline number belongs to the chart, and
            the chart is what the tab is for (Progress v2, piece 01). */}
        <SectionLabel label={t(language, 'progress.section.trend')} />
        <View style={styles.card}>
          <View style={styles.trendMetricRow}>
            <Seg
              options={OVERVIEW_METRICS.map((option) => ({
                key: option.key,
                label: t(language, option.labelKey),
              }))}
              value={overviewMetric}
              onChange={setOverviewMetric}
            />
          </View>
          {/* valueLabel already carries its own unit ("2,2 t", "13 h 21 min"),
              so printing unitLabel beside it reads as "13 h 21 min min". */}
          <View style={styles.trendValueRow}>
            <Text style={styles.trendValue}>{overviewChart.valueLabel}</Text>
          </View>
          {overviewMetric === 'bodyweight' ? (
            overviewWeightWindow.some((day) => day.value !== null) ? (
              <WeightTrendChart days={overviewWeightWindow} />
            ) : (
              <EmptyBox label={overviewChart.emptyLabel} />
            )
          ) : (
            <SimpleLineChart
              points={overviewChart.points}
              unitLabel={overviewChart.unitLabel}
              accent={theme.purple}
              emptyLabel={overviewChart.emptyLabel}
              footerLabels={overviewChart.footerLabels}
              yTickValues={overviewChart.yTickValues}
              formatValueLabel={overviewChart.formatValueLabel}
              tooltipFormatter={overviewChart.tooltipFormatter}
            />
          )}
          <View style={styles.trendRangeRow}>
            <Seg
              options={OVERVIEW_RANGES.map((option) => ({
                key: option.key,
                label: option.label ?? t(language, option.labelKey ?? 'progress.range.all'),
              }))}
              value={resolvedOverviewRange}
              onChange={setOverviewRange}
              lockedKeys={lockedTrendRanges}
              onLockedPress={onOpenPremium}
            />
          </View>
        </View>

        <SectionLabel label={t(language, 'progress.section.thisMonth')} />
        <View style={styles.monthGrid}>
          <View style={styles.monthCard}>
            <Text style={styles.monthLabel}>{t(language, 'progress.stat.sessions')}</Text>
            <Text style={styles.monthValue}>{monthStats.sessions}</Text>
            <Text style={styles.monthMeta}>{t(language, 'progress.meta.thisMonth')}</Text>
          </View>
          <View style={styles.monthCard}>
            <Text style={styles.monthLabel}>{t(language, 'progress.stat.volume')}</Text>
            <Text style={styles.monthValue}>{formatCompactVolume(monthStats.volumeKg, unitPreference)}</Text>
            <Text style={styles.monthMeta}>{t(language, 'progress.meta.lifted')}</Text>
          </View>
          <View style={styles.monthCard}>
            <Text style={styles.monthLabel}>{t(language, 'progress.stat.avgTime')}</Text>
            <Text style={styles.monthValue}>{monthStats.averageDuration} min</Text>
            <Text style={styles.monthMeta}>{t(language, 'progress.meta.perSession')}</Text>
          </View>
        </View>

        {topRecords.length > 0 ? (
          <>
            <SectionLabel
              label={t(language, 'pr.records')}
              right={
                <Pressable
                  onPress={() => switchSection('records')}
                  hitSlop={8}
                  style={styles.recordsLinkRow}
                >
                  <Text style={styles.recordsLink}>
                    {t(language, 'pr.allRecords', { count: recordCount })}
                  </Text>
                  <ChevronRight color={theme.purple} />
                </Pressable>
              }
            />
            <View style={styles.recordsList}>
              {topRecords.map((record) => {
                const locked = isRecordLocked(record.performedAt, proUnlocked);
                return (
                  <RecordRow
                    key={`${record.key}-${record.kind}`}
                    record={record}
                    language={language}
                    locked={locked}
                    // Opens the same set log the records tab does — the row
                    // was a dead end here (#bugs 2026-10-01).
                    onPress={locked ? onOpenPremium : () => setSetLogTarget({ key: record.key, fromLift: false })}
                  />
                );
              })}
            </View>
          </>
        ) : null}

        <View
          onLayout={(event) => {
            // Direct child of the scroll content, so this y is the scroll
            // offset the widget tap needs.
            activityBlockY.current = event.nativeEvent.layout.y;
            if (pendingActivityScroll.current) {
              scrollToActivityBlock();
            }
          }}
        >
          <SectionLabel
            label={t(language, 'progress.section.activity')}
            right={calendarMonthLabel}
          />
        </View>
        <View style={styles.card}>
          {/* The streak the calendar is really about, above the grid it is
              counted from. The current week never breaks it — see
              weeklyTrainingStreak. */}
          <View style={styles.streakRow}>
            <View style={styles.streakValueLine}>
              <Text style={styles.streakValue}>{trainingStreak}</Text>
              {/* Finnish takes the nominative after one and the partitive
                  after anything else: "1 viikko", "2 viikkoa". */}
              <Text style={styles.streakLabel}>
                {t(language, trainingStreak === 1 ? 'cal.streakOne' : 'cal.streak')}
              </Text>
            </View>
            <Text style={styles.streakCount}>
              {monthStats.sessions === 1
                ? t(language, 'cal.monthSessionsOne')
                : t(language, 'cal.monthSessions', { count: monthStats.sessions })}
            </Text>
          </View>
          <View style={styles.calendarWeekdayRow}>
            {PROGRESS_WEEKDAY_KEYS.map((weekdayKey, index) => (
              <Text key={`${weekdayKey}:${index}`} style={styles.calendarWeekday}>
                {t(language, weekdayKey)}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {activityCalendarDays.map((day) => {
              const status = getProgressActivityDayStatus(day, {
                schedule: trainingSchedule,
                todayStart: todayStartTimestamp,
              });
              if (status === 'outside') {
                return <View key={day.dayStart} style={styles.calendarCell} />;
              }

              // One mark, one meaning (user 2026-08-25): a training day —
              // trained, ahead, or behind — is the solid mark, and everything
              // else is quiet. No trained/planned split and no legend to
              // explain it: one colour means training day, full stop.
              //
              // That colour is VIOLET now, not the accent. The brief opens on
              // it: "The calendar was a wall of orange. Logged days are violet
              // — they are a record of what happened, not something to press."
              // Twenty-five orange squares out of thirty read as a screen full
              // of buttons, and not one of them does anything when tapped. The
              // one-mark rule survives; only the ink changed.
              const training = status !== 'rest';
              return (
                <View key={day.dayStart} style={styles.calendarCell}>
                  <View
                    style={[
                      styles.calendarBubble,
                      training && styles.calendarBubbleTraining,
                      !training && day.isToday && styles.calendarBubbleToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calendarBubbleText,
                        training && styles.calendarBubbleTextTraining,
                        !training && day.isToday && styles.calendarBubbleTextToday,
                      ]}
                    >
                      {day.dayNumber}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

        </View>

        <View style={styles.progressHistoryCard}>
          <View style={styles.historyHeadRow}>
            <Text style={styles.referenceCardTitle}>{t(language, 'progress.history')}</Text>
            {onOpenSessionHistory ? (
              <Pressable onPress={onOpenSessionHistory} hitSlop={8}>
                <Text style={styles.historySeeAll}>{t(language, 'progress.seeAll')}</Text>
              </Pressable>
            ) : null}
          </View>
          {recentSessions.length > 0 ? (
            <View style={styles.historyList}>
              {recentSessions.slice(0, 3).map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => onOpenRecentSession?.(session.id)}
                  disabled={!onOpenRecentSession}
                  style={styles.historyRow}
                >
                  <View style={styles.historyIcon}>
                    <VinhaIcon name="dumbbell" color={theme.purpleDark} size={17} />
                  </View>
                  <View style={styles.historyCopy}>
                    <Text numberOfLines={1} style={styles.historyTitle}>
                      {session.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.historyMeta}>
                      {session.dateLabel} · {session.durationLabel} · {session.volumeLabel}
                    </Text>
                  </View>
                  <VinhaIcon name="chevronRight" color={theme.faint} size={16} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.historyEmpty}>
              <Text style={styles.emptyTitle}>{t(language, 'progress.noSessions.title')}</Text>
              <Text style={styles.emptyText}>{t(language, 'progress.noSessions.body')}</Text>
            </View>
          )}
        </View>
      </>
    );
  }

  function renderRecords() {
    return (
      <RecordsList
        records={records}
        language={language}
        proUnlocked={proUnlocked}
        onOpenPro={() => onOpenPremium?.()}
        onStartWorkout={() => onStartWorkout?.()}
        onOpenExercise={(key) => setSetLogTarget({ key, fromLift: false })}
      />
    );
  }

  function renderTracked() {
    return (
      <>
        {trackedRows.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>{t(language, 'progress.noTracked.title')}</Text>
          </View>
        ) : (
          <View style={styles.trackedList}>
            {trackedRows.map(({ lift, summary }) => {
              if (!summary) {
                // Nothing aimed at and nothing logged. The row stays, because
                // a lift you cannot see is one you cannot pick.
                return (
                  <Pressable
                    key={lift.exerciseName}
                    accessibilityRole="button"
                    onPress={() => onSetTarget?.(lift.exerciseName)}
                    style={({ pressed }) => [styles.trackedCard, pressed && { opacity: 0.85 }]}
                  >
                    <View style={styles.trackedHead}>
                      <View style={styles.trackedCopy}>
                        <Text numberOfLines={1} style={styles.trackedName}>
                          {formatLiftDisplayLabel(exerciseNameLabel(language, lift.exerciseName))}
                        </Text>
                        <Text numberOfLines={1} style={styles.trackedMeta}>
                          {t(language, 'progress.noTargetYet')}
                        </Text>
                      </View>
                      <Text style={styles.trackedSetTarget}>{t(language, 'programs.goals.add')}</Text>
                    </View>
                  </Pressable>
                );
              }
              const isOpen = expandedKey === summary.key;
              const signalDot = SIGNAL_STYLES[getExerciseProgressSignal(summary).kind].dot;
              const values = trackedValues.get(summary.key) ?? [];
              const points = isOpen ? expandedTrackedPoints ?? [] : [];
              const start = values[0] ?? null;
              const latest = values.length ? values[values.length - 1] : null;
              const delta = start !== null && latest !== null && values.length > 1 ? latest - start : null;
              return (
                <View key={summary.key} style={styles.trackedCard}>
                  {/* The row opens the set log; the chevron still expands the
                      chart in place, so the curve stays one tap away without
                      going through the sheet. */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSetLogTarget({ key: summary.key, fromLift: true })}
                    style={styles.trackedHead}
                  >
                    <View style={styles.trackedCopy}>
                      <Text numberOfLines={1} style={styles.trackedName}>
                        {formatLiftDisplayLabel(exerciseNameLabel(language, summary.name))}
                      </Text>
                      <View style={styles.trackedMetaRow}>
                        <SignalBadge summary={summary} language={language} />
                        <Text numberOfLines={1} style={styles.trackedMeta}>
                          {formatWeight(summary.latestWeight, unitPreference)}
                          {summary.latestReps && summary.latestReps !== '-' ? ` × ${summary.latestReps.split(',')[0]}` : ''}
                          {summary.latestLog ? ` · ${formatShortDate(summary.latestLog.performedAt, language)}` : ''}
                        </Text>
                      </View>
                    </View>
                    <Sparkline values={values} color={signalDot} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isOpen }}
                      onPress={() => setExpandedKey(isOpen ? null : summary.key)}
                      hitSlop={10}
                    >
                      <ChevronDown open={isOpen} />
                    </Pressable>
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.trackedDetail}>
                      {delta !== null ? (
                        <Text style={styles.trackedDelta}>
                          {delta >= 0 ? '+' : ''}
                          {fmtDelta(delta)} {unitPreference} · {removeTrailingZeros(start ?? 0)} →{' '}
                          {removeTrailingZeros(latest ?? 0)} {unitPreference}
                        </Text>
                      ) : (
                        <Text style={styles.trackedDeltaMuted}>{t(language, 'progress.trendStarts')}</Text>
                      )}
                      <SimpleLineChart
                        points={points}
                        unitLabel={unitPreference}
                        accent={signalDot}
                        emptyLabel={t(language, 'progress.noEntries')}
                        tooltipFormatter={(point) => ({
                          title: point.label,
                          value: formatWeight(
                            unitPreference === 'lb' ? convertWeightToKg(point.value, 'lb') : point.value,
                            unitPreference,
                          ),
                        })}
                      />
                      {/* The three most recent sessions used to be listed here
                          with their sets. That is the set log, and it now
                          lives on the sheet behind the Pro gate — leaving a
                          free copy of it three rows deep would make the lock
                          decorative. */}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSetLogTarget({ key: summary.key, fromLift: true })}
                        style={({ pressed }) => [styles.trackedLogLink, pressed && { opacity: 0.85 }]}
                      >
                        <Text style={styles.trackedLogLinkText}>{t(language, 'setlog.open')}</Text>
                        <ChevronRight color={theme.purple} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </>
    );
  }

  function renderMeasures() {
    const model = selectedMeasureModel;

    // Body weight gets the dedicated card pair (current + extremes + BMI
    // gauge) instead of the generic measure detail. Every other measure keeps
    // the numeric field: they have no BMI, no record-high/low worth naming,
    // and a ruler for "waist, in cm" would be a dial with nothing to dial to.
    if (model.kind === null) {
      return (
        <>
          <View style={styles.measureDetailBlock}>
            <WeightBmiCards
              language={language}
              currentKg={bodyweightStats.currentKg}
              heaviestKg={bodyweightStats.heaviestKg}
              lightestKg={bodyweightStats.lightestKg}
              heightCm={heightCm}
              chartDays={weightWindowDays}
              hasLoggedWeight={bodyweightStats.currentKg !== null}
              onLogWeight={() => setWeightSheetVisible(true)}
              onEditBmi={() => setBmiSheetVisible(true)}
              /* The same chips every other chart on this tab has (Progress v2,
                 piece 06), and now the same trailing shape behind all of them.
                 Handed to the card so they land under ITS chart: rendered
                 after the component they went under BMI, two cards down,
                 which is where the device showed them. */
              rangeSlot={
                <View style={styles.trendRangeRow}>
                  <Seg
                    options={MEASURE_RANGES.map((option) => ({
                      key: option.key,
                      label: option.label ?? t(language, option.labelKey ?? 'progress.range.all'),
                    }))}
                    value={resolvedMeasureRange}
                    onChange={setMeasureRange}
                    lockedKeys={lockedMeasureRanges}
                    onLockedPress={onOpenPremium}
                  />
                </View>
              }
            />

          </View>
          {renderMeasureEntries()}
          {renderMeasureList()}
        </>
      );
    }

    return (
      <>
        <View style={styles.measureDetailBlock}>
          <View style={styles.card}>
            <View style={styles.measureDetailHead}>
              <Text style={styles.measureDetailLabel}>{t(language, model.labelKey)}</Text>
              <View style={styles.measureHeadActions}>
                {selectedMeasureDelta !== null && selectedMeasureDelta !== 0 ? (
                  <DeltaPill delta={selectedMeasureDelta} unit={model.unit} lowerIsBetter={model.lowerIsBetter} />
                ) : null}
                {/* The same pill the weight card carries, opening the same
                    kind of ruler — user 2026-08-25 asked for one way to log a
                    number, not two. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'weightCard.log')}
                  onPress={() => setMeasureSheetVisible(true)}
                  style={({ pressed }) => [styles.measureLogPill, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.measureLogPillText}>{t(language, 'weightCard.log')}</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.measureValueRow}>
              <Text style={styles.measureValue}>
                {selectedMeasureLatest !== null ? removeTrailingZeros(Number(selectedMeasureLatest.toFixed(1))) : '—'}
              </Text>
              <Text style={styles.measureUnit}>{model.unit}</Text>
            </View>
            {/* Only when there IS a baseline. With nothing logged this said
                "No entries yet — add your first below", the dashed box below
                said it again, and the row in the list said it a third time.
                The brief counts: "an untracked measure says it once". The box
                is the one that keeps it, because it is where the line will
                appear. */}
            {model.values.length ? (
              <Text style={styles.measureCaption}>{t(language, 'progress.ownBaseline')}</Text>
            ) : null}

            {/* Inside the card with the number it draws: the chart floated
                below the box while the weight card kept its chart inside,
                and the two layouts read as each other's mirror image
                (user 2026-08-25, "päinvastoin on mennyt"). */}
            {selectedMeasureWindow.some((day) => day.value !== null) ? (
              <WeightTrendChart days={selectedMeasureWindow} />
            ) : (
              /* Two different absences, and they are not the same sentence.
                 Nothing ever logged is "no entries yet"; entries that all fall
                 outside the chosen window is "none in this range" — and that
                 one is a hint to widen the range rather than a hole. */
              <EmptyBox
                label={t(language, model.values.length ? 'progress.noEntriesRange' : 'progress.noEntriesYet')}
              />
            )}
            <View style={styles.trendRangeRow}>
              <Seg
                options={MEASURE_RANGES.map((option) => ({
                  key: option.key,
                  label: option.label ?? t(language, option.labelKey ?? 'progress.range.all'),
                }))}
                value={resolvedMeasureRange}
                onChange={setMeasureRange}
                lockedKeys={lockedMeasureRanges}
                onLockedPress={onOpenPremium}
              />
            </View>
          </View>
        </View>

        {renderMeasureEntries()}
        {renderMeasureList()}
      </>
    );
  }

  /** Shared by both measure layouts — the picker has to stay reachable. */
  /**
   * The selected measure's own readings, newest first, each removable.
   *
   * The list under this one shows a row per MEASURE — latest value and a
   * sparkline — which is the right summary and the wrong place to fix a typo:
   * an individual reading had no row anywhere in the app, so it could not be
   * taken back (#bugs 2026-08-26). Only the selected measure's entries, so
   * this stays a short list rather than a second history screen.
   */
  function renderMeasureEntries() {
    const model = selectedMeasureModel;
    const remove = model.kind === null ? onDeleteBodyweight : onDeleteMeasurement;
    if (!remove || model.entryIds.length === 0) {
      return null;
    }
    // Newest first: the one you just mistyped is the one you came to remove.
    const rows = model.entryIds
      .map((id, index) => ({ id, value: model.values[index], recordedAt: model.dates[index] }))
      .reverse();

    return (
      <>
        {/* The label's own right slot, not a header built beside it. The
            first version wrapped SectionLabel in a flex row with its own
            Pressable — a third way to draw a section head in a file that
            already had two. */}
        <SectionLabel
          label={t(language, 'progress.entries')}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: entriesEditing }}
              onPress={() => setEntriesEditing((value) => !value)}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.entriesEditLink}>
                {t(language, entriesEditing ? 'plan.done' : 'plan.edit')}
              </Text>
            </Pressable>
          }
        />
        <View style={styles.card}>
          {rows.map((row, index) => (
            <View key={row.id} style={[styles.entryRow, index > 0 && styles.entryRowDivided]}>
              {/* The whole stamp, not "Sep 1". Two weigh-ins on one day are
                  the ones you came to delete, and "Sep 1 / Sep 1" cannot tell
                  them apart — the row has the width for it (user
                  2026-09-02). */}
              <Text style={styles.entryDate}>{formatSessionDate(row.recordedAt, language)}</Text>
              <Text style={styles.entryValue}>
                {removeTrailingZeros(Number(row.value.toFixed(1)))} {model.unit}
              </Text>
              {entriesEditing ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'progress.entries.delete')}
                  hitSlop={10}
                  onPress={() => setPendingEntryDelete(row.id)}
                  style={({ pressed }) => [styles.entryDelete, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.entryDeleteGlyph}>×</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <ConfirmDialog
          visible={pendingEntryDelete !== null}
          language={language}
          destructive
          title={t(language, 'progress.entries.delete.title')}
          message={t(language, 'progress.entries.delete.body')}
          confirmLabel={t(language, 'progress.entries.delete')}
          onCancel={() => setPendingEntryDelete(null)}
          onConfirm={() => {
            const target = pendingEntryDelete;
            setPendingEntryDelete(null);
            if (target) {
              remove(target);
            }
          }}
        />
      </>
    );
  }

  function renderMeasureList() {
    /**
     * What you actually track — not all ten.
     *
     * Ten rows, seven of them empty, was a wall you scrolled past: the brief
     * calls it out and the earlier fix only re-sorted it so the empties came
     * last. A measure is yours once you have logged it, and the one you are
     * looking at right now is yours too — otherwise opening a fresh measure
     * from the sheet would leave its card above a list that does not mention
     * it.
     *
     * The rest are one row at the bottom, not seven.
     */
    const tracked = measureModels.filter(
      (item) => item.values.length > 0 || item.key === selectedMeasure,
    );
    const untracked = measureModels.filter((item) => !tracked.includes(item));

    return (
      <>
        <SectionLabel label={t(language, 'progress.section.youTrack')} />
        <View style={styles.measureList}>
          {/* Measures with entries first, outlined (user 2026-08-23): the
              catalog order buried "Rinta · 93,5 cm" under three empty rows.
              The sort is stable, so within each half the catalog order holds. */}
          {[...tracked]
            .sort((left, right) => Number(right.values.length > 0) - Number(left.values.length > 0))
            .map((item) => {
            const active = item.key === selectedMeasure;
            const latest = item.values.length ? item.values[item.values.length - 1] : null;
            const delta = item.values.length >= 2 ? item.values[item.values.length - 1] - item.values[0] : null;
            const good = delta === null ? true : item.lowerIsBetter ? delta < 0 : delta > 0;
            return (
              <Pressable
                key={item.key}
                onPress={() => setSelectedMeasure(item.key)}
                style={[
                  styles.measureRow,
                  latest !== null && styles.measureRowLogged,
                  active && styles.measureRowActive,
                ]}
              >
                <View style={styles.measureRowIcon}>
                  <MeasureIcon name={item.icon} />
                </View>
                <View style={styles.measureRowCopy}>
                  <Text style={styles.measureRowTitle}>{t(language, item.labelKey)}</Text>
                  <Text style={styles.measureRowMeta}>
                    {latest !== null ? `${removeTrailingZeros(Number(latest.toFixed(1)))} ${item.unit}` : t(language, 'progress.noEntriesYet')}
                  </Text>
                </View>
                <Sparkline
                  values={item.values.slice(-8)}
                  color={delta === null ? theme.faint : good ? '#37C46B' : '#E0922F'}
                  width={58}
                />
                {delta !== null && delta !== 0 ? (
                  <DeltaPill delta={delta} unit={item.unit} lowerIsBetter={item.lowerIsBetter} />
                ) : null}
              </Pressable>
            );
          })}
          {/* One row for everything else. A measure you have never taken is
              not a row you want to read past every time you open the tab — it
              is a thing you might start, which is one line. */}
          {untracked.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setMeasurePickerVisible(true)}
              style={({ pressed }) => [styles.measureAddRow, pressed && { opacity: 0.8 }]}
            >
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 5v14M5 12h14"
                  stroke={theme.highlight}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </Svg>
              <Text style={styles.measureAddText}>{t(language, 'progress.addMeasure')}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* The kit's own sheet, the same one Home adds a stat card with. */}
        {/* No title: it repeated the row that opened it, and the list names
            itself. And a REAL bottom inset — this was hardcoded to 0, so the
            last measurement sat under the gesture bar and the sheet read as
            cut off ("nosta vähän ylemmäs", #bugs 2026-09-05). A Modal's own
            safe-area inset is 0; the screen has to read it and pass it down. */}
        <KitSheet
          visible={measurePickerVisible}
          onClose={() => setMeasurePickerVisible(false)}
          bottomInset={insets.bottom}
          closeLabel={t(language, 'common.close')}
        >
          {untracked.map((item) => (
            <KitRow
              key={item.key}
              title={t(language, item.labelKey)}
              meta={item.unit}
              onPress={() => {
                setSelectedMeasure(item.key);
                setMeasurePickerVisible(false);
              }}
            />
          ))}
        </KitSheet>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {/* No subtitle. It sat above all four sub-tabs and described none of
            them — "ylhäällä sama treeni jonka olet rakentanut" on the records
            page, the measures page and the trend (#bugs 2026-09-05). */}
        <Text style={styles.headerTitle}>{t(language, 'progress.title')}</Text>
        {/* The same control as every selector below it. This was a hand-built
            shell with a second cut surface inside the selected tab — the two
            parallel diagonals Seg took out of the others on 2026-09-07 — and on
            the phone the shell's outline showed under the row ("leikkaus on
            jotenkin outo", user 2026-09-09, asking for the metric bar's look).
            The per-theme inks it carried moved into Seg with it. */}
        <View style={styles.tabsRow}>
          <Seg
            grow
            options={PROGRESS_SECTIONS.map((section) => ({
              key: section.key,
              label: t(language, section.labelKey),
              icon: section.icon,
            }))}
            value={progressSection}
            onChange={switchSection}
          />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {progressSection === 'overview' ? renderOverview() : null}
        {progressSection === 'records' ? renderRecords() : null}
        {progressSection === 'tracked' ? renderTracked() : null}
        {progressSection === 'measures' ? renderMeasures() : null}
      </ScrollView>

      <WeightLogSheet
        visible={weightSheetVisible}
        language={language}
        initialKg={rulerWeightKg}
        dateIso={new Date().toISOString()}
        bottomInset={insets.bottom}
        onCancel={() => setWeightSheetVisible(false)}
        onSave={(weightKg) => {
          if (!takeRulerSave()) {
            return;
          }
          onAddBodyweight(weightKg);
          setWeightSheetVisible(false);
        }}
      />
      {/* Tape measures and body fat, on the same ruler. Opens on the last
          reading, or mid-scale when there is nothing to open on. */}
      <MeasureLogSheet
        visible={measureSheetVisible}
        language={language}
        title={t(language, selectedMeasureModel.labelKey)}
        hint={selectedMeasureModel.hintKey ? t(language, selectedMeasureModel.hintKey) : null}
        unit={selectedMeasureModel.unit}
        initialValue={
          selectedMeasureLatest ??
          (selectedMeasureModel.kind ? DEFAULT_MEASUREMENT_VALUE[selectedMeasureModel.kind] : 90)
        }
        dateIso={new Date().toISOString()}
        bottomInset={insets.bottom}
        onCancel={() => setMeasureSheetVisible(false)}
        onSave={(value) => {
          if (!takeRulerSave()) {
            return;
          }
          void handleSaveMeasure(value);
          setMeasureSheetVisible(false);
        }}
      />
      <BmiEditSheet
        visible={bmiSheetVisible}
        language={language}
        initialKg={rulerWeightKg}
        initialHeightCm={rulerHeightCm}
        bottomInset={insets.bottom}
        onCancel={() => setBmiSheetVisible(false)}
        onSave={({ weightKg, heightCm: nextHeight }) => {
          if (!takeRulerSave()) {
            return;
          }
          onSaveHeight?.(nextHeight);
          // Only writes a weigh-in when the reader actually moved the weight
          // dial. Editing your height should not silently stamp today with a
          // weight you did not step on a scale for.
          if (Math.abs(weightKg - rulerWeightKg) >= 0.05) {
            onAddBodyweight(weightKg);
          }
          setBmiSheetVisible(false);
        }}
      />

      {/* One lift's sets, over the curve they belong to. */}
      <SetLogSheet
        bottomInset={insets.bottom}
        visible={setLogTarget !== null}
        log={openSetLog}
        language={language}
        locked={isSetLogLocked(proUnlocked)}
        onClose={() => setSetLogTarget(null)}
        onStartWorkout={
          onStartWorkout
            ? () => {
                setSetLogTarget(null);
                onStartWorkout();
              }
            : undefined
        }
        onOpenPro={() => {
          setSetLogTarget(null);
          onOpenPremium?.();
        }}
      />

      {recoverySheet ? (
        <RecoverySheet
          visible={recoveryOpen}
          model={recoverySheet}
          language={language}
          bottomInset={insets.bottom}
          onClose={() => setRecoveryOpen(false)}
          onAction={(kind) => onRecoveryAction?.(kind)}
          onUndo={(kind) => onRecoveryUndo?.(kind)}
          onOpenPremium={() => onOpenPremium?.()}
        />
      ) : null}

      <ProMomentSheet
        visible={readSheetVisible}
        content={readMoment}
        language={language}
        bottomInset={insets.bottom}
        onClose={() => setReadSheetVisible(false)}
        onSeePro={() => {
          setReadSheetVisible(false);
          onOpenPremium?.();
        }}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  readBlock: {
    marginBottom: 18,
  },
  readTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.faint,
    marginBottom: 11,
  },
  readList: {
    gap: 10,
  },
  readRow: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  readRowPressed: { opacity: 0.7 },
  readRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  readDotRing: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  readCopy: {
    flex: 1,
    minWidth: 0,
  },
  readName: {
    fontSize: 15.5,
    fontWeight: '800',
    color: theme.ink,
  },
  readStatus: {
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 1,
  },
  readMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.muted,
    marginTop: 2,
  },
  readBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 30,
    width: 52,
  },
  readBar: {
    flex: 1,
    borderRadius: 3,
  },
  readLock: {
    marginTop: 13,
  },
  readFix: {
    backgroundColor: theme.surfaceSoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  readFixLine: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.ink,
    lineHeight: 20,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 10,
  },
  headerTitle: {
    color: theme.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tabsRow: {
    marginTop: 14,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: layout.bottomTabBarReserve,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  streakValueLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  streakValue: {
    color: theme.ink,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  streakLabel: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },
  streakCount: {
    color: theme.purple,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  recordsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recordsLink: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  recordsList: {
    gap: 9,
    marginBottom: 4,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 11,
    marginTop: 22,
  },
  sectionHeadLabel: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionHeadRight: {
    color: theme.purple,
    fontSize: 12.5,
    fontWeight: '800',
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
  },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
  },
  signalBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  signalBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  deltaPillText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  monthGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  monthCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  monthLabel: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  monthValue: {
    color: theme.ink,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginTop: 5,
  },
  monthMeta: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  trendValue: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  trendRangeRow: {
    alignItems: 'center',
  },
  trendMetricRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  trendValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 6,
  },
  calendarWeekdayRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  calendarWeekday: {
    flex: 1,
    textAlign: 'center',
    color: theme.faint,
    fontSize: 10,
    fontWeight: '800',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  calendarCell: {
    width: `${100 / 7}%`,
    paddingHorizontal: 3,
  },
  // Rest is the default and by far the most common cell, so it stays the
  // quietest thing on screen — the green tint was tried and the month read
  // as too colourful (user 2026-08-25). One mark carries the message.
  calendarBubble: {
    aspectRatio: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  // Any training day — trained, ahead, or behind — wears the same fill. The
  // white-label violet, since the day's number on it is white (accessibility
  // audit, 2026-09-21).
  calendarBubbleTraining: {
    backgroundColor: theme.purpleFill,
  },
  calendarBubbleToday: {
    borderWidth: 1.5,
    borderColor: theme.purple,
    borderStyle: 'dashed',
  },
  calendarBubbleText: {
    color: theme.faint,
    fontSize: 11.5,
    fontWeight: '700',
  },
  calendarBubbleTextTraining: {
    // White, the way the NEW tag is white on the same fill. onHighlight is the
    // ink for `highlight`, which is orange on the dark theme — the wrong pair
    // for a violet square. The theme's own note says white works on violet.
    color: '#FFFFFF',
  },
  calendarBubbleTextToday: {
    color: theme.purple,
  },
  progressHistoryCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    marginTop: 22,
  },
  historyHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  referenceCardTitle: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  historySeeAll: {
    color: theme.highlight,
    fontSize: 12.5,
    fontWeight: '800',
  },
  historyList: {
    marginTop: 6,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  historyIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCopy: {
    flex: 1,
    minWidth: 0,
  },
  historyTitle: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  historyMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  historyEmpty: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterChipActive: {
  },
  trackedList: {
    gap: 10,
  },
  trackedCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 14,
  },
  trackedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trackedCopy: {
    flex: 1,
    minWidth: 0,
  },
  trackedSetTarget: {
    color: theme.highlight,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  trackedName: {
    color: theme.ink,
    fontSize: 15.5,
    fontWeight: '800',
  },
  trackedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
  },
  trackedMeta: {
    flexShrink: 1,
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  trackedLogLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  trackedLogLinkText: {
    color: theme.purple,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '800',
  },
  trackedDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    gap: 10,
  },
  trackedDelta: {
    color: '#157A3A',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  trackedDeltaMuted: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  emptyBlock: {
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 10,
  },
  emptyTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  measureDetailBlock: {
    gap: 10,
  },
  measureDetailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  measureDetailLabel: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  measureValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 8,
  },
  measureValue: {
    color: theme.ink,
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 44,
  },
  measureUnit: {
    color: theme.muted,
    fontSize: 17,
    fontWeight: '800',
  },
  measureCaption: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 6,
  },
  measureHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // The weight card's action pill, same shape and same accent, because it
  // opens the same kind of sheet.
  measureLogPill: {
    backgroundColor: theme.highlight,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 20,
  },
  measureLogPillText: {
    color: theme.onHighlight,
    fontSize: 14.5,
    fontWeight: '800',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  entryRowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  entryDate: {
    flex: 1,
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  entryValue: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  entriesEditLink: {
    color: theme.highlight,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  entryDelete: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryDeleteGlyph: {
    color: theme.faint,
    fontSize: 21,
    lineHeight: 23,
    fontWeight: '600',
  },
  measureAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
  },
  measureAddText: {
    color: theme.highlight,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  measureList: {
    gap: 9,
  },
  measureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  // A row that holds data wears a quiet outline; the selected row keeps the
  // full-strength purple so the two states stay tellable apart.
  measureRowLogged: {
    borderColor: theme.purpleBright,
    borderWidth: 1,
  },
  measureRowActive: {
    borderColor: theme.purple,
    borderWidth: 1.5,
  },
  measureRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  measureRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  measureRowTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  measureRowMeta: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
