import React from 'react';

import type { AppRoute } from '../navigation/routes';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';

import { WorkoutAreaBoundary } from '../features/errorReporting/WorkoutAreaBoundary';
import { LEGAL_OVER_HANDOFF } from './appConstants';
import { renderHomeDashboard } from './renderHomeDashboard';
import { renderHomeScreens } from './renderHomeScreens';
import { renderOnboardingFlow, renderSetupEditor, renderSetupHandoff } from './renderOnboarding';
import { renderProfileTab } from './renderProfileTab';
import { renderProgressTab } from './renderProgressTab';
import { renderWorkoutCompletion } from './renderWorkoutCompletion';
import { renderWorkoutTab } from './renderWorkoutTab';

type WorkoutContextValue = ReturnType<typeof useWorkoutContext>;
type Onboarding = Parameters<typeof renderOnboardingFlow>[0];
type Setup = Parameters<typeof renderSetupHandoff>[0];
type SetupEditor = Parameters<typeof renderSetupEditor>[0];
type HomeScreens = Parameters<typeof renderHomeScreens>[0];
type Completion = Parameters<typeof renderWorkoutCompletion>[0];
type WorkoutTab = Parameters<typeof renderWorkoutTab>[0];
type ProgressTab = Parameters<typeof renderProgressTab>[0];
type ProfileTab = Parameters<typeof renderProfileTab>[0];
type Dashboard = Parameters<typeof renderHomeDashboard>[0];

// The names are the ones App.tsx has in scope; a prop that the screen modules take under another name is
// mapped inside the chain below, exactly as it was mapped in App.tsx.
type AppContentArgs = Omit<
  Onboarding &
  Setup &
  SetupEditor &
  HomeScreens &
  Completion &
  WorkoutTab &
  ProgressTab &
  ProfileTab &
  Dashboard,
  'route' | 'workout' | 'setupHandoffPlan' | 'completionSummary' | 'hasFreestyleBoard' | 'discardFreestyleBoard' | 'deleteCompletedWorkoutSession' | 'completedSessionCount' | 'onCoachChatMemoryChange' | 'onCoachAdviceGiven' | 'onStopProgram' | 'onResumeProgram' | 'onSwitchActiveProgram' | 'onForgetHeldProgram' | 'saveFreestyleDraft' | 'clearFreestyleDraft' | 'editProgramExercise' | 'recommendedReadyProgramId' | 'proUnlocked' | 'targetLifts' | 'activityCalendar' | 'onRecoveryAction' | 'onRecoveryUndo' | 'proPlateauMoment' | 'readyProgramCount' | 'resetAllData' | 'shellSheetOpen' | 'onThemeChange' | 'LEGAL_OVER_HANDOFF'
> & {
  route: AppRoute;
  workout: WorkoutContextValue;
  onboardingActive: boolean;
  setupHandoffShown: boolean;
  setupHandoffPlan: Setup['setupHandoffPlan'] | null;
  handleDeleteCompletedSession: HomeScreens['deleteCompletedWorkoutSession'];
  setCoachChatMemory: HomeScreens['onCoachChatMemoryChange'];
  handleCoachAdviceGiven: HomeScreens['onCoachAdviceGiven'];
  completionSummary: Completion['completionSummary'] | null;
  handleStopProgram: WorkoutTab['onStopProgram'];
  handleResumeProgram: WorkoutTab['onResumeProgram'];
  handleSwitchActiveProgram: WorkoutTab['onSwitchActiveProgram'];
  handleForgetHeldProgram: WorkoutTab['onForgetHeldProgram'];
  handleEditProgramExercise: WorkoutTab['editProgramExercise'];
  workoutTourDue: boolean;
  setWorkoutTourStep: NonNullable<WorkoutTab['setWorkoutTourStep']>;
  recommendedReadyTemplate: { id: string } | null | undefined;
  goalFlowLifts: ProgressTab['targetLifts'];
  homeSummary: { streak: { calendar: ProgressTab['activityCalendar'] } };
  handleRecoveryAction: ProgressTab['onRecoveryAction'];
  handleRecoveryUndo: ProgressTab['onRecoveryUndo'];
  handleResetAllData: ProfileTab['resetAllData'];
  programLimitVisible: boolean;
  runningCapSheet: { visible: boolean };
  settingsImportVisible: boolean;
  ratingSheetVisible: boolean;
  appUpdateShown: boolean;
  };

