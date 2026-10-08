import React from 'react';

import { availableSignInProviders } from '../features/account/accountAuth';
import { isWorkoutInProgress, isWorkoutInProgressFor } from '../lib/activeWorkout';
import type { HomePrompt } from '../lib/homePrompts';
import { isMeasurementCardKey } from '../lib/homeStatCards';
import { SessionAdaptation, withoutSessionDrop, withSessionDrop, withSessionSwap } from '../lib/sessionAdaptation';
import { AppRoute, ROOT_ROUTES, RootTabKey } from '../navigation/routes';
import { HomeScreen } from '../screens/HomeScreen';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppDatabase, AppPreferences } from '../types/models';
import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import type { WorkoutTabDeps } from './renderWorkoutTab';
import type { useAccountOutcome } from './useAccountOutcome';

type HomeScreenProps = React.ComponentProps<typeof HomeScreen>;
type HomePlateau = NonNullable<HomeScreenProps['plateau']>;
type TourFocus = HomeScreenProps['tourFocus'];

/**
 * The dashboard, moved verbatim from App.tsx in phase C of the split
 * (2026-10-01). It is still the chain's safety net: App.tsx calls this only
 * when no branch claimed the route or a tab module declined it, exactly where
 * the JSX stood, so the same HomeScreen instance survives every render.
 */
export interface HomeDashboardDeps {
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  tourRegistry: NonNullable<HomeScreenProps['tourTargets']>;
  tourFocus: TourFocus;
  navigate: (nextRoute: AppRoute) => void;
  resolveTabRoute: (tab: RootTabKey) => AppRoute;
  homeActivePlanCard: (NonNullable<HomeScreenProps['activePlan']> & { programType: 'ready' | 'custom' }) | null;
  homeEmptyProgramme: { workoutTemplateId: string; title: string } | null;
  handleCompletionStartNext: (planId: string, nextTemplateId: string) => Promise<void>;
  handleCompletionRestart: (planId: string) => Promise<void>;
  dismissCompletionCard: (planId: string) => Promise<void>;
  homeOtherPrograms: NonNullable<HomeScreenProps['otherPrograms']>;
  programCapLine: string | null;
  database: Pick<AppDatabase, 'workoutPlans'>;
  handleOpenProgramDetail: (workoutTemplateId: string) => void;
  handleRemoveActiveProgram: (planId: string) => Promise<void>;
  availableEquipmentForDrills: string[] | null;
  homeTourActive: boolean;
  homeWidgetState: { supported: boolean; added: boolean } | null;
  handleAddHomeWidget: () => Promise<void>;
  homePrompt: HomePrompt;
  handleAccountSignIn: ReturnType<typeof useAccountOutcome>['handleAccountSignIn'];
  homeTrainingSchedule: NonNullable<HomeScreenProps['trainingSchedule']>;
  homeDoneThisWeekSessionIds: string[];
  homeStatCatalogCards: NonNullable<HomeScreenProps['statCatalogCards']>;
  homeSuggestedStatCardKeys: string[];
  homePinnedStatCardKeys: string[];
  homeSessionAdaptation: SessionAdaptation;
  adaptHomeSession: (change: (current: SessionAdaptation) => SessionAdaptation) => void;
  handleEditProgramExercise: WorkoutTabDeps['editProgramExercise'];
  exerciseBrowserItems: HomeScreenProps['exerciseLibrary'];
  workout: Pick<ReturnType<typeof useWorkoutContext>, 'activeSession' | 'activeCardio'>;
  handlePickTodaySession: (sessionId: string) => Promise<void>;
  handleRenameProgramSession: (templateId: string, sessionId: string, name: string) => Promise<void>;
  handleStartCustomProgramSession: (workoutTemplateId: string, sessionId: string) => void;
  handleStartReadyProgramSession: (workoutTemplateId: string, sessionId: string) => void;
  guardStrengthStartOverCardio: (proceed: () => void) => void;
  proPlateau: {
    detection: { headline: HomePlateau['headline']; meta: HomePlateau['meta'] };
    conclusion: HomePlateau['locked'];
    moment: HomePlateau['moment'];
    episodeKey: string;
  } | null;
  coachProUnlocked: boolean;
}

