import React from 'react';

import { trackEvent } from '../features/analytics/analyticsClient';
import { reportOperationFailed } from '../features/errorReporting/errorReporter';
import { isWorkoutInProgress } from '../lib/activeWorkout';
import { findSavedCardioRun } from '../lib/cardio';
import { isAiCoachLiveConfigured, isProgrammeCompositionCrisis, requestProgrammeComposition } from '../lib/aiCoachClient';
import { randomLogId } from '../lib/aiCoachLogId';
import { recordCoachQuestion, resolveCoachQuota } from '../lib/aiCoachQuota';
import { markCoachDemoMomentUsed } from '../lib/coachDemoMoments';
import { buildProgrammeDraft, composeProgrammePreview, liveProposalOrPreview, resolveLiveProposal } from '../lib/programmeBrief';
import { recordSuggestionAccepted, recordSuggestionRejected } from '../lib/coachSuggestions';
import { t } from '../lib/i18n';
import { ProgramLimitReachedError } from '../lib/programSlots';
import { remindersOptedIn } from '../lib/reminderOptIn';
import { AppRoute, ROOT_ROUTES } from '../navigation/routes';
import { requestNotificationPermission } from '../utils/appNotifications';
import { haptics } from '../utils/haptics';
import { AICoachChatScreen } from '../screens/AICoachChatScreen';
import { CardioScreen } from '../screens/CardioScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { SessionAnalysisScreen } from '../screens/SessionAnalysisScreen';
import {
  AppDatabase,
  AppPreferences,
  MeasurementKind,
  MeasurementUnit,
  WorkoutTemplateDraft,
} from '../types/models';
import type { PreferencesPatch } from '../state/AppProvider';
import { coachQuickAskKeys } from '../lib/coachQuickAsks';

type ChatScreenProps = React.ComponentProps<typeof AICoachChatScreen>;
type CardioScreenProps = React.ComponentProps<typeof CardioScreen>;
type HistoryScreenProps = React.ComponentProps<typeof HistoryScreen>;

/**
 * The home tab's sub-screens — cardio, the coach surfaces, history and the
 * session analysis — moved verbatim from App.tsx's render chain in the
 * phase-A split (2026-08-26). The dashboard itself stays behind: it is the
 * chain's final else and doubles as the safety net for a route whose guard
 * state was just cleared, which is App.tsx's business, not a tab's.
 */
export interface HomeScreensDeps {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  /** Same screen, different params, no new history entry. */
  replaceRoute: (route: AppRoute) => void;
  navigateBack: (fallback?: AppRoute | null) => void;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
  workout: { activeSession: { status: string } | null; discardWorkout: () => void };
  cardioSessions: CardioScreenProps['cardioSessions'];
  cardioSaving: boolean;
  setCardioSaving: (saving: boolean) => void;
  saveCardioSession: (input: Parameters<CardioScreenProps['onSaveCardioSession']>[0]) => Promise<unknown>;
  navigateToActiveWorkout: (options?: { message?: string; resume?: boolean }) => boolean;
  setFinishSaveState: (value: {
    status: 'idle' | 'saving' | 'error';
    sessionId: string | null;
  }) => void;
  showToast: (message: string) => void;
  aiCoachTrainingContext: ChatScreenProps['trainingContext'];
  exerciseLibrary: AppDatabase['exerciseLibrary'];
  programSlots: { canCreate: boolean };
  setProgramLimitVisible: (visible: boolean) => void;
  workoutTemplates: Array<{ name: string }>;
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  workoutSessions: HistoryScreenProps['sessions'];
  getSessionLogs: HistoryScreenProps['getSessionLogs'];
  /** Where the list was scrolled before opening a session, and under what
   * search/filter; see App.tsx and `historyScrollMemoryMatches`. */
  historyScrollOffsetRef: React.MutableRefObject<HistoryScreenProps['initialScrollMemory']>;
  deleteCompletedWorkoutSession: (sessionId: string) => Promise<unknown>;
  deleteCardioSession: (sessionId: string) => Promise<unknown>;
  unitPreference: HistoryScreenProps['unitPreference'];
  coachProUnlocked: boolean;
  database: Pick<AppDatabase, 'workoutSessions' | 'bodyweightEntries' | 'measurementEntries'>;
  coachChatIntro: ChatScreenProps['intro'];
  coachLastSession: ChatScreenProps['lastSession'];
  homePinnedStatCardKeys: string[];
  addBodyweightEntry: (weightKg: number) => Promise<unknown>;
  addMeasurementEntry: (kind: MeasurementKind, value: number, unit: MeasurementUnit) => Promise<unknown>;
  /** The coach thread, held above the screen so leaving it does not end it. */
  coachChatMemory: ChatScreenProps['memory'];
  onCoachChatMemoryChange: ChatScreenProps['onMemoryChange'];
  /** The coach's own memory of what it advised — outlives the thread. */
  onCoachAdviceGiven: ChatScreenProps['onAdviceGiven'];
  sessionAnalysis: React.ComponentProps<typeof SessionAnalysisScreen>['analysis'];
}

