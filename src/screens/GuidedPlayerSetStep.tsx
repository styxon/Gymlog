import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import { getExerciseImageSource } from '../assets/exerciseImages';
import {
  GuidedStep,
  GuidedSetTarget,
  resolveGuidedSetPlan,
} from '../lib/guidedPlayer';
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
import {
  minutesToLog,
  MinutesStopwatch,
  msUntilNextMinutesChange,
  SessionMinutesClock,
  startStopwatch,
  pauseStopwatch,
  stopwatchElapsedMs,
  stopwatchForSet,
} from '../lib/minutesExercises';
import { weightStepAccessibilityLabel, exerciseCardAccessibilityLabel } from '../lib/accessibilityLabels';
import { LastTimeView } from '../lib/exerciseSheetHistory';
import { summarizeHistoricalSetChips } from '../lib/guidedSetWeightSummary';
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
import type { TourTargetRegistry } from '../features/tour/tourTargets';
import type { TourTargetId, WorkoutTourStep } from '../lib/firstRunTour';
import { exerciseListLabel, exerciseNameLabel } from '../lib/exerciseNameLabel';
import { asksBeforeZeroWeightLog } from '../lib/zeroWeightLog';
import { removeTrailingZeros } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { warmupOffer } from '../lib/warmupSets';
import { setsOfCurrentLift } from '../lib/liftSegments';
import { useTheme, useThemedStyles } from '../theming';
import { SET_DOT_GAP, SET_DOT_SIZE, makeStyles } from './GuidedPlayerStyles';
import { DialCard } from './GuidedPlayerDial';
import { MinutesClockText } from './GuidedPlayerEditor';
import { GPIcon, StepIn } from './GuidedPlayerMotion';
import { AppLanguage } from '../types/models';
import { isMinutesTrackingMode, isTimedTrackingMode, isUnloadedTrackingMode, WorkoutExerciseInstance } from '../features/workout/workoutTypes';
import { useKeyboardOpen } from '../hooks/useKeyboardOpen';

// A bundled picture carries its own pixel size, and React Native uses it
// as the Image's default width and height, which absoluteFill's edges do not
// override: the picture drew at full size from the corner and was cropped to
// its top-left (#bugs 2026-10-09). A remote uri had no size, so this never
// showed before the pictures were bundled.
const FILL_SIZE = { width: '100%', height: '100%' } as const;

/** The heaviest load in a session's sets, or 0 when there is none to show. */
function heaviestOf(history: LastTimeView | null | undefined): number {
  return history && history.sets.length > 0 ? Math.max(...history.sets.map((set) => set.loadKg)) : 0;
}

export function SetStepView({
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