export function renderHomeDashboard(deps: HomeDashboardDeps): React.ReactNode {
  const {
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
  } = deps;

  // The card's session is the workout already running or paused. A swap or a
  // drop made on Home would be held for it and never reach it — Resume opens
  // the running workout and applies nothing — so the rows stay read-only and
  // the edit is made in the player (bug hunt 2026-10-07).
  const todayIsRunning = isWorkoutInProgressFor(
    workout.activeSession,
    homeActivePlanCard?.programId,
    homeActivePlanCard?.nextSession?.id,
  );

  let content: React.ReactNode = null;
  content = (
    <HomeScreen
      language={preferences.appLanguage}
      tourTargets={tourRegistry}
      tourFocus={tourFocus}
      onOpenSubscription={() => navigate({ tab: 'profile', screen: 'subscription' })}
      activePlan={homeActivePlanCard}
      emptyProgramme={homeEmptyProgramme}
      onOpenEmptyProgramme={() => {
        if (homeEmptyProgramme) {
          navigate({
            tab: 'workout',
            screen: 'program',
            programType: 'custom',
            workoutTemplateId: homeEmptyProgramme.workoutTemplateId,
          });
        }
      }}
      onCompletionStartNext={(planId, templateId) => void handleCompletionStartNext(planId, templateId)}
      onCompletionRestart={(planId) => void handleCompletionRestart(planId)}
      onCompletionDismiss={(planId) => void dismissCompletionCard(planId)}
      onCompletionBrowse={(planId) => {
        void dismissCompletionCard(planId);
        navigate(ROOT_ROUTES.workout);
      }}
      otherPrograms={homeOtherPrograms}
      programCapLine={programCapLine}
      onOpenOtherProgram={(planId) => {
        const plan = database.workoutPlans.find((entry) => entry.id === planId);
        const templateId = plan?.entries[0]?.workoutTemplateId;
        if (templateId) {
          handleOpenProgramDetail(templateId);
        }
      }}
      onRemoveOtherProgram={(planId) => void handleRemoveActiveProgram(planId)}
      availableEquipment={availableEquipmentForDrills}
      cautionFlags={preferences.setupCautionFlags}
      routineDrillOverrides={preferences.routineDrillOverrides}
      // Permanent by nature: the drills are generated from the session's
      // focus, so the choice belongs to every day with that focus rather
      // than to today. There is no "just this time" to offer.
      onSwapRoutineDrill={(slotKey, drillKey) =>
        void updatePreferences((current) => ({
          routineDrillOverrides: { ...current.routineDrillOverrides, [slotKey]: drillKey },
        }))
      }
      widgetPrompt={
        !homeTourActive && homeWidgetState?.supported && !homeWidgetState.added && !preferences.homeWidgetPromptDismissed
          ? {
              onAdd: () => void handleAddHomeWidget(),
              onDismiss: () => void updatePreferences({ homeWidgetPromptDismissed: true }),
            }
          : null
      }
      accountBackupPrompt={
        // One prompt at a time, and this one waits for the third logged
        // session (lib/homePrompts): a fresh install has nothing worth
        // backing up, and the account ask is the one most likely to be
        // both refused and remembered.
        homePrompt === 'signIn'
          ? {
              providers: availableSignInProviders(),
              onSignIn: (provider) => {
                void handleAccountSignIn(provider).then((kind) => {
                  // An answered offer never returns; a cancelled sheet or a
                  // failure leaves it up for another try or a real dismissal.
                  if (kind === 'backed_up' || kind === 'restored' || kind === 'choice' || kind === 'confirm_upload') {
                    void updatePreferences({ accountBackupPromptDismissed: true });
                  }
                });
              },
              onDismiss: () => void updatePreferences({ accountBackupPromptDismissed: true }),
            }
          : null
      }
      trainingSchedule={homeTrainingSchedule}
      doneThisWeekSessionIds={homeDoneThisWeekSessionIds}
      statCatalogCards={homeStatCatalogCards}
      suggestedStatCardKeys={homePrompt === 'suggestion' ? homeSuggestedStatCardKeys : []}
      onDismissStatCardSuggestion={(key) =>
        void updatePreferences((current) => ({
          dismissedCardSuggestionKeys: [...current.dismissedCardSuggestionKeys, key],
        }))
      }
      pinnedStatCardKeys={homePinnedStatCardKeys}
      onChangePinnedStatCardKeys={(next) => void updatePreferences({ homeStatCardKeys: next })}
      onOpenStatCard={(key) => {
        // Each card opens the surface where its data is tracked and logged.
        if (key === 'bodyweight') {
          navigate({ tab: 'progress', screen: 'bodyweight' });
          return;
        }
        if (isMeasurementCardKey(key)) {
          // The card's own measurement, selected and ready to log — not
          // the section on whatever was picked last.
          navigate({ tab: 'progress', screen: 'list', section: 'measures', measure: key });
          return;
        }
        if (key.startsWith('lift:')) {
          navigate({ tab: 'progress', screen: 'detail', exerciseKey: key.slice('lift:'.length) });
        }
      }}
      sessionSwaps={homeSessionAdaptation.swaps}
      // The programme's own lift picked back undoes the swap (withSessionSwap).
      onSwapSessionExercise={todayIsRunning ? undefined : (slotId, exerciseName) =>
        adaptHomeSession((current) =>
          withSessionSwap(
            current,
            slotId,
            exerciseName,
            homeActivePlanCard?.nextSession?.exercises.find((exercise) => exercise.slotId === slotId)?.name,
          ),
        )
      }
      sessionDrops={homeSessionAdaptation.drops}
      onDropSessionExercise={
        todayIsRunning ? undefined : (slotId) => adaptHomeSession((current) => withSessionDrop(current, slotId))
      }
      onRestoreSessionExercise={
        todayIsRunning ? undefined : (slotId) => adaptHomeSession((current) => withoutSessionDrop(current, slotId))
      }
      onRemoveSessionExercise={(exerciseId) => {
        const sessionId = homeActivePlanCard?.nextSession?.id;
        if (homeActivePlanCard && sessionId) {
          void handleEditProgramExercise(
            homeActivePlanCard.programType,
            homeActivePlanCard.programId,
            sessionId,
            exerciseId,
            { kind: 'remove' },
          );
        }
      }}
      onKeepSwapInProgram={(exerciseId, exerciseName) => {
        const sessionId = homeActivePlanCard?.nextSession?.id;
        if (homeActivePlanCard && sessionId) {
          void handleEditProgramExercise(
            homeActivePlanCard.programType,
            homeActivePlanCard.programId,
            sessionId,
            exerciseId,
            { kind: 'replace', exerciseName },
          );
        }
      }}
      tailoringPreferences={preferences}
      exerciseLibrary={exerciseBrowserItems}
      // Paused counts: it is still a session the button resumes.
      hasActiveSession={isWorkoutInProgress(workout.activeSession)}
      onPickTodaySession={(sessionId) => void handlePickTodaySession(sessionId)}
      // Ready programmes are immutable at runtime, so the pencil is simply
      // not offered for them rather than offered and inert.
      onRenameSession={
        homeActivePlanCard?.programType === 'custom'
          ? (sessionId, name) => void handleRenameProgramSession(homeActivePlanCard.programId, sessionId, name)
          : undefined
      }
      onStartActivePlanSession={(sessionId) => {
        if (!homeActivePlanCard) {
          return;
        }

        if (homeActivePlanCard.programType === 'custom') {
          handleStartCustomProgramSession(homeActivePlanCard.programId, sessionId);
          return;
        }

        handleStartReadyProgramSession(homeActivePlanCard.programId, sessionId);
      }}
      // Through the cardio guard like every other start: the empty workout
      // began over a run still on the clock, and left two sessions live.
      onCreateWorkoutFromExercises={() =>
        guardStrengthStartOverCardio(() => navigate({ tab: 'workout', screen: 'empty' }))
      }
      // No programme to start: the hero button goes to the catalog instead of
      // offering an empty session the "empty workout" row already offers.
      //
      // `navigate`, not `navigateToTab`: the bar resets history because a tab
      // is where you START, but this is a button inside a screen, and it left
      // the reader on Programs with nothing behind them — the next Back
      // closed the app.
      onFindProgram={() => navigate(resolveTabRoute('workout'))}
      onOpenCardio={() => navigate({ tab: 'home', screen: 'cardio' })}
      activeCardioActivity={workout.activeCardio?.activityType ?? null}
      onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}
      plateau={
        proPlateau
          ? {
              headline: proPlateau.detection.headline,
              meta: proPlateau.detection.meta,
              locked: proPlateau.conclusion,
              moment: proPlateau.moment,
              episodeKey: proPlateau.episodeKey,
            }
          : null
      }
      // Guarded like dismissedTipIds (handleDismissTip) and
      // dismissedCompletionPlanIds (dismissCompletionCard): a double tap
      // before the write lands must not append the same episode twice
      // (break round 2026-09-29).
      onDismissPlateau={(episodeKey) =>
        void updatePreferences((current) =>
          current.dismissedPlateauEpisodes.includes(episodeKey)
            ? current
            : { dismissedPlateauEpisodes: [...current.dismissedPlateauEpisodes, episodeKey] },
        )
      }
      proUnlocked={coachProUnlocked}
      onSetTrainingDays={() =>
        navigate({ tab: 'profile', screen: 'training_plan', editSchedule: true })
      }
      onOpenActivePlan={() => {
        if (!homeActivePlanCard) {
          return;
        }
        navigate({
          tab: 'workout',
          screen: 'program',
          programType: homeActivePlanCard.programType ?? 'ready',
          workoutTemplateId: homeActivePlanCard.programId,
        });
      }}
      // A session row opens its own day, not the whole plan — the plan is
      // one tap away behind the section title (user 2026-08-23).
      onOpenPlanSession={(sessionId) => {
        if (!homeActivePlanCard) {
          return;
        }
        navigate({
          tab: 'workout',
          screen: 'programDay',
          programType: homeActivePlanCard.programType ?? 'ready',
          workoutTemplateId: homeActivePlanCard.programId,
          sessionId,
        });
      }}
    />
  );
  return content;
}
