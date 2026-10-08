import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { FreestyleDraftSnapshot } from '../../lib/emptyWorkoutSession';
import type { SessionMinutesClock } from '../../lib/minutesExercises';
import { AppState } from 'react-native';
import { StorageLoadFailedScreen } from '../../components/StorageLoadFailedScreen';
import { trackEvent } from '../analytics/analyticsClient';
import { reportOperationFailed } from '../errorReporting/errorReporter';
import { markingWorkoutFailures } from '../errorReporting/workoutFailure';
import { isWorkoutInProgress } from '../../lib/activeWorkout';
import { bringBackWorkoutAside, hasWorkoutAsideCopy } from '../../storage/workoutAside';

import { CardioActivityType, UnitPreference } from '../../types/models';
import { ActiveCardioSession } from '../../lib/cardio';
import { CORE_WORKOUT_TEMPLATE_ID, WORKOUT_TEMPLATES_V1, getWorkoutTemplateById, getWorkoutTemplateSessions } from './workoutCatalog';
import { clearWorkoutBundle, loadWorkoutBundle, normalizeWorkoutBundle, saveWorkoutBundle } from './workoutPersistence';
import { loadWithRetry } from '../../storage/loadWithRetry';
import { GuidedResumeAnchor, WorkoutExerciseInsertInput, WorkoutHistoryStore, WorkoutPersistenceBundle, WorkoutProgressionOptions, WorkoutRuntimeTemplate, WorkoutSessionRuntime, WorkoutSetEffort } from './workoutTypes';
import {
  WorkoutFeatureState,
  workoutInitialState,
  workoutReducer,
  selectWorkoutSummary,
} from './workoutState';

