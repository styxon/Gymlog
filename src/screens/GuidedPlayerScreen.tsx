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
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  FeColorMatrix,
  Filter,
  Image as SvgImage,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

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
  getGuidedInitials,
  buildGuidedRunSheet,
  getGuidedNextName,
  getGuidedNextPreview,
  getGuidedSessionTitle,
  getGuidedSkipTargetIndex,
  rollPastLoggedWork,
  getGuidedStepAnchor,
  getGuidedStepLabel,
  isGuidedExerciseOut,
  resolveGuidedOpening,
  resolveGuidedSetTarget,
  restRoundCorrections,
  loggedSetsOf,
} from '../lib/guidedPlayer';
import {
  buildOverviewColumns,
  buildProgressionPill,
} from '../lib/sessionOverviewRows';
import { formatLastOwnBlock, OwnBlockPhase, OwnBlockStats } from '../lib/ownBlockHistory';
import { buildWarmupBrief } from '../lib/warmupBrief';
import {
  HOLD_DIAL,
  MINUTES_DIAL,
  REPS_DIAL,
  commitDialReps,
  commitDialWeight,
  isLoggableTypedWeight,
  stepDialReps,
  stepDialWeight,
} from '../lib/weightDial';
import { isLiftableWeight } from '../lib/weightLimits';
import {
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
import { buildExerciseSheetHistory, LastTimeView } from '../lib/exerciseSheetHistory';
import { programmeSetCount, toWorkingHistoryEntry, warmupOffer } from '../lib/warmupSets';
import { formatLoadOrRange, summarizeHistoricalSetChips } from '../lib/guidedSetWeightSummary';
import type { LiftHistoryEntry } from '../lib/progression';
import type { LoggedSetRow } from '../lib/guidedPlayer';
import type { PlateauDetection } from '../lib/proInsights';
import { ExerciseSheet } from '../components/ExerciseSheet';
import { CtaShimmer } from '../components/CtaShimmer';
import { SupersetBorder } from '../components/SupersetBorder';
import { getDrillLibraryName } from '../lib/drillMedia';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { libraryLabel } from '../lib/libraryLabel';
import { localizeWorkoutFocus } from '../lib/sessionNameLabel';
import { classifySessionFocus, getDefaultCooldown, getDefaultWarmup } from '../lib/homeSessionHero';
import { formatSetScheme, formatWeight, parseNumberInput, removeTrailingZeros } from '../lib/format';
import { estimateSessionMinutes } from '../lib/sessionDuration';
import { buildSupersetRuns, normalizeSupersetGroups, supersetGroupIndexes, supersetPositions } from '../lib/supersetGrouping';
import { I18nKey, t } from '../lib/i18n';
import { haptics } from '../utils/haptics';
import { subscribeRestActions, useRestEndAlert } from '../hooks/useRestEndAlert';
import { useRestAlertPermissionMoment } from '../hooks/useRestAlertPermissionMoment';
import { RestAlertsSheet } from '../components/RestAlertsSheet';
import { RestAlertAskOutcome } from '../lib/restAlertAnswer';
import { sound, type CueSound } from '../utils/sound';
import { readableOn, Theme, useTheme, useThemeName, useThemedStyles } from '../theming';
import { AppLanguage, ExerciseLibraryItem, UnitPreference } from '../types/models';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { elapsedSecondsOf } from '../features/workout/workoutState';
import { buildSwapOptionsForSlot, TailoringPreferencesInput } from '../lib/tailoringFit';
import { exerciseMatchesQuery } from '../lib/exerciseSearch';
import { sessionLiftsMatchingQuery } from '../lib/swapShortlist';
import { getExerciseTemplateDefaults, getPopularExerciseLibraryOrder } from '../lib/exerciseSuggestions';
import { getCatalogTrackingMode } from '../lib/catalogExercisePools';
import { AddExerciseSheet } from '../components/AddExerciseSheet';
import { guidedClockHeld } from '../lib/guidedClockHold';
import { sheetScrollMaxHeight } from '../lib/sheetScrollBound';
import { fitRunPreview } from '../lib/guidedRunPreview';
import { ExercisePickerEntry, ExercisePickerSheet, SheetEquipmentOption } from '../components/AddExerciseSheet';
import { BodyPartFilter } from '../lib/exerciseBrowseFilter';
import { ExercisePickerFilters } from '../lib/exercisePicker';
import { exerciseSheetCopy } from '../lib/exerciseSheetMode';
import { effectiveSwapBodyPart, resolveSwapBrowsePrefilter } from '../lib/swapBrowsePrefilter';
import { buildSwapPickerLibrary, narrowSwapAlternatives } from '../lib/swapPickerLists';
import { useKeepScreenAwake } from '../utils/keepAwake';
import { queryReduceMotion } from '../utils/reduceMotion';
import {
  canCompleteSet,
  getHistoryEntriesForExercise,
  repsCeilingFor,
  resolveInstanceBorrowRepWindow,
} from '../features/workout/workoutState';
import { isUsableEntry, resolveLastTimeEntry } from '../lib/exerciseHistoryLookup';
import { liftOfSet } from '../lib/liftSegments';
import {
  isMinutesTrackingMode,
  isTimedTrackingMode,
  isUnloadedTrackingMode,
  WorkoutExerciseInstance,
} from '../features/workout/workoutTypes';

/**
 * Duotone ramps: where black lands, and where white lands. Light theme keeps
 * the photo airy so it sits on the lilac surface; dark theme keeps it deep so
 * it does not glare mid-set.
 */
const DUOTONE = {
  light: { shadow: [0.298, 0.227, 0.478], light: [1, 1, 1] },
  dark: { shadow: [0.09, 0.063, 0.169], light: [0.851, 0.8, 0.961] },
} as const;

/** Rec.601 luma weights — the same ones feColorMatrix's own saturate uses. */
const LUMA = [0.299, 0.587, 0.114] as const;

/**
 * The whole duotone as one feColorMatrix.
 *
 * The textbook recipe is saturate-to-grey followed by an feComponentTransfer
 * table per channel, and on Android the transfer node is ignored — the photo
 * came out plain greyscale. A single matrix does both steps at once and is the
 * one filter primitive that definitely renders: each output channel is the
 * luma weights scaled by that channel's ramp span, with the shadow end as the
 * constant term. Verified on device; do not "simplify" it back into two nodes.
 */
function duotoneMatrix(shadow: readonly number[], light: readonly number[]) {
  const row = (index: number) => {
    const span = light[index] - shadow[index];
    return [LUMA[0] * span, LUMA[1] * span, LUMA[2] * span, 0, shadow[index]];
  };
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0]
    .map((value) => value.toFixed(4))
    .join(' ');
}

// Dark palette for rest / finish takeovers (guided-shared.jsx GPD).
const GPD = {
  bg1: '#241B4A',
  bg2: '#17112E',
  ink: '#F4F1FF',
  muted: '#A79FC4',
  faint: '#7C739E',
  line: 'rgba(255,255,255,0.12)',
  green: '#37D08A',
};

const SPLASH_MS = 2300;

/** How many set dots the row will draw before it stops counting in dots. */
const SET_DOT_CAP = 9;

/**
 * The rest a mid-workout add falls back to when there is no last exercise to
 * inherit one from — a cooldown-only session with no main block, added after
 * (recheck round 2026-09-29). Same number `AppProvider` seeds a fresh
 * install's preferences with, so a lift added here without one rests the
 * same as any lift would before the reader ever set a preference.
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

export interface GuidedWeekProgress {
  weekLabel: string;
  done: number;
  target: number;
}

export interface GuidedNextUp {
  name: string;
  weekday: string;
}

interface GuidedPlayerScreenProps {
  unitPreference: UnitPreference;
  language?: AppLanguage;
  /** Equipment chips the user actually has; null when the setup never said. */
  availableEquipment?: string[] | null;
  /**
   * The reader's own warm-up / cool-down picks.
   *
   * Without these the player coached the drill they replaced: the swap showed
   * on Home and in the day editor and never reached the one screen that
   * actually runs it (found in review, 2026-08-31).
   */
  routineDrillOverrides?: Record<string, string>;
  /** Ranks the swap list the same way the list logger does. */
  tailoringPreferences?: TailoringPreferencesInput | null;
  exerciseLibrary: ExerciseLibraryItem[];
  /**
   * The lift's whole logged history by name — every programme and free
   * session, the rows the records tab reads. The sheet's History tab read
   * only this slot's entries, so a bench pressed on 28.8. in another
   * programme was "no entries yet" here while the records tab showed its
   * 7 × 60 (#bugs 2026-09-20). The slot's own rows are added where the lift
   * does not already have them — never replaced: the lift's list is every
   * log by name, and a session whose database write failed, or one this
   * install only has in slot history, is still this slot's past.
   */
  liftHistory?: (exerciseName: string) => readonly LiftHistoryEntry[] | null;
  /**
   * The plateau reminder for the lift being walked to, or null when it is
   * not currently stalled. Same detection Home's card shows (lib/proInsights
   * findPlateauDetection) — shown once here, on the beat where the lift is
   * introduced, so the finding survives dismissing Home's card without a
   * second rule to keep in sync (user 2026-09-29, "muistutus kun
   * seuraavalla kerralla on sumo").
   */
  plateauNotice?: (exerciseName: string) => PlateauDetection | null;
  soundCuesEnabled: boolean;
  /** Keep the display on for the whole guided session. */
  keepScreenAwake?: boolean;
  onToggleSoundCues: (next: boolean) => void;
  entryEyebrow: string;
  /**
   * Every finished session, so the overview can find the last run of this same
   * day. Which one that is depends on the live session's template ids, which
   * this screen holds and the caller does not.
   */
  /** How the reader's own warm-ups have gone — see lib/ownBlockHistory.ts. */
  ownBlockStats?: OwnBlockStats;
  /** One finished self-run block, for the "last time you took" line. */
  onRecordOwnBlock?: (phase: OwnBlockPhase, seconds: number) => void;
  /** The Learn section's own two facts, so the sheet can show and change them. */
  learnedExerciseIds?: string[];
  techniqueChecks?: Record<string, number[]>;
  onToggleTechniqueStatement?: (libraryItemId: string, index: number) => void;
  onToggleExerciseLearned?: (libraryItemId: string) => void;
  weekProgress: GuidedWeekProgress | null;
  nextUp: GuidedNextUp | null;
  onLeave: () => void;
  onEndSession: () => void;
  onFinishSession: () => void;
  isSavingWorkout: boolean;
  /**
   * The finish's save was refused. The finish step says so and offers the
   * save again; it used to be an empty screen with the bar hidden and a toast
   * that was gone in three seconds.
   */
  saveFailed?: boolean;
  /** Rest & alerts settings (design: Background Timer). */
  restAlerts?: { alerts: boolean; warning: boolean; ongoing: boolean; asked: boolean };
  /** The first-rest permission sheet was answered — see restAlertsAnswered. */
  onRestAlertsAnswered?: (outcome: RestAlertAskOutcome) => void;
  /** The rest banner's "Turn on": the settings page that fixes the silence. */
  onOpenSystemSettings?: () => void;
  /**
   * The reader asked to CONTINUE, not to open the session.
   *
   * Set by the paths whose own button already said "Resume workout" — Home's
   * hero, the lock-screen card. Opening the overview after that is the app
   * asking a question the reader has already answered.
   */
  autoResume?: boolean;
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

