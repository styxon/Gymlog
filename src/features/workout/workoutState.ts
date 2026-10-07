import { createId } from '../../lib/ids';
import type { FreestyleDraftSnapshot } from '../../lib/emptyWorkoutSession';
import { convertWeightToKg, formatWeightInputValue, parseNumberInput } from '../../lib/format';
import {
  ActiveCardioSession,
  pauseCardioSession,
  resumeCardioSession,
  startCardioSession,
} from '../../lib/cardio';
import { CardioActivityType, SetupCautionArea } from '../../types/models';
import { cautionAreaLoadedBy } from '../../lib/cautionExerciseFilter';
import { isMinutesTrackingMode, isTimedTrackingMode, isUnloadedTrackingMode } from './workoutTypes';
import { parseIntervalScheme } from '../../lib/intervalScheme';
import { pauseStopwatch, type SessionMinutesClock } from '../../lib/minutesExercises';
import { HOLD_DIAL, MINUTES_DIAL, REPS_DIAL } from '../../lib/weightDial';
import { isLiftableWeight } from '../../lib/weightLimits';
import { isGuidedExerciseOut, resolveGuidedSetTarget } from '../../lib/guidedPlayer';
import { buildSupersetPlayOrder, supersetGroupIndexes } from '../../lib/supersetGrouping';
import { elapsedSecondsOf, restSecondsLeft, restTimerHasEnded, settleSessionClock, workoutSecondsUntil } from '../../lib/sessionClock';
import { GuidedResumeAnchor, WorkoutTrackingMode, WorkoutTemplateExercise, WorkoutExerciseInsertInput, WorkoutExerciseInstance, WorkoutHistoryStore, WorkoutLiftIdentity, WorkoutPersistenceBundle, WorkoutProgressionOptions, WorkoutRestTimerState, WorkoutRuntimeTemplate, WorkoutSessionMaterializeOptions, WorkoutSessionRuntime, WorkoutSessionSummary, WorkoutSetDraftInput, WorkoutSetEffort, WorkoutSetInstance, WorkoutSlotHistoryEntry, WorkoutSlotHistorySet, WorkoutStatus, WorkoutUiState, WorkoutExerciseStatus } from './workoutTypes';
import { getWorkoutTemplateById } from './workoutCatalog';
import {
  resolveMissedRepsTarget,
  resolveProgressedLoadKg,
  resolveProgressedReps,
  resolveRampSetTarget,
} from '../../lib/progressionGate';
import { programmeSetCount, toWorkingHistoryEntry } from '../../lib/warmupSets';
import { prescriptionAfterSwap } from '../../lib/catalogExercisePools';
import { doseAfterSwap } from '../../lib/swapDose';
import {
  liftBeforeSwap,
  liftOfSet,
  setIndexWithinLift,
  splitExerciseByLift,
} from '../../lib/liftSegments';
import {
  entriesForLift,
  findHistoricalSetForIndex,
  findLatestEntryForExerciseName,
  RepWindow,
  selectLatestUsableEntry,
  selectLegacySlotEntry,
} from '../../lib/exerciseHistoryLookup';

export interface WorkoutFeatureState {
  hydrated: boolean;
  isRestoring: boolean;
  history: WorkoutHistoryStore;
  activeSession: WorkoutSessionRuntime | null;
  activeCardio: ActiveCardioSession | null;
  /** A freestyle session in flight; see FreestyleDraftSnapshot. */
  freestyleDraft: FreestyleDraftSnapshot | null;
  completionSummary: WorkoutSessionSummary | null;
}

export type WorkoutAction =
  | { type: 'session/hydrate'; payload: WorkoutPersistenceBundle }
  | { type: 'session/markRestoring'; payload: { value: boolean } }
  | {
      type: 'session/startFromTemplate';
      payload: {
        templateId: string;
        sessionOrderIndex: number;
        unitPreference: 'kg' | 'lb';
        progression?: WorkoutProgressionOptions;
      };
    }
  | {
      type: 'session/startFromRuntimeTemplate';
      payload: {
        template: WorkoutRuntimeTemplate;
        sessionOrderIndex: number;
        unitPreference: 'kg' | 'lb';
        progression?: WorkoutProgressionOptions;
      };
    }
  /**
   * Close the open pause on the session as it stands in the store.
   *
   * It used to carry the session to put back, and the provider sent the one
   * from the render the tap happened in. The player resumes in the same tap
   * that logs, swaps or skips — so the reducer replaced the session with the
   * copy from before that tap: pause, then "Log set", and the screen moved to
   * the rest with the set never logged (live-session audit, 2026-09-20).
   */
  | { type: 'session/resume'; payload: { nowMs: number } }
  | { type: 'session/pause' }
  | { type: 'session/tick'; payload: { nowMs: number } }
  | { type: 'exercise/setActive'; payload: { slotId: string; setIndex?: number } }
  | { type: 'exercise/expand'; payload: { slotId: string } }
  | { type: 'exercise/collapse'; payload: { slotId: string } }
  | { type: 'set/updateDraft'; payload: { slotId: string; setIndex: number; patch: WorkoutSetDraftInput } }
  | { type: 'set/complete'; payload: { slotId: string; setIndex: number; nowMs: number; unitPreference: 'kg' | 'lb' } }
  /**
   * Change a set that is already logged.
   *
   * `set/complete` refuses a completed set on purpose — it is the transition
   * from pending to logged, and running it twice would move the session's
   * pointer a second time. Correcting a number is a different act: nothing
   * about the session's position changes, only what the set says (the rest
   * screen's Edit, 2026-09-04).
   */
  | { type: 'set/editLogged'; payload: { slotId: string; setIndex: number; reps: number; loadKg: number | null } }
  | { type: 'set/recordEffort'; payload: { slotId: string; setIndex: number; effort: WorkoutSetEffort } }
  | { type: 'set/repeatLast'; payload: { slotId: string; setIndex: number; nowMs: number; unitPreference: 'kg' | 'lb' } }
  | { type: 'set/undo'; payload: { slotId: string; setIndex: number } }
  /** The bout's stopwatch started or paused (null: none on the clock). */
  | { type: 'session/setMinutesClock'; payload: { clock: SessionMinutesClock | null } }
  | { type: 'exercise/addSet'; payload: { slotId: string } }
  | { type: 'exercise/removeSet'; payload: { slotId: string } }
  /** A warm-up set, logged apart from the working sets (WorkoutWarmupSet). */
  | { type: 'exercise/logWarmup'; payload: { slotId: string; loadKg: number; reps: number; completedAt: string } }
  /** Takes back the warm-up at `index` of the lift's warm-ups. */
  | { type: 'exercise/removeWarmup'; payload: { slotId: string; index: number } }
  /**
   * A session logged outside the guided player, remembered for next time.
   *
   * The weight a set opens on comes from `slotHistory`, and the only writer
   * was finishWorkout — the guided player's own finish. A lift done in an
   * empty workout therefore left no trace the prefill could see, and opened at
   * nothing the next time ("paino automaattisesti siihen mitä on viimeksi
   * tehnyt", #bugs 2026-08-27), even though the app had the numbers in the
   * database all along. The named lookup already reads across every slot, so
   * this only has to put the entry somewhere.
   */
  | {
      type: 'history/recordLogged';
      payload: {
        performedAt: string;
        sessionId: string;
        templateName: string;
        exercises: Array<{
          exerciseName: string;
          sets: Array<{ setIndex: number; loadKg: number; reps: number; completedAt?: string | null }>;
        }>;
      };
    }
  /**
   * A saved workout the reader deleted, taken out of what the next session
   * reads. Deleting in History removed the session and its logs from the
   * database only; the per-slot history kept it, so a typo of 450 kg deleted
   * from History still opened the next session at 450 kg with "Last time"
   * showing it, and the progression gate stepped up from it.
   */
  | { type: 'history/forgetSession'; payload: { sessionId: string } }
  | { type: 'exercise/skip'; payload: { slotId: string; reason?: string } }
  | {
      type: 'exercise/insertAfter';
      // null when the session has no main-block exercise to insert after — a
      // cooldown-only session's mid-workout add (recheck round 2026-09-29).
      payload: { afterSlotId: string | null; exercise: WorkoutExerciseInsertInput };
    }
  | {
      type: 'exercise/swap';
      payload: {
        slotId: string;
        exerciseName: string;
        substitutionGroup: string;
        // The swapped-in lift's own history seeds the remaining sets, so the
        // reducer has to write the draft in the unit the logger reads back.
        unitPreference: 'kg' | 'lb';
      };
    }
  | { type: 'exercise/updateNotes'; payload: { slotId: string; notes: string } }
  | { type: 'timer/start'; payload: { slotId: string; setIndex: number; durationSeconds: number; nowMs: number } }
  | { type: 'timer/pause'; payload: { nowMs: number } }
  | { type: 'timer/resume'; payload: { nowMs: number } }
  | { type: 'timer/override'; payload: { durationSeconds: number; nowMs: number } }
  | { type: 'timer/clear' }
  /**
   * The player moved to another step. It is the reader doing something, so it
   * moves `updatedAt` like a logged set does: the cool-down is walked with no
   * set logged in it, and a finish read off the last set left it out of the
   * saved duration every time (live-session audit, 2026-09-20).
   */
  | { type: 'session/setGuidedStep'; payload: { stepIndex: number; anchor?: GuidedResumeAnchor; nowMs?: number } }
  | { type: 'cardio/start'; payload: { activityType: CardioActivityType; nowMs: number } }
  | { type: 'cardio/pause'; payload: { nowMs: number } }
  | { type: 'cardio/resume'; payload: { nowMs: number } }
  | { type: 'cardio/clear' }
  /** The run put back as a whole (lib/cardio settleSavedCardioRun), when it is still the same run. */
  | { type: 'cardio/settle'; payload: { session: ActiveCardioSession; wasResumedAt: string | null } }
  | { type: 'freestyle/save'; payload: { snapshot: FreestyleDraftSnapshot } }
  | { type: 'freestyle/clear' }
  | { type: 'session/openFinishSummary' }
  | { type: 'session/finishWorkout'; payload?: { performedAt?: string } }
  | { type: 'session/discardWorkout' }
  /** The running session takes another id: the one its save was filed under, when the write found its own taken. */
  | { type: 'session/adoptSessionId'; payload: { sessionId: string } }
  | { type: 'session/clearCompletedSession' }
  /** "Reset all data": nothing of the training record survives, not even the per-slot history. */
  | { type: 'session/resetAll'; payload: { nowMs: number } };

function createInitialTimer(): WorkoutRestTimerState {
  return {
    status: 'idle',
    exerciseSlotId: null,
    setIndex: null,
    startedAtMs: null,
    endsAtMs: null,
    durationSeconds: 0,
  };
}

function createInitialUi(): WorkoutUiState {
  return {
    activeSlotId: null,
    activeSetIndex: 0,
    focusedField: null,
    noteEditorSlotId: null,
    swapSheetSlotId: null,
    expandedSlotIds: [],
    finishSummaryOpen: false,
  };
}

function cloneSet(set: WorkoutSetInstance): WorkoutSetInstance {
  return { ...set };
}

