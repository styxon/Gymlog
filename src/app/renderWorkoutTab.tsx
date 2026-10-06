import React from 'react';
import { View } from 'react-native';

import { getWorkoutTemplateById } from '../features/workout/workoutCatalog';
import { buildFirstRunRecommendationReasons, FirstRunSetupSelection } from '../lib/firstRunSetup';
import { restAlertsAnswered } from '../lib/restAlertAnswer';
import { openRestAlertSettings } from '../utils/sessionNotifications';
import { recordOwnBlock } from '../lib/ownBlockHistory';
import { formatShortDate } from '../lib/format';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { t } from '../lib/i18n';
import type { ProgramImageImportResult } from '../utils/programImagePicker';
import { ProgramLimitReachedError, ProgramSlots, programSlotsLineKey } from '../lib/programSlots';
import { createUnlessAtLimit } from './programLimitGuard';
import { AFFINITY_REASON_KEYS, resolveProgramAffinity } from '../lib/programAffinity';
import { composeProgramWeekForSelection } from '../lib/programDayComposer';
import { findHeldReadyProgrammeCopyId, findReadyProgrammeCopyId } from '../lib/programmeCopyLink';
import { buildCustomProgramDetail, buildReadyProgramDetail, composedWeekMatchesPlan, readyProgramSessionMinutes } from '../lib/programDetails';
import { resolveProgramEquipment } from '../lib/programEquipment';
import { buildProgramFingerprint } from '../lib/programFingerprint';
import { programmeLineageIds } from '../lib/programLineage';
import { getSeasonProgramId, ProgramSeason } from '../lib/programSeasons';
import { livePlanEntries } from '../lib/planResolvableEntries';
import { templateSessionsReader } from './planTemplateSessions';
import { planWeekdayIndexes } from '../lib/programTrainingDays';
import {
  pickLibraryCollection,
  getExerciseCollection,
  getExerciseCollections,
  resolveCollectionProgress,
} from '../lib/exerciseCollections';
import { toggleTechniqueStatement } from '../lib/exerciseLearning';
import { getExerciseProgressForName, SameLiftMatcher } from '../lib/progression';
import { catalogLevelForSetup } from '../lib/goalProgramme';
import { getReadyProgramContent } from '../lib/readyProgramContent';
import { programmeSwitchedFrom, programmeToSwitchTo } from '../lib/runningProgrammes';
import { AdaptedSessionRef, SessionAdaptation, withSessionSwap } from '../lib/sessionAdaptation';
import { isReaderNamedSession } from '../lib/sessionNameLabel';
import { nextSeasonWindow, resolveSeasonWindow } from '../lib/season';
import { isEnrolled } from '../lib/seasonEnrolment';
import { computeSeasonProgress, countSeasonRecords, resolveSeasonBadges } from '../lib/seasonScoring';
import { removeStrengthGoal } from '../lib/strengthGoals';
import { buildTailoringBadgeLabels } from '../lib/tailoringFit';
import { AppRoute, ROOT_ROUTES } from '../navigation/routes';
import { haptics } from '../utils/haptics';
import { CreateTemplateScreen } from '../screens/CreateTemplateScreen';
import { EmptyWorkoutScreen } from '../screens/EmptyWorkoutScreen';
import { ExerciseDetailScreen } from '../screens/ExerciseDetailScreen';
import { ExercisesScreen } from '../screens/ExercisesScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { LearnIndexScreen } from '../screens/LearnIndexScreen';
import { GuidedPlayerScreen } from '../screens/GuidedPlayerScreen';
import { ProgramDayScreen } from '../screens/ProgramDayScreen';
import { ProgramPrescription } from '../lib/programSessionEdit';
import { ProgramDetailScreen } from '../screens/ProgramDetailScreen';
import { CatalogScreen, CatalogScreenItem } from '../screens/CatalogScreen';
import { ProgramsHomeScreen } from '../screens/ProgramsHomeScreen';
import { SeasonScreen } from '../screens/SeasonScreen';
import { GoalFlowProposal, StrengthGoalFlowScreen } from '../screens/StrengthGoalFlowScreen';
import { WorkoutsScreen } from '../screens/WorkoutsScreen';
import { AppDatabase, AppPreferences, UnitPreference, WorkoutTemplateDraft } from '../types/models';
import type { PreferencesPatch } from '../state/AppProvider';
import { FreestyleFinishSummary } from '../lib/emptyWorkoutSession';

/** One empty array, so "nothing learned yet" is the same value every render. */
const NOTHING_LEARNED: string[] = [];

type ProgramDetailProps = React.ComponentProps<typeof ProgramDetailScreen>;
type ProgramsHomeProps = React.ComponentProps<typeof ProgramsHomeScreen>;
type WorkoutsProps = React.ComponentProps<typeof WorkoutsScreen>;
type GuidedProps = React.ComponentProps<typeof GuidedPlayerScreen>;

/**
 * The workout tab's route-pure branches, moved verbatim from App.tsx's render
 * chain in the phase-A split (2026-08-26). Two branches deliberately stayed
 * behind: `summary` and `celebration` are guarded on finish-flow state that
 * App.tsx owns, and their fall-through to the dashboard safety net is the
 * chain's business. This function returns null for them — and for any
 * workout route it does not claim — so the caller's fallback still runs.
 */