/* ── icons ── */
function GPIcon({ name, size = 22, color = '#fff', sw = 2.2 }: { name: string; size?: number; color?: string; sw?: number }) {
  const paths: Record<string, React.ReactNode> = {
    x: <Path d="M6 6l12 12M18 6L6 18" />,
    pause: <Path d="M9 5v14M15 5v14" />,
    play: <Path d="M8 5l11 7-11 7z" />,
    skip: <Path d="M5 5l9 7-9 7zM18 5v14" />,
    back: <Path d="M19 5l-9 7 9 7zM6 5v14" />,
    check: <Path d="M4.5 12.5l5 5L19.5 7" />,
    chevR: <Path d="M9 6l6 6-6 6" />,
    chevD: <Path d="M6 9l6 6 6-6" />,
    sound: (
      <>
        <Path d="M4 9v6h4l5 4V5L8 9z" />
        <Path d="M16.5 8.5a5 5 0 010 7" />
      </>
    ),
    mute: (
      <>
        <Path d="M4 9v6h4l5 4V5L8 9z" />
        <Path d="M17 9l4 6M21 9l-4 6" />
      </>
    ),
    plus: <Path d="M12 5v14M5 12h14" />,
    minus: <Path d="M5 12h14" />,
    // Pencil: the "this card opens" mark on a closed dial.
    edit: <Path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3zM13.5 6.5l3 3" />,
    arrowUp: <Path d="M12 19V5M6 11l6-6 6 6" />,
    list: <Path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    // Two arrows passing: swapping one lift for another.
    swap: <Path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />,
    // The actions menu. It shared the list glyph with the swap button, and two
    // identical icons side by side is two buttons that look like one.
    dots: <Path d="M5 12h.01M12 12h.01M19 12h.01" />,
    video: (
      <>
        <Rect x="3" y="6.5" width="12.5" height="11" rx="3" />
        <Path d="M15.5 10.5l5-2.6v8.2l-5-2.6z" />
      </>
    ),
    clock: (
      <>
        <Circle cx="12" cy="12" r="8.5" />
        <Path d="M12 7.5V12l3 2" />
      </>
    ),
    shield: <Path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z" />,
    info: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 11v5.5M12 7.6v.1" />
      </>
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </Svg>
  );
}

/**
 * Whether the phone asks for less motion. StepIn and PopIn ran on every step
 * of every session regardless (accessibility audit, 2026-09-21). The exported
 * screen asks once — utils/reduceMotion, which always answers — and hands the
 * answer down here, rather than every StepIn asking the OS on every step
 * change. False until the answer comes: the entrance plays, the helper's safe
 * default.
 */
const ReducedMotionContext = React.createContext(false);

/**
 * The ring's clock under the system font size. 76px in a 244dp ring had room
 * for about one step of scaling: at the accessibility sizes the digits ran
 * into the stroke and off the ring (accessibility audit, 2026-09-21). Capped
 * at 1.3×, and shrunk to fit beyond that rather than clipped.
 */
const RING_CLOCK_FIT = {
  maxFontSizeMultiplier: 1.3,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.6,
} as const;

