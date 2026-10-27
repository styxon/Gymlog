import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';

import { AppShell } from './src/components/AppShell';
import { discardSavedFreestyleDraft } from './src/lib/emptyWorkoutSession';
import { leadPlanTrainingCycle } from './src/lib/planTrainingCycle';
import { programmeStartSessionId } from './src/lib/programSessionList';
import { HistoryScrollMemory } from './src/lib/historyScrollMemory';
import { formatWorkoutDisplayLabel } from './src/lib/displayLabel';
import { haptics } from './src/utils/haptics';
import { reportPlanSaveFailed } from './src/app/planSaveFailure';
import { useScheduledNotifications } from './src/hooks/useScheduledNotifications';
import { activeWorkoutStartedAt } from './src/lib/notificationPlan';
import { usePendingAiLogDeletions } from './src/hooks/usePendingAiLogDeletions';
import { ThemeProvider, themeForName } from './src/theming';
import {
  isHomeWidgetAdded,
  isHomeWidgetSupported,
  refreshHomeWidget,
  requestPinHomeWidget,
} from './modules/home-widget';
import { useShellSheets } from './src/app/useShellSheets';
import { useTourState } from './src/app/useTourState';
import { useAccountBackup } from './src/features/account/useAccountBackup';
import { useReviewProAccount } from './src/app/useReviewProAccount';
import { hasWorkoutInProgress } from './src/lib/accountBackup';
import { useAccountOutcome } from './src/app/useAccountOutcome';
import {
  addActiveProgram,
  evaluateProgramAdoption,
} from './src/lib/activeProgramSet';
import {
  programCapFullMessage,
  runningCapRefusal,
  runningCapRefusalMessage,
} from './src/lib/programCapNotice';
import { runningSetWithout, type AdoptReadyOptions } from './src/lib/runningProgrammes';
import {
  buildReadyProgramPlanId,
  buildCustomProgramPlanId,
  buildProgramWorkoutPlan,
} from './src/lib/programAdoption';
import { useRecordsAndMilestones } from './src/app/useRecordsAndMilestones';
import { useExerciseDetailHistory } from './src/app/useExerciseDetailHistory';
import { useHomeActiveWorkoutSummary } from './src/app/useHomeActiveWorkoutSummary';
import { useHeldSessionAdaptations } from './src/app/useHeldSessionAdaptations';
import { useOnboardingGate } from './src/app/useOnboardingGate';
import { useRunningProgrammeViews } from './src/app/useRunningProgrammeViews';
import { createActiveWorkoutDoor } from './src/app/activeWorkoutDoor';
import { t } from './src/lib/i18n';
import { resolveProEntitlement } from './src/lib/proEntitlement';
import { resolveThemeName } from './src/lib/themePreference';
import { trackEvent } from './src/features/analytics/analyticsClient';

import { CoachChatMemory } from './src/lib/coachChatMemory';
import { CoachAdviceMemoryEntry } from './src/lib/coachAdviceMemory';
import { clearCoachAdviceMemory } from './src/storage/coachAdviceMemoryStore';
import type { ChatMessage } from './src/screens/AICoachChatScreen';
import type { TemplateLeaveGuard } from './src/screens/CreateTemplateScreen';
import { useProgramExerciseEdit } from './src/app/useProgramExerciseEdit';
import { useRecoverySheet } from './src/app/useRecoverySheet';
import {
  planLabelsForProgramme,
} from './src/lib/trainingWeekSync';
import { findReadyProgrammeCopyId } from './src/lib/programmeCopyLink';
import { useGoalFlow } from './src/app/useGoalFlow';
import { SettingsImportSheet } from './src/app/SettingsImportSheet';
import { LEGAL_OVER_CONSENT, LEGAL_OVER_HANDOFF, WEEKDAY_LABEL_KEYS } from './src/app/appConstants';

import { buildCustomSessionRuntimeTemplate } from './src/lib/programDetails';
import {
  applySessionAdaptation,
  moveHeldAdaptations,
  NO_HELD_SESSION_ADAPTATIONS,
  sessionHasNoExercises,
  spendHeldAdaptation,
} from './src/lib/sessionAdaptation';
import { liveSessionBlocksProgrammeDelete } from './src/lib/programmeDeletion';
import { renderProfileTab } from './src/app/renderProfileTab';
import { renderHomeScreens } from './src/app/renderHomeScreens';
import { CoachQuotaLedger, createCoachQuotaLedger } from './src/lib/aiCoachQuota';
import { renderAppShell } from './src/app/renderAppShell';
import { renderHomeDashboard } from './src/app/renderHomeDashboard';
import { renderOnboardingFlow, renderSetupEditor, renderSetupHandoff } from './src/app/renderOnboarding';
import { renderWorkoutCompletion } from './src/app/renderWorkoutCompletion';
import { renderWorkoutTab } from './src/app/renderWorkoutTab';
import { renderProgressTab } from './src/app/renderProgressTab';
import { useSessionNotifications } from './src/app/useSessionNotifications';
import { useNotificationRoute } from './src/app/useNotificationRoute';
import { useCoachContext } from './src/app/useCoachContext';
import { createProgrammeDayEdits } from './src/app/programmeDayEdits';
import { createProgrammeStarts } from './src/app/programmeStarts';
import { createProgrammePlanEdits } from './src/app/programmePlanEdits';
import { createProgrammeSwitches } from './src/app/programmeSwitches';
import { useProgramCapLine } from './src/app/useProgramCapLine';
import { createOnboardingFinishes } from './src/app/onboardingFinishes';
import { useDeviceSwitches } from './src/app/useDeviceSwitches';
import { useStoreBillingSync } from './src/app/useStoreBillingSync';
import { useFunnelAnalytics } from './src/app/useFunnelAnalytics';
import { useAttemptOnce } from './src/app/useAttemptOnce';
import { useAppBoot, useSettleSavedCardio } from './src/app/useAppBoot';
import { useAppNavigation } from './src/app/useAppNavigation';
import { useToast } from './src/app/useToast';
import { useInstallStamps } from './src/app/useInstallStamps';
import { useSetupWeightSeed } from './src/app/useSetupWeightSeed';
import { useTodayKey } from './src/app/useTodayKey';
import { useFinishState } from './src/app/useFinishState';
import { useFinishRefs } from './src/app/useFinishRefs';
import { createFinishExits } from './src/app/finishExits';
import { useFinishRouteGuard } from './src/app/useFinishRouteGuard';
import { createFinishSaves } from './src/app/finishSaves';
import { useDaySummaries } from './src/app/useDaySummaries';
import { useCoachDemoMoment } from './src/app/useCoachDemoMoment';
import { useCoachEntryReadings } from './src/app/useCoachEntryReadings';
import { useRoutineBlockCosts } from './src/app/useRoutineBlockCosts';
import { useSetupReadings } from './src/app/useSetupReadings';
import { useLeadPlanRepair } from './src/app/useLeadPlanRepair';
import { useTemplateBuilderDraft } from './src/app/useTemplateBuilderDraft';
import { useProInsights } from './src/app/useProInsights';
import { createAdviceTemplateLookup } from './src/app/adviceTemplateLookup';
import { useHomeStatCards } from './src/app/useHomeStatCards';
import { useCoachAdviceMemory } from './src/app/useCoachAdviceMemory';
import { useCustomProgramViews } from './src/app/useCustomProgramViews';
import { useHandoffLegalHolders } from './src/app/useHandoffLegalHolders';
import { useRouteBack } from './src/app/useRouteBack';
import { useHomeWidgetPinState } from './src/app/useHomeWidgetPinState';
import { useSetupHandoffOverlays } from './src/app/useSetupHandoffOverlays';
import { createSetupHandoffDone } from './src/app/setupHandoffDone';
import { resolveShellChrome } from './src/lib/shellChrome';
import { useHomeWidgetFeed } from './src/app/useHomeWidgetFeed';
import { useWidgetTaps } from './src/app/useWidgetTaps';
import { useHomeActivePlan } from './src/app/useHomeActivePlan';
import { useHomeTrainingSchedule } from './src/app/useHomeTrainingSchedule';
import { usePlanReadouts } from './src/app/usePlanReadouts';
import { useRecentSessions } from './src/app/useRecentSessions';
import { useProgramsCatalog } from './src/app/useProgramsCatalog';
import { useProgramsCustomItems } from './src/app/useProgramsCustomItems';
import { LaunchScreen } from './src/screens/LaunchScreen';
import { setNumberLanguage } from './src/lib/format';
import { VinhaSplashScreen } from './src/screens/VinhaSplashScreen';
import { accountNameStep } from './src/lib/accountNameAdoption';
import { WorkoutProvider, useWorkoutContext } from './src/features/workout/WorkoutProvider';
import { getWorkoutTemplateById } from './src/features/workout/workoutCatalog';
import { AppProvider, useAppContext } from './src/state/AppProvider';
import { AppErrorBoundary } from './src/features/errorReporting/AppErrorBoundary';
import { WorkoutAreaBoundary } from './src/features/errorReporting/WorkoutAreaBoundary';
import { noteRenderedScreen } from './src/features/errorReporting/errorReporter';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Native splash may already be controlled by the host app during fast refresh.
});

