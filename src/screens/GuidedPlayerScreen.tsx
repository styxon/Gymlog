/**
 * Vinha Guided Player (design_handoff_guided_player).
 *
 * Full-screen Freeletics-style session mode: Warm-up (timed drills) → Workout
 * (strength sets + rests) → Cooldown (stretches) → save. One thing on screen
 * at a time. The summary lives in WorkoutCompletionScreen, not here. The step list itself is pure
 * (src/lib/guidedPlayer.ts); this screen owns timers, dispatches into
 * WorkoutProvider (so list view / resume stay in sync) and the visuals.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, BackHandler, Image, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from '../components/AppText';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { getExerciseImageSource } from '../assets/exerciseImages';
import {
  GuidedDrill,
  GuidedStep,
  GuidedSetTarget,
  GUIDED_READY_SECONDS,
  buildGuidedDrillsFromBlock,
  buildGuidedSteps,
  getGuidedStepPlanKey,
  findGuidedLibraryIndex,
  getGuidedPhaseRail,
  getGuidedPhaseSkipTargetIndex,
  findGuidedPhaseStart,
  dialHoldIntervalMs,
  formatGuidedCountdown,
  formatGuidedTarget,
  getGuidedBackTargetIndex,
  guidedBlockLastSlotId,
  recordWalkAddedSlot,
  resolveWalkAddAnchor,
  type WalkAddedLifts,
  buildGuidedRunSheet,
  getGuidedNextName,
  getGuidedNextPreview,
  getGuidedSessionTitle,
  liveSetProgress,
  getGuidedSkipTargetIndex,
  rollPastLoggedWork,
  getGuidedStepAnchor,
  getGuidedStepLabel,
  isGuidedExerciseOut,
  resolveGuidedOpening,
  formatGuidedRepsLabel,
  planRepsBounds,
  resolveGuidedSetPlan,
  resolveGuidedSetTarget,
  resolveGuidedWalkPlan,
  restRoundCorrections,
  loggedSetsOf,
  guidedRestSeconds,
  guidedAdjustedMs,
  guidedRestCueDue,
  guidedRestOpeningMs,
  guidedRestToExtend,
  withGuidedRestDeadline,
  withGuidedRestPaused,
} from '../lib/guidedPlayer';
import { guidedDrillMediaHeight, guidedWalkMediaHeight } from '../lib/guidedMediaHeight';
import {
  buildOverviewColumns,
  buildProgressionPill,
} from '../lib/sessionOverviewRows';
import { formatLastOwnBlock } from '../lib/ownBlockHistory';
import { buildWarmupBrief } from '../lib/warmupBrief';
import {
  HOLD_DIAL,
  MINUTES_DIAL,
  REPS_DIAL,
  WARMUP_REPS_DIAL,
  commitDialReps,
  commitDialWeight,
  isLoggableTypedReps,
  isLoggableTypedWeight,
  isTypedRepsPossiblyValid,
  stepDialReps,
  stepDialWeight,
} from '../lib/weightDial';
import { isLiftableWeight } from '../lib/weightLimits';
import {
  minutesClockOnStep,
  minutesToLog,
  MinutesStopwatch,
  msUntilNextMinutesChange,
  pauseStopwatch,
  SessionMinutesClock,
  startStopwatch,
  stopwatchElapsedMs,
  stopwatchForSet,
} from '../lib/minutesExercises';
import { formatCardioDuration } from '../lib/cardio';
import {
  exerciseCardAccessibilityLabel,
  setFieldAccessibilityLabel,
  weightStepAccessibilityLabel,
} from '../lib/accessibilityLabels';
import { getExerciseInstructions } from '../lib/exerciseInstructions';
import { getExerciseTeaching } from '../lib/exerciseTeaching';
import { buildExerciseSheetHistory, gateExerciseSheetHistory, LastTimeView } from '../lib/exerciseSheetHistory';
import { programmeSetCount, toWorkingHistoryEntry, warmupOffer } from '../lib/warmupSets';
import { formatLoadOrRange, summarizeHistoricalSetChips } from '../lib/guidedSetWeightSummary';
import type { LoggedSetRow } from '../lib/guidedPlayer';
import {
  GUIDED_CARD_CHIP_CAP,
  GUIDED_SET_BOX_CAP,
  guidedBoxesThatFit,
  guidedLastLoadKg,
  guidedLoadTrend,
  guidedTodayLoadKg,
  guidedWindow,
} from '../lib/guidedSetRow';
import { GuidedTourReport, useTourTarget } from '../features/tour/GuidedTourReport';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen';
import { consumeBackForTour } from '../features/tour/tourBack';
import type { TourTargetRegistry } from '../features/tour/tourTargets';
import type { TourTargetId, WorkoutTourStep } from '../lib/firstRunTour';
import { skipRestTap, SKIP_REST_CONFIRM_MS } from '../lib/skipRestConfirm';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { SupersetBorder } from '../components/SupersetBorder';
import { getDrillLibraryName } from '../lib/drillMedia';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { exerciseInitials } from '../lib/exerciseInitials';
import { asksBeforeZeroWeightLog } from '../lib/zeroWeightLog';
import { libraryLabel } from '../lib/libraryLabel';
import { classifySessionFocus, getDefaultCooldown, getDefaultWarmup } from '../lib/homeSessionHero';
import { formatClockTime, formatSetScheme, formatWeight, parseNumberInput, removeTrailingZeros } from '../lib/format';
import { formatClock } from '../lib/restSchedule';
import { estimateSessionMinutes } from '../lib/sessionDuration';
import { buildSupersetRuns, normalizeSupersetGroups, supersetGroupIndexes, supersetPositions } from '../lib/supersetGrouping';
import { I18nKey, t } from '../lib/i18n';
import { setCountLabel, unloadedSetRowLabel, walkRampLabel, walkSupersetRampLabel } from '../lib/repCountCopy';
import { haptics } from '../utils/haptics';
import { subscribeRestActions, useRestEndAlert } from '../hooks/useRestEndAlert';
import { useRestAlertPermissionMoment } from '../hooks/useRestAlertPermissionMoment';
import { useModalHandoff } from '../hooks/useModalHandoff';
import { RestAlertsSheet } from '../components/RestAlertsSheet';
import { prepareCueSounds, sound, type CueSound } from '../utils/sound';
import { useTheme, useThemeName, useThemedStyles } from '../theming';
import type { GuidedPlayerScreenProps } from './GuidedPlayerTypes';
import { GPD, SET_DOT_GAP, SET_DOT_SIZE, WALK_RUN_HEAD, WALK_RUN_ROW, makeStyles } from './GuidedPlayerStyles';
import { BigBtn, CtrlBtn, GhostBtn, MediaZone, NameBlock, NextLine, ProgressRail, RestRing, TopBar } from './GuidedPlayerParts';
import { GPIcon, PopIn, RING_CLOCK_FIT, ReducedMotionContext, StepIn } from './GuidedPlayerMotion';
import { AppLanguage, ExerciseLibraryItem, UnitPreference } from '../types/models';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { elapsedSecondsOf } from '../features/workout/workoutState';
import { sessionLiftsMatchingQuery } from '../lib/swapShortlist';
import { getExerciseTemplateDefaults, getPopularExerciseLibraryOrder, restSecondsForAddedLift } from '../lib/exerciseSuggestions';
import { getCatalogTrackingMode } from '../lib/catalogExercisePools';
import { AddExerciseSheet } from '../components/AddExerciseSheet';
import { guidedClockHeld } from '../lib/guidedClockHold';
import { sheetScrollMaxHeight } from '../lib/sheetScrollBound';
import { fitRunPreview, hiddenWorkCount, isLastWorkItem } from '../lib/guidedRunPreview';
import { ExercisePickerEntry, ExercisePickerSheet, SheetEquipmentOption } from '../components/AddExerciseSheet';
import { BodyPartFilter } from '../lib/exerciseBrowseFilter';
import { ExercisePickerFilters } from '../lib/exercisePicker';
import { exerciseSheetCopy } from '../lib/exerciseSheetMode';
import { effectiveSwapBodyPart, effectiveSwapCategory, resolveSwapBrowsePrefilter } from '../lib/swapBrowsePrefilter';
import { buildSwapAlternatives, buildSwapPickerLibrary, narrowSwapAlternatives, swapSuggestionFilters } from '../lib/swapPickerLists';
import { useKeepScreenAwake } from '../utils/keepAwake';
import { queryReduceMotion } from '../utils/reduceMotion';
import {
  canCompleteSet,
  getHistoryEntriesForExercise,
  repsCeilingFor,
  resolveInstanceBorrowRepWindow,
  resolveInstanceDose,
} from '../features/workout/workoutState';
import { isUsableEntry, resolveLastTimeEntry } from '../lib/exerciseHistoryLookup';
import { liftOfSet, setsOfCurrentLift } from '../lib/liftSegments';
import { praisedSlotBeforeWalkUp, resolveLiftPraise } from '../lib/liftPraise';
import {
  isMinutesTrackingMode,
  isTimedTrackingMode,
  isUnloadedTrackingMode,
  WorkoutExerciseInstance,
} from '../features/workout/workoutTypes';

// A bundled picture carries its own pixel size, and React Native uses it
// as the Image's default width and height, which absoluteFill's edges do not
// override: the picture drew at full size from the corner and was cropped to
// its top-left (#bugs 2026-10-09). A remote uri had no size, so this never
// showed before the pictures were bundled.
const FILL_SIZE = { width: '100%', height: '100%' } as const;

const SPLASH_MS = 2300;

/**
 * The rest a mid-workout add falls back to when there is no rest to inherit —
 * a cooldown-only session with no main block (recheck round 2026-09-29), or a
 * last exercise that rests 0 — and no `defaultRestSeconds` was passed. Same
 * number `AppProvider` seeds a fresh install's preferences with.
 */
const NO_ANCHOR_DEFAULT_REST_SECONDS = 120;

/**
 * A phase splash that offers the "do it yourself" fork. Those wait for a
 * tap; the work splash is a beat between phases and passes on its own.
 */
function splashCarriesChoice(target: GuidedStep) {
  return target.type === 'splash' && (target.phase === 'warmup' || target.phase === 'cooldown');
}

/**
 * How long a step runs on the clock. Module scope, not a closure: the screen
 * can now mount straight onto a resumed step, and the timer it opens with has
 * to be armed before the first render rather than by the goTo that no longer
 * happens.
 */
function stepSeconds(target: GuidedStep): number {
  switch (target.type) {
    case 'ready':
      return 3;
    case 'drill':
    case 'rest':
    case 'position':
      return target.seconds;
    case 'splash':
      return splashCarriesChoice(target) ? 0 : SPLASH_MS / 1000;
    // An interval's work bout runs on the clock like everything else here.
    // An ordinary set does not: it ends when the reader says it ended.
    case 'set':
      return target.interval?.workSeconds ?? 0;
    default:
      return 0;
  }
}

/** The heaviest load in a session's sets, or 0 when there is none to show. */
function heaviestOf(history: LastTimeView | null | undefined): number {
  return history && history.sets.length > 0 ? Math.max(...history.sets.map((set) => set.loadKg)) : 0;
}

/**
 * A set by its own index, not by where it sits in the array.
 *
 * Today those are the same thing — sets are only ever appended and only ever
 * removed from the end, so `setIndex` tracks position. The reducer looks sets
 * up by the field anyway (`sets.find(item => item.setIndex === …)`), and two
 * readers of one fact disagreeing quietly is exactly the class of bug this
 * screen has already shipped once. So this one asks the same question the
 * reducer does, and a "remove the middle set" that arrives later cannot make
 * the rest screen show the wrong set's numbers.
 */
function findSetByIndex(
  exercise: WorkoutExerciseInstance | null | undefined,
  setIndex: number,
): WorkoutExerciseInstance['sets'][number] | null {
  return exercise?.sets.find((item) => item.setIndex === setIndex) ?? null;
}

/* ── set-screen dial ── */

/**
 * A −/+ button that steps once on tap and runs while held, speeding up.
 *
 * Pressable's onLongPress fires instead of onPress when the finger stays
 * down, so a tap is exactly one step and a hold is one step plus a run that
 * ends on release. The run schedules itself with setTimeout rather than
 * setInterval so the interval can shorten mid-hold (dialHoldIntervalMs).
 */
