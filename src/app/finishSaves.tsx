import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { trackEvent } from '../features/analytics/analyticsClient';
import { reportOperationFailed } from '../features/errorReporting/errorReporter';
import { adaptCompletedWorkoutSessionForAppDatabase } from '../features/workout/workoutAppAdapter';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import type { FreestyleFinishSummary } from '../lib/emptyWorkoutSession';
import { sessionRecordedWork } from '../lib/exerciseLog';
import { t } from '../lib/i18n';
import { createId } from '../lib/ids';
import { buildExercisePrLookupBefore } from '../lib/workoutCompletionSummary';
import { resolveGuidedSaveTarget } from '../lib/emptyWorkoutSession';
import { computePostSessionInsight } from '../lib/postSessionInsight';
import { buildMuscleFocus, getVolumeDeltaVsPrevious } from '../lib/workoutCompleteView';
import { ROOT_ROUTES } from '../navigation/routes';
import type { AppRoute } from '../navigation/routes';
import type { useAppContext } from '../state/AppProvider';
import type { SessionSaveSummary } from '../state/completedWorkoutPersistence';
import type { WorkoutTemplateDraft } from '../types/models';
import {
  buildCompletionCardsFromAdaptedSession,
  buildExerciseLogsForCompletedSession,
  buildSessionMovement,
  CompletionSummaryState,
} from './workoutCompletionState';
import type { FinishSaveState } from './useFinishState';

type AppContextValue = ReturnType<typeof useAppContext>;
type WorkoutContextValue = ReturnType<typeof useWorkoutContext>;

/**
 * The finish saves: the guided session's Finish and its discard, and the
 * logged (freestyle and editor) session's save. Each writes first and only
 * then shows the summary — CLAUDE.md's "a success state must follow the
 * resolved write".
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01),
 * each with its comments. A per-render factory, not a hook: it holds no state
 * and calls no hook (the refs it reads are VinhaApp's, from useFinishRefs).
 * VinhaApp calls it on every render where finishLoggedWorkoutSave stood, just
 * below the launch screen's early return, so each handler is still a fresh
 * closure over that render's values. handleDiscardWorkout and
 * handleConfirmFinishWorkout were function declarations further up; they come
 * down to this call because handleConfirmFinishWorkout reads exercisePrLookup,
 * which VinhaApp declares after their old place. Nothing in App.tsx above the
 * call names either: their one use is the workout tab's render, below it.
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx and
 * src/features/workout/WorkoutProvider.tsx; no .ts module imports this file.
 */
export interface FinishSavesDeps {
  workout: Pick<
    WorkoutContextValue,
    'activeSession' | 'discardWorkout' | 'adoptSessionId' | 'finishWorkout' | 'clearCompletedWorkout' | 'recordLoggedWorkout'
  >;
  database: AppContextValue['database'];
  /** The database as it stands now (AppProvider's ref), not the render's snapshot. */
  getDatabase: () => AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  unitPreference: AppContextValue['unitPreference'];
  exerciseLibrary: AppContextValue['exerciseLibrary'];
  updatePreferences: AppContextValue['updatePreferences'];
  saveCompletedWorkoutSession: AppContextValue['saveCompletedWorkoutSession'];
  upsertWorkoutTemplate: AppContextValue['upsertWorkoutTemplate'];
  deleteWorkoutTemplate: AppContextValue['deleteWorkoutTemplate'];
  /** From useCustomProgramViews: each lift's best so far, for the summary's record cards. */
  exercisePrLookup: Parameters<typeof buildCompletionCardsFromAdaptedSession>[0]['exercisePrLookup'];
  setCompletionSummary: Dispatch<SetStateAction<CompletionSummaryState | null>>;
  setFinishSaveState: Dispatch<SetStateAction<FinishSaveState>>;
  finishInFlightRef: MutableRefObject<boolean>;
  completionCountedRef: MutableRefObject<Set<string>>;
  summaryNavigationPendingRef: MutableRefObject<boolean>;
  summaryExitRouteRef: MutableRefObject<AppRoute | null>;
  /** VinhaApp's hoisted helpers. */
  getWorkoutLoggerFallbackRoute: () => AppRoute;
  navigateBack: (fallback?: AppRoute | null) => void;
  replaceRoute: (nextRoute: AppRoute) => void;
  showToast: (message: string) => void;
}