interface WorkoutContextValue {
  hydrated: boolean;
  isRestoring: boolean;
  templates: typeof WORKOUT_TEMPLATES_V1;
  coreTemplateId: string;
  state: WorkoutFeatureState;
  activeSession: WorkoutSessionRuntime | null;
  history: WorkoutHistoryStore;
  completionSummary: ReturnType<typeof selectWorkoutSummary>;
  startWorkout: (
    templateId: string,
    unitPreference: UnitPreference,
    progression?: WorkoutProgressionOptions,
  ) => void;
  startCustomWorkout: (
    template: WorkoutRuntimeTemplate,
    unitPreference: UnitPreference,
    progression?: WorkoutProgressionOptions,
  ) => void;
  /** Stop the workout clock. Its pauses come off the saved duration too. */
  pauseWorkout: () => void;
  /** Start the clock again. Does nothing when nothing is paused. */
  resumeWorkout: () => void;
  finishWorkout: (performedAt?: string) => void;
  discardWorkout: () => void;
  /** The running session saves under another id: its Finish found its own taken by another workout. */
  adoptSessionId: (sessionId: string) => void;
  clearCompletedWorkout: () => void;
  /** Erase the whole training record this provider holds: session, cardio and per-slot history. */
  resetWorkoutData: () => Promise<void>;
  clearRestTimer: () => void;
  pauseRestTimer: () => void;
  resumeRestTimer: () => void;
  setActiveExercise: (slotId: string, setIndex?: number) => void;
  expandExercise: (slotId: string) => void;
  collapseExercise: (slotId: string) => void;
  /**
   * `afterSlotId` is null for a session with no main-block exercise to
   * anchor after — a cooldown-only session's mid-workout add. The reducer
   * inserts at the front of the (empty) list instead (recheck round
   * 2026-09-29).
   */
  insertExerciseAfter: (afterSlotId: string | null, exercise: WorkoutExerciseInsertInput) => void;
  updateSetDraft: (slotId: string, setIndex: number, patch: { loadText?: string; repsText?: string }) => void;
  completeSet: (slotId: string, setIndex: number, unitPreference: UnitPreference) => void;
  /** Correct a set that is already logged, without moving the session on. */
  editLoggedSet: (slotId: string, setIndex: number, reps: number, loadKg: number | null) => void;
  repeatLastSet: (slotId: string, setIndex: number, unitPreference: UnitPreference) => void;
  undoSet: (slotId: string, setIndex: number, unitPreference: UnitPreference) => void;
  addSet: (slotId: string) => void;
  /** A warm-up set, kept apart from the working sets (WorkoutWarmupSet). */
  logWarmup: (slotId: string, loadKg: number, reps: number) => void;
  /** Takes back the warm-up at `index`. */
  removeWarmup: (slotId: string, index: number) => void;
  /** Takes the last pending set back. Refuses on a logged set or the last one. */
  removeSet: (slotId: string) => void;
  /** Keeps a bout's stopwatch on the session (null: none on the clock). */
  setMinutesClock: (clock: SessionMinutesClock | null) => void;
  /**
   * File a session logged outside the player, so the next set of those lifts
   * opens on what was actually done. See the 'history/recordLogged' action.
   */
  recordLoggedWorkout: (input: {
    performedAt: string;
    sessionId: string;
    templateName: string;
    exercises: Array<{
      exerciseName: string;
      sets: Array<{ setIndex: number; loadKg: number; reps: number; completedAt?: string | null }>;
    }>;
  }) => void;
  /** A deleted saved workout, taken out of "last time", prefill and progression. */
  forgetHistorySession: (sessionId: string) => void;
  skipExercise: (slotId: string, reason?: string) => void;
  swapExercise: (
    slotId: string,
    exerciseName: string,
    substitutionGroup: string,
    unitPreference: UnitPreference,
  ) => void;
  updateNotes: (slotId: string, notes: string) => void;
  setGuidedStep: (stepIndex: number, anchor?: GuidedResumeAnchor) => void;
  activeCardio: ActiveCardioSession | null;
  /** A freestyle session in flight, persisted with the bundle; see FreestyleDraftSnapshot. */
  freestyleDraft: FreestyleDraftSnapshot | null;
  saveFreestyleDraft: (snapshot: FreestyleDraftSnapshot) => void;
  clearFreestyleDraft: () => void;
  startCardio: (activityType: CardioActivityType) => void;
  pauseCardio: () => void;
  resumeCardio: () => void;
  clearCardio: () => void;
  /**
   * Puts the run back as given (a saved run that came back running, stopped where it was saved), if
   * it is still the run that was read: running since `wasResumedAt`.
   */
  settleCardio: (session: ActiveCardioSession, wasResumedAt: string | null) => void;
  /**
   * Replaces the workout history with a cloud backup, through the same
   * normalizer the stored bundle goes through on load. The active session is
   * deliberately dropped: a backup restore is a new phone or an explicit
   * replace, not a place to resurrect a workout from another device.
   *
   * Resolves once the bundle is on disk, and rejects when the disk refuses
   * it — "Backup restored" used to show while the write was still queued,
   * and a refused one was only logged.
   */
  restoreHistoryFromBackup: (history: unknown) => Promise<WorkoutHistoryStore>;
  /** A copy the crash screen put aside is on the phone, for Settings' Restore set-aside workout. */
  setAsideWorkoutAvailable: boolean;
  /**
   * Brings back the workout data the crash screen put aside (storage/workoutAside).
   * Never deletes: what the app holds now is copied aside first, the copy is
   * written back as the stored bundle and shown, and only then does its slot go.
   * 'busy' — a workout, run or free workout is going, and is not swapped out
   * from under the reader; 'none' — no copy; 'unreadable' — the copy does not
   * parse, and stays where it is. Rejects when a write is refused, with every
   * copy where it was.
   */
  restoreSetAsideWorkout: () => Promise<'restored' | 'busy' | 'none' | 'unreadable'>;
}

/**
 * The reducer, with a failure in it marked as the workout's: this is where the
 * stored bundle is applied (session/hydrate), and a crash screen showing such a
 * failure offers to put the workout aside (errorReporting/workoutFailure).
 */
const markedWorkoutReducer: typeof workoutReducer = (state, action) => markingWorkoutFailures(() => workoutReducer(state, action));

const WorkoutContext = createContext<WorkoutContextValue | null>(null);