function cloneExercise(exercise: WorkoutExerciseInstance): WorkoutExerciseInstance {
  return {
    ...exercise,
    sets: exercise.sets.map(cloneSet),
    ...(exercise.warmups ? { warmups: exercise.warmups.map((warmup) => ({ ...warmup })) } : {}),
  };
}

/**
 * The lift a set is logged as, stamped on it when it is logged.
 *
 * At logging time rather than at the swap: a swap can only stamp the sets that
 * are logged when it happens, and a set taken back and logged again after it
 * then carried nothing — which a session from before the stamp also carries,
 * so the two could not be told apart (lib/liftSegments reads an unstamped set
 * below the swap line as the old lift).
 */
function currentLiftOf(exercise: WorkoutExerciseInstance): WorkoutLiftIdentity {
  return { exerciseName: exercise.exerciseName, trackingMode: exercise.trackingMode };
}

function parseInputNumber(value: string | undefined) {
  return parseNumberInput(value ?? '');
}

function buildScopedSlotId(templateId: string, templateSessionId: string, slotId: string) {
  return `${templateId}:${templateSessionId}:${slotId}`;
}

/**
 * This slot's history: its own scoped key, else the unscoped one an older
 * install wrote under.
 *
 * The scoped key is never gated — whatever was done here was done here. The
 * unscoped one is, because before slot ids carried the day every day sharing a
 * slot wrote to it, so it holds a heavy day and a light day under one id. Both
 * readers of "last time" apply the same gate through `selectLegacySlotEntry`;
 * the panel showing that shared history while the dial refused to prefill from
 * it is how these two came to contradict each other in the first place.
 */
function getHistoryEntries(
  history: WorkoutHistoryStore,
  slotId: string,
  templateSlotId: string | undefined,
  legacyRepWindow: RepWindow | null | undefined,
  exerciseName: string,
) {
  // Only the entries that were this lift: a swap writes under the same slot id
  // (see entriesForLift).
  const scopedEntries = entriesForLift(history.slotHistory[slotId], exerciseName);
  // Something real under the scoped key: that is the answer. A key holding
  // only skipped days is not — it says the lift did not happen here.
  if (selectLatestUsableEntry(scopedEntries) || !templateSlotId) {
    return scopedEntries;
  }

  const legacy = selectLegacySlotEntry(history.slotHistory, templateSlotId, legacyRepWindow, exerciseName);
  return legacy ? entriesForLift(history.slotHistory[templateSlotId], exerciseName) : scopedEntries;
}

export function getHistoryEntriesForExercise(
  history: WorkoutHistoryStore,
  exercise:
    | Pick<WorkoutExerciseInstance, 'slotId' | 'templateSlotId' | 'trackingMode' | 'sets' | 'exerciseName'>
    | null
    | undefined,
) {
  if (!exercise) {
    return [];
  }

  return getHistoryEntries(
    history,
    exercise.slotId,
    exercise.templateSlotId,
    resolveInstanceBorrowRepWindow(exercise),
    exercise.exerciseName,
  );
}

/**
 * What a set's prefill resolved to, named rather than inferred.
 *
 * Spelling it out is what keeps `materializeExercise` honest: it builds the
 * set by listing fields by hand, and while this shape was a union inferred
 * from three separate returns, a field that existed on only one branch could
 * be — and was — silently left off that list. `heldForFatigue` was that field,
 * and the recovery badge it drives never once appeared.
 */
interface ResolvedSetDraft {
  draftLoadText: string;
  draftRepsText: string;
  plannedLoadKg: number | undefined;
  autoProgressedFromKg: number | undefined;
  heldForFatigue: boolean | undefined;
  heldForCautionArea: SetupCautionArea | undefined;
  prefilledFromPerformedAt: string | undefined;
  plannedTargetReps: number | undefined;
  autoProgressedFromReps: number | undefined;
  /** A climbing session's own target for this set (lib/progressionGate resolveRampSetTarget). */
  rampTargetReps: number | undefined;
}

/**
 * Nothing on this slot — but the same lift may have been done somewhere else:
 * another program, another day, an empty workout. That weight is recorded, not
 * estimated, so it seeds the prefill instead of opening at zero.
 *
 * What it deliberately does NOT do is feed the progression gate. The gate
 * decides "rep ceiling cleared on every working set" against THIS template's
 * rep range, and those other sessions were performed under a different
 * prescription — a load increase computed from them would be a Pro feature
 * moving weights off sessions it never watched. So: the gate moves weights it
 * has seen, and this lookup only stops you starting from nothing.
 * `autoProgressedFromKg` stays undefined here, which is what keeps the AUTO
 * badge off a weight the gate did not choose.
 *
 * The missed-reps target is the exception, because it never moves the weight:
 * it only asks for reps the borrowed sets have shown at the weight they were
 * borrowed for. The card said "last time 60 kg 6·6·6" and the dial asked for
 * 3 × 8 at the same 60 (#bugs 2026-10-01) — the "last time" and the target
 * have to read the same session.
 */
/**
 * The prescription a borrowed weight has to match, or null when it does not
 * have to match one.
 *
 * Exported so the set screen's "Last time" panel gates its lookup identically
 * — the two must resolve the same entry or the screen contradicts itself.
 */
export function resolveBorrowRepWindow(exercise: {
  trackingMode: WorkoutTrackingMode;
  repsMin: number;
  repsMax: number;
}): RepWindow | null {
  if (isUnloadedTrackingMode(exercise.trackingMode)) {
    return null;
  }
  if (!Number.isFinite(exercise.repsMin) || !Number.isFinite(exercise.repsMax)) {
    return null;
  }
  return { min: exercise.repsMin, max: exercise.repsMax };
}

/**
 * The same window, read off a live session's exercise rather than a template.
 *
 * A running set carries its prescription per set (`plannedRepsMin/Max`), so
 * the first set speaks for the exercise — they are materialized from one
 * template row.
 */
export function resolveInstanceBorrowRepWindow(
  exercise: Pick<WorkoutExerciseInstance, 'trackingMode' | 'sets'>,
): RepWindow | null {
  const first = exercise.sets[0];
  if (!first) {
    return null;
  }
  return resolveBorrowRepWindow({
    trackingMode: exercise.trackingMode,
    repsMin: first.plannedRepsMin,
    repsMax: first.plannedRepsMax,
  });
}

function resolveNamedHistoryDraft(
  history: WorkoutHistoryStore,
  setIndex: number,
  unitPreference: 'kg' | 'lb',
  exercise: WorkoutTemplateExercise,
  options: WorkoutSessionMaterializeOptions,
): ResolvedSetDraft {
  const blank: ResolvedSetDraft = {
    draftLoadText: '',
    draftRepsText: '',
    plannedLoadKg: undefined,
    autoProgressedFromKg: undefined,
    heldForFatigue: undefined,
    heldForCautionArea: undefined,
    prefilledFromPerformedAt: undefined,
    // Nothing borrowed, nothing to lower a target from.
    plannedTargetReps: undefined,
    autoProgressedFromReps: undefined,
    rampTargetReps: undefined,
  };

  const found = findLatestEntryForExerciseName(history.slotHistory, exercise.exerciseName, {
    // 0 kg is a real answer for bodyweight work and a missing one for a loaded
    // lift — the guided player used to hide the weight field, so zeroes exist.
    requireLoaded: !isUnloadedTrackingMode(exercise.trackingMode),
    // And the reps have to be in the same neighbourhood, or the weight is not
    // an answer to what this slot is asking. Only for loaded lifts: there is
    // no load to get wrong on bodyweight work, and refusing the borrow there
    // would hide a real "last time" for nothing.
    repWindow: resolveBorrowRepWindow(exercise),
  });
  // Working sets only, numbered as done: set 1 reads the first working set,
  // not a warm-up logged before it (lib/warmupSets).
  const entry = found ? toWorkingHistoryEntry(found, exercise.sets) : null;
  const matched = findHistoricalSetForIndex(entry, setIndex);
  if (!entry || !matched) {
    return blank;
  }

  // A borrowed session that climbed in weight: each set its own reps, the
  // heaviest one more (user 2026-10-01). Otherwise the missed-reps rule below.
  const rampTarget = resolveRampSetTarget({
    entry,
    setIndex,
    repsMax: exercise.repsMax,
    trackingMode: exercise.trackingMode,
    automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
    nowMs: options.nowMs ?? Date.now(),
    cautionArea: cautionAreaLoadedBy(exercise.exerciseName, options.cautionFlags),
    fatigueSignal: options.fatigueSignal,
  });
  // Reps short of this prescription in the borrowed session: the same weight,
  // a target those sets can meet — the one rule that may read a borrow, since
  // it never moves the load (see above). Pro, like the slot's own path.
  const missedReps = rampTarget !== null ? null : resolveMissedRepsTarget({
    history: [entry],
    repsMin: exercise.repsMin,
    targetSets: exercise.sets,
    trackingMode: exercise.trackingMode,
    automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
    nowMs: options.nowMs ?? Date.now(),
    cautionArea: cautionAreaLoadedBy(exercise.exerciseName, options.cautionFlags),
    fatigueSignal: options.fatigueSignal,
  });

  return {
    draftLoadText: formatWeightInputValue(matched.loadKg, unitPreference),
    draftRepsText: '',
    plannedLoadKg: matched.loadKg,
    autoProgressedFromKg: undefined,
    // The gate never looked at this weight, so it has no hold to report on it.
    heldForFatigue: undefined,
    heldForCautionArea: undefined,
    // Where it came from, so the logger can say so rather than presenting a
    // weight from another program as if it belonged to this slot.
    prefilledFromPerformedAt: entry.performedAt,
    plannedTargetReps: missedReps?.targetReps,
    autoProgressedFromReps: undefined,
    rampTargetReps: rampTarget ?? undefined,
  };
}