function DialButton({
  glyph,
  accessibilityLabel,
  onStep,
}: {
  glyph: '−' | '+';
  accessibilityLabel: string;
  onStep: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticksRef = useRef(0);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const stopRun = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    ticksRef.current = 0;
  }, []);

  const runTick = useCallback(() => {
    onStepRef.current();
    ticksRef.current += 1;
    timerRef.current = setTimeout(runTick, dialHoldIntervalMs(ticksRef.current));
  }, []);

  // A hold that outlives the button (step change, unmount) must not keep
  // stepping a number nobody can see.
  useEffect(() => stopRun, [stopRun]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={() => onStepRef.current()}
      onLongPress={runTick}
      delayLongPress={350}
      onPressOut={stopRun}
      style={({ pressed }) => [styles.setDialBtn, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.setDialBtnText}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * One dial: a label, the number, −/+ under it. Tapping the number opens it
 * as a text field; the buttons are always live. The reader's own sketch
 * (2026-09-09): "16,25" had shared its row with two buttons and lost the
 * ",25", and reps were squeezed the same way. Buttons under the number give
 * the number the card's width. No "tap to type" line under them: it was in
 * the sketch and struck out on the phone the same day.
 */
function DialCard({
  label,
  value,
  unit,
  open,
  onToggle,
  onStep,
  downLabel,
  upLabel,
  editHint,
  wide,
  faint,
  onCommit,
  invalid = false,
  onDraftCleared,
  doneLabel,
}: {
  label: string;
  value: string;
  unit: string | null;
  /** Typing: the number is a text field until the card is closed. */
  open: boolean;
  onToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  downLabel: string;
  upLabel: string;
  /** Screen-reader hint on the number. */
  editHint: string;
  wide: boolean;
  faint: boolean;
  /** Commit a typed value; the lib rule decides what the text becomes. */
  onCommit: (text: string) => void;
  /** What is typed is not a number this card can log; drawn in the danger ink. */
  invalid?: boolean;
  /**
   * The field stopped showing typed text and shows the card's number again:
   * the keyboard went away, or a step moved the number. Whatever made the
   * typed text unloggable is no longer on screen (CI review of #174: the log
   * button stayed locked, red, over a field that read a good weight).
   */
  onDraftCleared?: () => void;
  /**
   * The bar iOS draws over its number pads, which have no return key; it is
   * the one way to close the card from the keyboard, and says "Done" in
   * English unless told otherwise.
   */
  doneLabel: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [draft, setDraft] = useState<string | null>(null);

  // One step, from either a button or a screen reader's swipe. A step moves
  // the card's number, so the field shows that number rather than text typed
  // before it.
  const step = (direction: -1 | 1) => {
    setDraft(null);
    onDraftCleared?.();
    onStep(direction);
  };

  // Every keystroke commits. The field shows what is being typed (`draft`)
  // while the parent's number follows it through the lib rule, so nothing is
  // pending when the card closes — by the keyboard's done key, by a tap
  // elsewhere (which unmounts the field without a blur on Android), or by the
  // log button, which reads `kg` in the very tick it closes the card.
  useEffect(() => {
    if (!open) {
      setDraft(null);
    }
  }, [open]);

  return (
    <View style={[styles.setDialCard, wide && styles.setDialCardWide, open && styles.setDialCardOpen]}>
      <Text style={[styles.setDialLabel, open && { color: theme.highlight }]}>{label}</Text>
      {/* An adjustable, the way a screen reader expects a number you nudge:
          swipe up or down steps it by the dial's own step and the new value
          is read back, where a button role left the reader hunting for two
          small buttons and hearing nothing after them (accessibility audit,
          2026-09-21). A double tap still opens it for typing. Open, it steps
          aside so the field inside is reached on its own. */}
      <Pressable
        accessible={!open}
        accessibilityRole={open ? undefined : 'adjustable'}
        accessibilityLabel={label}
        accessibilityValue={{ text: `${value}${unit ? ` ${unit}` : ''}` }}
        accessibilityHint={editHint}
        accessibilityActions={[
          { name: 'increment', label: upLabel },
          { name: 'decrement', label: downLabel },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            step(1);
          } else if (event.nativeEvent.actionName === 'decrement') {
            step(-1);
          }
        }}
        onPress={open ? undefined : onToggle}
        style={({ pressed }) => [styles.setDialValue, pressed && !open && { opacity: 0.7 }]}
      >
        {open ? (
          <TextInput
            value={draft ?? value}
            onChangeText={(text) => {
              setDraft(text);
              onCommit(text);
            }}
            onFocus={() => setDraft(value)}
            onBlur={() => {
              setDraft(null);
              onDraftCleared?.();
            }}
            onSubmitEditing={onToggle}
            autoFocus
            keyboardType={unit ? 'decimal-pad' : 'number-pad'}
            returnKeyType="done"
            inputAccessoryViewButtonLabel={doneLabel}
            selectTextOnFocus
            accessibilityLabel={label}
            style={[styles.setDialNumber, faint && { color: theme.faint }, invalid && { color: theme.danger }]}
          />
        ) : (
          <Text
            style={[styles.setDialNumber, faint && { color: theme.faint }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {value}
          </Text>
        )}
        {unit ? <Text style={styles.setDialUnit}>{unit}</Text> : null}
      </Pressable>
      <View style={styles.setDialControls}>
        <DialButton glyph="−" accessibilityLabel={downLabel} onStep={() => step(-1)} />
        <DialButton glyph="+" accessibilityLabel={upLabel} onStep={() => step(1)} />
      </View>
    </View>
  );
}

/**
 * The add-exercise sheet's "recent" list: none here, and the SAME none on
 * every render.
 *
 * It was an inline `[]`, a new array each render, and the sheet — mounted the
 * whole session, open or not — keys its ordering memos on it. So every render
 * of the player re-sorted the ~900-item library with `localeCompare`: 230 ms
 * on the phone, on every 100 ms tick of a timer and every second of the clock.
 * The JS thread never caught up, and everything waited on it — the countdown
 * showed its 3 for 1.24 s and its 1 for 0.7 s, the sheets dragged late (#bugs
 * 2026-09-30, "Countdown lagaa 3 3 2 1", measured on the device: 230 ms per
 * render before, under 40 ms after).
 */
const NO_RECENT_EXERCISES: ExerciseLibraryItem[] = [];

/* ── bottom sheet ── */
/** How far down a released drag has to have gone to close the sheet. */
const SHEET_DISMISS_DRAG = 90;
/** …or how fast it was still moving down when let go. */
const SHEET_DISMISS_VELOCITY = 0.9;
/** The walk-up scroll's own padding (28 top, 8 bottom) and the gap above the list. */
const WALK_RUN_CHROME = 28 + 8 + 14;
/** The sheet's height cap (`sheetFrame`), as a share of the scrim. */
const SHEET_CAP_FRACTION = 0.78;

/**
 * Children built only while they are drawn. A kept-mounted sheet's rows are
 * otherwise computed on every render of the player, which renders every
 * second for its clock, even while the sheet is closed and its Modal draws
 * nothing.
 */
function Deferred({ render }: { render: () => React.ReactNode }) {
  return <>{render()}</>;
}

function GPSheet({
  title,
  language,
  onClose,
  bottomInset,
  scrollable = false,
  visible = true,
  onDismissed,
  children,
}: {
  /**
   * For a sheet that hands off to another modal (hooks/useModalHandoff): kept
   * mounted and switched off here, because iOS reports a Modal's dismissal
   * only when `visible` turns false, never when it unmounts.
   */
  visible?: boolean;
  /** iOS only: the sheet has finished leaving the screen. */
  onDismissed?: () => void;
  /** Drawn in the grab zone beside the close button, so the title is a handle too. */
  title: string;
  /** For the close button's name. */
  language: AppLanguage;
  onClose: () => void;
  /**
   * Safe-area inset, read on the screen — see `screenInsets` below for why:
   * inside this Modal, `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
  /**
   * The children are a list that may be longer than the sheet: GPSheet
   * scrolls them itself, bounded by MEASURED space — the scrim it stands in,
   * its own head, its bottom padding with the inset (lib/sheetScrollBound).
   * The contents sheet's own bound was a guess from the window and lost its
   * last rows below the sheet on a nine-lift day (#bugs 2026-10-06).
   */
  scrollable?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { height: windowHeight } = useWindowDimensions();
  // Measured on layout; the window and the head's usual height stand in for
  // the first frame only.
  const [areaHeight, setAreaHeight] = useState<number | null>(null);
  const [headHeight, setHeadHeight] = useState<number | null>(null);
  const bottomPadding = bottomInset + 30;
  const listMaxHeight = sheetScrollMaxHeight({
    areaHeight: areaHeight ?? windowHeight,
    capFraction: SHEET_CAP_FRACTION,
    headHeight: headHeight ?? 81,
    bottomPadding,
  });
  // The sheet's own 30 was a guess at the phone's navigation bar, and on a
  // three-button handset the last row and the footnote sat behind it. Measured
  // rather than guessed — reported twice, on two different sheets.

  /*
   * Three ways out, as asked (#bugs 2026-09-30, "vaikea sulkea tätä valikkoa
   * joko klikkaamalla muualta sulkee alasvedettäessä tai ruksi"): a tap on
   * the dimmed page, the ✕ beside the title, and a pull down on the top of the
   * sheet — the grip, the title row, anywhere across that strip. The grip was
   * drawn and did nothing.
   *
   * The drag moves a transform, not a height, so nothing inside the sheet is
   * laid out again while the finger moves. The list below the title keeps its
   * own vertical scroll; only the top strip pulls.
   */
  const dragY = useRef(new Animated.Value(0)).current;
  // Through a ref: callers pass onClose inline, and the player re-renders
  // every second for its clock — a gesture rebuilt on each render loses the
  // drag it granted.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useMemo(() => {
    const settle = () =>
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > SHEET_DISMISS_DRAG || gesture.vy > SHEET_DISMISS_VELOCITY) {
          onCloseRef.current();
          return;
        }
        settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [dragY]);
  // A kept-mounted sheet closed by a pull would open again still pulled down.
  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
    }
  }, [visible, dragY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <View
        style={styles.sheetScrim}
        onLayout={(event) => setAreaHeight(Math.round(event.nativeEvent.layout.height))}
      >
        {/* The tap on the dimmed page, BESIDE the sheet rather than around it.
            The sheet sat inside this Pressable and was a Pressable itself, to
            swallow its own taps — and on Android the contents list inside two
            pressables did not scroll at all, whatever height it was given
            (#bugs 2026-10-08, "ei pysty vieläkään skrollaamaan", after two
            fixes to its height). The kit's sheets (components/sheetKit) are
            built this way, and their lists scroll. Out of the accessibility
            tree: the ✕ is the same action with a name. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        {/* The 78% cap lives on this wrapper, whose parent is the full-screen
            scrim: on the sheet inside it the percentage would resolve against
            a content-sized parent and quietly stop capping anything. */}
        <Animated.View
          style={[styles.sheetFrame, { transform: [{ translateY: dragY }] }]}
        >
          <View style={[styles.sheet, { paddingBottom: bottomPadding }]}>
            {/* Measured: the sheet's paddingTop and the grab's -12 margin
                cancel, so the grab's own height is the whole head. */}
            <View
              {...pan.panHandlers}
              style={styles.sheetGrab}
              onLayout={(event) => setHeadHeight(Math.round(event.nativeEvent.layout.height))}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitleText}>{title}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'common.close')}
                  hitSlop={10}
                  onPress={onClose}
                  style={styles.sheetClose}
                >
                  <GPIcon name="x" size={17} color={theme.muted} />
                </Pressable>
              </View>
            </View>
            {scrollable ? (
              <ScrollView
                style={[styles.sheetScroll, { maxHeight: listMaxHeight }]}
                contentContainerStyle={styles.sheetScrollContent}
                // Android hides the bar until a scroll starts, and a list
                // that does not look scrollable was reported as cut off.
                persistentScrollbar
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ══════════════════════════════ screen ══════════════════════════════ */

/**
 * The screen, inside the one question every StepIn and PopIn needs answered:
 * does the phone ask for less motion? Asked once per session through the
 * helper that always answers (accessibility audit, 2026-09-21).
 */
export function GuidedPlayerScreen(props: GuidedPlayerScreenProps) {
  const theme = useTheme();
  const { activeSession } = useWorkoutContext();
  const [reduceMotion, setReduceMotion] = useState(false);
  // Warm the audio mode so the first cue does not wait on it.
  useEffect(() => {
    prepareCueSounds();
  }, []);
  useEffect(() => {
    let mounted = true;
    void queryReduceMotion().then((reduced) => {
      if (mounted) {
        setReduceMotion(reduced);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  /*
   * No session, no player — decided out here, before the player's hooks.
   *
   * GuidedPlayer returned early on a missing session with some twenty hooks
   * after that return. Finishing clears the session on the default lane and
   * moves to the summary inside a transition, so the player rendered once
   * with no session, rendered fewer hooks than the time before, and threw:
   * React error #520, recovered by a synchronous re-render, on the screen
   * that saves the workout (#bugs 2026-10-01, browser smoke test; reproduced
   * on web, gone with this). Its own early return stays for the type
   * narrowing, and can no longer run.
   */
  if (!activeSession) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  return (
    <ReducedMotionContext.Provider value={reduceMotion}>
      <GuidedPlayer {...props} />
    </ReducedMotionContext.Provider>
  );
}

function GuidedPlayer({
  unitPreference,
  language = 'en',
  availableEquipment = null,
  cautionFlags,
  routineDrillOverrides = {},
  tailoringPreferences = null,
  exerciseLibrary,
  liftHistory,
  proUnlocked = false,
  onOpenPro,
  progressionOn = false,
  plateauNotice,
  soundCuesEnabled,
  keepScreenAwake = false,
  defaultRestSeconds = NO_ANCHOR_DEFAULT_REST_SECONDS,
  onToggleSoundCues,
  entryEyebrow,
  ownBlockStats = {},
  onRecordOwnBlock,
  learnedExerciseIds = [],
  techniqueChecks = {},
  onToggleTechniqueStatement,
  onToggleExerciseLearned,
  weekProgress,
  nextUp,
  onLeave,
  onEndSession,
  onFinishSession,
  isSavingWorkout,
  saveFailed = false,
  restAlerts = { alerts: true, warning: true, ongoing: true, asked: false },
  onRestAlertsAnswered,
  onOpenSystemSettings,
  autoResume = false,
  tourTargets,
  onTourStep,
  tourRunning = false,
  tourFocus = null,
}: GuidedPlayerScreenProps) {
  // Read here, on the screen: inside the sheet's Modal it is always 0.
  const screenInsets = useSafeAreaInsets();
  // The drill picture yields to the countdown on a short phone (guidedMediaHeight).
  const { height: playerWindowHeight, fontScale: playerFontScale } = useWindowDimensions();
  /** The rest screen's controls, for the workout tour, top to bottom. */
  const restStripRef = useTourTarget(tourTargets, 'workout.runStrip');
  const restAdjustRef = useTourTarget(tourTargets, 'workout.restAdjust');
  const restPauseRef = useTourTarget(tourTargets, 'workout.restPause');
  const restSkipRef = useTourTarget(tourTargets, 'workout.restSkip');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The resolved theme, for the status bar: the player has its own dark
  // gradient on the finish step and that is a different question.
  const themeName = useThemeName();
  const workout = useWorkoutContext();
  const session = workout.activeSession;

  /**
   * The session clock, derived here rather than ticked into global state.
   *
   * The provider used to dispatch a tick every second for any active session,
   * and every tick made a new state object — so the whole app re-rendered once
   * a second on every screen, including screens with no clock on them, for as
   * long as a workout sat unfinished. The two other logging screens already
   * derive this locally; this was the last consumer keeping the shared clock
   * alive for a number only this screen shows.
   */
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const sessionStartedAt = session?.startedAt ?? null;
  useEffect(() => {
    if (!sessionStartedAt) {
      return undefined;
    }
    const timer = setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionStartedAt]);
  // The same function the saved duration uses, so the clock on screen and the
  // number in history cannot disagree about how long the workout took.
  const derivedElapsedSeconds = session ? elapsedSecondsOf(session, clockNowMs) : 0;
  useKeepScreenAwake(keepScreenAwake, 'guided-player');

  // The catalog names sessions in English; the focus half of the name reads in
  // the user's language, the plan brand in front of it does not.
  // getGuidedSessionTitle localizes (sessionNameLabel.localizeSessionFocus).
  const sessionTitle = getGuidedSessionTitle(session?.templateName ?? '', language);

  // From the exercises, not from `sessionTitle` — that string is localized one
  // line above, and feeding it to the classifier is exactly how every Finnish
  // session ended up with the same generic warmup.
  const focusKind = useMemo(
    () => classifySessionFocus((session?.exercises ?? []).map((exercise) => exercise.exerciseName)),
    [session?.exercises],
  );
  const warmupDrills = useMemo<GuidedDrill[]>(
    () =>
      buildGuidedDrillsFromBlock(
        getDefaultWarmup(focusKind, language, availableEquipment, routineDrillOverrides, cautionFlags),
      ),
    [focusKind, language, availableEquipment, routineDrillOverrides, cautionFlags],
  );
  const cooldownDrills = useMemo<GuidedDrill[]>(
    () =>
      buildGuidedDrillsFromBlock(
        getDefaultCooldown(focusKind, language, availableEquipment, routineDrillOverrides, cautionFlags),
      ),
    [focusKind, language, availableEquipment, routineDrillOverrides, cautionFlags],
  );

  const exercises = session?.exercises ?? [];
  const guidedExercises = exercises.map((exercise) => ({
    slotId: exercise.slotId,
    name: exercise.exerciseName,
    restSeconds: exercise.restSecondsMin,
    setCount: exercise.sets.length,
    // Not `status === 'skipped'`: a lift with one logged set and the rest
    // skipped is `completed` for saving (the set counts) but still out of the
    // plan (nothing left to do). See isGuidedExerciseOut.
    skipped: isGuidedExerciseOut(exercise),
    supersetGroup: exercise.supersetGroup ?? null,
  }));
  const stepPlan = useMemo(
    () =>
      buildGuidedSteps({ warmup: warmupDrills, exercises: guidedExercises, cooldown: cooldownDrills }, language),
    // Rebuild only when the shape of the session changes, not on every set log.
    // The key must cover everything the steps bake in — see getGuidedStepPlanKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warmupDrills, cooldownDrills, language, getGuidedStepPlanKey(guidedExercises)],
  );
  const { steps, groups } = stepPlan;

  const exerciseBySlot = useMemo(() => {
    const map = new Map<string, WorkoutExerciseInstance>();
    exercises.forEach((exercise) => map.set(exercise.slotId, exercise));
    return map;
  }, [exercises]);

  const isSetCompleted = useCallback(
    (slotId: string, setIndex: number) =>
      exerciseBySlot.get(slotId)?.sets.find((set) => set.setIndex === setIndex)?.status === 'completed',
    [exerciseBySlot],
  );

  const resolveTarget = useCallback(
    (slotId: string, setIndex: number): GuidedSetTarget | null => {
      const exercise = exerciseBySlot.get(slotId);
      if (!exercise) {
        return null;
      }
      return resolveGuidedSetTarget(
        exercise.sets,
        setIndex,
        exercise.trackingMode,
        exercise.swappedAfterSetIndex,
        exercise,
      );
    },
    [exerciseBySlot],
  );

  /* ── mode + step position ── */
  /**
   * Where this mount opens.
   *
   * "Resume workout" on Home used to land here on the overview, because the
   * screen unmounts when you leave and always came back at `entry`. The button
   * said continue and delivered a menu (#bugs 2026-08-29) — so an arrival that
   * explicitly asks to resume goes straight to the set, and every other
   * arrival still gets the overview it was built for.
   *
   * Computed once, in a ref, because it is an opening position and not a
   * derived value: recomputing it as sets get logged would drag the screen
   * back to wherever the store's anchor points.
   */
  const openingStepRef = useRef<number | null>(null);
  if (openingStepRef.current === null) {
    openingStepRef.current = session
      ? resolveGuidedOpening({
          steps,
          storedIndex: session.ui.guidedStepIndex ?? null,
          anchor: session.ui.guidedResumeAnchor ?? null,
          isSetCompleted,
          autoResume,
        }).stepIndex
      : 0;
  }
  const openingStep = openingStepRef.current;
  const [mode, setMode] = useState<'entry' | 'player'>(openingStep > 0 ? 'player' : 'entry');
  /*
   * The workout opens; the warm-up and the recovery do not.
   *
   * All three used to start closed, which made the overview a screen of three
   * closed doors — the reader had to open the one that holds the session to
   * see the session. The block that carries the weights is the one they came
   * to read.
   */
  const [expandedPhases, setExpandedPhases] = useState<string[]>(['work']);
  const [stepIndex, setStepIndex] = useState(openingStep);
  const step: GuidedStep = steps[Math.min(stepIndex, steps.length - 1)] ?? { type: 'finish' };
  const stepRef = useRef(step);
  stepRef.current = step;
  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;
  /** The rest that last ran out by itself into the step after it; any move clears it. */
  const expiredRestRef = useRef<number | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Leaving a bout's step without logging it pauses the bout
  // (lib/minutesExercises minutesClockOnStep). Keyed on the set, not on the
  // step object, which is rebuilt with every render. Only a move: the step
  // this mount opens on is not one, so a session reopened at its overview or
  // after Android killed the app finds the clock still running (#337).
  const shownSetKey =
    step.type === 'set' ? `${step.slotId}|${step.setIndex}|${step.exerciseName}` : null;
  const minutesClockRef = useRef(workout.activeSession?.minutesClock ?? null);
  minutesClockRef.current = workout.activeSession?.minutesClock ?? null;
  const lastShownSetKeyRef = useRef(shownSetKey);
  useEffect(() => {
    if (lastShownSetKeyRef.current === shownSetKey) {
      return;
    }
    lastShownSetKeyRef.current = shownSetKey;
    const shown = stepRef.current;
    const clock = minutesClockRef.current;
    const next = minutesClockOnStep(
      clock,
      shown.type === 'set' ? { slotId: shown.slotId, setIndex: shown.setIndex, exerciseName: shown.exerciseName } : null,
      Date.now(),
    );
    if (next !== clock) {
      workout.setMinutesClock(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownSetKey]);

  /* ── timers ── */
  // Seeded from the opening step, not from zero: mounting straight onto a
  // timed step (a walk-up, a drill) with nothing on the clock would expire it
  // on the first tick.
  // A reopened rest has what it had left, not its full length (#19, hunt 2026-10-09).
  const openingStepShown = steps[openingStep] ?? { type: 'finish' as const };
  const openingMs =
    guidedRestOpeningMs(session?.ui.guidedResumeAnchor, openingStepShown, Date.now()) ??
    stepSeconds(openingStepShown) * 1000;
  const [remainingMs, setRemainingMs] = useState(openingMs);
  const remainingRef = useRef(openingMs);
  /**
   * Wall-clock deadline for the running step. Android throttles (and with the
   * screen off, stops) JS timers in the background, so the remaining time is
   * derived from the clock instead of accumulated ticks — a rest keeps running
   * while the phone is pocketed and is correct the moment we come back.
   * Null while paused or on an untimed step.
   */
  const endsAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const lastBeepSecondRef = useRef<number | null>(null);
  /**
   * The in-app timer cannot fire while Android has our JS suspended, so a rest
   * deadline is handed to the system as a scheduled notification too. Dropped
   * the moment the rest is skipped, paused, adjusted or finished in-app.
   */
  // What the lock-screen card says between rests: the session and its lift.
  const sessionCard = useMemo(() => {
    if (!session) {
      return null;
    }
    const time = formatClockTime(new Date(session.startedAt));
    // The run sheet's count (liveSetProgress): skipped lifts and sets are out,
    // so the card reaches n of n when everything left is done.
    const { done, total } = liveSetProgress(session.exercises);
    const current = session.exercises.find((ex) => ex.sets.some((set) => set.status !== 'completed' && set.status !== 'skipped'));
    return {
      title: t(language, 'rest.notify.sessionTitle', {
        session: sessionTitle,
        exercise: current ? exerciseNameLabel(language, current.exerciseName) : '',
      }),
      body: t(language, total === 1 ? 'rest.notify.sessionBodyOne' : 'rest.notify.sessionBody', { done, total, time }),
    };
  }, [language, session, sessionTitle]);
  const syncRestEndAlert = useRestEndAlert(language, {
    warning: restAlerts.warning,
    ongoing: restAlerts.ongoing,
    session: sessionCard,
  });
  /**
   * The OS mirror of a rest, behind the same switch the empty workout
   * honours: the rest-alert switch in Settings, the reader's own, which no
   * longer waits on the phone's Notifications switch (user 2026-09-17). This
   * screen used to hand every rest to the OS regardless, which on a fresh
   * install meant a ladder behind a permission nobody had been asked for —
   * nothing fired, and nothing said so.
   */
  const syncRestNotification = useCallback(
    (endsAtMs: number | null, nextName?: string | null, recovery?: boolean) =>
      syncRestEndAlert(restAlerts.alerts ? endsAtMs : null, nextName, recovery),
    [restAlerts.alerts, syncRestEndAlert],
  );

  // Lock-screen actions land in App and come here over the bus. The guided
  // rest is a timed step, so "+30 s" is the same move as the +15s button and
  // "skip" is the same as advancing.
  useEffect(
    () =>
      subscribeRestActions((action) => {
        const shown = stepRef.current;
        // The rest this alert is about may have run out into its set before
        // the tap was delivered (coming back to the app settles the clock
        // first, or second): "+60 s" then goes back to that rest, as it does
        // on the free workout's overrun rest.
        const lapsed = guidedRestToExtend(stepsRef.current, expiredRestRef.current, stepIndexRef.current);
        if (action.kind === 'extend' && shown?.type !== 'rest' && lapsed !== null) {
          goToRef.current(lapsed, action.seconds * 1000);
          return;
        }
        // An interval's recovery is neither stretched nor skipped (the rest
        // screen hides both, #bugs 2026-08-26): a tap on the lock screen is
        // the same move and gets the same answer.
        if (shown?.type !== 'rest' || shown.recoveryKind) {
          return;
        }
        if (action.kind === 'extend') {
          adjustRemainingRef.current(action.seconds * 1000);
        } else if (action.kind === 'skip') {
          advanceRef.current();
        }
      }, session?.sessionId ?? null),
    // The session's id is fixed for the screen's life; the listener reads
    // everything else through refs. Subscribed on mount, which is also where
    // an action held since the cold start arrives (lib/restActionBus) — the
    // screen has opened on the rest step by then, from the stored anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [paused, setPaused] = useState(false);
  const [howtoOpen, setHowtoOpen] = useState(false);
  /**
   * Doing a block your own way.
   *
   * The block used to offer "Skip warmup", which named the wrong thing: a
   * reader with their own five minutes on the bike is not skipping the
   * warmup, they are doing it — the guided drills are what they are leaving
   * (user 2026-08-26). So the block is left by SAYING you will do it
   * yourself, and the app waits with a clock instead of jumping straight to
   * the first lift. The step index does not move until you come back, so
   * backgrounding the app mid-warmup returns you here rather than to a set
   * you never started.
   */
  const [ownBlock, setOwnBlock] = useState<{ phase: 'warmup' | 'cooldown'; startedAt: number } | null>(
    null,
  );
  /**
   * The set screen's exercise info (history, how-to, photo). It opens from the
   * header's right-hand button now, so the state lives beside the header
   * rather than inside the set view (user 2026-08-26). Reset on every step, so
   * each lift starts quiet — the rule the old tab followed too.
   */
  const [setPanelsOpen, setSetPanelsOpen] = useState(false);
  // v4 set screen: the top-bar camera opens the 3D rig from screen level, so
  // the media zone no longer carries its own button.
  const [exitOpen, setExitOpen] = useState(false);
  const [pauseSheetOpen, setPauseSheetOpen] = useState(false);
  /** The session as a list, opened from the rail. Read-only — it moves nothing. */
  const [runSheetOpen, setRunSheetOpen] = useState(false);
  const [confirmingSkipExercise, setConfirmingSkipExercise] = useState(false);
  // The actions and exit sheets open other modals; on iOS those wait for the
  // sheet to leave (hooks/useModalHandoff).
  const { handOff, onSheetDismissed } = useModalHandoff();
  const [swapOpen, setSwapOpen] = useState(false);
  /**
   * The cooldown intro's third door: on to the work block for one more lift,
   * rather than only "start" or "recover your own way" (user 2026-09-29,
   * "jouduin palautumiseen ilman että halusin"). Reuses insertExerciseAfter,
   * which the reducer already had — nothing dispatched it (#bugs 2026-09-29).
   */
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  /**
   * Where the sheet was opened from. The cooldown intro adds after the last
   * lift and goes to it; the exercise intro ("Seuraavaksi") adds right after
   * the lift on screen and stays — one more lift, without swapping this one
   * (#bugs 2026-10-01, "saa + liikkeen ilman että vaihdan tätä liikettä").
   * `anchor` is the lift the new one follows; `intro` the intro it came from,
   * which differ inside a superset (the intro names the first lift).
   */
  const [addExerciseAfterSlot, setAddExerciseAfterSlot] = useState<{ anchor: string; intro: string } | null>(null);
  /**
   * Said under the intro's buttons once the lift is in: the sheet closes on
   * it. Per intro, and every lift added from it — the note named only the
   * last one, and a second add landed before the first (#bugs 2026-10-02).
   */
  const [walkAdded, setWalkAdded] = useState<Record<string, WalkAddedLifts>>({});
  /**
   * The walk-up's scroll area and everything in it above the contents list,
   * measured: what is left between them is the room the list may take
   * (#bugs 2026-10-06, "jos mahtuu … koko ohjelman sisältö luettavissa").
   */
  const [walkViewportHeight, setWalkViewportHeight] = useState(0);
  const [walkTopHeight, setWalkTopHeight] = useState(0);
  /** The slots that existed before a walk-up add, so the one it creates can be found. */
  const walkInsertRef = useRef<{ introSlotId: string; known: Set<string> } | null>(null);
  /**
   * One insert per open of the sheet.
   *
   * `AddExerciseSheet`'s single-select guard checks `selectedIds`, which this
   * caller never passes (there is nothing to preselect — the lift just added
   * is not "in" the sheet's own list, it left the sheet). So a fast double
   * tap on a card fired `onSelectItem` twice before the close set in
   * `addMidWorkoutExercise` below reached a render, and the second call
   * inserted the same lift again. The ref catches what the prop cannot: it
   * locks on the first call and only unlocks when the sheet is opened again
   * (recheck round 2026-09-29, #bugs).
   */
  const addExerciseInFlightRef = useRef(false);
  useEffect(() => {
    if (addExerciseOpen) {
      addExerciseInFlightRef.current = false;
    }
  }, [addExerciseOpen]);
  // The rest screen's "fix the set you just logged" sheet. Declared here,
  // with the other overlays, because `frozen` below has to see it.
  /**
   * Which logged set the rest screen is correcting.
   *
   * A boolean was enough while a rest belonged to one lift. A superset rests
   * once per ROUND, and the rest step names only the lift that closed it — so
   * the other half of the block had no way back to its numbers anywhere in
   * the player (2026-09-16). The sheet offers each lift of the round its own
   * correction, and this says which one was asked for.
   *
   * `setIndex` is the set the sheet is CURRENTLY showing — it moves when the
   * reader taps another row of the sheet's own list. `justLoggedSetIndex`
   * never moves after the sheet opens: it is only read to decide whether the
   * title still says "the set you just logged" or has to name a number
   * (#bugs 2026-09-29, "näkyis kaikki tehdyt sarjat" — the sheet used to open
   * on one set with no way to reach any other).
   */
  const [restEdit, setRestEdit] = useState<
    { slotId: string; setIndex: number; justLoggedSetIndex: number } | null
  >(null);
  const restEditOpen = restEdit !== null;
  /** The lift the set being corrected was logged as (lib/liftSegments). */
  const restEditLift = (() => {
    const exercise = restEdit ? exerciseBySlot.get(restEdit.slotId) : undefined;
    const set = exercise && restEdit ? findSetByIndex(exercise, restEdit.setIndex) : null;
    return exercise ? (set ? liftOfSet(exercise, set) : exercise) : null;
  })();
  /** Every set already logged for that lift — the sheet's own row list. */
  const restEditSets = restEdit ? loggedSetsOf(exerciseBySlot.get(restEdit.slotId)) : [];
  const [swapQuery, setSwapQuery] = useState('');
  /**
   * The swap sheet's body-part chip, as the reader picked it — null until
   * they do, and then the lift's own body part applies (`swapBodyPart`
   * below). The list opens on the lifts nearest the one being swapped
   * ("filtteröinti siihen liikkeeseen perustuva eli lähin sitä mitä haluu
   * tehdä", #bugs 2026-09-29): a bench press swap used to open on squats and
   * deadlifts, the most popular lifts overall, behind a "browse all" link
   * that was the only way to the chips (device, 2026-09-30). Reset to null
   * wherever `swapQuery` is, so every opening starts from the lift again.
   */
  const [swapBodyPartFilter, setSwapBodyPartFilter] = useState<BodyPartFilter | null>(null);
  /**
   * The sheet's other two filter groups. The swap sheet is the add sheet now
   * (#bugs 2026-10-06), so it filters the same three ways; these two open on
   * "all", reset with the rest, and narrow the candidates the swap already
   * ordered rather than re-ordering them.
   */
  /** The reader's type chip; null means the lift's own (effectiveSwapCategory). */
  const [swapCategoryPick, setSwapCategoryPick] = useState<ExercisePickerFilters['category'] | null>(null);
  const [swapEquipment, setSwapEquipment] = useState<SheetEquipmentOption>('all');
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  /** The lift whose final set was just logged — a one-second check-splash
      before the next exercise's walk-up screen. Null = no splash showing. */
  // The permission moment (rule 05): at the first rest, in context, once.
  // The rest step's index is the rest's identity — a new rest is a new step.
  // Paused or not does not matter here: a paused rest is still that rest.
  const restAsk = useRestAlertPermissionMoment({
    restRunning: mode === 'player' && step.type === 'rest',
    restKey: step.type === 'rest' ? stepIndex : null,
    asked: restAlerts.asked,
    alertsWanted: restAlerts.alerts,
    // The two sheets that do not hold the clock: a timed bout can run out
    // into its recovery under either, and the ask, opened as one closes, was
    // refused on iOS and held every clock after it (iOS hunt 2026-10-17,
    // S4-4). It waits for a later rest instead.
    blocked: runSheetOpen || setPanelsOpen,
    onAnswered: onRestAlertsAnswered,
    // The sheet freezes the step (below), but it closes BEFORE the system
    // dialog answers, so the step effect re-armed the rest while the answer
    // was still "not granted" and the OS got nothing — the very rest the
    // reader had just allowed never rang (native audit, 2026-09-21). The rest
    // goes to the OS again once the grant is in, and again when the reader
    // comes back having allowed exact alarms. Not a rest that has ended or
    // one the step effect has let go (paused, frozen): the step effect arms
    // that one when it runs again.
    onGranted: () => {
      const endsAt = endsAtRef.current;
      const shown = stepRef.current;
      if (shown?.type === 'rest' && endsAt !== null && endsAt > Date.now()) {
        // The same card the step effect armed: an interval's recovery is the
        // buttonless session card, not a rest with "+30 s" and "Skip".
        void syncRestNotification(
          endsAt,
          getGuidedNextName(steps, stepIndex, language) ?? '',
          shown.recoveryKind !== undefined,
        );
      }
    },
  });
  // The permission sheet freezes the step like every other sheet: a short
  // rest expiring behind the ask would walk the reader onto a set screen
  // they did not come back for (PR review).
  // `restEditOpen` joined when the rest started running out into the set
  // (review, PR #88): its edits commit on Save only, and a rest that expired
  // behind the sheet would have unmounted a correction half-made.
  // `runSheetOpen` is NOT here, on purpose: the contents sheet is read
  // during a rest, and the rest keeps counting under it and still ends with
  // its cue and its OS alert (#bugs 2026-10-06; lib/guidedClockHold).
  const frozen = guidedClockHeld({
    paused,
    howToOpen: howtoOpen,
    exitOpen,
    pauseSheetOpen,
    swapOpen,
    addExerciseOpen,
    restEditOpen,
    runSheetOpen,
    ownBlockActive: ownBlock !== null,
    restAlertsAskOpen: restAsk.sheetOpen,
    confirmingEnd,
    confirmingSkipExercise,
  });
  // The step clock also holds while a workout tour is up. Kept out of
  // `frozen`, which withdraws the tour's report: holding the report for the
  // tour would close the tour.
  const clockHeld = frozen || tourRunning;
  // Seconds since the reader said they would do it themselves. Derived from
  // the session clock's tick so it needs no timer of its own.
  const ownElapsedSeconds = ownBlock ? Math.max(0, Math.floor((clockNowMs - ownBlock.startedAt) / 1000)) : 0;

  // The speaker button drives the persistent "Cue sounds" preference, so the
  // in-workout shortcut and the settings toggle stay one source of truth.
  const muted = !soundCuesEnabled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const cue = useCallback((kind: CueSound) => {
    // Haptics always fire — the speaker toggle silences audio only, and a buzz
    // is the discreet channel anyway.
    if (kind === 'tick') {
      void haptics.select();
    } else if (kind === 'go' || kind === 'rest') {
      void haptics.impactMedium();
    } else {
      void haptics.success();
    }
    if (mutedRef.current) {
      return;
    }
    sound[kind]();
  }, []);

  /** Set when the actions menu opened over a pause the reader had chosen. */
  const menuHeldPauseRef = useRef(false);
  /**
   * Out of the pause, on the screen and on the session clock together.
   *
   * The set screen's Pause stops both, and they came back apart: closing the
   * actions sheet by tapping outside it cleared the screen's pause and kept
   * the session's, so the screen offered "Pause" while the clock stood still
   * (live-session audit, 2026-09-20). Every way out of the pause comes through
   * here. The session's resume does nothing when nothing is paused, so no
   * caller asks first — the asking read the session from the last render,
   * and the resume that followed put that session back over the set logged
   * in the same tap.
   */
  const unpause = useCallback(() => {
    setPaused(false);
    workout.resumeWorkout();
  }, [workout]);
  /**
   * Into the pause: the screen's and the session clock's together, from every
   * timed step. Only the set screen used to stop the session clock, so a
   * Pause on a rest, a drill or an interval bout froze the ring while the
   * header clock and the saved duration ran on (hunt 2026-10-09).
   */
  const pause = useCallback(() => {
    menuHeldPauseRef.current = false;
    setPaused(true);
    workout.pauseWorkout();
  }, [workout]);
  /**
   * The actions menu pauses while it is open, as its title says, and closing
   * it gives back the state it found: a pause the reader chose stays chosen
   * (hunt 11 — dots, close, and the workout was running again).
   */
  const openActionsMenu = () => {
    const found = paused;
    if (!found) {
      pause();
    }
    menuHeldPauseRef.current = found;
    setPauseSheetOpen(true);
  };
  const closeActionsMenu = () => {
    if (!menuHeldPauseRef.current) {
      unpause();
    }
    menuHeldPauseRef.current = false;
  };
  /**
   * Moving on from the menu (the contents sheet, doing a block your own way,
   * skipping the exercise, adding a set) resumes the workout whatever the
   * menu found: the reader has gone on to something, which is not the pause
   * they chose. Only closing the menu gives the earlier pause back.
   */
  const moveOnFromMenu = () => {
    menuHeldPauseRef.current = false;
    unpause();
  };

  const goTo = useCallback(
    (index: number, openingMs?: number) => {
      const clamped = Math.min(Math.max(0, index), steps.length - 1);
      expiredRestRef.current = null;
      // Moving on is resuming. The set screen's pause stops the session clock,
      // and only its own button started it again: pause, then Log, Swap or
      // Skip, and the clock stayed frozen for the rest of the workout.
      unpause();
      setPauseSheetOpen(false);
      setHowtoOpen(false);
      const target = steps[clamped];
      // The time the step opens with, when the caller knows better than its
      // nominal length: what a reopened rest has left, or a rest extended
      // from the lock screen after it ran out.
      remainingRef.current = openingMs ?? stepSeconds(target) * 1000;
      setRemainingMs(remainingRef.current);
      firedRef.current = false;
      lastBeepSecondRef.current = null;
      setStepIndex(clamped);
      setSetPanelsOpen(false);
      // Index for old readers, anchor for the resume: the index goes stale
      // the moment the plan is rebuilt, the anchor does not.
      workout.setGuidedStep(clamped, getGuidedStepAnchor(target));
      if (target.type === 'drill') {
        cue('go');
      } else if (target.type === 'finish') {
        cue('finish');
      }
    },
    [steps, workout, cue, unpause],
  );

  /**
   * A running rest's end time goes into the resume anchor, so a screen that
   * is torn down mid-rest (Android killing the app) finds the time left and
   * not a fresh full rest. The goTo that leaves the rest writes the plain
   * anchor again.
   */
  const persistRestDeadline = (endsAtMs: number | null) => {
    if (step.type === 'rest') {
      workout.setGuidedStep(stepIndex, withGuidedRestDeadline(getGuidedStepAnchor(step), endsAtMs));
    }
  };
  /** A frozen rest has no deadline, but it keeps what it had left. */
  const persistRestLeft = (leftMs: number) => {
    if (step.type === 'rest') {
      workout.setGuidedStep(stepIndex, withGuidedRestPaused(getGuidedStepAnchor(step), leftMs));
    }
  };

  /** ±15s / +10s: shift the leftover time, the deadline and any pending alert. */
  const adjustRemaining = (deltaMs: number, floorMs = 0) => {
    // From the deadline when one is running: `remainingRef` is only as fresh as
    // the last tick, and a lock-screen "+30 s" lands before the app has had one
    // since it was backgrounded, so it would add to the time left at lock.
    // Never from before now (guidedAdjustedMs).
    const next = guidedAdjustedMs({
      endsAtMs: endsAtRef.current,
      remainingMs: remainingRef.current,
      nowMs: Date.now(),
      deltaMs,
      floorMs,
    });
    remainingRef.current = next;
    if (endsAtRef.current !== null) {
      endsAtRef.current = Date.now() + next;
      persistRestDeadline(endsAtRef.current);
      if (step.type === 'rest') {
        void syncRestNotification(
          endsAtRef.current,
          getGuidedNextName(steps, stepIndex, language) ?? '',
          step.recoveryKind !== undefined,
        );
      }
    } else if (mode === 'player') {
      // Frozen — paused, or a sheet over the rest: the leftover is what the
      // anchor holds, so a change to it is stored too. A kill while paused
      // reopened with the time from before the ±15 s / lock-screen +30 s.
      persistRestLeft(next);
    }
    setRemainingMs(next);
  };

  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const adjustRemainingRef = useRef(adjustRemaining);
  adjustRemainingRef.current = adjustRemaining;
  const advance = useCallback(() => {
    goToRef.current(Math.min(stepIndex + 1, steps.length - 1));
  }, [stepIndex, steps.length]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  /**
   * What a running-out timer does. Everything but an interval just advances;
   * an interval's work bout also LOGS itself, because the whole point of the
   * interval screen is that the reader never taps it — assigned below, where
   * confirmSet exists.
   */
  const expireRef = useRef<() => void>(() => advanceRef.current());

  useEffect(() => {
    if (mode !== 'player' || clockHeld) {
      // Pausing freezes the leftover time; the deadline is re-derived on resume.
      // The leftover goes into the anchor, so a screen torn down while paused
      // reopens with it and not with a full rest.
      endsAtRef.current = null;
      if (mode === 'player') {
        persistRestLeft(remainingRef.current);
      } else {
        persistRestDeadline(null);
      }
      return;
    }
    // Not `position` any more: walking to another machine is not time-bound,
    // so that screen has no clock to run (user 2026-09-04).
    const timed =
      step.type === 'ready' ||
      step.type === 'drill' ||
      step.type === 'rest' ||
      (step.type === 'splash' && !splashCarriesChoice(step)) ||
      (step.type === 'set' && step.interval !== undefined);
    if (!timed) {
      endsAtRef.current = null;
      return;
    }
    // A rest armed with nothing left ended while the screen was gone.
    const openedWithMs = remainingRef.current;
    endsAtRef.current = Date.now() + Math.max(0, remainingRef.current);
    persistRestDeadline(endsAtRef.current);

    // A rest is the one wait long enough to put the phone down for, so its
    // deadline also goes to the OS — that alert is what reaches the user when
    // Android has suspended us. Not once it has already passed, though: a
    // deadline in the past is an alert that fires the moment it is set.
    if (step.type === 'rest' && endsAtRef.current > Date.now()) {
      void syncRestNotification(
        endsAtRef.current,
        getGuidedNextName(steps, stepIndex, language) ?? '',
        step.recoveryKind !== undefined,
      );
    }

    const settle = () => {
      const endsAt = endsAtRef.current;
      if (endsAt === null) {
        return;
      }
      const previous = remainingRef.current;
      const next = endsAt - Date.now();
      remainingRef.current = next;

      // 3·2·1 ticks on drills/rests/ready.
      if (step.type !== 'splash') {
        const previousSecond = Math.ceil(previous / 1000);
        const nextSecond = Math.ceil(Math.max(next, 0) / 1000);
        if (nextSecond < previousSecond && nextSecond <= 3 && nextSecond >= 1 && lastBeepSecondRef.current !== nextSecond) {
          lastBeepSecondRef.current = nextSecond;
          cue('tick');
        }
      }

      if (next <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          // Rest running out is the one transition the user may not be looking
          // at — but a cue fired minutes late (we were backgrounded when it
          // expired) is noise, so only sound it if we caught the moment.
          if (step.type === 'rest' && guidedRestCueDue(openedWithMs, next)) {
            // An interval's recovery ending means "go" — the next thing is a
            // work bout, not a set you walk up to in your own time.
            cue(step.recoveryKind ? 'go' : 'rest');
          }
          // A rest runs out into the set like every other timed step (user
          // 2026-09-09, from the gym: "sarja 2 pitäis alkaa nyt itsestään").
          // It held at zero and said READY until then, on the theory that a
          // set screen nobody asked for was worse than a wait that overran;
          // the reader watching the ring reach zero disagreed.
          clearInterval(interval);
          expireRef.current();
          if (step.type === 'rest' && !step.recoveryKind) {
            // After the move: every goTo clears it, this one included.
            expiredRestRef.current = stepIndex;
          }
        }
        return;
      }
      setRemainingMs(next);
    };

    const interval = setInterval(settle, 100);
    // Coming back from background: reconcile with the clock immediately rather
    // than waiting for the next tick.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        settle();
      }
    });

    return () => {
      clearInterval(interval);
      appStateSub.remove();
      // Leaving the rest — by advancing, skipping or pausing — retires its alert.
      void syncRestNotification(null, null);
    };
  }, [mode, clockHeld, stepIndex, step.type, cue, steps, syncRestNotification]);

  /**
   * Pause clears every notification of the session (the shade is swept while
   * its status is not 'active'), the lock-screen card with them, and nothing
   * put it back: from a set screen the card stayed gone until the next timed
   * step. A resume posts it once. Not over a rest — that effect above posts the
   * rest's own card with its new deadline.
   */
  const sessionStatus = session?.status ?? null;
  const lastSessionStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const was = lastSessionStatusRef.current;
    lastSessionStatusRef.current = sessionStatus;
    if (was === 'paused' && sessionStatus === 'active' && mode === 'player' && step.type !== 'rest') {
      void syncRestNotification(null, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  /* ── hardware back: exit sheet in player, plain leave on entry ── */
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // The player is locked while Finish saves (the overlay at the end of the render); the sheet
      // this opens holds a discard, which is not for the middle of a save either.
      if (isSavingWorkout) {
        return true;
      }
      // A tour callout over the player takes the key (it skips the tour).
      if (consumeBackForTour()) {
        return true;
      }
      if (mode === 'player') {
        setExitOpen(true);
        return true;
      }
      onLeave();
      return true;
    });
    return () => handler.remove();
  }, [mode, onLeave, isSavingWorkout]);

  if (!session) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }

  /**
   * "4 × 8" for one lift of the contents list: what is still asked of it, not
   * what was lifted. Shared by the contents sheet and the walk-up's list, so
   * the two say the same thing about the same lift.
   */
  const runPlanLine = (slotId: string | null): string => {
    const lift = slotId ? exerciseBySlot.get(slotId) : undefined;
    // Read off the next set still to do (planSetOf): a swap rewrites only
    // the sets ahead.
    const planSet = lift ? planSetOf(lift.sets) : undefined;
    if (!lift || !planSet) {
      return '';
    }
    // The target where it falls outside the programme's range (lowered, or a
    // bodyweight lift raised past the top) — the plan says what the dial
    // will open on.
    const bounds = planRepsBounds(planSet, lift.trackingMode);
    return formatSetScheme(lift.sets.length, bounds.min, bounds.max, lift.trackingMode);
  };

  /**
   * The walk-up's slice of the contents: as many rows as the room under its
   * cards holds, the lift being walked up to first (lib/guidedRunPreview).
   * Null — no list at all — until both heights are measured, and whenever
   * not one row fits; the buttons below never give way to it.
   */
  const walkRunItems = step.type === 'position' ? buildGuidedRunSheet(stepPlan, stepIndex) : [];
  // The last lift: one line saying so, in place of its row and a "+2 muuta"
  // that counted the stretches as lifts (lib/guidedRunPreview isLastWorkItem).
  const walkLastLift = isLastWorkItem(walkRunItems);
  const walkRunFit =
    step.type === 'position' && walkViewportHeight > 0 && walkTopHeight > 0
      ? fitRunPreview({
          count: walkLastLift ? 1 : walkRunItems.length,
          currentIndex: walkLastLift ? 0 : walkRunItems.findIndex((item) => item.status === 'current'),
          availableHeight: walkViewportHeight - WALK_RUN_CHROME - walkTopHeight,
          headHeight: WALK_RUN_HEAD,
          rowHeight: WALK_RUN_ROW,
        })
      : null;
  // "+N muuta" counts the lifts left out, not the stretches (lib/guidedRunPreview).
  const walkHiddenLifts = walkRunFit && !walkLastLift ? hiddenWorkCount(walkRunItems, walkRunFit.end) : 0;

  const completedSetCount = exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.status === 'completed').length,
    0,
  );

  /* ── actions ── */
  const startAt = (index: number) => {
    setMode('player');
    // A rest the session was left on has what it had left, as on the straight-in
    // reopen; every other step starts at its own length.
    const target = steps[Math.min(Math.max(0, index), steps.length - 1)];
    const left = target ? guidedRestOpeningMs(session.ui.guidedResumeAnchor, target, Date.now()) : null;
    goTo(index, left ?? undefined);
  };

  // Same resolver the opening position came from, so the card at the top, the
  // button at the bottom and the step this screen mounted on cannot disagree.
  const opening = resolveGuidedOpening({
    steps,
    storedIndex: session.ui.guidedStepIndex ?? null,
    anchor: session.ui.guidedResumeAnchor ?? null,
    isSetCompleted,
    autoResume: false,
  });
  const resumeIndex = opening.resumeIndex;
  const showResume = opening.primaryAction === 'resume';

  const confirmSet = (slotId: string, setIndex: number, reps: number, loadKg: number | null) => {
    // A logged set is corrected from the rest screen, not logged again: the
    // store refuses it, and writing the draft first only made the screen look
    // as if the new numbers had been kept.
    if (isSetCompleted(slotId, setIndex)) {
      advance();
      return;
    }
    const draft = {
      repsText: String(reps),
      loadText: loadKg === null ? '' : removeTrailingZeros(loadKg),
    };
    // Asked before the cue, with the same rule the store applies: the store
    // refuses silently, and "done" and the next step after a refused set told
    // the reader it was kept when it was gone.
    const exerciseOfSet = session?.exercises.find((exercise) => exercise.slotId === slotId);
    const target = exerciseOfSet?.sets.find((set) => set.setIndex === setIndex);
    if (
      !exerciseOfSet ||
      !target ||
      !canCompleteSet(
        exerciseOfSet,
        { ...target, draftRepsText: draft.repsText, draftLoadText: draft.loadText },
        unitPreference,
      )
    ) {
      void haptics.error();
      return;
    }
    workout.updateSetDraft(slotId, setIndex, draft);
    workout.completeSet(slotId, setIndex, unitPreference);
    cue('done');
    // The beat the finished lift is owed (user 2026-08-23) is on the walk-up
    // screen itself now, as a green card the reader can look at for as long as
    // they like — rather than a splash that covered that screen for three and
    // a half seconds and then took itself away.
    advance();
  };

  // The interval work bout logs the seconds its name promised and runs on.
  // Unloaded on purpose: a treadmill speed is not a weight, and asking for
  // one mid-sprint is asking for nothing.
  expireRef.current = () => {
    const current = steps[stepIndex];
    if (current?.type === 'set' && current.interval) {
      confirmSet(current.slotId, current.setIndex, current.interval.workSeconds, null);
      return;
    }
    advance();
  };

  const skipCurrent = () => {
    goTo(getGuidedSkipTargetIndex(steps, stepIndex));
  };

  /**
   * The whole warmup or cooldown, not one drill of it. Five drills is five taps
   * to the bar, and the reader who wants to warm up their own way wants out of
   * the block rather than out of the session.
   */
  const skipPhase = () => {
    goTo(getGuidedPhaseSkipTargetIndex(steps, stepIndex));
  };
  const skippablePhase =
    'phase' in step && (step.phase === 'warmup' || step.phase === 'cooldown') ? step.phase : null;

  /**
   * Leaving the free timer.
   *
   * The duration is recorded here rather than on every tick: a block abandoned
   * by pressing "do the guided drills instead" is not a block that took four
   * minutes, and the "last time you took" line has to be a time somebody
   * actually spent.
   */
  const finishOwnBlock = (completed: boolean) => {
    const current = ownBlock;
    setOwnBlock(null);
    if (!current) {
      return;
    }
    if (completed) {
      onRecordOwnBlock?.(current.phase, Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)));
      skipPhase();
    }
  };

  /* ── exercise-level actions ──────────────────────────────────────────────
     Swap, skip and add-set used to live only in the list logger, so the only
     way to do any of them was to leave the guided flow entirely — and all
     three are things a gym makes you do (rack taken, shoulder complaining,
     one more set in you). They hang off the pause sheet because that is
     already the "I need to do something else" surface. */
  // Rest counts too. A rest only ever falls BETWEEN sets of one exercise, so
  // the lift it belongs to is unambiguous — and resting is exactly when you
  // notice somebody has taken the machine you were going back to.
  const actionSlotId =
    step.type === 'set' || step.type === 'position' || step.type === 'rest' ? step.slotId : null;
  const actionExercise = actionSlotId ? exerciseBySlot.get(actionSlotId) ?? null : null;
  /**
   * What the panels above the set have to show for this lift.
   *
   * Resolved here rather than inside the panel because the library lookup is
   * the player's own (a warm-up drill borrows the photo of the exercise that
   * shows the same position), and because slot history is the workout store's,
   * not a component's.
   */
  /**
   * Last session's sets for one slot, however this screen happens to be asking.
   *
   * This was folded into `setPanelSource`, which opens with
   * `if (step.type !== 'set') return null` — so the two screens that ask about
   * a lift while standing on a different kind of step got null every time. The
   * rest screen's "vs last session" pill and the walk-up screen's LAST card
   * could not render for anybody, ever, and both read on a device as "this
   * lift has no history yet" (review, PR #57). A lift's history is a fact
   * about the slot, not about which step is on screen.
   */
  const resolveSlotHistory = useCallback(
    (slotId: string, exerciseName: string): LastTimeView | null => {
      const instance = exerciseBySlot.get(slotId) ?? null;
      /*
       * Through the same resolver the prefill uses, with the same inputs.
       *
       * This read `slotHistory[slotId]` and stopped there, while the prefill
       * fell through to the slot's unscoped key and then to a name lookup — so
       * the first time a lift came round in a new slot the table said "first
       * time on this exercise" directly above a weight badged "LAST TIME ·
       * 27.8." (#bugs 2026-08-29). Same question, one reader.
       */
      const resolved = resolveLastTimeEntry({
        slotHistory: workout.history.slotHistory,
        slotId,
        templateSlotId: instance?.templateSlotId ?? null,
        exerciseName,
        requireLoaded: instance ? !isUnloadedTrackingMode(instance.trackingMode) : false,
        repWindow: instance ? resolveInstanceBorrowRepWindow(instance) : null,
        // As the prefill reads it: a session dated ahead of now is not the newest.
        nowMs: Date.now(),
        // And under the dose it reads: a hold's seconds filed in this slot are
        // not "last time" above a dial opened on bodyweight reps (P7).
        dose: instance ? resolveInstanceDose(instance) : null,
      });
      const found = resolved?.entry ?? null;
      if (!found) {
        return null;
      }
      // The working sets, as the prefill reads them (lib/warmupSets): the
      // panel listing a warm-up as set 1 above a dial that opens on the work
      // was two answers to one question (review, 2026-10-05).
      // Against the programme's count, not the live one: a set added
      // mid-session must not change which of last time's sets were warm-ups.
      const last = toWorkingHistoryEntry(found, instance ? programmeSetCount(instance.sets) : found.sets.length);
      const heaviest = Math.max(...last.sets.map((set) => set.loadKg));
      return {
        performedAt: last.performedAt,
        // Said out loud rather than passed off as this slot's own record —
        // it is a real number, lifted on a different day.
        borrowed: resolved?.borrowed ?? false,
        warmups: last.warmups,
        sets: last.sets.map((set) => ({
          setIndex: set.setIndex + 1,
          loadKg: set.loadKg,
          reps: set.reps,
          // Marked only when it beats the others — every set at the same
          // weight would otherwise light the whole panel up.
          isRecord: heaviest > 0 && set.loadKg === heaviest && last.sets.some((other) => other.loadKg < heaviest),
        })),
      };
    },
    [exerciseBySlot, workout.history.slotHistory],
  );

  const setPanelSource = useMemo(() => {
    if (step.type !== 'set') {
      return null;
    }
    const { exerciseName: name, slotId } = step;
    const lookupName = getDrillLibraryName(name) ?? name;
    const index = findGuidedLibraryIndex(lookupName, exerciseLibrary.map((item) => item.name));
    const match = index === null ? null : exerciseLibrary[index];

    return {
      history: resolveSlotHistory(slotId, name),
      instructions: getExerciseInstructions(match?.name, match?.instructions, language),
      imageKey: match?.imageKey ?? null,
      initials: exerciseInitials(exerciseNameLabel(language, name)),
    };
  }, [exerciseLibrary, language, resolveSlotHistory, step]);

  /**
   * Every lift in today's session, the one being swapped included. Swapping
   * to one of them is doing it twice and calling it a change — Home and the
   * programme day have left them out since 2026-08-26; this sheet offered
   * even the lift it was replacing (emulator, 2026-09-27).
   */
  const swapSessionLifts = useMemo(() => exercises.map((exercise) => exercise.exerciseName), [exercises]);

  /**
   * The programme's own alternatives, which are better answers than a search:
   * the same cards, in the same order, as Home and the programme day
   * (buildSwapAlternatives) — one row per name the reader sees, variations
   * first, nothing cut.
   */
  const swapSuggestions = useMemo(
    () =>
      actionExercise
        ? buildSwapAlternatives({
            currentName: actionExercise.exerciseName,
            substitutionGroup: actionExercise.substitutionGroup,
            preferences: tailoringPreferences,
            sessionLifts: swapSessionLifts,
            query: swapQuery,
            language,
          })
        : [],
    [actionExercise, language, swapQuery, swapSessionLifts, tailoringPreferences],
  );

  /**
   * The suggestions with their library rows, for the picture and the
   * "rinta · levytanko · voima" line. A programme alternative is a catalog
   * name, not a library row, so it is looked up the way the walk-up card looks
   * up its own lift; a name the library does not hold keeps its row, without
   * the picture.
   */
  const swapSuggestionRows = useMemo(() => {
    const libraryNames = exerciseLibrary.map((item) => item.name);
    return swapSuggestions.map((name) => {
      const index = findGuidedLibraryIndex(getDrillLibraryName(name) ?? name, libraryNames);
      return { name, item: index === null ? null : exerciseLibrary[index] };
    });
  }, [exerciseLibrary, swapSuggestions]);

  /** Named under the lists, so a lift the reader typed is not silently missing. */
  const swapSessionHits = useMemo(
    () =>
      actionExercise
        ? sessionLiftsMatchingQuery(
            exercises.map((exercise) => exercise.exerciseName),
            actionExercise.exerciseName,
            swapQuery,
            language,
          )
        : [],
    [actionExercise, exercises, language, swapQuery],
  );

  /**
   * The current exercise's own library row, read the same way the walk-up
   * card reads it (`setPanelSource` above) — a name may need `getDrillLibraryName`
   * first to resolve to a library entry at all.
   */
  const swapCurrentLibraryItem = useMemo(() => {
    if (!actionExercise) {
      return null;
    }
    const lookupName = getDrillLibraryName(actionExercise.exerciseName) ?? actionExercise.exerciseName;
    const index = findGuidedLibraryIndex(lookupName, exerciseLibrary.map((item) => item.name));
    return index === null ? null : exerciseLibrary[index];
  }, [actionExercise, exerciseLibrary]);

  /** Which chip the swap sheet opens on — see swapBrowsePrefilter. */
  const swapBrowsePrefilter = useMemo(
    () => resolveSwapBrowsePrefilter(swapCurrentLibraryItem),
    [swapCurrentLibraryItem],
  );
  /**
   * The chip in force: the reader's, or else the lift's own body part — and
   * "All" while they type with no chip of their own, so a search covers the
   * whole library (effectiveSwapBodyPart).
   */
  const swapBodyPart: BodyPartFilter = effectiveSwapBodyPart(swapBodyPartFilter, swapBrowsePrefilter, swapQuery);
  /** The three groups the sheet draws, as the swap list applies them. */
  const swapFilters = useMemo<ExercisePickerFilters>(
    () => ({
      category: effectiveSwapCategory(swapCategoryPick, swapCurrentLibraryItem, swapQuery),
      bodyPart: swapBodyPart,
      equipment: swapEquipment,
    }),
    [swapBodyPart, swapCategoryPick, swapCurrentLibraryItem, swapEquipment, swapQuery],
  );

  /**
   * Everything else the library holds, nearest the lift first — the same
   * list Home's swap draws (lib/swapPickerLists).
   */
  const swapLibrary = useMemo(() => {
    // The session's lifts and the Suggested cards above: a library row that
    // reads the same as one of them is the same row twice (PR review).
    return buildSwapPickerLibrary(exerciseLibrary, {
      query: swapQuery,
      filters: swapFilters,
      language,
      currentName: actionExercise?.exerciseName ?? null,
      currentItem: swapCurrentLibraryItem,
      excludeNames: [...exercises.map((exercise) => exercise.exerciseName), ...swapSuggestions],
      popularOrder: getPopularExerciseLibraryOrder(exerciseLibrary),
    });
  }, [
    actionExercise,
    exerciseLibrary,
    exercises,
    language,
    swapCurrentLibraryItem,
    swapFilters,
    swapSuggestions,
    swapQuery,
  ]);

  /** The programme's alternatives as the sheet's first cards, under its chips (narrowSwapAlternatives). */
  const swapFeaturedEntries = useMemo<ExercisePickerEntry[]>(
    () =>
      // Only a type chip the reader moved reaches the cards (useSwapPickerLists).
      narrowSwapAlternatives(
        swapSuggestionRows,
        swapSuggestionFilters(swapFilters, { category: swapCategoryPick, bodyPart: swapBodyPartFilter }),
      ).map(({ name, item }) => ({
        key: `suggested-${name}`,
        name,
        item,
      })),
    [swapBodyPartFilter, swapCategoryPick, swapFilters, swapSuggestionRows],
  );
  const swapLibraryEntries = useMemo<ExercisePickerEntry[]>(
    () => swapLibrary.map((item) => ({ key: item.id, name: item.name, item })),
    [swapLibrary],
  );

  const applySwap = (exerciseName: string) => {
    if (!actionExercise) {
      return;
    }
    workout.swapExercise(
      actionExercise.slotId,
      exerciseName,
      actionExercise.substitutionGroup,
      unitPreference,
    );
    setSwapOpen(false);
    setSwapQuery('');
    setSwapBodyPartFilter(null);
    setSwapCategoryPick(null);
    setSwapEquipment('all');
    unpause();
  };

  // Skipping an exercise removes its steps from the list, so the index we are
  // sitting on stops meaning what it meant. Re-resolve once the rebuilt steps
  // arrive rather than guessing an offset.
  // Where to land once the rebuilt steps arrive. Removing an exercise deletes
  // the block it occupied, so whatever followed it slides down into the index
  // that block STARTED at — which makes that index the next exercise, and the
  // cooldown or the finish when the skipped one was last.
  //
  // This used to ask resolveGuidedResumeIndex instead, and that resolver
  // answers 0 when no set has been completed yet. Skipping the very first
  // exercise before logging anything — the rack is taken, so you move on —
  // threw the user back to the start of the warm-up.
  const resyncTargetRef = useRef<number | null>(null);
  const isSetCompletedRef = useRef(isSetCompleted);
  isSetCompletedRef.current = isSetCompleted;
  useEffect(() => {
    const target = resyncTargetRef.current;
    if (target === null) {
      return;
    }
    resyncTargetRef.current = null;
    // Past what is already logged: inside a superset the block's start is the
    // other lift's round, done (see rollPastLoggedWork).
    goToRef.current(rollPastLoggedWork(steps, Math.min(target, steps.length - 1), isSetCompletedRef.current));
  }, [steps]);

  const handleSkipExercise = () => {
    if (!actionSlotId) {
      return;
    }
    const blockStart = steps.findIndex(
      (candidate) =>
        (candidate.type === 'position' || candidate.type === 'set') &&
        candidate.slotId === actionSlotId,
    );
    resyncTargetRef.current = blockStart >= 0 ? blockStart : stepIndex;
    workout.skipExercise(actionSlotId);
    setPauseSheetOpen(false);
    moveOnFromMenu();
  };

  const handleAddSet = () => {
    if (!actionSlotId) {
      return;
    }
    workout.addSet(actionSlotId);
    setPauseSheetOpen(false);
    moveOnFromMenu();
  };

  /**
   * Where to land once a mid-workout add lands its new exercise.
   *
   * `insertExerciseAfter` mints the new slot id itself, so the caller cannot
   * name a target step the way `handleSkipExercise` above does. What is known
   * before the dispatch is every slot id that already exists; once the
   * rebuilt steps arrive, the one slot id that was not in that set is the
   * lift just added.
   */
  const pendingInsertKnownSlotsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const known = pendingInsertKnownSlotsRef.current;
    if (!known) {
      return;
    }
    const insertedSlotId = exercises.map((exercise) => exercise.slotId).find((slotId) => !known.has(slotId));
    if (!insertedSlotId) {
      // Not landed yet — the effect above this one may fire on the same
      // render as the dispatch, before the provider's own update arrives.
      return;
    }
    pendingInsertKnownSlotsRef.current = null;
    const target = steps.findIndex(
      (candidate) =>
        (candidate.type === 'position' || candidate.type === 'set') && candidate.slotId === insertedSlotId,
    );
    if (target >= 0) {
      goToRef.current(target);
    }
  }, [exercises, steps]);

  // The slot a walk-up add created, found the way the cooldown add finds its
  // own: the one slot that was not there before. The next add from the same
  // intro goes behind it (resolveWalkAddAnchor).
  useEffect(() => {
    const pending = walkInsertRef.current;
    if (!pending) {
      return;
    }
    const insertedSlotId = exercises.map((exercise) => exercise.slotId).find((slotId) => !pending.known.has(slotId));
    if (!insertedSlotId) {
      return;
    }
    walkInsertRef.current = null;
    setWalkAdded((current) => recordWalkAddedSlot(current, pending.introSlotId, insertedSlotId));
  }, [exercises]);

  /**
   * "Lisää liike" on the cooldown intro: the escape the reader asked for
   * (2026-09-29) when there was one more lift in them and the app had already
   * moved on to recovery. Added after the last exercise in today's session,
   * same as a swap-to-any-library-lift resolves what it does not know:
   * `getExerciseTemplateDefaults` for sets and reps (the day view's own
   * picker uses it), `getCatalogTrackingMode` for how it is logged. The
   * substitution group is the library id alone — nothing else is IN this
   * lift's group, so it offers no swap suggestions of its own, which is
   * right for a lift nobody planned.
   *
   * Guarded on `addExerciseInFlightRef` (declared above with `addExerciseOpen`):
   * `AddExerciseSheet` calls this straight from a card's `onPress`, and a fast
   * double tap fired it twice before `setAddExerciseOpen(false)` below had
   * rendered — the sheet's own single-select guard checks `selectedIds`, which
   * this call site has no id to pass (the lift just inserted has a slot id,
   * not a library id "selected" in the sheet's list). Two dispatches from one
   * open used to mean two lifts inserted (recheck round 2026-09-29, #bugs).
   *
   * A session with no main block — cooldown-only, `exercises` empty — has no
   * last exercise to add after either. `insertExerciseAfter` takes a null
   * anchor for exactly that: the reducer inserts at the front instead of
   * requiring a slot that does not exist (recheck round 2026-09-29). Without
   * it the link sat on the cooldown intro of a stretch-only session and did
   * nothing when tapped.
   */
  const addMidWorkoutExercise = (item: ExerciseLibraryItem) => {
    if (addExerciseInFlightRef.current) {
      return;
    }
    addExerciseInFlightRef.current = true;
    setAddExerciseOpen(false);
    const afterCurrent = addExerciseAfterSlot
      ? exercises.find((exercise) => exercise.slotId === addExerciseAfterSlot.anchor) ?? null
      : null;
    const anchor = afterCurrent ?? exercises[exercises.length - 1] ?? null;
    const defaults = getExerciseTemplateDefaults(item, restSecondsForAddedLift(anchor?.restSecondsMin, defaultRestSeconds));
    if (afterCurrent && addExerciseAfterSlot) {
      // Stays on this lift: no jump, and the intro says where it went.
      const introSlotId = addExerciseAfterSlot.intro;
      walkInsertRef.current = { introSlotId, known: new Set(exercises.map((exercise) => exercise.slotId)) };
      setWalkAdded((current) => {
        const entry = current[introSlotId] ?? { names: [], slotIds: [] };
        return { ...current, [introSlotId]: { ...entry, names: [...entry.names, exerciseNameLabel(language, item.name)] } };
      });
    } else {
      pendingInsertKnownSlotsRef.current = new Set(exercises.map((exercise) => exercise.slotId));
    }
    workout.insertExerciseAfter(anchor ? anchor.slotId : null, {
      exerciseName: item.name,
      trackingMode: getCatalogTrackingMode(item.name),
      sets: defaults.targetSets,
      repsMin: defaults.repMin,
      repsMax: defaults.repMax,
      restSecondsMin: defaults.restSeconds,
      restSecondsMax: defaults.restSeconds,
      substitutionGroup: item.id,
      libraryItemId: item.id,
    }, unitPreference);
  };

  const backOne = () => {
    const target = getGuidedBackTargetIndex(steps, stepIndex);
    const targetStep = steps[target];
    if (targetStep?.type === 'set' && isSetCompleted(targetStep.slotId, targetStep.setIndex)) {
      workout.undoSet(targetStep.slotId, targetStep.setIndex, unitPreference);
    }
    goTo(target);
  };

  /**
   * Confirming that the logged sets may be thrown away.
   *
   * The app's own dialog, not `Alert.alert`. The platform one is a grey box
   * with teal buttons dropped into the middle of a near-black screen — it reads
   * as another app's, on the one screen where the reader is being asked to
   * agree to losing work. The same question is asked with a themed dialog when
   * a programme is removed, and that one looks like it belongs here.
   */
  const handleEndSession = () => {
    if (completedSetCount > 0) {
      handOff(
        () => setExitOpen(false),
        () => setConfirmingEnd(true),
      );
      return;
    }
    setExitOpen(false);
    onEndSession();
  };

  // Only the finish celebration goes dark — rest stays on the light theme.
  const dark = mode === 'player' && step.type === 'finish';
  const nextPreview = mode === 'player' ? getGuidedNextPreview(steps, stepIndex, resolveTarget, language) : null;

  const libraryFor = (name: string) => {
    const index = findGuidedLibraryIndex(name, exerciseLibrary.map((item) => item.name));
    return index === null ? null : exerciseLibrary[index];
  };

  /* ── entry data ── */
  const workStart = findGuidedPhaseStart(steps, 'work');
  const cooldownStart = findGuidedPhaseStart(steps, 'cooldown');
  // Memoized: two memos below key on it, and as a fresh array per render it
  // rebuilt the warm-up brief — a library lookup per lift — on every timer
  // tick (~20 ms of each render on the phone, 2026-09-30).
  const activeExercises = useMemo(
    () => exercises.filter((exercise) => exercise.status !== 'skipped' && exercise.sets.length > 0),
    [exercises],
  );
  // One count with the lock-screen card (liveSetProgress): a finished-early
  // lift's skipped sets are not still to do.
  const setProgress = useMemo(() => liveSetProgress(exercises), [exercises]);
  const totalSets = setProgress.total;
  // Badges for the entry screen's list, over the lifts it actually shows. A
  // lift that is OUT of the plan — skipped, or finished early with the rest of
  // its sets skipped — is unpaired first, on exactly the predicate the step
  // list uses: the entry screen must not promise an A2 the player will not
  // ask for.
  /**
   * The lifts the plan will actually ask for, with anything out of it — skipped,
   * or finished early with the rest of its sets skipped — unpaired first. The
   * entry list, the walk-up card and the set screen all read from this one
   * list, so none of them can promise a partner the step list will not ask for.
   */
  const plannedExercises = activeExercises.map((exercise) =>
    isGuidedExerciseOut(exercise) ? { ...exercise, supersetGroup: null } : exercise,
  );
  const entrySupersets = supersetPositions(plannedExercises);
  /**
   * The entry table's rows in runs, so a pair is one box there too. Through
   * the same normalizer the badges use: the run's group id is a React key
   * here, and one id on two runs would be two rows claiming one key.
   */
  const entrySupersetRuns = buildSupersetRuns(normalizeSupersetGroups(plannedExercises));
  /**
   * The lift this one runs straight into, by slot — which is how every step
   * names a lift. Null when nothing follows inside the block, and absent
   * entirely for a lift done on its own.
   */
  const supersetNextBySlot = new Map<string, string | null>();
  activeExercises.forEach((exercise, index) => {
    const position = entrySupersets[index];
    if (!position?.groupId) {
      return;
    }
    supersetNextBySlot.set(
      exercise.slotId,
      position.hasNextInGroup ? activeExercises[index + 1]?.exerciseName ?? null : null,
    );
  });
  /**
   * The whole group a lift belongs to, in the order it is performed — what the
   * set screen needs to say "this one, then that one, then rest" without the
   * reader opening anything.
   */
  const supersetGroupBySlot = new Map<string, { members: Array<{ slotId: string; name: string }> }>();
  buildSupersetRuns(plannedExercises).forEach((run) => {
    if (run.indexes.length < 2) {
      return;
    }
    const members = run.indexes.map((index) => ({
      slotId: plannedExercises[index].slotId,
      name: plannedExercises[index].exerciseName,
    }));
    members.forEach((member) => supersetGroupBySlot.set(member.slotId, { members }));
  });
  // The named constant, not a literal 3 — this is the same ready-countdown
  // estimateRoutineBlockSeconds adds for Home, and the two have to move together.
  const warmupSecondsTotal = warmupDrills.reduce((sum, drill) => sum + drill.seconds + GUIDED_READY_SECONDS, 0);
  const cooldownSecondsTotal = cooldownDrills.reduce((sum, drill) => sum + drill.seconds + GUIDED_READY_SECONDS, 0);
  // The one session-length formula, shared with Home — this screen used to add
  // up its own steps at a flat 35 s per set and land on a different number
  // than the screen the user had just come from.
  const durationMinutes = estimateSessionMinutes({
    exercises: activeExercises.map((exercise) => ({
      name: exercise.exerciseName,
      sets: exercise.sets.length,
      reps: exercise.sets[0]?.plannedRepsMax ?? 8,
      timed: isTimedTrackingMode(exercise.trackingMode),
      minutes: isMinutesTrackingMode(exercise.trackingMode),
      restSeconds: exercise.restSecondsMin,
      // A superset rests once per round, not once per lift — see
      // estimateSessionSeconds. Without this the entry screen quotes a session
      // several minutes longer than the one it is about to run.
      supersetGroup: exercise.supersetGroup ?? null,
    })),
    warmupSeconds: warmupSecondsTotal,
    cooldownSeconds: cooldownSecondsTotal,
  });

  const secondsLeft = remainingMs / 1000;

  /**
   * The bar under the step: this phase's segments, and where in them we are.
   * A step with no group of its own (a splash, the finish) keeps the phase it
   * belongs to by falling back on group 0, which the rail then clamps.
   */
  /**
   * The drills the gate is offering, with the body part each one is there for.
   *
   * The purpose line is derived from the drill's stand-in library row rather
   * than written per drill: every drill has one, so the column is never half
   * empty, and a hand-written reason for forty drills is forty strings to keep
   * true in two languages.
   */
  const gateDrills = useMemo(() => {
    if (!skippablePhase) {
      return [] as Array<{ name: string; why: string | null; seconds: number }>;
    }
    const source = skippablePhase === 'warmup' ? warmupDrills : cooldownDrills;
    return source.map((drill) => {
      const item = libraryFor(getDrillLibraryName(drill.name) ?? drill.name);
      return {
        name: drill.name,
        why: item?.bodyPart ? libraryLabel(item.bodyPart, language) : null,
        seconds: drill.seconds,
      };
    });
    // libraryFor closes over exerciseLibrary and is stable enough for this:
    // the library is seeded once per load and does not change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skippablePhase, warmupDrills, cooldownDrills, exerciseLibrary, language]);

  const ownLastTimeLine = ownBlock ? formatLastOwnBlock(ownBlockStats, ownBlock.phase, language) : null;
  /** What the workout is about to load, for the reader warming up their own way. */
  const warmupBrief = useMemo(
    () =>
      buildWarmupBrief(
        activeExercises.map((exercise) => ({
          exerciseName: exercise.exerciseName,
          bodyPart: libraryFor(exercise.exerciseName)?.bodyPart ?? null,
          setCount: exercise.sets.length,
          repsLabel: formatRepRangeLabel(planSetOf(exercise.sets), exercise.trackingMode),
          timed: isTimedTrackingMode(exercise.trackingMode),
          minutes: isMinutesTrackingMode(exercise.trackingMode),
          loadKg: resolveTarget(exercise.slotId, 0)?.loadKg ?? null,
        })),
        language,
        unitPreference,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeExercises, exerciseLibrary, language, resolveTarget, unitPreference],
  );

  /**
   * The sheet's WATCH FOR chips: this lift's common mistakes.
   *
   * Three lifts have hand-written teaching, so the chip row is usually empty —
   * and empty is the honest state. A generic "keep good form" chip on the
   * other eight hundred would be furniture with an alarm on it.
   */
  const sheetWatchFor = useMemo(() => {
    if (step.type !== 'set') {
      return [] as Array<{ text: string; flagged: boolean }>;
    }
    // The library's name, for the same reason the Learn tab uses it.
    const teaching = getExerciseTeaching(libraryFor(step.exerciseName)?.name ?? step.exerciseName, language);
    if (!teaching) {
      return [];
    }
    return teaching.mistakes.map((mistake) => ({ text: mistake.mistake, flagged: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseLibrary, language, step]);

  /**
   * The Learn tab's payload, or null when this lift has no teaching written.
   *
   * The same self-audit the Learn section shows, at the moment it is actually
   * about: the set is done and the reader is standing over the bar. Only for
   * the lifts that have it — a third tab with nothing in it is worse than two
   * tabs (user 2026-09-04).
   */
  const sheetLearn = useMemo(() => {
    if (step.type !== 'set') {
      return null;
    }
    /*
     * Looked up by the LIBRARY's name for this lift, not the plan's.
     *
     * The teaching table is keyed the way the library names things — "Barbell
     * Bench Press - Medium Grip" — while a programme calls the same lift
     * "Bench Press". Asking with the plan's name found nothing for every lift
     * that has teaching, which is every lift this tab exists for (device
     * 2026-09-04).
     */
    const item = libraryFor(step.exerciseName);
    const teaching = getExerciseTeaching(item?.name ?? step.exerciseName, language);
    const libraryId = item?.id ?? null;
    if (!teaching || teaching.check.length === 0 || !libraryId || !onToggleTechniqueStatement) {
      return null;
    }
    return {
      cues: teaching.cues,
      check: teaching.check,
      checked: techniqueChecks[libraryId] ?? [],
      learned: learnedExerciseIds.includes(libraryId),
      onToggleStatement: (index: number) => onToggleTechniqueStatement(libraryId, index),
      onToggleLearned: () => onToggleExerciseLearned?.(libraryId),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    exerciseLibrary,
    language,
    learnedExerciseIds,
    onToggleExerciseLearned,
    onToggleTechniqueStatement,
    step,
    techniqueChecks,
  ]);

  /** Eight sessions of top sets, today's included and growing set by set. */
  const sheetHistory = useMemo(() => {
    // Read only by the open sheet below. Built behind a closed one it ran for
    // the whole series of the lift — a date format per session — on every
    // step change and logged set, and was thrown away unseen.
    if (!setPanelsOpen) {
      return gateExerciseSheetHistory(buildExerciseSheetHistory([], null, language), proUnlocked);
    }
    const slotId = step.type === 'set' ? step.slotId : null;
    const instance = slotId ? exerciseBySlot.get(slotId) ?? null : null;
    // The lift by name, then whatever only the slot knows. The two stamp a
    // session with the same performedAt (finishWorkout hands one value to
    // both writes), so a session present in both is one row, not two. And
    // only a session that happened: the slot holds an entry for every
    // exercise a finished session listed, skipped ones included.
    const lift = instance ? liftHistory?.(instance.exerciseName) ?? [] : [];
    const known = new Set(lift.map((entry) => entry.performedAt));
    const past = [
      ...lift.map((entry) => ({
        performedAt: entry.performedAt,
        sets: entry.sets.map((set) => ({ loadKg: set.weight, reps: set.reps })),
      })),
      ...getHistoryEntriesForExercise(workout.history, instance)
        .filter((entry) => isUsableEntry(entry) && !known.has(entry.performedAt))
        .map((entry) => ({
          performedAt: entry.performedAt,
          sets: entry.sets.map((set) => ({ loadKg: set.loadKg, reps: set.reps })),
        })),
    ];
    // Only what was logged as the lift in the slot now: after a swap the sets
    // before it belong to the other lift's history.
    const todaySets = (instance ? setsOfCurrentLift(instance) : [])
      .filter((set) => set.status === 'completed')
      .map((set) => ({ loadKg: set.actualLoadKg ?? 0, reps: set.actualReps ?? 0 }));
    return gateExerciseSheetHistory(
      buildExerciseSheetHistory(
        past,
        todaySets.length > 0 ? { performedAt: new Date().toISOString(), sets: todaySets } : null,
        language,
        instance?.trackingMode ?? 'load_and_reps',
        unitPreference,
      ),
      proUnlocked,
    );
  }, [exerciseBySlot, language, liftHistory, proUnlocked, setPanelsOpen, step, unitPreference, workout.history]);

  /* ── rest screen ───────────────────────────────────────────────────────── */
  /**
   * Correcting the set just logged, without leaving the rest.
   *
   * Edit used to walk back to the set screen — which showed a set that was
   * already logged, and whose Log button the reducer refuses (a completed set
   * cannot be completed twice). So the way back was a way to nowhere. The
   * numbers are changed here instead, on the screen that is asking about them.
   */
  useEffect(() => {
    setRestEdit(null);
  }, [stepIndex]);

  /**
   * Into the next set before the clock gets there — on the second press
   * (lib/skipRestConfirm). The first arms it and the label asks again.
   */
  const [skipArmedAt, setSkipArmedAt] = useState<number | null>(null);
  useEffect(() => {
    setSkipArmedAt(null);
  }, [stepIndex]);
  useEffect(() => {
    if (skipArmedAt === null) {
      return undefined;
    }
    const timer = setTimeout(() => setSkipArmedAt(null), SKIP_REST_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [skipArmedAt]);
  const startRestNextSet = () => {
    const now = Date.now();
    if (skipRestTap(skipArmedAt, now) === 'arm') {
      void haptics.select();
      setSkipArmedAt(now);
      // The red and the new label are for the eye; a screen reader is told.
      AccessibilityInfo.announceForAccessibility(t(language, 'guided.skipRest.confirm'));
      return;
    }
    setSkipArmedAt(null);
    advance();
  };

  /**
   * The rest tour's first beat shows the contents sheet opening and closing,
   * so the reader sees what the strip does instead of reading about it.
   */
  useEffect(() => {
    if (tourFocus !== 'workout.runStrip') {
      return undefined;
    }
    const open = setTimeout(() => setRunSheetOpen(true), 700);
    const close = setTimeout(() => setRunSheetOpen(false), 2600);
    return () => {
      clearTimeout(open);
      clearTimeout(close);
      setRunSheetOpen(false);
    };
  }, [tourFocus]);

  /* ── walking to the next machine ───────────────────────────────────────── */
  /** Today's prescription for the lift being walked to, and last time's. */
  const walkNext = (() => {
    if (step.type !== 'position') {
      return null;
    }
    const instance = exerciseBySlot.get(step.slotId);
    const target = resolveTarget(step.slotId, 0);
    if (!instance || !target) {
      return null;
    }
    // The lift being walked TO, asked for by its own slot.
    const last = resolveSlotHistory(step.slotId, step.exerciseName);
    // The reps part of the plan line, worked out once for the plain and the
    // superset line (lib/guidedPlayer resolveGuidedWalkPlan): a ramp set by
    // set, a target lowered after a short session with the programme's own
    // number beside it (2026-09-09 rule, lib/progressionGate), else one number.
    const walkPlan = resolveGuidedWalkPlan(
      instance.sets,
      instance.trackingMode,
      instance.swappedAfterSetIndex,
      instance,
    ) ?? { kind: 'plain' as const, reps: [target.reps] };
    const supersetNext = supersetNextBySlot.get(step.slotId);
    const rest = guidedRestSeconds(instance.restSecondsMin);
    // Today's plan across every set of this lift, not only set 1 — a ramp's
    // card used to say "NYT 55 kg" while the plan actually asked for
    // 55-60-60-60 (sumo, #bugs 2026-09-29). A single set 1 stays as it read.
    const todayLoads = instance.sets.map((_, index) => resolveTarget(step.slotId, index)?.loadKg ?? null).filter(
      (load): load is number => load != null,
    );
    return {
      todayValue:
        target.loadKg != null && target.loadKg > 0
          ? formatLoadOrRange(todayLoads) ?? formatWeight(target.loadKg, unitPreference)
          : // The unloaded label whatever the load says: a lift with no weight
            // yet opens at 0 kg, and "8 × 0 kg" is not a target.
            formatGuidedTarget({ ...target, loadKg: null }, language),
      // A lift that runs into the next one has no rest after it, so the card
      // names what does follow. Quoting the lift's own rest here would be the
      // same promise the day view stopped making — and worse on this screen,
      // which is the last thing read before walking to the rack.
      planLine: supersetNext
        ? walkPlan.kind === 'ramp'
          ? walkSupersetRampLabel(walkPlan.reps, exerciseNameLabel(language, supersetNext), language)
          : walkPlan.kind === 'lowered'
            ? t(language, 'guided.walk.planSupersetLowered', {
                sets: instance.sets.length,
                reps: walkPlan.reps[0],
                programme: walkPlan.programme,
                name: exerciseNameLabel(language, supersetNext),
              })
            : t(language, 'guided.walk.planSuperset', {
                sets: instance.sets.length,
                reps: walkPlan.reps[0],
                name: exerciseNameLabel(language, supersetNext),
              })
        : walkPlan.kind === 'ramp'
          ? walkRampLabel(walkPlan.reps, rest, language)
        : walkPlan.kind === 'lowered'
          ? t(language, 'guided.walk.planLowered', {
              sets: instance.sets.length,
              reps: walkPlan.reps[0],
              // The programme's own reps — a range reads as one ("8–12").
              programme: walkPlan.programme,
              rest,
            })
          : t(language, 'guided.walk.plan', {
            sets: instance.sets.length,
            reps: walkPlan.reps[0],
            /*
             * The LOWER bound — that is what the timer runs.
             *
             * `buildGuidedSteps` is handed `restSeconds: exercise.restSecondsMin`,
             * so a Back Squat prescribed 120-180 rests for 120. This card said 180
             * and the ring thirty seconds later said 2:00 (review, PR #57). The
             * comment that used to sit here claimed the opposite, which is why the
             * number went unchecked.
             *
             * And the ring's own floor: a stretch prescribed 0 s still runs the
             * shortest ring, so the card says that, not "0 s".
             */
            rest,
          }),
      // Last time's own span, the same way the set card's chips show it —
      // one weight when every set matched, the range when they did not.
      lastValue: formatLoadOrRange(last?.sets.map((set) => set.loadKg) ?? []),
      lastReps: last?.sets.length ? last.sets.map((set) => set.reps).join(' · ') : null,
    };
  })();

  /** The lift being walked to, if it is currently plateaued — see plateauNotice. */
  const walkPlateau = step.type === 'position' ? plateauNotice?.(step.exerciseName) ?? null : null;

  /**
   * The lift just finished, when it met a target set above last time's: the
   * card that names a stall names the step that ends it too (lib/liftPraise,
   * #bugs 2026-10-08). Only on the walk-up that follows that lift's last set,
   * and not for a lift swapped mid-way, whose sets are two lifts.
   */
  const walkPraise = (() => {
    const before = step.type === 'position' ? steps[stepIndex - 1] : undefined;
    const justLoggedSlotId = praisedSlotBeforeWalkUp(before, step);
    if (!before || before.type !== 'set' || !justLoggedSlotId) {
      return null;
    }
    const done = exerciseBySlot.get(justLoggedSlotId);
    if (!done || done.swappedAfterSetIndex !== undefined) {
      return null;
    }
    const praise = resolveLiftPraise(
      done.sets,
      resolveSlotHistory(justLoggedSlotId, done.exerciseName)?.sets ?? null,
      done.trackingMode,
      // Last time's sets up to the programme's count: a set last time added
      // does not hold back praise for every programme set raised and met.
      programmeSetCount(done.sets),
    );
    if (!praise) {
      return null;
    }
    const reps = praise.reps.every((count) => count === praise.reps[0])
      ? `${praise.reps.length} × ${praise.reps[0]}`
      : praise.reps.join('/');
    return t(language, 'guided.walk.praise', {
      name: exerciseNameLabel(language, done.exerciseName),
      dose: praise.loadKg !== null ? `${formatWeight(praise.loadKg, unitPreference)} ${reps}` : reps,
    });
  })();

  const railGroupIndex = step.type === 'finish' || step.type === 'splash' ? 0 : step.groupIndex;
  const phaseRail = useMemo(() => getGuidedPhaseRail(groups, railGroupIndex), [groups, railGroupIndex]);

  /*
   * The overview's two new claims: what the last run of this same day cost,
   * and whether the gate moved anything for today.
   *
   * Memoized because this screen re-renders ten times a second while a timer
   * runs, and neither of these is a per-tick value — one scans the whole
   * session history, the other walks every exercise. Both are read on the
   * entry screen only, which has no running clock at all.
   */
  const progressionPill = useMemo(
    () =>
      buildProgressionPill(
        activeExercises.map((exercise) => {
          const target = resolveTarget(exercise.slotId, 0);
          return {
            loadKg: target?.loadKg ?? null,
            autoProgressedFromKg: target?.autoProgressedFromKg ?? null,
            reps: target?.reps ?? 0,
            autoProgressedFromReps: target?.autoProgressedFromReps ?? null,
          };
        }),
        language,
        unitPreference,
      ),
    [activeExercises, language, resolveTarget, unitPreference],
  );

  return (
    <View style={{ flex: 1, backgroundColor: dark ? GPD.bg2 : theme.bg }}>
      {/* `dark` is the finish step's own gradient, not the theme. Read as the
          status bar's answer it painted near-black icons on the dark theme's
          near-black background, and the phone's own clock disappeared for the
          length of a workout. Reported from a gym floor 2026-08-21. */}
      <StatusBar
        style={dark || themeName === 'dark' ? 'light' : 'dark'}
        backgroundColor={dark ? GPD.bg1 : theme.bg}
      />
      {dark ? (
        <View style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <SvgLinearGradient id="gpDark" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={GPD.bg1} />
                <Stop offset="1" stopColor={GPD.bg2} />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#gpDark)" />
          </Svg>
        </View>
      ) : null}

      {mode === 'entry' && (
        <StepIn stepKey="entry">
          <View style={styles.entryRoot}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.entryEyebrow}>{entryEyebrow}</Text>
              {/* Nothing has started yet, so this simply closes the player.
                  Named — it was a bare icon (accessibility audit,
                  2026-09-21). */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'common.close')}
                onPress={onLeave}
                style={styles.topBtn}
                hitSlop={8}
              >
                <GPIcon name="x" size={19} color={theme.ink} />
              </Pressable>
            </View>
            <Text style={styles.entryTitle} numberOfLines={2}>
              {sessionTitle}
            </Text>
            <Text style={styles.entrySub}>
              {[
                activeExercises.length === 1
                  ? t(language, 'guided.count.exerciseOne')
                  : t(language, 'guided.count.exerciseMany', { count: activeExercises.length }),
                setCountLabel(totalSets, language),
                t(language, 'guided.entry.duration', { min: durationMinutes }),
              ].join(' · ')}
            </Text>

            {/* What the same session cost last time, and what the gate moved
                for today. The pill is the whole reason the weights on the rows
                below are worth reading — without it the overview showed a plan
                and never said which part of it is new. */}
            {/* No "VIIME KERRALLA · 44 min · 1 040 kg" any more: on the way to
                the rack the reader wanted the plan, not last week's receipt
                (user 2026-09-09, "liikaa dataa"). The pill stays — it is the
                one line that says what is new today. */}
            {progressionPill ? (
              <View style={styles.entryLastRow}>
                <View style={{ flex: 1 }} />
                <View style={styles.entryProgressPill}>
                  <Text style={styles.entryProgressPillText} numberOfLines={1}>
                    {progressionPill}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Resume is the strongest action on this screen when it exists, so
                it follows the same rule as the rest: pressable is `highlight`.
                Left violet it would have been the one button in dark that
                still was. */}
            {showResume && (
              <Pressable style={styles.resumeCard} onPress={() => startAt(resumeIndex)}>
                <GPIcon name="play" size={18} color={theme.highlight} sw={2.4} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '800', color: theme.highlight }}>
                    {t(language, 'guided.entry.resume')}
                  </Text>
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme.muted, marginTop: 1 }} numberOfLines={1}>
                    {getGuidedStepLabel(steps[resumeIndex], language)}
                  </Text>
                </View>
                <GPIcon name="chevR" size={17} color={theme.highlight} />
              </Pressable>
            )}

            <ScrollView
              style={{ flex: 1, marginTop: 18 }}
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {[
                warmupDrills.length > 0
                  ? {
                      key: 'warmup',
                      label: t(language, 'guided.phase.warmup'),
                      sub: `${t(language, 'guided.count.timedDrills', { count: warmupDrills.length })} · ${t(language, 'guided.entry.duration', { min: Math.max(1, Math.round(warmupSecondsTotal / 60)) })}`,
                      groups: warmupDrills.map((drill, index) => ({
                        key: `warmup_${index}`,
                        superset: false,
                        rows: [{ name: drill.name, sets: '', reps: '', load: formatDrillLength(drill.seconds) }],
                      })),
                    }
                  : null,
                workStart !== null
                  ? {
                      key: 'work',
                      label: t(language, 'guided.phase.workout'),
                      sub: `${
                        activeExercises.length === 1
                          ? t(language, 'guided.count.exerciseOne')
                          : t(language, 'guided.count.exerciseMany', { count: activeExercises.length })
                      } · ${setCountLabel(totalSets, language)}`,
                      // In runs, so a superset is one box on this table too.
                      // Two lifts that will be done back to back are read
                      // before the session starts, which is when knowing it
                      // still changes what you set up.
                      groups: entrySupersetRuns.map((run) => ({
                        key: run.groupId ?? `solo_${run.indexes[0]}`,
                        superset: run.groupId !== null && run.indexes.length > 1,
                        rows: run.indexes.map((exerciseIndex) => {
                          const exercise = activeExercises[exerciseIndex];
                          return {
                            // Through the same translation every other name on
                            // this screen goes through — this row listed "Back
                            // Squat" under a Finnish heading while the player
                            // itself said Takakyykky.
                            name: exerciseNameLabel(language, exercise.exerciseName),
                            ...buildOverviewColumns(
                              {
                                exerciseName: exercise.exerciseName,
                                setCount: exercise.sets.length,
                                repsLabel: formatRepRangeLabel(planSetOf(exercise.sets), exercise.trackingMode),
                                timed: isTimedTrackingMode(exercise.trackingMode),
                                minutes: isMinutesTrackingMode(exercise.trackingMode),
                                loadKg: resolveTarget(exercise.slotId, 0)?.loadKg ?? null,
                              },
                              unitPreference,
                            ),
                          };
                        }),
                      })),
                    }
                  : null,
                cooldownStart !== null
                  ? {
                      key: 'cooldown',
                      label: t(language, 'guided.phase.cooldown'),
                      sub: `${t(language, 'guided.count.stretchMany', { count: cooldownDrills.length })} · ${cooldownSecondsTotal < 90 ? `~${t(language, 'logger.secondsValue', { count: Math.round(cooldownSecondsTotal / 5) * 5 })}` : t(language, 'guided.entry.duration', { min: Math.round(cooldownSecondsTotal / 60) })}`,
                      groups: cooldownDrills.map((drill, index) => ({
                        key: `cooldown_${index}`,
                        superset: false,
                        rows: [{ name: drill.name, sets: '', reps: '', load: formatDrillLength(drill.seconds) }],
                      })),
                    }
                  : null,
              ]
                .filter(
                  (
                    item,
                  ): item is {
                    key: string;
                    label: string;
                    sub: string;
                    groups: Array<{
                      key: string;
                      superset: boolean;
                      rows: Array<{ name: string; sets: string; reps: string; load: string }>;
                    }>;
                  } => item !== null,
                )
                .map((phase, phaseIndex) => {
                  const expanded = expandedPhases.includes(phase.key);
                  return (
                    <View key={phase.key} style={styles.phaseCard}>
                      <Pressable
                        style={styles.phaseHeader}
                        onPress={() =>
                          setExpandedPhases((current) =>
                            current.includes(phase.key)
                              ? current.filter((key) => key !== phase.key)
                              : [...current, phase.key],
                          )
                        }
                      >
                        {/* A number, not a play glyph. Three play triangles
                            above a fourth on the CTA read as four ways to
                            start the session; only one of them was. The
                            numbers say the same thing the cards mean — this is
                            the order they happen in. */}
                        <View style={styles.phaseStep}>
                          <Text style={styles.phaseStepText}>{phaseIndex + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16.5, fontWeight: '800', color: theme.ink }}>{phase.label}</Text>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.muted, marginTop: 3 }}>{phase.sub}</Text>
                        </View>
                        <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
                          <GPIcon name="chevR" size={18} color={theme.faint} />
                        </View>
                      </Pressable>
                      {expanded && (
                        <View style={styles.phaseRows}>
                          {/* Columns, not a sentence. "4 × 7 · 62,5 kg" put the
                              weight wherever the reps ended, and on a lift with
                              no weight two words earlier; nine names in ten were
                              cut at one line behind a 57px indent (user
                              2026-09-09). Name first and wide, then sets, reps,
                              kg or time — each in its own place on every row.

                              Smaller than the first cut, on the phone's own
                              evidence: "SARJ/AT" broke across two lines and
                              "Lantionnostopit/o" mid-word. The name is whole
                              ("on pakko olla koko tekstit") in two lines at
                              most: past that the type shrinks rather than the
                              name being cut (#bugs 2026-09-30). A drill row,
                              which has no sets or reps, does not spend two
                              empty columns' width on them. The lifts get a
                              header once. */}
                          {phase.key === 'work' ? (
                            <View style={styles.phaseRowGroup}>
                              <View style={[styles.phaseRow, { paddingVertical: 2 }]}>
                                <View style={{ flex: 1 }} />
                                <Text style={[styles.phaseColHead, styles.phaseColSets]} numberOfLines={1}>
                                  {t(language, 'guided.entry.col.sets')}
                                </Text>
                                <Text style={[styles.phaseColHead, styles.phaseColReps]} numberOfLines={1}>
                                  {t(language, 'guided.reps')}
                                </Text>
                                <Text style={[styles.phaseColHead, styles.phaseColLoad]} numberOfLines={1}>
                                  {t(language, 'guided.entry.col.load')}
                                </Text>
                              </View>
                            </View>
                          ) : null}
                          {phase.groups.map((group) => (
                            <View
                              key={group.key}
                              style={group.superset ? styles.phaseSupersetGroup : undefined}
                            >
                              {group.superset ? (
                                <>
                                  <SupersetBorder radius={12} />
                                  <View style={styles.phaseSupersetPill}>
                                    <Text style={styles.phaseSupersetPillText}>
                                      {t(language, 'guided.superset.pill')}
                                    </Text>
                                  </View>
                                </>
                              ) : null}
                              {group.rows.map((row, rowIndex) => (
                                <View key={rowIndex} style={styles.phaseRowGroup}>
                                  <View style={styles.phaseRow}>
                                    {/* Two lines at most, the type giving way
                                        for a longer name rather than a third
                                        line or a word cut in half (#bugs
                                        2026-09-30, "max 2 riviä"). */}
                                    <Text
                                      style={styles.phaseRowName}
                                      numberOfLines={2}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.7}
                                    >
                                      {row.name}
                                    </Text>
                                    {row.sets || row.reps ? (
                                      <>
                                        <Text style={[styles.phaseCol, styles.phaseColSets]}>{row.sets}</Text>
                                        <Text style={[styles.phaseCol, styles.phaseColReps]}>{row.reps}</Text>
                                      </>
                                    ) : null}
                                    <Text style={[styles.phaseCol, styles.phaseColLoad]}>{row.load}</Text>
                                  </View>
                                </View>
                              ))}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
            </ScrollView>

            {/*
              The pinned button is whatever the session actually needs next.
              It always said "Start session" and always jumped to step 0, even
              with half the workout logged — so a reader who came back through
              Home's "Resume workout" met a screen whose biggest, lowest,
              thumb-nearest button offered to walk them through it again, with
              the real resume a quiet card up at the top. One of them was
              pressed, and it was not the quiet one (#bugs 2026-08-29).

              Nothing was lost — starting over only moves the step pointer —
              but "start" is not what that button did to a session in progress,
              and it should not have been the one under the thumb.
            */}
            {/* Starting over stays available — quietly, and saying so.
                ABOVE the button, not below it: this root pads 14px off the
                bottom with no safe-area inset, and that strip is where Android
                draws its own controls. Anything put there is a control the
                reader has to fight the system bar for, which this app has
                already shipped twice (#bugs 2026-08-28). */}
            {showResume ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => startAt(0)}
                style={styles.startOverLink}
              >
                <Text style={styles.startOverText}>{t(language, 'guided.entry.startOver')}</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              style={styles.startCta}
              onPress={() => startAt(showResume ? resumeIndex : 0)}
            >
              {/* White would be unreadable on the dark theme's orange; that is
                  what `onHighlight` is for. It stays white in light. */}
              <GPIcon name="play" size={19} color={theme.onHighlight} sw={2.5} />
              <Text style={{ fontSize: 16.5, fontWeight: '800', color: theme.onHighlight }}>
                {t(language, showResume ? 'guided.entry.resume' : 'guided.entry.start')}
              </Text>
            </Pressable>
          </View>
        </StepIn>
      )}

      {mode === 'player' && step.type !== 'finish' && (
        <>
          {/* The clock and nothing else. The phase word went first ("Poista
              yläosasta treeni ja lepo"), then the "1/6" counter with it (#bugs
              2026-09-30, "Otetaan toi 1/6 pois myös yläpalkista"): the rail
              under the screen already counts the block. */}
          <TopBar
            dark={dark}
            language={language}
            clock={formatSessionClock(derivedElapsedSeconds)}
            muted={muted}
            onMute={() => onToggleSoundCues(!soundCuesEnabled)}
            onExit={() => setExitOpen(true)}
            // The right slot is the sound toggle again, on every screen of the
            // session. It held the set screen's info button from 2026-08-26,
            // which meant the one control the design says lives in exactly one
            // place lived in two — and the info it opened is on the lift's own
            // card now, where the reader is already looking.
          />

          {step.type === 'splash' && (
            <StepIn stepKey={`splash-${stepIndex}`}>
              {/* A splash that asks a question waits for the answer. The work
                  splash is a beat between phases and still passes on its own;
                  the warmup and recovery ones carry a fork, and a choice on a
                  2.3-second timer is a choice you reach for and miss (user
                  2026-08-26). */}
              <Pressable
                style={skippablePhase ? styles.splashChoiceRoot : styles.splashRoot}
                onPress={splashCarriesChoice(step) ? undefined : advance}
                // Disabled on native, where that keeps the wrapper silent to
                // TalkBack and off the touch path between the buttons. Not on
                // web: there a disabled Pressable is aria-disabled, which
                // marked its own choice buttons — "Warm up your own way",
                // "Add exercise" — disabled to assistive tech and automation
                // (#bugs 2026-10-01); no onPress keeps it inert there.
                disabled={Platform.OS === 'web' ? undefined : splashCarriesChoice(step)}
                focusable={!splashCarriesChoice(step)}
              >
                {/* The block name owns the upper half; the decision sits down
                    where a thumb already is (user 2026-08-26). */}
                <View style={skippablePhase ? styles.splashChoiceCopy : styles.splashCopy}>
                  {/* No "Lämmittely valmis" row: a check and a sentence about
                      the block just left, above the name of the one being
                      entered (user 2026-09-09). */}
                  {/* No "SEURAAVAKSI" eyebrow on any splash. The recovery one
                      lost it with "Treeni valmis" and its length (user
                      2026-09-09); the warm-up and workout ones followed when
                      asked (#bugs 2026-09-30, "otetaan seuraavaksi pois") — a
                      screen that is the next thing does not need to say so.
                      The walk-up keeps its own, as asked in the same round
                      ("jätetään tähän seuraavaksi"). */}
                  <Text style={styles.splashTitle}>{step.title}</Text>
                  {step.phase !== 'cooldown' ? (
                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.muted }}>{step.sub}</Text>
                  ) : null}
                  {/* The list sits with the title rather than on top of the
                      buttons: down there it left a hand's width of nothing
                      under the heading and read as part of the footer (user
                      2026-09-04). It is what the heading is describing.

                      Capped and scrollable so five drills cannot push the
                      title off a short screen — the cap is high enough that
                      four fit without scrolling. */}
                  {gateDrills.length > 0 ? (
                    <ScrollView
                      style={styles.gateCard}
                      contentContainerStyle={{ paddingVertical: 4 }}
                      showsVerticalScrollIndicator={false}
                    >
                      {gateDrills.map((drill, index) => (
                        <View key={`${drill.name}-${index}`} style={styles.gateRow}>
                          <Text style={styles.gateRowIndex}>{index + 1}</Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.gateRowName} numberOfLines={1}>
                              {drill.name}
                            </Text>
                          </View>
                          <Text style={styles.gateRowLength}>{formatDrillLength(drill.seconds)}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
                {/* The block is a suggestion, not a gate — and leaving it is a
                    real choice, so it gets a real button rather than a muted
                    line of text nobody found (user 2026-08-26). */}
                {skippablePhase ? (
                  <View style={{ alignSelf: 'stretch', gap: 12 }}>
                    <BigBtn
                      tall
                      icon="play"
                      color={theme.accent}
                      label={t(language, `guided.own.start.${skippablePhase}` as 'guided.own.start.warmup')}
                      onPress={advance}
                    />
                    {/* The second way to do the same block. It says what it
                        does on its own second line rather than leaning on a
                        hint above it, so the fork is two buttons and not two
                        buttons plus a sentence explaining them. */}
                    {/* One line. The second line explained what the words
                        already say, and two of them made the button read as a
                        paragraph with a border (user 2026-09-04). */}
                    <Pressable
                      accessibilityRole="button"
                      style={styles.gateOwnBtn}
                      onPress={() => setOwnBlock({ phase: skippablePhase, startedAt: Date.now() })}
                    >
                      <Text style={styles.gateOwnLabel}>
                        {t(language, `guided.own.${skippablePhase}` as 'guided.own.warmup')}
                      </Text>
                    </Pressable>
                    {/* A third door, quieter than the other two: one more
                        lift before recovery, for the reader who was not done
                        (user 2026-09-29, "jouduin palautumiseen ilman että
                        halusin"). Cooldown only — the warm-up has nothing to
                        add to. */}
                    {step.phase === 'cooldown' ? (
                      <Pressable
                        accessibilityRole="button"
                        style={styles.gateAddExerciseLink}
                        onPress={() => {
                          setAddExerciseAfterSlot(null);
                          setAddExerciseOpen(true);
                        }}
                      >
                        <Text style={styles.gateAddExerciseLinkText}>
                          {t(language, 'guided.own.addExercise')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            </StepIn>
          )}

          {step.type === 'ready' && (
            <StepIn stepKey={`ready-${stepIndex}`}>
              <View style={styles.splashRoot}>
                <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 2, color: theme.purple }}>
                  {t(language, 'guided.getReady')}
                </Text>
                <PopIn popKey={Math.max(1, Math.ceil(secondsLeft))}>
                  <Text style={styles.readyDigit}>{Math.max(1, Math.ceil(secondsLeft))}</Text>
                </PopIn>
                <Text style={{ fontSize: 22, fontWeight: '800', color: theme.ink, marginTop: 16, textAlign: 'center' }}>
                  {step.drillName}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.muted, marginTop: 4 }}>{step.seconds}s</Text>
              </View>
            </StepIn>
          )}

          {step.type === 'drill' && (
            <StepIn stepKey={`drill-${stepIndex}`}>
              <View style={{ flex: 1, minHeight: 0 }}>
                <MediaZone
                  name={step.drillName}
                  library={exerciseLibrary}
                  height={guidedDrillMediaHeight(playerWindowHeight, playerFontScale)}
                  mode="drill"
                  language={language}
                />
                <View style={{ height: 20 }} />
                <NameBlock
                  name={step.drillName}
                  hasHowTo={Boolean(libraryFor(step.drillName)?.instructions?.length)}
                  language={language}
                  onHow={() => setHowtoOpen(true)}
                />
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                  {/* Already the largest text on the screen: a larger system
                      font grows the name and labels, not this. */}
                  <Text
                    maxFontSizeMultiplier={1}
                    style={[
                      styles.drillCountdown,
                      { color: secondsLeft <= 3.05 ? theme.green : theme.ink },
                    ]}
                  >
                    {formatGuidedCountdown(secondsLeft)}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 1.7, color: theme.muted, marginTop: 6 }}>
                    {t(language, 'guided.secondsLeft')}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22, paddingBottom: 12 }}>
                  <CtrlBtn
                    icon="plus"
                    label="+10s"
                    onPress={() => adjustRemaining(10000)}
                  />
                  <CtrlBtn
                    icon={paused ? 'play' : 'pause'}
                    label={t(language, paused ? 'guided.resume' : 'guided.pause')}
                    big
                    onPress={() => {
                      if (paused) {
                        unpause();
                      } else {
                        pause();
                        setPauseSheetOpen(true);
                      }
                    }}
                  />
                  <CtrlBtn icon="skip" label={t(language, 'guided.skip')} onPress={skipCurrent} />
                </View>
                <NextLine text={nextPreview?.line ?? null} dark={false} language={language} />
              </View>
            </StepIn>
          )}

          {step.type === 'position' && (
            <StepIn stepKey={`position-${stepIndex}`}>
              {/* Changing exercises is not time-bound.
                  This screen counted down fifteen seconds and offered a button
                  to stop the clock, which is a wait the reader did not ask for
                  plus a control to undo it. Walking to another machine takes
                  as long as it takes — sometimes the rack is busy — so there
                  is no clock here at all now (user 2026-09-04). What is left
                  is what the walk is actually for: the lift you just finished,
                  acknowledged, and the one you are walking to, with the
                  numbers you will need when you get there.

                  The two-zone shape from 2026-08-26 stands: what is coming at
                  the top, the action at the bottom. */}
              <ScrollView
                style={{ flex: 1, minHeight: 0 }}
                contentContainerStyle={{ paddingTop: 28, paddingHorizontal: 24, paddingBottom: 8, gap: 14 }}
                showsVerticalScrollIndicator={false}
                onLayout={(event) => setWalkViewportHeight(Math.floor(event.nativeEvent.layout.height))}
              >
                {/* Measured as one block, so the contents list below knows the
                    room that is left (walkRunFit). */}
                <View
                  style={{ gap: 14 }}
                  onLayout={(event) => setWalkTopHeight(Math.ceil(event.nativeEvent.layout.height))}
                >
                  {/* No card for the lift that just ended. It was a splash
                      once, then a card at the top of this screen (2026-09-04),
                      then two lines of it (2026-09-09) — and then not worth its
                      room at all: the numbers are in the contents sheet, and
                      without them the lift coming up, its picture and the swap
                      all sit higher, with room to press (#bugs 2026-09-30,
                      "poistetaan tuo mitä on viimeksi tehty se vie liikaa
                      tilaa"). */}
                  <View style={{ alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '800', letterSpacing: 2, color: theme.highlight }}>
                      {t(language, 'guided.nextUp')}
                    </Text>
                    {/* One line, the type shrinking to fit rather than the name
                        wrapping (device, 2026-09-16): a two-line name was the
                        line that pushed this screen into a scroll, and a walk-up
                        is read in one glance or not at all. */}
                    <Text
                      style={styles.positionName}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.5}
                      accessibilityLabel={exerciseNameLabel(language, step.exerciseName)}
                    >
                      {exerciseListLabel(language, step.exerciseName)}
                    </Text>
                  </View>

                  {/* Bigger. The shape was right and the box was not (user
                      2026-09-04) — and the screen has the room, having lost a
                      countdown. A little under the 230 it was, so the whole
                      walk-up fits without scrolling (device, 2026-09-16). */}
                  <MediaZone
                    name={step.exerciseName}
                    library={exerciseLibrary}
                    height={guidedWalkMediaHeight(playerWindowHeight, playerFontScale)}
                    mode="set"
                    showActions={false}
                    fit="cover"
                    language={language}
                  />

                  {/* Two cards, one question each: what you did last time, and
                      what today asks of you. The plan used to be one line of
                      small print under the name. Last time on the left, now on
                      the right — read left to right, from then to today (#bugs
                      2026-09-30, "Vaihda viimeksi ja nyt paikkaa"). */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={styles.walkStat}>
                      {/* "VIIMEKSI", whichever day of the plan it was: the
                          "ERI PÄIVÄ" second line went on request, here and on
                          the set card (#bugs 2026-09-30). A screen reader still
                          hears it on the set card. */}
                      <Text style={styles.walkStatLabel}>{t(language, 'guided.walk.last')}</Text>
                      <Text style={styles.walkStatValue}>{walkNext?.lastValue ?? '—'}</Text>
                      {walkNext?.lastReps ? (
                        <Text style={styles.walkStatSub}>{walkNext.lastReps}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.walkStat, { borderColor: theme.highlight }]}>
                      <Text style={styles.walkStatLabel}>{t(language, 'guided.walk.today')}</Text>
                      <Text style={[styles.walkStatValue, { color: theme.highlight }]}>
                        {walkNext?.todayValue ?? '—'}
                      </Text>
                      {walkNext?.planLine ? (
                        <Text style={styles.walkStatSub}>{walkNext.planLine}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* The same finding Home's card shows, once, here — so
                      dismissing that card does not make the lift's own stall
                      unmentioned the next time it comes up (user 2026-09-29). */}
                  {walkPraise ? (
                    <View style={styles.walkPraiseBanner}>
                      <Text style={styles.walkPraiseText}>{walkPraise}</Text>
                    </View>
                  ) : null}
                  {walkPlateau ? (
                    <View style={styles.walkPlateauBanner}>
                      <Text style={styles.walkPlateauText}>{walkPlateau.headline}</Text>
                    </View>
                  ) : null}
                </View>

                {/* The whole session, in the room under the cards — when there
                    is room (#bugs 2026-10-06, "jos mahtuu, olisi hyvä tässäkin
                    ruudussa olla koko ohjelman sisältö luettavissa"). The same
                    rows as the contents sheet: done, here, to come, each with
                    what is still asked of it. As many as fit, the lift coming
                    up first; the rest are counted on the last line, and a tap
                    opens the full sheet. On a phone with no room nothing is
                    drawn and the screen is what it was — the rail under it
                    still opens the sheet, and the buttons never move. */}
                {walkRunFit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint={t(language, 'guided.runSheet.open')}
                    onPress={() => setRunSheetOpen(true)}
                    style={({ pressed }) => [styles.walkRun, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.walkRunHead}>
                      <Text style={styles.walkRunTitle}>{t(language, 'guided.runSheet.title').toUpperCase()}</Text>
                      <GPIcon name="chevR" size={14} color={theme.faint} />
                    </View>
                    {walkLastLift ? (
                      <View style={styles.walkRunRow}>
                        <Text style={styles.walkRunName} numberOfLines={1}>
                          {t(language, 'guided.walk.lastLift')}
                        </Text>
                      </View>
                    ) : null}
                    {(walkLastLift ? [] : walkRunItems.slice(walkRunFit.start, walkRunFit.end)).map((item) => {
                      const isSuperset = item.members.length > 1;
                      const plan = isSuperset
                        ? item.setCount
                          ? t(language, 'guided.runSheet.rounds', { count: item.setCount })
                          : ''
                        : runPlanLine(item.members[0]?.slotId ?? null);
                      return (
                        <View key={item.groupIndex} style={styles.walkRunRow}>
                          <View
                            style={[
                              styles.walkRunDot,
                              item.status === 'done' && { backgroundColor: theme.green, borderColor: theme.green },
                              item.status === 'current' && { backgroundColor: theme.purple, borderColor: theme.purple },
                            ]}
                          >
                            {item.status === 'done' ? <GPIcon name="check" size={9} color="#fff" sw={3} /> : null}
                          </View>
                          <Text
                            style={[
                              styles.walkRunName,
                              item.status === 'current' && { color: theme.purple },
                              item.status === 'done' && { color: theme.muted },
                            ]}
                            numberOfLines={1}
                            accessibilityLabel={item.members.map((member) => exerciseNameLabel(language, member.name)).join(' + ')}
                          >
                            {item.members.map((member) => exerciseListLabel(language, member.name)).join(' + ')}
                          </Text>
                          {plan ? <Text style={styles.walkRunPlan}>{plan}</Text> : null}
                        </View>
                      );
                    })}
                    {walkHiddenLifts > 0 ? (
                      <View style={styles.walkRunRow}>
                        <Text style={styles.walkRunMore}>
                          {t(language, 'guided.walk.contentMore', { count: walkHiddenLifts })}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : null}
              </ScrollView>
              <View style={{ paddingHorizontal: 22, paddingBottom: 14, gap: 10 }}>
                {/* A button, not a line of text: squeezed between the cards and
                    the start button it read as a caption and was hard to hit
                    (#bugs 2026-09-30, "vaihda liike nappi näkyviin että voi
                    klikata"). */}
                <View style={styles.walkActions}>
                  <View style={styles.walkAction}>
                    <GhostBtn icon="swap" label={t(language, 'guided.walk.swap')} onPress={() => setSwapOpen(true)} />
                  </View>
                  <View style={styles.walkAction}>
                    <GhostBtn
                      icon="plus"
                      label={t(language, 'guided.walk.add')}
                      onPress={() => {
                        // After the whole block on screen: a superset's intro
                        // names its first lift, and inserting there split the pair.
                        // And after anything already added from this intro, so
                        // the second add does not land before the first.
                        const slotOrder = exercises.map((exercise) => exercise.slotId);
                        setAddExerciseAfterSlot({
                          anchor: resolveWalkAddAnchor(
                            guidedBlockLastSlotId(steps, step.groupIndex, slotOrder),
                            step.slotId,
                            walkAdded[step.slotId],
                            slotOrder,
                          ),
                          intro: step.slotId,
                        });
                        setAddExerciseOpen(true);
                      }}
                    />
                  </View>
                </View>
                {walkAdded[step.slotId]?.names.length ? (
                  <Text style={styles.walkAddedNote}>
                    {t(language, 'guided.walk.added', { name: walkAdded[step.slotId].names.join(', ') })}
                  </Text>
                ) : null}
                <BigBtn
                  shimmer
                  label={t(language, 'guided.walk.startFirst')}
                  icon="play"
                  onPress={advance}
                />
              </View>
            </StepIn>
          )}

          {/* An interval work bout: a clock, not a form. The dials, the log
              button and the weight are all absent on purpose — you are running
              (user 2026-08-26, "juoksuihin pitää keksiä oma ui"). */}
          {step.type === 'set' && step.interval && (
            <StepIn stepKey={`interval-${stepIndex}`}>
              <View style={{ flex: 1, minHeight: 0 }}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Text style={styles.intervalRound}>
                    {t(language, 'guided.interval.round', {
                      index: step.setIndex + 1,
                      count: step.setCount,
                    })}
                  </Text>
                  <RestRing
                    stepKey={stepIndex}
                    leftSeconds={secondsLeft}
                    plannedSeconds={step.interval.workSeconds}
                    stroke={theme.highlight}
                  >
                    <Text style={[styles.intervalPhase, { color: theme.highlight }]}>
                      {t(language, step.interval.workKind === 'run' ? 'guided.interval.run' : 'guided.interval.hard')}
                    </Text>
                    <Text style={styles.restCountdown} {...RING_CLOCK_FIT}>
                      {formatGuidedCountdown(secondsLeft)}
                    </Text>
                  </RestRing>
                  {/* What comes next, so the pace is a decision made before it
                      arrives rather than a surprise at zero. */}
                  <Text style={styles.intervalNext}>
                    {t(language, 'guided.interval.then', {
                      phase: t(
                        language,
                        step.interval.recoveryKind === 'walk'
                          ? 'guided.interval.walk'
                          : step.interval.recoveryKind === 'rest'
                            ? 'guided.interval.rest'
                            : 'guided.interval.easy',
                      ),
                      seconds: step.interval.recoverySeconds,
                    })}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 24, paddingBottom: 10, gap: 12 }}>
                  <BigBtn
                    label={t(language, paused ? 'guided.resume' : 'guided.pause')}
                    icon={paused ? 'play' : 'pause'}
                    color={paused ? undefined : theme.ink}
                    onPress={paused ? unpause : pause}
                  />
                  {/* Paused, the one other thing worth offering: leaving this
                      exercise. An interval has no set to log, no weight to
                      change and no rest to shorten, so the full actions sheet
                      would be five decisions where there is one (#bugs
                      2026-08-26, "ohita tämä liike ei muita valintoja"). */}
                  {paused ? (
                    <GhostBtn
                      icon="x"
                      label={t(language, 'guided.action.skipExercise')}
                      onPress={handleSkipExercise}
                    />
                  ) : null}
                </View>
                {/* No rail here: a `set` step already gets one from the shared
                    branch below, and adding a second drew the bar twice
                    (#bugs 2026-08-26, "alapalkki on virheellinen"). */}
              </View>
            </StepIn>
          )}

          {step.type === 'set' && !step.interval && (
            <SetStepView
              key={`set-${stepIndex}`}
              stepIndex={stepIndex}
              step={step}
              exercise={exerciseBySlot.get(step.slotId) ?? null}
              superset={supersetGroupBySlot.get(step.slotId) ?? null}
              language={language}
              paused={paused}
              progressionOn={progressionOn}
              resolveTarget={resolveTarget}
              // Pause pauses, and nothing else. It used to open the actions
              // sheet on the way, so the one control you reach for when the
              // rack is taken put five decisions in front of you first.
              onPause={() => {
                if (paused) {
                  unpause();
                  return;
                }
                pause();
              }}
              onOpenActions={openActionsMenu}
              onAddSet={() => {
                void haptics.select();
                workout.addSet(step.slotId);
              }}
              onLogWarmup={(loadKg, reps) => {
                void haptics.select();
                workout.logWarmup(step.slotId, loadKg, reps);
              }}
              onRemoveWarmup={(index) => workout.removeWarmup(step.slotId, index)}
              /**
               * Only when there is a round to take: every lift in the block
               * has more than one set and its last one is still pending. A
               * control that refuses on press is a control the reader tries
               * twice — and inside a superset the reducer takes the round off
               * BOTH lifts or neither, so asking only about this one drew a
               * live button that did nothing (PR #93 review): after A1×2 and
               * A2×1 of a two-round block, A2 looked removable and A1 was not.
               *
               * For a lift on its own the block is that lift, so this reads
               * exactly as it did before.
               */
              onRemoveSet={
                (() => {
                  const exercises = workout.activeSession?.exercises ?? [];
                  const index = exercises.findIndex((candidate) => candidate.slotId === step.slotId);
                  if (index === -1) {
                    return null;
                  }
                  const block = supersetGroupIndexes(
                    exercises.map((candidate) => ({
                      supersetGroup: isGuidedExerciseOut(candidate) ? null : candidate.supersetGroup ?? null,
                    })),
                    index,
                  );
                  const removable = block.every((position) => {
                    const sets = exercises[position]?.sets ?? [];
                    return sets.length > 1 && sets[sets.length - 1]?.status === 'pending';
                  });
                  if (!removable) {
                    return null;
                  }
                  return () => {
                    void haptics.select();
                    /**
                     * Only when the step being removed is the one under the
                     * reader's feet.
                     *
                     * The set that goes is always the lift's last. Standing on
                     * it, the list shrinks under the index: the set and the
                     * rest before it are gone, everything after slides down,
                     * and the same index becomes the NEXT lift's first set —
                     * its walk-up skipped. Standing on any earlier set,
                     * nothing in front of the reader moves at all, and
                     * re-resolving would walk them BACK to a walk-up they
                     * have already been through (PR #126 review).
                     */
                    const removedSetIndex = (exercises[index]?.sets.length ?? 0) - 1;
                    if (step.setIndex === removedSetIndex) {
                      // The first thing in this block that is not done yet,
                      // which after the removal is the next lift's lead-in
                      // when the rest of the block is logged.
                      const blockStart = steps.findIndex(
                        (candidate) =>
                          (candidate.type === 'position' || candidate.type === 'set') &&
                          candidate.slotId === step.slotId,
                      );
                      resyncTargetRef.current = blockStart >= 0 ? blockStart : stepIndex;
                    }
                    workout.removeSet(step.slotId);
                  };
                })()
              }
              panels={setPanelSource}
              onOpenSheet={() => setSetPanelsOpen(true)}
              onConfirm={confirmSet}
              // The rest-over cue: the minutes are in, the reader logs them.
              onMinutesReached={() => cue('rest')}
              minutesClock={workout.activeSession?.minutesClock ?? null}
              onMinutesClockChange={workout.setMinutesClock}
              tourTargets={tourTargets}
              // Held while a sheet is open or the workout is paused.
              tourReport={frozen ? undefined : onTourStep}
              tourFocus={tourFocus}
            />
          )}

          {step.type === 'rest' && (
            <StepIn stepKey={`rest-${stepIndex}`}>
              <View style={{ flex: 1, minHeight: 0 }}>
                <GuidedTourReport report={frozen ? undefined : onTourStep} kind="rest" plain={!step.recoveryKind} />
                {/* What was just logged, and a way to fix it.
                    Rest is when a mis-typed rep count is noticed, and until
                    now the only way back was the hardware back button. */}
                {/* The whole session, at the top of the rest — the same sheet the
                    dot rail opens, put where the reader asked for it (user
                    2026-09-09, "paras idea"): logged, here, to come. The "SARJA 2
                    KIRJATTU" card that sat here went into the sheet the same
                    day, Muokkaa with it: the sheet already said what was
                    logged, and the card said it again above it. */}
                <Pressable
                  ref={restStripRef}
                  collapsable={false}
                  accessibilityRole="button"
                  style={styles.restRunStrip}
                  onPress={() => setRunSheetOpen(true)}
                >
                  <Text style={styles.restRunStripText}>{t(language, 'guided.runSheet.title')}</Text>
                  <Text style={styles.restRunStripMeta}>
                    {t(language, 'guided.runSheet.progress', { done: setProgress.done, count: totalSets })}
                  </Text>
                  <GPIcon name="chevR" size={16} color={theme.faint} />
                </Pressable>
                {/* Alerts will not reach the reader — refused, or the rest
                    channel muted in Android settings. The hook decided this
                    for both workout screens, but only the freestyle one drew
                    it, so the player — where most rests happen — ran them
                    silent without a word (2026-09-26). Same copy, same once
                    per session. */}
                {restAsk.deniedBannerShown ? (
                  <View style={styles.restDeniedBanner}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.restDeniedTitle}>{t(language, 'rest.denied.title')}</Text>
                      <Text style={styles.restDeniedBody}>{t(language, 'rest.denied.body')}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        restAsk.dismissDeniedBanner();
                        void restAsk.turnOn(() => onOpenSystemSettings?.());
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.restDeniedAction}>{t(language, 'rest.denied.action')}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <RestRing
                    stepKey={stepIndex}
                    leftSeconds={Math.max(0, secondsLeft)}
                    plannedSeconds={step.seconds}
                    // Neutral: the wait is a wait. An interval's easy half is a
                    // phase of the work, not a pause in it: green, the colour
                    // recovery wears everywhere else in the app.
                    stroke={step.recoveryKind ? theme.green : theme.muted}
                  >
                    <Text
                      style={[styles.restRingLabel, step.recoveryKind ? { color: theme.greenInk } : null]}
                    >
                      {step.recoveryKind
                        ? t(
                            language,
                            step.recoveryKind === 'walk'
                              ? 'guided.interval.walk'
                              : step.recoveryKind === 'rest'
                                ? 'guided.interval.rest'
                                : 'guided.interval.easy',
                          )
                        : t(language, 'guided.rest')}
                    </Text>
                    <Text style={styles.restCountdown} {...RING_CLOCK_FIT}>
                      {formatGuidedCountdown(Math.max(0, secondsLeft))}
                    </Text>
                    {/* No "PAUSED" caption: the button below it has already
                        flipped to Jatka, and a ring frozen mid-sweep is not
                        ambiguous. Asked for 2026-08-21. */}
                  </RestRing>
                  {/* Nothing under the ring. The next set's card ("SEURAAVA ·
                      SARJA 3/5", target, weight, delta) and the "Seuraava · …"
                      line below the buttons said the same thing three ways on
                      a screen the reader called "vähän liikaa kaikkea" (user
                      2026-09-09, from the gym). What was logged, how long is
                      left, three controls, skip. */}
                </View>
                <View style={{ paddingHorizontal: 24, paddingBottom: 10, gap: 12 }}>
                  {/* What comes back after the easy half — the same forward
                      look the work bout gives. */}
                  {step.recoveryKind ? (
                    <Text style={[styles.intervalNext, { textAlign: 'center' }]}>
                      {t(language, 'guided.interval.thenWork')}
                    </Text>
                  ) : null}
                  {/* Red takes time away, green adds it, amber holds — told
                      apart at arm's length without reading (user 2026-09-09,
                      light theme). Green and amber in their INK shades: the
                      raw accents are 3.30:1 and 3.19:1 as text on white, and
                      these are words, not swatches (accessibility audit,
                      2026-09-21). Red already reads (4.83). */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {/* No ±15 s on an interval: its two halves are the rhythm
                        the machine is set to, and stretching one desyncs the
                        reader from the belt they are standing on.

                        The pair is one view so the tour can ring it. Basis 10
                        and twice the growth: each of the two comes out as wide
                        as Pause, as when the three shared the row. */}
                    {step.recoveryKind ? null : (
                    <View ref={restAdjustRef} collapsable={false} style={styles.restAdjustPair}>
                    <View style={{ flex: 1 }}>
                      <GhostBtn
                        label="−15s"
                        tint={theme.danger}
                        accessibilityLabel={t(language, 'rest.a11y.shorten')}
                        onPress={() => {
                          // The rest ring is the one control you use without
                          // looking at it.
                          void haptics.select();
                          adjustRemaining(-15000, 1000);
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <GhostBtn
                        label="+15s"
                        tint={theme.greenInk}
                        accessibilityLabel={t(language, 'rest.a11y.extend')}
                        onPress={() => {
                          void haptics.select();
                          adjustRemaining(15000);
                        }}
                      />
                    </View>
                    </View>
                    )}
                    <View ref={restPauseRef} collapsable={false} style={{ flex: 1 }}>
                      <GhostBtn
                        icon={paused ? 'play' : 'pause'}
                        tint={theme.amberInk}
                        label={t(language, paused ? 'guided.resume' : 'guided.pause')}
                        onPress={paused ? unpause : pause}
                      />
                    </View>
                  </View>
                  {/* No "Swap exercise" here any more (user 2026-08-23): rest
                      is rest, and the swap lives behind the set screen's menu.
                      And no "skip rest" on an interval's easy half: skipping
                      the walk is skipping half the exercise, not shortening a
                      wait (#bugs 2026-08-26). Pause stays on both. */}
                  {step.recoveryKind ? null : (
                    <Pressable
                      ref={restSkipRef}
                      collapsable={false}
                      accessibilityRole="button"
                      style={[styles.skipRestBtn, skipArmedAt !== null && styles.skipRestBtnArmed]}
                      onPress={startRestNextSet}
                    >
                      <GPIcon name="skip" size={18} color={skipArmedAt !== null ? theme.danger : theme.ink} />
                      <Text style={{ fontSize: 15.5, fontWeight: '800', color: skipArmedAt !== null ? theme.danger : theme.ink }}>
                        {t(language, skipArmedAt !== null ? 'guided.skipRest.confirm' : 'guided.skipRest')}
                      </Text>
                    </Pressable>
                  )}
                  {/* Paused on the easy half: the same single way out as the
                      work bout, and nothing else. */}
                  {step.recoveryKind && paused ? (
                    <GhostBtn
                      icon="x"
                      label={t(language, 'guided.action.skipExercise')}
                      onPress={handleSkipExercise}
                    />
                  ) : null}
                </View>
                <ProgressRail
                  groups={phaseRail.groups}
                  current={phaseRail.current}
                  dotIndex={step.setIndex}
                  dotsDone={exerciseBySlot.get(step.slotId)?.sets.filter((set) => set.status === 'completed').length ?? 0}
                  onPress={() => setRunSheetOpen(true)}
                  openLabel={t(language, 'guided.runSheet.open')}
                />
              </View>
            </StepIn>
          )}

          {(step.type === 'drill' || step.type === 'set' || step.type === 'ready' || step.type === 'position') && (
            <ProgressRail
              groups={phaseRail.groups}
              current={phaseRail.current}
              dotIndex={step.type === 'set' ? step.setIndex : 0}
              dotsDone={
                step.type === 'set' || step.type === 'position'
                  ? exerciseBySlot.get(step.slotId)?.sets.filter((set) => set.status === 'completed').length ?? 0
                  : 0
              }
              onPress={() => setRunSheetOpen(true)}
              openLabel={t(language, 'guided.runSheet.open')}
            />
          )}
        </>
      )}

      {mode === 'player' && step.type === 'finish' && (
        <FinishView
          onFinish={onFinishSession}
          saveFailed={saveFailed && !isSavingWorkout}
          language={language}
        />
      )}

      {/* The waiting room for a block you are doing yourself. A clock that
          counts UP, because the app does not know how long your warmup takes
          and should not pretend to — and the drills it would have run, quiet,
          as a reminder rather than a list to obey. */}
      {ownBlock && (
        <View style={styles.ownBlockSheet}>
          {/* The overlay covers the player, top bar included — so it draws its
              own. Without it this was the one screen in the session with no
              way out, no session clock and no sound toggle (device
              2026-09-04). */}
          <TopBar
            dark={false}
            language={language}
            // Still named here, unlike the guided screens: this one has no
            // title of its own, and two clocks under no heading would not say
            // which of them is the block's.
            label={t(
              language,
              ownBlock.phase === 'warmup' ? 'guided.label.warmup' : 'guided.label.cooldown',
            )}
            clock={formatSessionClock(derivedElapsedSeconds)}
            muted={muted}
            onMute={() => onToggleSoundCues(!soundCuesEnabled)}
            onExit={() => setExitOpen(true)}
          />
          {/* Scrolls, because the loads card grows with the session: five
              areas and a flagged one is a card, not a caption. */}
          <ScrollView
            style={{ flex: 1 }}
            // Centred, like every other full-screen block in the player. Left
            // ragged against a centred title it read as crooked (user
            // 2026-09-04).
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              paddingHorizontal: 28,
              paddingVertical: 24,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* The clock, and what it is worth comparing against. Nothing else.
                This carried an eyebrow ("LÄMMITTELET"), a title ("Ota aikasi")
                and a line explaining that a running clock is running — three
                pieces of copy that told the reader what they could already see
                (user 2026-09-04). The top bar says which block this is; the
                Done button says what to do. */}
            <Text style={styles.ownBlockClock}>{formatSessionClock(ownElapsedSeconds)}</Text>
            {ownLastTimeLine ? <Text style={styles.ownBlockHint}>{ownLastTimeLine}</Text> : null}

            {/* "Vinha olisi ehdottanut" and its three drills are gone and stay
                gone: listing what the app would have picked is the app arguing
                with a choice it offered (#bugs 2026-08-26).

                What follows is the opposite claim — not the drills you skipped
                but the work you are about to do. It is the only thing that
                makes a self-run warm-up better rather than merely faster, and
                it never names a drill. */}
            {ownBlock.phase === 'warmup' && (warmupBrief.areas.length > 0 || warmupBrief.firstLift) ? (
              <View style={styles.ownBriefCard}>
                <Text style={styles.ownBriefLabel}>{t(language, 'guided.own.brief.label')}</Text>
                {warmupBrief.areas.length > 0 ? (
                  <View style={styles.ownBriefChips}>
                    {warmupBrief.areas.map((area) => (
                      <View key={area} style={styles.ownBriefChip}>
                        <Text style={styles.ownBriefChipText}>{area}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {warmupBrief.firstLift ? (
                  <View style={styles.ownBriefFirst}>
                    <Text style={styles.ownBriefLabel}>{t(language, 'guided.own.brief.firstLift')}</Text>
                    <Text
                      style={styles.ownBriefFirstName}
                      numberOfLines={1}
                      accessibilityLabel={exerciseNameLabel(language, warmupBrief.firstLift.exerciseName)}
                    >
                      {exerciseListLabel(language, warmupBrief.firstLift.exerciseName)}
                    </Text>
                    <Text style={styles.ownBriefFirstScheme}>{warmupBrief.firstLift.scheme}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
          <View style={{ paddingHorizontal: 24, paddingBottom: 18, gap: 12 }}>
            {/* The way back into the drills, for the reader who opened the
                timer and changed their mind.

                ABOVE the button, not below it. This sheet pads 18px off the
                bottom with no safe-area inset, and that strip is where Android
                draws its own controls — a link put there is one the reader has
                to fight the system bar for, which this app has shipped twice
                already (#bugs 2026-08-28). */}
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setOwnBlock(null)}
              style={{ alignItems: 'center', paddingVertical: 6 }}
            >
              <Text style={styles.startOverText}>
                {t(
                  language,
                  ownBlock.phase === 'warmup' ? 'guided.own.guided.warmup' : 'guided.own.guided.cooldown',
                )}
              </Text>
            </Pressable>
            <BigBtn
              icon="check"
              label={t(
                language,
                ownBlock.phase === 'warmup' ? 'guided.own.done.warmup' : 'guided.own.done.cooldown',
              )}
              onPress={() => finishOwnBlock(true)}
            />
          </View>
        </View>
      )}

      {/* Correcting a set logged on a lift, from the contents sheet — on any
          step, not only a rest: the last set of a lift is followed by a
          walk-up, and a rest-only editor left it uncorrectable (#bugs
          2026-09-30). The step holds still while it is open (`frozen`). */}
      {restEdit ? (
        <LoggedSetEditor
          // No key here: the editor is a Modal, and a new key on a row tap
          // closed it and presented a new one in the same tick, which iOS
          // refuses (iOS hunt 2026-10-17). The editor keys its own fields
          // with this instead.
          fieldsKey={`${restEdit.slotId}-${restEdit.setIndex}`}
          language={language}
          unitPreference={unitPreference}
          // The set is judged as the lift it was logged as — the reducer's
          // rule (liftOfSet). A swap changes the exercise's mode, so reading
          // the exercise here offered a squat set no weight after a swap to a
          // bodyweight lift, and the store refused the save for lacking one.
          unloaded={isUnloadedTrackingMode(restEditLift?.trackingMode ?? 'load_and_reps')}
          liftName={exerciseNameLabel(language, restEditLift?.exerciseName ?? '')}
          title={
            // "Fix the set you just logged" only while that is still the one
            // selected — the moment the reader taps a different row the
            // sheet is no longer talking about "just logged" (#bugs
            // 2026-09-29).
            restEdit.setIndex === restEdit.justLoggedSetIndex
              ? t(language, 'guided.rest.editTitle')
              : t(language, 'guided.rest.editTitleFor', { index: restEdit.setIndex + 1 })
          }
          sets={restEditSets}
          selectedSetIndex={restEdit.setIndex}
          onSelectSet={(setIndex) => setRestEdit((current) => (current ? { ...current, setIndex } : current))}
          setNumber={restEdit.setIndex + 1}
          repsCeiling={
            // The reducer's own ceiling, so Save and the store cannot disagree:
            // a hold's seconds, an interval's work seconds, a prescription past the dial.
            restEditLift
              ? repsCeilingFor(restEditLift, findSetByIndex(exerciseBySlot.get(restEdit.slotId), restEdit.setIndex))
              : REPS_DIAL.max
          }
          reps={findSetByIndex(exerciseBySlot.get(restEdit.slotId), restEdit.setIndex)?.actualReps ?? 0}
          loadKg={findSetByIndex(exerciseBySlot.get(restEdit.slotId), restEdit.setIndex)?.actualLoadKg ?? 0}
          bottomInset={screenInsets.bottom}
          onCancel={() => setRestEdit(null)}
          onSave={(reps, loadKg) => {
            workout.editLoggedSet(restEdit.slotId, restEdit.setIndex, reps, loadKg);
            setRestEdit(null);
          }}
        />
      ) : null}

      {/* The lift's own sheet — photo and setup, the written steps with the
          what to watch for, and eight sessions of history.
          Opened from the card, which is the only door: the header's slot is
          the sound toggle's again. */}
      {setPanelsOpen && step.type === 'set' ? (
        <ExerciseSheet
          visible
          language={language}
          exerciseName={exerciseNameLabel(language, step.exerciseName)}
          imageKey={setPanelSource?.imageKey ?? null}
          initials={setPanelSource?.initials ?? ''}
          instructions={setPanelSource?.instructions ?? []}
          learn={sheetLearn}
          watchFor={sheetWatchFor}
          history={sheetHistory}
          onOpenPro={onOpenPro}
          bottomInset={screenInsets.bottom}
          onClose={() => setSetPanelsOpen(false)}
        />
      ) : null}

      {howtoOpen && (
        <HowToSheetView
          libraryItem={
            step.type === 'drill' || step.type === 'ready'
              ? libraryFor(step.drillName)
              : step.type === 'set' || step.type === 'position'
                ? libraryFor(step.exerciseName)
                : null
          }
          fallbackName={getGuidedStepLabel(step, language)}
          language={language}
          bottomInset={screenInsets.bottom}
          onClose={() => {
            setHowtoOpen(false);
          }}
        />
      )}

      {/* Kept mounted: its "End" hands off to the confirmation, and on iOS
          that waits for this sheet's dismissal (hooks/useModalHandoff). */}
      <GPSheet
          visible={exitOpen}
          onDismissed={onSheetDismissed}
          title={t(language, 'guided.exit.title')}
          language={language}
          onClose={() => setExitOpen(false)}
          bottomInset={screenInsets.bottom}
        >
          <View style={{ gap: 10 }}>
            {/* No "keep training" button.
                Closing the sheet already is keeping training — the grip, the
                scrim and the back button all do it — so the button repeated a
                gesture that was there, and made two real decisions look like
                three (user 2026-08-27). What is left is the two things that
                actually differ in what happens to your sets. The label still
                exists as the confirmation's cancel. */}
            {completedSetCount > 0 ? (
              // Leaving the gym after three of six lifts used to mean either
              // skipping through the rest to reach the finish step, or losing
              // the three. This is the same save the finish step runs — the
              // session ends where it is, and what was logged is kept.
              <BigBtn
                icon="check"
                label={t(language, 'guided.exit.finishSave')}
                onPress={() => {
                  setExitOpen(false);
                  onFinishSession();
                }}
              />
            ) : null}
            {/* Red, because this is the one that throws the sets away. It read
                like the third of three equal choices. */}
            <GhostBtn icon="x" danger label={t(language, 'guided.exit.end')} onPress={handleEndSession} />
          </View>
          {/* No footnote. It existed to explain the difference between three
              buttons, which is a sign the buttons were not explaining
              themselves — and the one thing worth saying, that discarding
              throws the sets away, is now said where it matters: in the
              confirmation, at the moment you press it (#bugs 2026-08-26). */}
        </GPSheet>

      {/*
        The session, read out loud.

        Deliberately inert: nothing here jumps you anywhere. Being able to see
        the fourth lift while resting after the second is a different need from
        wanting to skip to it, and a list you can fall through with a thumb
        while your hands are chalked is how sets get skipped by accident.
      */}
      {/* Kept mounted: its pencils open the set correction, and on iOS that
          waits for this sheet's dismissal (hooks/useModalHandoff). Unmounted,
          it never reported one, and the correction opened in the same tick as
          it closed: iOS refused it and the rest clock stood still (iOS hunt
          2026-10-17). */}
        <GPSheet
          visible={runSheetOpen}
          onDismissed={onSheetDismissed}
          title={t(language, 'guided.runSheet.title')}
          language={language}
          onClose={() => setRunSheetOpen(false)}
          bottomInset={screenInsets.bottom}
          scrollable
        >
          <Deferred render={() => buildGuidedRunSheet(stepPlan, stepIndex).map((item) => {
            const isSuperset = item.members.length > 1;
            return (
            <View
              key={item.groupIndex}
              style={[styles.runRow, isSuperset && styles.runRowSuperset]}
            >
              {/* Two lights running the outline, in opposite directions:
                  one boundary, two lifts inside it, no rest between them.
                  The label sits inside that boundary rather than on each
                  row, because the box is what says "these go together" —
                  A1/A2 on every line was the same fact stated twice. */}
              {isSuperset ? (
                <>
                  <SupersetBorder radius={14} />
                  <View style={styles.runSupersetPill}>
                    <Text style={styles.runSupersetPillText}>
                      {t(language, 'guided.superset.pill')}
                    </Text>
                  </View>
                </>
              ) : null}
              {/* Done / here / to come, as a mark rather than as a colour:
                  the dark theme flattens the accents into each other. */}
              <View
                style={[
                  styles.runDot,
                  item.status === 'done' && { backgroundColor: theme.green, borderColor: theme.green },
                  item.status === 'current' && { backgroundColor: theme.purple, borderColor: theme.purple },
                ]}
              >
                {item.status === 'done' ? <GPIcon name="check" size={11} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                {/* A superset is several lifts in one row of the sheet, and
                    each of them gets its name and its logged sets — a pair
                    drawn as its first lift hides the one you are about to be
                    asked for. An ordinary lift is a row of exactly one. */}
                {item.members.map((member) => {
                  // What is still to do, not what was lifted. The line under each name
                  // carried the logged weights until 2026-09-11, when the reader
                  // asked for "pelkät tulevat sarjat ja toistot" — a sheet read
                  // mid-session is read to find out what is coming, and the weight
                  // you just used is on the screen behind it.
                  //
                  // Not inside a superset, though. A set count per lift asks the
                  // reader to reconcile "4 × 8" with "3 × 10" inside one box, and
                  // the answer is that the box is four ROUNDS — which the box
                  // already says, once, on the right (user 2026-09-11: "ehkä
                  // poistetaan sittenkin molemmat tilastot supersetistä ja se on
                  // vain 4 kierrosta").
                  const memberPlan = !isSuperset ? runPlanLine(member.slotId) : '';
                  // The lift's own way back to its numbers: every lift with a
                  // logged set, on every step, each with its own pencil. It
                  // was one chip on the current row while resting only, so
                  // the last set of a lift — followed by a walk-up, not a
                  // rest — could not be corrected anywhere (#bugs 2026-09-30,
                  // "viimeistä sarjaa on mahdotonta muokata ... jokaiseen
                  // liikkeeseen tulee omansa").
                  const correction = restRoundCorrections([member], exerciseBySlot)[0] ?? null;
                  // "The set you just logged" only where that is true: the
                  // round the running rest belongs to.
                  const justLogged =
                    correction !== null &&
                    step.type === 'rest' &&
                    !step.recoveryKind &&
                    item.status === 'current';
                  return (
                    <View key={member.slotId ?? member.name} style={styles.runMember}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[
                            styles.runName,
                            item.status === 'current' && { color: theme.purple },
                            item.status === 'done' && { color: theme.muted },
                          ]}
                          numberOfLines={2}
                          accessibilityLabel={exerciseNameLabel(language, member.name)}
                        >
                          {exerciseListLabel(language, member.name)}
                        </Text>
                        {memberPlan ? <Text style={styles.runPlan}>{memberPlan}</Text> : null}
                      </View>
                      {correction ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t(language, 'guided.rest.edit')} · ${exerciseNameLabel(language, member.name)}`}
                          hitSlop={6}
                          onPress={() =>
                            handOff(
                              () => setRunSheetOpen(false),
                              () =>
                                setRestEdit({
                                  slotId: correction.lift.slotId,
                                  setIndex: correction.setIndex,
                                  justLoggedSetIndex: justLogged ? correction.setIndex : -1,
                                }),
                            )
                          }
                          // The action colour, on the right where the thumb
                          // is: the one thing in the sheet that does
                          // something (device, 2026-09-16).
                          style={({ pressed }) => [styles.runEditBtn, pressed && { opacity: 0.7 }]}
                        >
                          <GPIcon name="edit" size={17} color={theme.orange} sw={2.4} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                {/* No "Olet tässä" line: the row's colour and its dot say
                    it already, and a third line of the same weight made the
                    one control in the row hard to find (device,
                    2026-09-16). */}
              </View>
              {item.setCount && item.members.length > 1 ? (
                <Text style={styles.runMeta}>
                  {t(language, 'guided.runSheet.rounds', { count: item.setCount })}
                </Text>
              ) : null}
            </View>
            );
          })} />
        </GPSheet>

      {/* Kept mounted: three of its rows open another modal, and on iOS that
          waits for this sheet's dismissal (hooks/useModalHandoff). */}
      <GPSheet
          visible={pauseSheetOpen}
          onDismissed={onSheetDismissed}
          title={t(language, 'guided.pauseSheet.title')}
          language={language}
          onClose={() => {
            setPauseSheetOpen(false);
            closeActionsMenu();
          }}
          bottomInset={screenInsets.bottom}
        >
          <View style={{ gap: 10 }}>
            {/* No "Jatka": closing the sheet is resuming, and the scrim and
                the back button both close it. What is left is about the lift
                (user 2026-09-09, "jätä vain nuo kaksi"). */}
            {/* The whole session, from mid-set. The rest has its strip and the
                rail its dots; a set screen had neither, so this is the third
                door, where the reader asked for it (user 2026-09-09). */}
            <GhostBtn
              label={t(language, 'guided.runSheet.title')}
              onPress={() => {
                moveOnFromMenu();
                handOff(
                  () => setPauseSheetOpen(false),
                  () => setRunSheetOpen(true),
                );
              }}
            />
            {/* "One back" and "skip this" are gone. Two skips a thumb's width
                apart — one for the set, one for the exercise — is a pair you
                pick between by reading, on a sheet you opened mid-set; and
                stepping back is not something a reader asked for once
                (#bugs 2026-08-26). Skipping the exercise is the one that
                survives, in red and behind a confirmation. */}
            {/* Mid-block, the same escape: this sheet is already the "I need to
                do something else" surface. */}
            {skippablePhase ? (
              <GhostBtn
                icon="check"
                label={t(language, `guided.own.${skippablePhase}` as 'guided.own.warmup')}
                onPress={() => {
                  setPauseSheetOpen(false);
                  moveOnFromMenu();
                  setOwnBlock({ phase: skippablePhase, startedAt: Date.now() });
                }}
              />
            ) : null}
            {/* No sound row. It lived here while the set screen's top-right
                slot held the exercise info; the info moved to the lift's card
                on 2026-09-04 and the speaker went back to the header, so this
                was the same switch in two places (user 2026-09-04). */}
            {actionExercise ? (
              <>
                {/* No name header: the exercise is already the biggest thing on
                    the screen behind this sheet, and repeating it here read as
                    a heading that had wandered in. And no "add set" — the set
                    row at the top of the workout has the + already, which is
                    where a set is added from (#bugs 2026-08-26). */}
                {/* No longer gated on the substitution group: the sheet
                    searches the whole library, so there is always something
                    behind this row. */}
                {actionExercise ? (
                  <GhostBtn
                    icon="swap"
                    label={t(language, 'guided.action.swap')}
                    onPress={() =>
                      handOff(
                        () => setPauseSheetOpen(false),
                        () => setSwapOpen(true),
                      )
                    }
                  />
                ) : null}
                {/* Red, and it asks. This sat between two other outlined rows
                    and threw away a whole exercise on one tap. The question
                    comes after the sheet has gone: asked over it, iOS froze
                    the app (#bugs 2026-10-17). */}
                <GhostBtn
                  icon="x"
                  danger
                  label={t(language, 'guided.action.skipExercise')}
                  onPress={() =>
                    handOff(
                      () => setPauseSheetOpen(false),
                      () => setConfirmingSkipExercise(true),
                    )
                  }
                />
              </>
            ) : null}
          </View>
        </GPSheet>

      {/* Swapping a lift.

          This used to be the substitution group and nothing else, and the
          button that opened it hid itself when that group was empty — which is
          exactly the moment a reader wants it, standing at a machine somebody
          else is using. The group is still the top of the list, because a
          programme's own alternatives are better answers than a search. The
          library is under it so there is always an answer at all. */}
      <ConfirmDialog
        language={language}
        visible={confirmingEnd}
        destructive
        title={t(language, 'guided.endConfirm.title')}
        message={t(
          language,
          completedSetCount === 1 ? 'guided.endConfirm.bodyOne' : 'guided.endConfirm.bodyMany',
          { count: completedSetCount },
        )}
        confirmLabel={t(language, 'guided.exit.end')}
        cancelLabel={t(language, 'guided.exit.keep')}
        onCancel={() => setConfirmingEnd(false)}
        onConfirm={() => {
          setConfirmingEnd(false);
          onEndSession();
        }}
      />
      <ConfirmDialog
        visible={confirmingSkipExercise}
        language={language}
        destructive
        title={t(language, 'guided.skipExercise.title')}
        message={t(language, 'guided.skipExercise.body')}
        confirmLabel={t(language, 'guided.skipExercise.confirm')}
        cancelLabel={t(language, 'guided.exit.keep')}
        // The actions sheet has already gone (handOff above), so "keep it"
        // is closing that menu: the pause it found comes back.
        onCancel={() => {
          setConfirmingSkipExercise(false);
          closeActionsMenu();
        }}
        onConfirm={() => {
          setConfirmingSkipExercise(false);
          handleSkipExercise();
        }}
      />

      {/*
        "Vaihda liike" is the add sheet, in swap mode (#bugs 2026-10-06:
        "Vaihda liike ja Lisää liike pitäisi olla identtiset"). The same
        search, the same three filter groups, the same cards; what differs is
        said by lib/exerciseSheetMode — the title names the lift, the cards say
        Vaihda, and the note under the title says the logged sets stay where
        they were done. What is offered and in what order is still the swap's
        own: the programme's alternatives first (swapFeaturedEntries), then
        the library nearest the lift (swapLibrary), the lift's own body part
        until the reader picks a chip.
      */}
      <ExercisePickerSheet
        visible={swapOpen && Boolean(actionExercise)}
        bottomInset={screenInsets.bottom}
        language={language}
        mode="swap"
        swappedName={actionExercise?.exerciseName ?? null}
        search={swapQuery}
        onSearchChange={setSwapQuery}
        filters={swapFilters}
        onFiltersChange={(next) => {
          // Only a chip the reader actually moved becomes theirs: the lift's
          // own body part stays the default until then (effectiveSwapBodyPart).
          if (next.bodyPart !== swapFilters.bodyPart) {
            setSwapBodyPartFilter(next.bodyPart);
          }
          if (next.category !== swapFilters.category) {
            setSwapCategoryPick(next.category);
          }
          setSwapEquipment(next.equipment);
        }}
        featured={
          swapFeaturedEntries.length > 0
            ? { title: exerciseSheetCopy('swap', language).featuredTitle, entries: swapFeaturedEntries }
            : null
        }
        main={{
          // "All exercises" over a list a chip just narrowed to one body part
          // claimed a completeness the row no longer had (break round
          // 2026-09-29). The chip's own label replaces it while one is picked.
          title:
            swapBodyPart !== 'all'
              ? libraryLabel(swapBodyPart, language)
              : t(language, 'guided.swap.library'),
          entries: swapLibraryEntries,
        }}
        emptyTitle={t(language, 'guided.swap.noMatch')}
        emptyBody={null}
        listNote={
          swapSessionHits.length > 0
            ? t(language, 'swap.alreadyInSession', { names: swapSessionHits.join(', ') })
            : null
        }
        commitsOnTap
        onSelect={(entry) => applySwap(entry.name)}
        onClose={() => {
          setSwapOpen(false);
          setSwapQuery('');
          setSwapBodyPartFilter(null);
          setSwapCategoryPick(null);
          setSwapEquipment('all');
          closeActionsMenu();
        }}
      />

      {/* The cooldown intro's "Lisää liike": the same library sheet the day
          editor uses, so search and the body-part chips are the ones the
          reader already knows. Single-select — one lift at a time, added
          straight into today's session rather than a template. */}
      <AddExerciseSheet
        bottomInset={screenInsets.bottom}
        visible={addExerciseOpen}
        language={language}
        items={exerciseLibrary}
        recentItems={NO_RECENT_EXERCISES}
        title={t(language, 'guided.own.addExercise')}
        onClose={() => setAddExerciseOpen(false)}
        onSelectItem={addMidWorkoutExercise}
      />

      <RestAlertsSheet
        visible={restAsk.sheetOpen}
        language={language}
        bottomInset={screenInsets.bottom}
        onAllow={() => void restAsk.allow()}
        onLater={restAsk.later}
      />

      {/*
        Locked while Finish saves (bug hunt 2026-10-03). The save is the session as it stood when
        Finish was pressed; a set ticked during the await reached the reducer and the slot history,
        was not in the saved workout, and went with the finished session when it was cleared.
        This layer takes every touch on the player until the save resolves (the screen is then
        left) or fails (isSavingWorkout goes false, and the save-failed panel and its retry are
        reachable). The sheets are Modals and draw above it, which is safe: none is open when a
        save starts (Finish closes the exit sheet first, and every other sheet opens from a touch,
        which this layer takes), and the one that can open by itself, the rest-alerts ask, logs
        nothing. The free workout board holds its edits the same way while its Finish is in flight.

        No timeout releases it. A save that hangs leaves the player locked, and that is the right
        failure: releasing it would reopen the window where a set is ticked, left out of the save
        and cleared with the session. The session is persisted active, so killing the app and
        reopening it recovers every logged set.
      */}
      {isSavingWorkout ? <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} /> : null}
    </View>
  );
}

/** "3 min" for whole minutes, otherwise plain seconds ("50s"). */
function formatDrillLength(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} min`;
  }
  if (seconds >= 90) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

/**
 * "3–5" from the planned rep range, collapsing equal bounds to "5" — or the
 * set's target where it falls outside the range: lowered after a short
 * session, or a bodyweight lift raised past the top (lib/guidedPlayer
 * planRepsBounds; a hold's carried seconds clamped as its dial clamps them).
 * The overview says what the dial will open on.
 */
function formatRepRangeLabel(
  set: { plannedRepsMin: number; plannedRepsMax: number; plannedTargetReps?: number } | undefined,
  trackingMode: string,
): string {
  if (!set) {
    return '';
  }
  return formatGuidedRepsLabel(set, trackingMode);
}

/**
 * The set a plan line describes: the next one still to do. A swap rewrites
 * only the sets ahead, so a set logged before it keeps the old lift's
 * prescription — `sets[0]` described a lift no longer in the slot.
 */
function planSetOf<T extends { status: string }>(sets: T[]): T | undefined {
  return sets.find((set) => set.status === 'pending') ?? sets[sets.length - 1];
}

/**
 * Session clock for the set screen's top-right readout: m:ss, growing to
 * h:mm:ss so a session left running overnight stays readable. The rest bar's
 * clock, so the free workout's header reads the same past the hour.
 */
const formatSessionClock = formatClock;

/* ── strength set step v4 (owns the reps/kg steppers) ── */
/**
 * The two numbers of a logged set, and a way to change them.
 *
 * Deliberately not the set screen's dial cards: those are built for a set you
 * are about to do, with a progression badge and a target underneath. This is a
 * correction — two fields and a save — so it says nothing about what the app
 * would have picked.
 */
function LoggedSetEditor({
  fieldsKey,
  language,
  unitPreference,
  unloaded,
  liftName,
  title,
  sets,
  selectedSetIndex,
  onSelectSet,
  setNumber,
  repsCeiling,
  reps,
  loadKg,
  bottomInset,
  onCancel,
  onSave,
}: {
  /** Which set the fields edit: a new one gets fresh drafts. */
  fieldsKey: string;
  language: AppLanguage;
  unitPreference: UnitPreference;
  unloaded: boolean;
  /**
   * Which lift, above the title. The sheet opens from any lift's pencil in the
   * contents sheet now, not only from the rest after it — "Korjaa sarja 3"
   * alone does not say whose (#bugs 2026-09-30).
   */
  liftName: string;
  /** Follows which set is selected — "Correct set N", or the just-logged
   * wording while that is still the one picked. Decided by the caller,
   * which is also the one that knows which set was "just logged". */
  title: string;
  /**
   * Every set already logged for this lift, oldest first — the rows the
   * reader can tap to correct a set other than the one the sheet opened on
   * (#bugs 2026-09-29, "näkyis kaikki tehdyt sarjat"). Not shown at all when
   * there is only the one: a list of one row taught nothing a title already
   * said.
   */
  sets: LoggedSetRow[];
  selectedSetIndex: number;
  onSelectSet: (setIndex: number) => void;
  /** The set being corrected, as the screen counts it (1-based). */
  setNumber: number;
  /** The most this set can count — the store's rule, see repsCeilingFor. */
  repsCeiling: number;
  reps: number;
  loadKg: number;
  /**
   * Safe-area inset, read on the screen — inside this Modal
   * `useSafeAreaInsets` itself always answers 0.
   */
  bottomInset: number;
  onCancel: () => void;
  onSave: (reps: number, loadKg: number | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  // Lifted onto the keyboard, the sheet no longer meets the home indicator.
  const keyboard = useKeyboardOpen();
  const onKeys = Platform.OS === 'ios' && keyboard.open;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {/* iOS does not lift a Modal's content for the keyboard, and the number
          pad covered the fields and Save whole (iOS hunt 2026-10-17). Inside
          the Modal this view starts at the top of the screen, so it needs no
          offset. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.editVeil}
      >
        {/* A tap on the dimmed page with the keyboard up puts the keyboard
            away; it used to be the only way out of the number pad, and it
            threw the correction away. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (Keyboard.isVisible() ? Keyboard.dismiss() : onCancel())}
          accessible={false}
        />
        <View style={[styles.editSheet, { paddingBottom: (onKeys ? 0 : bottomInset) + 20 }]}>
          <View style={{ gap: 2 }}>
            <Text style={styles.editLiftName} numberOfLines={1}>
              {liftName}
            </Text>
            <Text style={styles.editTitle}>{title}</Text>
          </View>
          {/* Every set already logged for this lift, so the reader is not
              limited to the one the sheet opened on. A single row would only
              repeat the title, so the list appears once there is a choice to
              make. */}
          {sets.length > 1 ? (
            <View style={{ gap: 6 }}>
              {sets.map((row) => {
                const selected = row.setIndex === selectedSetIndex;
                // Each row judges itself — `unloaded` above is the sheet's
                // currently SELECTED set, and after a mid-exercise swap
                // between a loaded and an unloaded lift that is not every
                // row's own answer. A 100 kg squat set shown as bare reps,
                // or a bodyweight set shown with a weight, is the bug this
                // guards (break round 2026-09-29).
                const rowUnloaded = isUnloadedTrackingMode(row.trackingMode);
                const detail = rowUnloaded
                  ? unloadedSetRowLabel(row.reps, language)
                  : t(language, 'guided.rest.setRow', {
                      weight: formatWeight(row.loadKg, unitPreference),
                      reps: row.reps,
                    });
                return (
                  <Pressable
                    key={row.setIndex}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectSet(row.setIndex)}
                    style={[styles.editSetRow, selected && styles.editSetRowSelected]}
                  >
                    <Text
                      style={[styles.editSetRowText, selected && styles.editSetRowTextSelected]}
                      numberOfLines={1}
                    >
                      {t(language, 'guided.rest.setRowLabel', { index: row.setIndex + 1, detail })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {/* A fresh set of draft fields for the set the reader just picked:
              switching rows must not keep the previous set's typed text
              sitting over the newly selected one's numbers. Keyed here, inside
              the Modal, so the Modal itself stays. */}
          <LoggedSetEditorFields
            key={fieldsKey}
            language={language}
            unloaded={unloaded}
            setNumber={setNumber}
            repsCeiling={repsCeiling}
            reps={reps}
            loadKg={loadKg}
            onCancel={onCancel}
            onSave={onSave}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The correction's two fields and its buttons, with their drafts. */
function LoggedSetEditorFields({
  language,
  unloaded,
  setNumber,
  repsCeiling,
  reps,
  loadKg,
  onCancel,
  onSave,
}: {
  language: AppLanguage;
  unloaded: boolean;
  setNumber: number;
  repsCeiling: number;
  reps: number;
  loadKg: number;
  onCancel: () => void;
  onSave: (reps: number, loadKg: number | null) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [repsDraft, setRepsDraft] = useState(String(reps));
  const [loadDraft, setLoadDraft] = useState(removeTrailingZeros(loadKg));

  const typedReps = parseNumberInput(repsDraft);
  const typedLoad = unloaded ? null : parseNumberInput(loadDraft);
  const nextReps = Math.round(typedReps ?? reps);
  const nextLoad = unloaded ? null : typedLoad ?? loadKg;
  // The dials' own ceilings. Without them "825" for 82,5 saved, showed on the
  // summary, and was then dropped from the log on the next load — and opened
  // the next session at 825.
  // And a field that holds no number — emptied, or "82,,5" — is not the old
  // number: it saved the value from before the edit while the field showed
  // something else (decimal audit, 2026-09-21).
  const valid =
    typedReps !== null &&
    nextReps > 0 &&
    nextReps <= repsCeiling &&
    (unloaded || (typedLoad !== null && isLiftableWeight(nextLoad)));

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={styles.editField}>
          <Text style={styles.editLabel}>{t(language, 'guided.reps')}</Text>
          {/* Named with the set and the unit: the label above is a
              sibling Text, so the field alone was read as its number
              (accessibility audit, 2026-09-21). */}
          <TextInput
            value={repsDraft}
            onChangeText={setRepsDraft}
            accessibilityLabel={setFieldAccessibilityLabel(language, 'reps', setNumber)}
            keyboardType="number-pad"
            // The iPhone number pad has no return key: without these the
            // only way off it was the dimmed page, which cancelled.
            returnKeyType="done"
            inputAccessoryViewButtonLabel={t(language, 'common.done')}
            selectTextOnFocus
            style={styles.editInput}
          />
        </View>
        {unloaded ? null : (
          <View style={styles.editField}>
            <Text style={styles.editLabel}>{t(language, 'guided.weight')}</Text>
            <TextInput
              value={loadDraft}
              onChangeText={setLoadDraft}
              accessibilityLabel={setFieldAccessibilityLabel(language, 'kg', setNumber)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              inputAccessoryViewButtonLabel={t(language, 'common.done')}
              selectTextOnFocus
              style={styles.editInput}
            />
          </View>
        )}
      </View>
      {/* Two buttons of one size. BigBtn is 60 tall and GhostBtn 48, which
          is right where one leads and the other follows — here they are a
          pair, and a pair that does not match reads as a mistake (user
          2026-09-04). */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={[styles.editBtn, styles.editBtnGhost]}
        >
          <Text style={styles.editBtnGhostText}>{t(language, 'common.cancel')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid }}
          onPress={() => {
            if (valid) {
              onSave(nextReps, nextLoad);
            }
          }}
          style={[styles.editBtn, { backgroundColor: valid ? theme.accent : theme.faint }]}
        >
          <GPIcon name="check" size={17} color={theme.onHighlight} sw={2.6} />
          <Text style={[styles.editBtnText, { color: theme.onHighlight }]}>
            {t(language, 'guided.rest.editSave')}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * A minutes bout's running clock. It owns the one-second interval that moves
 * its digits, so the set step around it does not re-render for them: the step
 * only needs the whole minutes and "the minutes are in" (SetStepView sleeps
 * until lib/minutesExercises msUntilNextMinutesChange). The time is read off
 * the stopwatch's wall-clock start, so a tick that comes late shows the right
 * second, not a lost one.
 */
function MinutesClockText({ watch, style }: { watch: MinutesStopwatch; style: React.ComponentProps<typeof Text>['style'] }) {
  const running = watch.runningSinceMs !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    if (!running) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, watch]);
  return (
    <Text style={style} {...RING_CLOCK_FIT}>
      {formatCardioDuration(stopwatchElapsedMs(watch, nowMs) / 1000)}
    </Text>
  );
}

function SetStepView({
  stepIndex,
  step,
  exercise,
  superset,
  language,
  paused,
  progressionOn,
  resolveTarget,
  onPause,
  onOpenActions,
  onAddSet,
  onRemoveSet,
  onLogWarmup,
  onRemoveWarmup,
  panels,
  onOpenSheet,
  onConfirm,
  onMinutesReached,
  minutesClock,
  onMinutesClockChange,
  tourTargets,
  tourReport,
  tourFocus = null,
}: {
  stepIndex: number;
  step: Extract<GuidedStep, { type: 'set' }>;
  exercise: WorkoutExerciseInstance | null;
  /** The whole superset this set belongs to, in order. Null for a lift on its own. */
  superset: { members: Array<{ slotId: string; name: string }> } | null;
  language: AppLanguage;
  paused: boolean;
  /** Automated progression on: today's weight gets its arrow. */
  progressionOn: boolean;
  /** Opens the exercise sheet; the card is the only door to it. */
  onOpenSheet: () => void;
  resolveTarget: (slotId: string, setIndex: number) => GuidedSetTarget | null;
  onPause: () => void;
  onOpenActions: () => void;
  onAddSet: () => void;
  /** Absent when there is no set to take back. */
  onRemoveSet?: (() => void) | null;
  /** "+ Warm-up set": logs one apart from the working sets. */
  onLogWarmup: (loadKg: number, reps: number) => void;
  /** Takes back the logged warm-up at `index`. */
  onRemoveWarmup: (index: number) => void;
  /** Resolved by the player; null falls back to the plain photo. */
  panels: {
    history: LastTimeView | null;
    instructions: string[];
    imageKey: string | null;
    initials: string;
  } | null;
  onConfirm: (slotId: string, setIndex: number, reps: number, loadKg: number | null) => void;
  /** A bout of minutes reached its prescription on the clock — a cue, nothing logged. */
  onMinutesReached?: () => void;
  /** The bout's stopwatch as the session keeps it; read when the set opens. */
  minutesClock?: SessionMinutesClock | null;
  /** The stopwatch started or paused, for the session to keep. */
  onMinutesClockChange?: (clock: SessionMinutesClock) => void;
  /** The first-run tour: where the card, the rows and the buttons are. */
  tourTargets?: TourTargetRegistry;
  /** Reports this set to the workout tour; undefined while the player is held. */
  tourReport?: (step: WorkoutTourStep | null) => void;
  /** What the tour's current beat is about. */
  tourFocus?: TourTargetId | null;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const nameRef = useTourTarget(tourTargets, 'workout.name');
  const historyRef = useTourTarget(tourTargets, 'workout.history');
  const setRowRef = useTourTarget(tourTargets, 'workout.setRow');
  const dialsRef = useTourTarget(tourTargets, 'workout.dials');
  const pauseRef = useTourTarget(tourTargets, 'workout.pause');
  const menuRef = useTourTarget(tourTargets, 'workout.menu');
  const logSetRef = useTourTarget(tourTargets, 'workout.logSet');
  // The history beat's second half: the set being done is drawn as logged.
  const showLoggedDemo = tourFocus === 'workout.historyLogged';

  const target = resolveTarget(step.slotId, step.setIndex);
  // A hold logs no weight either, so it takes the same wide layout — but its
  // number is seconds, and seconds are dialled in fives, not ones.
  const bodyweight = exercise ? isUnloadedTrackingMode(exercise.trackingMode) : false;
  // Uniform stays the plain rep-chip row it always was; a ramp gets weight×reps
  // on every chip instead of one heading number, so it reads as a ramp rather
  // than a single weight with an unexplained jump partway through (#bugs 2026-09-29).
  const historyChips = panels?.history ? summarizeHistoricalSetChips(panels.history.sets) : null;
  const thumbSource = getExerciseImageSource(panels?.imageKey);
  const timed = exercise ? isTimedTrackingMode(exercise.trackingMode) : false;
  const [reps, setReps] = useState(target?.reps ?? 8);
  /**
   * A bout of minutes (trackingMode 'duration_minutes' — a bike, a stair
   * machine, a run block): the set is a clock the reader starts, pauses and
   * stops, and the dial below logs whole minutes. Left alone, the dial
   * follows the clock — or the prescription, if the clock never ran — so
   * twenty minutes ridden logs twenty without a tap (lib/minutesExercises
   * minutesToLog). Touched, the dial is the reader's number.
   *
   * The clock is read off the wall, not ticks, so it keeps counting with the
   * screen off. Every start and pause is kept on the session, so a screen
   * mounted again — Android killing the app mid-ride — opens on the clock
   * where it stood, still running, instead of at zero (#bugs 2026-10-06).
   */
  const minutesMode = exercise ? isMinutesTrackingMode(exercise.trackingMode) : false;
  // The lift in the slot now: sets done before a swap were another lift's.
  const liftSets = exercise ? setsOfCurrentLift(exercise) : [];
  const todayPlan =
    exercise && !minutesMode
      ? resolveGuidedSetPlan(liftSets, step.setIndex, exercise.trackingMode, exercise.swappedAfterSetIndex, exercise)
      : [];
  const plannedMinutes = target?.reps ?? 0;
  const keptWatch = () =>
    stopwatchForSet(minutesClock, { slotId: step.slotId, setIndex: step.setIndex, exerciseName: step.exerciseName });
  /** A clock that comes back already past the prescription has given its cue. */
  const reachedOnArrival = (kept: MinutesStopwatch) =>
    plannedMinutes > 0 && stopwatchElapsedMs(kept, Date.now()) >= plannedMinutes * 60000;
  const [watch, setWatch] = useState<MinutesStopwatch>(keptWatch);
  const keepWatch = (next: MinutesStopwatch) => {
    setWatch(next);
    if (minutesMode) {
      onMinutesClockChange?.({
        slotId: step.slotId,
        setIndex: step.setIndex,
        exerciseName: step.exerciseName,
        plannedMinutes,
        ...next,
      });
    }
  };
  const [watchNowMs, setWatchNowMs] = useState(() => Date.now());
  const minutesChosenRef = useRef(false);
  const [minutesChosen, setMinutesChosen] = useState(false);
  const watchRunning = watch.runningSinceMs !== null;
  // This step re-renders when the clock changes something it shows besides
  // the seconds — the whole minutes on the dial, "the minutes are in" — and
  // sleeps in between. A 500 ms state tick here re-rendered the entire set
  // step (dials, history chips, panels) twice a second for a clock whose
  // seconds MinutesClockText draws on its own.
  useEffect(() => {
    const wait = msUntilNextMinutesChange(watch, Date.now(), plannedMinutes);
    if (wait === null) {
      return;
    }
    // A few ms past the moment, so the wake-up lands on the far side of it.
    const timer = setTimeout(() => setWatchNowMs(Date.now()), wait + 20);
    return () => clearTimeout(timer);
  }, [watch, watchNowMs, plannedMinutes]);
  const elapsedMs = stopwatchElapsedMs(watch, watchNowMs);
  const shownMinutes = minutesChosen ? reps : minutesToLog({ plannedMinutes, elapsedMs });
  const shownMinutesRef = useRef(shownMinutes);
  shownMinutesRef.current = shownMinutes;
  const minutesReached = minutesMode && plannedMinutes > 0 && elapsedMs >= plannedMinutes * 60000;
  const minutesReachedRef = useRef<boolean | null>(null);
  if (minutesReachedRef.current === null) {
    minutesReachedRef.current = reachedOnArrival(watch);
  }
  useEffect(() => {
    if (minutesReached && !minutesReachedRef.current) {
      minutesReachedRef.current = true;
      onMinutesReached?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutesReached]);
  // Pausing the workout pauses the bout: the header's pause means "I have
  // stopped", and a clock that ran on through it would log the break.
  useEffect(() => {
    if (paused && watch.runningSinceMs !== null) {
      keepWatch(pauseStopwatch(watch, Date.now()));
    } else if (!paused && menuStoppedWatchRef.current) {
      // The menu stopped it, not a Pause the reader chose: the menu giving
      // the workout back gives the bout its clock back.
      menuStoppedWatchRef.current = false;
      const now = Date.now();
      setWatchNowMs(now);
      keepWatch(startStopwatch(watch, now));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  /** Set when the actions menu opened over a running bout clock (it pauses the workout, and the clock with it). */
  const menuStoppedWatchRef = useRef(false);
  const openActions = () => {
    menuStoppedWatchRef.current = minutesMode && !paused && watch.runningSinceMs !== null;
    onOpenActions();
  };
  const toggleWatch = () => {
    const now = Date.now();
    setWatchNowMs(now);
    keepWatch(watch.runningSinceMs === null ? startStopwatch(watch, now) : pauseStopwatch(watch, now));
  };
  /** The first touch of the dial takes it from the clock, from where it stood. */
  const stepMinutes = (direction: -1 | 1) => {
    if (!minutesChosenRef.current) {
      minutesChosenRef.current = true;
      setMinutesChosen(true);
      setReps(stepDialReps(shownMinutesRef.current, direction, MINUTES_DIAL));
      return;
    }
    setReps((current) => stepDialReps(current, direction, MINUTES_DIAL));
  };
  const commitMinutes = (text: string) => {
    const base = minutesChosenRef.current ? reps : shownMinutesRef.current;
    minutesChosenRef.current = true;
    setMinutesChosen(true);
    setReps(commitDialReps(text, base, MINUTES_DIAL));
  };
  const [kg, setKg] = useState(target?.loadKg ?? 0);
  /**
   * "No weight set" has been said for this set: the next Log set logs it
   * without weight (lib/zeroWeightLog; owner's #9).
   */
  const [zeroWeightAsked, setZeroWeightAsked] = useState(false);
  useEffect(() => {
    setZeroWeightAsked(false);
  }, [stepIndex]);
  /** Which dial is open for editing; null = both locked. */
  const [dial, setDial] = useState<'reps' | 'weight' | null>(null);
  /**
   * A dial is being typed with the on-screen keys up.
   *
   * The keys leave about sixty points above the dials on a 6.1" iPhone, and
   * the lift's card, cut to that, read as the dials lying over it (#bugs
   * 2026-10-18, iOS build 5; the owner's #2 of 2026-10-17 again). While the
   * keys are up only the lift's name stays, on one line that gives way first.
   * A hardware keyboard takes no room, and the card stays.
   */
  const keyboard = useKeyboardOpen();
  const typingKeys = dial !== null && keyboard.open;
  /**
   * The open field holds text that is not a weight — "825" for 82,5, or
   * "82,,5" — or a count the set cannot have: 0 reps, 350, a hold under five
   * seconds. The dial keeps its last good number meanwhile, so logging would
   * write a number the field does not show; the log button waits instead.
   * Only while the field is open: closing it shows the number the dial kept.
   */
  const [typedTextInvalid, setTypedTextInvalid] = useState(false);
  /**
   * The text is short of the floor but could still get there ("3" on the way
   * to 30 s): Log waits, and the field is not flagged yet.
   */
  const [typedTextPending, setTypedTextPending] = useState(false);
  useEffect(() => {
    setTypedTextInvalid(false);
    setTypedTextPending(false);
  }, [dial, stepIndex]);
  const logBlocked = dial !== null && typedTextInvalid;
  const typedErrorShown = logBlocked && !typedTextPending;
  /**
   * Log is dead only when the field is flagged. While the text could still
   * become loggable ("3" on the way to 30 s) the button stays pressable: a
   * press then shows the message and logs nothing, instead of a button that
   * does nothing and says nothing.
   */
  const logDisabled = logBlocked && !typedTextPending;
  const logWaitsOnTypedText = () => {
    if (!logBlocked) {
      return false;
    }
    setTypedTextPending(false);
    return true;
  };

  /**
   * Five chips a line (#bugs 2026-10-10, "näytetään vain 5 kerralla"): an
   * 11-set lift scrolled to a row of ten with the last one cut at the edge.
   * Each line's window moves with the set being done, so today's ringed chip
   * is always one of its five and, while both lines are long, last time's
   * chips stay over today's. Each is held to its own length: one shared
   * window cut a three-set last time down to one chip by set 7.
   */
  // Both lines follow the set's place within the lift, not the slot: after a
  // swap the slot's earlier sets were another lift's.
  const liftPosition = liftSets.filter((set) => set.setIndex < step.setIndex).length;
  const lastChipWindow = guidedWindow(panels?.history?.sets.length ?? 0, liftPosition, GUIDED_CARD_CHIP_CAP);
  const todayChipWindow = guidedWindow(todayPlan.length, liftPosition, GUIDED_CARD_CHIP_CAP);
  /**
   * The set row's boxes: up to six, as many as the row has room for, so none
   * is drawn cut in half — and the −/+ after them stand still however many
   * sets there are (#bugs 2026-10-10, "+- merkit ei saisi liikkua
   * mihinkään"). The counter says the true number.
   */
  const [setBoxRoom, setSetBoxRoom] = useState(0);
  const setBoxCount = Math.min(
    step.setCount,
    guidedBoxesThatFit(setBoxRoom, SET_DOT_SIZE, SET_DOT_GAP, GUIDED_SET_BOX_CAP),
  );
  const setBoxWindow = guidedWindow(step.setCount, step.setIndex, setBoxCount);

  /**
   * "+ Warm-up set" (user, 2026-10-05): the screen turns blue and logs a
   * warm-up instead of the set — kept apart from the working sets, so the
   * count, the steps and progression never see it. Offered before the first
   * working set of a loaded lift only: a warm-up is what comes before the
   * work, and a bodyweight lift or a hold has no load to build up to.
   */
  const [warmupMode, setWarmupMode] = useState(false);
  const warmups = exercise?.warmups ?? [];
  const firstSetOpen = exercise !== null && step.setIndex === 0 && exercise.sets[0]?.status !== 'completed';
  const canWarmUp = !bodyweight && firstSetOpen;
  const inWarmup = warmupMode && canWarmUp;
  /** What the reps dial accepts: a warm-up is held to the store's lower ceiling. */
  const repsBounds = inWarmup ? WARMUP_REPS_DIAL : minutesMode ? MINUTES_DIAL : timed ? HOLD_DIAL : REPS_DIAL;
  /**
   * Today's weight beside today's chips, as last time's stands beside its own
   * (#bugs 2026-10-10). The set being done counts at its dial, so the number
   * moves with the thumb — but not in warm-up mode, where the dial holds the
   * warm-up's load and not the set's. Not for a lift that carries no weight.
   */
  const todayKg =
    exercise && !bodyweight && !minutesMode
      ? guidedTodayLoadKg({
          sets: liftSets,
          currentSetIndex: step.setIndex,
          currentKg: !inWarmup && Number.isFinite(kg) && kg > 0 ? kg : null,
          trackingMode: exercise.trackingMode,
          swappedAfterSetIndex: exercise.swappedAfterSetIndex,
          lift: exercise,
        })
      : null;
  // Against the same sets last time — not a set added on the day, nor the top
  // of a pyramid a lighter session drops (lib/guidedSetRow guidedLastLoadKg).
  const todayTrend = guidedLoadTrend({
    lastKg: guidedLastLoadKg(panels?.history?.sets, liftSets),
    todayKg,
    progressionOn,
  });

  /**
   * The set's own numbers while a warm-up borrows the dials: a weight dialled
   * for set 1 before "+ Warm-up set" comes back after it, not the plan's
   * (review, 2026-10-05).
   */
  const setNumbersRef = useRef<{ reps: number; kg: number } | null>(null);
  const enterWarmup = () => {
    setNumbersRef.current = { reps, kg };
    const offer = warmupOffer(panels?.history?.warmups, warmups.length, target?.loadKg ?? null);
    setDial(null);
    setReps(offer.reps);
    setKg(offer.loadKg ?? 0);
    setWarmupMode(true);
  };
  const leaveWarmup = () => {
    const kept = setNumbersRef.current;
    setNumbersRef.current = null;
    setDial(null);
    setReps(kept?.reps ?? target?.reps ?? 8);
    setKg(kept?.kg ?? target?.loadKg ?? 0);
    setWarmupMode(false);
  };

  // A warm-up has nothing left to come before once the first set is done:
  // the dials go back to the set's own numbers rather than log the warm-up's.
  useEffect(() => {
    if (!canWarmUp && warmupMode) {
      leaveWarmup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWarmUp]);

  useEffect(() => {
    setDial(null);
    setWarmupMode(false);
    setReps(target?.reps ?? 8);
    setKg(target?.loadKg ?? 0);
    const kept = keptWatch();
    setWatch(kept);
    setWatchNowMs(Date.now());
    minutesChosenRef.current = false;
    setMinutesChosen(false);
    minutesReachedRef.current = reachedOnArrival(kept);
    // Re-derive when the step changes — and when the exercise under the step
    // changes, which is what a swap does without moving the index. Keying on
    // stepIndex alone left the old lift's weight sitting in local state after a
    // swap: the store had already dropped it, the screen still showed it, and
    // pressing Log would have written it. The visible number always wins, so it
    // has to be the one the store agrees with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, step.exerciseName]);

  /**
   * The weight the gate picked, shown as such only while the number on screen
   * is still that one — the moment the stepper moves it, it is the user's
   * weight and the badge has no business claiming otherwise.
   */
  const untouched = target?.loadKg != null && Math.abs(kg - target.loadKg) < 0.001;
  const autoFromKg = untouched && target?.autoProgressedFromKg != null ? target.autoProgressedFromKg : null;
  /**
   * A weight carried in from the same lift in another program or an empty
   * workout. It had its own "VIIMEKSI · 27.9." badge until the reader asked
   * for it gone (#bugs 2026-09-30) — the card above already says what was
   * lifted last time. Still read, so the hold badge below keeps making no
   * claim about a number this slot never chose.
   */
  const prefilledFrom = untouched && !autoFromKg ? target?.prefilledFromPerformedAt ?? null : null;
  /**
   * Signed, because the chip is: green says the app added weight, red would
   * say it took some off. Today the gate only ever raises, so the red branch
   * waits for a rule that lowers — but the rendering must not print "+-1,25"
   * the day one exists.
   */
  const autoDeltaKg = autoFromKg !== null ? kg - autoFromKg : null;
  /**
   * The reps counterpart, for exercises that progress by reps instead of load
   * (bodyweight). Same "only while the number is still the gate's" rule,
   * checked against the reps dial instead of the weight dial.
   */
  const repsUntouched = target != null && reps === target.reps;
  const autoFromReps =
    repsUntouched && target?.autoProgressedFromReps != null ? target.autoProgressedFromReps : null;
  /**
   * The load (or rep target) had earned a jump and the recovery read held it.
   *
   * The other badges explain a number that changed. This one explains a
   * number that did not — which is the harder thing to notice and the reason
   * it needs saying at all. A hold nobody sees is indistinguishable from the
   * feature not existing.
   */
  const heldForFatigue =
    (bodyweight ? repsUntouched : untouched)
    && !autoFromKg
    && !prefilledFrom
    && autoFromReps === null
    && target?.heldForFatigue === true;
  /**
   * The load had earned a jump and an area the reader flagged held it.
   * Onboarding told them the app would not raise the weight on lifts that
   * load that area; this is where they can see it keep its word.
   */
  const heldForCautionArea =
    (bodyweight ? repsUntouched : untouched) && !autoFromKg && !prefilledFrom && autoFromReps === null
      ? target?.heldForCautionArea ?? null
      : null;
  // An area this build has no name for (a session saved by a later build, or
  // a damaged store) says nothing rather than taking the set screen down.
  const cautionAreaName = heldForCautionArea
    ? (t(language, `onb.area.${heldForCautionArea}` as I18nKey) as string | undefined)
    : undefined;
  /** One hold badge, with whichever reason the gate gave. */
  const holdLabel = heldForFatigue
    ? t(language, 'guided.heldForRecovery')
    : cautionAreaName
      ? t(language, 'guided.heldForCaution', { area: cautionAreaName.toUpperCase() })
      : null;

  return (
    <StepIn stepKey={`set-${stepIndex}`}>
      {/* Only a plain set is the tour's: no superset round, hold or clock. */}
      <GuidedTourReport
        report={tourReport}
        kind="set"
        plain={!superset && !minutesMode && !timed}
        canWarmUp={canWarmUp}
        canRemove={Boolean(onRemoveSet)}
        loaded={!bodyweight}
        hasHistory={Boolean(panels?.history)}
      />
      {/* The whole screen is the "close the dial" target: a tap that no
          card, button or control claims lands here and shuts whichever dial
          is open. Nested Pressables take their own taps first, so this only
          ever sees the empty space. */}
      <Pressable
        style={{ flex: 1, minHeight: 0 }}
        onPress={dial ? () => setDial(null) : undefined}
        accessible={false}
      >
        {/* No running frame around the whole screen during a set (device,
            2026-09-16): it boxed the lift in moving light while the reader
            was trying to lift it. The badge at the top says "superset" on its
            own, and the order of play under it says which lift is next. */}
        {/* "This is a superset" has to arrive before the set does, not after
            the rest fails to appear. The lifts are named in the order they
            are performed, the one you are on is the dark one, and the rest at
            the end of the round is the third thing on the line. */}
        {superset && !typingKeys ? (
          <>
            {/* The label straddles the top line and carries the ground colour,
                so the line stops at one edge of the word and starts at the
                other — a frame with its own legend. */}
            <View style={styles.setSupersetPill}>
              <Text style={styles.setSupersetPillText}>{t(language, 'guided.superset.pill')}</Text>
            </View>
            {/* And the order of play sits under the line, not on it. */}
            {/* Labelled here, on the outer text: nested Text is flattened
                into one node, and a label on a child is not read (review,
                2026-09-27) — the names are the full ones, the line shows KP. */}
            <Text
              style={styles.setSupersetFlow}
              numberOfLines={2}
              accessibilityLabel={[
                ...superset.members.map((member) => exerciseNameLabel(language, member.name)),
                t(language, 'guided.superset.thenRest'),
              ].join(', ')}
            >
              {superset.members.map((member, index) => (
                <Text
                  key={member.slotId}
                  style={member.slotId === step.slotId ? styles.setSupersetFlowNow : undefined}
                  accessibilityLabel={exerciseNameLabel(language, member.name)}
                >
                  {exerciseListLabel(language, member.name)}
                  {index < superset.members.length - 1 ? '  ·  ' : ''}
                </Text>
              ))}
              {`  ·  ${t(language, 'guided.superset.thenRest')}`}
            </Text>
          </>
        ) : null}
        {/* The lift's card and the set row scroll; the dials and the log row
            under them do not. iOS shortens this screen by the keyboard's
            height when a dial is typed in, and the dials' box used to shrink
            with it while its cards could not: centred, they spilled over the
            set row above and the log button below, and the dots and ± under
            them took the taps (owner's #2, iOS hunt 2026-10-17). Now the card
            gives the room instead, and scrolls when it has too little. Blank
            taps in it still reach the "close the dial" target around it. */}
        {typingKeys ? (
          <View style={styles.setTypingHead}>
            <Text
              style={styles.setTypingName}
              numberOfLines={1}
              accessibilityLabel={exerciseNameLabel(language, step.exerciseName)}
            >
              {exerciseListLabel(language, step.exerciseName)}
            </Text>
          </View>
        ) : null}
        {/* Hidden, not unmounted, while typing: the tour measures its parts. */}
        <ScrollView
          style={[styles.setTopScroll, typingKeys && styles.hidden]}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
        {/* The lift, always on screen and always the way in.
            The panels used to hang off the header's right-hand button, which
            put the answer to "how much did I lift last time" behind a control
            that looked like a camera — and cost the header the slot the sound
            toggle belongs in. The card says the name, shows the photo, and
            carries last time's numbers where they are read without a tap. */}
        {/* Spoken as what it shows — the name, then last time — with the
            action in the hint. A label that named the action replaced the
            card's contents for TalkBack, so "Liikkeen tiedot" was all a
            screen-reader user heard of the lift they were about to lift
            (accessibility audit, 2026-09-21). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={exerciseCardAccessibilityLabel(
            language,
            exerciseNameLabel(language, step.exerciseName),
            panels?.history
              ? {
                  sets: panels.history.sets,
                  borrowed: panels.history.borrowed === true,
                }
              : null,
            todayPlan.map((chip) => chip.reps),
            minutesMode ? 'minutes' : timed ? 'seconds' : 'reps',
          )}
          accessibilityHint={t(language, 'guided.panelsToggle')}
          testID="set-exercise-card"
          onPress={onOpenSheet}
          style={styles.setExerciseCard}
        >
          <View
            ref={nameRef}
            collapsable={false}
            style={styles.setExerciseTop}
          >
            <View style={styles.setExerciseThumb}>
              {thumbSource ? (
                <Image source={thumbSource} style={[StyleSheet.absoluteFill, FILL_SIZE]} resizeMode="cover" />
              ) : (
                <Text style={styles.setExerciseInitials}>{panels?.initials ?? ''}</Text>
              )}
              {/* No play badge (#bugs 2026-10-17): the picture is a still,
                  and a play mark promised a video the sheet does not have. */}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text
                  style={styles.setExerciseName}
                  numberOfLines={2}
                  accessibilityLabel={exerciseNameLabel(language, step.exerciseName)}
                >
                  {exerciseListLabel(language, step.exerciseName)}
                </Text>
                <GPIcon name="info" size={16} color={theme.muted} sw={2.2} />
              </View>
              <Text style={styles.setExerciseHint} numberOfLines={1}>
                {t(language, 'guided.card.hint')}
              </Text>
            </View>
          </View>
          {/* Last time over today, one line each with a small gap between
              (#bugs 2026-10-09, "yhteen riviin nätisti ja pieni väli vain").
              Both lines put their chips against the right edge. A line with more chips
              than the card is wide scrolls sideways instead of wrapping: a
              ramp's "16,25×8" chips used to wrap, and so, on the phone's
              larger font, did five plain ones, which is what made the card
              tall. */}
          {/* Not while a dial is typed in: the keyboard has taken the room,
              and last time's numbers are not what is being typed. */}
          <View
            ref={historyRef}
            collapsable={false}
            style={[styles.setExerciseRows, dial !== null && { display: 'none' }]}
          >
            {panels?.history ? (
              <View style={styles.setExerciseRow}>
                {/* One heading, whichever day the history came from. Borrowed
                    history got its own "ERI PÄIVÄ" line on 2026-09-09; the
                    reader asked for it gone (#bugs 2026-09-30, "jätä tuo
                    viimekerralla mutta pois eri päivä"). The card's
                    accessibility label above still says it. */}
                <Text style={styles.setExerciseLastLabel}>{t(language, 'guided.card.lastTime')}</Text>
                {/* Only a uniform session gets the single heading number — a
                    ramp has no one weight to lead with, and the per-set chips
                    already say the whole thing (decision "a", #bugs
                    2026-09-29). */}
                {historyChips?.uniform !== false && !minutesMode ? (
                  <Text style={styles.setExerciseLastLoad}>
                    {/* The same number decides and is shown. Guarding on the
                        FIRST set while printing the heaviest hid a real top set
                        behind a dash whenever set 1 was logged at 0 kg — which is
                        what the dial offers on a lift with no history (review,
                        PR #57). */}
                    {heaviestOf(panels.history) > 0
                      ? `${removeTrailingZeros(heaviestOf(panels.history))} kg`
                      : '—'}
                  </Text>
                ) : null}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.setExerciseChipScroll}
                  contentContainerStyle={styles.setExerciseLastPills}
                  // The card's own label already speaks these numbers; a
                  // scroll view inside it would be a stop of its own.
                  importantForAccessibility="no-hide-descendants"
                >
                  {panels.history.sets.slice(lastChipWindow.start, lastChipWindow.end).map((set, offset) => (
                    <View key={set.setIndex} style={styles.setExerciseLastPill}>
                      <Text style={styles.setExerciseLastPillText}>
                        {minutesMode
                          ? t(language, 'logger.minutesValue', { count: set.reps })
                          : historyChips?.chips[lastChipWindow.start + offset] ?? set.reps}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <Text style={styles.setExerciseFirstTime}>{t(language, 'guided.card.firstTime')}</Text>
            )}
            {/* Today's sets beside last time's, set by set: done ones as done,
                the one being done ringed, the rest at what their dial will open
                on (lib/guidedPlayer resolveGuidedSetPlan; #bugs 2026-10-08,
                "näkyviin koko sarja mitä pitäisi tehdä"). Not for a bout of
                minutes, which is one number on its clock.

                Warm-ups stay off both lines (#bugs 2026-10-09, "ylhäällä ei
                näytetä sielläkään lämmittelyitä"): the card is about the
                work. Warm-up mode's own heading counts them. */}
            {todayPlan.length > 0 ? (
              <View style={styles.setExerciseRow}>
                <Text style={styles.setExerciseLastLabel}>{t(language, 'guided.card.today')}</Text>
                {/* Today's weight, and an arrow when automated progression
                    moved it from last time: green up, red down, none when
                    the same (#bugs 2026-10-10). */}
                {todayKg !== null ? (
                  <View style={styles.setExerciseTodayLoad}>
                    <Text style={styles.setExerciseLastLoad}>{`${removeTrailingZeros(todayKg)} kg`}</Text>
                    {todayTrend ? (
                      <GPIcon
                        name={todayTrend === 'up' ? 'arrowUp' : 'arrowDown'}
                        size={14}
                        color={todayTrend === 'up' ? theme.green : theme.danger}
                        sw={2.8}
                      />
                    ) : null}
                  </View>
                ) : null}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.setExerciseChipScroll}
                  contentContainerStyle={styles.setExerciseLastPills}
                  importantForAccessibility="no-hide-descendants"
                >
                  {todayPlan.slice(todayChipWindow.start, todayChipWindow.end).map((planned, offset) => {
                    const chip =
                      showLoggedDemo && planned.status === 'current' ? { ...planned, status: 'done' as const } : planned;
                    return (
                    <View
                      key={todayChipWindow.start + offset}
                      style={[
                        styles.setExerciseLastPill,
                        chip.status === 'done' && { backgroundColor: theme.greenSoft },
                        chip.status === 'current' && styles.setExerciseTodayCurrent,
                      ]}
                    >
                      <Text
                        style={[
                          styles.setExerciseLastPillText,
                          chip.status === 'done' && { color: theme.greenInk },
                          chip.status === 'current' && { color: theme.ink },
                        ]}
                      >
                        {chip.reps ?? '–'}
                      </Text>
                    </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </Pressable>

        {/* The set counter, its dots and the add button — and nothing else.
            The session clock used to share this row, and the dots grow with
            every set added: at seven the clock was against the edge and the
            next one pushed it off the screen (#bugs 2026-08-26, "sarja ja
            kello ei voi olla vierekkäin"). It sits on the name row now, where
            nothing grows, and the dots absorb the squeeze here. */}
        <View
          ref={setRowRef}
          collapsable={false}
          style={styles.setMetaRow}
        >
          {inWarmup ? (
            <View style={styles.setMetaLeft}>
              <View style={styles.warmupDot} />
              <Text style={styles.setCounter}>{t(language, 'guided.warmup.title', { index: warmups.length + 1 })}</Text>
              {/* Takes back the last warm-up logged, the way the red − beside
                  the sets takes back the last set. The warm-ups had a row of
                  chips with an × each; the reader asked for it gone — the
                  working sets have no such row either (#bugs 2026-10-09).
                  The heading beside it counts them. */}
              {warmups.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(language, 'guided.warmup.remove', {
                    index: warmups.length,
                    kg: removeTrailingZeros(warmups[warmups.length - 1].loadKg),
                    reps: warmups[warmups.length - 1].reps,
                  })}
                  hitSlop={11}
                  onPress={() => onRemoveWarmup(warmups.length - 1)}
                  style={[styles.setAddBtn, { flexShrink: 0, borderColor: theme.danger }]}
                >
                  <GPIcon name="minus" size={13} color={theme.danger} sw={3} />
                </Pressable>
              ) : null}
            </View>
          ) : (
          <View style={styles.setMetaLeft}>
            <Text style={styles.setCounter}>
              {t(language, 'guided.setOfCount', { index: step.setIndex + 1, count: step.setCount })}
            </Text>
            {/* Six at most, and only as many as the room between the counter
                and the buttons holds (setBoxWindow above). The reader can add
                sets without limit and the row cannot grow without limit: at
                nine the dots were thinner than their gaps (user 2026-09-04),
                and at six on the phone the last one was cut in half and the
                buttons were pushed into the blue + (#bugs 2026-10-10). The
                boxes take the room that is left; the buttons keep theirs. */}
            <View
              style={styles.setDots}
              onLayout={(event) => {
                const width = Math.round(event.nativeEvent.layout.width);
                setSetBoxRoom((current) => (current === width ? current : width));
              }}
            >
              {Array.from({ length: setBoxWindow.end - setBoxWindow.start }).map((_, offset) => {
                const index = setBoxWindow.start + offset;
                const done = index < step.setIndex;
                const current = index === step.setIndex;
                return (
                  // Green filled for logged, an accent ring for the one you
                  // are on: the same two colours the rail under the screen
                  // uses, so "done" means one thing everywhere in the session.
                  <View
                    key={index}
                    style={[
                      styles.setDot,
                      { borderColor: done ? theme.green : current ? theme.highlight : theme.faint },
                      current && { borderWidth: 2.5 },
                      done && { backgroundColor: theme.green },
                    ]}
                  >
                    {done ? <GPIcon name="check" size={12} color={theme.surface} sw={3} /> : null}
                  </View>
                );
              })}
            </View>
            {/* One more set, decided where the sets are counted — the sheet
                kept this three taps away from the row that says 3/3. */}
            {/* One fewer, decided where the sets are counted — the + has been
                here since the sheet stopped owning it, and adding a set you
                cannot take back is half a control (#bugs 2026-08-26). Hidden
                rather than disabled when there is nothing to take: the last
                set, or a set already logged. */}
            {onRemoveSet ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'guided.action.removeSet')}
                hitSlop={8}
                onPress={onRemoveSet}
                style={[styles.setAddBtn, { flexShrink: 0, borderColor: theme.danger }]}
              >
                <GPIcon name="minus" size={13} color={theme.danger} sw={3} />
              </Pressable>
            ) : (
              // Its place is kept when it hides, so the + beside it does not
              // jump each time a set is logged (#bugs 2026-10-10).
              <View style={[styles.setAddBtn, styles.setAddBtnSpacer]} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'guided.action.addSet')}
              hitSlop={8}
              onPress={onAddSet}
              style={[styles.setAddBtn, { flexShrink: 0 }]}
            >
              <GPIcon name="plus" size={13} color={theme.green} sw={3} />
            </Pressable>
          </View>
          )}
          {/* The warm-up's own door, at the far end of the row: a blue +, as
              many times as the reader wants. It was a dashed pill on a row of
              its own (#bugs 2026-10-09, "vie liikaa tilaa"). Only before the
              first working set — once the work has started, a warm-up is not
              what comes next. In warm-up mode the same place leaves it. */}
          {inWarmup ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={leaveWarmup} style={styles.warmupCancel}>
              <Text style={styles.warmupCancelText}>{t(language, 'guided.warmup.cancel')}</Text>
            </Pressable>
          ) : canWarmUp ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'guided.warmup.add')}
              // 26 + 11 each way: the 48 a tap needs. The pill this
              // replaced was sized to it (review, 2026-10-05).
              hitSlop={11}
              onPress={enterWarmup}
              style={styles.warmupAdd}
            >
              <GPIcon name="plus" size={13} color={theme.blue} sw={3} />
            </Pressable>
          ) : null}
        </View>
        </ScrollView>

        <View style={styles.setTargetArea}>
          {/* Two dials, side by side: what you did and what was on the bar.
              Number above, −/+ below and always live — the reader's sketch
              (2026-09-09), after "16,25" lost its
              ",25" sharing a row with the buttons. The cards used to lock the
              buttons behind a tap because a resting thumb once changed a
              number; under the number, the buttons are no longer where a
              thumb rests. Hold a button to run. */}
          {minutesMode ? (
            <View style={styles.minutesClock}>
              <MinutesClockText watch={watch} style={styles.minutesClockTime} />
              <Text style={styles.minutesClockOf}>
                {t(language, 'guided.minutes.clockOf', { count: plannedMinutes })}
              </Text>
              {minutesReached ? (
                <Text style={styles.minutesClockDone} accessibilityLiveRegion="polite">
                  {t(language, 'guided.minutes.done')}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  language,
                  watchRunning ? 'guided.pause' : elapsedMs > 0 ? 'guided.resume' : 'guided.minutes.start',
                )}
                onPress={toggleWatch}
                style={({ pressed }) => [styles.minutesClockButton, pressed && { opacity: 0.85 }]}
              >
                <GPIcon name={watchRunning ? 'pause' : 'play'} size={18} color={theme.ink} sw={2.4} />
                <Text style={styles.minutesClockButtonText}>
                  {t(language, watchRunning ? 'guided.pause' : elapsedMs > 0 ? 'guided.resume' : 'guided.minutes.start')}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View
            ref={dialsRef}
            collapsable={false}
            style={styles.setDialRow}
          >
            <DialCard
              label={t(language, minutesMode ? 'guided.minutes' : timed ? 'guided.seconds' : 'guided.reps')}
              value={String(minutesMode ? shownMinutes : reps)}
              unit={minutesMode ? 'min' : null}
              open={dial === 'reps'}
              doneLabel={t(language, 'common.done')}
              onToggle={() => setDial((current) => (current === 'reps' ? null : 'reps'))}
              onStep={(direction) =>
                minutesMode
                  ? stepMinutes(direction)
                  : setReps((current) => stepDialReps(current, direction, repsBounds))
              }
              onCommit={(text) => {
                setTypedTextInvalid(!isLoggableTypedReps(text, repsBounds));
                setTypedTextPending(!isLoggableTypedReps(text, repsBounds) && isTypedRepsPossiblyValid(text, repsBounds));
                if (minutesMode) {
                  commitMinutes(text);
                } else {
                  setReps((current) => commitDialReps(text, current, repsBounds));
                }
              }}
              downLabel={t(
                language,
                minutesMode ? 'guided.a11y.minutesDown' : timed ? 'guided.a11y.secondsDown' : 'guided.a11y.repsDown',
              )}
              upLabel={t(
                language,
                minutesMode ? 'guided.a11y.minutesUp' : timed ? 'guided.a11y.secondsUp' : 'guided.a11y.repsUp',
              )}
              editHint={t(language, 'guided.a11y.tapToEdit')}
              wide={bodyweight}
              faint={false}
              invalid={typedErrorShown}
              onDraftCleared={() => {
                setTypedTextInvalid(false);
                setTypedTextPending(false);
              }}
            />

            {/* Weight is decided BEFORE the set. Loaded lifts always get it —
                an unset weight is a faint zero to dial in, never a claim that
                the bar is empty. */}
            {!bodyweight ? (
              <DialCard
                label={t(language, 'guided.weight')}
                value={removeTrailingZeros(kg)}
                unit="kg"
                open={dial === 'weight'}
                doneLabel={t(language, 'common.done')}
                onToggle={() => setDial((current) => (current === 'weight' ? null : 'weight'))}
                // 1.25 kg per step (user wish, #bugs 2026-08-26): the smallest
                // real plate pair. Bounded at both ends now — a held button
                // accelerates to a tick every 45 ms and the top end had nothing
                // stopping it. See lib/weightDial.
                onStep={(direction) => setKg((current) => stepDialWeight(current, direction))}
                onCommit={(text) => {
                  setTypedTextInvalid(!isLoggableTypedWeight(text));
                  setTypedTextPending(false);
                  setKg((current) => commitDialWeight(text, current));
                }}
                // From the dial's own step, not a number in the copy — the
                // copy said 2,5 kg while the dial moved 1,25.
                downLabel={weightStepAccessibilityLabel(language, -1)}
                upLabel={weightStepAccessibilityLabel(language, 1)}
                editHint={t(language, 'guided.a11y.tapToEdit')}
                wide={false}
                faint={kg <= 0}
                invalid={typedErrorShown}
                onDraftCleared={() => {
                  setTypedTextInvalid(false);
                  setTypedTextPending(false);
                }}
              />
            ) : null}
          </View>

          {/* Why the log button is waiting, in words. The typed number going
              red was the only sign, and colour is neither read aloud nor seen
              by everyone (accessibility audit, 2026-09-21). Polite, so it is
              announced once when it appears and not on every keystroke. */}
          {typedErrorShown ? (
            <View style={styles.setWeightError} accessibilityLiveRegion="polite">
              <Text style={styles.setWeightErrorText}>
                {t(language, dial === 'reps' ? 'guided.repsInvalid' : 'guided.weightInvalid')}
              </Text>
            </View>
          ) : null}
          {/* Said once, after the first Log set with nothing on the bar and
              nothing to go on; the next tap logs it (owner's #9). */}
          {zeroWeightAsked && !bodyweight && !(kg > 0) ? (
            <View style={styles.setWeightNote}>
              <Text style={styles.setWeightNoteText}>{t(language, 'guided.zeroWeightAsk')}</Text>
            </View>
          ) : null}

          {/* Badges about the numbers sit under the row, not inside the cards,
              so a badge does not make one card taller than the other. */}
          <View style={styles.setBadgeRow}>
              {/* Automated progression is Pro-gated upstream (resolveProgressionOptions),
                  so these badges only ever render for an unlocked account — and only
                  when a number moved, which is the one case the user did not choose
                  it themselves. Green adds, red would take away (the gate only
                  raises today), and the same pair covers reps on bodyweight work.
                  None of them is about a warm-up. */}
              {inWarmup ? null : autoDeltaKg !== null && autoDeltaKg !== 0 ? (
                <View style={autoDeltaKg > 0 ? styles.setAutoBadgeUp : styles.setAutoBadgeDown}>
                  <View style={autoDeltaKg > 0 ? null : { transform: [{ rotate: '180deg' }] }}>
                    <GPIcon
                      name="arrowUp"
                      size={13}
                      color={autoDeltaKg > 0 ? theme.greenInk : theme.danger}
                      sw={2.8}
                    />
                  </View>
                  <Text style={autoDeltaKg > 0 ? styles.setAutoBadgeUpText : styles.setAutoBadgeDownText}>
                    {t(language, autoDeltaKg > 0 ? 'guided.autoLoad' : 'guided.autoLoadDown', {
                      kg: removeTrailingZeros(Math.abs(autoDeltaKg)),
                    })}
                  </Text>
                </View>
              ) : autoFromReps !== null && reps - autoFromReps !== 0 ? (
                <View style={reps > autoFromReps ? styles.setAutoBadgeUp : styles.setAutoBadgeDown}>
                  <View style={reps > autoFromReps ? null : { transform: [{ rotate: '180deg' }] }}>
                    <GPIcon
                      name="arrowUp"
                      size={13}
                      color={reps > autoFromReps ? theme.greenInk : theme.danger}
                      sw={2.8}
                    />
                  </View>
                  <Text style={reps > autoFromReps ? styles.setAutoBadgeUpText : styles.setAutoBadgeDownText}>
                    {t(language, reps > autoFromReps ? 'guided.autoReps' : 'guided.autoRepsDown', {
                      count: Math.abs(reps - autoFromReps),
                    })}
                  </Text>
                </View>
              ) : holdLabel ? (
                <View style={styles.setHoldBadge}>
                  <GPIcon name="shield" size={13} color={theme.muted} sw={2.2} />
                  <Text style={styles.setHoldBadgeText}>{holdLabel}</Text>
                </View>
              ) : null}
          </View>
        </View>

        {/* One row (#bugs 2026-10-09, "kirjaa sarja + tauko ja treenin
            toiminnot yhteen riviin"): pause and the menu on the left, the log
            button taking the rest. Pause and the menu stay the only two
            (user 2026-08-23) — mute and swap live behind the dots.

            The circles lost their captions with the row: two captions under
            two circles were a row of their own. Their names are still read
            out, and the reader drew the row this way knowing it. */}
        <View style={styles.setControls}>
          <Pressable
            ref={pauseRef}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel={t(language, paused ? 'guided.resume' : 'guided.pause')}
            onPress={onPause}
            style={styles.setRoundBtn}
          >
            <GPIcon name={paused ? 'play' : 'pause'} size={22} color={theme.ink} sw={2.2} />
          </Pressable>
          <Pressable
            ref={menuRef}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel={t(language, 'guided.a11y.actions')}
            onPress={openActions}
            style={styles.setRoundBtn}
          >
            <GPIcon name="dots" size={22} color={theme.ink} sw={2.2} />
          </Pressable>
          {inWarmup ? (
            <Pressable
              ref={logSetRef}
              collapsable={false}
              accessibilityRole="button"
              accessibilityLabel={t(language, 'guided.warmup.log')}
              accessibilityState={{ disabled: logBlocked || kg <= 0 }}
              // No weight, no warm-up: the store refuses 0 kg, and the
              // screen must not leave as if it had been saved.
              disabled={logDisabled || kg <= 0}
              onPress={() => {
                if (logWaitsOnTypedText()) {
                  return;
                }
                onLogWarmup(kg, reps);
                leaveWarmup();
              }}
              style={({ pressed }) => [styles.warmupLogButton, pressed && { opacity: 0.9 }, (logBlocked || kg <= 0) && { opacity: 0.4 }]}
            >
              <GPIcon name="check" size={18} color={theme.blue} sw={2.8} />
              <Text style={styles.warmupLogButtonText} numberOfLines={1} adjustsFontSizeToFit>
                {t(language, 'guided.warmup.log')}
              </Text>
            </Pressable>
          ) : (
          <Pressable
            ref={logSetRef}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel={t(language, 'guided.logSetIndex', { index: step.setIndex + 1 })}
            accessibilityState={{ disabled: logBlocked }}
            disabled={logDisabled}
            onPress={() => {
              if (logWaitsOnTypedText()) {
                return;
              }
              setDial(null);
              if (
                asksBeforeZeroWeightLog({
                  carriesWeight: !bodyweight,
                  kg,
                  plannedKg: target?.loadKg ?? null,
                  asked: zeroWeightAsked,
                })
              ) {
                setZeroWeightAsked(true);
                // The note is for the eye; a screen reader is told (iOS
                // reads no live region).
                AccessibilityInfo.announceForAccessibility(t(language, 'guided.zeroWeightAsk'));
                return;
              }
              // The minutes on the dial — the clock's, the prescription's or
              // the reader's own — are what was done. The clock is read now:
              // the dial shows the last wake-up's minutes, which can be a
              // moment behind the tap.
              const done = !minutesMode
                ? reps
                : minutesChosen
                  ? reps
                  : minutesToLog({ plannedMinutes, elapsedMs: stopwatchElapsedMs(watch, Date.now()) });
              onConfirm(step.slotId, step.setIndex, done, bodyweight ? null : kg);
            }}
            style={({ pressed }) => [
              styles.setLogButton,
              pressed && { opacity: 0.9 },
              logBlocked && { opacity: 0.4 },
            ]}
          >
            <GPIcon name="check" size={18} color={theme.onHighlight} sw={2.8} />
            <Text style={styles.setLogButtonText} numberOfLines={1} adjustsFontSizeToFit>
              {t(language, 'guided.logSetIndex', { index: step.setIndex + 1 })}
            </Text>
          </Pressable>
          )}
        </View>
        {/* No "Seuraava · …" line here: on a set it named the same lift's next
            set, which the dots above already say. The drills keep theirs — a
            next drill with its seconds is worth a line. */}
      </Pressable>
    </StepIn>
  );
}

function FinishView({
  onFinish,
  saveFailed,
  language,
}: {
  onFinish: () => void;
  saveFailed: boolean;
  language: AppLanguage;
}) {
  const styles = useThemedStyles(makeStyles);
  const firedRef = useRef(false);

  // Fires once on arrival: the summary is the destination now, so there is
  // nothing here to read and nothing to press.
  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    onFinish();
  }, [onFinish]);

  // Nothing to read here, on purpose. "{title} — valmis" and a spinner
  // flashed between the last set and the summary, and a screen that exists for
  // the length of a save should not say anything (user 2026-09-09).
  //
  // Unless the save was refused: then this screen is where the reader is left,
  // and it has to say so and offer the save again.
  if (saveFailed) {
    return (
      <StepIn stepKey="finish-failed">
        <View style={styles.finishFailed}>
          <Text style={styles.finishFailedTitle}>{t(language, 'guided.finish.saveFailed.title')}</Text>
          <Text style={styles.finishFailedBody}>{t(language, 'guided.finish.saveFailed.body')}</Text>
          <BigBtn label={t(language, 'guided.finish.saveFailed.retry')} onPress={onFinish} />
        </View>
      </StepIn>
    );
  }
  return (
    <StepIn stepKey="finish">
      <View style={{ flex: 1 }} />
    </StepIn>
  );
}

function HowToSheetView({
  libraryItem,
  fallbackName,
  language,
  bottomInset,
  onClose,
}: {
  libraryItem: ExerciseLibraryItem | null;
  /** The step's own label, already in the reader's language. */
  fallbackName: string;
  language: AppLanguage;
  /** Safe-area inset, read on the screen and passed through to GPSheet. */
  bottomInset: number;
  onClose: () => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  // The sheet is titled with the same name the step showed, not the library
  // row's English — the two read differently ("Takakyykky" over "Barbell Full
  // Squat") and the user tapped the former.
  return (
    <GPSheet title={fallbackName} language={language} onClose={onClose} bottomInset={bottomInset}>
      {libraryItem?.primaryMuscles?.[0] ? (
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.purple, marginTop: -12 }}>
          {libraryLabel(libraryItem.primaryMuscles[0], language)}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 13, marginTop: 18, paddingBottom: 8 }}>
          {getExerciseInstructions(libraryItem?.name, libraryItem?.instructions, language).map((instruction, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 13, alignItems: 'flex-start' }}>
              <View style={styles.howToNumber}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: theme.purpleDark }}>{index + 1}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.ink, lineHeight: 22 }}>{instruction}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </GPSheet>
  );
}