export function WorkoutProvider({ children }: React.PropsWithChildren) {
  const [state, dispatch] = useReducer(markedWorkoutReducer, workoutInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [setAsideWorkoutAvailable, setSetAsideWorkoutAvailable] = useState(false);
  const refreshSetAside = () => {
    void hasWorkoutAsideCopy().then(setSetAsideWorkoutAvailable);
  };
  /**
   * The phone refused the read, after retries. There was no catch here at all,
   * so the app sat on its splash forever; an empty bundle instead would be
   * saved at once over the stored one. Nothing is written while this is set.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      dispatch({ type: 'session/markRestoring', payload: { value: true } });
      const result = await loadWithRetry(loadWorkoutBundle, {
        isCancelled: () => cancelled,
        onError: (error) => console.error('Failed to hydrate workout bundle', error),
      });
      if (result.kind === 'cancelled') {
        return;
      }
      if (result.kind === 'failed') {
        reportOperationFailed('workout_load', result.error);
        setLoadFailed(true);
        return;
      }
      dispatch({ type: 'session/hydrate', payload: result.value });
      // A copy the crash screen made before this mount is offered back in Settings.
      refreshSetAside();
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  /**
   * The clock runs only while something needs one.
   *
   * The condition was `hydratedRef.current` — true from the first load until the
   * app closes — so this dispatched a tick every second for the entire life of
   * the process. With no session running the reducer's only answer is a new
   * state object carrying a new `nowMs`, and a new state object re-renders every
   * child of this provider: the whole app, once a second, on every screen,
   * forever.
   *
   * It was invisible because nothing looked wrong — until a render counter put
   * timestamps on it and they came out exactly one second apart. It is also the
   * answer to the settings lag that survived three earlier fixes: theme and
   * language were never slow, the app was simply always busy.
   */
  //
  // Nothing shared needs a second hand at all. The session's elapsed seconds
  // are derived where they are shown, the player and the free workout count
  // their own rests, and cardio keeps its own clock — so a running rest still
  // ticked the whole app, and rewrote the workout bundle, once a second
  // (2026-09-16). The one thing the shared state does with time is put a rest
  // away when it ends: one timer, set for that moment.
  const restEndsAtMs =
    state.activeSession?.status === 'active' && state.activeSession.restTimer.status === 'running'
      ? state.activeSession.restTimer.endsAtMs
      : null;

  useEffect(() => {
    if (!state.hydrated || restEndsAtMs === null) {
      return;
    }
    const settle = () => dispatch({ type: 'session/tick', payload: { nowMs: Date.now() } });
    const timeout = setTimeout(settle, Math.max(0, restEndsAtMs - Date.now()));
    // A timer does not run while the app is asleep: settle on waking, and the
    // reducer does nothing if the rest has not ended yet.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        settle();
      }
    });
    return () => {
      clearTimeout(timeout);
      subscription.remove();
    };
  }, [state.hydrated, restEndsAtMs]);

  useEffect(() => {
    if (!state.hydrated) {
      return;
    }

    const bundle: WorkoutPersistenceBundle = {
      activeSession: state.activeSession,
      history: state.history,
      activeCardio: state.activeCardio,
      freestyleDraft: state.freestyleDraft,
    };
    saveWorkoutBundle(bundle).catch((error) => {
      console.error('Failed to persist workout bundle', error);
    });
  }, [state.activeSession, state.activeCardio, state.freestyleDraft, state.hydrated, state.history]);

  const completionSummary = selectWorkoutSummary(state);

  const value = useMemo<WorkoutContextValue>(
    () => ({
      hydrated: state.hydrated,
      isRestoring: state.isRestoring,
      templates: WORKOUT_TEMPLATES_V1,
      coreTemplateId: CORE_WORKOUT_TEMPLATE_ID,
      state,
      activeSession: state.activeSession,
      history: state.history,
      completionSummary,
      startWorkout(templateId, unitPreference, progression) {
        const template = getWorkoutTemplateById(templateId);
        if (!template) {
          return;
        }

        if (state.activeSession && state.activeSession.status === 'active') {
          return;
        }

        trackEvent('workout_started');
        dispatch({
          type: 'session/startFromTemplate',
          payload: {
            templateId: template.id,
            sessionOrderIndex: state.history.sessions.length + 1,
            unitPreference,
            progression,
          },
        });
      },
      startCustomWorkout(template, unitPreference, progression) {
        if (state.activeSession && state.activeSession.status === 'active') {
          return;
        }

        trackEvent('workout_started');
        dispatch({
          type: 'session/startFromRuntimeTemplate',
          payload: {
            template,
            sessionOrderIndex: state.history.sessions.length + 1,
            unitPreference,
            progression,
          },
        });
      },
      pauseWorkout() {
        dispatch({ type: 'session/pause' });
      },
      resumeWorkout() {
        // No session in the action. This value is built from one render's
        // state, and the player resumes in the same tap that logs a set,
        // swaps or skips: the session sent from here was the one from before
        // those, and the reducer put it back over them (2026-09-20).
        dispatch({ type: 'session/resume', payload: { nowMs: Date.now() } });
      },
      finishWorkout(performedAt) {
        dispatch({ type: 'session/finishWorkout', payload: { performedAt } });
      },
      discardWorkout() {
        dispatch({ type: 'session/discardWorkout' });
      },
      adoptSessionId(sessionId) {
        dispatch({ type: 'session/adoptSessionId', payload: { sessionId } });
      },
      clearCompletedWorkout() {
        dispatch({ type: 'session/clearCompletedSession' });
      },
      async resetWorkoutData() {
        // The stored bundle goes first, the legacy key with it; the empty state
        // is then written back by the persistence effect like any other change.
        await clearWorkoutBundle();
        dispatch({ type: 'session/resetAll', payload: { nowMs: Date.now() } });
        // The reset erased the set-aside copies with the rest.
        refreshSetAside();
      },
      clearRestTimer() {
        dispatch({ type: 'timer/clear' });
      },
      pauseRestTimer() {
        dispatch({ type: 'timer/pause', payload: { nowMs: Date.now() } });
      },
      resumeRestTimer() {
        dispatch({ type: 'timer/resume', payload: { nowMs: Date.now() } });
      },
      setActiveExercise(slotId, setIndex = 0) {
        dispatch({ type: 'exercise/setActive', payload: { slotId, setIndex } });
      },
      expandExercise(slotId) {
        dispatch({ type: 'exercise/expand', payload: { slotId } });
      },
      collapseExercise(slotId) {
        dispatch({ type: 'exercise/collapse', payload: { slotId } });
      },
      insertExerciseAfter(afterSlotId, exercise) {
        dispatch({ type: 'exercise/insertAfter', payload: { afterSlotId, exercise } });
      },
      updateSetDraft(slotId, setIndex, patch) {
        dispatch({ type: 'set/updateDraft', payload: { slotId, setIndex, patch } });
      },
      completeSet(slotId, setIndex, unitPreference) {
        dispatch({ type: 'set/complete', payload: { slotId, setIndex, nowMs: Date.now(), unitPreference } });
      },
      editLoggedSet(slotId, setIndex, reps, loadKg) {
        dispatch({ type: 'set/editLogged', payload: { slotId, setIndex, reps, loadKg } });
      },
      repeatLastSet(slotId, setIndex, unitPreference) {
        dispatch({ type: 'set/repeatLast', payload: { slotId, setIndex, nowMs: Date.now(), unitPreference } });
      },
      undoSet(slotId, setIndex, unitPreference) {
        dispatch({ type: 'set/undo', payload: { slotId, setIndex, unitPreference } });
      },
      addSet(slotId) {
        dispatch({ type: 'exercise/addSet', payload: { slotId } });
      },
      logWarmup(slotId, loadKg, reps) {
        dispatch({ type: 'exercise/logWarmup', payload: { slotId, loadKg, reps, completedAt: new Date().toISOString() } });
      },
      removeWarmup(slotId, index) {
        dispatch({ type: 'exercise/removeWarmup', payload: { slotId, index } });
      },
      recordLoggedWorkout(input) {
        dispatch({ type: 'history/recordLogged', payload: input });
      },
      forgetHistorySession(sessionId) {
        dispatch({ type: 'history/forgetSession', payload: { sessionId } });
      },
      removeSet(slotId) {
        dispatch({ type: 'exercise/removeSet', payload: { slotId } });
      },
      setMinutesClock(clock) {
        dispatch({ type: 'session/setMinutesClock', payload: { clock, nowMs: Date.now() } });
      },
      skipExercise(slotId, reason) {
        dispatch({ type: 'exercise/skip', payload: { slotId, reason } });
      },
      swapExercise(slotId, exerciseName, substitutionGroup, unitPreference) {
        dispatch({ type: 'exercise/swap', payload: { slotId, exerciseName, substitutionGroup, unitPreference } });
      },
      updateNotes(slotId, notes) {
        dispatch({ type: 'exercise/updateNotes', payload: { slotId, notes } });
      },
      setGuidedStep(stepIndex, anchor) {
        dispatch({ type: 'session/setGuidedStep', payload: { stepIndex, anchor, nowMs: Date.now() } });
      },
      activeCardio: state.activeCardio,
      freestyleDraft: state.freestyleDraft,
      saveFreestyleDraft(snapshot) {
        dispatch({ type: 'freestyle/save', payload: { snapshot } });
      },
      clearFreestyleDraft() {
        dispatch({ type: 'freestyle/clear' });
      },
      startCardio(activityType) {
        // A run is a workout here as it is on the calendar, and it sent
        // neither end of one. Counted without saying which kind: the privacy
        // policy puts a `path` on setup events only, so which activity it was
        // stays on the phone (analytics audit, 2026-09-21).
        trackEvent('workout_started');
        dispatch({ type: 'cardio/start', payload: { activityType, nowMs: Date.now() } });
      },
      pauseCardio() {
        dispatch({ type: 'cardio/pause', payload: { nowMs: Date.now() } });
      },
      resumeCardio() {
        dispatch({ type: 'cardio/resume', payload: { nowMs: Date.now() } });
      },
      clearCardio() {
        dispatch({ type: 'cardio/clear' });
      },
      settleCardio(session, wasResumedAt) {
        dispatch({ type: 'cardio/settle', payload: { session, wasResumedAt } });
      },
      async restoreHistoryFromBackup(history) {
        // The live session, the run and the free workout are put away, all
        // three: the restore question counted them (hasWorkoutInProgress) and
        // the reader chose the backup.
        const bundle = normalizeWorkoutBundle({ activeSession: null, history, activeCardio: null, freestyleDraft: null });
        // Written first and shown after, so a refused write changes nothing
        // on screen and the caller can say so. The persistence effect writes
        // the same bundle again once the state lands; that is the same bytes.
        await saveWorkoutBundle(bundle);
        dispatch({ type: 'session/hydrate', payload: bundle });
        return bundle.history;
      },
      setAsideWorkoutAvailable,
      async restoreSetAsideWorkout() {
        const now = stateRef.current;
        if (isWorkoutInProgress(now.activeSession) || now.activeCardio || now.freestyleDraft) {
          return 'busy';
        }
        // What the app holds now (the history logged since, at least) goes aside in the copy's place.
        const live = JSON.stringify({
          activeSession: now.activeSession,
          history: now.history,
          activeCardio: now.activeCardio,
          freestyleDraft: now.freestyleDraft,
        });
        try {
          return await bringBackWorkoutAside(
            live,
            (text) => normalizeWorkoutBundle(JSON.parse(text)),
            async (bundle) => {
              // Written first and shown after, as restoreHistoryFromBackup: the persistence effect writes the
              // same bundle again once the state lands. Writes to the key run in order (largeItem), so a save
              // queued before this one cannot land after it.
              await saveWorkoutBundle(bundle);
              dispatch({ type: 'session/hydrate', payload: bundle });
            },
          );
        } finally {
          refreshSetAside();
        }
      },
    }),
    [completionSummary, setAsideWorkoutAvailable, state],
  );

  if (loadFailed) {
    return (
      <StorageLoadFailedScreen
        onRetry={() => {
          setLoadFailed(false);
          setLoadAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  return <WorkoutContext.Provider value={value}>{children}</WorkoutContext.Provider>;
}

export function useWorkoutContext() {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error('useWorkoutContext must be used inside WorkoutProvider');
  }
  return context;
}

export function useWorkoutTemplateCatalog() {
  return WORKOUT_TEMPLATES_V1;
}

export function useWorkoutTemplateSessions(templateId: string) {
  return getWorkoutTemplateSessions(templateId);
}