function resolveHistoricalSetDraft(
  history: WorkoutHistoryStore,
  slotId: string,
  templateSlotId: string,
  setIndex: number,
  unitPreference: 'kg' | 'lb',
  exercise: WorkoutTemplateExercise,
  options: WorkoutSessionMaterializeOptions,
): ResolvedSetDraft {
  // Working sets only, numbered as done (lib/warmupSets): a warm-up logged as
  // an ordinary set neither seeds set 1 nor climbs with the work.
  const entries = getHistoryEntries(history, slotId, templateSlotId, resolveBorrowRepWindow(exercise), exercise.exerciseName)
    .map((entry) => toWorkingHistoryEntry(entry, exercise.sets));
  // The newest session that actually logged something, through the same
  // selector the "Last time" panel uses — reading `entries[0]` here and
  // sorting there is how the two came to disagree.
  const latest = selectLatestUsableEntry(entries);
  const matched = findHistoricalSetForIndex(latest, setIndex);

  if (!matched) {
    // This slot has been trained before, this set index just was not reached
    // (a template that added a set). Unchanged: the slot is the better source
    // and it has nothing for this index.
    if (latest) {
      return {
        draftLoadText: '',
        draftRepsText: '',
        plannedLoadKg: undefined,
        autoProgressedFromKg: undefined,
        heldForFatigue: undefined,
        heldForCautionArea: undefined,
        prefilledFromPerformedAt: undefined,
        plannedTargetReps: undefined,
        autoProgressedFromReps: undefined,
        rampTargetReps: undefined,
      };
    }
    return resolveNamedHistoryDraft(history, setIndex, unitPreference, exercise, options);
  }

  // Automated progression (ADR-004): when the last session cleared the rep
  // ceiling on every working set, the prefill moves up by the level's
  // increment. Every other outcome repeats last time's load, which is what
  // this function did unconditionally before the gate existed.
  // A lift that loads an area the reader flagged keeps its dose: onboarding
  // says the app never adds weight or reps there.
  const cautionArea = cautionAreaLoadedBy(exercise.exerciseName, options.cautionFlags);
  const { loadKg, fromLoadKg, heldForFatigue, heldForCautionArea } = resolveProgressedLoadKg({
    history: entries,
    repsMin: exercise.repsMin,
    repsMax: exercise.repsMax,
    targetSets: exercise.sets,
    level: options.setupLevel,
    trackingMode: exercise.trackingMode,
    automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
    // Recovery, read once at session start. The gate has had these holds
    // since it was written; until now nothing passed a signal in, so they
    // never fired on a single set.
    fatigueSignal: options.fatigueSignal,
    fallbackLoadKg: matched.loadKg,
    fallbackReps: matched.reps,
    // The early jump reads a single session, and only a recent one counts.
    nowMs: options.nowMs ?? Date.now(),
    cautionArea,
  });

  // Bodyweight progresses by reps where the load gate stays silent — same
  // options, same history, and the same Pro gate riding in on
  // automatedProgressionEnabled.
  const repsResolution = resolveProgressedReps({
    history: entries,
    templateTargetReps: exercise.repsMax,
    targetSets: exercise.sets,
    level: options.setupLevel,
    trackingMode: exercise.trackingMode,
    automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
    fatigueSignal: options.fatigueSignal,
    cautionArea,
  });

  // Reps short of the programme last time: the same weight, a target the
  // reader can meet (2026-09-09). Scoped history only — `entries` — never the
  // name-borrowed draft below, which does not feed the gate either.
  // A session that climbed in weight reads set by set instead (2026-10-01):
  // averaged, 40×10, 50×8, 60×5 set every target off the warm-ups.
  const rampTarget = repsResolution.progressed
    ? null
    : resolveRampSetTarget({
        entry: latest,
        setIndex,
        repsMax: exercise.repsMax,
        trackingMode: exercise.trackingMode,
        automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
        nowMs: options.nowMs ?? Date.now(),
        cautionArea,
        fatigueSignal: options.fatigueSignal,
      });
  const missedReps = repsResolution.progressed || rampTarget !== null
    ? null
    : resolveMissedRepsTarget({
        history: entries,
        repsMin: exercise.repsMin,
        targetSets: exercise.sets,
        trackingMode: exercise.trackingMode,
        automatedProgressionEnabled: options.automatedProgressionEnabled ?? false,
        nowMs: options.nowMs ?? Date.now(),
        cautionArea,
        fatigueSignal: options.fatigueSignal,
      });

  // Prefill the weight so the user usually just adjusts it with the console
  // and types reps; reps stay empty so entering them is the signal that logs
  // the set (handoff §5).
  return {
    draftLoadText: formatWeightInputValue(loadKg, unitPreference),
    draftRepsText: '',
    plannedLoadKg: loadKg,
    autoProgressedFromKg: fromLoadKg ?? undefined,
    heldForFatigue: (heldForFatigue || repsResolution.heldForFatigue) || undefined,
    heldForCautionArea: (heldForCautionArea ?? repsResolution.heldForCautionArea) ?? undefined,
    // This slot's own history — the ordinary case, nothing to explain.
    prefilledFromPerformedAt: undefined,
    plannedTargetReps: repsResolution.progressed
      ? repsResolution.targetReps
      : missedReps
        ? missedReps.targetReps
        : undefined,
    autoProgressedFromReps: repsResolution.fromReps ?? undefined,
    rampTargetReps: rampTarget ?? undefined,
  };
}

function materializeExercise(
  templateId: string,
  templateSessionId: string,
  exercise: WorkoutTemplateExercise,
  options: WorkoutSessionMaterializeOptions,
  orderIndex: number,
): WorkoutExerciseInstance {
  const scopedSlotId = buildScopedSlotId(templateId, templateSessionId, exercise.slotId);
  const sets: WorkoutSetInstance[] = Array.from({ length: exercise.sets }, (_, setIndex) => {
    const resolved = resolveHistoricalSetDraft(
      options.history,
      scopedSlotId,
      exercise.slotId,
      setIndex,
      options.unitPreference,
      exercise,
      options,
    );

    return {
      setIndex,
      plannedLoadKg: resolved.plannedLoadKg,
      plannedRepsMin: exercise.repsMin,
      plannedRepsMax: exercise.repsMax,
      draftLoadText: resolved.draftLoadText,
      draftRepsText: resolved.draftRepsText,
      autoProgressedFromKg: resolved.autoProgressedFromKg,
      // These two were computed, carried all the way here by
      // resolveHistoricalSetDraft, and then dropped: this object lists its
      // fields by hand, and neither was ever on the list. So the gate held
      // loads for recovery and the badge never once appeared — a Pro
      // behaviour the paywall sells by name, invisible since it was wired.
      heldForFatigue: resolved.heldForFatigue,
      heldForCautionArea: resolved.heldForCautionArea,
      prefilledFromPerformedAt: resolved.prefilledFromPerformedAt,
      plannedTargetReps: resolved.plannedTargetReps,
      autoProgressedFromReps: resolved.autoProgressedFromReps,
      rampTargetReps: resolved.rampTargetReps,
      status: 'pending',
      edited: false,
    };
  });

  return {
    templateExerciseId: exercise.id,
    persistedExerciseTemplateId: exercise.persistedExerciseTemplateId ?? null,
    slotId: scopedSlotId,
    templateSlotId: exercise.slotId,
    exerciseName: exercise.exerciseName,
    role: exercise.role,
    progressionPriority: exercise.progressionPriority,
    trackingMode: exercise.trackingMode,
    restSecondsMin: exercise.restSecondsMin,
    restSecondsMax: exercise.restSecondsMax,
    substitutionGroup: exercise.substitutionGroup,
    supersetGroup: exercise.supersetGroup ?? null,
    // A swap made on Home before the start, on record the same way as one
    // made in the player — otherwise the save could not tell the lift that
    // was done from the one the programme wrote here.
    ...(exercise.sourceExerciseName ? { sourceExerciseName: exercise.sourceExerciseName } : {}),
    orderIndex,
    sets,
    status: 'pending',
    isExpanded: orderIndex === 0,
  };
}

function materializeInsertedExercise(
  input: WorkoutExerciseInsertInput,
  orderIndex: number,
): WorkoutExerciseInstance {
  const insertedSlotId = createId('workout_slot');

  return {
    templateExerciseId: createId('workout_exercise'),
    persistedExerciseTemplateId: null,
    slotId: insertedSlotId,
    templateSlotId: insertedSlotId,
    exerciseName: input.exerciseName,
    role: input.role ?? 'secondary',
    progressionPriority: input.progressionPriority ?? 'medium',
    trackingMode: input.trackingMode,
    restSecondsMin: input.restSecondsMin,
    restSecondsMax: input.restSecondsMax,
    substitutionGroup: input.substitutionGroup,
    orderIndex,
    sets: Array.from({ length: input.sets }, (_, setIndex) => ({
      setIndex,
      plannedRepsMin: input.repsMin,
      plannedRepsMax: input.repsMax,
      draftLoadText: '',
      draftRepsText: '',
      status: 'pending',
      edited: false,
    })),
    status: 'pending',
    libraryItemId: input.libraryItemId ?? null,
    sessionInserted: true,
    isExpanded: false,
  };
}

function materializeWorkoutSessionFromTemplate(
  template: WorkoutRuntimeTemplate,
  options: WorkoutSessionMaterializeOptions,
): WorkoutSessionRuntime {
  const orderedSessions = template.sessions.slice().sort((left, right) => left.orderIndex - right.orderIndex);
  const exercises = template.sessions
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .flatMap((templateSession) =>
      templateSession.exercises.map((exercise) => ({ exercise, templateSessionId: templateSession.id })),
    )
    .map(({ exercise, templateSessionId }, orderIndex) =>
      materializeExercise(template.id, templateSessionId, exercise, options, orderIndex),
    );

  const startedAt = new Date().toISOString();
  return {
    sessionId: createId('workout_session'),
    templateId: template.id,
    templateSessionId: orderedSessions.length === 1 ? orderedSessions[0]?.id ?? null : null,
    templateName: template.name,
    status: 'active',
    startedAt,
    updatedAt: startedAt,
    elapsedSeconds: 0,
    pausedMs: 0,
    pausedAt: null,
    activePlanMode: template.defaultScheduleMode,
    exercises,
    restTimer: createInitialTimer(),
    ui: {
      ...createInitialUi(),
      activeSlotId: exercises[0]?.slotId ?? null,
    },
    sessionOrderIndex: options.sessionOrderIndex,
  };
}

/** One lift's opening targets for its next session, set by set. */
export interface NextSessionLiftTargets {
  exerciseName: string;
  trackingMode: WorkoutTrackingMode;
  sets: { loadKg: number | null; reps: number }[];
}

/**
 * What the set screen will open on, the next time this session is started.
 *
 * The same materialisation a real start runs — history, progression gate,
 * recovery hold — read through the set screen's own target resolver, with
 * nothing logged yet. The coach's "Kehitysesimerkki" quotes these numbers
 * rather than working out its own: if it said "7/7/7" and the dial opened on
 * 12, the reader would have two coaches (user, 2026-09-27). Nothing is kept;
 * the session built here is thrown away.
 */
export function previewNextSession(
  template: WorkoutRuntimeTemplate,
  options: WorkoutSessionMaterializeOptions,
): NextSessionLiftTargets[] {
  return materializeWorkoutSessionFromTemplate(template, options).exercises.map((exercise) => ({
    exerciseName: exercise.exerciseName,
    trackingMode: exercise.trackingMode,
    sets: exercise.sets.map((_, setIndex) => {
      const target = resolveGuidedSetTarget(exercise.sets, setIndex, exercise.trackingMode);
      return { loadKg: target?.loadKg ?? null, reps: target?.reps ?? exercise.sets[setIndex].plannedRepsMax };
    }),
  }));
}