// The route-to-screen dispatch: which screen module draws the current route. The order of the branches is
// the order of the old chain in App.tsx and is not interchangeable; `null` from a tab module falls through
// to the dashboard, which is also the safety net for cleared guard state.
export function renderAppContent(args: AppContentArgs): React.ReactNode {
  const {
  onboardingActive,
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
  setupHandoffShown,
    setupHandoffPlan,
    handleSetupHandoffDone,
    setHandoffLegalDocument,
    handoffLegalDocument,
    requestPinHomeWidget,
    route,
    leadTrainingCycle,
    setupEditSelection,
    setupBasics,
    setupSelection,
    navigateBack,
    handleSetupCompleteToTraining,
    handleSaveSetupLimitations,
    coachQuotaLedger,
    replaceRoute,
    freestyleDraft,
    cardioSessions,
    cardioSaving,
    setCardioSaving,
    saveCardioSession,
    navigateToActiveWorkout,
    setFinishSaveState,
    aiCoachTrainingContext,
    exerciseLibrary,
    programSlots,
    setProgramLimitVisible,
    workoutTemplates,
    upsertWorkoutTemplate,
    workoutSessions,
    getSessionLogs,
    historyScrollOffsetRef,
    handleDeleteCompletedSession,
    deleteCardioSession,
    coachProUnlocked,
    database,
    completedWorkoutSessions,
    coachChatIntro,
    coachLastSession,
    homePinnedStatCardKeys,
    addBodyweightEntry,
    addMeasurementEntry,
    coachChatMemory,
    setCoachChatMemory,
    handleCoachAdviceGiven,
    sessionAnalysis,
    completionSummary,
    completionWeekProgress,
    guidedNextUp,
    proCompletionMoment,
    coachDemoQuestion,
    coachDemoMoment,
    updateCompletedWorkoutSession,
    leaveFinishedWorkout,
    setPlanTrainingCycle,
    handleStopProgram,
    handleResumeProgram,
    handleSwitchActiveProgram,
    handleForgetHeldProgram,
    workoutHomeRoute,
    customWorkoutRuntimeMap,
    setupRecommendation,
    activeProgramTemplateIds,
    homeActivePlanCard,
    availableEquipmentForDrills,
    routineSecondsForExercises,
    handleStartReadyProgramSession,
    handleAdoptReadyProgram,
    handleStartCustomProgram,
    handleAdoptCustomProgram,
    handleStartCustomProgramSession,
    handleEditProgramExercise,
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
    exercisePrLookupBefore,
    finishLoggedWorkoutSave,
    liftHistory,
    plateauNotice,
    tourRegistry,
    workoutTourDue,
    setWorkoutTourStep,
    workoutTourRunning,
    tourFocus,
    exerciseProgressFor,
    guidedEntryEyebrow,
    guidedWeekProgress,
    getWorkoutLoggerFallbackRoute,
    handleDiscardWorkout,
    handleConfirmFinishWorkout,
    finishSaveState,
    customWorkouts,
    recommendedReadyTemplate,
    navigateToGuidedWorkout,
    handleOpenProgramDetail,
    handleStartReadyProgram,
    handleOpenCustomProgramDetail,
    goalProgrammeSuggestions,
    goalFlowLifts,
    getGoalProposal,
    handleAcceptTargetProposal,
    syncPlanToTemplate,
    programsCatalogItems,
    catalogScreenItems,
    proEntitlement,
    programsCategoryCounts,
    programsCategoryMembers,
    programsRecommendations,
    programsGoals,
    programsCustomItems,
    exerciseNameBook,
    teachExerciseName,
    handlePickProgramImage,
    resetToRoute,
    personalRecords,
    distinctRecordCount,
    recordSources,
    targetLiftProgress,
    targetLiftSources,
    bodyweightProgress,
    measurementEntries,
    homeSummary,
    homeTrainingSchedule,
    progressTrainingRhythm,
    progressWeeklyTarget,
    proWeeklyRead,
    recoverySheet,
    handleRecoveryAction,
    handleRecoveryUndo,
    proPlateau,
    deleteBodyweightEntry,
    deleteMeasurementEntry,
    homeRecentSessions,
    proCoachSpecimen,
    profilePlanSummary,
    handleChangeTrainingDays,
    exportablePlans,
    latestWeighInKg,
    settingsScrollOffsetRef,
    homeWidgetState,
    handleAddHomeWidget,
    accountBackup,
    handleAccountSignIn,
    handleAccountBackupNow,
    setSettingsImportVisible,
    setRatingSheetVisible,
    handleResetAllData,
    deletePendingAiLogs,
    retireAiLogLabel,
    setCompletionSummary,
    lifetimeSummary,
    milestoneLedger,
    trackedProgress,
    resolveTabRoute,
    homeEmptyProgramme,
    handleCompletionStartNext,
    handleCompletionRestart,
    dismissCompletionCard,
    homeOtherPrograms,
    programCapLine,
    handleRemoveActiveProgram,
    homeTourActive,
    homePrompt,
    programLimitVisible,
    runningCapSheet,
    settingsImportVisible,
    ratingSheetVisible,
    appUpdateShown,
    homeDoneThisWeekSessionIds,
    homeStatCatalogCards,
    homeSuggestedStatCardKeys,
    homeSessionAdaptation,
    adaptHomeSession,
    handlePickTodaySession,
    guardStrengthStartOverCardio,
  } = args;

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

  return content;
}