/**
 * The native splash stays up at least this long, counted from when this
 * module ran rather than from VinhaApp's first commit. The splash has been on
 * screen since the process started, so the floor still holds, and the first
 * render (~300 ms on a mid-range phone) now runs inside it instead of being
 * added after it (startup trace, 2026-10-06). A monotonic clock, and a delay
 * clamped to the floor, so a wall-clock correction cannot hold the splash up.
 */
const MINIMUM_SPLASH_MS = 1200;
const splashFloorStartedAt = performance.now();

function VinhaApp() {
  const {
    database,
    hydrated,
    preferences,
    unitPreference,
    workoutTemplates,
    exerciseLibrary,
    workoutSessions,
    cardioSessions,
    trackedProgress,
    bodyweightProgress,
    measurementEntries,
    exerciseNameBook,
    teachExerciseName,
    getWorkoutExercises,
    getWorkoutTemplateSessions,
    getSessionLogs,
    updatePreferences,
    completeOnboarding,
    upsertWorkoutTemplate,
    renameWorkoutTemplate,
    editWorkoutTemplateSessions,
    findWorkoutTemplateIdBySource,
    getWorkoutTemplateSessionsFresh,
    programSlots,
    upsertWorkoutPlan,
    setPlanTrainingCycle,
    saveOnboardingResult,
    deleteWorkoutTemplate,
    forgetHeldProgramme,
    resetAllData,
    clearPendingAiLogDeletions,
    retireAiLogLabel,
    addBodyweightEntry,
    addMeasurementEntry,
    deleteBodyweightEntry,
    deleteMeasurementEntry,
    saveCompletedWorkoutSession,
    getDatabase,
    updateCompletedWorkoutSession,
    deleteCompletedWorkoutSession,
    deleteCardioSession,
    saveCardioSession,
    restoreDatabaseFromBackup,
    importWorkoutHistory,
  } = useAppContext();
  const workout = useWorkoutContext();
  // A draft whose workout is already saved is a lost clear's leftover, not a board to come back to: the
  // screen does not get it, and the restore question does not count it as a workout in progress (bug
  // hunt 2026-10-03: the provider holds it until the screen mounts and clears it).
  const freestyleDraft = discardSavedFreestyleDraft(workout.freestyleDraft, database);
  // For listeners that must not re-subscribe on every workout change: the
  // context is a new object once a second while a rest timer or cardio runs.
  // Coach questions in flight (a build, a photo read): one ledger for both, so
  // two requests started before either is paid for cannot both take the last.
  const coachQuotaLedgerRef = useRef<CoachQuotaLedger | null>(null);
  if (coachQuotaLedgerRef.current === null) {
    coachQuotaLedgerRef.current = createCoachQuotaLedger();
  }
  const coachQuotaLedger = coachQuotaLedgerRef.current;
  const workoutRef = useRef(workout);
  workoutRef.current = workout;
  // A boolean, so the back listener below can ask it without depending on the
  // whole context: this flips only when a run starts or goes away.
  const cardioRunActive = workout.activeCardio !== null;

  // Account & cloud backup: sign in with Google on the hand-off card or in
  // Settings, and the data survives a new phone. Free and Pro alike (decision
  // 2026-08-22). Absent entirely in builds without the OAuth client id.
  const accountBackup = useAccountBackup({
    // Both stores, not the database alone: the workout store can load later
    // (its Retry screen), and a backup before then uploads the empty history
    // it starts with over the real one. The same as appHydrated below.
    hydrated: hydrated && workout.hydrated,
    // Everything a restore puts away, the free workout's board included.
    liveSession: hasWorkoutInProgress({ ...workout, freestyleDraft }),
    database,
    workoutHistory: workout.history,
    restoreDatabase: restoreDatabaseFromBackup,
    restoreWorkoutHistory: workout.restoreHistoryFromBackup,
    // A landed restore replaces the database and the workout history — but
    // not the coach's own memory, which lives outside both (this component's
    // state, plus its own AsyncStorage key). Left alone, it would survive a
    // restore that just replaced everything else, another account's data
    // included. Same reasoning as handleResetAllData below, which clears it
    // for the reset path; not fired on "keep this phone's data" or a failed
    // restore, since useAccountBackup only calls this once both stores land.
    onRestored: async () => {
      setCoachAdviceMemory([]);
      setCoachChatMemory(null);
      // Today's held swaps and drops are one more thing outside both: catalogue
      // ids are the same on every phone, so the previous state's holds would
      // otherwise show on the restored account's Home (hunt 9, 2026-10-09).
      setHeldSessionAdaptations(NO_HELD_SESSION_ADAPTATIONS);
      // Awaited: useAccountBackup's applyRestore holds the restore open
      // until this settles, so a process kill cannot land the restore while
      // the erase is still on disk (recheck round, 2026-09-29).
      await clearCoachAdviceMemory();
    },
  });

  /**
   * Numbers follow the app language, not the device.
   *
   * Written during render, and placed above every hook that could format a
   * number — that ordering is the whole point.
   *
   * removeTrailingZeros reads a module setting rather than a parameter (see the
   * note in lib/format.ts), and much of the app's formatted text is produced by
   * useMemo blocks in this file. This used to be an effect, which runs *after*
   * render: on the render where the language changed, every one of those memos
   * recomputed while the setting still held the previous language's separator —
   * and then never recomputed again, because their dependency on appLanguage had
   * already fired. The setting was corrected a moment later with nothing left to
   * read it.
   *
   * It cost the Pro hero "92.5 kg" in front of a Finnish reader, and it needs two
   * languages to show up: the device supplies the first render's language and the
   * stored preference supplies the second. On a phone whose system language
   * matches the app, the separator is never wrong to begin with, which is why
   * five rounds on a Finnish phone never saw it and an en-US emulator did.
   *
   * The setter is idempotent, so running it every render — including StrictMode's
   * double invoke — costs one comparison and cannot be observed.
   */
  setNumberLanguage(preferences.appLanguage);

  // The programme builder's question before its draft is dropped. Set while
  // the builder is open; the tab bar and the AI button ask it first.
  const templateLeaveGuardRef = useRef<TemplateLeaveGuard | null>(null);
  const {
    route,
    navigationState,
    setNavigationState,
    workoutHomeRoute,
    navigate,
    navigateNow,
    replaceRoute,
    resetToRoute,
    navigateBack,
    resolveTabRoute,
    navigateToTab,
    leaveThroughScreenGuard,
    resetToRouteThroughGuard,
    leaveDeletedProgramme,
  } = useAppNavigation({ preferences, templateLeaveGuardRef });
  const { toastMessage, showToast } = useToast();
  // Where Settings was scrolled when a sub-screen opened; the screen
  // unmounts on navigation, so the position survives here.
  const settingsScrollOffsetRef = useRef(0);
  // Where History's list was scrolled before opening a session, and what
  // search/filter it was showing then. Browsing old workouts landed back at
  // the top of the list every time — the same row you had just opened, then
  // a re-scroll down past everything you had already seen (#bugs
  // 2026-09-29). Keyed by search/filter too: a bare offset restored onto a
  // list a tab switch had reset the search on landed the reader partway
  // down rows they had never scrolled past (recheck round 2026-09-29).
  const historyScrollOffsetRef = useRef<HistoryScrollMemory | null>(null);
  const {
    completionSummary,
    setCompletionSummary,
    ratingSheetVisible,
    setRatingSheetVisible,
    finishSaveState,
    setFinishSaveState,
  } = useFinishState();
  const [cardioSaving, setCardioSaving] = useState(false);
  // null = still asking Android, or the device cannot pin widgets at all.
  const [homeWidgetState, setHomeWidgetState] = useState<{ supported: boolean; added: boolean } | null>(
    null,
  );
  // The brand animation plays once per cold start, after the native splash has
  // handed over. It is skipped entirely until the app is ready, so it never
  // becomes the thing hiding a slow start.
  const [brandSplashDone, setBrandSplashDone] = useState(false);
  const {
    tourRegistry,
    tourSweep,
    setTourSweep,
    tourFocus,
    setTourFocus,
    workoutTourStep,
    setWorkoutTourStep,
  } = useTourState();

  useDeviceSwitches({ hydrated, preferences });

  // The store's word on Pro, in a release build: one read after load, then
  // whatever it pushes (renewal, a cancel made in Play, a refund).
  useStoreBillingSync({ hydrated, preferences, updatePreferences });

  // Play's review account gets Pro while it is signed in: the flag follows the
  // signed-in account (sign-in, sign-out, Delete account, a stale flag at start).
  useReviewProAccount({
    hydrated,
    account: accountBackup.state,
    stored: preferences.reviewProAccount,
    updatePreferences,
  });

  // Mirrors the notification preferences onto the OS clock: reminders, the
  // comeback nudge, the Sunday summary and the morning-after record note.
  // A workout under way retires today's training reminder: starting it re-plans.
  const activeWorkoutStartedAtMs = activeWorkoutStartedAt(
    workout.activeSession,
    workout.freestyleDraft?.startedAtMs,
  );
  useScheduledNotifications(database, hydrated, activeWorkoutStartedAtMs);

  const { navigateToActiveWorkoutRef, finishFromNotificationRef } = useSessionNotifications({
    workout,
    preferences,
    showToast,
    // appHydrated is declared further down; the same two flags.
    appHydrated: hydrated && workout.hydrated,
  });

  // Every seeded row is browsable now that the legacy `lib_*` tier is gone
  // (2026-09-01), so this no longer filters. The name stays: ten call sites
  // read it, and "the library the reader can open" is still what they mean.
  // What keeps it true is a guard on the seed, not a filter here — a filter
  // hides a bad row, and hiding is how the two sets drifted apart in the first
  // place.
  const exerciseBrowserItems = exerciseLibrary;
  const { summaryExitRouteRef, summaryNavigationPendingRef, finishInFlightRef, completionCountedRef } = useFinishRefs();
  const workoutLogNavigationAllowedAtRef = useRef<number | null>(null);
  const appHydrated = hydrated && workout.hydrated;
  // The coach-log deletes a reset could not confirm, retried on start and on
  // every return to the foreground; Reset uses the same runner for its own.
  const deletePendingAiLogs = usePendingAiLogDeletions({
    hydrated,
    pending: preferences.pendingAiLogDeletions,
    clear: clearPendingAiLogDeletions,
  });

  const { todayKey, todayStartMs } = useTodayKey();

  const tryOnce = useAttemptOnce();

  useInstallStamps({ appHydrated, preferences, updatePreferences });

  useSettleSavedCardio({
    hydrated,
    workoutHydrated: workout.hydrated,
    activeCardio: workout.activeCardio,
    cardioSessions,
    settleCardio: workout.settleCardio,
  });

  const { nativeSplashHidden } = useAppBoot({
    appHydrated,
    splashFloorStartedAt,
    minimumMs: MINIMUM_SPLASH_MS,
  });

  const { leaveFinishedWorkout, leaveFinishedScreen } = createFinishExits({
    preferences,
    database,
    updatePreferences,
    setCompletionSummary,
    setFinishSaveState,
    setNavigationState,
    setRatingSheetVisible,
  });

  const {
    navigateToActiveWorkoutThroughGuard,
    navigateToGuidedWorkout,
    navigateToActiveWorkout,
    isActiveSessionFor,
    getWorkoutLoggerFallbackRoute,
  } = createActiveWorkoutDoor({
    workout,
    preferences,
    navigate,
    showToast,
    leaveThroughScreenGuard,
    workoutLogNavigationAllowedAtRef,
  });

  useFinishRouteGuard({
    finishSaveState,
    setFinishSaveState,
    completionSummary,
    workout,
    route,
    replaceRoute,
    workoutHomeRoute,
    workoutLogNavigationAllowedAtRef,
    summaryNavigationPendingRef,
    summaryExitRouteRef,
    workoutTemplates,
    exerciseBrowserItems,
    trackedProgress,
    workoutSessions,
  });

  const {
    onboardingActive,
    entryFlowActive,
    onboardingStep,
    setOnboardingStep,
    busySavingReadyPick,
    setBusySavingReadyPick,
    aboutYouValues,
    setAboutYouValues,
    setFullBleedReview,
    fullBleedReview,
  } = useOnboardingGate(preferences, route);
  useFunnelAnalytics({ hydrated, onboardingActive, entryFlowActive, onboardingStep, route, navigationState, preferences });
  // Which screen an error report names. In the render body on purpose: an
  // error thrown while drawing this route must name this route.
  noteRenderedScreen(onboardingActive, route);
  const {
    handoffLegalDocument,
    setHandoffLegalDocument,
    legalConsentDueRef,
    legalSheetHeld,
    setLegalSheetHeld,
    handoffLegalOpenRef,
    setupHandoffActiveRef,
  } = useHandoffLegalHolders();
  const { setHeldSessionAdaptations, sessionAdaptationFor, adaptSession } =
    useHeldSessionAdaptations(todayStartMs);
  /**
   * The open coach conversation, held here because the chat screen unmounts.
   *
   * Its best answers end in "katso tämä treeni", and following that used to
   * throw away the brief that earned it (#bugs 2026-08-27). Not persisted: the
   * thread ends when the app does, and lib/coachChatMemory ends it after eight
   * hours anyway.
   */
  const [coachChatMemory, setCoachChatMemory] = useState<CoachChatMemory<ChatMessage> | null>(null);
  /**
   * What the coach advised over the last three weeks — the memory that does
   * outlive the thread above, and the app.
   *
   * Its own AsyncStorage key rather than a preference: see
   * storage/coachAdviceMemoryStore for why it stays out of the cloud backup.
   * Loaded once on mount; an empty list until it arrives, so the first
   * question of a cold start is answered without it rather than delayed by it.
   */
  const [coachAdviceMemory, setCoachAdviceMemory] = useState<CoachAdviceMemoryEntry[]>([]);
  const {
    settingsImportVisible,
    setSettingsImportVisible,
    programLimitVisible,
    setProgramLimitVisible,
    runningCapSheet,
    setRunningCapSheet,
    appUpdateShown,
    setAppUpdateShown,
  } = useShellSheets();
  useSetupWeightSeed({ hydrated, preferences, database, addBodyweightEntry, updatePreferences });

  useRouteBack({
    cardioRunActive,
    route,
    navigationState,
    onboardingActive,
    workoutHomeRoute,
    handoffLegalDocument,
    setHandoffLegalDocument,
    handoffLegalOpenRef,
    setupHandoffActiveRef,
    legalConsentDueRef,
    resetToRoute,
    navigateBack,
    leaveFinishedScreen,
    workoutRef,
    summaryExitRouteRef,
  });

  const { homeSummary, lifetimeSummary, progressTrainingRhythm } = useDaySummaries({
    database,
    unitPreference,
    todayKey,
  });
  // One lookup for the session analysis and the completion lock, so the programmes it adapts are adapted once.
  const adviceTemplateLookup = useMemo(
    () =>
      createAdviceTemplateLookup({
        workoutTemplates,
        getWorkoutTemplateSessions,
        exerciseLibrary,
        defaultRestSeconds: preferences.defaultRestSeconds,
      }),
    [workoutTemplates, getWorkoutTemplateSessions, exerciseLibrary, preferences.defaultRestSeconds],
  );
  const {
    proLiftHistories,
    proFatigue,
    progressionFatigueSignal,
    proPlateau,
    proWeeklyRead,
    proCompletionMoment,
    proCoachSpecimen,
  } = useProInsights({
    database,
    preferences,
    completedSessionId: completionSummary?.sessionId ?? null,
    todayKey,
    adviceTemplateLookup,
  });
  const homeActiveWorkoutSummary = useHomeActiveWorkoutSummary(workout.activeSession, preferences.appLanguage);
  navigateToActiveWorkoutRef.current = () => navigateToActiveWorkoutThroughGuard({ resume: true });
  finishFromNotificationRef.current = () => {
    // "Finish workout" from the lock screen opens the session; ending it is a
    // confirmed step on that screen, not a silent write from a notification.
    navigateToActiveWorkoutThroughGuard({ resume: true });
  };

  const {
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
    resumeHeldProgramme,
  } = createProgrammeStarts({
    database,
    preferences,
    unitPreference,
    workoutTemplates,
    getWorkoutTemplateSessions,
    updatePreferences,
    deleteCompletedWorkoutSession,
    workout,
    sessionAdaptationFor,
    setHeldSessionAdaptations,
    setRunningCapSheet,
    navigate,
    navigateToGuidedWorkout,
    navigateToActiveWorkout,
    isActiveSessionFor,
    showToast,
  });

  /**
   * Take on a ready programme.
   *
   * It ADDS. Nothing here ever drops a programme the reader already has: a
   * new programme is another commitment, not a replacement for the week they
   * built.
   * The only thing standing between them and a fourth is the cap, and the only
   * thing that removes a programme is the reader asking for it.
   *
   * Before this existed, `activePlanId` was written by the two onboarding
   * finishes and nowhere else, so a ready programme could be opened but never
   * taken on.
   */
  /**
   * Returns whether the programme is running when this resolves.
   *
   * The target flow is the caller that needs to know: it stores a target only
   * if the programme behind it actually landed, and the cap can refuse. Every
   * other caller ignores the value, which is why this can be added without
   * touching them.
   */
  async function handleAdoptReadyProgram(
    workoutTemplateId: string,
    adoption?: AdoptReadyOptions,
  ): Promise<boolean> {
    const template = getWorkoutTemplateById(workoutTemplateId);
    if (!template) {
      return false;
    }
    // Taking a finished programme's place is taking its lead.
    const options: AdoptReadyOptions = {
      lead: Boolean(adoption?.lead || adoption?.replacingPlanId),
      replacingPlanId: adoption?.replacingPlanId,
    };

    // Already running this programme under some other plan id (an onboarding
    // pick, say) — joining again would spend a cap slot on a duplicate. But
    // "already held" is not "already the one Home leads with", and this used to
    // return on both: the only way to change the lead was to REMOVE the other
    // programme, which is a destructive answer to a question about ordering.
    if (activeProgramTemplateIds.includes(workoutTemplateId)) {
      if (options.lead) {
        await promoteHeldProgramToLead(workoutTemplateId, options.replacingPlanId);
      }
      // Already held is already running, which is what the caller asked for.
      return true;
    }

    /*
     * The reader's own version of this programme IS this programme.
     *
     * Onboarding hands most readers a copy of the recommended programme,
     * fitted to their answers, and that copy is what they train. Adopting the
     * catalog original beside it gave one programme two rows in the list, two
     * plans, two slots of the running cap — and a Home offering a week the
     * reader had never been shown (audit round 4, 2026-09-20). The copy is
     * the answer: running already, or resumed through its own plan with its
     * block intact. Only if it has no plan at all does the catalog version
     * get built below.
     */
    const copyTemplateId = findReadyProgrammeCopyId(
      workoutTemplateId,
      database.workoutTemplates,
      // Running first, then merely held: with two copies of one programme
      // — possible on an install from before the link — resuming the one
      // nothing points at would leave both running.
      [
        ...activeProgramTemplateIds,
        ...database.workoutPlans
          .map((plan) => plan.entries[0]?.workoutTemplateId)
          .filter((id): id is string => typeof id === 'string'),
      ],
    );
    if (copyTemplateId) {
      if (activeProgramTemplateIds.includes(copyTemplateId)) {
        if (options.lead) {
          await promoteHeldProgramToLead(copyTemplateId, options.replacingPlanId);
        }
        return true;
      }
      // resumeHeldProgramme counts the adoption itself, once its write lands.
      const resumedCopy = await resumeHeldProgramme(copyTemplateId, options);
      if (resumedCopy !== null) {
        return resumedCopy;
      }
    }

    // Held but switched off: resumed, not rebuilt. Falling through here
    // built a fresh plan over the same id, and its updatedAt is the block
    // boundary — a programme at week 5, 12 of 24, came back from the goal
    // flow or the completion card as week 1, 0 of 24, with its week dealt
    // again while the rotation carried on (audit round 4, 2026-09-20).
    // The Active switch already keeps the plan; this is the same path, and
    // it is the same path the reader's own copy comes back through above.
    const resumedHeld = await resumeHeldProgramme(workoutTemplateId, options);
    if (resumedHeld !== null) {
      return resumedHeld;
    }
    const planId = buildReadyProgramPlanId(workoutTemplateId);
    // The cap counts what will be running: a finished programme this one
    // replaces has already given up its slot (runningSetWithout).
    const running = runningSetWithout({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      replacingPlanId: options.replacingPlanId,
    });
    const decision = evaluateProgramAdoption({
      activePlanIds: running.activePlanIds,
      targetPlanId: planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });

    if (decision.kind === 'already_active') {
      return true;
    }

    if (decision.kind === 'blocked') {
      // In the count running now, not the one without the finished programme
      // it replaces (runningCapRefusal).
      const refusal = runningCapRefusal(preferences.activePlanIds, decision);
      // Full on the free tier is a sale; full on Pro is not, and sending a
      // paying reader to the paywall would be selling them what they own.
      if (decision.canUpgrade) {
        // The wall first, on this screen, then Pro only if the reader asks —
        // it used to jump straight to the paywall (user 2026-09-14).
        setRunningCapSheet({ visible: true, ...refusal });
        return false;
      }
      showToast(runningCapRefusalMessage(preferences.appLanguage, refusal));
      return false;
    }

    // The programme's own week leads. This read availability alone and fell
    // back to a three-day default, and the plan then dealt sessions round-robin
    // across whatever labels it got — so a six-session programme ran on three
    // days, twice over, and every programme became a three-day programme.
    const dayLabels = planLabelsForProgramme(
      template.sessions.length,
      preferences.setupAvailableDays,
      // Adopting is a moment, and the cycle starts from it.
      new Date(),
    );

    const plan = buildProgramWorkoutPlan({
      planId,
      workoutTemplateId,
      programName: formatWorkoutDisplayLabel(template.name),
      sessionIds: template.sessions.map((session) => session.id),
      dayLabels,
      now: new Date().toISOString(),
    });

    await upsertWorkoutPlan(plan);
    // One write: the finished programme leaves the running set as this one
    // joins it, so the reader never holds both.
    const nextActivePlanIds = addActiveProgram(running.activePlanIds, plan.id);
    await updatePreferences({
      activePlanIds: nextActivePlanIds,
      // Adopting a programme must not quietly demote the one already at the
      // top of Home — but stepping up FROM a finished programme is the reader
      // explicitly choosing a new lead, so the completion flow passes `lead`.
      activePlanId: options.lead ? plan.id : running.activePlanId ?? plan.id,
    });
    /*
     * Counted where a programme has started running: after the write.
     *
     * This fired at the top of the handler, before every early return, and
     * then (2026-09-20) above the cap check — "an attempt at one", so a free
     * reader at the cap who looked at the sheet and said no was counted as
     * having adopted a programme, and so was a write that failed. The row
     * says a programme is in use; the cap sheet is not that (analytics
     * audit, 2026-09-21).
     */
    trackEvent('plan_adopted');
    return true;
  }

  const {
    dismissCompletionCard,
    handleCompletionStartNext,
    handleSaveRhythm,
    handleChangeTrainingDays,
    handleSaveEmphasis,
    handleCompletionRestart,
  } = createProgrammePlanEdits({
    database,
    preferences,
    updatePreferences,
    upsertWorkoutPlan,
    editWorkoutTemplateSessions,
    showToast,
    handleAdoptReadyProgram,
    completedSessionsForTemplate,
  });

  const { activeProgramTemplateIds, runningProgrammeTitle, homeOtherPrograms } =
    useRunningProgrammeViews({ database, preferences, workoutTemplates });

  const {
    promoteHeldProgramToLead,
    handleStopProgram,
    handleResumeProgram,
    handleSwitchActiveProgram,
    handleForgetHeldProgram,
    handleRemoveActiveProgram,
    handleStartReadyProgram,
  } = createProgrammeSwitches({
    database,
    preferences,
    updatePreferences,
    upsertWorkoutPlan,
    forgetHeldProgramme,
    workout,
    setRunningCapSheet,
    buildCustomProgrammePlan,
    leaveDeletedProgramme,
    handleStartReadyProgramSession,
    showToast,
  });

  function handleStartCustomProgramSession(workoutTemplateId: string, sessionId: string) {
    const customTemplate = customWorkoutRuntimeMap[workoutTemplateId];
    if (!customTemplate) {
      return;
    }

    const selectedSession = customTemplate.sessions.find((session) => session.id === sessionId) ?? null;
    if (!selectedSession?.exercises.length) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesSession'));
      // To the day itself, where "Lisää liike" is. It went to the template
      // editor, which a programme page no longer opens — and a day can be
      // empty now on purpose, named first and filled after (2026-09-26).
      if (selectedSession) {
        navigate({ tab: 'workout', screen: 'programDay', programType: 'custom', workoutTemplateId, sessionId });
      }
      return;
    }

    // Same rule as the ready-programme start above.
    if (navigateToActiveWorkout({ resume: isActiveSessionFor(workoutTemplateId, sessionId) })) {
      return;
    }

    const sessionRef = { programId: workoutTemplateId, sessionId };
    const runtimeTemplate = applySessionAdaptation(
      buildCustomSessionRuntimeTemplate(customTemplate, sessionId),
      sessionAdaptationFor(sessionRef),
    );
    // Every row left out for today: the same refusal as the ready start.
    if (sessionHasNoExercises(runtimeTemplate)) {
      showToast(t(preferences.appLanguage, 'toast.everyLiftDropped'));
      return;
    }

    guardStrengthStartOverCardio(() => {
      // Nor here: training leaves the active programme where it is, as on the
      // ready path above.
      void updatePreferences({ trainingFirstRunDismissed: true });
      startProgrammeWorkout(runtimeTemplate, unitPreference);
      setHeldSessionAdaptations((held) => spendHeldAdaptation(held, sessionRef));
      navigateToGuidedWorkout(workoutTemplateId);
    });
  }

  /**
   * "Ota ohjelma käyttöön" on a program of the reader's own.
   *
   * The ready-program half of this was fixed and the custom half was not, which
   * left a program the reader built or imported reachable only as a list of
   * sessions to start one at a time. Reported by a reader who imported their own
   * six-day program and could not get it onto the home screen by any route —
   * Home offered the catalog and onboarding, and neither of those knows about a
   * program that came from a spreadsheet.
   *
   * Adoption is the same act whatever the program's source, so this is
   * `handleAdoptReadyProgram` with the template read from the reader's own
   * templates and the plan id from the custom namespace.
   */
  /**
   * "Today is legs, not upper."
   *
   * The rotation decides what comes next in the programme and is right nearly
   * every day; what it cannot know is that the reader's day went differently.
   * The pick is dated, so it answers for today and the rotation answers again
   * tomorrow — nothing has to remember to clear it.
   */
  async function handlePickTodaySession(sessionId: string) {
    const now = new Date();
    try {
      await updatePreferences({
        todaySession: {
          dayStart: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
          sessionId,
          // Session ids repeat across programmes; this says which one's day.
          workoutTemplateId: homeActivePlanCard?.programId ?? null,
          // The instant matters, not just the day: picking a session you already
          // trained today is how you say "again", and without a timestamp it was
          // indistinguishable from the stale pick left over from this morning.
          pickedAt: now.getTime(),
        },
      });
    } catch (error) {
      // Wired as `void`: a refused write was a pick that sprang back unsaid.
      reportPlanSaveFailed('Failed to save the picked session', error, preferences.appLanguage, showToast);
    }
  }

  const {
    handleRenameProgramSession,
    handleRenameCustomProgram,
    handleReorderProgramSession,
    handleAddProgramSession,
    handleRemoveProgramSession,
    syncPlanToTemplate,
  } = createProgrammeDayEdits({
    database,
    preferences,
    updatePreferences,
    editWorkoutTemplateSessions,
    renameWorkoutTemplate,
    getWorkoutTemplateSessionsFresh,
    upsertWorkoutPlan,
    completedSessionsForTemplate,
    showToast,
  });

  /**
   * Take one lift out of the programme for good, from wherever the reader is
   * looking at it.
   *
   * "Jätä tänään pois" answers today; this answers the plan. They sit together
   * because the reader asking "how do I get rid of this exercise" does not yet
   * know which of the two they mean, and offering only the temporary one sent
   * them hunting for an editor they could not find (user 2026-08-26).
   *
   * A ready programme is immutable at runtime, so removing from one means the
   * programme becomes the reader's own. That copy is made silently and takes
   * the plan's place — the reader asked to drop a lift, not to learn how the
   * catalog is stored. The one thing not done silently is spending their last
   * programme slot: that is said before anything is written, because finding
   * out at a paywall mid-edit is the surprise the silence was meant to avoid.
   */
  const {
    programCapLine,
  } = useProgramCapLine({
    preferences,
  });

  const { handleEditProgramExercise } = useProgramExerciseEdit({
    exerciseLibrary,
    preferences,
    database,
    workout,
    workoutTemplates,
    programSlots,
    editWorkoutTemplateSessions,
    findWorkoutTemplateIdBySource,
    upsertWorkoutTemplate,
    getWorkoutTemplateSessionsFresh,
    upsertWorkoutPlan,
    updatePreferences,
    forgetHeldProgramme,
    deleteWorkoutTemplate,
    navigate,
    showToast,
    adaptSession,
    moveHeldAdaptations: (moves) => setHeldSessionAdaptations((held) => moveHeldAdaptations(held, moves)),
    setProgramLimitVisible,
  });

  /** Resolves true once the programme is running, false when it was not taken on. */
  /**
   * The plan that takes one of the reader's own programmes into use, or null
   * when it has no lift to train. Shared by adoption and by switching the
   * active programme off in its favour, so both build the same week.
   */
  function buildCustomProgrammePlan(workoutTemplateId: string) {
    const template = customWorkoutRuntimeMap[workoutTemplateId];
    const sessionIds = (template?.sessions ?? [])
      .filter((session) => session.exercises.length > 0)
      .map((session) => session.id);
    if (sessionIds.length === 0) {
      return null;
    }
    // The program's own session count leads, exactly as it does for a ready
    // programme: an imported six-day week dealt across three chosen weekdays
    // would run every session twice and call itself a three-day programme.
    const dayLabels = planLabelsForProgramme(sessionIds.length, preferences.setupAvailableDays, new Date());
    return buildProgramWorkoutPlan({
      planId: buildCustomProgramPlanId(workoutTemplateId),
      workoutTemplateId,
      programName: formatWorkoutDisplayLabel(template?.name ?? ''),
      sessionIds,
      dayLabels,
      now: new Date().toISOString(),
    });
  }

  async function handleAdoptCustomProgram(workoutTemplateId: string, options?: { lead?: boolean }): Promise<boolean> {
    const template = customWorkoutRuntimeMap[workoutTemplateId];
    // An empty program is not a plan. Home would draw a card with no session
    // behind it, so the editor is the honest destination.
    const sessionIds = (template?.sessions ?? [])
      .filter((session) => session.exercises.length > 0)
      .map((session) => session.id);
    if (sessionIds.length === 0) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesTemplate'));
      navigate({ tab: 'workout', screen: 'template', workoutTemplateId });
      return false;
    }

    if (activeProgramTemplateIds.includes(workoutTemplateId)) {
      if (options?.lead) {
        await promoteHeldProgramToLead(workoutTemplateId);
      }
      return true;
    }

    const planId = buildCustomProgramPlanId(workoutTemplateId);
    const decision = evaluateProgramAdoption({
      activePlanIds: preferences.activePlanIds,
      targetPlanId: planId,
      proUnlocked: resolveProEntitlement(preferences).unlocked,
    });

    if (decision.kind === 'already_active') {
      return true;
    }

    if (decision.kind === 'blocked') {
      if (decision.canUpgrade) {
        setRunningCapSheet({ visible: true, used: decision.used, cap: decision.cap, replacingStop: null });
        return false;
      }
      showToast(programCapFullMessage(preferences.appLanguage, decision.used, decision.cap));
      return false;
    }

    const plan = buildCustomProgrammePlan(workoutTemplateId);
    if (!plan) {
      return false;
    }

    await upsertWorkoutPlan(plan);
    await updatePreferences({
      activePlanIds: addActiveProgram(preferences.activePlanIds, plan.id),
      activePlanId: options?.lead ? plan.id : preferences.activePlanId ?? plan.id,
    });
    // The reader's own programme taken into use is an adoption like a ready
    // one, and was never counted as one (analytics audit, 2026-09-21).
    trackEvent('plan_adopted');
    return true;
  }

  function handleStartCustomProgram(workoutTemplateId: string) {
    const customTemplate = customWorkoutRuntimeMap[workoutTemplateId];
    // The day Home offers when this programme leads, else its first day with
    // lifts in it.
    const firstSessionId = programmeStartSessionId(
      (customTemplate?.sessions ?? []).map((session) => ({ id: session.id, exerciseCount: session.exercises.length })),
      workoutTemplateId,
      homeActivePlanCard,
    );
    if (!firstSessionId) {
      showToast(t(preferences.appLanguage, 'toast.addExercisesTemplate'));
      navigate({ tab: 'workout', screen: 'template', workoutTemplateId });
      return;
    }

    handleStartCustomProgramSession(workoutTemplateId, firstSessionId);
  }


  async function handleDeleteCustomWorkout(workoutTemplateId: string) {
    // Not while one of its days is running: the player would be routed to a
    // programme that is gone, and the sets in it could never be saved.
    if (liveSessionBlocksProgrammeDelete(workout.activeSession, workoutTemplateId)) {
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteWorkoutRunning'));
      return;
    }
    // A refused write rolls the delete back and rejects; the press is wired
    // as `void`, so uncaught it was a programme that vanished and came back
    // with no word (hunt 10, #37).
    try {
      await deleteWorkoutTemplate(workoutTemplateId);
    } catch (error) {
      console.error('Failed to delete the programme', error);
      void haptics.error();
      showToast(t(preferences.appLanguage, 'toast.programDeleteFailed'));
      return;
    }
    void haptics.success();
    leaveDeletedProgramme(workoutTemplateId);
  }

  const {
    handleOnboardingPickReadyProgram,
    handlePickProgramImage,
    handleContinueEntry,
    handleBackToEntry,
    handleOnboardingCompleteToTraining,
    handleSaveSetupLimitations,
    handleSetupCompleteToTraining,
  } = createOnboardingFinishes({
    coachQuotaLedger,
    database,
    preferences,
    updatePreferences,
    completeOnboarding,
    upsertWorkoutPlan,
    saveOnboardingResult,
    aboutYouValues,
    busySavingReadyPick,
    setBusySavingReadyPick,
    setProgramLimitVisible,
    navigateBack,
    resetToRoute,
    showToast,
  });

  const {
    customWorkoutRuntimeMap,
    customWorkouts,
    selectedCustomProgram,
    recentExerciseBrowserItems,
    exercisePrLookup,
    exercisePrLookupBefore,
  } = useCustomProgramViews({
    workoutTemplates,
    getWorkoutTemplateSessions,
    getWorkoutExercises,
    exerciseLibrary,
    preferences,
    database,
    workout,
  });
  const proEntitlement = resolveProEntitlement(preferences);
  const coachProUnlocked = proEntitlement.unlocked;

  const { coachDemoMoment, coachDemoQuestion } = useCoachDemoMoment({
    preferences,
    coachProUnlocked,
    database,
    proLiftHistories,
    proFatigue,
  });

  const { handleResetAllData, handleCoachAdviceGiven } = useCoachAdviceMemory({
    resetAllData,
    setCoachAdviceMemory,
    setCoachChatMemory,
    setHeldSessionAdaptations,
  });

  const { analysisSessionId, coachLastSession } = useCoachEntryReadings({
    route,
    workoutSessions,
    database,
    preferences,
  });
  const { availableEquipmentForDrills, routineBlockSeconds, routineSecondsForExercises } = useRoutineBlockCosts({
    preferences,
  });
  // The lead programme's rhythm: the reader's calendar, and what setup reopens on.
  const leadTrainingCycle = leadPlanTrainingCycle(database.workoutPlans, preferences.activePlanId);
  const {
    setupSelection,
    latestWeighInKg,
    setupEditSelection,
    setupBasics,
    tailoringPreferences,
    setupRecommendation,
    recommendedReadyTemplate,
  } = useSetupReadings({
    preferences,
    bodyweightProgress,
    leadTrainingCycle,
  });
  const {
    homeActivePlanCard,
    homeEmptyProgramme,
    homeSessionAdaptation,
    adaptHomeSession,
    progressWeeklyTarget,
  } = useHomeActivePlan({
    database,
    preferences,
    workoutTemplates,
    exerciseLibrary,
    getWorkoutTemplateSessions,
    todayStartMs,
    setupSelection,
    customWorkoutRuntimeMap,
    routineBlockSeconds,
    completedSessionsForTemplate,
    templatesRunByOtherPlans,
    sessionAdaptationFor,
    adaptSession,
  });
  const { homeStatCatalogCards, homePinnedStatCardKeys, homeSuggestedStatCardKeys } = useHomeStatCards({
    database,
    trackedProgress,
    preferences,
  });
  // Same equipment truth the composer filters exercises with, for the default
  // warmup/cooldown drills: null = setup never said, [] = no equipment at all.
  const {
    homeDoneThisWeekSessionIds,
    baseTrainingSchedule,
    homeTrainingSchedule,
  } = useHomeTrainingSchedule({
    database,
    preferences,
    homeActivePlanCard,
    workoutTemplates,
    todayStartMs,
    completedSessionsForTemplate,
    templatesRunByOtherPlans,
  });

  const { recoverySheet, handleRecoveryAction, handleRecoveryUndo } = useRecoverySheet({
    proFatigue,
    database,
    homeActivePlanCard,
    preferences,
    coachProUnlocked,
    baseTrainingSchedule,
    todayStartMs,
    updatePreferences,
    showToast,
  });
  const { aiCoachTrainingContext, coachChatIntro } = useCoachContext({
    workoutSessions,
    cardioSessions,
    database,
    preferences,
    workout,
    unitPreference,
    trackedProgress,
    todayStartMs,
    coachAdviceMemory,
    homeSummary,
    proFatigue,
    progressionFatigueSignal,
    proWeeklyRead,
    homeActiveWorkoutSummary,
    programmeStart,
    customWorkoutRuntimeMap,
    selectedCustomProgram,
    homeActivePlanCard,
    homePinnedStatCardKeys,
    homeTrainingSchedule,
    adviceTemplateLookup,
  });
  useLeadPlanRepair({
    appHydrated,
    preferences,
    database,
    updatePreferences,
  });

  const { handleAddHomeWidget } = useHomeWidgetPinState({
    appHydrated,
    setHomeWidgetState,
    updatePreferences,
    isHomeWidgetSupported,
    isHomeWidgetAdded,
    requestPinHomeWidget,
  });

  // Feeds the home-screen widget. The launcher redraws it on its own schedule,
  // so all this has to do is keep the file current. Placed after the plan card
  // and the picked days, because it is built from exactly what Home renders.
  //
  // The calendar reaches back two weeks, so the widget needs the days that were
  // trained — not just this week's weekdays. 21 days covers two past weeks plus
  // every day of the current one, whichever weekday today is.
  const {
    setupHandoffHeldRef,
    setSetupHandoffHeld,
    setupHandoffPlan,
    setupHandoffActive,
    setupHandoffShown,
    legalConsentDue,
    homeTourActive,
    workoutTourRunning,
    workoutTourDue,
    homePrompt,
    tourElement,
    handleServerNoticeSeen,
    appUpdateHeld,
    renderLegalConsent,
  } = useSetupHandoffOverlays({
    preferences,
    updatePreferences,
    appHydrated,
    brandSplashDone,
    onboardingActive,
    route,
    homeWidgetState,
    homePinnedStatCardKeys,
    homeSuggestedStatCardKeys,
    accountBackup,
    database,
    homeActivePlanCard,
    workout,
    tourRegistry,
    workoutTourStep,
    setTourSweep,
    setTourFocus,
    setupHandoffActiveRef,
    legalConsentDueRef,
    legalSheetHeld,
    setLegalSheetHeld,
    handoffLegalDocument,
    setHandoffLegalDocument,
    LEGAL_OVER_CONSENT,
  });

  /**
   * The name comes from Google, so the About form stopped asking for one
   * (2026-09-09).
   *
   * An effect rather than a line inside the sign-in handler, because it has to
   * cover the reader who signed in before this shipped as well as the one
   * signing in now. Adopted once and never overwritten: a name typed in Profile
   * is the reader's own answer and outranks the account's — and so is a name
   * cleared there, which the old "the profile has no name" rule filled straight
   * back in (2026-09-16).
   */
  //
  // Not before the stored preferences have loaded. The account is a small key
  // and arrives first, while preferences are still the defaults and
  // profileName is null — so this wrote the DEFAULT preferences plus the name
  // to the preferences key, and the load then laid that over the real ones:
  // onboarding, running programmes, goals, consents and the trial gone on a
  // cold start, for every signed-in reader.
  useEffect(() => {
    if (!appHydrated) {
      return;
    }
    const step = accountNameStep({
      accountName: accountBackup.state.name,
      profileName: preferences.profileName,
      adopted: preferences.accountNameAdopted,
    });
    // Once per session (useAttemptOnce): a write the disk refuses is rolled
    // back, which puts this effect's inputs back and ran it again, forever.
    if (step.kind === 'markAdopted') {
      tryOnce('accountName:mark', () => updatePreferences({ accountNameAdopted: true }));
    } else if (step.kind === 'adopt') {
      const name = step.name;
      tryOnce(`accountName:adopt:${name}`, () => updatePreferences({ profileName: name, accountNameAdopted: true }));
    }
  }, [
    accountBackup.state.name,
    appHydrated,
    preferences.accountNameAdopted,
    preferences.profileName,
    tryOnce,
    updatePreferences,
  ]);

  const { handleAccountSignIn, handleAccountBackupNow } = useAccountOutcome({ accountBackup, preferences, showToast });

  const { handleSetupHandoffDone } = createSetupHandoffDone({
    setupHandoffPlan,
    homePinnedStatCardKeys,
    setupHandoffHeldRef,
    setSetupHandoffHeld,
    updatePreferences,
    showToast,
    preferences,
    requestPinHomeWidget,
    handleAccountSignIn,
    navigate: navigateNow,
  });

  const { widgetCompletedWorkoutDayStarts } = useHomeWidgetFeed({
    appHydrated,
    preferences,
    database,
    todayStartMs,
    recommendedReadyTemplate,
    homeActivePlanCard,
    homeEmptyProgramme,
    homeTrainingSchedule,
    refreshHomeWidget,
  });

  useWidgetTaps({
    appHydrated,
    workout,
    homeActivePlanCard,
    homeTrainingSchedule,
    recommendedReadyTemplate,
    widgetCompletedWorkoutDayStarts,
    resetToRoute: resetToRouteThroughGuard,
    navigateToActiveWorkout: navigateToActiveWorkoutThroughGuard,
  });

  useNotificationRoute({ appHydrated, resetToRoute: resetToRouteThroughGuard });

  const {
    exportablePlans,
    sessionAnalysis,
    profilePlanSummary,
    guidedEntryEyebrow,
    guidedWeekProgress,
    completionWeekProgress,
    guidedNextUp,
  } = usePlanReadouts({
    workoutTemplates,
    adviceTemplateLookup,
    getWorkoutTemplateSessions,
    homeActivePlanCard,
    analysisSessionId,
    workoutSessions,
    database,
    preferences,
    todayStartMs,
    progressWeeklyTarget,
    workout,
    WEEKDAY_LABEL_KEYS,
  });
  const { completedWorkoutSessions, homeRecentSessions } = useRecentSessions({
    database,
    workoutSessions,
    getSessionLogs,
    preferences,
    unitPreference,
  });
  const {
    dismissedTipIds,
    programsCatalogItems,
    programsCategoryCounts,
    catalogScreenItems,
    programsCategoryMembers,
    programsRecommendations,
    readerComposedWeek,
  } = useProgramsCatalog({
    preferences,
    workout,
    setupRecommendation,
    homeActivePlanCard,
    recommendedReadyTemplate,
    activeProgramTemplateIds,
    database,
    setupSelection,
  });
  /**
   * The rotating hero's slides, and the counts they promise.
   *
   * Every count is read off the same catalog the tiles filter, so a slide
   * cannot advertise a category that has nothing in it.
   */
  const {
    toSetLogSource,
    recordSources,
    liftHistory,
    plateauNotice,
    personalRecords,
    distinctRecordCount,
    milestoneLedger,
  } = useRecordsAndMilestones({
    exerciseBrowserItems,
    trackedProgress,
    database,
    proLiftHistories,
    preferences,
    lifetimeSummary,
    unitPreference,
  });

  const {
    sameLibraryRow,
    goalFlowLifts,
    targetLiftProgress,
    targetLiftSources,
    getGoalProposal,
    handleAcceptTargetProposal,
    programsGoals,
    goalProgrammeSuggestions,
  } = useGoalFlow({
    exerciseLibrary,
    todayStartMs,
    preferences,
    proLiftHistories,
    trackedProgress,
    toSetLogSource,
    handleAdoptReadyProgram,
    updatePreferences,
    navigate,
    activeProgramTemplateIds,
    customWorkoutRuntimeMap,
    programsRecommendations,
    showToast,
    readerComposedWeek,
  });
  const exerciseProgressFor = useExerciseDetailHistory(database, sameLibraryRow);
  const { programsCustomItems } = useProgramsCustomItems({
    customWorkouts,
    database,
    preferences,
    runningProgrammeTitle,
  });

  const templateBuilderDraft = useTemplateBuilderDraft({
    route,
    preferences,
    workoutTemplates,
    getWorkoutTemplateSessions,
  });

  if (!nativeSplashHidden || !hydrated || !workout.hydrated) {
    return <LaunchScreen />;
  }

  const { handleDiscardWorkout, handleConfirmFinishWorkout, finishLoggedWorkoutSave } = createFinishSaves({
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
  });

  let content: React.ReactNode = null;
  // A failure while a workout screen is drawn is marked as the workout's: only then does the crash screen
  // offer to put the stored workout aside (errorReporting/workoutFailure). Not around a null, so the
  // dashboard fallback below still sees a tab module that declined the route.
  const inWorkoutArea = (node: React.ReactNode) => (node == null ? node : <WorkoutAreaBoundary>{node}</WorkoutAreaBoundary>);

  if (onboardingActive) {
    content = renderOnboardingFlow({
      entryFlowActive,
      onboardingStep,
      setOnboardingStep,
      preferences,
      updatePreferences,
      handleContinueEntry,
      completeOnboarding,
      navigate,
      showToast,
      handleBackToEntry,
      aboutYouValues,
      setAboutYouValues,
      busySavingReadyPick,
      handleOnboardingPickReadyProgram,
      unitPreference,
      tailoringPreferences,
      workout,
      dismissedTipIds,
      handleDismissTip,
      handleOnboardingCompleteToTraining,
      setFullBleedReview,
    });
  } else if (
    // Shown rather than owed: the Pro page, and what it opens, sit between
    // the hand-off's two halves (user 2026-10-17). See useSetupHandoffOverlays.
    setupHandoffShown &&
    setupHandoffPlan
  ) {
    // Between the last question and the app. The route behind this is already
    // the one onboarding chose, so finishing here just uncovers it.
    content = renderSetupHandoff({
      preferences,
      setupHandoffPlan,
      handleSetupHandoffDone,
      setHandoffLegalDocument,
      handoffLegalDocument,
      LEGAL_OVER_HANDOFF,
      requestPinHomeWidget,
      onThemeChange: (dark) => void updatePreferences({ darkThemeEnabled: dark }),
    });
  } else if (route.tab === 'profile' && route.screen === 'setup') {
    content = renderSetupEditor({
      leadTrainingCycle,
      route,
      preferences,
      setupEditSelection,
      setupBasics,
      setupSelection,
      unitPreference,
      tailoringPreferences,
      workout,
      dismissedTipIds,
      handleDismissTip,
      navigateBack,
      handleSetupCompleteToTraining,
      handleSaveSetupLimitations,
    });
  } else if (
    route.tab === 'home' &&
    (route.screen === 'cardio' ||
      route.screen === 'history' ||
      route.screen === 'session' ||
      route.screen === 'ai_chat' ||
      route.screen === 'analysis')
  ) {
    // Every home sub-screen; the dashboard stays in the chain's final else,
    // where it doubles as the safety net for cleared guard state.
    content = renderHomeScreens({
      coachQuotaLedger,
      route,
      navigate,
      replaceRoute,
      navigateBack,
      preferences,
      updatePreferences,
      workout,
      hasFreestyleBoard: freestyleDraft != null,
      discardFreestyleBoard: workout.clearFreestyleDraft,
      cardioSessions,
      cardioSaving,
      setCardioSaving,
      saveCardioSession,
      navigateToActiveWorkout,
      setFinishSaveState,
      showToast,
      aiCoachTrainingContext,
      exerciseLibrary,
      programSlots,
      setProgramLimitVisible,
      workoutTemplates,
      upsertWorkoutTemplate,
      workoutSessions,
      getSessionLogs,
      historyScrollOffsetRef,
      deleteCompletedWorkoutSession: handleDeleteCompletedSession,
      deleteCardioSession,
      unitPreference,
      coachProUnlocked,
      database,
      completedSessionCount: completedWorkoutSessions.length,
      coachChatIntro,
      coachLastSession,
      homePinnedStatCardKeys,
      addBodyweightEntry,
      addMeasurementEntry,
      coachChatMemory,
      onCoachChatMemoryChange: setCoachChatMemory,
      onCoachAdviceGiven: handleCoachAdviceGiven,
      sessionAnalysis,
    });
  } else if (route.tab === 'workout' && route.screen === 'summary' && completionSummary) {
    content = inWorkoutArea(renderWorkoutCompletion({
      preferences,
      completionWeekProgress,
      guidedNextUp,
      completionSummary,
      coachProUnlocked,
      proCompletionMoment,
      navigate,
      coachDemoQuestion,
      coachDemoMoment,
      updateCompletedWorkoutSession,
      workout,
      leaveFinishedWorkout,
      showToast,
    }));
  } else if (route.tab === 'workout') {
    // Every route-pure workout branch. `summary` and `celebration` sit above
    // this on purpose: their guards read finish-flow state, and when that
    // state was just cleared the module returns null here and the dashboard
    // fallback below catches it — the same drop-through the old chain had.
    content = inWorkoutArea(renderWorkoutTab({
      setPlanTrainingCycle,
      onStopProgram: handleStopProgram,
      onResumeProgram: handleResumeProgram,
      onSwitchActiveProgram: handleSwitchActiveProgram,
      onForgetHeldProgram: handleForgetHeldProgram,
      route,
      navigate,
      navigateBack,
      replaceRoute,
      workoutHomeRoute,
      preferences,
      updatePreferences,
      unitPreference,
      database,
      workout,
      freestyleDraft,
      saveFreestyleDraft: workout.saveFreestyleDraft,
      clearFreestyleDraft: workout.clearFreestyleDraft,
      customWorkoutRuntimeMap,
      setupSelection,
      setupRecommendation,
      tailoringPreferences,
      activeProgramTemplateIds,
      homeActivePlanCard,
      availableEquipmentForDrills,
      routineSecondsForExercises,
      handleStartReadyProgramSession,
      handleAdoptReadyProgram,
      handleStartCustomProgram,
      handleAdoptCustomProgram,
      handleStartCustomProgramSession,
      editProgramExercise: handleEditProgramExercise,
      handleSaveRhythm,
      handleRenameCustomProgram,
      handleRenameProgramSession,
      handleReorderProgramSession,
      handleAddProgramSession,
      handleRemoveProgramSession,
      handleSaveEmphasis,
      handleDeleteCustomWorkout,
      sessionAdaptationFor,
      adaptSession,
      templateBuilderDraft,
      templateLeaveGuardRef,
      exerciseBrowserItems,
      recentExerciseBrowserItems,
      upsertWorkoutTemplate,
      showToast,
      exercisePrLookupBefore,
      finishLoggedWorkoutSave,
      exerciseLibrary,
      liftHistory,
      plateauNotice,
      tourRegistry,
      // Only while a workout tour is still owed: otherwise the player reports
      // nothing and the shell is not re-rendered for it.
      setWorkoutTourStep: workoutTourDue ? setWorkoutTourStep : undefined,
      workoutTourRunning,
      tourFocus,
      exerciseProgressFor,
      guidedEntryEyebrow,
      guidedWeekProgress,
      guidedNextUp,
      getWorkoutLoggerFallbackRoute,
      handleDiscardWorkout,
      handleConfirmFinishWorkout,
      finishSaveState,
      customWorkouts,
      recommendedReadyProgramId: recommendedReadyTemplate?.id ?? null,
      navigateToGuidedWorkout,
      handleOpenProgramDetail,
      handleStartReadyProgram,
      handleOpenCustomProgramDetail,
      goalProgrammeSuggestions,
      goalFlowLifts,
      getGoalProposal,
      handleAcceptTargetProposal,
      programSlots,
      setProgramLimitVisible,
      syncPlanToTemplate,
      programsCatalogItems,
      catalogScreenItems,
      proUnlocked: proEntitlement.unlocked,
      programsCategoryCounts,
      programsCategoryMembers,
      programsRecommendations,
      programsGoals,
      programsCustomItems,
      exerciseNameBook,
      teachExerciseName,
      handlePickProgramImage,
    }));
  } else if (route.tab === 'progress') {
    content = renderProgressTab({
      route,
      navigate,
      resetToRoute,
      preferences,
      updatePreferences,
      personalRecords,
      distinctRecordCount,
      recordSources,
      targetLifts: goalFlowLifts,
      targetLiftProgress,
      targetLiftSources,
      bodyweightProgress,
      measurementEntries,
      completedWorkoutSessions,
      cardioSessions,
      activityCalendar: homeSummary.streak.calendar,
      homeTrainingSchedule,
      progressTrainingRhythm,
      progressWeeklyTarget,
      unitPreference,
      proWeeklyRead,
      recoverySheet,
      onRecoveryAction: handleRecoveryAction,
      onRecoveryUndo: handleRecoveryUndo,
      proPlateauMoment: proPlateau?.moment ?? null,
      coachProUnlocked,
      addBodyweightEntry,
      addMeasurementEntry,
      deleteBodyweightEntry,
      deleteMeasurementEntry,
      showToast,
      homeRecentSessions,
    });
  } else if (route.tab === 'profile') {
    // Everything under the profile tab except `setup`, which the onboarding
    // gate above already claimed — the module's ProfileScreen fallback never
    // sees it. Branch order inside the module mirrors the old chain exactly.
    content = renderProfileTab({
      setPlanTrainingCycle,
      route,
      readyProgramCount: workout.templates.length,
      proUnlocked: proEntitlement.unlocked,
      navigate,
      navigateBack,
      resetToRoute,
      preferences,
      updatePreferences,
      coachProUnlocked,
      proCoachSpecimen,
      proEntitlement,
      profilePlanSummary,
      homeActivePlanCard,
      exerciseBrowserItems,
      exerciseNameBook,
      teachExerciseName,
      handlePickProgramImage,
      handleChangeTrainingDays,
      programSlots,
      setProgramLimitVisible,
      upsertWorkoutTemplate,
      exportablePlans,
      database,
      latestWeighInKg,
      settingsScrollOffsetRef,
      homeWidgetState,
      handleAddHomeWidget,
      accountBackup,
      handleAccountSignIn,
      handleAccountBackupNow,
      showToast,
      setSettingsImportVisible,
      setRatingSheetVisible,
      resetAllData: handleResetAllData,
      deletePendingAiLogs,
      retireAiLogLabel,
      setCompletionSummary,
      setFinishSaveState,
      workout,
      lifetimeSummary,
      milestoneLedger,
      trackedProgress,
      exerciseLibrary,
      unitPreference,
      distinctRecordCount,
    });
  }

  // The dashboard — and the safety net. `content` is still null when no
  // branch claimed the route OR a tab module declined it (a summary whose
  // finish-flow state was just cleared): both land on Home, exactly as the
  // chain's final else always did.
  if (content == null) {
    content = renderHomeDashboard({
      preferences,
      updatePreferences,
      tourRegistry,
      tourFocus,
      navigate,
      resolveTabRoute,
      homeActivePlanCard,
      homeEmptyProgramme,
      handleCompletionStartNext,
      handleCompletionRestart,
      dismissCompletionCard,
      homeOtherPrograms,
      programCapLine,
      database,
      handleOpenProgramDetail,
      handleRemoveActiveProgram,
      availableEquipmentForDrills,
      homeTourActive,
      homeWidgetState,
      handleAddHomeWidget,
      homePrompt,
      shellSheetOpen: programLimitVisible || runningCapSheet.visible || settingsImportVisible || ratingSheetVisible || appUpdateShown,
      handleAccountSignIn,
      homeTrainingSchedule,
      homeDoneThisWeekSessionIds,
      homeStatCatalogCards,
      homeSuggestedStatCardKeys,
      homePinnedStatCardKeys,
      homeSessionAdaptation,
      adaptHomeSession,
      handleEditProgramExercise,
      exerciseBrowserItems,
      workout,
      handlePickTodaySession,
      handleRenameProgramSession,
      handleStartCustomProgramSession,
      handleStartReadyProgramSession,
      guardStrengthStartOverCardio,
      proPlateau,
      coachProUnlocked,
    });
  }

  const {
    showTabBar,
    onboardingScreenActive,
    welcomeActive,
    workoutSummaryActive,
    premiumActive,
    historySessionActive,
  } = resolveShellChrome({ route, onboardingActive, entryFlowActive, setupHandoffActive });

  // The brand animation, once per cold start. It sits outside AppShell's
  // status-bar plumbing on purpose: it is a full-bleed field, and it must not
  // be the reason a slow start looks slower, so it only plays once everything
  // it would otherwise be covering is already there.
  if (!brandSplashDone) {
    return (
      <AppShell safeAreaEdges={['left', 'right']}>
        <VinhaSplashScreen
          language={preferences.appLanguage}
          onDone={() => setBrandSplashDone(true)}
        />
      </AppShell>
    );
  }

  return renderAppShell({
    content,
    route,
    historySessionActive,
    welcomeActive,
    workoutSummaryActive,
    onboardingScreenActive,
    premiumActive,
    showTabBar,
    fullBleedReview,
    toastMessage,
    preferences,
    updatePreferences,
    navigate,
    navigateToTab,
    leaveThroughScreenGuard,
    tourSweep,
    tourRegistry,
    legalConsentDue,
    renderLegalConsent,
    tourElement,
    appUpdateHeld,
    onAppUpdateShownChange: setAppUpdateShown,
    handleServerNoticeSeen,
    SettingsImportSheet,
    settingsImportVisible,
    setSettingsImportVisible,
    exerciseBrowserItems,
    exerciseNameBook,
    handlePickProgramImage,
    teachExerciseName,
    upsertWorkoutTemplate,
    importWorkoutHistory,
    recordLoggedWorkouts: workout.recordLoggedWorkouts,
    showToast,
    programLimitVisible,
    setProgramLimitVisible,
    programSlots,
    runningCapSheet,
    setRunningCapSheet,
    ratingSheetVisible,
    setRatingSheetVisible,
  });
}

/**
 * ThemeProvider sits *inside* AppProvider because the theme is a stored,
 * Pro-gated preference — it cannot be resolved before the database has
 * hydrated. AppProvider renders nothing of its own, so nothing is unthemed
 * while that happens.
 */
function ThemedRoot() {
  const { preferences } = useAppContext();
  const theme = useMemo(
    () => themeForName(resolveThemeName(preferences)),
    // The entitlement can lapse mid-session; recomputing on any preference
    // change is cheap and keeps the theme honest without a timer.
    [preferences],
  );

  return (
    <ThemeProvider theme={theme}>
      <WorkoutProvider>
        <VinhaApp />
      </WorkoutProvider>
    </ThemeProvider>
  );
}

export default function App() {
  // Outside both providers: either can throw while rendering, and the
  // recovery screen needs neither (it takes the phone's language).
  return (
    <AppErrorBoundary>
      <AppProvider>
        <ThemedRoot />
      </AppProvider>
    </AppErrorBoundary>
  );
}