/* ── step entrance: fade + 14px rise ── */
function StepIn({ children, stepKey, style }: { children: React.ReactNode; stepKey: string; style?: object }) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useContext(ReducedMotionContext);
  // Interpolated once: the player re-renders every second on the timer, and a
  // per-render interpolate leaks native nodes (disconnectAnimatedNodes crash).
  const translateY = useRef(anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })).current;
  useEffect(() => {
    // Reduced motion: the step is simply there. Also the answer arriving
    // mid-entrance, which finishes it at once.
    if (reduceMotion) {
      anim.stopAnimation();
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [anim, stepKey, reduceMotion]);
  return (
    <Animated.View style={[{ flex: 1, opacity: anim, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

/* ── pop-in for countdown digits / badges ── */
function PopIn({ children, popKey }: { children: React.ReactNode; popKey: string | number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduceMotion = React.useContext(ReducedMotionContext);
  // Same rule as StepIn: one interpolation per value, never per render.
  const popStyle = useRef({
    opacity: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
  }).current;
  useEffect(() => {
    // A digit that scales up from 0.6 every second is exactly what reduced
    // motion asks to stop.
    if (reduceMotion) {
      anim.stopAnimation();
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 420,
      easing: Easing.bezier(0.3, 1.4, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [anim, popKey, reduceMotion]);
  return <Animated.View style={popStyle}>{children}</Animated.View>;
}

/* ── media zone: photo when the library has one, brand-panel initials otherwise ── */
function MediaZone({
  name,
  library,
  height,
  mode = 'drill',
  showActions = true,
  fit = 'contain',
  language = 'en',
}: {
  name: string;
  library: ExerciseLibraryItem[];
  height: number;
  mode?: 'drill' | 'position' | 'set';
  /** Set screen v4 moves the how-it's-done button into the top bar. */
  showActions?: boolean;
  /** v4 fills the set card edge to edge; other steps keep the whole frame. */
  fit?: 'contain' | 'cover';
  language?: AppLanguage;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const match = useMemo(() => {
    // Warmup/cooldown drills are generated copy with no library entry of their
    // own — they borrow a photo from the exercise that shows the same position.
    const lookupName = getDrillLibraryName(name) ?? name;
    const index = findGuidedLibraryIndex(lookupName, library.map((item) => item.name));
    return index === null ? null : library[index];
  }, [name, library]);
  const themeName = useThemeName();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [name]);

  const imageUrl = match?.imageUrls?.[0] ?? null;

  // The media zone always shows the flat photo (or initials). A 3D rig with
  // an on-demand sheet lived here until 2026-08-26 ("poistetaan kaikki 3d
  // videot mitä tehtiin, palaan tähän joskus myöhemmin") — the HowToSheet
  // with written instructions is the how-to path now. The muscle chip was
  // dropped in the v4 pass (user: the label added nothing on any exercise).
  const overlays = null;

  const initials = getGuidedInitials(name);
  // The panel is the FLOOR, not the fallback. It used to render only after
  // onError, so a photo that was merely slow left a blank white card filling
  // half the screen with nothing in it — and onError never fires while a
  // request is still in flight. Drawing the panel underneath means the media
  // zone is never empty: the photo arrives on top of it, or it does not.
  const panel = (
    <>
      <View style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <SvgLinearGradient id="gpPanel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F1E9FF" />
              <Stop offset="0.6" stopColor="#E4D5FB" />
              <Stop offset="1" stopColor="#DCCBF8" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gpPanel)" />
        </Svg>
      </View>
      <Text style={styles.mediaInitials}>{initials}</Text>
    </>
  );

  if (imageUrl && !imageFailed) {
    const ramp = DUOTONE[themeName];
    return (
      <View style={[styles.mediaZone, { height, backgroundColor: '#E9DCFA', borderColor: '#E6DAF8' }]}>
        {panel}
        {/* The library photos are stock gym shots — red walls, yellow floors —
            and during a set the photo is the biggest thing on the screen, so
            the app looked like two products. Desaturate, then map luminance
            onto a two-colour brand ramp: same picture, same information, our
            colour world. Done at render time rather than baked, which is the
            only way the treatment can follow the theme. */}
        <View style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <Filter id="vinhaDuotone" x="0" y="0" width="100%" height="100%">
                <FeColorMatrix type="matrix" values={duotoneMatrix(ramp.shadow, ramp.light)} />
              </Filter>
            </Defs>
            <SvgImage
              href={{ uri: imageUrl }}
              width="100%"
              height="100%"
              preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
              filter="url(#vinhaDuotone)"
            />
          </Svg>
        </View>
        {overlays}
      </View>
    );
  }

  return (
    <View style={[styles.mediaZone, { height, backgroundColor: '#E9DCFA', borderColor: '#E6DAF8' }]}>
      {panel}
      {overlays}
    </View>
  );
}

/**
 * Rest countdown drawn as a draining ring. `plannedSeconds` sets the full
 * circle; ±15s can push the remaining time past it, so the ring grows to the
 * largest value it has seen for this rest instead of overflowing.
 */
function RestRing({
  stepKey,
  leftSeconds,
  plannedSeconds,
  size = 244,
  /** The arc's colour. An interval's work bout draws it in the highlight. */
  stroke,
  children,
}: {
  stepKey: number;
  leftSeconds: number;
  plannedSeconds: number;
  size?: number;
  stroke?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  const [total, setTotal] = useState(Math.max(1, plannedSeconds));

  useEffect(() => {
    setTotal(Math.max(1, plannedSeconds));
  }, [stepKey, plannedSeconds]);

  useEffect(() => {
    setTotal((current) => (leftSeconds > current ? leftSeconds : current));
  }, [leftSeconds]);

  const strokeWidth = 10;
  const radius = (size - strokeWidth * 1.6) / 2;
  const circumference = 2 * Math.PI * radius;
  /*
   * A drained ring is a full ring, not an empty one.
   *
   * The arc shrinks as the wait runs down, so at zero it had no length at all
   * and the only thing left on screen was the track — which meant the rest
   * screen's "the wait is over" state was drawn in the track's colour instead
   * of the accent it asks for (device 2026-09-04). Now the arc closes back up
   * at zero and takes the over-colour with it.
   */
  const over = leftSeconds <= 0;
  const fraction = over ? 1 : Math.max(0, Math.min(1, leftSeconds / total));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* The track was a light-theme hex on both themes: a bright lilac ring
            on a near-black page, brighter than the arc it was backing. */}
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.purpleLight} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke ?? theme.purple}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          // Start the arc at 12 o'clock and drain clockwise.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

/* ── shared small components ── */
function TopBar({
  dark,
  language,
  label,
  clock,
  muted,
  onMute,
  onExit,
  video,
}: {
  dark: boolean;
  /** For the two icon buttons' names — they had none. */
  language: AppLanguage;
  /**
   * What the screen is, beside the clock — only where nothing under the bar
   * says it: the do-it-yourself block. The player's own screens pass none.
   */
  label?: string;
  /**
   * Session elapsed, m:ss. The one clock in the session, and it belongs here:
   * it is the only number that is true on every screen, so anywhere else it
   * has to be drawn again — and it was, on the set screen, in a row that runs
   * out of width the moment a lift has a long name.
   */
  clock: string | null;
  muted: boolean;
  onMute: () => void;
  onExit: () => void;
  /**
   * Set screen v4: the right slot shows the how-it's-done camera instead of
   * mute, and mute moves down beside pause.
   */
  /** `active` lights the button while the panel it opens is showing. */
  video?: { label: string; onPress: () => void; active?: boolean } | null;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const iconColor = dark ? GPD.ink : theme.ink;
  const buttonStyle = [styles.topBtn, dark ? styles.topBtnDark : null];
  return (
    <View style={styles.topBar}>
      {/* Both corners were bare icons, announced as "button" and nothing
          else (accessibility audit, 2026-09-21). The sound toggle is a
          switch: on means the cues play. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(language, 'guided.a11y.exit')}
        onPress={onExit}
        style={buttonStyle}
        hitSlop={8}
      >
        <GPIcon name="x" size={19} color={iconColor} />
      </Pressable>
      {/* No label is the clock alone, centred (#bugs 2026-09-30). */}
      <Text style={[styles.topLabel, { color: dark ? GPD.muted : theme.muted }]} numberOfLines={1}>
        {[label, clock].filter(Boolean).join(' · ')}
      </Text>
      {video ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: video.active }}
          accessibilityLabel={video.label}
          onPress={video.onPress}
          style={[buttonStyle, video.active ? styles.topBtnActive : null]}
          hitSlop={8}
        >
          <GPIcon name="video" size={20} color={video.active ? theme.purple : iconColor} sw={2.1} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={t(language, 'guided.a11y.soundCues')}
          accessibilityState={{ checked: !muted }}
          onPress={onMute}
          style={buttonStyle}
          hitSlop={8}
        >
          <GPIcon name={muted ? 'mute' : 'sound'} size={19} color={muted ? (dark ? GPD.faint : theme.faint) : iconColor} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The rail is also the way in to the run sheet.
 *
 * It was already the only thing on screen that stood for the whole session
 * rather than for this moment of it — it just could not be read, being dots.
 * Making it the handle keeps the player at one control per screen: nothing new
 * appears, the thing that was already there answers a question it was already
 * being asked ("Treenin aikana ei ole mitään keinoa nähdä seuraavaa liikettä",
 * #bugs 2026-08-27).
 */
function ProgressRail({
  groups,
  current,
  dotIndex,
  dotsDone,
  onPress,
  openLabel,
}: {
  /**
   * One phase's groups, not the session's — three drills, five exercises, two
   * stretches. Sliced by `getGuidedPhaseRail`; the top bar counts the same
   * groups ("2/6").
   */
  groups: Array<{ phase: string; setCount?: number }>;
  current: number;
  dotIndex: number;
  dotsDone: number;
  onPress?: () => void;
  openLabel?: string;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const Rail = onPress ? Pressable : View;

  return (
    <Rail
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? openLabel : undefined}
      onPress={onPress}
      // The dots are small and the bar is thin; the target is the strip.
      hitSlop={onPress ? 10 : undefined}
      style={styles.rail}
    >
      {groups.map((group, index) => {
        const isCurrent = index === current;
        const done = index < current;
        // No phase gap any more: the rail holds one phase, so every segment
        // in it is the same kind of thing and they space evenly.
        if (isCurrent && (group.setCount ?? 0) > 1) {
          return (
            <View
              key={index}
              style={[
                styles.railSetPill,
                {
                  marginLeft: 5,
                  backgroundColor: theme.highlightSoft,
                  // The rim marks the current exercise; done and still-to-come
                  // are flat bars. Amber held this job from 2026-09-01, when
                  // the problem was that current and done were the same violet
                  // told apart by two pixels of height. `highlight` solves that
                  // as well as amber did and gives amber back to caution, which
                  // the session now uses for a flagged body part.
                  borderColor: theme.highlight,
                },
              ]}
            >
              {Array.from({ length: group.setCount ?? 0 }).map((_, dot) => (
                <View
                  key={dot}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor:
                      dot < dotsDone
                        ? theme.green
                        : dot === dotIndex
                          ? theme.highlight
                          : theme.faint,
                    opacity: dot === dotIndex && dot >= dotsDone ? 0.9 : dot < dotsDone ? 1 : 0.45,
                  }}
                />
              ))}
            </View>
          );
        }
        return (
          <View
            key={index}
            style={{
              flex: isCurrent ? 2 : 1,
              marginLeft: index === 0 ? 0 : 5,
              height: isCurrent ? 7 : 5,
              borderRadius: 999,
              // Three states, three meanings, and the same two colours the
              // rest of the session uses: green is done, `highlight` is where
              // you are, and what is still coming is neither.
              //
              // Current was amber from 2026-09-01, which fixed the real
              // problem — current and done were both violet, told apart by two
              // pixels of height at arm's length — with the one colour the
              // flow now needs for a flagged body part. `highlight` separates
              // them just as far and means the same thing here it means on
              // every button.
              backgroundColor: isCurrent ? theme.highlight : done ? theme.green : theme.faint,
              opacity: isCurrent ? 1 : done ? 0.85 : 0.35,
            }}
          />
        );
      })}
    </Rail>
  );
}

function NextLine({ text, dark, language }: { text: string | null; dark: boolean; language: AppLanguage }) {
  const theme = useTheme();

  if (!text) {
    return <View style={{ height: 20 }} />;
  }
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 26 }}>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: dark ? GPD.muted : theme.muted }} numberOfLines={1}>
        <Text style={{ color: dark ? GPD.faint : theme.faint }}>{t(language, 'guided.next.prefix')}</Text>
        {text}
      </Text>
    </View>
  );
}

function NameBlock({
  name,
  hasHowTo,
  language,
  onHow,
}: {
  name: string;
  hasHowTo: boolean;
  language: AppLanguage;
  onHow: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={{ paddingHorizontal: 26, alignItems: 'center' }}>
      <Text
        style={styles.exerciseName}
        numberOfLines={2}
        accessibilityLabel={exerciseNameLabel(language, name)}
      >
        {exerciseListLabel(language, name)}
      </Text>
      {hasHowTo ? (
        <Pressable onPress={onHow} style={styles.cueRow}>
          <Text style={styles.howToLink}>{t(language, 'guided.howTo')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CtrlBtn({
  icon,
  label,
  onPress,
  big,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  big?: boolean;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const size = big ? 62 : 52;
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 6, width: 66 }}>
      <View style={[styles.ctrlCircle, { width: size, height: size }]}>
        <GPIcon name={icon} size={big ? 24 : 21} color={theme.ink} />
      </View>
      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.muted }}>{label}</Text>
    </Pressable>
  );
}

function BigBtn({
  label,
  onPress,
  color: colorProp,
  icon = 'check',
  disabled,
  shimmer,
  tall,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  /** A green tick on a button that stops something reads as confirm. */
  icon?: string;
  disabled?: boolean;
  /**
   * A band of light across the button as the screen arrives — the same mark
   * the Home CTA wears (design 2026-08-26). Opt-in: it belongs on the one
   * button a screen exists to get pressed, not on every button.
   */
  shimmer?: boolean;
  /** For a screen whose whole job is this one decision. */
  tall?: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Orange, not green. The dark theme collapses the two accent families —
  // anything pressable is orange, violet carries brand — and green is the
  // colour of "done", not of "press me". A green "Valmis — aloita treeni" put
  // the finished colour on the button that starts the thing (#bugs 2026-08-26).
  const color = colorProp ?? theme.accent;
  // Derived from the fill, not fixed: callers paint this button `theme.ink` to
  // mean "the quiet one", and ink is near-white under the dark theme — so a
  // hard-coded white label made the button read as blank.
  const foreground = readableOn(color);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.bigBtn,
        tall && styles.bigBtnTall,
        { backgroundColor: color, opacity: disabled ? 0.6 : 1, shadowColor: color },
      ]}
    >
      {shimmer && !disabled ? <CtaShimmer tint={`${foreground}55`} /> : null}
      <GPIcon name={icon} size={tall ? 23 : 20} color={foreground} sw={2.6} />
      <Text style={[styles.bigBtnText, tall && styles.bigBtnTextTall, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A row of the swap list: the name reads from the left and may wrap to two
 * lines. The list used GhostBtn — a fixed 48 dp, centred, unpadded button —
 * and a long Finnish name touched its border or wrapped out of it
 * (#bugs 2026-09-27).
 */
function GhostBtn({
  label,
  onPress,
  icon,
  dark,
  danger,
  tint: tintProp,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  dark?: boolean;
  /** Throws work away. Named for what it does, not for the colour it takes. */
  danger?: boolean;
  /** Outline and text in one colour, for a label that means a direction. */
  tint?: string;
  /** When the visible label is a symbol ("+15s") rather than words. */
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);
  const tint = tintProp ?? (danger ? theme.danger : dark ? GPD.ink : theme.ink);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[
        styles.ghostBtn,
        dark ? { borderColor: GPD.line, backgroundColor: 'rgba(255,255,255,0.06)' } : null,
        danger || tintProp ? { borderColor: tint } : null,
      ]}
    >
      {icon ? <GPIcon name={icon} size={17} color={tint} /> : null}
      <Text style={[styles.ghostBtnText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
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
/**
 * The walk-up's contents list draws its heading and rows at exactly these
 * heights, so the space they need can be worked out before they are drawn
 * (lib/guidedRunPreview).
 */
const WALK_RUN_HEAD = 28;
const WALK_RUN_ROW = 30;
/** The walk-up scroll's own padding (28 top, 8 bottom) and the gap above the list. */
const WALK_RUN_CHROME = 28 + 8 + 14;
/** The sheet's height cap (`sheetFrame`), as a share of the scrim. */
const SHEET_CAP_FRACTION = 0.78;

function GPSheet({
  title,
  language,
  onClose,
  bottomInset,
  scrollable = false,
  children,
}: {
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

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.sheetScrim}
        onPress={onClose}
        onLayout={(event) => setAreaHeight(Math.round(event.nativeEvent.layout.height))}
      >
        {/* The 78% cap lives on this wrapper, whose parent is the full-screen
            scrim: on the sheet inside it the percentage would resolve against
            a content-sized parent and quietly stop capping anything. */}
        <Animated.View
          style={[styles.sheetFrame, { transform: [{ translateY: dragY }] }]}
        >
          <Pressable
            style={[styles.sheet, { paddingBottom: bottomPadding }]}
            onPress={() => undefined}
          >
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
          </Pressable>
        </Animated.View>
      </Pressable>
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
  routineDrillOverrides = {},
  tailoringPreferences = null,
  exerciseLibrary,
  liftHistory,
  plateauNotice,
  soundCuesEnabled,
  keepScreenAwake = false,
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
}: GuidedPlayerScreenProps) {
  // Read here, on the screen: inside the sheet's Modal it is always 0.
  const screenInsets = useSafeAreaInsets();
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
  const sessionTitle = localizeWorkoutFocus(getGuidedSessionTitle(session?.templateName ?? '', language), language);

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
        getDefaultWarmup(focusKind, language, availableEquipment, routineDrillOverrides),
      ),
    [focusKind, language, availableEquipment, routineDrillOverrides],
  );
  const cooldownDrills = useMemo<GuidedDrill[]>(
    () =>
      buildGuidedDrillsFromBlock(
        getDefaultCooldown(focusKind, language, availableEquipment, routineDrillOverrides),
      ),
    [focusKind, language, availableEquipment, routineDrillOverrides],
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

  /* ── timers ── */
  // Seeded from the opening step, not from zero: mounting straight onto a
  // timed step (a walk-up, a drill) with nothing on the clock would expire it
  // on the first tick.
  const openingMs = stepSeconds(steps[openingStep] ?? { type: 'finish' }) * 1000;
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
    const started = new Date(session.startedAt);
    const time = `${String(started.getHours()).padStart(2, '0')}:${String(started.getMinutes()).padStart(2, '0')}`;
    const total = session.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
    const done = session.exercises.reduce(
      (sum, ex) => sum + ex.sets.filter((set) => set.status === 'completed').length,
      0,
    );
    const current = session.exercises.find((ex) => ex.sets.some((set) => set.status !== 'completed' && set.status !== 'skipped'));
    return {
      title: t(language, 'rest.notify.sessionTitle', {
        session: sessionTitle,
        exercise: current ? exerciseNameLabel(language, current.exerciseName) : '',
      }),
      body: t(language, 'rest.notify.sessionBody', { done, total, time }),
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
    (endsAtMs: number | null, nextName?: string | null) =>
      syncRestEndAlert(restAlerts.alerts ? endsAtMs : null, nextName),
    [restAlerts.alerts, syncRestEndAlert],
  );

  // Lock-screen actions land in App and come here over the bus. The guided
  // rest is a timed step, so "+30 s" is the same move as the +15s button and
  // "skip" is the same as advancing.
  useEffect(
    () =>
      subscribeRestActions((action) => {
        if (stepRef.current?.type !== 'rest') {
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
  const [swapCategory, setSwapCategory] = useState<ExercisePickerFilters['category']>('all');
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
      if (stepRef.current?.type === 'rest' && endsAt !== null && endsAt > Date.now()) {
        void syncRestNotification(endsAt, exerciseNameLabel(language, getGuidedNextName(steps, stepIndex) ?? ''));
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
  });
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

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(0, index), steps.length - 1);
      // Moving on is resuming. The set screen's pause stops the session clock,
      // and only its own button started it again: pause, then Log, Swap or
      // Skip, and the clock stayed frozen for the rest of the workout.
      unpause();
      setPauseSheetOpen(false);
      setHowtoOpen(false);
      const target = steps[clamped];
      remainingRef.current = stepSeconds(target) * 1000;
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

  /** ±15s / +10s: shift the leftover time, the deadline and any pending alert. */
  const adjustRemaining = (deltaMs: number, floorMs = 0) => {
    const next = Math.max(floorMs, remainingRef.current + deltaMs);
    remainingRef.current = next;
    if (endsAtRef.current !== null) {
      endsAtRef.current = Date.now() + next;
      if (step.type === 'rest') {
        void syncRestNotification(endsAtRef.current, exerciseNameLabel(language, getGuidedNextName(steps, stepIndex) ?? ''));
      }
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
    if (mode !== 'player' || frozen) {
      // Pausing freezes the leftover time; the deadline is re-derived on resume.
      endsAtRef.current = null;
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
    endsAtRef.current = Date.now() + Math.max(0, remainingRef.current);

    // A rest is the one wait long enough to put the phone down for, so its
    // deadline also goes to the OS — that alert is what reaches the user when
    // Android has suspended us. Not once it has already passed, though: a
    // deadline in the past is an alert that fires the moment it is set.
    if (step.type === 'rest' && endsAtRef.current > Date.now()) {
      void syncRestNotification(endsAtRef.current, exerciseNameLabel(language, getGuidedNextName(steps, stepIndex) ?? ''));
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
          if (step.type === 'rest' && next > -1500) {
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
  }, [mode, frozen, stepIndex, step.type, cue, steps, syncRestNotification]);

  /* ── hardware back: exit sheet in player, plain leave on entry ── */
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // The player is locked while Finish saves (the overlay at the end of the render); the sheet
      // this opens holds a discard, which is not for the middle of a save either.
      if (isSavingWorkout) {
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
    return lift && planSet
      ? formatSetScheme(
          lift.sets.length,
          // The lowered target, when there is one — the plan says what the
          // dial will open on.
          isLoweredTarget(planSet) ? planSet.plannedTargetReps! : planSet.plannedRepsMin,
          isLoweredTarget(planSet) ? planSet.plannedTargetReps! : planSet.plannedRepsMax,
          lift.trackingMode,
        )
      : '';
  };

  /**
   * The walk-up's slice of the contents: as many rows as the room under its
   * cards holds, the lift being walked up to first (lib/guidedRunPreview).
   * Null — no list at all — until both heights are measured, and whenever
   * not one row fits; the buttons below never give way to it.
   */
  const walkRunItems = step.type === 'position' ? buildGuidedRunSheet(stepPlan, stepIndex) : [];
  const walkRunFit =
    step.type === 'position' && walkViewportHeight > 0 && walkTopHeight > 0
      ? fitRunPreview({
          count: walkRunItems.length,
          currentIndex: walkRunItems.findIndex((item) => item.status === 'current'),
          availableHeight: walkViewportHeight - WALK_RUN_CHROME - walkTopHeight,
          headHeight: WALK_RUN_HEAD,
          rowHeight: WALK_RUN_ROW,
        })
      : null;

  const completedSetCount = exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => set.status === 'completed').length,
    0,
  );

  /* ── actions ── */
  const startAt = (index: number) => {
    setMode('player');
    goTo(index);
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
      imageUrl: match?.imageUrls?.[0] ?? null,
      initials: exerciseNameLabel(language, name).slice(0, 2).toUpperCase(),
    };
  }, [exerciseLibrary, language, resolveSlotHistory, step]);

  const swapOptions = useMemo(() => {
    if (!actionExercise) {
      return [];
    }
    return buildSwapOptionsForSlot(
      actionExercise.substitutionGroup,
      actionExercise.exerciseName,
      tailoringPreferences,
    );
  }, [actionExercise, tailoringPreferences]);

  /**
   * Every lift in today's session as the reader sees it, the one being
   * swapped included. Swapping to one of them is doing it twice and calling
   * it a change — Home and the programme day have left them out since
   * 2026-08-26; this sheet offered even the lift it was replacing
   * (emulator, 2026-09-27).
   */
  const sessionLiftLabels = useMemo(
    () => new Set(exercises.map((exercise) => exerciseNameLabel(language, exercise.exerciseName))),
    [exercises, language],
  );

  /** The programme's own alternatives, which are better answers than a search. */
  const swapSuggestions = useMemo(() => {
    const query = swapQuery.trim();
    // One row per name the reader sees: the pool holds "Bench Press" and
    // "Barbell Bench Press - Medium Grip", both "Penkkipunnerrus" (emulator,
    // 2026-09-27). The first — the tailoring pass's pick — stays.
    const shown = new Set<string>();
    const names = swapOptions
      .map((option) => option.exerciseName)
      .filter((name) => {
        const label = exerciseNameLabel(language, name);
        if (sessionLiftLabels.has(label) || shown.has(label)) {
          return false;
        }
        shown.add(label);
        return true;
      });
    if (!query) {
      return names;
    }
    return names.filter((name) => exerciseMatchesQuery(`${name} ${exerciseNameLabel(language, name)}`, query));
  }, [language, sessionLiftLabels, swapOptions, swapQuery]);

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
    () => ({ category: swapCategory, bodyPart: swapBodyPart, equipment: swapEquipment }),
    [swapBodyPart, swapCategory, swapEquipment],
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
      narrowSwapAlternatives(swapSuggestionRows, swapFilters).map(({ name, item }) => ({
        key: `suggested-${name}`,
        name,
        item,
      })),
    [swapFilters, swapSuggestionRows],
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
    setSwapCategory('all');
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
    unpause();
  };

  const handleAddSet = () => {
    if (!actionSlotId) {
      return;
    }
    workout.addSet(actionSlotId);
    setPauseSheetOpen(false);
    unpause();
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
    const defaults = getExerciseTemplateDefaults(
      item,
      anchor ? anchor.restSecondsMin : NO_ANCHOR_DEFAULT_REST_SECONDS,
    );
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
    });
  };

  const backOne = () => {
    const target = getGuidedBackTargetIndex(steps, stepIndex);
    const targetStep = steps[target];
    if (targetStep?.type === 'set' && isSetCompleted(targetStep.slotId, targetStep.setIndex)) {
      workout.undoSet(targetStep.slotId, targetStep.setIndex);
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
    setExitOpen(false);
    if (completedSetCount > 0) {
      setConfirmingEnd(true);
      return;
    }
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
  const totalSets = activeExercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
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
          repsLabel: formatRepRangeLabel(planSetOf(exercise.sets)),
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
    const todaySets = (instance?.sets ?? [])
      .filter((set) => set.status === 'completed')
      .map((set) => ({ loadKg: set.actualLoadKg ?? 0, reps: set.actualReps ?? 0 }));
    return buildExerciseSheetHistory(
      past,
      todaySets.length > 0 ? { performedAt: new Date().toISOString(), sets: todaySets } : null,
      language,
      instance?.trackingMode ?? 'load_and_reps',
      unitPreference,
    );
  }, [exerciseBySlot, language, liftHistory, step, unitPreference, workout.history]);

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

  /** Into the next set before the clock gets there. */
  const startRestNextSet = () => {
    advance();
  };

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
    // The reps were lowered after a short session: the card says so, with the
    // programme's own number beside it (2026-09-09 rule, lib/progressionGate).
    const firstSet = planSetOf(instance.sets);
    const loweredTarget = firstSet !== undefined && isLoweredTarget(firstSet) && target.reps === firstSet.plannedTargetReps;
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
      planLine: supersetNextBySlot.get(step.slotId)
        ? t(language, 'guided.walk.planSuperset', {
            sets: instance.sets.length,
            reps: target.reps,
            name: exerciseNameLabel(language, supersetNextBySlot.get(step.slotId) ?? ''),
          })
        : instance.sets.some((set) => set.rampTargetReps !== undefined)
          ? // A ramp's plan is set by set — "10/8/6", the heaviest one more
            // than last time — not one number for every set (2026-10-01).
            t(language, 'guided.walk.planRamp', {
              // What the dial will open each set at when the sets go as
              // planned: its own ramp target, and a set past the ramp carries
              // the one before, as the dial does — not the ceiling.
              reps: instance.sets
                .reduce<number[]>((shown, set, index) => {
                  const own = set.rampTargetReps ?? (index > 0 ? shown[index - 1] : undefined);
                  shown.push(own ?? resolveTarget(step.slotId, index)?.reps ?? set.plannedRepsMax);
                  return shown;
                }, [])
                .join('/'),
              rest: instance.restSecondsMin,
            })
        : loweredTarget
          ? t(language, 'guided.walk.planLowered', {
              sets: instance.sets.length,
              reps: target.reps,
              // The programme's own reps — a range reads as one ("8–12").
              programme: formatProgrammeReps(firstSet!),
              rest: instance.restSecondsMin,
            })
          : t(language, 'guided.walk.plan', {
            sets: instance.sets.length,
            reps: target.reps,
            /*
             * The LOWER bound — that is what the timer runs.
             *
             * `buildGuidedSteps` is handed `restSeconds: exercise.restSecondsMin`,
             * so a Back Squat prescribed 120-180 rests for 120. This card said 180
             * and the ring thirty seconds later said 2:00 (review, PR #57). The
             * comment that used to sit here claimed the opposite, which is why the
             * number went unchecked.
             */
            rest: instance.restSecondsMin,
          }),
      // Last time's own span, the same way the set card's chips show it —
      // one weight when every set matched, the range when they did not.
      lastValue: formatLoadOrRange(last?.sets.map((set) => set.loadKg) ?? []),
      lastReps: last?.sets.length ? last.sets.map((set) => set.reps).join(' · ') : null,
    };
  })();

  /** The lift being walked to, if it is currently plateaued — see plateauNotice. */
  const walkPlateau = step.type === 'position' ? plateauNotice?.(step.exerciseName) ?? null : null;

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
                t(language, 'guided.count.sets', { count: totalSets }),
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
                      } · ${t(language, 'guided.count.sets', { count: totalSets })}`,
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
                                repsLabel: formatRepRangeLabel(planSetOf(exercise.sets)),
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
                <MediaZone name={step.drillName} library={exerciseLibrary} height={270} mode="drill" language={language} />
                <View style={{ height: 20 }} />
                <NameBlock
                  name={step.drillName}
                  hasHowTo={Boolean(libraryFor(step.drillName)?.instructions?.length)}
                  language={language}
                  onHow={() => setHowtoOpen(true)}
                />
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                  <Text
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
                        setPaused(true);
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
                    height={210}
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
                    {walkRunItems.slice(walkRunFit.start, walkRunFit.end).map((item) => {
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
                    {walkRunFit.hidden > 0 ? (
                      <View style={styles.walkRunRow}>
                        <Text style={styles.walkRunMore}>
                          {t(language, 'guided.walk.contentMore', { count: walkRunFit.hidden })}
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
                    onPress={() => setPaused((value) => !value)}
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
              resolveTarget={resolveTarget}
              // Pause pauses, and nothing else. It used to open the actions
              // sheet on the way, so the one control you reach for when the
              // rack is taken put five decisions in front of you first.
              onPause={() => {
                if (paused) {
                  unpause();
                  return;
                }
                setPaused(true);
                workout.pauseWorkout();
              }}
              onOpenActions={() => setPauseSheetOpen(true)}
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
            />
          )}

          {step.type === 'rest' && (
            <StepIn stepKey={`rest-${stepIndex}`}>
              <View style={{ flex: 1, minHeight: 0 }}>
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
                  accessibilityRole="button"
                  style={styles.restRunStrip}
                  onPress={() => setRunSheetOpen(true)}
                >
                  <Text style={styles.restRunStripText}>{t(language, 'guided.runSheet.title')}</Text>
                  <Text style={styles.restRunStripMeta}>
                    {t(language, 'guided.runSheet.progress', { done: completedSetCount, count: totalSets })}
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
                        onOpenSystemSettings?.();
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
                        reader from the belt they are standing on. */}
                    {step.recoveryKind ? null : (
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
                    )}
                    {step.recoveryKind ? null : (
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
                    )}
                    <View style={{ flex: 1 }}>
                      <GhostBtn
                        icon={paused ? 'play' : 'pause'}
                        tint={theme.amberInk}
                        label={t(language, paused ? 'guided.resume' : 'guided.pause')}
                        onPress={() => setPaused((value) => !value)}
                      />
                    </View>
                  </View>
                  {/* No "Swap exercise" here any more (user 2026-08-23): rest
                      is rest, and the swap lives behind the set screen's menu.
                      And no "skip rest" on an interval's easy half: skipping
                      the walk is skipping half the exercise, not shortening a
                      wait (#bugs 2026-08-26). Pause stays on both. */}
                  {step.recoveryKind ? null : (
                    <Pressable accessibilityRole="button" style={styles.skipRestBtn} onPress={startRestNextSet}>
                      <GPIcon name="skip" size={18} color={theme.ink} />
                      <Text style={{ fontSize: 15.5, fontWeight: '800', color: theme.ink }}>{t(language, 'guided.skipRest')}</Text>
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
          // A fresh set of draft fields for the set the reader just picked —
          // switching rows must not keep the previous set's typed text
          // sitting over the newly selected one's numbers.
          key={`rest-edit-${restEdit.slotId}-${restEdit.setIndex}`}
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
          imageUrl={setPanelSource?.imageUrl ?? null}
          initials={setPanelSource?.initials ?? ''}
          instructions={setPanelSource?.instructions ?? []}
          learn={sheetLearn}
          watchFor={sheetWatchFor}
          history={sheetHistory}
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

      {exitOpen && (
        <GPSheet
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
      )}

      {/*
        The session, read out loud.

        Deliberately inert: nothing here jumps you anywhere. Being able to see
        the fourth lift while resting after the second is a different need from
        wanting to skip to it, and a list you can fall through with a thumb
        while your hands are chalked is how sets get skipped by accident.
      */}
      {runSheetOpen && (
        <GPSheet
          title={t(language, 'guided.runSheet.title')}
          language={language}
          onClose={() => setRunSheetOpen(false)}
          bottomInset={screenInsets.bottom}
          scrollable
        >
          {buildGuidedRunSheet(stepPlan, stepIndex).map((item) => {
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
                          onPress={() => {
                            setRunSheetOpen(false);
                            setRestEdit({
                              slotId: correction.lift.slotId,
                              setIndex: correction.setIndex,
                              justLoggedSetIndex: justLogged ? correction.setIndex : -1,
                            });
                          }}
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
          })}
        </GPSheet>
      )}

      {pauseSheetOpen && (
        <GPSheet
          title={t(language, 'guided.pauseSheet.title')}
          language={language}
          onClose={() => {
            setPauseSheetOpen(false);
            unpause();
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
                setPauseSheetOpen(false);
                unpause();
                setRunSheetOpen(true);
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
                  unpause();
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
                    onPress={() => {
                      setPauseSheetOpen(false);
                      setSwapOpen(true);
                    }}
                  />
                ) : null}
                {/* Red, and it asks. This sat between two other outlined rows
                    and threw away a whole exercise on one tap. */}
                <GhostBtn
                  icon="x"
                  danger
                  label={t(language, 'guided.action.skipExercise')}
                  onPress={() => setConfirmingSkipExercise(true)}
                />
              </>
            ) : null}
          </View>
        </GPSheet>
      )}

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
        onCancel={() => setConfirmingSkipExercise(false)}
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
          setSwapCategory(next.category);
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
        onSelect={(entry) => applySwap(entry.name)}
        onClose={() => {
          setSwapOpen(false);
          setSwapQuery('');
          setSwapBodyPartFilter(null);
          setSwapCategory('all');
          setSwapEquipment('all');
          unpause();
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
 * lowered target when a short session brought one (lib/progressionGate
 * resolveMissedRepsTarget): the overview says what the dial will open on.
 */
function formatRepRangeLabel(
  set: { plannedRepsMin: number; plannedRepsMax: number; plannedTargetReps?: number } | undefined,
): string {
  if (!set) {
    return '';
  }
  if (isLoweredTarget(set)) {
    return `${set.plannedTargetReps}`;
  }
  return formatProgrammeReps(set);
}

/** The programme's own reps for a set, "8–12" or "8". */
function formatProgrammeReps(set: { plannedRepsMin: number; plannedRepsMax: number }): string {
  if (set.plannedRepsMin === set.plannedRepsMax) {
    return `${set.plannedRepsMax}`;
  }
  return `${set.plannedRepsMin}–${set.plannedRepsMax}`;
}

/** A target lowered below the programme's floor after a short session. */
/**
 * The set a plan line describes: the next one still to do. A swap rewrites
 * only the sets ahead, so a set logged before it keeps the old lift's
 * prescription — `sets[0]` described a lift no longer in the slot.
 */
function planSetOf<T extends { status: string }>(sets: T[]): T | undefined {
  return sets.find((set) => set.status === 'pending') ?? sets[sets.length - 1];
}

function isLoweredTarget(set: { plannedRepsMin: number; plannedTargetReps?: number }): boolean {
  return typeof set.plannedTargetReps === 'number' && set.plannedTargetReps < set.plannedRepsMin;
}

/**
 * Session clock for the set screen's top-right readout: m:ss, growing to
 * h:mm:ss so a session left running overnight stays readable.
 */
function formatSessionClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const seconds = String(safe % 60).padStart(2, '0');
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) {
    return `${minutes}:${seconds}`;
  }
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

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
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.editVeil}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessible={false} />
        <View style={[styles.editSheet, { paddingBottom: bottomInset + 20 }]}>
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
                  ? t(language, 'guided.rest.setRowUnloaded', { reps: row.reps })
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
        </View>
      </View>
    </Modal>
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
}: {
  stepIndex: number;
  step: Extract<GuidedStep, { type: 'set' }>;
  exercise: WorkoutExerciseInstance | null;
  /** The whole superset this set belongs to, in order. Null for a lift on its own. */
  superset: { members: Array<{ slotId: string; name: string }> } | null;
  language: AppLanguage;
  paused: boolean;
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
    imageUrl: string | null;
    initials: string;
  } | null;
  onConfirm: (slotId: string, setIndex: number, reps: number, loadKg: number | null) => void;
  /** A bout of minutes reached its prescription on the clock — a cue, nothing logged. */
  onMinutesReached?: () => void;
  /** The bout's stopwatch as the session keeps it; read when the set opens. */
  minutesClock?: SessionMinutesClock | null;
  /** The stopwatch started or paused, for the session to keep. */
  onMinutesClockChange?: (clock: SessionMinutesClock) => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const target = resolveTarget(step.slotId, step.setIndex);
  // A hold logs no weight either, so it takes the same wide layout — but its
  // number is seconds, and seconds are dialled in fives, not ones.
  const bodyweight = exercise ? isUnloadedTrackingMode(exercise.trackingMode) : false;
  // Uniform stays the plain rep-chip row it always was; a ramp gets weight×reps
  // on every chip instead of one heading number, so it reads as a ramp rather
  // than a single weight with an unexplained jump partway through (#bugs 2026-09-29).
  const historyChips = panels?.history ? summarizeHistoricalSetChips(panels.history.sets) : null;
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
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
  /** Which dial is open for editing; null = both locked. */
  const [dial, setDial] = useState<'reps' | 'weight' | null>(null);
  /**
   * The weight field holds text that is not a weight — "825" for 82,5, or
   * "82,,5". The dial keeps its last good number meanwhile, so logging would
   * write a number the field does not show; the log button waits instead.
   * Only while the field is open: closing it shows the number the dial kept.
   */
  const [weightTextInvalid, setWeightTextInvalid] = useState(false);
  useEffect(() => {
    setWeightTextInvalid(false);
  }, [dial, stepIndex]);
  const logBlocked = dial === 'weight' && weightTextInvalid;

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
        {superset ? (
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
          )}
          accessibilityHint={t(language, 'guided.panelsToggle')}
          onPress={onOpenSheet}
          style={styles.setExerciseCard}
        >
          <View style={styles.setExerciseTop}>
            <View style={styles.setExerciseThumb}>
              {panels?.imageUrl ? (
                <Image source={{ uri: panels.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <Text style={styles.setExerciseInitials}>{panels?.initials ?? ''}</Text>
              )}
              <View style={styles.setExercisePlay}>
                <GPIcon name="play" size={11} color={theme.onHighlight} sw={2.6} />
              </View>
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
          {panels?.history ? (
            <View style={styles.setExerciseLast}>
              {/* One heading, whichever day the history came from. Borrowed
                  history got its own "ERI PÄIVÄ" line on 2026-09-09; the
                  reader asked for it gone (#bugs 2026-09-30, "jätä tuo
                  viimekerralla mutta pois eri päivä"). The card's
                  accessibility label above still says it. */}
              <Text style={styles.setExerciseLastLabel}>{t(language, 'guided.card.lastTime')}</Text>
              {/* Only a uniform session gets the single heading number — a
                  ramp has no one weight to lead with, and the per-set chips
                  below already say the whole thing (decision "a", #bugs
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
              <View style={styles.setExerciseLastPills}>
                {panels.history.sets.map((set, index) => (
                  <View key={set.setIndex} style={styles.setExerciseLastPill}>
                    <Text style={styles.setExerciseLastPillText}>
                      {minutesMode
                        ? t(language, 'logger.minutesValue', { count: set.reps })
                        : historyChips?.chips[index] ?? set.reps}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.setExerciseFirstTime}>{t(language, 'guided.card.firstTime')}</Text>
          )}
        </Pressable>

        {/* The set counter, its dots and the add button — and nothing else.
            The session clock used to share this row, and the dots grow with
            every set added: at seven the clock was against the edge and the
            next one pushed it off the screen (#bugs 2026-08-26, "sarja ja
            kello ei voi olla vierekkäin"). It sits on the name row now, where
            nothing grows, and the dots absorb the squeeze here. */}
        <View style={styles.setMetaRow}>
          {inWarmup ? (
            <View style={styles.setMetaLeft}>
              <View style={styles.warmupDot} />
              <Text style={styles.setCounter}>{t(language, 'guided.warmup.title', { index: warmups.length + 1 })}</Text>
            </View>
          ) : (
          <View style={styles.setMetaLeft}>
            <Text style={styles.setCounter}>
              {t(language, 'guided.setOfCount', { index: step.setIndex + 1, count: step.setCount })}
            </Text>
            {/* Capped at nine. The reader can add sets without limit and the
                row cannot grow without limit — past nine the dots were thinner
                than the gaps between them and the +/− were against the edge
                (user 2026-09-04). Beyond the cap the counter above still says
                the true number. */}
            <View style={styles.setDots}>
              {Array.from({ length: Math.min(step.setCount, SET_DOT_CAP) }).map((_, index) => {
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
            ) : null}
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
        </View>

        {/* The warm-ups logged so far, and the button that adds one. Only on
            the first working set: once the work has started, a warm-up is not
            what comes next. A logged one is taken back with its ×. */}
        {canWarmUp && (warmups.length > 0 || !inWarmup) ? (
          <View style={styles.warmupRow}>
            {warmups.map((warmup, index) => (
              <Pressable
                key={`${index}-${warmup.completedAt}`}
                accessibilityRole="button"
                accessibilityLabel={t(language, 'guided.warmup.remove', {
                  index: index + 1,
                  kg: removeTrailingZeros(warmup.loadKg),
                  reps: warmup.reps,
                })}
                hitSlop={8}
                onPress={() => onRemoveWarmup(index)}
                style={styles.warmupChip}
              >
                <Text style={styles.warmupChipText}>
                  {t(language, 'guided.warmup.chip', { kg: removeTrailingZeros(warmup.loadKg), reps: warmup.reps })}
                </Text>
                <GPIcon name="x" size={11} color={theme.muted} sw={2.6} />
              </Pressable>
            ))}
            {!inWarmup ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'guided.warmup.add')}
                hitSlop={8}
                onPress={enterWarmup}
                style={styles.warmupAdd}
              >
                <GPIcon name="plus" size={12} color={theme.blue} sw={3} />
                <Text style={styles.warmupAddText}>{t(language, 'guided.warmup.add')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}


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
          <View style={styles.setDialRow}>
            <DialCard
              label={t(language, minutesMode ? 'guided.minutes' : timed ? 'guided.seconds' : 'guided.reps')}
              value={String(minutesMode ? shownMinutes : reps)}
              unit={minutesMode ? 'min' : null}
              open={dial === 'reps'}
              onToggle={() => setDial((current) => (current === 'reps' ? null : 'reps'))}
              onStep={(direction) =>
                minutesMode
                  ? stepMinutes(direction)
                  : setReps((current) => stepDialReps(current, direction, timed ? HOLD_DIAL : REPS_DIAL))
              }
              onCommit={(text) =>
                minutesMode
                  ? commitMinutes(text)
                  : setReps((current) => commitDialReps(text, current, timed ? HOLD_DIAL : REPS_DIAL))
              }
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
                onToggle={() => setDial((current) => (current === 'weight' ? null : 'weight'))}
                // 1.25 kg per step (user wish, #bugs 2026-08-26): the smallest
                // real plate pair. Bounded at both ends now — a held button
                // accelerates to a tick every 45 ms and the top end had nothing
                // stopping it. See lib/weightDial.
                onStep={(direction) => setKg((current) => stepDialWeight(current, direction))}
                onCommit={(text) => {
                  setWeightTextInvalid(!isLoggableTypedWeight(text));
                  setKg((current) => commitDialWeight(text, current));
                }}
                // From the dial's own step, not a number in the copy — the
                // copy said 2,5 kg while the dial moved 1,25.
                downLabel={weightStepAccessibilityLabel(language, -1)}
                upLabel={weightStepAccessibilityLabel(language, 1)}
                editHint={t(language, 'guided.a11y.tapToEdit')}
                wide={false}
                faint={kg <= 0}
                invalid={logBlocked}
                onDraftCleared={() => setWeightTextInvalid(false)}
              />
            ) : null}
          </View>

          {/* Why the log button is waiting, in words. The typed number going
              red was the only sign, and colour is neither read aloud nor seen
              by everyone (accessibility audit, 2026-09-21). Polite, so it is
              announced once when it appears and not on every keystroke. */}
          {logBlocked ? (
            <View style={styles.setWeightError} accessibilityLiveRegion="polite">
              <Text style={styles.setWeightErrorText}>{t(language, 'guided.weightInvalid')}</Text>
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

        <View style={{ paddingHorizontal: 22 }}>
          {inWarmup ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'guided.warmup.log')}
                accessibilityState={{ disabled: logBlocked || kg <= 0 }}
                // No weight, no warm-up: the store refuses 0 kg, and the
                // screen must not leave as if it had been saved.
                disabled={logBlocked || kg <= 0}
                onPress={() => {
                  onLogWarmup(kg, reps);
                  leaveWarmup();
                }}
                style={({ pressed }) => [styles.warmupLogButton, pressed && { opacity: 0.9 }, (logBlocked || kg <= 0) && { opacity: 0.4 }]}
              >
                <GPIcon name="check" size={18} color={theme.blue} sw={2.8} />
                <Text style={styles.warmupLogButtonText}>{t(language, 'guided.warmup.log')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={leaveWarmup} style={styles.warmupCancel}>
                <Text style={styles.warmupCancelText}>{t(language, 'guided.warmup.cancel')}</Text>
              </Pressable>
            </>
          ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'guided.logSetIndex', { index: step.setIndex + 1 })}
            accessibilityState={{ disabled: logBlocked }}
            disabled={logBlocked}
            onPress={() => {
              setDial(null);
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
            <Text style={styles.setLogButtonText}>
              {t(language, 'guided.logSetIndex', { index: step.setIndex + 1 })}
            </Text>
          </Pressable>
          )}
        </View>

        {/* Two buttons, no more (user 2026-08-23): pause, and the menu.
            Mute and swap moved behind the dots with the rest of the
            "something else" actions — a set screen's own controls are the
            ones you use mid-set.

            Labelled, though. A bare circle is a control the reader has to
            press to find out what it does, and one of these two ends up
            being pressed to find out. */}
        <View style={styles.setControls}>
          <View style={styles.setControl}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, paused ? 'guided.resume' : 'guided.pause')}
              onPress={onPause}
              style={styles.setRoundBtn}
            >
              <GPIcon name={paused ? 'play' : 'pause'} size={24} color={theme.ink} sw={2.2} />
            </Pressable>
            <Text style={styles.setControlLabel}>
              {t(language, paused ? 'guided.resume' : 'guided.pause')}
            </Text>
          </View>
          <View style={styles.setControl}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'guided.a11y.actions')}
              onPress={onOpenActions}
              style={styles.setRoundBtn}
            >
              <GPIcon name="dots" size={24} color={theme.ink} sw={2.2} />
            </Pressable>
            <Text style={styles.setControlLabel}>{t(language, 'guided.a11y.actions')}</Text>
          </View>
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
          {(libraryItem?.instructions ?? []).map((instruction, index) => (
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

const makeStyles = (theme: Theme) => StyleSheet.create({
  /* entry */
  entryRoot: { flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 },
  entryEyebrow: { fontSize: 12.5, fontWeight: '800', letterSpacing: 1.5, color: theme.muted },
  entryTitle: { marginTop: 8, marginBottom: 4, fontSize: 32, fontWeight: '800', letterSpacing: -0.6, color: theme.ink },
  entrySub: { fontSize: 14.5, fontWeight: '600', color: theme.muted },
  resumeCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.highlightSoft,
    borderWidth: 1.5,
    borderColor: theme.highlight,
    borderRadius: 18,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  entryLastRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  entryProgressPill: {
    backgroundColor: theme.highlightSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 0,
  },
  entryProgressPillText: { fontSize: 12.5, fontWeight: '800', color: theme.highlight },
  // A block of the list, not a card. The box and its 15 px of padding a side
  // were width the lift names needed: "Ojentajapushdown" broke mid-word at the
  // phone's text size (#bugs 2026-09-30, "laatikointi pois ... levennetään").
  // A hairline under each block keeps them apart.
  phaseCard: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 18,
  },
  phaseRows: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingVertical: 8,
    marginBottom: 6,
  },
  // The box a paired row lives in on the entry table, and the label that
  // straddles its top line.
  phaseSupersetGroup: {
    borderRadius: 12,
    paddingTop: 8,
    paddingBottom: 2,
    marginVertical: 6,
  },
  phaseSupersetPill: {
    position: 'absolute',
    top: -7,
    left: 20,
    // The page, now that the block sits on it rather than on a card.
    backgroundColor: theme.bg,
    paddingHorizontal: 6,
  },
  phaseSupersetPillText: {
    color: theme.purple,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  phaseRowGroup: {
    paddingLeft: 4,
    paddingRight: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
  },
  // Name first and wide, wrapping as far as it needs; the three number
  // columns are fixed so a value sits in the same place on every row, blank
  // or not. Sized so "SARJAT" and "TOISTOT" fit their heads on one line.
  phaseRowName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 17, fontWeight: '700', color: theme.ink },
  phaseCol: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  phaseColHead: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3, color: theme.faint, textAlign: 'right' },
  // As wide as the reps column: "SARJAT" did not fit in 38 and read
  // "SARJA…" (#bugs 2026-09-22), and the two headers are the same kind of word.
  phaseColSets: { width: 46 },
  phaseColReps: { width: 46 },
  phaseColLoad: { width: 60 },
  // The step number's disc. Same size and place the play disc held, so the
  // header's rhythm is unchanged — only the thing inside it means something now.
  phaseStep: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: theme.highlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseStepText: { fontSize: 17, fontWeight: '800', color: theme.highlight },
  // `accent`, not `green`: this is the "do the thing" button, the same one
  // Home's Start workout is, and in dark that action colour is orange while
  // green keeps meaning *done*. In light both tokens are the same green, so
  // nothing moves there.
  startCta: {
    height: 60,
    borderRadius: 19,
    backgroundColor: theme.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 18,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 8,
  },
  startOverLink: {
    alignSelf: 'center',
    paddingTop: 14,
    paddingHorizontal: 12,
  },
  startOverText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
  },

  /* chrome */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  topBtnDark: {
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderColor: GPD.line,
  },
  // Lit while the panel it opens is showing: the button is a toggle, and a
  // toggle you cannot see the state of is a button you press twice.
  topBtnActive: {
    backgroundColor: theme.purpleLight,
    borderColor: theme.purple,
  },
  topLabel: { flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '800', letterSpacing: 1.6, marginHorizontal: 8 },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 4,
  },
  railSetPill: {
    flex: 2.6,
    height: 16,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  /* media */
  mediaZone: {
    height: 250,
    marginTop: 12,
    // Wider than the rest of the content so the exercise photo reads bigger.
    marginHorizontal: 10,
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  mediaInitials: { fontSize: 118, fontWeight: '800', letterSpacing: -5, color: 'rgba(124,58,237,0.22)' },

  /* interval */
  intervalRound: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: theme.muted,
    marginBottom: 10,
  },
  // The one word you read at a glance while moving, so it carries the weight
  // the reps number carries on an ordinary set.
  intervalPhase: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  intervalNext: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    marginTop: 12,
  },

  /* splash / ready */
  splashRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 32 },
  splashTitle: { fontSize: 46, fontWeight: '800', letterSpacing: -1.4, color: theme.ink, textAlign: 'center' },
  /**
   * The block had no style at all, which is not the same as "no layout".
   *
   * An unstyled View takes the width of its widest child — here the "warm-up
   * done" row — and its other children stretch to that width and then sit at
   * its left edge, because only the big title carried textAlign: 'center'. So
   * the eyebrow and the meta line landed left of the title while the title was
   * centred, and the block read as crooked (user 2026-08-26, "tekstit ovat
   * ihan vinossa"). Centring the box centres every line in it, whatever the
   * line happens to be.
   */
  splashCopy: { alignItems: 'center', gap: 6 },

  // The phase intro that carries a fork: copy in the upper half, the two
  // buttons down where a thumb rests rather than floating mid-screen.
  splashChoiceRoot: {
    flex: 1,
    paddingHorizontal: 26,
    paddingTop: 20,
    // Lifted off the bottom edge (user 2026-08-26, "vähän ylemmäs nappeja"):
    // the pair sat against the system bar, which on a tall phone is below
    // where a thumb rests rather than at it.
    paddingBottom: 64,
    justifyContent: 'space-between',
  },
  splashChoiceCopy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },

  /* doing a block your own way */
  ownBlockSheet: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg },
  // 62pt was the size of a target. This clock is a record of what you have
  // spent, and the drill countdowns are the numbers worth being that big.
  ownBlockClock: {
    textAlign: 'center',
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  ownBlockHint: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.muted,
    textAlign: 'center',
    maxWidth: 300,
  },
  ownBriefCard: {
    marginTop: 18,
    alignSelf: 'stretch',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  ownBriefLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.3, color: theme.faint },
  ownBriefChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  ownBriefChip: {
    backgroundColor: theme.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  ownBriefChipText: { fontSize: 12.5, fontWeight: '700', color: theme.ink },
  ownBriefFirst: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, gap: 3 },
  ownBriefFirstName: { fontSize: 15.5, fontWeight: '800', color: theme.ink },
  ownBriefFirstScheme: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.highlight,
    fontVariant: ['tabular-nums'],
  },
  /* the warm-up / recovery gate */
  gateCard: {
    flexGrow: 0,
    // Stretched, because the copy block that holds it centres its children —
    // left to itself the card shrank to its content and the drill names came
    // out as "…" (device 2026-09-04).
    alignSelf: 'stretch',
    marginTop: 18,
    maxHeight: 260,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  gateRowIndex: {
    width: 18,
    fontSize: 13,
    fontWeight: '800',
    color: theme.faint,
    fontVariant: ['tabular-nums'],
  },
  gateRowName: { fontSize: 15, fontWeight: '700', color: theme.ink },
  gateRowWhy: { fontSize: 12.5, fontWeight: '600', color: theme.muted, marginTop: 1 },
  gateRowLength: {
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  gateOwnBtn: {
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
  },
  gateOwnLabel: { fontSize: 16, fontWeight: '800', color: theme.ink },
  gateOwnSub: { fontSize: 12.5, fontWeight: '600', color: theme.muted, textAlign: 'center' },
  // No border, no fill — quieter than the two buttons above it on purpose.
  gateAddExerciseLink: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  gateAddExerciseLinkText: { fontSize: 14, fontWeight: '700', color: theme.muted },
  readyDigit: { fontSize: 150, fontWeight: '800', letterSpacing: -7, color: theme.ink, lineHeight: 160, fontVariant: ['tabular-nums'] },

  /* drill / set */
  exerciseName: { fontSize: 27, fontWeight: '800', letterSpacing: -0.5, color: theme.ink, lineHeight: 31, textAlign: 'center' },
  cueRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 7, maxWidth: '100%' },
  howToLink: { fontSize: 13, fontWeight: '800', color: theme.purple },
  positionName: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
    color: theme.ink,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  positionPlan: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.muted,
  },
  drillCountdown: { fontSize: 104, fontWeight: '800', letterSpacing: -4, lineHeight: 110, fontVariant: ['tabular-nums'] },
  ctrlCircle: {
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
  },
  /* set screen v4 */
  setMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingHorizontal: 24,
  },
  setMetaLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  // `highlight`, not `purple`. The player's own rule two hundred lines up is
  // "anything pressable is orange, violet carries brand", and the set counter,
  // the open dial's border, its label and its +/- buttons were all still
  // violet — the one cluster on the screen that had not been told (user
  // 2026-09-07, "otetaan vahan tuota purppuraa pois"). `highlight` is orange
  // in dark and the same violet in light, so this repaints the theme that was
  // complained about and leaves the other one exactly as it is.
  setCounter: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: theme.highlight, fontVariant: ['tabular-nums'] },
  // The dots are the one part of this row that grows without a bound — one
  // per set, and a reader can keep adding sets. They give way first, and the
  // counter beside them still says how many there are.
  setDots: { flexDirection: 'row', gap: 5, flexShrink: 1, overflow: 'hidden' },
  // Above the lift, because it changes what the next tap means: log this and
  // you are walking to the other station, not starting a rest.
  setSupersetPill: {
    // Top-left, where the frame's line used to run; the frame is gone from
    // this screen (device, 2026-09-16) and the badge stands on its own.
    position: 'absolute',
    top: -2,
    left: 26,
    borderRadius: 999,
    borderWidth: 1.4,
    borderColor: theme.purple,
    // Filled with the screen's own ground, which is what breaks the line
    // behind it instead of letting it run across the word.
    backgroundColor: theme.bg,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  setSupersetPillText: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: theme.purple,
  },
  setSupersetFlow: {
    marginTop: 24,
    marginBottom: 12,
    paddingHorizontal: 22,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: theme.faint,
  },
  /** The lift the screen is asking for, among the ones it names. */
  setSupersetFlowNow: {
    color: theme.ink,
    fontWeight: '900',
  },
  setDot: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* the lift's own card, at the top of the set screen */
  setExerciseCard: {
    marginHorizontal: 20,
    // Clear of the header. At 4 it sat against the ✕ and the speaker (user
    // 2026-09-04).
    marginTop: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  setExerciseTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  setExerciseThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setExerciseInitials: { fontSize: 20, fontWeight: '800', color: theme.faint },
  setExercisePlay: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    // The triangle's own mass sits left of centre in a 24-box.
    paddingLeft: 2,
  },
  setExerciseName: { flexShrink: 1, fontSize: 18, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
  // Bigger, and one claim rather than a list of three tab names the reader
  // has to have opened the sheet once to understand (user 2026-09-04).
  setExerciseHint: { marginTop: 4, fontSize: 14, fontWeight: '600', color: theme.muted },
  setExerciseLast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 9,
  },
  setExerciseLastLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  setExerciseLastLoad: {
    fontSize: 14.5,
    fontWeight: '800',
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  // A ramp's chips are "16,25×8" (7-8 characters), not the bare 1-2 digit rep
  // count this row was built for — five of them on one line can run past the
  // card's right edge with `justifyContent: 'flex-end'` pushing the overflow
  // off the near (left) side instead of clipping visibly (review, #bugs
  // 2026-09-29). `flexWrap` lets a wide row fall to a second line instead.
  setExerciseLastPills: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  setExerciseLastPill: {
    minWidth: 23,
    alignItems: 'center',
    backgroundColor: theme.surfaceSoft,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  setExerciseLastPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  setExerciseFirstTime: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 9,
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.muted,
  },
  setTargetArea: { flex: 1, minHeight: 0, justifyContent: 'center', paddingHorizontal: 22, gap: 10 },
  // Two dials of equal width. Each is a card, so the reps dial no longer
  // floats as a bare headline over a boxed weight — same shape, same weight.
  setDialRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  // A bout of minutes: the clock above the dial, on the same card ground.
  minutesClock: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  minutesClockTime: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.6,
    color: theme.ink,
    lineHeight: 58,
    fontVariant: ['tabular-nums'],
  },
  minutesClockOf: { fontSize: 13, fontWeight: '700', color: theme.muted },
  minutesClockDone: { fontSize: 13, fontWeight: '800', color: theme.ink, textAlign: 'center' },
  minutesClockButton: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  minutesClockButtonText: { fontSize: 15, fontWeight: '800', color: theme.ink },
  setDialCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  // A bodyweight lift has one dial; it takes the row rather than half of it.
  setDialCardWide: { flex: 1 },
  // On `surface`, not on the page: the light danger ink is 4.83:1 on white
  // and only 4.10 on `bg` (accessibility audit, 2026-09-21).
  setWeightError: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
    backgroundColor: theme.surface,
  },
  setWeightErrorText: { fontSize: 12.5, fontWeight: '800', color: theme.danger },
  // Open: the border says which card the buttons belong to.
  setDialCardOpen: { borderColor: theme.highlight, backgroundColor: theme.surface },
  setDialLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.1, color: theme.muted },
  // Under the number, always there. 52 wide so a gym thumb finds them; the
  // number above has the card's whole width to itself.
  setDialControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  setDialBtn: {
    width: 52,
    height: 40,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setDialBtnText: { fontSize: 22, fontWeight: '800', color: theme.highlight, lineHeight: 26 },
  // The number's own row: nothing beside it but its unit, so "16,25 kg" fits
  // at one size. The auto-fit on the number is a net for "102,5", no more.
  setDialValue: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 3,
    minWidth: 0,
    paddingVertical: 2,
  },
  setDialNumber: {
    flexShrink: 1,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.3,
    color: theme.ink,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    minWidth: 0,
    padding: 0,
  },
  setDialUnit: { fontSize: 14, fontWeight: '800', color: theme.faint },
  setBadgeRow: { alignItems: 'center', minHeight: 27 },
  // Green up, red down (user 2026-08-25): the progression chip states its
  // direction in colour, not just in sign. Purple stays on the badges that
  // explain provenance rather than a change (carried-from).
  setAutoBadgeUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    backgroundColor: theme.greenSoft,
  },
  setAutoBadgeUpText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.greenInk },
  setAutoBadgeDown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    backgroundColor: theme.dangerSoft,
  },
  setAutoBadgeDownText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.danger },
  // Quiet, not green: green now marks a raise, and a hold is the opposite
  // claim — the app deliberately NOT raising. Muted on the soft surface reads
  // as calm bookkeeping rather than either a success or an alarm.
  setHoldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    paddingHorizontal: 11,
    height: 27,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  setHoldBadgeText: { fontSize: 11.5, fontWeight: '900', letterSpacing: 0.4, color: theme.muted },
  // 64 → 52 and a lighter shadow: the button had the height of the two dials
  // above it put together, and the shadow made it read taller still.
  setLogButton: {
    height: 52,
    borderRadius: 18,
    // `accent`, the app's "do the thing" colour — the same one the session's
    // own start button wears. It was `purple`, which in dark is the brand
    // colour and not the pressable one.
    backgroundColor: theme.accent,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  setLogButtonText: { fontSize: 17, fontWeight: '800', color: theme.onHighlight, letterSpacing: -0.17 },
  setControls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 26, paddingTop: 14, paddingBottom: 10 },
  setControl: { alignItems: 'center', gap: 5 },
  setControlLabel: { fontSize: 11.5, fontWeight: '700', color: theme.muted },
  setAddBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.green,
    backgroundColor: theme.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * Warm-ups in blue (user, 2026-10-05): set apart from the green of the work
   * at a glance. Blue edges and ink text, not white on blue — white on the
   * light theme's #0A84FF falls short of 4.5:1.
   */
  warmupDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.blue,
  },
  warmupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    marginTop: 8,
  },
  warmupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // 36 high and 8 of slop each way: the 48 a tap needs (review, 2026-10-05).
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.blue,
    backgroundColor: theme.surface,
  },
  warmupChipText: {
    color: theme.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  warmupAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.blue,
  },
  warmupAddText: {
    color: theme.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  warmupLogButton: {
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: theme.blue,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  warmupLogButtonText: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  warmupCancel: {
    alignSelf: 'center',
    paddingVertical: 10,
  },
  warmupCancelText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  setRoundBtn: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#28185A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  bigBtn: {
    height: 60,
    borderRadius: 19,
    // Keeps the shimmer inside the button's corners.
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.33,
    shadowRadius: 24,
    elevation: 6,
  },
  bigBtnTall: { height: 70, borderRadius: 22 },
  bigBtnText: { fontSize: 16.5, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  bigBtnTextTall: { fontSize: 19 },
  ghostBtn: {
    height: 48,
    borderRadius: 15,
    borderWidth: 1.5,
    // Was a light-theme hex on both themes: a pale lilac outline drawn on the
    // dark page, brighter than the text inside it.
    borderColor: theme.border,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ghostBtnText: { fontSize: 14.5, fontWeight: '800', color: theme.ink },
  walkActions: { flexDirection: 'row', gap: 10 },
  walkAction: { flex: 1 },
  walkAddedNote: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    textAlign: 'center',
  },

  /* rest (light theme like every other in-workout screen) */
  // The ring itself carries the purple; label and figure stay ink so the
  // countdown reads like every other number in the player.
  restRingLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 2.6, color: theme.ink },
  // Stretched across the ring less its stroke, so RING_CLOCK_FIT's shrink has
  // a width to fit to.
  restCountdown: {
    alignSelf: 'stretch',
    paddingHorizontal: 22,
    textAlign: 'center',
    fontSize: 76,
    fontWeight: '800',
    letterSpacing: -2.9,
    color: theme.ink,
    lineHeight: 80,
    fontVariant: ['tabular-nums'],
  },
  /* walking to the next machine */
  walkStat: {
    flex: 1,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 13,
    gap: 3,
  },
  walkStatLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  walkStatValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  walkStatSub: { fontSize: 12, fontWeight: '600', color: theme.muted, fontVariant: ['tabular-nums'] },
  // Amber, matching Home's plateau card and the rest-denied banner above —
  // one finding, one colour, wherever it shows up.
  walkPlateauBanner: {
    borderWidth: 1,
    borderColor: theme.amberBorder,
    backgroundColor: theme.amberSoft,
    borderRadius: 14,
    padding: 12,
  },
  walkPlateauText: { fontSize: 12.5, fontWeight: '700', color: theme.amberInk, lineHeight: 18 },
  // The walk-up's contents list. Heading and rows are FIXED heights
  // (WALK_RUN_HEAD, WALK_RUN_ROW): the room is worked out before they are
  // drawn, and a row that grew with its text would spill past it.
  walkRun: { paddingHorizontal: 2 },
  walkRunHead: { height: WALK_RUN_HEAD, flexDirection: 'row', alignItems: 'center', gap: 4 },
  walkRunTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: theme.faint },
  walkRunRow: { height: WALK_RUN_ROW, flexDirection: 'row', alignItems: 'center', gap: 10 },
  walkRunDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkRunName: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: '700', color: theme.ink },
  walkRunPlan: { fontSize: 12.5, fontWeight: '700', color: theme.muted, fontVariant: ['tabular-nums'] },
  walkRunMore: { fontSize: 12.5, fontWeight: '700', color: theme.muted, paddingLeft: 26 },
  /* rest screen */
  restRunStrip: {
    marginHorizontal: 20,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  restRunStripText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: theme.ink },
  restRunStripMeta: { fontSize: 13, fontWeight: '700', color: theme.muted, fontVariant: ['tabular-nums'] },
  // Amber, not red: nothing is broken, one thing is off. Theme tokens, so it
  // reads in dark as well (the freestyle banner's fixed hexes are light-only).
  restDeniedBanner: {
    marginHorizontal: 20,
    marginTop: 8,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.amberBorder,
    backgroundColor: theme.amberSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  restDeniedTitle: { fontSize: 13.5, fontWeight: '800', color: theme.amberInk },
  restDeniedBody: { fontSize: 12.5, fontWeight: '700', color: theme.ink, marginTop: 3, lineHeight: 17 },
  restDeniedAction: { fontSize: 13, fontWeight: '800', color: theme.amberInk },
  editVeil: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  editTitle: { fontSize: 19, fontWeight: '800', color: theme.ink },
  editLiftName: { fontSize: 13, fontWeight: '700', color: theme.muted },
  editSetRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  editSetRowSelected: { borderColor: theme.highlight, backgroundColor: theme.highlightSoft },
  editSetRowText: { fontSize: 14.5, fontWeight: '700', color: theme.ink },
  editSetRowTextSelected: { color: theme.ink, fontWeight: '800' },
  // The finish step is the dark screen, so its failure copy is on GPD's ink.
  finishFailed: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  finishFailedTitle: { fontSize: 24, fontWeight: '800', color: GPD.ink },
  finishFailedBody: { fontSize: 15, lineHeight: 22, color: GPD.muted, marginBottom: 10 },
  editBtn: {
    flex: 1,
    height: 54,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editBtnGhost: { borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.surface },
  editBtnGhostText: { fontSize: 15.5, fontWeight: '800', color: theme.ink },
  editBtnText: { fontSize: 15.5, fontWeight: '800' },
  editField: { flex: 1, gap: 6 },
  editLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, color: theme.faint },
  editInput: {
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    color: theme.ink,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  // An outline, not a filled button: skipping a rest is a shortcut past a
  // wait, and the loudest thing on the screen should not be a shortcut.
  skipRestBtn: {
    height: 56,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  /* finish */

  /* sheets */
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(14,8,30,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 30,
    // Gives way to the frame's cap below rather than overflowing it.
    flexShrink: 1,
  },
  sheetFrame: { maxHeight: '78%' },
  // A long sheet's list (GPSheet `scrollable`): sized to its rows, and given
  // way to the measured bound rather than overflowing the sheet.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetScrollContent: { paddingBottom: 6 },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 16 },
  // The pull zone: out to the sheet's edges and up to its top, so a thumb does
  // not have to find the 40 px grip (#bugs 2026-09-30).
  sheetGrab: { marginTop: -12, marginHorizontal: -22, paddingTop: 12, paddingHorizontal: 22 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  sheetTitleText: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: theme.ink },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceSoft,
  },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  // A superset is one box holding several lifts: the row keeps its shape and
  // gains room for the outline to run without touching the text.
  runRowSuperset: {
    borderBottomWidth: 0,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginVertical: 4,
    borderRadius: 14,
  },
  // Inside the boundary, not on it — the line has to be able to pass behind
  // nothing.
  runSupersetPill: {
    position: 'absolute',
    top: -7,
    left: 14,
    backgroundColor: theme.surface,
    paddingHorizontal: 6,
  },
  runSupersetPillText: {
    fontSize: 9.5,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: theme.purple,
  },
  // Hollow until reached, filled when it is where you are, ticked when done.
  runDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: theme.ink,
  },
  // One lift of a row: its name and plan, and its pencil on the right.
  runMember: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Orange in both themes (device, 2026-09-16): `highlight` is violet in light.
  // A 36 dp square: a thumb target, not an icon to aim at.
  runEditBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: theme.orange,
    backgroundColor: theme.orangeSoft,
  },
  runPlan: {
    marginTop: 2,
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },
  runMeta: {
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.faint,
  },
  howToNumber: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