export function createFinishSaves(deps: FinishSavesDeps) {
  const {
    workout,
    database,
    getDatabase,
    preferences,
    unitPreference,
    exerciseLibrary,
    updatePreferences,
    saveCompletedWorkoutSession,
    upsertWorkoutTemplate,
    deleteWorkoutTemplate,
    exercisePrLookup,
    setCompletionSummary,
    setFinishSaveState,
    finishInFlightRef,
    completionCountedRef,
    summaryNavigationPendingRef,
    summaryExitRouteRef,
    getWorkoutLoggerFallbackRoute,
    navigateBack,
    replaceRoute,
    showToast,
  } = deps;

  /**
   * One count per saved session, whichever finish saved it.
   *
   * The guided finish deduplicated through this ref and the logged finish
   * counted every resolved save on its own terms (#bugs 2026-10-01, phase C):
   * equal today only because the logged path mints a fresh id per save. One
   * rule for both, keyed on the session the save produced.
   */
  function countWorkoutCompleted(sessionId: string) {
    if (completionCountedRef.current.has(sessionId)) {
      return;
    }
    completionCountedRef.current.add(sessionId);
    trackEvent('workout_completed');
  }

  async function handleDiscardWorkout() {
    if (!workout.activeSession) {
      return;
    }

    const fallbackRoute = getWorkoutLoggerFallbackRoute();
    // The reader's choice is what this does, and a preference is not allowed to refuse it: a
    // refused write (a full disk) threw here before the discard, so Discard did nothing, and
    // Finish over a session with nothing lifted, which ends here, left a blank Finish screen
    // (bug hunt 2026-10-03). Logged and let go, as the post-save write is.
    try {
      await updatePreferences({ trainingFirstRunDismissed: true });
    } catch (preferencesError) {
      console.error('Failed to record the first-run dismissal', preferencesError);
    }
    workout.discardWorkout();
    setFinishSaveState({ status: 'idle', sessionId: null });
    navigateBack(fallbackRoute);
  }

  async function handleConfirmFinishWorkout() {
    const activeSession = workout.activeSession;
    // A ref, not `finishSaveState`: two taps inside one render both read the
    // state as idle, and each went on to save and finish.
    if (!activeSession || finishInFlightRef.current) {
      return;
    }

    const adaptedFromSession = adaptCompletedWorkoutSessionForAppDatabase(activeSession);
    // Nothing lifted is nothing to keep, even when skips, a swap or a note
    // left logs behind (#bugs 2026-10-01).
    if (!sessionRecordedWork(adaptedFromSession.logs)) {
      await handleDiscardWorkout();
      return;
    }
    // A session whose save landed and whose clear was lost comes back active on the next launch
    // (the bundle write behind the finish is not awaited), and the reader can add sets to it and
    // Finish again. The database refuses a second row under the same id and says nothing, so those
    // sets were shown as saved and never written (bug hunt 2026-10-03). It is the same workout, so
    // it is merged with the stored one under the same id (resolveGuidedSaveTarget): no stored set
    // lost, none counted twice, and nothing to write when the merge is what is stored. (It used to be
    // saved under an id of its own beside the stored one whenever it lacked a stored set, and every
    // set the two shared counted twice.) Read from the database as it stands now, not this render's
    // snapshot.
    const saveTarget = resolveGuidedSaveTarget(getDatabase(), adaptedFromSession.sessionId);
    let adaptedSession = adaptedFromSession;
    // A merge keeps the stored row's name (a rename made since is the reader's), so the summary
    // names the workout the way History will: when the write did merge, and not when it filed the
    // sets under an id of its own (below).
    const keptName = saveTarget.mergeStored
      ? getDatabase().workoutSessions.find((row) => row.id === adaptedSession.sessionId)?.workoutNameSnapshot
      : undefined;
    const keptNameId = adaptedSession.sessionId;

    finishInFlightRef.current = true;
    setFinishSaveState({
      status: 'saving',
      sessionId: adaptedSession.sessionId,
    });

    // Set once the save has resolved: from then on the workout is in the database, and
    // nothing that goes wrong after it may say it was not.
    let saved = false;
    try {
      const summary = await saveCompletedWorkoutSession({
        ...adaptedSession,
        performedAt: adaptedSession.performedAt,
        mergeStored: saveTarget.mergeStored,
      });
      if (!summary.sessionId || !summary.performedAt) {
        throw new Error('Workout save did not produce a valid summary');
      }
      // Counted at its first save only: a workout the write found already stored (a finish that landed
      // and whose clear was lost, one finished further, or the same sets found under the id it walked
      // to) was counted when it first landed. The write says which, since it read the database it wrote.
      const alreadyCounted = summary.wasStored === true;
      // The write read the database itself and may have filed these sets under another id than the
      // decision did (the stored workout changed in between): the session takes that id before
      // anything below stamps the history or opens the summary.
      if (summary.sessionId !== adaptedSession.sessionId) {
        workout.adoptSessionId(summary.sessionId);
        adaptedSession = { ...adaptedSession, sessionId: summary.sessionId };
        setFinishSaveState({ status: 'saving', sessionId: summary.sessionId });
      }
      const shownName = keptName !== undefined && summary.sessionId === keptNameId ? keptName : adaptedSession.workoutNameSnapshot;
      // Once per session. A write after this one can fail — the preferences
      // below — and the retry saves again, which hands back the session
      // already stored: counted on every pass, one workout was two
      // (analytics audit, 2026-09-21).
      saved = true;
      if (!alreadyCounted) {
        countWorkoutCompleted(adaptedSession.sessionId);
      }

      // Only after the database save is verified: finishing flips the session
      // to 'completed' and stamps slot history. Doing it before the save meant
      // a failed save stranded the session in a state resume would not pick up
      // — the logged sets were gone on the next launch (launch-scope Risk 1).
      workout.finishWorkout(adaptedSession.performedAt);

      const sessionExerciseLogs = buildExerciseLogsForCompletedSession(adaptedSession.sessionId, adaptedSession.logs);
      // What came before this workout is not this workout. A restored session finished again has its
      // earlier version stored under the same id, in the snapshot this closure holds, and compared
      // against it the finish was its own previous best and its own prior session. Left out by id,
      // the record cards included (their lookup is rebuilt without it).
      const holdsOwnEarlierVersion = database.workoutSessions.some((row) => row.id === adaptedSession.sessionId);
      const priorSessions = holdsOwnEarlierVersion
        ? database.workoutSessions.filter((row) => row.id !== adaptedSession.sessionId)
        : database.workoutSessions;
      const priorExerciseLogs = holdsOwnEarlierVersion
        ? database.exerciseLogs.filter((log) => log.sessionId !== adaptedSession.sessionId)
        : database.exerciseLogs;
      const priorPrLookup = buildExercisePrLookupBefore(database, adaptedSession.sessionId, exercisePrLookup);
      const insight = computePostSessionInsight(
        {
          completedSession: {
            id: adaptedSession.sessionId,
            performedAt: summary.performedAt,
            totalVolumeKg: summary.totalVolume,
            setsCompleted: summary.setsCompleted,
          },
          sessionExerciseLogs,
          allPriorSessions: priorSessions,
          allPriorExerciseLogs: priorExerciseLogs,
          lastInsightSessionId: preferences.lastInsightSessionId,
          lastInsightType: preferences.lastInsightType,
          unitPreference,
        },
        new Date(summary.performedAt),
      );

      const completionCards = buildCompletionCardsFromAdaptedSession({
        exercises: adaptedSession.exercises,
        exerciseTemplates: database.exerciseTemplates,
        exerciseLibrary,
        exercisePrLookup: priorPrLookup,
        language: preferences.appLanguage,
      });
      setCompletionSummary({
        sessionId: adaptedSession.sessionId,
        workoutName: shownName,
        performedAt: summary.performedAt,
        durationMinutes: summary.durationMinutes,
        setsCompleted: summary.setsCompleted,
        totalVolume: summary.totalVolume,
        // The tile counts lifts that were done: the save's own count, by the
        // rule History reads the same logs with (lib/sessionTotals), so this
        // tile and the session's History row cannot disagree. The cards below
        // agree too — a card with a completed set is a log the rule counts —
        // except after a merge that kept stored sets this session never knew
        // of (mergeStoredWorkoutLogs): the tiles count those, the cards are
        // this session's.
        // Not summary.exercisesLogged, which is every persisted entry, skipped
        // included: "6 LIIKETTÄ" above five rows of "0 sarjaa" was that number.
        exercisesLogged: summary.exercisesCompleted,
        volumeDeltaKg: getVolumeDeltaVsPrevious(
          {
            sessionId: adaptedSession.sessionId,
            workoutName: shownName,
            performedAt: summary.performedAt,
            totalVolumeKg: summary.totalVolume,
          },
          priorSessions,
        ),
        muscles: buildMuscleFocus(adaptedSession.exercises, exerciseLibrary),
        exerciseCards: completionCards.exerciseCards,
        prCards: completionCards.prCards,
        // Read from the persisted logs. The builder excludes this session by
        // id, so "last time" cannot mean today whether or not the save has
        // already landed in the snapshot this closure holds.
        ...buildSessionMovement({
          exercises: adaptedSession.exercises,
          exerciseLogs: database.exerciseLogs,
          workoutSessions: database.workoutSessions,
          sessionId: adaptedSession.sessionId,
          language: preferences.appLanguage,
          unitPreference,
        }),
        insight,
      });
      summaryNavigationPendingRef.current = true;
      // Finish on the completion screen returns Home. Set the exit route so the
      // summary-dismiss effect can't race onDone's navigation to WORKOUT_PLAN_ROUTE.
      summaryExitRouteRef.current = ROOT_ROUTES.home;
      workout.clearCompletedWorkout();
      replaceRoute({ tab: 'workout', screen: 'summary' });
      setFinishSaveState({ status: 'idle', sessionId: null });
      // Last, and not allowed to undo anything above. It sat between the save and the
      // clear: a refused write there toasted "save failed" over a saved workout and left
      // the finished session held, so the next Start opened it instead of starting.
      try {
        await updatePreferences({
          trainingFirstRunDismissed: true,
          ...(insight
            ? {
                lastInsightSessionId: adaptedSession.sessionId,
                lastInsightType: insight.type,
              }
            : {}),
        });
      } catch (preferencesError) {
        console.error('Failed to record the post-session preferences', preferencesError);
      }
    } catch (error) {
      console.error('Failed to save completed workout', error);
      if (saved) {
        // The workout is saved; only what came after failed. Let go of the finished
        // session and leave quietly, rather than claim the save did not happen.
        workout.clearCompletedWorkout();
        setFinishSaveState({ status: 'idle', sessionId: null });
        navigateBack(getWorkoutLoggerFallbackRoute());
        return;
      }
      // Only the save that did not land: after it, what failed was not the save.
      reportOperationFailed('workout_save', error);
      setFinishSaveState({
        status: 'error',
        sessionId: adaptedSession.sessionId,
      });
      showToast(t(preferences.appLanguage, 'toast.saveWorkoutFailed'));
    } finally {
      finishInFlightRef.current = false;
    }
  }

  // The free workout's finish: template first, then the completed session,
  // and only then the summary screen — a failed save must leave the board
  // open with its sets intact.
  const finishLoggedWorkoutSave = async (
    draft: WorkoutTemplateDraft,
    summary: FreestyleFinishSummary,
    adoptSessionId?: (sessionId: string) => void,
  ) => {
    const sessionId = summary.sessionId ?? createId('session');
    // A board whose own earlier save holds its id is that workout carried on: a draft that reached
    // the board before the database had loaded, or one written after its save (discardSavedFreestyleDraft
    // lets only those through). It is merged into that save under the same id, by place
    // (mergeStoredBoardLogs), and keeps the template the save hangs on. It used to be saved beside it
    // under `<id>_b`, every set the two shared counted twice (bug hunt 2026-10-03). Read from the
    // database as it stands now.
    const storedRow = summary.sessionId ? getDatabase().workoutSessions.find((row) => row.id === sessionId) : undefined;
    // The id the sets are stored under, which the write may have walked on from the one asked for.
    let landedAs = sessionId;
    // Counted at its first save only: a merge, or the same finish found already stored, was counted
    // when it first landed.
    let firstSave = true;
    // What the stored row says, for the summary screen: after a merge it holds stored sets the board no
    // longer shows, and the tiles say what History will (the guided finish reads its tiles the same way).
    let saved: SessionSaveSummary | null = null;
    if (storedRow) {
      const landed = await saveCompletedWorkoutSession({
        sessionId,
        workoutTemplateId: storedRow.workoutTemplateId,
        workoutNameSnapshot: summary.workoutName,
        logs: summary.logs,
        startedAt: summary.startedAt,
        performedAt: summary.performedAt,
        mergeStored: true,
        mergeBy: 'place',
      });
      landedAs = landed.sessionId ?? sessionId;
      firstSave = landed.wasStored !== true;
      saved = landed;
    } else {
      const workoutTemplateId = await upsertWorkoutTemplate(draft);
      try {
        const landed = await saveCompletedWorkoutSession({
          sessionId,
          workoutTemplateId,
          workoutNameSnapshot: summary.workoutName,
          logs: summary.logs,
          startedAt: summary.startedAt,
          performedAt: summary.performedAt,
        });
        landedAs = landed.sessionId ?? sessionId;
        firstSave = landed.wasStored !== true;
        saved = landed;
        if (!firstSave) {
          // Found already stored (a save that appeared between the read above and the write): the
          // template made for it holds nothing.
          await deleteWorkoutTemplate(workoutTemplateId).catch(() => undefined);
        }
      } catch (error) {
        // The template is written first so the session can name it. A session
        // that did not land must not leave the template behind — the retry made
        // a second one (audit round 4, 2026-09-20). Best effort: the failure
        // the reader hears about is the save.
        reportOperationFailed('workout_save', error);
        await deleteWorkoutTemplate(workoutTemplateId).catch(() => undefined);
        throw error;
      }
    }
    if (summary.sessionId && landedAs !== summary.sessionId) {
      // The write filed the sets under another id: the board takes it, so a kill before the summary
      // leaves a board that names the saved workout.
      adoptSessionId?.(landedAs);
    }
    // The sets are on disk. Nothing after this may throw back to the board: it would say the save
    // failed over a saved workout and leave the board up to be finished, and saved, again.
    try {
      if (firstSave) {
        countWorkoutCompleted(landedAs);
      }
      /**
       * Remembered for the next time these lifts come up.
       *
       * The weight a set opens on is read from the workout provider's slot
       * history, and the only thing that ever wrote to it was the guided
       * player's own finish — so a lift done here left no trace, and opened at
       * nothing next time even though the numbers had just been written to the
       * database ("paino automaattisesti siihen mitä on viimeksi tehnyt", #bugs
       * 2026-08-27). Only completed sets with both numbers: a row that was put
       * on the board and not done is not a weight.
       */
      workout.recordLoggedWorkout({
        performedAt: summary.performedAt,
        sessionId: landedAs,
        templateName: summary.workoutName,
        exercises: summary.logs.map((log) => ({
          exerciseName: log.exerciseNameSnapshot,
          // The work only: these become the sets the next session opens on and
          // progression reads, and a warm-up is neither.
          sets: log.sets
            .filter((set) => set.outcome === 'completed' && set.reps > 0 && set.kind !== 'warmup')
            .map((set, setIndex) => ({
              setIndex,
              loadKg: set.weight,
              reps: set.reps,
              completedAt: set.completedAt ?? summary.performedAt,
            })),
        })),
      });
      setCompletionSummary({
        ...summary,
        sessionId: landedAs,
        // A merge keeps the stored row's name (a rename made since is the reader's).
        workoutName: storedRow?.workoutNameSnapshot ?? summary.workoutName,
        ...(saved
          ? { setsCompleted: saved.setsCompleted, totalVolume: saved.totalVolume, exercisesLogged: saved.exercisesCompleted }
          : {}),
        // Freestyle sessions have no plan identity: no previous-session
        // comparison, and muscle focus comes from the logged drafts.
        volumeDeltaKg: null,
        muscles: buildMuscleFocus(
          summary.logs.map((log) => ({
            exerciseName: log.exerciseNameSnapshot,
            sets: log.sets.filter((set) => set.kind !== 'warmup').map((set) => ({
              status: set.outcome === 'completed' ? ('completed' as const) : ('skipped' as const),
              weightKg: set.weight,
              reps: set.reps,
            })),
          })),
          exerciseLibrary,
        ),
        // A freestyle session has no plan identity, and the comparison this
        // screen makes is "against the last time you trained this lift" — a
        // claim the empty-workout flow does not gather the history for.
        whatMoved: [],
        movementById: {},
        insight: null,
      });
      summaryExitRouteRef.current = ROOT_ROUTES.home;
      replaceRoute({ tab: 'workout', screen: 'summary' });
    } catch (error) {
      console.error('Failed after the free workout was saved', error);
      navigateBack(getWorkoutLoggerFallbackRoute());
    }
  };

  return { handleDiscardWorkout, handleConfirmFinishWorkout, finishLoggedWorkoutSave };
}
