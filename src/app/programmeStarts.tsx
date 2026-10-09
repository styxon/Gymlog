import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';
import { trackEvent } from '../features/analytics/analyticsClient';
import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { evaluateProgramAdoption } from '../lib/activeProgramSet';
import { joinedRunningSet } from '../lib/analyticsMoments';
import { getCanonicalCompletedSessions } from '../lib/completedSessions';
import { t } from '../lib/i18n';
import { resolveNextPlanEntryIndex } from '../lib/planRotation';
import { resolveProEntitlement, resolveProgressionOptions } from '../lib/proEntitlement';
import { buildReadySessionRuntimeTemplate } from '../lib/programDetails';
import { alignHistoryToCopiedDays, programmeHistoryIds } from '../lib/programLineage';
import { isLightenPending, lightenedFatigueSignal, lightenRuntimeTemplate } from '../lib/recoverySheet';
import { resumeProgramme } from '../lib/runningProgrammes';
import {
  type AdaptedSessionRef,
  applySessionAdaptation,
  sessionHasNoExercises,
  type HeldSessionAdaptations,
  type SessionAdaptation,
  spendHeldAdaptation,
} from '../lib/sessionAdaptation';
import { localizeSessionName } from '../lib/sessionNameLabel';
import type { AppRoute } from '../navigation/routes';
import type { useAppContext } from '../state/AppProvider';
import { UnitPreference } from '../types/models';
import type { useProInsights } from './useProInsights';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * Programme starts and the helpers they lean on: deleting a saved workout and
 * dismissing a tip, opening a programme's page as what it is, the cardio
 * guard and the one door both programme starts go through, the completed
 * sessions a programme's week turns on, and putting a held programme back
 * into the running set.
 *
 * Moved verbatim from VinhaApp in App.tsx in phase C of the split
 * (2026-10-01), each function with its doc. A per-render factory, not a hook:
 * it holds no state and calls no hook. VinhaApp calls it on every render,
 * exactly where the first declaration stood (after handleConfirmFinishWorkout),
 * so each function is still a fresh closure over that render's values, as the
 * declarations were. Every use of what it returns in App.tsx sits below the
 * call, or inside a function that runs only on a press or in an effect (the
 * adoptions, which stay in App.tsx, call resumeHeldProgramme). What stayed in
 * App.tsx: the two docs of handleAdoptReadyProgram that stood above
 * resumeHeldProgramme's own, which stay above handleAdoptReadyProgram.
 *
 * .tsx only because the context types come from src/state/AppProvider.tsx and
 * src/features/workout/WorkoutProvider.tsx; no .ts module imports this file,
 * and the test build does not compile it.
 */
export interface ProgrammeStartsDeps {
  database: AppContextValue['database'];
  preferences: AppContextValue['preferences'];
  unitPreference: AppContextValue['unitPreference'];
  workoutTemplates: AppContextValue['workoutTemplates'];
  getWorkoutTemplateSessions: AppContextValue['getWorkoutTemplateSessions'];
  updatePreferences: AppContextValue['updatePreferences'];
  deleteCompletedWorkoutSession: AppContextValue['deleteCompletedWorkoutSession'];
  workout: ReturnType<typeof useWorkoutContext>;
  progressionFatigueSignal: ReturnType<typeof useProInsights>['progressionFatigueSignal'];
  /** VinhaApp's reader of what is held for a session today. */
  sessionAdaptationFor: (ref: AdaptedSessionRef | null | undefined) => SessionAdaptation;
  setHeldSessionAdaptations: Dispatch<SetStateAction<HeldSessionAdaptations>>;
  /** Opens the running-programmes limit sheet. */
  setRunningCapSheet: Dispatch<SetStateAction<{ visible: boolean; used: number; cap: number }>>;
  /** VinhaApp's hoisted navigate. */
  navigate: (nextRoute: AppRoute) => void;
  /** VinhaApp's hoisted navigateToGuidedWorkout. */
  navigateToGuidedWorkout: (workoutTemplateId: string, options?: { resume?: boolean }) => void;
  /** VinhaApp's hoisted navigateToActiveWorkout. */
  navigateToActiveWorkout: (options?: { message?: string; resume?: boolean }) => boolean;
  /** VinhaApp's hoisted isActiveSessionFor. */
  isActiveSessionFor: (workoutTemplateId: string, sessionId: string) => boolean;
  /** VinhaApp's hoisted showToast. */
  showToast: (message: string) => void;
}