export interface WorkoutTabDeps {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  navigateBack: (fallback?: AppRoute | null) => void;
  replaceRoute: (route: AppRoute) => void;
  workoutHomeRoute: AppRoute;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
  unitPreference: UnitPreference;
  database: AppDatabase;
  workout: { templates: Parameters<typeof resolveProgramAffinity>[1] };
  /** The freestyle session in flight, from the workout provider — see FreestyleDraftSnapshot. */
  freestyleDraft: React.ComponentProps<typeof EmptyWorkoutScreen>['freestyleDraft'];
  saveFreestyleDraft: NonNullable<React.ComponentProps<typeof EmptyWorkoutScreen>['onSaveDraft']>;
  clearFreestyleDraft: NonNullable<React.ComponentProps<typeof EmptyWorkoutScreen>['onClearDraft']>;
  customWorkoutRuntimeMap: Record<string, Parameters<typeof buildCustomProgramDetail>[0] | undefined>;
  setupSelection: FirstRunSetupSelection | null;
  setupRecommendation: { featuredProgramId?: string | null; mismatchNote?: string | null } | null;
  tailoringPreferences: Parameters<typeof buildTailoringBadgeLabels>[0];
  activeProgramTemplateIds: string[];
  onStopProgram: (workoutTemplateId: string) => Promise<void>;
  /** The Active switch turned on — see handleResumeProgram. */
  onResumeProgram: (workoutTemplateId: string) => Promise<void>;
  /** The active programme switched off in favour of another — see handleSwitchActiveProgram. */
  onSwitchActiveProgram: (fromTemplateId: string, to: { templateId: string; planId: string | null }) => Promise<void>;
  /** Remove a held ready programme from the reader's programmes. */
  onForgetHeldProgram: (workoutTemplateId: string) => Promise<void>;
  homeActivePlanCard: {
    programId: string;
    programType: 'ready' | 'custom';
    title: string;
    weekLabel: string;
    progressPercent: number;
    sessionsPerWeek: string;
    weeklyMinutes: string;
    nextSession: { id: string };
  } | null;
  programInsightsByTemplateId: WorkoutsProps['programInsightsByTemplateId'];
  availableEquipmentForDrills: ProgramDetailProps['availableEquipment'];
  /** Warm-up and cool-down seconds for a day's lifts — the ones Home counts. */
  routineSecondsForExercises: NonNullable<ProgramDetailProps['routineSeconds']>;
  resolveNextSessionIdForTemplate: (workoutTemplateId: string) => string | null;
  handleStartReadyProgramSession: (workoutTemplateId: string, sessionId: string, trimSets?: boolean) => void;
  /** Resolves to whether the programme is running afterwards; the cap can refuse. */
  handleAdoptReadyProgram: (workoutTemplateId: string, options?: { lead?: boolean }) => Promise<boolean>;
  handleStartCustomProgram: (workoutTemplateId: string) => void;
  handleAdoptCustomProgram: (workoutTemplateId: string, options?: { lead?: boolean }) => Promise<boolean>;
  handleStartCustomProgramSession: (workoutTemplateId: string, sessionId: string, trimSets?: boolean) => void;
  /**
   * Change what a programme's day holds, for good — drop a lift, keep a swap,
   * or add from the library. A ready programme is copied underneath this: the
   * reader asked to change a lift, not to learn how the catalog is stored.
   *
   * `exerciseId` names the row being changed and is empty for an add, which
   * has no row yet.
   */
  editProgramExercise: (
    programType: 'ready' | 'custom',
    programId: string,
    sessionId: string,
    exerciseId: string,
    edit:
      | { kind: 'remove' }
      | { kind: 'replace'; exerciseName: string }
      | { kind: 'add'; exerciseNames: string[] }
      | { kind: 'prescribe'; prescription: ProgramPrescription }
      | { kind: 'reorder'; toIndex: number }
      | { kind: 'supersetLink'; linked: boolean },
    /** Resolves true when the programme actually changed. */
  ) => Promise<boolean>;
  /** A custom programme's own name. Ready ones keep the catalog's. */
  handleRenameCustomProgram: (workoutTemplateId: string, name: string) => void;
  /** One day's name in a custom programme. */
  handleRenameProgramSession: (workoutTemplateId: string, sessionId: string, name: string) => Promise<void>;
  handleReorderProgramSession: (
    workoutTemplateId: string,
    sessionId: string,
    toIndex: number,
  ) => Promise<void>;
  /** Resolves the new day's id once it is saved, and whether the week followed; or null. */
  handleAddProgramSession: (
    workoutTemplateId: string,
    name: string,
  ) => Promise<{ sessionId: string; weekSynced: boolean } | null>;
  /** Resolves once the day is gone, with whether the week followed; or null. */
  handleRemoveProgramSession: (
    workoutTemplateId: string,
    sessionId: string,
  ) => Promise<{ weekSynced: boolean } | null>;
  handleSaveRhythm: (workoutTemplateId: string, dayIndexes: number[]) => Promise<boolean>;
  handleSaveEmphasis: (
    workoutTemplateId: string,
    updates: Parameters<NonNullable<ProgramDetailProps['onSaveEmphasis']>>[0],
  ) => Promise<void>;
  handleDeleteCustomWorkout: (workoutTemplateId: string) => Promise<void>;
  /** Today's swaps and left-out slots held for one session (lib/sessionAdaptation). */
  sessionAdaptationFor: (ref: AdaptedSessionRef | null | undefined) => SessionAdaptation;
  adaptSession: (ref: AdaptedSessionRef, change: (current: SessionAdaptation) => SessionAdaptation) => void;
  templateBuilderDraft: React.ComponentProps<typeof CreateTemplateScreen>['initialDraft'];
  exerciseBrowserItems: React.ComponentProps<typeof ExercisesScreen>['items'];
  recentExerciseBrowserItems: React.ComponentProps<typeof CreateTemplateScreen>['recentExerciseLibraryItems'];
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  showToast: (message: string) => void;
  exercisePrLookupBefore: React.ComponentProps<typeof EmptyWorkoutScreen>['exercisePrLookupBefore'];
  finishLoggedWorkoutSave: (
    draft: WorkoutTemplateDraft,
    summary: FreestyleFinishSummary,
    adoptSessionId?: (sessionId: string) => void,
  ) => Promise<unknown>;
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  /** The lift's logged history by name, for the player's History tab. */
  liftHistory: React.ComponentProps<typeof GuidedPlayerScreen>['liftHistory'];
  /** The plateau reminder for whichever lift is walked to next, by name. */
  plateauNotice: React.ComponentProps<typeof GuidedPlayerScreen>['plateauNotice'];
  /** Whether a log is one library row's history — see isSameLiftAsLibraryRow. */
  sameLibraryRow: SameLiftMatcher;
  guidedEntryEyebrow: GuidedProps['entryEyebrow'];
  guidedWeekProgress: GuidedProps['weekProgress'];
  guidedNextUp: GuidedProps['nextUp'];
  getWorkoutLoggerFallbackRoute: () => AppRoute;
  handleDiscardWorkout: () => Promise<void>;
  handleConfirmFinishWorkout: () => Promise<void>;
  finishSaveState: { status: 'idle' | 'saving' | 'error' };
  customWorkouts: WorkoutsProps['customWorkouts'];
  recommendedReadyProgramId: string | null;
  navigateToGuidedWorkout: WorkoutsProps['onOpenWorkout'];
  handleOpenProgramDetail: (workoutTemplateId: string) => void;
  handleStartReadyProgram: WorkoutsProps['onStartReadyProgram'];
  handleOpenCustomProgramDetail: WorkoutsProps['onOpenCustomProgram'];
  goalProgrammeSuggestions: ProgramsHomeProps['goalProgrammes'];
  goalFlowLifts: React.ComponentProps<typeof StrengthGoalFlowScreen>['lifts'];
  getGoalProposal: (exerciseName: string) => GoalFlowProposal | null;
  handleAcceptTargetProposal: (input: {
    exerciseName: string;
    targetKg: number;
    /** Null sets the target alone and leaves the reader's programme alone. */
    templateId: string | null;
  }) => Promise<void>;
  programSlots: ProgramSlots;
  setProgramLimitVisible: (visible: boolean) => void;
  /** Brings the running plan's week back into step with the template's days. */
  syncPlanToTemplate: (workoutTemplateId: string) => Promise<void>;
  trackedProgress: Array<{ logs: Array<{ weight: number; repsPerSet: number[]; performedAt: string }> }>;
  workoutSessions: Parameters<typeof computeSeasonProgress>[0];
  handleEnrolSeason: (season: ProgramSeason, year: number) => void;
  programsCatalogItems: ProgramsHomeProps['catalogItems'];
  /** Whether AI-assisted composition opens the chat or the paywall. */
  proUnlocked: boolean;
  /** The same programmes with their categories, for the catalog's goal chips. */
  catalogScreenItems: CatalogScreenItem[];
  programsCategoryCounts: ProgramsHomeProps['categoryCounts'];
  programsCategoryMembers: ProgramsHomeProps['categoryMembers'];
  programsRecommendations: ProgramsHomeProps['recommendations'];
  programsGoals: ProgramsHomeProps['goals'];
  programsCustomItems: ProgramsHomeProps['customPrograms'];
  exerciseNameBook: ProgramsHomeProps['nameBook'];
  teachExerciseName: (wrote: string, target: { name: string; libraryItemId: string }) => void;
  /**
   * Undefined in a build with no live coach: the photo path is the coach's,
   * and the sheet hides the button rather than offering one that returns
   * nothing (2026-09-16).
   */
  handlePickProgramImage?: () => Promise<ProgramImageImportResult>;
}