export function materializeWorkoutSession(
  templateId: string,
  options: WorkoutSessionMaterializeOptions,
): WorkoutSessionRuntime {
  const template = getWorkoutTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown workout template: ${templateId}`);
  }

  return materializeWorkoutSessionFromTemplate(template, options);
}

function findExerciseIndex(session: WorkoutSessionRuntime, slotId: string) {
  return session.exercises.findIndex((exercise) => exercise.slotId === slotId);
}

function findFirstPendingSetIndex(exercise: WorkoutExerciseInstance) {
  return exercise.sets.findIndex((set) => set.status === 'pending');
}

function findNextIncompleteIndex(session: WorkoutSessionRuntime, startIndex: number) {
  for (let index = startIndex; index < session.exercises.length; index += 1) {
    const exercise = session.exercises[index];
    if (exercise.status !== 'completed' && exercise.status !== 'skipped' && findFirstPendingSetIndex(exercise) >= 0) {
      return index;
    }
  }

  for (let index = 0; index < startIndex; index += 1) {
    const exercise = session.exercises[index];
    if (exercise.status !== 'completed' && exercise.status !== 'skipped' && findFirstPendingSetIndex(exercise) >= 0) {
      return index;
    }
  }

  return -1;
}

function updateActiveExercise(session: WorkoutSessionRuntime, nextIndex: number, preferredSetIndex?: number) {
  if (nextIndex < 0) {
    session.ui.activeSlotId = null;
    session.ui.activeSetIndex = 0;
    return;
  }

  const nextExercise = session.exercises[nextIndex];
  const resolvedSetIndex =
    typeof preferredSetIndex === 'number' && nextExercise?.sets[preferredSetIndex]?.status === 'pending'
      ? preferredSetIndex
      : Math.max(0, findFirstPendingSetIndex(nextExercise));

  session.ui.activeSlotId = nextExercise?.slotId ?? null;
  session.ui.activeSetIndex = resolvedSetIndex;
  session.exercises = session.exercises.map((exercise, index) => ({
    ...exercise,
    isExpanded: index === nextIndex ? true : exercise.isExpanded,
  }));
}

/**
 * The session as one ordered list of sets — every lift's sets in turn, except
 * inside a superset, where the lifts interleave a round at a time.
 *
 * The order lives in src/lib/supersetGrouping.ts because the guided player
 * builds its steps from the same function. Two answers to "what comes next"
 * is exactly how the app would end up with two different ideas of what a
 * superset is.
 */
/**
 * The exercises that move together when one of them does: the superset this
 * one belongs to, or just itself.
 */
function blockIndexes(session: WorkoutSessionRuntime, exerciseIndex: number) {
  return supersetGroupIndexes(
    session.exercises.map((exercise) => ({
      // A lift the reader walked away from is out of the block, the same way
      // it is out of the plan. Through `isGuidedExerciseOut` rather than a
      // `status === 'skipped'` test of its own: a lift with one logged set and
      // the rest skipped derives to *completed*, so the narrow test let it
      // stay in the block — and adding a round then gave it a PENDING set,
      // reviving the lift the reader had just skipped (PR #93 review).
      supersetGroup: isGuidedExerciseOut(exercise) ? null : exercise.supersetGroup ?? null,
    })),
    exerciseIndex,
  );
}

function sessionPlayOrder(session: WorkoutSessionRuntime) {
  return buildSupersetPlayOrder(
    session.exercises.map((exercise) => ({
      supersetGroup: exercise.supersetGroup ?? null,
      setCount: exercise.sets.length,
    })),
  );
}

function findNextPendingTarget(session: WorkoutSessionRuntime, exerciseIndex: number, setIndex: number) {
  const order = sessionPlayOrder(session);
  const at = order.findIndex((slot) => slot.exerciseIndex === exerciseIndex && slot.setIndex === setIndex);
  const isPending = (slot: { exerciseIndex: number; setIndex: number }) =>
    session.exercises[slot.exerciseIndex]?.sets[slot.setIndex]?.status === 'pending';

  // Forward from here, then round to the start: a set skipped earlier and come
  // back to is still the next thing to do once the tail is done. Both halves
  // were here before supersets; only the order they walk has changed.
  for (let cursor = at + 1; cursor < order.length; cursor += 1) {
    if (isPending(order[cursor])) {
      return order[cursor];
    }
  }

  for (let cursor = 0; cursor <= at && cursor < order.length; cursor += 1) {
    if (isPending(order[cursor])) {
      return order[cursor];
    }
  }

  return null;
}

/**
 * Whether a rest belongs between the set just logged and the one coming.
 *
 * Inside a superset it does not: A1 runs straight into A2, and that is the
 * whole of what pairing them means. The round is what separates rests, so the
 * two sets have to belong to the same one — after the last lift of round one
 * comes round two, and that gap IS a rest.
 */
function restBelongsAfter(
  session: WorkoutSessionRuntime,
  exerciseIndex: number,
  setIndex: number,
  next: { exerciseIndex: number; setIndex: number },
) {
  const done = session.exercises[exerciseIndex];
  const upcoming = session.exercises[next.exerciseIndex];
  const group = done?.supersetGroup ?? null;
  if (!group || upcoming?.supersetGroup !== group) {
    return true;
  }
  return next.setIndex !== setIndex;
}

/**
 * The most a set can count: the reps dial's top, or the hold dial's seconds —
 * for a hold, and for an interval bout, whose number is its work seconds —
 * and never less than the set's own prescription. "Rowing Machine (500m
 * intervals)" prescribes 500, and a ceiling under it refused every set of that
 * exercise as the player logged it (PR #121 review).
 */
export function repsCeilingFor(
  exercise: Pick<WorkoutExerciseInstance, 'trackingMode' | 'exerciseName'>,
  set?: Pick<WorkoutSetInstance, 'plannedRepsMax'> | null,
) {
  const dial =
    isTimedTrackingMode(exercise.trackingMode) || parseIntervalScheme(exercise.exerciseName) !== null
      ? HOLD_DIAL.max
      : isMinutesTrackingMode(exercise.trackingMode)
        ? MINUTES_DIAL.max
        : REPS_DIAL.max;
  const planned = set?.plannedRepsMax;
  return typeof planned === 'number' && Number.isFinite(planned) ? Math.max(dial, planned) : dial;
}

/**
 * How long that rest runs. A superset rests as long as the most demanding lift
 * in it asks for — a squat paired with a curl is still a squat — which is the
 * same rule the guided player's step list uses.
 */
function restSecondsFor(session: WorkoutSessionRuntime, exerciseIndex: number) {
  const exercise = session.exercises[exerciseIndex];
  // Through `blockIndexes`, so the lifts this rest is the longest OF are the
  // same ones the block is made of. Matching on the raw group id instead let
  // a skipped squat keep setting the rest for the curl still being trained,
  // and the player — which filters the skipped lift out before it builds its
  // steps — then disagreed with the reducer about the same session.
  return blockIndexes(session, exerciseIndex).reduce(
    (longest, index) => Math.max(longest, session.exercises[index].restSecondsMin),
    exercise.restSecondsMin,
  );
}

function updateSessionTimestamp(session: WorkoutSessionRuntime, nowIso = new Date().toISOString()) {
  session.updatedAt = nowIso;
  return session;
}

/**
 * Closes any open pause and puts the session back to running.
 *
 * Called on resume and on finish, so a workout paused and then ended does not
 * carry an open pause window that nothing ever closes.
 */
function closePause(session: WorkoutSessionRuntime, nowMs: number): WorkoutSessionRuntime {
  if (!session.pausedAt) {
    return session.status === 'paused' ? { ...session, status: 'active' } : session;
  }
  const held = Math.max(0, nowMs - new Date(session.pausedAt).getTime());
  return {
    ...session,
    status: 'active',
    pausedMs: (session.pausedMs ?? 0) + held,
    pausedAt: null,
    // Back from a pause is the reader here again. Left where the pause began,
    // the first thing done after a pause longer than SESSION_IDLE_MS read the
    // whole pause as time away (settleSessionClock) and took it off again.
    updatedAt: new Date(Math.max(nowMs, Date.parse(session.updatedAt) || 0)).toISOString(),
  };
}

// The session clock lives in src/lib/sessionClock.ts; re-exported for the
// screens and suites that have always imported it from here.
export { elapsedSecondsOf, workoutSecondsUntil };

function buildSummary(session: WorkoutSessionRuntime): WorkoutSessionSummary {
  const completedSets = session.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === 'completed');
  const performedAt = session.completedAt ?? new Date().toISOString();
  return {
    sessionId: session.sessionId,
    templateId: session.templateId,
    templateSessionId: session.templateSessionId,
    templateName: session.templateName,
    performedAt,
    // Less the pauses, so the number written to history is the same one the
    // player showed while the workout was running.
    durationMinutes: Math.max(1, Math.round(workoutSecondsUntil(session, new Date(performedAt).getTime()) / 60) || 1),
    setsCompleted: completedSets.length,
    exercisesCompleted: session.exercises.filter((exercise) => exercise.status === 'completed').length,
    exercisesSkipped: session.exercises.filter((exercise) => exercise.status === 'skipped').length,
    exercisesSwapped: session.exercises.filter((exercise) => exercise.status === 'swapped').length,
    totalVolumeKg: completedSets.reduce((sum, set) => sum + (set.actualLoadKg ?? 0) * (set.actualReps ?? 0), 0),
  };
}

/**
 * The exercise's status, derived from its sets.
 *
 * `skipped` means nothing was done — every set skipped. An exercise with one
 * logged set and the rest skipped is *done*, not skipped: the set happened,
 * and downstream `skipped` is what drops a log from volume, set counts and
 * records. That distinction used to be lost on "skip this exercise", which
 * hard-set `skipped` regardless of what had been logged, so a set the
 * completion screen celebrated as a record was gone from every stat ten
 * seconds later.
 */
function finalizeExerciseStatus(exercise: WorkoutExerciseInstance): WorkoutExerciseStatus {
  if (exercise.sets.every((set) => set.status === 'skipped')) {
    return 'skipped';
  }

  const hasPendingSet = exercise.sets.some((set) => set.status === 'pending');
  if (!hasPendingSet) {
    // Every set is settled and at least one was completed.
    return exercise.status === 'swapped' ? 'swapped' : 'completed';
  }

  if (exercise.status === 'swapped') {
    return 'swapped';
  }

  return 'active';
}

function advanceAfterMutation(session: WorkoutSessionRuntime, currentIndex: number) {
  const nextIndex = findNextIncompleteIndex(session, currentIndex + 1);
  updateActiveExercise(session, nextIndex >= 0 ? nextIndex : currentIndex);
}

function resolveDraftLoadKg(set: WorkoutSetInstance, unitPreference: 'kg' | 'lb') {
  const parsedLoad = parseInputNumber(set.draftLoadText);
  if (parsedLoad !== null) {
    return convertWeightToKg(parsedLoad, unitPreference);
  }

  return set.plannedLoadKg;
}

function resolveDraftReps(set: WorkoutSetInstance) {
  return parseInputNumber(set.draftRepsText);
}

/**
 * Whether `set/complete` would keep this set as its draft stands — the one
 * rule, so a caller can ask before it tells the reader the set is logged.
 *
 * The player used to dispatch the completion and play its "done" cue and move
 * on regardless; when the store refused the set (a bar tap had pushed the
 * total past the dial's ceiling) the set was gone and the screen had said it
 * was kept (break round 2026-09-28).
 */
export function canCompleteSet(
  exercise: Pick<WorkoutExerciseInstance, 'trackingMode' | 'exerciseName'>,
  set: WorkoutSetInstance,
  unitPreference: 'kg' | 'lb',
): boolean {
  const reps = resolveDraftReps(set);
  if (!reps || reps <= 0 || reps > repsCeilingFor(exercise, set)) {
    return false;
  }
  const loadKg = resolveDraftLoadKg(set, unitPreference);
  // An interval work bout is logged by the player with no load: a treadmill
  // speed is not a weight. Its catalog rows are `reps_first`, so the load
  // rule refused every bout — eight sprints ran, and none of them was kept.
  const unloaded = isUnloadedTrackingMode(exercise.trackingMode) || parseIntervalScheme(exercise.exerciseName) !== null;
  if (!unloaded && (loadKg === null || loadKg === undefined)) {
    return false;
  }
  // Nothing above the dial's ceiling is a set anybody lifted, and the
  // loader drops it on the next launch anyway.
  if (typeof loadKg === 'number' && !isLiftableWeight(loadKg)) {
    return false;
  }
  return true;
}

export const workoutInitialState: WorkoutFeatureState = {
  hydrated: false,
  isRestoring: true,
  history: { sessions: [], slotHistory: {}, lastSelectedTemplateId: null },
  activeSession: null,
  activeCardio: null,
  freestyleDraft: null,
  completionSummary: null,
};

/**
 * Every action, and then the session clock settled against what it did.
 *
 * The clock's rules — it starts at the first step, and a long stretch with
 * nothing done in it does not count — live in src/lib/sessionClock.ts, and
 * they are applied here once rather than in each case that touches the
 * session, so a new action cannot forget them.
 */
export function workoutReducer(state: WorkoutFeatureState, action: WorkoutAction): WorkoutFeatureState {
  const next = reduceWorkoutAction(state, action);
  if (next === state || next.activeSession === state.activeSession) {
    return next;
  }
  const settled = settleSessionClock(state.activeSession, next.activeSession);
  return settled === next.activeSession ? next : { ...next, activeSession: settled };
}

/**
 * The actions that change what a session says it did. A session that has been
 * finished (and saved) is closed: it stays the activeSession only until the
 * summary clears it, and a set logged into it afterwards was never in what was
 * saved, while the history said it was.
 */
const CLOSED_SESSION_REFUSES = new Set<WorkoutAction['type']>([
  'session/pause',
  'set/updateDraft',
  'set/complete',
  'set/editLogged',
  'set/repeatLast',
  'set/undo',
  'exercise/addSet',
  'exercise/removeSet',
  'exercise/logWarmup',
  'exercise/removeWarmup',
  'exercise/skip',
  'exercise/insertAfter',
  'exercise/swap',
  'timer/start',
]);

function reduceWorkoutAction(state: WorkoutFeatureState, action: WorkoutAction): WorkoutFeatureState {
  if (state.activeSession?.status === 'completed' && CLOSED_SESSION_REFUSES.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'session/hydrate':
      return {
        hydrated: true,
        isRestoring: false,
        history: action.payload.history,
        activeSession: action.payload.activeSession,
        activeCardio: action.payload.activeCardio ?? null,
        freestyleDraft: action.payload.freestyleDraft ?? null,
        completionSummary: null,
      };

    case 'session/markRestoring':
      return { ...state, isRestoring: action.payload.value };

    case 'session/startFromTemplate': {
      const session = materializeWorkoutSession(action.payload.templateId, {
        history: state.history,
        unitPreference: action.payload.unitPreference,
        sessionOrderIndex: action.payload.sessionOrderIndex,
        automatedProgressionEnabled: action.payload.progression?.automatedProgressionEnabled ?? false,
        fatigueSignal: action.payload.progression?.fatigueSignal,
        setupLevel: action.payload.progression?.setupLevel ?? null,
        nowMs: action.payload.progression?.nowMs,
        cautionFlags: action.payload.progression?.cautionFlags,
      });

      return {
        ...state,
        activeSession: session,
        completionSummary: null,
        history: {
          ...state.history,
          lastSelectedTemplateId: action.payload.templateId,
        },
      };
    }

    case 'session/startFromRuntimeTemplate': {
      const session = materializeWorkoutSessionFromTemplate(action.payload.template, {
        history: state.history,
        unitPreference: action.payload.unitPreference,
        sessionOrderIndex: action.payload.sessionOrderIndex,
        automatedProgressionEnabled: action.payload.progression?.automatedProgressionEnabled ?? false,
        fatigueSignal: action.payload.progression?.fatigueSignal,
        setupLevel: action.payload.progression?.setupLevel ?? null,
        nowMs: action.payload.progression?.nowMs,
        cautionFlags: action.payload.progression?.cautionFlags,
      });

      return {
        ...state,
        activeSession: session,
        completionSummary: null,
        history: {
          ...state.history,
          lastSelectedTemplateId: action.payload.template.id,
        },
      };
    }

    case 'session/resume': {
      if (!state.activeSession) {
        return state;
      }
      // Status and the open pause window are closed here, not left to the
      // caller: resume used to hand the session straight back with
      // `status: 'paused'` still on it, so the tick stayed asleep and the
      // clock never restarted.
      const resumed = closePause(state.activeSession, action.payload.nowMs);
      // Nothing paused, nothing to do. The player asks on every way out of
      // its pause, and a new state object for nothing re-renders the app and
      // rewrites the workout bundle.
      if (resumed === state.activeSession && state.completionSummary === null) {
        return state;
      }
      return {
        ...state,
        activeSession: resumed,
        completionSummary: null,
      };
    }

    case 'session/pause': {
      if (!state.activeSession || state.activeSession.pausedAt) {
        return state;
      }
      const pausedAt = new Date().toISOString();
      // A bout on the clock stops with the workout, whether or not its set is
      // the screen in front: a clock left running through the pause logged
      // the break as minutes ridden.
      const clock = state.activeSession.minutesClock;
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          status: 'paused',
          pausedAt,
          updatedAt: pausedAt,
          ...(clock && clock.runningSinceMs !== null
            ? { minutesClock: { ...clock, ...pauseStopwatch(clock, Date.parse(pausedAt)) } }
            : {}),
        },
      };
    }

    /**
     * The rest ran out: put the timer away. Nothing else.
     *
     * This ran every second while a rest was on, and every run returned a new
     * state object — a new `nowMs`, a new `updatedAt` — so every consumer of
     * the provider re-rendered once a second, and the persistence effect wrote
     * the whole workout bundle, history included, once a second (2026-09-16).
     * No screen reads a countdown from here; the player and the free workout
     * keep their own clocks. So the provider dispatches this once, when the
     * rest ends, and a tick that has nothing to do returns the same state.
     */
    case 'session/tick': {
      const session = state.activeSession;
      if (!session || session.status !== 'active' || !restTimerHasEnded(session.restTimer, action.payload.nowMs)) {
        return state;
      }
      const endedAtMs = session.restTimer.endsAtMs ?? action.payload.nowMs;
      return {
        ...state,
        activeSession: {
          ...session,
          elapsedSeconds: elapsedSecondsOf(session, action.payload.nowMs),
          restTimer: createInitialTimer(),
          // In use until the rest ended, not until whenever this ran — a
          // phone that slept through the end dispatches it on waking.
          updatedAt: new Date(Math.max(Date.parse(session.updatedAt) || 0, endedAtMs)).toISOString(),
        },
      };
    }

    case 'exercise/setActive':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          ui: {
            ...state.activeSession.ui,
            activeSlotId: action.payload.slotId,
            activeSetIndex: (() => {
              const exercise = state.activeSession?.exercises.find((item) => item.slotId === action.payload.slotId);
              if (!exercise) {
                return 0;
              }

              const requestedSet = typeof action.payload.setIndex === 'number' ? exercise.sets[action.payload.setIndex] : null;
              if (requestedSet?.status === 'pending') {
                return action.payload.setIndex ?? 0;
              }

              return Math.max(0, findFirstPendingSetIndex(exercise));
            })(),
          },
          exercises: state.activeSession.exercises.map((exercise) =>
            exercise.slotId === action.payload.slotId ? { ...exercise, isExpanded: true } : exercise,
          ),
          updatedAt: new Date().toISOString(),
        },
      };

    case 'exercise/expand':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          ui: {
            ...state.activeSession.ui,
            expandedSlotIds: Array.from(new Set([...state.activeSession.ui.expandedSlotIds, action.payload.slotId])),
          },
        },
      };

    case 'exercise/collapse':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          ui: {
            ...state.activeSession.ui,
            expandedSlotIds: state.activeSession.ui.expandedSlotIds.filter((slotId) => slotId !== action.payload.slotId),
          },
        },
      };

    case 'set/updateDraft':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          exercises: state.activeSession.exercises.map((exercise) => {
            if (exercise.slotId !== action.payload.slotId) {
              return exercise;
            }
            return {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.setIndex === action.payload.setIndex
                  ? {
                      ...set,
                      draftLoadText: action.payload.patch.loadText ?? set.draftLoadText,
                      draftRepsText: action.payload.patch.repsText ?? set.draftRepsText,
                      edited: true,
                    }
                  : set,
              ),
            };
          }),
          updatedAt: new Date().toISOString(),
        },
      };

    case 'set/complete': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      const exercise = session.exercises[exerciseIndex];
      const set = exercise.sets.find((item) => item.setIndex === action.payload.setIndex);
      if (!set || set.status === 'completed') {
        return state;
      }

      const actualReps = resolveDraftReps(set);
      if (actualReps === null || !canCompleteSet(exercise, set, action.payload.unitPreference)) {
        return state;
      }
      const actualLoadKg = resolveDraftLoadKg(set, action.payload.unitPreference);

      set.status = 'completed';
      set.actualReps = actualReps;
      set.actualLoadKg = actualLoadKg ?? 0;
      set.effort = set.effort ?? null;
      set.completedAt = new Date(action.payload.nowMs).toISOString();
      set.edited = true;
      set.loggedAs = currentLiftOf(exercise);
      // The bout is logged: its clock has nothing more to keep.
      if (
        session.minutesClock &&
        session.minutesClock.slotId === action.payload.slotId &&
        session.minutesClock.setIndex === action.payload.setIndex
      ) {
        session.minutesClock = null;
      }
      // The pause time run so far, so a workout that ends at this set takes
      // off only these (workoutSecondsUntil).
      session.pausedMsAtLastSet =
        (session.pausedMs ?? 0) +
        (session.pausedAt ? Math.max(0, action.payload.nowMs - new Date(session.pausedAt).getTime()) : 0);

      exercise.status = finalizeExerciseStatus(exercise);
      const nextTarget = findNextPendingTarget(session, exerciseIndex, action.payload.setIndex);
      if (nextTarget) {
        updateActiveExercise(session, nextTarget.exerciseIndex, nextTarget.setIndex);
        // The weight just lifted reaches the next set through
        // `resolveGuidedSetTarget`, which reads this completed set directly.
        // Nothing is written into the next set's draft here: a draft written
        // here was a second author of that decision, and the two disagreed
        // (it only fired into an empty draft, and materialisation leaves none).
      } else {
        session.ui.activeSlotId = exercise.slotId;
        session.ui.activeSetIndex = action.payload.setIndex;
      }
      // Rest is the gap before the next set. `nextTarget` is null only when
      // nothing anywhere in the session is still pending, and starting a timer
      // there counts down to a set that does not exist — while the floating bar
      // sits over the finish button. Inside a superset there is no gap at all,
      // which is the one thing pairing two lifts means.
      const restSeconds = restSecondsFor(session, exerciseIndex);
      session.restTimer =
        nextTarget && restBelongsAfter(session, exerciseIndex, action.payload.setIndex, nextTarget)
          ? {
              status: 'running',
              exerciseSlotId: exercise.slotId,
              setIndex: action.payload.setIndex,
              startedAtMs: action.payload.nowMs,
              endsAtMs: action.payload.nowMs + restSeconds * 1000,
              durationSeconds: restSeconds,
            }
          : createInitialTimer();
      session.ui.focusedField = null;
      session.updatedAt = new Date(action.payload.nowMs).toISOString();

      return { ...state, activeSession: session };
    }

    case 'set/editLogged': {
      if (!state.activeSession) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }
      const exercise = session.exercises[exerciseIndex];
      const set = exercise.sets.find((item) => item.setIndex === action.payload.setIndex);
      // Only a logged set can be corrected; a pending one is completed, not
      // edited, and letting this write it would log a set nobody pressed.
      if (!set || set.status !== 'completed') {
        return state;
      }
      // Judged as the lift it was logged as: a pull-up set corrected after the
      // swap to a lat pulldown is still a pull-up, with no weight to ask for.
      // The correction sheet asks the same rule (liftOfSet).
      const lift = liftOfSet(exercise, set);
      if (
        !Number.isFinite(action.payload.reps) ||
        action.payload.reps <= 0 ||
        action.payload.reps > repsCeilingFor(lift, set)
      ) {
        return state;
      }
      const unloaded = isUnloadedTrackingMode(lift.trackingMode);
      // Same ceiling as the dial: "825" typed for 82,5 was accepted here,
      // shown on the summary, then dropped from the log on the next load.
      if (!unloaded && !isLiftableWeight(action.payload.loadKg)) {
        return state;
      }

      set.actualReps = Math.round(action.payload.reps);
      set.actualLoadKg = unloaded ? 0 : (action.payload.loadKg as number);
      // The drafts follow, so reopening the set screen shows what the set now
      // says rather than what it said when it was logged.
      set.draftRepsText = String(set.actualReps);
      set.draftLoadText = unloaded ? '' : formatWeightInputValue(set.actualLoadKg, 'kg');
      set.edited = true;

      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }
    case 'set/recordEffort': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      const exercise = session.exercises[exerciseIndex];
      const set = exercise.sets.find((item) => item.setIndex === action.payload.setIndex);
      if (!set || set.status !== 'completed') {
        return state;
      }

      set.effort = action.payload.effort;
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'set/repeatLast': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      const exercise = session.exercises[exerciseIndex];
      const targetSet = exercise.sets.find((item) => item.setIndex === action.payload.setIndex);
      if (!targetSet || targetSet.status !== 'pending') {
        return state;
      }

      // Only a set of the lift the slot holds NOW: a swap mid-exercise leaves
      // earlier completed sets stamped as the lift before it (liftBeforeSwap),
      // and "repeat last set" copying one of those brought the old lift's
      // weight along with it — a leg press repeating a back squat's 100 kg
      // because that was the last completed set in the slot (2026-09-26).
      const sourceSet = [...exercise.sets]
        .filter((item) => item.setIndex < action.payload.setIndex)
        .reverse()
        .find(
          (item) =>
            item.status === 'completed' &&
            typeof item.actualReps === 'number' &&
            liftBeforeSwap(exercise, item) === null,
        );

      if (!sourceSet || (!isUnloadedTrackingMode(exercise.trackingMode) && typeof sourceSet.actualLoadKg !== 'number')) {
        return state;
      }

      targetSet.draftLoadText =
        isUnloadedTrackingMode(exercise.trackingMode)
          ? ''
          : formatWeightInputValue(sourceSet.actualLoadKg ?? 0, action.payload.unitPreference);
      targetSet.draftRepsText = String(sourceSet.actualReps ?? '');
      targetSet.actualLoadKg = sourceSet.actualLoadKg ?? 0;
      targetSet.actualReps = sourceSet.actualReps;
      targetSet.effort = sourceSet.effort ?? null;
      targetSet.completedAt = new Date(action.payload.nowMs).toISOString();
      targetSet.status = 'completed';
      targetSet.edited = true;
      targetSet.loggedAs = currentLiftOf(exercise);

      exercise.status = finalizeExerciseStatus(exercise);
      const nextTarget = findNextPendingTarget(session, exerciseIndex, action.payload.setIndex);
      if (nextTarget) {
        updateActiveExercise(session, nextTarget.exerciseIndex, nextTarget.setIndex);
      } else {
        session.ui.activeSlotId = exercise.slotId;
        session.ui.activeSetIndex = action.payload.setIndex;
      }
      // Same rule as set/logSet: no next set, no rest.
      session.restTimer = nextTarget
        ? {
            status: 'running',
            exerciseSlotId: exercise.slotId,
            setIndex: action.payload.setIndex,
            startedAtMs: action.payload.nowMs,
            endsAtMs: action.payload.nowMs + exercise.restSecondsMin * 1000,
            durationSeconds: exercise.restSecondsMin,
          }
        : createInitialTimer();
      session.ui.focusedField = null;
      session.updatedAt = new Date(action.payload.nowMs).toISOString();

      return { ...state, activeSession: session };
    }

    case 'set/undo': {
      if (!state.activeSession) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      const exercise = session.exercises[exerciseIndex];
      const set = exercise.sets.find((item) => item.setIndex === action.payload.setIndex);
      if (!set) {
        return state;
      }

      // The moment goes on record as taken back: a merge with the stored workout drops the stored set
      // it names rather than keep it as one this session never knew of (mergeStoredWorkoutLogs).
      if (set.status === 'completed' && set.completedAt) {
        session.takenBackAt = [...(session.takenBackAt ?? []), set.completedAt];
      }
      set.status = 'pending';
      set.actualLoadKg = undefined;
      set.actualReps = undefined;
      set.effort = null;
      set.completedAt = undefined;
      // Taken back, it is done again as whatever the slot holds now — the
      // lift it was logged as before a swap no longer answers for it.
      set.loggedAs = undefined;
      exercise.status = 'active';
      session.restTimer = createInitialTimer();
      updateActiveExercise(session, exerciseIndex, action.payload.setIndex);
      session.updatedAt = new Date().toISOString();

      return { ...state, activeSession: session };
    }

    case 'exercise/logWarmup': {
      if (!state.activeSession) {
        return state;
      }
      const { slotId, loadKg, reps, completedAt } = action.payload;
      // The same bounds a working set is held to, and a load: a warm-up is
      // offered on loaded lifts only, and 0 kg there is no warm-up (it was then
      // offered back every session — breaker, 2026-10-05).
      if (!isLiftableWeight(loadKg) || !(loadKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 100) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, slotId);
      if (exerciseIndex < 0) {
        return state;
      }
      const exercise = session.exercises[exerciseIndex];
      exercise.warmups = [...(exercise.warmups ?? []), { loadKg, reps, completedAt }];
      session.updatedAt = completedAt;
      return { ...state, activeSession: session };
    }

    case 'session/setMinutesClock': {
      if (!state.activeSession) {
        return state;
      }
      return { ...state, activeSession: { ...state.activeSession, minutesClock: action.payload.clock } };
    }

    case 'exercise/removeWarmup': {
      if (!state.activeSession) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      const warmups = exerciseIndex < 0 ? undefined : session.exercises[exerciseIndex].warmups;
      if (!warmups || action.payload.index < 0 || action.payload.index >= warmups.length) {
        return state;
      }
      const kept = warmups.filter((_, index) => index !== action.payload.index);
      session.exercises[exerciseIndex].warmups = kept.length > 0 ? kept : undefined;
      // Remembered as taken back, as set/undo does: a finish done twice merges
      // with the stored log, which would bring this warm-up back.
      session.takenBackAt = [...(session.takenBackAt ?? []), warmups[action.payload.index].completedAt];
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'exercise/addSet': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      // One more set of every lift in the block. A superset is counted in
      // rounds, so adding a round to one half of it and not the other is the
      // state the linking rule exists to prevent.
      const exercise = session.exercises[exerciseIndex];
      let nextSetIndex = 0;
      blockIndexes(session, exerciseIndex).forEach((position) => {
        const member = session.exercises[position];
        const sourceSet = member.sets[member.sets.length - 1];
        const memberNextIndex =
          member.sets.reduce((maxValue, set) => Math.max(maxValue, set.setIndex), -1) + 1;
        if (position === exerciseIndex) {
          nextSetIndex = memberNextIndex;
        }
        // A last set logged as another lift — the slot was swapped after it —
        // lends the new set neither its weight nor numbers in its unit: three
        // 60-second holds, a swap to a hip thrust, and the added set asked for
        // 60 reps at the hold's weight (review of #170).
        const sourceLift = sourceSet ? liftBeforeSwap(member, sourceSet) : null;
        const sourceReps = {
          repsMin: sourceSet?.plannedRepsMin ?? member.sets[0]?.plannedRepsMin ?? 1,
          repsMax: sourceSet?.plannedRepsMax ?? member.sets[0]?.plannedRepsMax ?? 1,
        };
        const planned = sourceLift
          ? prescriptionAfterSwap(sourceLift.trackingMode, member.trackingMode, sourceReps, member.exerciseName)
          : sourceReps;
        member.sets = [
          ...member.sets,
          {
            setIndex: memberNextIndex,
            plannedLoadKg: sourceLift ? undefined : sourceSet?.actualLoadKg ?? sourceSet?.plannedLoadKg,
            // The reader added this set, and its weight is usually the one
            // they just lifted — theirs, not the app's plan (lib/loggedSetPlan).
            addedMidSession: true,
            plannedRepsMin: planned.repsMin,
            plannedRepsMax: planned.repsMax,
            draftLoadText: '',
            draftRepsText: '',
            status: 'pending',
            effort: null,
            edited: false,
          },
        ];
        // Derived per member, not set on the tapped row alone. A partner that
        // had finished keeps `completed` otherwise, while holding an unlogged
        // set — and `findNextIncompleteIndex` skips a completed lift, so the
        // round just added to it would never be asked for (PR #93 review).
        member.status = finalizeExerciseStatus(member);
      });
      updateActiveExercise(session, exerciseIndex, nextSetIndex);
      session.restTimer = createInitialTimer();
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    /**
     * A logged session that never went through the player, filed where the
     * prefill can find it.
     *
     * Additive by construction: it writes under its own slot key and touches
     * no other session's entry, so a lift with guided history keeps it and
     * only gains a newer entry when the freestyle session really is newer —
     * which is what "what you last did" means. The session's own earlier
     * entries go first: a board finished again (merged into its save) is
     * recorded again, and two entries of one session ate the ten-entry cap and
     * doubled it in the progression gate.
     */
    case 'history/recordLogged': {
      const { performedAt, sessionId, templateName, exercises } = action.payload;
      const slotHistory: WorkoutHistoryStore['slotHistory'] = {};
      Object.entries(state.history.slotHistory).forEach(([key, entries]) => {
        slotHistory[key] = key.startsWith('logged:') ? entries.filter((item) => item.sessionId !== sessionId) : entries;
      });

      exercises.forEach((exercise) => {
        const name = exercise.exerciseName?.trim();
        // A row with no sets is an exercise that was listed and not done. It
        // is not a weight, and prefilling from it would open the next session
        // on nothing while claiming a source.
        if (!name || exercise.sets.length === 0) {
          return;
        }
        // Keyed by the lift, not by a slot it never had. The named lookup
        // reads across every key, so this only has to be stable and its own.
        const slotId = `logged:${name.toLowerCase()}`;
        const entry: WorkoutSlotHistoryEntry = {
          slotId,
          templateId: '',
          templateName,
          exerciseName: name,
          substitutionGroup: '',
          performedAt,
          sessionId,
          sets: exercise.sets.map((set) => ({
            setIndex: set.setIndex,
            loadKg: set.loadKg,
            reps: set.reps,
            completedAt: set.completedAt ?? performedAt,
            effort: null,
          })),
          skipped: false,
        };
        slotHistory[slotId] = [entry, ...(slotHistory[slotId] ?? [])].slice(0, 10);
      });

      return { ...state, history: { ...state.history, slotHistory } };
    }

    case 'history/forgetSession': {
      const { sessionId } = action.payload;
      if (!sessionId) {
        return state;
      }
      let changed = false;
      const slotHistory: WorkoutHistoryStore['slotHistory'] = {};
      Object.entries(state.history.slotHistory).forEach(([slotId, entries]) => {
        const kept = (entries ?? []).filter((entry) => entry?.sessionId !== sessionId);
        if (kept.length !== (entries ?? []).length) {
          changed = true;
        }
        if (kept.length > 0) {
          slotHistory[slotId] = kept;
        }
      });
      const sessions = state.history.sessions.filter((summary) => summary.sessionId !== sessionId);
      if (!changed && sessions.length === state.history.sessions.length) {
        return state;
      }
      return { ...state, history: { ...state.history, slotHistory, sessions } };
    }

    /**
     * One set fewer, the other half of addSet.
     *
     * Only ever the last PENDING set, and never the last set standing:
     * removing a set you have already logged would throw away work through a
     * control meant for planning, and an exercise with no sets is not an
     * exercise. Both refusals are silent — the row simply does not change, and
     * the caller hides the control when there is nothing to take.
     */
    case 'exercise/removeSet': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      // All or none: the block's set count is one number, so a round comes off
      // every lift in it or off none. If any member's last set is already
      // logged, taking the round back would either lose that set or leave the
      // two halves disagreeing again.
      const block = blockIndexes(session, exerciseIndex);
      const removable = block.every((position) => {
        const member = session.exercises[position];
        return member.sets.length > 1 && member.sets[member.sets.length - 1].status === 'pending';
      });
      if (!removable) {
        return state;
      }

      block.forEach((position) => {
        const member = session.exercises[position];
        member.sets = member.sets.slice(0, -1);
        // The round taken back was the only set left to do: the lift is done.
        // Left at 'active', it was saved as one and History badged a finished
        // lift "Partial" (break round, 2026-09-28). Only then — a lift not yet
        // started keeps 'pending', which finalizing would turn 'active'.
        if (!member.sets.some((set) => set.status === 'pending')) {
          member.status = finalizeExerciseStatus(member);
        }
      });
      const exercise = session.exercises[exerciseIndex];
      if (!exercise.sets.some((set) => set.status === 'pending')) {
        // Nothing left to do here: on to the next lift with a set to do, as a
        // skip or a last logged set moves on. Left in place, the player held a
        // finished lift as the active one (recheck of #222, 2026-09-28).
        advanceAfterMutation(session, exerciseIndex);
      } else {
        const nextIndex = exercise.sets[exercise.sets.length - 1]?.setIndex ?? 0;
        updateActiveExercise(session, exerciseIndex, nextIndex);
      }
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'exercise/skip': {
      if (!state.activeSession) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }

      const exercise = session.exercises[exerciseIndex];
      dropMinutesClockOfSlot(session, action.payload.slotId);
      exercise.sets = exercise.sets.map((set) =>
        set.status === 'completed'
          ? set
          : {
              ...set,
              status: 'skipped',
              skippedReason: action.payload.reason ?? 'Skipped by user',
            },
      );
      // Derived, not hard-set: a set logged before the skip keeps the
      // exercise out of `skipped`, and with it out of the filter that would
      // drop that set from every stat.
      exercise.status = finalizeExerciseStatus(exercise);
      session.restTimer = createInitialTimer();
      advanceAfterMutation(session, exerciseIndex);
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'exercise/insertAfter': {
      if (!state.activeSession) {
        return state;
      }

      const session = cloneSession(state.activeSession);
      // `afterSlotId` is null for a session with no main-block exercise to
      // anchor after (a cooldown-only session's mid-workout add) — insert at
      // the front of the list rather than requiring a slot that cannot
      // exist. A named anchor still has to resolve: a stale or unknown slot
      // id is not a request to insert at the front (recheck round
      // 2026-09-29).
      let insertIndex: number;
      if (action.payload.afterSlotId === null) {
        insertIndex = 0;
      } else {
        const exerciseIndex = findExerciseIndex(session, action.payload.afterSlotId);
        if (exerciseIndex < 0) {
          return state;
        }
        insertIndex = exerciseIndex + 1;
      }

      const insertedExercise = materializeInsertedExercise(action.payload.exercise, insertIndex);
      session.exercises.splice(insertIndex, 0, insertedExercise);
      session.exercises = session.exercises.map((exercise, index) => ({
        ...exercise,
        orderIndex: index,
      }));
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'exercise/swap': {
      if (!state.activeSession) {
        return state;
      }
      const session = cloneSession(state.activeSession);
      const exerciseIndex = findExerciseIndex(session, action.payload.slotId);
      if (exerciseIndex < 0) {
        return state;
      }
      const exercise = session.exercises[exerciseIndex];
      // A set logged here is stamped with its lift already (currentLiftOf);
      // one logged by a build from before the stamp is stamped now, before
      // the name changes and the answer is lost.
      exercise.sets.forEach((set) => {
        if (set.status === 'completed' && !set.loggedAs) {
          set.loggedAs = liftBeforeSwap(exercise, set) ?? currentLiftOf(exercise);
        }
      });
      exercise.sourceExerciseName = exercise.sourceExerciseName ?? exercise.exerciseName;
      exercise.exerciseName = action.payload.exerciseName;
      // The bout that was on the clock is not the lift that replaces it.
      dropMinutesClockOfSlot(session, action.payload.slotId);
      // The mode is the incoming lift's. Kept from the old one, a pull-up
      // swapped for a lat pulldown hid the weight dial and saved 0 kg × 12.
      // And the sets still ahead ask for numbers in its unit: seconds of a
      // hold are not repetitions of a hip thrust. One rule with Home's swaps
      // and "For ever" (lib/swapDose), so the same pick opens on the same dose
      // wherever it was made.
      const pendingSets = exercise.sets.filter((set) => set.status === 'pending');
      const dose = doseAfterSwap(
        {
          trackingMode: exercise.trackingMode,
          sets: pendingSets.length,
          repsMin: pendingSets[0]?.plannedRepsMin ?? 0,
          repsMax: pendingSets[0]?.plannedRepsMax ?? 0,
        },
        action.payload.exerciseName,
      );
      exercise.trackingMode = dose.trackingMode;
      pendingSets.forEach((set) => {
        set.plannedRepsMin = dose.repsMin;
        set.plannedRepsMax = dose.repsMax;
      });
      exercise.substitutionGroup = action.payload.substitutionGroup;
      exercise.status = 'swapped';
      // The prefilled load belongs to the lift you just swapped AWAY from — it
      // came from this slot's history, and a leg-press weight is not a front-
      // squat weight. Sets already logged keep what was actually done; the ones
      // still ahead are re-resolved for the lift you are actually about to do:
      // if you have squatted before — anywhere — that weight appears, otherwise
      // the field opens empty. `autoProgressedFromKg` is dropped either way,
      // because the progression gate did not choose a weight for this lift and
      // the badge must not say it did.
      const swappedInFound = findLatestEntryForExerciseName(state.history.slotHistory, action.payload.exerciseName, {
        requireLoaded: !isUnloadedTrackingMode(exercise.trackingMode),
        // Same gate as the session's own prefill: the swapped-in lift's weight
        // only carries over from sessions run at reps this slot is asking for.
        // Asked of the sets still ahead: a set logged before the swap carries
        // the old lift's prescription.
        repWindow: resolveInstanceBorrowRepWindow({
          trackingMode: exercise.trackingMode,
          sets: pendingSets.length > 0 ? pendingSets : exercise.sets,
        }),
      });
      // Its working sets only, numbered as done (lib/warmupSets), as the
      // session's own prefill and the "Last time" panel read them: against the
      // programme's count, so a set added mid-session does not change which of
      // last time's sets were warm-ups (review, 2026-10-05).
      const swappedInEntry = swappedInFound
        ? toWorkingHistoryEntry(swappedInFound, programmeSetCount(exercise.sets))
        : null;
      // Sets logged before this moment were a different lift. Clearing their
      // drafts is not enough on its own: the logger also carries forward from
      // the last COMPLETED set, which walked straight back over the swap and
      // put the old lift's weight on the new one (seen on device: 2.5 kg of
      // front squat reappearing on a back squat). This is the line it may not
      // cross. A second swap keeps the later line.
      const completedIndexes = exercise.sets
        .filter((set) => set.status === 'completed')
        .map((set) => set.setIndex);
      if (completedIndexes.length > 0) {
        exercise.swappedAfterSetIndex = Math.max(
          exercise.swappedAfterSetIndex ?? -1,
          ...completedIndexes,
        );
      } else {
        // Nothing done yet: the warm-ups were for the lift that is gone. Kept,
        // they showed as the new lift's, were saved under it and offered for
        // it next time — a barbell warm-up for a dumbbell lift (review,
        // 2026-10-05). After a logged set they stay: they belong to the lift
        // the slot started as, which keeps its own row.
        exercise.warmups = undefined;
      }
      exercise.sets.forEach((set) => {
        if (set.status !== 'pending') {
          return;
        }
        // By its place within the new lift, which is how that lift's history
        // numbers it — not by its place in the slot (review of #170).
        const historical = findHistoricalSetForIndex(swappedInEntry, setIndexWithinLift(exercise, set));
        set.draftLoadText = historical ? formatWeightInputValue(historical.loadKg, action.payload.unitPreference) : '';
        set.plannedLoadKg = historical?.loadKg;
        set.autoProgressedFromKg = undefined;
        // So do the gate's holds: a badge on the new lift would name a
        // decision nobody made about it.
        set.heldForFatigue = undefined;
        set.heldForCautionArea = undefined;
        // The rep target the gate picked belongs to the swapped-away lift too.
        set.plannedTargetReps = undefined;
        set.autoProgressedFromReps = undefined;
        set.rampTargetReps = undefined;
        set.prefilledFromPerformedAt = historical ? swappedInEntry?.performedAt : undefined;
        // A set the reader added was theirs only while it carried the weight
        // of the set before it. Re-resolved from the new lift's history it
        // holds a number the app chose (or none), and the log must say so:
        // `borrowed` or `none`, not "the reader's own" (lib/loggedSetPlan).
        // A set added after the swap is added afresh and stays `added`.
        // The set is still past the programme's count, though, so it keeps
        // that mark: cleared, the next swap and the "Last time" panel counted
        // it as the programme's and read last time's warm-up as set 1 (bug
        // hunt W11, 2026-10-05).
        if (set.addedMidSession) {
          set.plannedBySwap = true;
        }
      });
      session.ui.swapSheetSlotId = null;
      session.updatedAt = new Date().toISOString();
      return { ...state, activeSession: session };
    }

    case 'exercise/updateNotes':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          exercises: state.activeSession.exercises.map((exercise) =>
            exercise.slotId === action.payload.slotId ? { ...exercise, notes: action.payload.notes } : exercise,
          ),
          ui: { ...state.activeSession.ui, noteEditorSlotId: null },
        },
      };

    case 'timer/start':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          restTimer: {
            status: 'running',
            exerciseSlotId: action.payload.slotId,
            setIndex: action.payload.setIndex,
            startedAtMs: action.payload.nowMs,
            endsAtMs: action.payload.nowMs + action.payload.durationSeconds * 1000,
            durationSeconds: action.payload.durationSeconds,
          },
        },
      };

    case 'timer/pause':
      if (!state.activeSession || state.activeSession.restTimer.status !== 'running' || !state.activeSession.restTimer.endsAtMs) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          restTimer: {
            ...state.activeSession.restTimer,
            status: 'paused',
            // Read at the moment of the pause, from the action.
            durationSeconds: restSecondsLeft(state.activeSession.restTimer, action.payload.nowMs),
          },
        },
      };

    case 'timer/resume':
      if (!state.activeSession || state.activeSession.restTimer.status !== 'paused') {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          restTimer: {
            ...state.activeSession.restTimer,
            status: 'running',
            startedAtMs: action.payload.nowMs,
            endsAtMs: action.payload.nowMs + state.activeSession.restTimer.durationSeconds * 1000,
          },
        },
      };

    case 'timer/override':
      if (!state.activeSession || state.activeSession.restTimer.status === 'idle') {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          restTimer:
            state.activeSession.restTimer.status === 'paused'
              ? {
                  ...state.activeSession.restTimer,
                  durationSeconds: action.payload.durationSeconds,
                  startedAtMs: null,
                  endsAtMs: null,
                }
              : {
                  ...state.activeSession.restTimer,
                  durationSeconds: action.payload.durationSeconds,
                  startedAtMs: action.payload.nowMs,
                  endsAtMs: action.payload.nowMs + action.payload.durationSeconds * 1000,
                },
        },
      };

    case 'timer/clear':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          restTimer: createInitialTimer(),
        },
      };

    case 'session/setGuidedStep': {
      if (!state.activeSession) {
        return state;
      }
      const { ui } = state.activeSession;
      const sameAnchor =
        JSON.stringify(ui.guidedResumeAnchor ?? null) === JSON.stringify(action.payload.anchor ?? null);
      if (ui.guidedStepIndex === action.payload.stepIndex && sameAnchor) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          updatedAt: new Date(action.payload.nowMs ?? Date.now()).toISOString(),
          ui: {
            ...ui,
            guidedStepIndex: action.payload.stepIndex,
            guidedResumeAnchor: action.payload.anchor,
          },
        },
      };
    }

    case 'cardio/start':
      return {
        ...state,
        activeCardio: startCardioSession(action.payload.activityType, action.payload.nowMs),
      };

    case 'cardio/pause':
      if (!state.activeCardio) {
        return state;
      }
      return {
        ...state,
        activeCardio: pauseCardioSession(state.activeCardio, action.payload.nowMs),
      };

    case 'cardio/resume':
      if (!state.activeCardio) {
        return state;
      }
      return {
        ...state,
        activeCardio: resumeCardioSession(state.activeCardio, action.payload.nowMs),
      };

    case 'freestyle/save':
      return { ...state, freestyleDraft: action.payload.snapshot };

    case 'freestyle/clear':
      return state.freestyleDraft ? { ...state, freestyleDraft: null } : state;

    case 'cardio/clear':
      if (!state.activeCardio) {
        return state;
      }
      return { ...state, activeCardio: null };

    case 'cardio/settle':
      // Only the run as it was read: a pause or a resume dispatched since is the reader's, and stands.
      if (
        !state.activeCardio ||
        state.activeCardio.startedAt !== action.payload.session.startedAt ||
        state.activeCardio.resumedAt !== action.payload.wasResumedAt
      ) {
        return state;
      }
      return { ...state, activeCardio: action.payload.session };

    case 'session/openFinishSummary':
      if (!state.activeSession) {
        return state;
      }
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          ui: {
            ...state.activeSession.ui,
            finishSummaryOpen: true,
          },
        },
      };

    case 'session/finishWorkout':
      return completeWorkoutSession(state, action.payload?.performedAt);

    case 'session/discardWorkout':
      return {
        ...state,
        activeSession: null,
        completionSummary: null,
      };

    // Before the save, so the finish state, the slot history, the summary and the stored row all name
    // one id. A finished session's id is its history's key: never changed after the fact.
    case 'session/adoptSessionId':
      if (
        !state.activeSession ||
        state.activeSession.status === 'completed' ||
        !action.payload.sessionId ||
        state.activeSession.sessionId === action.payload.sessionId
      ) {
        return state;
      }
      return {
        ...state,
        activeSession: { ...state.activeSession, sessionId: action.payload.sessionId },
      };

    case 'session/clearCompletedSession':
      return {
        ...state,
        activeSession: null,
        completionSummary: null,
      };

    // The reset used to end at clearCompletedSession, which keeps `history`:
    // every set's weight and reps stayed in @vinha/workout/v1, the next session
    // opened on pre-reset loads and "last time" still showed them, after a
    // dialog promising workouts and sessions were cleared (2026-09-14).
    case 'session/resetAll':
      return {
        ...workoutInitialState,
        hydrated: true,
        isRestoring: false,
      };

    default:
      return state;
  }
}

/**
 * A bout's clock goes with its lift: skipped or swapped away, a clock left
 * running on the session held the idle nudge back for minutes nobody was
 * riding (review, 2026-10-07).
 */
function dropMinutesClockOfSlot(session: WorkoutSessionRuntime, slotId: string) {
  if (session.minutesClock && session.minutesClock.slotId === slotId) {
    session.minutesClock = null;
  }
}

function cloneSession(session: WorkoutSessionRuntime) {
  return {
    ...session,
    exercises: session.exercises.map(cloneExercise),
    restTimer: { ...session.restTimer },
    ui: { ...session.ui },
  };
}

/**
 * The reps a lift's sets were asked for when the app lowered them below the
 * programme's floor, read off the first set logged as that lift. Nothing for
 * an ordinary session or a bodyweight lift.
 *
 * Read off the sets, not off whether the lift was swapped in: a lift swapped
 * on Home is materialized from its own history and can be given a lowered
 * target, while a swap mid-session clears the target on every set still ahead
 * (`exercise/swap`) — so the sets already say which lift was given one
 * (review of #202). Logged, because a set skipped before a mid-session swap
 * falls to the new lift still carrying the old one's number.
 */
function loweredTargetOf(segment: { sets: WorkoutSetInstance[] }) {
  const first = segment.sets.find((set) => set.status === 'completed');
  const target = first?.plannedTargetReps;
  if (!first || typeof target !== 'number' || !(target < first.plannedRepsMin)) {
    return {};
  }
  return { targetReps: target };
}

export function completeWorkoutSession(state: WorkoutFeatureState, performedAt = new Date().toISOString()) {
  if (!state.activeSession) {
    return state;
  }
  // Once. A second finish of the same session — a double tap on "Finish &
  // save", or a retry after the save had already landed — filed every slot's
  // entry a second time, which ate the ten-entry cap and doubled the session
  // in the progression gate's reading.
  if (state.activeSession.status === 'completed') {
    return state;
  }

  const session = cloneSession(state.activeSession);
  session.status = 'completed';
  session.completedAt = performedAt;
  session.updatedAt = performedAt;
  session.restTimer = createInitialTimer();
  session.ui.finishSummaryOpen = true;

  const summary = buildSummary(session);
  const slotHistory: WorkoutHistoryStore['slotHistory'] = { ...state.history.slotHistory };

  session.exercises.forEach((exercise) => {
    // One entry per lift the slot held: the sets before a swap are the old
    // lift's history, not the new one's, and the next session of either lift
    // opens on what that lift actually did (lib/liftSegments).
    const warmups = (exercise.warmups ?? []).map(({ loadKg, reps }) => ({ loadKg, reps }));
    const entries = splitExerciseByLift(exercise).map((segment, segmentIndex): WorkoutSlotHistoryEntry => ({
      slotId: exercise.slotId,
      templateId: session.templateId,
      templateName: session.templateName,
      exerciseName: segment.exerciseName,
      substitutionGroup: exercise.substitutionGroup,
      performedAt,
      sessionId: session.sessionId,
      sets: segment.sets
        .filter((set) => set.status === 'completed' && typeof set.actualLoadKg === 'number' && typeof set.actualReps === 'number')
        .map((set) => ({
          setIndex: set.setIndex,
          loadKg: set.actualLoadKg ?? 0,
          reps: set.actualReps ?? 0,
          completedAt: set.completedAt ?? performedAt,
          effort: set.effort ?? null,
        })),
      skipped: segment.current && exercise.status === 'skipped',
      swappedFrom: segment.swappedFrom ?? undefined,
      // The lowered target this session asked for, if it asked for one, so
      // the next can ask one more (lib/progressionGate resolveMissedRepsTarget).
      ...loweredTargetOf(segment),
      // Warm-ups come before the first working set, so they belong to the lift
      // the slot started as: the first segment.
      ...(segmentIndex === 0 && warmups.length > 0 ? { warmups } : {}),
    }));

    // Newest first, like the list it joins: the lift the slot ended on leads.
    slotHistory[exercise.slotId] = [...entries.reverse(), ...(slotHistory[exercise.slotId] ?? [])].slice(0, 10);
  });

  return {
    ...state,
    activeSession: session,
    completionSummary: summary,
    history: {
      ...state.history,
      sessions: [summary, ...state.history.sessions].slice(0, 20),
      slotHistory,
    },
  };
}

export function selectActiveExercise(session: WorkoutSessionRuntime | null) {
  if (!session || !session.ui.activeSlotId) {
    return null;
  }
  return session.exercises.find((exercise) => exercise.slotId === session.ui.activeSlotId) ?? null;
}

export function selectNextExercise(session: WorkoutSessionRuntime | null) {
  if (!session) {
    return null;
  }
  const activeIndex = session.exercises.findIndex((exercise) => exercise.slotId === session.ui.activeSlotId);
  const nextIndex = session.exercises.findIndex((exercise, index) => index > activeIndex && exercise.status !== 'completed' && exercise.status !== 'skipped');
  return session.exercises[nextIndex >= 0 ? nextIndex : -1] ?? null;
}

export function selectWorkoutSummary(state: WorkoutFeatureState) {
  return state.completionSummary;
}

export function selectProgressionHint(state: WorkoutFeatureState, slotId: string) {
  const exercise = state.activeSession?.exercises.find((item) => item.slotId === slotId);
  const history = exercise ? getHistoryEntriesForExercise(state.history, exercise)[0] : null;
  if (!exercise || !history) {
    return null;
  }

  const lastSet = history.sets[history.sets.length - 1];
  if (!lastSet) {
    return null;
  }

  if (lastSet.reps >= exercise.sets[0].plannedRepsMax) {
    return 'Increase load next time';
  }

  if (lastSet.reps >= exercise.sets[0].plannedRepsMin) {
    return 'Repeat load and beat reps';
  }

  return 'Repeat last load';
}