export function createProgrammeStarts(deps: ProgrammeStartsDeps) {
  const {
    database,
    preferences,
    unitPreference,
    workoutTemplates,
    getWorkoutTemplateSessions,
    updatePreferences,
    deleteCompletedWorkoutSession,
    workout,
    progressionFatigueSignal,
    sessionAdaptationFor,
    setHeldSessionAdaptations,
    setRunningCapSheet,
    navigate,
    navigateToGuidedWorkout,
    navigateToActiveWorkout,
    isActiveSessionFor,
    showToast,
  } = deps;

  /**
   * Deleting a saved workout takes it out of the next session's prefill and
   * "Last time" as well as the database — after the database delete has
   * landed, so a refused delete leaves both as they were.
   */
  async function handleDeleteCompletedSession(sessionId: string) {
    await deleteCompletedWorkoutSession(sessionId);
    workout.forgetHistorySession(sessionId);
  }

  async function handleDismissTip(tipId: string) {
    const dismissedTipIds = preferences.dismissedTipIds ?? [];
    if (dismissedTipIds.includes(tipId)) {
      return;
    }

    await updatePreferences({
      dismissedTipIds: [...dismissedTipIds, tipId],
    });
  }

  /**
   * The type is a fact about the id, not something the caller can know.
   *
   * This was `handleOpenProgramDetail`, which wrote `programType:
   * 'ready'` whatever it was handed. Home's "other programmes" list holds
   * whatever the reader adopted, their own programmes included, so tapping
   * your own programme sent the route guard looking for a catalog template
   * that was never there and left the reader on the programme list. Every
   * caller that has an id and no type comes here, and the type is resolved
   * the way Home resolves its own hero — the stored template first, so the
   * two cannot disagree about what an id is.
   */
  function resolveProgramTypeForTemplate(workoutTemplateId: string): 'ready' | 'custom' {
    return workoutTemplates.some((template) => template.id === workoutTemplateId) ? 'custom' : 'ready';
  }

  function handleOpenProgramDetail(workoutTemplateId: string) {
    navigate({
      tab: 'workout',
      screen: 'program',
      programType: resolveProgramTypeForTemplate(workoutTemplateId),
      workoutTemplateId,
    });
  }

  function handleOpenCustomProgramDetail(
    workoutTemplateId: string,
    programType: 'ready' | 'custom' = 'custom',
  ) {
    navigate({ tab: 'workout', screen: 'program', programType, workoutTemplateId });
  }

  // Cardio v1 conflict rule: never two live sessions, never a silent discard.
  // Mirrors the sheet the cardio list shows when a strength session is live.
  function guardStrengthStartOverCardio(proceed: () => void) {
    if (!workout.activeCardio) {
      proceed();
      return;
    }

    Alert.alert(
      t(preferences.appLanguage, 'confirm.cardioRunning.title'),
      t(preferences.appLanguage, 'confirm.cardioRunning.body'),
      [
        {
          text: t(preferences.appLanguage, 'confirm.cardioRunning.resume'),
          onPress: () => navigate({ tab: 'home', screen: 'cardio' }),
        },
        {
          text: t(preferences.appLanguage, 'confirm.cardioRunning.discard'),
          style: 'destructive',
          onPress: () => {
            workout.clearCardio();
            proceed();
          },
        },
        { text: t(preferences.appLanguage, 'common.cancel'), style: 'cancel' },
      ],
    );
  }

  function startReadyProgramSessionWithUnit(
    workoutTemplateId: string,
    sessionId: string,
    nextUnitPreference: UnitPreference,
  ) {
    const template = getWorkoutTemplateById(workoutTemplateId);
    if (!template) {
      return;
    }

    // Home's hero says "Jatka treeniä" and comes through here, so this IS the
    // resume path — but only when the running session is this one.
    if (navigateToActiveWorkout({ resume: isActiveSessionFor(workoutTemplateId, sessionId) })) {
      return;
    }

    // Only what was chosen for THIS session: a swap made on another day's
    // card shares slot ids with this one and is not an answer about it.
    const sessionRef = { programId: workoutTemplateId, sessionId };
    const runtimeTemplate = applySessionAdaptation(
      buildReadySessionRuntimeTemplate(template, sessionId),
      sessionAdaptationFor(sessionRef),
    );
    // Every row left out for today: nothing to train, and a start would open an
    // empty player and spend the lighter-session request on it.
    if (sessionHasNoExercises(runtimeTemplate)) {
      showToast(t(preferences.appLanguage, 'toast.everyLiftDropped'));
      return;
    }

    guardStrengthStartOverCardio(() => {
      // Training a session does not change which programme is active. It
      // used to — the lead followed whatever was trained — and a one-off
      // session from another programme quietly moved Home and the ACTIVE tag
      // off the one the reader had chosen. The Active switch is the one door
      // now, and it asks first (user 2026-09-21).
      void updatePreferences({ trainingFirstRunDismissed: true });
      startProgrammeWorkout(runtimeTemplate, nextUnitPreference);
      // Today's changes are spent the moment they are applied — an adaptation
      // is an answer about right now, and a stale one is worse than none.
      setHeldSessionAdaptations((held) => spendHeldAdaptation(held, sessionRef));
      navigateToGuidedWorkout(workoutTemplateId);
    });
  }

  /**
   * A programme session, started. The one door both programme starts use, so
   * "Kevennä seuraava treeni" from the recovery sheet reaches whichever comes
   * next: one set fewer on every lift that has one to spare, and loads held.
   * Spent here — the request is for the next session, not every session.
   */
  /**
   * The template and options a programme session starts with: the entitlement
   * resolved once, and a pending lighter session applied. Shared by the start
   * itself and by the coach's preview of the next session, so the example the
   * coach quotes is what the start will open on.
   */
  function programmeStart(runtimeTemplate: Parameters<typeof workout.startCustomWorkout>[0], now: Date = new Date()) {
    const lighten = isLightenPending(preferences.lightNextSession, now);
    return {
      template: lighten ? lightenRuntimeTemplate(runtimeTemplate) : runtimeTemplate,
      options: {
        ...resolveProgressionOptions(preferences),
        fatigueSignal: lighten ? lightenedFatigueSignal(progressionFatigueSignal) : progressionFatigueSignal,
      },
    };
  }

  function startProgrammeWorkout(
    runtimeTemplate: Parameters<typeof workout.startCustomWorkout>[0],
    unit: UnitPreference,
  ) {
    const start = programmeStart(runtimeTemplate);
    workout.startCustomWorkout(start.template, unit, start.options);
    if (preferences.lightNextSession) {
      // A refused write rolls the request back into place, and it would
      // lighten the session after this one too. Said, rather than left to
      // happen quietly (CI review of #188); the sheet can take it back.
      updatePreferences({ lightNextSession: null }).catch((error) => {
        console.error('Failed to spend the lighter-session request', error);
        showToast(t(preferences.appLanguage, 'recovery.toast.spendFailed'));
      });
    }
  }

  function handleStartReadyProgramSession(workoutTemplateId: string, sessionId: string) {
    startReadyProgramSessionWithUnit(workoutTemplateId, sessionId, unitPreference);
  }

  /**
   * The session a programme's own plan offers next.
   *
   * Home resolves this for the plan it leads with; a programme running
   * alongside has the same rotation and no one asking it. Same pure rule
   * either way, so the two cannot drift.
   */
  /**
   * Completed sessions, with a copied programme's history wearing the ids its
   * copy knows them by.
   *
   * Editing a lift in a ready programme hands the reader their own copy of it,
   * and the copy's days carry new ids. The rotation matches a plan entry
   * against a logged session by both ids, so the day after the copy was made
   * it found no match at all and offered day 1 to a reader who trained day 3
   * yesterday. A day is found by its name, which follows it when the reader
   * reorders the copy, and by position only where the name says nothing — a
   * day that cannot be told is not translated rather than guessed at (see
   * programLineage).
   */
  /**
   * The programmes some OTHER plan is running, so their work is that plan's.
   *
   * Read off the plan records rather than the active set: a plan the reader
   * holds but does not lead with is still the plan those sessions belong to.
   */
  function templatesRunByOtherPlans(workoutTemplateId: string | null | undefined): string[] {
    return database.workoutPlans
      .map((plan) => plan.entries[0]?.workoutTemplateId)
      .filter((id): id is string => Boolean(id) && id !== workoutTemplateId);
  }

  function completedSessionsForTemplate(
    workoutTemplateId: string | null | undefined,
    // The canonical list walks every logged session, so a caller that has
    // already built it hands it over rather than paying for it twice.
    completed?: readonly ReturnType<typeof getCanonicalCompletedSessions>[number][],
  ) {
    const sessions = completed ?? getCanonicalCompletedSessions(database);
    const copy = workoutTemplateId
      ? database.workoutTemplates.find((template) => template.id === workoutTemplateId) ?? null
      : null;
    const source = copy?.sourceTemplateId ? getWorkoutTemplateById(copy.sourceTemplateId) : null;
    if (!copy || !source) {
      return sessions;
    }
    const copiedDays = getWorkoutTemplateSessions(copy.id);
    return alignHistoryToCopiedDays(sessions, {
      fromTemplateIds: programmeHistoryIds(copy.id, database.workoutTemplates, templatesRunByOtherPlans(copy.id)),
      fromSessionIds: source.sessions.map((session) => session.id),
      // The copy stores its day names translated, in whichever language the
      // app was in when it was made.
      fromSessionNames: source.sessions.map((session) => [
        session.name,
        localizeSessionName(session.name, 'fi'),
        localizeSessionName(session.name, 'en'),
      ]),
      toTemplateId: copy.id,
      toSessionIds: copiedDays.map((session) => session.id),
      toSessionNames: copiedDays.map((session) => session.name),
    });
  }

  function resolveNextSessionIdForTemplate(workoutTemplateId: string): string | null {
    const plan = database.workoutPlans.find(
      (item) => item.entries[0]?.workoutTemplateId === workoutTemplateId,
    );
    if (!plan || plan.entries.length === 0) {
      return null;
    }
    const ordered = [...plan.entries].sort((left, right) => left.orderIndex - right.orderIndex);
    const index = resolveNextPlanEntryIndex(ordered, completedSessionsForTemplate(workoutTemplateId));
    return ordered[index]?.workoutTemplateSessionId ?? ordered[0]?.workoutTemplateSessionId ?? null;
  }

  /**
   * Put a programme the reader already holds back into the running set.
   *
   * Held is not gone: the plan record is still there with its block, its
   * week and its rotation, and switching a programme on has always resumed
   * it rather than rebuilding it. Adoption arrives at the same programmes by
   * other doors — the goal flow, a completion card, a catalog page whose
   * programme the reader has a copy of — and each of them used to build a
   * plan over the top instead, which is week 5 of 24 coming back as week 1.
   *
   * Answers true when the programme is running again, false when the cap
   * refused it, and null when there is no plan to resume — the caller then
   * builds one.
   */
  async function resumeHeldProgramme(
    templateId: string,
    options?: { lead?: boolean },
  ): Promise<boolean | null> {
    const resumed = resumeProgramme({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      templateId,
    });
    if (!resumed) {
      return null;
    }
    const decision = evaluateProgramAdoption({
      activePlanIds: preferences.activePlanIds,
      targetPlanId: resumed.planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });
    if (decision.kind === 'blocked') {
      if (decision.canUpgrade) {
        setRunningCapSheet({ visible: true, used: decision.used, cap: decision.cap });
        return false;
      }
      showToast(t(preferences.appLanguage, 'programs.cap.full', { cap: decision.cap }));
      return false;
    }
    await updatePreferences({
      activePlanIds: resumed.activePlanIds,
      // resumeProgramme names the resumed plan as activePlanId whichever way,
      // so the lead is kept here: joining a season must not quietly demote the
      // programme at the top of Home.
      activePlanId: options?.lead ? resumed.planId : preferences.activePlanId ?? resumed.planId,
    });
    // Counted here, after the write, for every door that resumes through
    // this — and only when the plan was not already running (analytics
    // audit, 2026-09-21).
    if (joinedRunningSet(preferences.activePlanIds, resumed.activePlanIds)) {
      trackEvent('plan_adopted');
    }
    return true;
  }

  return {
    handleDeleteCompletedSession,
    handleDismissTip,
    handleOpenProgramDetail,
    handleOpenCustomProgramDetail,
    guardStrengthStartOverCardio,
    programmeStart,
    startProgrammeWorkout,
    handleStartReadyProgramSession,
    templatesRunByOtherPlans,
    completedSessionsForTemplate,
    resolveNextSessionIdForTemplate,
    resumeHeldProgramme,
  };
}