export function renderWorkoutTab(deps: WorkoutTabDeps): React.ReactElement | null {
  const {
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
    customWorkoutRuntimeMap,
    setupSelection,
    setupRecommendation,
    tailoringPreferences,
    activeProgramTemplateIds,
    onStopProgram,
    onResumeProgram,
    onSwitchActiveProgram,
    onForgetHeldProgram,
    homeActivePlanCard,
    programInsightsByTemplateId,
    availableEquipmentForDrills,
    routineSecondsForExercises,
    resolveNextSessionIdForTemplate,
    handleStartReadyProgramSession,
    handleAdoptReadyProgram,
    handleStartCustomProgram,
    handleAdoptCustomProgram,
    handleStartCustomProgramSession,
    editProgramExercise,
    handleRenameCustomProgram,
    handleRenameProgramSession,
    handleReorderProgramSession,
    handleAddProgramSession,
    handleRemoveProgramSession,
    handleSaveRhythm,
    handleSaveEmphasis,
    handleDeleteCustomWorkout,
    sessionAdaptationFor,
    adaptSession,
    templateBuilderDraft,
    exerciseBrowserItems,
    recentExerciseBrowserItems,
    upsertWorkoutTemplate,
    showToast,
    exercisePrLookupBefore,
    finishLoggedWorkoutSave,
    exerciseLibrary,
    liftHistory,
    plateauNotice,
    freestyleDraft,
    saveFreestyleDraft,
    clearFreestyleDraft,
    sameLibraryRow,
    guidedEntryEyebrow,
    guidedWeekProgress,
    guidedNextUp,
    getWorkoutLoggerFallbackRoute,
    handleDiscardWorkout,
    handleConfirmFinishWorkout,
    finishSaveState,
    customWorkouts,
    recommendedReadyProgramId,
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
    trackedProgress,
    workoutSessions,
    handleEnrolSeason,
    programsCatalogItems,
    catalogScreenItems,
    proUnlocked,
    programsCategoryCounts,
    programsCategoryMembers,
    programsRecommendations,
    programsGoals,
    programsCustomItems,
    exerciseNameBook,
    teachExerciseName,
    handlePickProgramImage,
  } = deps;

  /**
   * Learned is stored by library item id; a course lists library names. The
   * lookup happens here rather than in the pure module, which has no business
   * knowing about the library.
   *
   * Above every branch, because three of them read it — the Learn rail on the
   * tab, the Learn index and the library. It used to sit beside the first of
   * those readers, and adding the rail put a reader above the declaration: in
   * a release bundle `const` becomes `var`, so that was not a ReferenceError
   * naming the variable but `undefined` reaching a callback, and the app died
   * two frames away in resolveCollectionProgress.
   *
   * Being above every branch means it runs for every workout screen, so it
   * has to be cheap for the screens that never read it. The guided player is
   * one of those and re-renders on every rest-timer tick; the naive version
   * walked all 876 browser items calling `.includes` on an array for each,
   * which is 876 × learned comparisons per tick. Nothing learned yet is the
   * common case and costs nothing now, and the worst case is 876 hash
   * lookups.
   */
  const learnedIds = new Set(preferences.learnedExerciseLibraryItemIds);
  const learnedExerciseNames =
    learnedIds.size === 0
      ? NOTHING_LEARNED
      : exerciseBrowserItems.filter((item) => learnedIds.has(item.id)).map((item) => item.name);

  if (route.tab !== 'workout') {
    return null;
  }

  /**
   * The composed week, but only while it is still what the reader would run.
   *
   * Composing renames every day, so a plan that names the catalog's own days
   * cannot find one of them in the composed week — and the day page renders
   * an empty screen for a day row that was right there on Home. Once the
   * programme is adopted, the plan's days are the truth; before that, the
   * composed week is what the reader was shown and promised.
   */
  const resolveComposedWeekForRoute = (workoutTemplateId: string) => {
    if (preferences.recommendedProgramId !== workoutTemplateId || !setupSelection) {
      return null;
    }
    /*
     * And only while the composed week is the only version of it.
     *
     * Onboarding saves what it composed as a programme of the reader's own,
     * and that copy is what they train. This page is the catalog
     * programme's page: its day editor and its adopt button work on the
     * original. Showing the copy's week here made a page whose days and
     * whose buttons disagreed — the reader tapped a day they had been
     * shown on Home and edited something else (audit round 4, 2026-09-20).
     * The copy has a page of its own, which is where its week belongs.
     */
    if (findReadyProgrammeCopyId(workoutTemplateId, database.workoutTemplates)) {
      return null;
    }
    const composed = composeProgramWeekForSelection(setupSelection, workoutTemplateId);
    if (!composed) {
      return null;
    }
    const planSessionIds = database.workoutPlans
      .flatMap((plan) => plan.entries)
      .filter((entry) => entry.workoutTemplateId === workoutTemplateId)
      .map((entry) => entry.workoutTemplateSessionId);
    return composedWeekMatchesPlan(composed.sessions.map((session) => session.id), planSessionIds)
      ? composed
      : null;
  };

  if (route.screen === 'program') {
    const readyTemplate = route.programType === 'ready' ? getWorkoutTemplateById(route.workoutTemplateId) : null;
    const customTemplate = route.programType === 'custom' ? customWorkoutRuntimeMap[route.workoutTemplateId] ?? null : null;
    // Truth rule: when this is the user's active program, the detail
    // shows the composed week they actually run, not the raw catalog.
    const readyComposedWeek = readyTemplate ? resolveComposedWeekForRoute(route.workoutTemplateId) : null;
    const readyProgramMinutesOptions = { availableEquipment: availableEquipmentForDrills, overrides: preferences.routineDrillOverrides };
    const readyProgramFitExplanation =
      readyTemplate && setupSelection && setupRecommendation?.featuredProgramId === readyTemplate.id
        ? buildFirstRunRecommendationReasons(setupSelection, {
            projectedDaysPerWeek: readyTemplate.daysPerWeek,
            // The page's own minutes, not the catalog's hand-written number:
            // the badge said 35 and this line summed 50 (bug hunt, B14).
            estimatedSessionDuration: readyProgramSessionMinutes(readyTemplate, readyComposedWeek, readyProgramMinutesOptions),
            mismatchNote: setupRecommendation.mismatchNote,
            language: preferences.appLanguage,
          }, tailoringPreferences).join(' ')
        : null;
    const readyProgramTailoringBadges = buildTailoringBadgeLabels(tailoringPreferences).slice(0, 3);
    /*
     * The reader's own version of this programme, when they have a live one.
     *
     * Not to answer the page's questions with. This page belongs to the
     * catalog programme: it draws the catalog's week, its rhythm editor
     * writes the catalog plan, its delete forgets the catalog plan, and
     * every prop on it names the id in the route. Resolving those against
     * the copy instead needed a new exception for each one — the start that
     * asked for a plan the catalog id has no entry in, the delete that named
     * one programme and removed another, the rhythm controls that vanished —
     * and there is always another prop (CI review of #163, three rounds).
     *
     * So the page says what it is, and the one button that would otherwise
     * lie takes the reader to their own version. The day editor has answered
     * this way since 2026-08-26, with this same toast.
     *
     * Running first, then merely held. A copy nothing points at is a
     * leftover — forgetting a programme drops its plan and leaves the
     * template standing — and a leftover is not a page to be sent to.
     */
    const heldTemplateIds = database.workoutPlans
      .map((plan) => plan.entries[0]?.workoutTemplateId)
      .filter((id): id is string => typeof id === 'string');
    const ownProgrammeCopyId =
      route.programType === 'ready' && !activeProgramTemplateIds.includes(route.workoutTemplateId)
        ? findHeldReadyProgrammeCopyId(route.workoutTemplateId, database.workoutTemplates, [
            ...activeProgramTemplateIds,
            ...heldTemplateIds,
          ])
        : null;
    // Membership is asked of the template, not the plan id — a programme
    // joined during onboarding carries a different plan id for the same
    // programme, and it is no less the reader's own.
    const programIsMine = activeProgramTemplateIds.includes(route.workoutTemplateId);
    // Held: a plan exists for it, running or not — see listHeldProgrammes.
    const programIsHeld = programIsMine || heldTemplateIds.includes(route.workoutTemplateId);
    const canDeleteProgram = route.programType === 'custom' || programIsHeld;
    // Held is not the same as leading. A programme you hold but do not lead
    // with has a third answer — put it on Home — and without it the only way
    // there was to remove whatever was leading.
    const programLeads = homeActivePlanCard?.programId === route.workoutTemplateId;
    const readyProgramIsMine = route.programType === 'ready' && programLeads;
    // The switch is ACTIVE, one programme's, and read off the same rows the
    // list tags — so the switch, the tag and the question below cannot name
    // three different programmes. It said "running" and every programme the
    // reader held read as on, beside one ACTIVE tag (user 2026-09-21).
    const switchedFrom = programmeSwitchedFrom(programsCustomItems, route.workoutTemplateId);
    const programIsActive = programsCustomItems.some(
      (row) => row.active && row.id === route.workoutTemplateId,
    );
    // What switching the active programme off offers in its place: the next
    // one running, or one the reader switched off — only a programme the list
    // can open, by the name it gives it (user 2026-09-22).
    const switchTo = programmeToSwitchTo({
      activePlanId: preferences.activePlanId,
      activePlanIds: preferences.activePlanIds,
      plans: database.workoutPlans,
      templateId: route.workoutTemplateId,
      shown: programsCustomItems.map((row) => row.id),
      // The reader's own programmes with no plan yet, that have a lift to
      // train: "your programmes" lists them, so they are other programmes.
      unstarted: programsCustomItems
        .filter(
          (row) =>
            row.programType === 'custom' &&
            !database.workoutPlans.some((plan) => plan.entries[0]?.workoutTemplateId === row.id) &&
            (customWorkoutRuntimeMap[row.id]?.sessions ?? []).some((session) => session.exercises.length > 0),
        )
        .map((row) => row.id),
    });
    const switchToName = switchTo
      ? programsCustomItems.find((row) => row.id === switchTo.templateId)?.name ?? null
      : null;
    const program = readyTemplate
      ? buildReadyProgramDetail(
          readyTemplate,
          programInsightsByTemplateId[route.workoutTemplateId],
          readyProgramFitExplanation,
          readyProgramTailoringBadges,
          readyComposedWeek,
          preferences.appLanguage,
          readyProgramIsMine,
          programIsMine && !programLeads,
          readyProgramMinutesOptions,
        )
      : customTemplate
        ? buildCustomProgramDetail(
            customTemplate,
            programInsightsByTemplateId[route.workoutTemplateId],
            preferences.appLanguage,
            programIsMine && programLeads,
            programIsMine && !programLeads,
          )
        : null;
    // The plan's entries, in stored order — the order the week strip reads
    // both its days and the session on each of them.
    const detailPlanEntries = livePlanEntries(
      database.workoutPlans.find((plan) => plan.entries[0]?.workoutTemplateId === route.workoutTemplateId)
        ?.entries ?? [],
      templateSessionsReader(database),
    );

    return program ? (
      <ProgramDetailScreen
        language={preferences.appLanguage}
        program={program}
        // The template's own progression rules and audience. Custom programs
        // have neither — they are the reader's own sessions with no rule
        // attached, and inventing one would invent the whole section.
        progressionRules={readyTemplate?.progressionRules ?? null}
        audience={
          readyTemplate
            ? getReadyProgramContent(readyTemplate.id, preferences.appLanguage)?.audience ?? null
            : null
        }
        whyItWorks={
          readyTemplate
            ? getReadyProgramContent(readyTemplate.id, preferences.appLanguage)?.whyItWorks ?? null
            : null
        }
        equipment={
          readyTemplate
            ? resolveProgramEquipment(
                readyTemplate.sessions.flatMap((session) =>
                  session.exercises.map((exercise) => exercise.exerciseName),
                ),
              )
            : []
        }
        availableEquipment={availableEquipmentForDrills}
        fitReason={
          // Why this program, relative to the one being run. The reason was
          // computed for the browse row and stopped there; the screen with
          // room to explain it never received it.
          readyTemplate && homeActivePlanCard?.programId
            ? (() => {
                const match = resolveProgramAffinity(
                  workout.templates.find((entry) => entry.id === homeActivePlanCard.programId),
                  workout.templates,
                  8,
                ).find((entry) => entry.templateId === readyTemplate.id);
                return match
                  ? t(preferences.appLanguage, AFFINITY_REASON_KEYS[match.reason], {
                      days: readyTemplate.daysPerWeek,
                    })
                  : null;
              })()
            : null
        }
        activePlanSummary={
          homeActivePlanCard?.programId === route.workoutTemplateId && homeActivePlanCard.programType === route.programType
            ? {
                weekLabel: homeActivePlanCard.weekLabel,
                progressPercent: homeActivePlanCard.progressPercent,
                sessionsPerWeek: homeActivePlanCard.sessionsPerWeek,
                weeklyMinutes: homeActivePlanCard.weeklyMinutes,
              }
            : null
        }
        onBack={() => navigateBack(workoutHomeRoute)}
        active={programIsActive}
        // Held is wider than active: every programme the reader holds keeps
        // its switch — off unless it is the active one — rather than offering
        // to adopt it again (device, 2026-09-16).
        held={programIsHeld}
        // On makes it the active programme, resumed under the plan it already
        // has; off stops it, and the lead passes on. A programme the reader
        // never took up still gets the adopt button instead.
        onSetActive={(next) => {
          void (next ? onResumeProgram(route.workoutTemplateId) : onStopProgram(route.workoutTemplateId));
        }}
        switchingFrom={switchedFrom?.name ?? null}
        stoppingHandsTo={switchToName}
        // Switching the active one off asks first: make the other one active,
        // or, with nothing else held, look for a new one in the catalogue.
        onSwitchOff={
          switchTo && switchToName
            ? () => void onSwitchActiveProgram(route.workoutTemplateId, switchTo)
            : undefined
        }
        onBrowseProgrammes={() => {
          void onStopProgram(route.workoutTemplateId).then(() => navigate({ tab: 'workout', screen: 'catalog' }));
        }}
        // Only the adopt answers make this programme active; the button's
        // other answers start a session, open an editor or the reader's own
        // version, and switch nothing.
        primaryActionActivates={
          route.programType === 'ready'
            ? !readyProgramIsMine && !ownProgrammeCopyId
            : !programLeads && Boolean(customTemplate?.sessions.some((session) => session.exercises.length > 0))
        }
        onPrimaryAction={() => {
          if (readyProgramIsMine) {
            // Already the reader's. Adoption returns early for a programme it
            // already holds, so this button used to read like a decision and do
            // nothing but navigate Home. It now starts the session the rotation
            // actually offers next — the label says so.
            const nextSessionId = resolveNextSessionIdForTemplate(route.workoutTemplateId);
            if (nextSessionId) {
              handleStartReadyProgramSession(route.workoutTemplateId, nextSessionId);
              return;
            }
            navigate(ROOT_ROUTES.home);
            return;
          }

          if (route.programType === 'ready') {
            if (ownProgrammeCopyId) {
              // They already train their own version of this programme.
              // Adopting the catalog original beside it would give one
              // programme two rows, two plans and two slots of the cap, and
              // the handler resuming the copy instead left this page saying
              // "started" while nothing on it changed (audit round 4,
              // 2026-09-20 and its review). Their version has a page of its
              // own; this is the way to it.
              showToast(t(preferences.appLanguage, 'toast.ownProgrammeVersion'));
              navigate({
                tab: 'workout',
                screen: 'program',
                programType: 'custom',
                workoutTemplateId: ownProgrammeCopyId,
              });
              return;
            }
            // The button says "Ota ohjelma käyttöön" and it now does that. It
            // called handleStartReadyProgram, which starts the first SESSION
            // and never touches the active plan — so a reader who pressed it
            // trained one workout and then found Home still running whatever
            // it ran before. handleAdoptReadyProgram existed the whole time
            // and was wired only to the season screen.
            // It stays on this page (device, 2026-09-16): being carried to
            // Home the moment a programme was adopted read as the app leaving
            // the page the reader was on. At the free limit the sheet opens
            // here, on the programme they asked for; otherwise the switch
            // that replaces the button says it is running, and the toast says
            // so after the write, not before.
            void handleAdoptReadyProgram(route.workoutTemplateId, { lead: true }).then((adopted) => {
              if (adopted) {
                showToast(t(preferences.appLanguage, 'toast.programStarted'));
              }
            });
            return;
          }

          if (!customTemplate?.sessions.some((session) => session.exercises.length > 0)) {
            navigate({ tab: 'workout', screen: 'template', workoutTemplateId: route.workoutTemplateId });
            return;
          }

          // Already running it: start what the rotation offers next, the same
          // answer a ready programme gives. Otherwise put it on Home, which is
          // what the button now says and what it could not previously do.
          if (programLeads) {
            handleStartCustomProgram(route.workoutTemplateId);
            return;
          }

          // Held but not leading, or not held at all — both are answered by
          // adoption, which now promotes rather than returning early.
          void handleAdoptCustomProgram(route.workoutTemplateId, { lead: true }).then((adopted) => {
            if (adopted) {
              showToast(t(preferences.appLanguage, 'toast.programStarted'));
            }
          });
        }}
        onStartSession={(sessionId) => {
          if (route.programType === 'ready') {
            handleStartReadyProgramSession(route.workoutTemplateId, sessionId);
            return;
          }

          handleStartCustomProgramSession(route.workoutTemplateId, sessionId);
        }}
        trainingDayIndexes={planWeekdayIndexes(detailPlanEntries)}
        // Same entries, same order: which session each of those days holds.
        trainingDaySessionIds={detailPlanEntries.map((entry) => entry.workoutTemplateSessionId ?? null)}
        routineSeconds={routineSecondsForExercises}
        // Custom only, like every other edit here: a ready programme's name
        // is catalog data, and a reader who wants their own version of one
        // gets a custom copy the moment they change a lift in it.
        readerSessionNames={preferences.readerSessionNames}
        onRenameProgram={
          route.programType === 'custom'
            ? (name) => void handleRenameCustomProgram(route.workoutTemplateId, name)
            : undefined
        }
        // Custom only: reordering a catalog programme would mean copying it,
        // and nobody asks for a copy by dragging.
        onReorderSession={
          route.programType === 'custom'
            ? (sessionId, toIndex) =>
                void handleReorderProgramSession(route.workoutTemplateId, sessionId, toIndex)
            : undefined
        }
        // Custom only, like the reorder. The new day opens once it is saved,
        // empty, on the page where its lifts are added.
        onAddSession={
          route.programType === 'custom'
            ? (name) =>
                void handleAddProgramSession(route.workoutTemplateId, name).then(
                  (added) => {
                    if (!added) {
                      return;
                    }
                    // The day is saved either way; only the week can lag.
                    if (added.weekSynced) {
                      void haptics.success();
                    } else {
                      showToast(t(preferences.appLanguage, 'toast.planWeekOutOfStep'));
                    }
                    const sessionId = added.sessionId;
                    navigate({
                      tab: 'workout',
                      screen: 'programDay',
                      programType: 'custom',
                      workoutTemplateId: route.workoutTemplateId,
                      sessionId,
                    });
                  },
                  (error) => {
                    console.error('Failed to add a day to the programme', error);
                    void haptics.error();
                    showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
                  },
                )
            : undefined
        }
        onSaveRhythm={
          database.workoutPlans.some((plan) => plan.entries[0]?.workoutTemplateId === route.workoutTemplateId)
            ? (dayIndexes) =>
                void handleSaveRhythm(route.workoutTemplateId, dayIndexes).then(
                  (saved) => {
                    if (!saved) {
                      void haptics.error();
                      showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
                    }
                  },
                  (error) => {
                    console.error('Failed to save the programme rhythm', error);
                    void haptics.error();
                    showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
                  },
                )
            : undefined
        }
        // The cycle is the app's one schedule, so it is offered exactly where
        // the weekday rhythm is: on a programme that has a plan behind it.
        trainingCycle={preferences.trainingCycle}
        onChangeTrainingCycle={
          database.workoutPlans.some((plan) => plan.entries[0]?.workoutTemplateId === route.workoutTemplateId)
            ? (cycle) => void updatePreferences({ trainingCycle: cycle })
            : undefined
        }
        onSaveEmphasis={
          route.programType === 'custom'
            ? (updates) => void handleSaveEmphasis(route.workoutTemplateId, updates)
            : undefined
        }
        onOpenSession={(sessionId) =>
          navigate({
            tab: 'workout',
            screen: 'programDay',
            programType: route.programType,
            workoutTemplateId: route.workoutTemplateId,
            sessionId,
          })
        }
        // Deleting is its own action, apart from the switch (device,
        // 2026-09-16): a custom programme deletes its template, a held ready
        // programme drops every plan that holds it. A catalog programme the
        // reader never took up has nothing of theirs to delete.
        destructiveActionLabel={canDeleteProgram ? t(preferences.appLanguage, 'detail.delete') : undefined}
        destructiveActionTitle={canDeleteProgram ? t(preferences.appLanguage, 'detail.delete.title') : undefined}
        destructiveActionMessage={
          canDeleteProgram
            ? t(preferences.appLanguage, 'detail.delete.message', { program: program.title })
            : undefined
        }
        onDestructiveAction={
          route.programType === 'custom'
            ? () => void handleDeleteCustomWorkout(route.workoutTemplateId)
            : programIsHeld
              ? () => void onForgetHeldProgram(route.workoutTemplateId)
              : undefined
        }
      />
    ) : (
      <View />
    );
  }

  if (route.screen === 'programDay') {
    const readyTemplate = route.programType === 'ready' ? getWorkoutTemplateById(route.workoutTemplateId) : null;
    const customTemplate = route.programType === 'custom' ? customWorkoutRuntimeMap[route.workoutTemplateId] ?? null : null;
    const program = readyTemplate
      ? buildReadyProgramDetail(
          readyTemplate,
          programInsightsByTemplateId[route.workoutTemplateId],
          null,
          [],
          resolveComposedWeekForRoute(route.workoutTemplateId),
          preferences.appLanguage,
          false,
          false,
          { availableEquipment: availableEquipmentForDrills, overrides: preferences.routineDrillOverrides },
        )
      : customTemplate
        ? buildCustomProgramDetail(customTemplate, programInsightsByTemplateId[route.workoutTemplateId], preferences.appLanguage)
        : null;
    const daySession = program?.sessions.find((session) => session.id === route.sessionId) ?? null;
    const dayIndex = daySession ? program!.sessions.findIndex((session) => session.id === route.sessionId) : -1;
    // The same pair the programme page starts this day with.
    const daySessionRef: AdaptedSessionRef = { programId: route.workoutTemplateId, sessionId: route.sessionId };

    return program && daySession ? (
      <ProgramDayScreen
        language={preferences.appLanguage}
        programTitle={program.title}
        session={daySession}
        dayNumber={dayIndex + 1}
        dayCount={program.sessions.length}
        availableEquipment={availableEquipmentForDrills}
        routineDrillOverrides={preferences.routineDrillOverrides}
        // Permanent by nature: the drills are generated from the session
        // focus, so a choice belongs to every day with that focus rather
        // than to this one. There is no "just this time" to offer.
        onSwapRoutineDrill={(slotKey: string, drillKey: string) =>
          void updatePreferences((current) => ({
            routineDrillOverrides: { ...current.routineDrillOverrides, [slotKey]: drillKey },
          }))
        }
        // Held for this day of this programme: slot ids repeat across days,
        // so a swap made here is not an answer about any other day.
        sessionSwaps={sessionAdaptationFor(daySessionRef).swaps}
        onSwapExercise={(slotId, exerciseName) =>
          adaptSession(daySessionRef, (current) => withSessionSwap(current, slotId, exerciseName))
        }
        exerciseLibrary={exerciseBrowserItems}
        recentExerciseLibraryItems={recentExerciseBrowserItems}
        onAddExercises={(exerciseNames) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, '', {
            kind: 'add',
            exerciseNames,
          })
        }
        onRemoveExercise={(exerciseId) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, exerciseId, {
            kind: 'remove',
          })
        }
        onKeepSwap={(exerciseId, exerciseName) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, exerciseId, {
            kind: 'replace',
            exerciseName,
          })
        }
        onPrescribe={(exerciseId, prescription) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, exerciseId, {
            kind: 'prescribe',
            prescription,
          })
        }
        onReorderExercise={(exerciseId, toIndex) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, exerciseId, {
            kind: 'reorder',
            toIndex,
          })
        }
        onSupersetLink={(exerciseId, linked) =>
          void editProgramExercise(route.programType, route.workoutTemplateId, daySession.id, exerciseId, {
            kind: 'supersetLink',
            linked,
          })
        }
        tailoringPreferences={preferences}
        // A catalog day's roles are the catalog's decision; a custom day's
        // are derived, and would tag every row the same.
        showRoles={route.programType === 'ready'}
        readerNamed={isReaderNamedSession(preferences.readerSessionNames, daySession)}
        // Custom only, like the programme's own name.
        onRenameSession={
          route.programType === 'custom'
            ? (name) => void handleRenameProgramSession(route.workoutTemplateId, daySession.id, name)
            : undefined
        }
        // Back to the programme page first, then the write. The route names
        // this day, so once the day is gone the page has nothing left to draw
        // and would flash blank until a navigation queued behind the write
        // caught up. What says it worked is the row leaving the list under
        // the reader's eyes, and the haptic — both after the write lands.
        onRemoveSession={
          route.programType === 'custom' && program.sessions.length > 1
            ? () => {
                navigateBack({
                  tab: 'workout',
                  screen: 'program',
                  programType: route.programType,
                  workoutTemplateId: route.workoutTemplateId,
                });
                void handleRemoveProgramSession(route.workoutTemplateId, daySession.id).then(
                  (removed) => {
                    if (!removed) {
                      return;
                    }
                    if (removed.weekSynced) {
                      void haptics.success();
                    } else {
                      showToast(t(preferences.appLanguage, 'toast.planWeekOutOfStep'));
                    }
                  },
                  (error) => {
                    console.error('Failed to remove a day from the programme', error);
                    void haptics.error();
                    showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
                  },
                );
              }
            : undefined
        }
        onBack={() => navigateBack({ tab: 'workout', screen: 'program', programType: route.programType, workoutTemplateId: route.workoutTemplateId })}
      />
    ) : (
      <View />
    );
  }

  if (route.screen === 'template') {
    return (
      <CreateTemplateScreen
        language={preferences.appLanguage}
        key={route.workoutTemplateId ?? 'new_template'}
        initialDraft={templateBuilderDraft}
        exerciseLibrary={exerciseBrowserItems}
        recentExerciseLibraryItems={recentExerciseBrowserItems}
        defaultRestSeconds={preferences.defaultRestSeconds}
        onBack={() => navigateBack(workoutHomeRoute)}
        onSave={async (draft) => {
          let workoutTemplateId: string;
          try {
            workoutTemplateId = await upsertWorkoutTemplate(draft);
          } catch (error) {
            // The only one of the eight `upsertWorkoutTemplate` callers that
            // had no answer for a refused write: the programme cap throws, the
            // storage layer throws, and "Tallenna" did nothing at all — no
            // message, no retry, no sign it had been refused (audit 3).
            if (error instanceof ProgramLimitReachedError) {
              setProgramLimitVisible(true);
              return;
            }
            console.error('Failed to save the programme', error);
            void haptics.error();
            showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
            return;
          }
          // And the plan follows the days. The template is half the record:
          // the plan pins each day to a weekday and decides which comes next,
          // and this editor can add and remove days.
          //
          // Its own catch, and its own sentence. The template is saved by the
          // time this runs, so "could not save" would be false — but a plan
          // write the storage refuses rethrows, and an unhandled rejection
          // here would have skipped the haptic and the navigation both: the
          // reader would have seen the button do nothing, with the programme
          // saved and its week out of step behind them (CI review of #146).
          let weekSynced = true;
          try {
            await syncPlanToTemplate(workoutTemplateId);
          } catch (error) {
            console.error('Failed to bring the plan into step with the template', error);
            weekSynced = false;
          }
          if (weekSynced) {
            // Was an untranslated "Template saved" — English on a Finnish
            // screen, saying what the programme page opening right after it
            // already says. The haptic carries it now (user 2026-08-26).
            void haptics.success();
          } else {
            showToast(t(preferences.appLanguage, 'toast.planWeekOutOfStep'));
          }
          replaceRoute({ tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId });
        }}
      />
    );
  }

  if (route.screen === 'empty') {
    return (
      <EmptyWorkoutScreen
        language={preferences.appLanguage}
        freestyleDraft={freestyleDraft}
        onSaveDraft={saveFreestyleDraft}
        onClearDraft={clearFreestyleDraft}
        exerciseLibrary={exerciseBrowserItems}
        recentExerciseLibraryItems={recentExerciseBrowserItems}
        defaultRestSeconds={preferences.defaultRestSeconds}
        keepScreenAwake={preferences.keepScreenAwakeDuringWorkout}
        exercisePrLookupBefore={exercisePrLookupBefore}
        restAlerts={{
          // Their own switches and the OS permission, not the phone's
          // Notifications switch: that one governs the scheduled reminders
          // (user 2026-09-17). Gated on it, the end-of-rest alert was silent
          // on every phone where the first-rest ask never had to open.
          alerts: preferences.notificationPrefs.restAlerts,
          warning: preferences.notificationPrefs.restWarning,
          ongoing: preferences.notificationPrefs.sessionOngoing,
          asked: preferences.notificationPrefs.restAlertsAsked,
        }}
        onRestAlertsAnswered={(outcome) =>
          void updatePreferences((current) => ({
            notificationPrefs: restAlertsAnswered(current.notificationPrefs, outcome),
          }))
        }
        onOpenSystemSettings={() => void openRestAlertSettings()}
        onBack={() => navigateBack(ROOT_ROUTES.home)}
        onSave={async (draft, summary, adoptSessionId) => {
          try {
            // Freestyle logging is not authoring: the template exists only so
            // the session has something to hang on, so it carries the flag
            // that keeps it out of the free cap. The date is what makes three
            // of them tellable apart in a list.
            await finishLoggedWorkoutSave(
              {
                ...draft,
                name: `${draft.name.trim()} ${formatShortDate(
                  summary.performedAt,
                  preferences.appLanguage,
                )}`,
                origin: 'freestyle',
              },
              summary,
              adoptSessionId,
            );
          } catch (error) {
            console.error('Failed to save freestyle workout', error);
            showToast(t(preferences.appLanguage, 'toast.saveWorkoutFailed'));
            throw error;
          }
        }}
      />
    );
  }

  if (route.screen === 'guided') {
    return (
      <GuidedPlayerScreen
        keepScreenAwake={preferences.keepScreenAwakeDuringWorkout}
        unitPreference={unitPreference}
        availableEquipment={availableEquipmentForDrills}
        routineDrillOverrides={preferences.routineDrillOverrides}
        tailoringPreferences={tailoringPreferences}
        exerciseLibrary={exerciseLibrary}
        liftHistory={liftHistory}
        plateauNotice={plateauNotice}
        soundCuesEnabled={preferences.soundCuesEnabled}
        onToggleSoundCues={(next) => void updatePreferences({ soundCuesEnabled: next })}
        language={preferences.appLanguage}
        entryEyebrow={guidedEntryEyebrow}
        ownBlockStats={preferences.ownBlockStats}
        onRecordOwnBlock={(phase, seconds) =>
          void updatePreferences((current) => ({
            ownBlockStats: recordOwnBlock(current.ownBlockStats, phase, seconds),
          }))
        }
        learnedExerciseIds={preferences.learnedExerciseLibraryItemIds}
        techniqueChecks={preferences.exerciseTechniqueChecks}
        onToggleTechniqueStatement={(libraryItemId, index) =>
          void updatePreferences((current) => ({
            exerciseTechniqueChecks: toggleTechniqueStatement(
              current.exerciseTechniqueChecks,
              libraryItemId,
              index,
            ),
          }))
        }
        onToggleExerciseLearned={(libraryItemId) => {
          void updatePreferences(({ learnedExerciseLibraryItemIds: current }) => ({
            learnedExerciseLibraryItemIds: current.includes(libraryItemId)
              ? current.filter((id) => id !== libraryItemId)
              : [...current, libraryItemId],
          }));
        }}
        weekProgress={guidedWeekProgress}
        nextUp={guidedNextUp}
        onLeave={() => navigateBack(getWorkoutLoggerFallbackRoute())}
        onEndSession={() => void handleDiscardWorkout()}
        onFinishSession={() => void handleConfirmFinishWorkout()}
        isSavingWorkout={finishSaveState.status === 'saving'}
        saveFailed={finishSaveState.status === 'error'}
        // Set by navigateToActiveWorkout — the reader pressed "resume", so the
        // player opens on the set instead of the session overview.
        autoResume={route.resume === true}
        restAlerts={{
          // Their own switches and the OS permission, not the phone's
          // Notifications switch: that one governs the scheduled reminders
          // (user 2026-09-17). Gated on it, the end-of-rest alert was silent
          // on every phone where the first-rest ask never had to open.
          alerts: preferences.notificationPrefs.restAlerts,
          warning: preferences.notificationPrefs.restWarning,
          ongoing: preferences.notificationPrefs.sessionOngoing,
          asked: preferences.notificationPrefs.restAlertsAsked,
        }}
        onRestAlertsAnswered={(outcome) =>
          void updatePreferences((current) => ({
            notificationPrefs: restAlertsAnswered(current.notificationPrefs, outcome),
          }))
        }
        onOpenSystemSettings={() => void openRestAlertSettings()}
      />
    );
  }

  if (route.screen === 'plans') {
    return (
      <WorkoutsScreen
        language={preferences.appLanguage}
        customWorkouts={customWorkouts}
        programInsightsByTemplateId={programInsightsByTemplateId}
        recommendedReadyProgramId={recommendedReadyProgramId}
        tailoringPreferences={tailoringPreferences}
        onOpenWorkout={navigateToGuidedWorkout}
        onOpenReadyProgram={handleOpenProgramDetail}
        onStartReadyProgram={handleStartReadyProgram}
        onOpenCustomProgram={handleOpenCustomProgramDetail}
        onStartCustomWorkout={handleStartCustomProgram}
        onCreateWorkout={() => navigate({ tab: 'workout', screen: 'template' })}
      />
    );
  }

  if (route.screen === 'detail') {
    const exercise = exerciseBrowserItems.find((item) => item.id === route.exerciseId) ?? null;
    return exercise ? (
      <ExerciseDetailScreen
        language={preferences.appLanguage}
        item={exercise}
        // Every log that is this row, not only the ones spelled like it: an
        // onboarding programme logs "Bench Press" against the library's
        // "Barbell Bench Press - Medium Grip". A variation filed as its own
        // row (sumo, trap bar) stays on its own page.
        history={getExerciseProgressForName(database, exercise.name, sameLibraryRow)}
        unitPreference={unitPreference}
        // Decides whether this lift's caution is for this reader.
        cautionFlags={preferences.setupCautionFlags}
        checkedStatements={preferences.exerciseTechniqueChecks[exercise.id] ?? []}
        onToggleStatement={(index) => {
          void updatePreferences((current) => ({
            exerciseTechniqueChecks: toggleTechniqueStatement(
              current.exerciseTechniqueChecks,
              exercise.id,
              index,
            ),
          }));
        }}
        learned={preferences.learnedExerciseLibraryItemIds.includes(exercise.id)}
        onToggleLearned={() => {
          void updatePreferences(({ learnedExerciseLibraryItemIds: current }) => ({
            learnedExerciseLibraryItemIds: current.includes(exercise.id)
              ? current.filter((id) => id !== exercise.id)
              : [...current, exercise.id],
          }));
        }}
        // An easier/harder row opens that lift's own screen. Resolved by name
        // because the teaching content names lifts the way the library does;
        // a name with no entry simply does not navigate rather than opening a
        // blank screen.
        onOpenExercise={(exerciseName) => {
          const target = exerciseBrowserItems.find((candidate) => candidate.name === exerciseName);
          if (target) {
            navigate({ tab: 'workout', screen: 'detail', exerciseId: target.id });
          }
        }}
        onBack={() => navigateBack(ROOT_ROUTES.workout)}
      />
    ) : (
      <View />
    );
  }

  if (route.screen === 'catalog') {
    return (
      <CatalogScreen
        language={preferences.appLanguage}
        items={catalogScreenItems}
        onBack={() => navigateBack(workoutHomeRoute)}
        onOpenProgram={(programId) =>
          navigate({ tab: 'workout', screen: 'program', programType: 'ready', workoutTemplateId: programId })
        }
      />
    );
  }

  if (route.screen === 'goalFlow') {
    return (
      <StrengthGoalFlowScreen
        language={preferences.appLanguage}
        lifts={goalFlowLifts}
        unitLabel={preferences.unitPreference}
        getProposal={getGoalProposal}
        onBack={() => navigateBack(ROOT_ROUTES.workout)}
        // The cap is the adoption's business, not this screen's: full on the
        // free tier routes to the paywall and full on Pro says so, both from
        // inside handleAdoptReadyProgram.
        onCreate={(input) => void handleAcceptTargetProposal(input)}
      />
    );
  }

  if (route.screen === 'season') {
    /**
     * The season screen.
     *
     * Every number on it is the reader's own: points from their logged
     * sessions against a stated rule, the weekly requirement from their own
     * program's days, records from their own bests. The one section that
     * needs other people — the series — says so instead of inventing names.
     */
    const seasonInView = route.season;
    // The window of the season being looked at. Resolving from today meant an
    // upcoming season's points were counted against the CURRENT season's
    // dates — a screen full of numbers belonging to a different season.
    const currentWindow = resolveSeasonWindow();
    const seasonWindow = currentWindow.season === seasonInView ? currentWindow : nextSeasonWindow();
    // THE season program: one per season, the same one for everyone, and it
    // does not change mid-season. Ten of them meant ten different point
    // ceilings and a ranking sorted by how many days a program prescribes.
    const seasonProgramId = getSeasonProgramId(seasonInView);
    const seasonProgramTemplate = workout.templates.find((template) => template.id === seasonProgramId);
    const seasonRecords = countSeasonRecords(
      trackedProgress.map((summary) => ({
        logs: summary.logs.map((log) => ({
          weight: log.weight,
          // The best single set, so a rep record on an unloaded lift counts.
          reps: log.repsPerSet.length > 0 ? Math.max(...log.repsPerSet) : 0,
          performedAt: log.performedAt,
        })),
      })),
      seasonWindow,
    );
    const seasonProgress = computeSeasonProgress(workoutSessions, seasonWindow, {
      // The target is the SEASON program's week, not whatever the reader
      // happens to be running. Measuring a three-day season against someone's
      // own six-day split would call four workouts a missed week.
      weeklyTarget: seasonProgramTemplate?.daysPerWeek ?? null,
      records: seasonRecords,
      // The season programme and the reader's own copy of it. Changing one
      // lift in it makes a copy under a new id, and that used to end their
      // season without saying so.
      programIds: programmeLineageIds(seasonProgramId, database.workoutTemplates),
    });
    const seasonBadges = resolveSeasonBadges(seasonProgress, {
      // The current window is by definition the one containing today, so it
      // is never over. The finished badge belongs to a past season.
      seasonEnded: false,
      personalRecords: seasonRecords,
    });
    return (
      <SeasonScreen
        season={seasonInView}
        language={preferences.appLanguage}
        progress={seasonProgress}
        badges={seasonBadges}
        seasonProgram={{
          id: seasonProgramId,
          name: seasonProgramTemplate
            ? formatWorkoutDisplayLabel(seasonProgramTemplate.name)
            : seasonProgramId,
          blurb: getReadyProgramContent(seasonProgramId, preferences.appLanguage)?.summary ?? '',
          days: seasonProgramTemplate?.daysPerWeek ?? 0,
          fingerprint: seasonProgramTemplate ? buildProgramFingerprint(seasonProgramTemplate) : [],
        }}
        // "Start season" used to open the season programme's page and stop
        // there, so the button's own sentence was never true and the season
        // could not be joined at all. It joins now, and joining ADDS: the
        // reader's own programme stays exactly where it was.
        /*
         * In the season, or not — read from the sign-up as well as the plan.
         *
         * `seasonEnrolments` was written by the join and read by nothing:
         * `isEnrolled` was imported into App.tsx and never called, so the CTA
         * still decided everything from the active plan. Which is the exact
         * thing the enrolment record exists to stop — "changing programme
         * mid-season used to silently un-join you… It no longer can", says
         * `seasonEnrolment.ts`, and it still could (audit 3, 2026-09-19).
         */
        running={
          activeProgramTemplateIds.includes(seasonProgramId) ||
          isEnrolled(preferences.seasonEnrolments, seasonInView, seasonWindow.year)
        }
        onJoinSeason={() => {
          // Two things, and they are genuinely two: the row that says you are
          // in the season, and the programme swap that makes it trainable.
          //
          // Both about the season being LOOKED AT. This re-resolved from today
          // for the enrolment while adopting the viewed season's programme, so
          // opening the winter card in September and pressing "Aloita kausi"
          // filed the reader into summer and handed them the winter programme
          // (audit 3, 2026-09-19). `seasonWindow` above already resolves this
          // correctly, and every other number on the screen reads it.
          handleEnrolSeason(seasonInView, seasonWindow.year);
          void handleAdoptReadyProgram(seasonProgramId);
        }}
        onBack={() => navigateBack({ tab: 'workout', screen: 'programs_home' })}
        onOpenProgram={handleOpenProgramDetail}
        onStartToday={() => {
          if (homeActivePlanCard?.programId === seasonProgramId && homeActivePlanCard.nextSession?.id) {
            handleStartReadyProgramSession(seasonProgramId, homeActivePlanCard.nextSession.id);
            return;
          }
          handleOpenProgramDetail(seasonProgramId);
        }}
      />
    );
  }

  if (route.screen === 'programs_home') {
    /**
     * Learn, out of the library and onto the tab.
     *
     * Progress is resolved here because it needs the learned-exercise set and
     * the screen has no business reading it. Built once per render of this
     * branch rather than inline in the JSX, where it minted a new array and
     * six new row objects every time.
     */
    const learnedNames = new Set(learnedExerciseNames);
    const learnRows = getExerciseCollections(preferences.appLanguage).map((collection) => {
      const progress = resolveCollectionProgress(collection, (name) => learnedNames.has(name));
      return {
        id: collection.id,
        title: collection.title,
        blurb: collection.blurb,
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
        cover: collection.cover,
      };
    });

    return (
      <ProgramsHomeScreen
        language={preferences.appLanguage}
        // What setup was told, not what the plan happens to run: the sheet is
        // for choosing a programme, so the week to match is the reader's own.
        // Null when setup never asked, and then no row is recommended.
        readerDaysPerWeek={preferences.setupDaysPerWeek}
        // Setup's tier in the catalog's words. The two vocabularies collide on
        // "advanced", so this goes through the shared map rather than across
        // as-is.
        readerLevel={catalogLevelForSetup(preferences.setupLevel) ?? null}
        catalogItems={programsCatalogItems}
        categoryCounts={programsCategoryCounts}
        categoryMembers={programsCategoryMembers}
        recommendations={programsRecommendations}
        learnRows={learnRows}
        onOpenCollection={(collectionId) =>
          navigate({ tab: 'workout', screen: 'collection', collectionId })
        }
        onOpenLearnIndex={() => navigate({ tab: 'workout', screen: 'learn' })}
        goals={programsGoals}
        goalProgrammes={goalProgrammeSuggestions}
        onOpenGoalPicker={() => navigate({ tab: 'workout', screen: 'goalFlow' })}
        onRemoveGoal={(exerciseName) =>
          void updatePreferences((current) => ({
            strengthGoals: removeStrengthGoal(current.strengthGoals, exerciseName),
          }))
        }
        customPrograms={programsCustomItems}
        ownProgramsLine={(() => {
          const key = programSlotsLineKey(programSlots);
          return key
            ? t(preferences.appLanguage, `programLimit.${key}`, { used: programSlots.used, limit: programSlots.limit ?? 0 })
            : null;
        })()}
        exerciseLibraryCount={exerciseBrowserItems.length}
        exerciseLibraryEntries={exerciseBrowserItems}
        nameBook={exerciseNameBook}
        onTeachName={(wrote, exercise) => teachExerciseName(wrote, { name: exercise.name, libraryItemId: exercise.id })}
        onPickImage={handlePickProgramImage}
        onAiAssisted={() => navigate({ tab: 'home', screen: 'ai_chat' })}
        onBrowseCatalog={() => navigate({ tab: 'workout', screen: 'catalog' })}
        catalogCount={programsCatalogItems.length}
        proUnlocked={proUnlocked}
        onOpenPaywall={() => navigate({ tab: 'profile', screen: 'premium' })}
        onImportProgram={async (draft) => {
          const workoutTemplateId = await createUnlessAtLimit(
            () => upsertWorkoutTemplate(draft),
            () => setProgramLimitVisible(true),
          );
          if (!workoutTemplateId) {
            // Refused at the cap: the sheet keeps the table it read.
            return false;
          }
          navigate({ tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId });
          return true;
        }}
        onOpenExploreProgram={handleOpenProgramDetail}
        onOpenCustomProgram={handleOpenCustomProgramDetail}
        onCreateProgram={() =>
          programSlots.canCreate
            ? navigate({ tab: 'workout', screen: 'template' })
            : setProgramLimitVisible(true)
        }
        onOpenLibrary={() => navigate({ tab: 'workout', screen: 'list' })}
      />
    );
  }

  /**
   * Named, not a catch-all.
   *
   * This was `route.tab === 'workout'` with no screen check, which made the
   * exercise browser the silent destination for *any* workout route that
   * matched nothing above it — including a real one mid-transition. That is
   * how the summary dismissal came out as a flash of the browser rather than
   * as a visible routing bug: the fallback swallowed it and looked plausible.
   *
   * `list` is ROOT_ROUTES.workout, so this is still someone's real
   * destination. Anything else — including a summary whose guard state was
   * just cleared — returns null and falls to the dashboard safety net.
   */
  if (route.screen === 'learn') {
    return (
      <LearnIndexScreen
        language={preferences.appLanguage}
        collections={getExerciseCollections(preferences.appLanguage)}
        learnedExerciseNames={learnedExerciseNames}
        onBack={() => navigateBack(ROOT_ROUTES.workout)}
        onOpenCollection={(collectionId) =>
          navigate({ tab: 'workout', screen: 'collection', collectionId })
        }
      />
    );
  }

  if (route.screen === 'collection') {
    const collection = getExerciseCollection(route.collectionId, preferences.appLanguage);
    // An id with no course behind it renders nothing, which drops through to
    // the caller's dashboard safety net — the same thing every unclaimed
    // route in this file does. It does NOT navigate back, and saying so would
    // be a comment describing behaviour the code has not got.
    if (!collection) {
      return null;
    }
    return (
      <CollectionScreen
        language={preferences.appLanguage}
        collection={collection}
        learnedExerciseNames={learnedExerciseNames}
        onBack={() => navigateBack(ROOT_ROUTES.workout)}
        onOpenExercise={(exerciseName) => {
          const target = exerciseBrowserItems.find((candidate) => candidate.name === exerciseName);
          if (target) {
            navigate({ tab: 'workout', screen: 'detail', exerciseId: target.id });
          }
        }}
      />
    );
  }

  if (route.screen === 'list') {
    return (
      /*
       * No onAddToWorkout.
       *
       * The "+" on a library card opened the logger prefilled with that lift,
       * so browsing the library was a way to start a workout. Removed on
       * request (user 2026-08-31) — the routing only, with a replacement to
       * come. The button renders only when it has an action, so the card is
       * now a card rather than a dead orange circle.
       */
      <ExercisesScreen
        language={preferences.appLanguage}
        onBack={() => navigateBack({ tab: 'workout', screen: 'programs_home' })}
        items={exerciseBrowserItems}
        onOpenExercise={(item) => navigate({ tab: 'workout', screen: 'detail', exerciseId: item.id })}
        learnCollection={(() => {
          const picked = pickLibraryCollection(
            getExerciseCollections(preferences.appLanguage),
            (name) => learnedExerciseNames.includes(name),
          );
          return picked
            ? {
                id: picked.collection.id,
                title: picked.collection.title,
                done: picked.progress.done,
                total: picked.progress.total,
                percent: picked.progress.percent,
                state: picked.state,
              }
            : null;
        })()}
        onOpenCollection={(collectionId) =>
          navigate({ tab: 'workout', screen: 'collection', collectionId })
        }
        onOpenLearnIndex={() => navigate({ tab: 'workout', screen: 'learn' })}
      />
    );
  }

  return null;
}