export function renderHomeScreens(deps: HomeScreensDeps): React.ReactElement | null {
  const {
    route,
    navigate,
    replaceRoute,
    navigateBack,
    preferences,
    updatePreferences,
    workout,
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
    deleteCompletedWorkoutSession,
    deleteCardioSession,
    unitPreference,
    coachProUnlocked,
    database,
    coachChatIntro,
    coachLastSession,
    homePinnedStatCardKeys,
    addBodyweightEntry,
    addMeasurementEntry,
    coachChatMemory,
    onCoachChatMemoryChange,
    onCoachAdviceGiven,
    sessionAnalysis,
  } = deps;

  /**
   * Composing and saving a week, written once for the two screens that do it.
   *
   * The chat draws the proposal in the conversation and the composer screen
   * draws it under its own text field, but they must build and store exactly
   * the same thing — two copies of this is how the chat ends up saving a
   * programme the composer would have refused.
   */
  async function composeProgramme(brief: string, signal?: AbortSignal) {
    const live = await requestProgrammeComposition(
      {
        brief,
        context: aiCoachTrainingContext,
        language: preferences.appLanguage,
        // The composer line of the consent sheet, read as it stands now.
        keepConsent: preferences.aiLogComposerConsent,
        logId: preferences.aiLogId,
      },
      // Leaving the chat cancels the build: it is a billed call, and an
      // answer with no screen to land on is paid for twice over when the
      // restored offer is tapped again.
      signal,
    );
    // The crisis answer goes back to the chat to be said. It is not "no
    // week" and must not reach the device composer (review, 2026-10-08).
    if (isProgrammeCompositionCrisis(live)) {
      return live;
    }
    if (live) {
      const resolved = resolveLiveProposal(live, brief, exerciseLibrary, preferences.defaultRestSeconds, preferences);
      /*
       * A week whose every lift the library does not know is not a week.
       *
       * `resolveLiveProposal` drops exercises it cannot resolve and then drops
       * any session left with none, and the server only promises that
       * `sessions.length > 0` — so a model answer full of names this device
       * has never heard of resolved to `sessions: []`, was drawn as a saveable
       * programme under a card reading "checked against the exercise library",
       * and saved as one empty day (audit 3, 2026-09-19).
       *
       * The deterministic composer is the fallback that already exists for a
       * live answer that never arrived; an answer that arrived with nothing
       * usable in it leaves the reader in the same place.
       */
      return liveProposalOrPreview(resolved, () => composeProgrammePreview(brief, preferences, exerciseLibrary));
    }
    return composeProgrammePreview(brief, preferences, exerciseLibrary);
  }

  async function saveProgramme(proposal: Parameters<typeof buildProgrammeDraft>[0]) {
    // A proposal with no days is not saved, whatever produced it. The provider
    // would fabricate one empty session out of it and the reader would land on
    // a programme page with nothing in it.
    if (proposal.sessions.length === 0) {
      showToast(t(preferences.appLanguage, 'toast.aiBuildFailed'));
      return;
    }
    // Checked before the write as well as inside it: the wall should land where
    // the reader pressed, not after the programme has been built.
    if (!programSlots.canCreate) {
      setProgramLimitVisible(true);
      return;
    }
    const draft = buildProgrammeDraft(
      proposal,
      workoutTemplates.map((item) => item.name),
    );
    try {
      const workoutTemplateId = await upsertWorkoutTemplate(draft);
      // The programme's own page is the confirmation — it opens next.
      void haptics.success();
      navigate({ tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId });
    } catch (error) {
      if (error instanceof ProgramLimitReachedError) {
        setProgramLimitVisible(true);
        return;
      }
      console.error('Failed to save composed programme', error);
      showToast(t(preferences.appLanguage, 'toast.aiBuildFailed'));
    }
  }

  if (route.tab !== 'home') {
    return null;
  }

  if (route.screen === 'cardio') {
    return (
      <CardioScreen
        language={preferences.appLanguage}
        keepScreenAwake={preferences.keepScreenAwakeDuringWorkout}
        cardioSessions={cardioSessions}
        hasActiveStrengthSession={isWorkoutInProgress(workout.activeSession)}
        isSaving={cardioSaving}
        onResumeStrengthSession={() => {
          // The button says resume, so it resumes: straight to the set.
          navigateToActiveWorkout({ resume: true });
        }}
        onDiscardStrengthSession={() => {
          workout.discardWorkout();
          setFinishSaveState({ status: 'idle', sessionId: null });
        }}
        onSaveCardioSession={async (input) => {
          setCardioSaving(true);
          try {
            // A run already stored is a save landing again (its clear was lost): counted when it
            // first landed, not on every Complete of the same run.
            const alreadyStored = findSavedCardioRun(cardioSessions, input) !== null;
            await saveCardioSession(input);
            // Its end, once it is stored — the start is counted where the
            // provider starts the clock (analytics audit, 2026-09-21).
            if (!alreadyStored) {
              trackEvent('workout_completed');
            }
            // No "saved" toast: the session appears in the history the screen
            // returns to, and the haptic says it landed (user 2026-08-26,
            // "kaikki tämmöiset pitäisi saada pois apista"). Failures still
            // speak — an error is the one thing that has no other signal.
            void haptics.success();
          } catch (error) {
            console.error('Failed to save cardio session', error);
            reportOperationFailed('workout_save', error);
            showToast(t(preferences.appLanguage, 'toast.cardioSaveFailed'));
            throw error;
          } finally {
            setCardioSaving(false);
          }
        }}
        onLeave={() => navigateBack(ROOT_ROUTES.home)}
      />
    );
  }

  if (route.screen === 'history' || route.screen === 'session') {
    return (
      <HistoryScreen
        sessions={workoutSessions}
        cardioSessions={cardioSessions}
        unitPreference={unitPreference}
        language={preferences.appLanguage}
        selectedSessionId={route.screen === 'session' ? route.sessionId : undefined}
        getSessionLogs={getSessionLogs}
        initialScrollMemory={historyScrollOffsetRef.current}
        onScrollOffsetChange={(memory) => {
          historyScrollOffsetRef.current = memory;
        }}
        onSelectSession={(sessionId) => navigate({ tab: 'home', screen: 'session', sessionId })}
        // A refused delete rolls memory back, so the row reappears — and with
        // the promise dropped on the floor that was all the reader got: a
        // confirmed delete that silently undid itself. Say it did not happen.
        onDeleteSession={(sessionId) => {
          deleteCompletedWorkoutSession(sessionId).catch((error) => {
            console.error('Failed to delete workout session', error);
            showToast(t(preferences.appLanguage, 'toast.deleteFailed'));
          });
        }}
        onDeleteCardioSession={(sessionId) => {
          deleteCardioSession(sessionId).catch((error) => {
            console.error('Failed to delete cardio session', error);
            showToast(t(preferences.appLanguage, 'toast.deleteFailed'));
          });
        }}
        onBack={() => navigateBack(ROOT_ROUTES.home)}
      />
    );
  }

  if (route.screen === 'ai_chat') {
    return (
      <AICoachChatScreen
        language={preferences.appLanguage}
        proUnlocked={coachProUnlocked}
        liveConfigured={isAiCoachLiveConfigured()}
        onlineNoticeAcknowledged={preferences.aiOnlineNoticeAcknowledged}
        onAcknowledgeOnlineNotice={() => void updatePreferences({ aiOnlineNoticeAcknowledged: true })}
        logConsent={{
          chat: preferences.aiLogChatConsent,
          composer: preferences.aiLogComposerConsent,
          photo: preferences.aiLogPhotoConsent,
        }}
        logId={preferences.aiLogId}
        onChangeLogConsent={(next) => {
          const patch = {
            ...(next.chat === undefined ? {} : { aiLogChatConsent: next.chat }),
            ...(next.composer === undefined ? {} : { aiLogComposerConsent: next.composer }),
            ...(next.photo === undefined ? {} : { aiLogPhotoConsent: next.photo }),
          };
          // The label is minted on the first yes and not before: a reader who
          // never allows anything never gets one, so there is nothing to
          // identify them by.
          const turningSomethingOn = Object.values(next).some((value) => value === true);
          void updatePreferences({
            ...patch,
            ...(turningSomethingOn && !preferences.aiLogId ? { aiLogId: randomLogId() } : {}),
          });
        }}
        questionsRemaining={resolveCoachQuota(preferences.aiCoachProQuota).remaining}
        onQuestionUsed={() =>
          void updatePreferences((current) => ({ aiCoachProQuota: recordCoachQuestion(current.aiCoachProQuota) }))
        }
        demoQuestion={route.demoQuestion ?? null}
        demoMomentKey={route.demoMomentKey ?? null}
        onDemoQuestionSent={() => {
          // Clears the hand-off and nothing else. The question is on the
          // route, so leaving it there would let a remount fire it a second
          // time; the chat keeps its own copy of the key for the answer.
          //
          // REPLACE, not navigate. pushRoute compares whole route objects, so
          // the params make this a different route and it was pushed — the
          // reader's next Back landed on the chat they were already looking
          // at, question and all, which is both a dead press and a route
          // still carrying a question a remount could re-send.
          replaceRoute({ tab: 'home', screen: 'ai_chat' });
        }}
        onDemoQuestionAnswered={(key) => {
          // Spending happens on the ANSWER, which is the promise. Spending on
          // the send was two bugs deep: the completion screen spent it before
          // the online disclosure could block it, and moving it to the
          // dispatch still burned one of three whenever the phone was offline
          // — in an app built to work offline — leaving the reader with two
          // sample answers and no sample.
          void updatePreferences({
            coachDemoMomentsUsed: markCoachDemoMomentUsed(preferences.coachDemoMomentsUsed, key),
          });
        }}
        intent={route.intent ?? null}
        onIntentConsumed={() => {
          // Replace, for the reasons onDemoQuestionSent gives above: the
          // intent is on the route, so leaving it there would start the
          // questions again on a remount or a Back onto this chat.
          replaceRoute({ tab: 'home', screen: 'ai_chat' });
        }}
        intakePreferences={preferences}
        preferences={preferences}
        trainingContext={aiCoachTrainingContext}
        intro={coachChatIntro}
        sessionCount={database.workoutSessions.length}
        quickAskKeys={coachQuickAskKeys(database.workoutSessions.length, aiCoachTrainingContext.sessionsLast30Days)}
        lastSession={coachLastSession}
        onOpenAnalysis={(sessionId) => navigate({ tab: 'home', screen: 'analysis', sessionId })}
        onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}
        pinnedStatCardKeys={homePinnedStatCardKeys}
        onLogMeasurement={async (intent) => {
          if (intent.kind === 'bodyweight') {
            await addBodyweightEntry(intent.value);
          } else {
            await addMeasurementEntry(intent.kind, intent.value, intent.unit === 'kg' ? 'cm' : intent.unit);
          }
        }}
        onPinStatCard={(key) => {
          if (!homePinnedStatCardKeys.includes(key)) {
            void updatePreferences({ homeStatCardKeys: [...homePinnedStatCardKeys, key] });
          }
        }}
        onSetGoal={async (intent) => {
          const latestOf = (values: Array<{ recordedAt: string; value: number }>) =>
            values.length > 0
              ? values.reduce((best, entry) => (entry.recordedAt > best.recordedAt ? entry : best)).value
              : null;
          const startValue =
            intent.kind === 'bodyweight'
              ? latestOf(database.bodyweightEntries.map((entry) => ({ recordedAt: entry.recordedAt, value: entry.weight })))
              : latestOf(
                  database.measurementEntries
                    .filter((entry) => entry.kind === intent.kind)
                    .map((entry) => ({ recordedAt: entry.recordedAt, value: entry.value })),
                );
          const id = `goal-${Date.now().toString(36)}`;
          await updatePreferences((current) => ({
            coachGoals: [
              // One goal per kind: restating replaces, it does not stack.
              ...current.coachGoals.filter((goal) => goal.kind !== intent.kind),
              {
                id,
                text: intent.text,
                kind: intent.kind,
                targetValue: intent.targetValue,
                unit: intent.unit ?? (intent.kind === 'bodyweight' ? 'kg' : intent.kind === 'bodyfat' ? '%' : 'cm'),
                startValue,
                createdAt: new Date().toISOString(),
              },
            ],
            // Saying a goal out loud makes it the one the coach answers
            // against. There is no other way to change it yet — goals have no
            // screen of their own — so the spoken word has to be the switch.
            primaryGoalId: id,
          }));
        }}
        weighInReminderEnabled={preferences.notificationPrefs.weighInReminder}
        onOpenMeasure={(kind) =>
          // Bodyweight has a screen of its own; everything else is a section
          // of Progress that can open on the right measurement.
          navigate(
            kind === 'bodyweight'
              ? { tab: 'progress', screen: 'bodyweight' }
              : { tab: 'progress', screen: 'list', section: 'measures', measure: kind },
          )
        }
        // "Morning weigh-in is on" was said over a write the planner ignored:
        // every scheduled reminder waits on the Notifications switch, which
        // ships off, and this wrote only `weighInReminder`. So the permission
        // is asked first — a phone that will stay silent gets told so, and
        // nothing is stored — and the switch goes on with the reminder. The
        // chat says it is on once this resolves; a write that fails throws.
        onEnableWeighInReminder={async () => {
          const granted = await requestNotificationPermission(preferences.appLanguage);
          if (!granted) {
            return 'blocked';
          }
          await updatePreferences((current) => ({
            notificationPrefs: remindersOptedIn(current.notificationPrefs, { weighInReminder: true }),
          }));
          return 'on';
        }}
        onCoachSuggestionResolved={(kind, accepted) =>
          void updatePreferences((current) => ({
            coachSuggestionState: accepted
              ? recordSuggestionAccepted(current.coachSuggestionState, kind)
              : recordSuggestionRejected(current.coachSuggestionState, kind),
          }))
        }
        // The week is built here and read in the thread that asked for it.
        // Failures come back as null so the chat can say so rather than
        // sitting on "building…" forever.
        onComposeProgramme={async (brief, signal) => {
          try {
            return await composeProgramme(brief, signal);
          } catch (error) {
            console.error('Failed to compose programme from chat', error);
            return null;
          }
        }}
        onSaveProgramme={saveProgramme}
        // The catalog's own page, where a ready programme is read and taken on.
        onOpenProgramme={(programId) =>
          navigate({ tab: 'workout', screen: 'program', programType: 'ready', workoutTemplateId: programId })
        }
        memory={coachChatMemory}
        onMemoryChange={onCoachChatMemoryChange}
        onAdviceGiven={onCoachAdviceGiven}
      />
    );
  }

  if (route.screen === 'analysis') {
    return (
      <SessionAnalysisScreen
        analysis={sessionAnalysis}
        language={preferences.appLanguage}
        onBack={() => navigateBack(ROOT_ROUTES.home)}
        // Back to the chat that opened this page, not a second one on top of
        // it: pushing left chat → analysis → chat, so back replayed the
        // analysis and took three presses to reach Home (audit 7, 2026-09-26).
        // The analysis is only opened from the chat; the fallback covers a
        // history that is somehow empty.
        onAskCoach={() => navigateBack({ tab: 'home', screen: 'ai_chat' })}
      />
    );
  }

  return null;
}
