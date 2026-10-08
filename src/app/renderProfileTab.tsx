import React from 'react';
import { Alert, Linking, Platform } from 'react-native';

import type { SignInProvider } from '../features/account/accountAuth';
import { AccountBackupApi } from '../features/account/useAccountBackup';
import { livePlanEntries } from '../lib/planResolvableEntries';
import { planTrainingCycle } from '../lib/planTrainingCycle';
import { templateSessionsReader } from './planTemplateSessions';
import { buildCancelSurveyAnswer } from '../lib/cancelSurvey';
import { recordRatingCompleted } from '../lib/ratingPrompt';
import { manageSubscriptionsUrl, storePlatformOf, usesSystemReviewPrompt, writeReviewUrl } from '../lib/storeLinks';
import { purchaseRecordFromStore } from '../lib/storePurchase';
import { isStoreBillingConfigured, purchaseStorePlan, restoreStorePurchases } from '../features/billing/storeBilling';
import { isDemoBuild } from '../lib/demoMode';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { t } from '../lib/i18n';
import type { ProgramImageImportResult } from '../utils/programImagePicker';
import {
  canStartProTrial,
  canResumePurchase,
  resolveTrialProUntil,
} from '../lib/proEntitlement';
import { forgetAiCoachLog, lastAiLogCarriedAt } from '../lib/aiCoachClient';
import { aiLogDeleteSettlesAt } from '../lib/aiLogDeletion';
import { randomLogId } from '../lib/aiCoachLogId';
import { localizeSessionFocus } from '../lib/sessionNameLabel';
import { MOCK_BILLING, currentPeriodEndAt, nextChargeAt } from '../lib/subscriptionView';
import { AppRoute, ROOT_ROUTES } from '../navigation/routes';
import { remindersOptedIn } from '../lib/reminderOptIn';
import { reminderWeekdays, resolveReminderSchedule } from '../lib/reminderSchedule';
import { isScheduleKnown } from '../lib/trainingSchedule';
import { resolveDeviceLanguage } from '../storage/deviceLocale';
import {
  getNotificationPermissionGranted,
  requestNotificationPermission,
} from '../utils/appNotifications';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../utils/exactAlarm';
import type { NotificationAccessState } from '../lib/notificationAccessState';
import {
  getRestAlertAccessState,
  getRestAlertPermission,
  isRestAlertChannelBlocked,
  openRestAlertChannelSettings,
  requestRestAlertPermission,
} from '../utils/sessionNotifications';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { ExportPlanScreen } from '../screens/ExportPlanScreen';
import { LegalDocumentScreen } from '../screens/LegalDocumentScreen';
import { MembershipEndScreen } from '../screens/MembershipEndScreen';
import { MilestonesScreen } from '../screens/MilestonesScreen';
import { MyDataScreen } from '../screens/MyDataScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PremiumScreen } from '../screens/PremiumScreen';
import { PremiumUnlockScreen } from '../screens/PremiumUnlockScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { TrainingBreakScreen } from '../screens/TrainingBreakScreen';
import { TrainingPlanScreen } from '../screens/TrainingPlanScreen';
import { AppDatabase, AppPreferences, SetupWeekday, TrainingCycle, WorkoutTemplateDraft } from '../types/models';
import type { PreferencesPatch } from '../state/AppProvider';
import { CompletionSummaryState } from './workoutCompletionState';
import { createUnlessAtLimit } from './programLimitGuard';

/**
 * The profile tab's screens, one route branch each — moved verbatim from
 * App.tsx's render chain in the phase-A split (2026-08-26). Plain functions,
 * not components, so React sees exactly the tree the chain produced and no
 * remount semantics change.
 *
 * The deps interface is the seam: everything a profile screen needs from the
 * switchboard, named. Types lean on ComponentProps where the screen already
 * owns the shape, so this file never restates one.
 */
export interface ProfileTabDeps {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
  navigateBack: (fallback?: AppRoute | null) => void;
  resetToRoute: (route: AppRoute) => void;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<unknown>;
  /** One programme's rhythm set or cleared, on its own plan. */
  setPlanTrainingCycle: (planId: string, cycle: TrainingCycle | null) => Promise<void>;
  coachProUnlocked: boolean;
  proCoachSpecimen: React.ComponentProps<typeof PremiumUnlockScreen>['coachSpecimen'];
  proEntitlement: React.ComponentProps<typeof SubscriptionScreen>['entitlement'];
  profilePlanSummary: {
    name: string | null;
    daysPerWeek: number | null;
    exerciseCount: number | null;
    sessionNames: string[];
  };
  homeActivePlanCard: {
    programId: string;
    programType: 'ready' | 'custom';
    nextSession: { id: string };
    sessions: Array<{
      id: string;
      title: string;
      exercises: Array<{ name: string }>;
      totalSets?: number | null;
    }>;
  } | null;
  exerciseBrowserItems: React.ComponentProps<typeof TrainingPlanScreen>['exerciseLibrary'];
  exerciseNameBook: React.ComponentProps<typeof TrainingPlanScreen>['nameBook'];
  teachExerciseName: (wrote: string, target: { name: string; libraryItemId: string }) => void;
  /**
   * Undefined in a build with no live coach: the photo path is the coach's,
   * and the sheet hides the button rather than offering one that returns
   * nothing (2026-09-16).
   */
  handlePickProgramImage?: () => Promise<ProgramImageImportResult>;
  handleChangeTrainingDays: (days: SetupWeekday[]) => Promise<void>;
  programSlots: { canCreate: boolean };
  setProgramLimitVisible: (visible: boolean) => void;
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  /** How many ready programmes the sheet's catalog door is promising. */
  readyProgramCount: number;
  /** Whether AI-assisted composition opens the chat or the paywall. */
  proUnlocked: boolean;
  exportablePlans: React.ComponentProps<typeof ExportPlanScreen>['plans'];
  database: Pick<AppDatabase, 'workoutSessions' | 'exerciseLogs' | 'cardioSessions' | 'workoutPlans' | 'workoutTemplates' | 'exerciseTemplates'>;
  /** The weigh-in log's newest reading, as Home and Progress read it. */
  latestWeighInKg: number | null;
  settingsScrollOffsetRef: React.MutableRefObject<number>;
  homeWidgetState: { supported: boolean; added: boolean } | null;
  handleAddHomeWidget: () => Promise<void>;
  accountBackup: AccountBackupApi;
  handleAccountSignIn: (provider?: SignInProvider) => Promise<unknown>;
  handleAccountBackupNow: () => Promise<unknown>;
  showToast: (message: string) => void;
  setSettingsImportVisible: (visible: boolean) => void;
  setRatingSheetVisible: (visible: boolean) => void;
  resetAllData: () => Promise<void>;
  /** Asks the server to delete these coach-log labels; resolves with the ones it could not confirm. */
  deletePendingAiLogs: (logIds: readonly string[]) => Promise<string[]>;
  /** Retires the coach's label inside the provider's queue, filing its delete as owed when `owed`. */
  /**
   * Retires the coach's label inside the provider's queue, filing its delete as
   * owed when `owed`; resolves with whether it ended up owed.
   */
  retireAiLogLabel: (logId: string, owed: boolean) => Promise<boolean>;
  setCompletionSummary: (value: CompletionSummaryState | null) => void;
  setFinishSaveState: (value: {
    status: 'idle' | 'saving' | 'error';
    sessionId: string | null;
  }) => void;
  workout: {
    resetWorkoutData: () => Promise<void>;
    setAsideWorkoutAvailable: boolean;
    restoreSetAsideWorkout: () => Promise<'restored' | 'busy' | 'none' | 'unreadable'>;
  };
  lifetimeSummary: React.ComponentProps<typeof ProfileScreen>['lifetime'];
  milestoneLedger: React.ComponentProps<typeof MilestonesScreen>['ledger'];
  trackedProgress: React.ComponentProps<typeof ProfileScreen>['trackedProgress'];
  exerciseLibrary: React.ComponentProps<typeof ProfileScreen>['exerciseLibrary'];
  unitPreference: React.ComponentProps<typeof ProfileScreen>['unitPreference'];
  distinctRecordCount: number;
}

/**
 * The workout alerts' permission from the settings screen: the system dialog
 * while Android will still show it, the app's own system page once the reader
 * has refused it for good — a dialog that can no longer appear would make the
 * button do nothing at all. Module-level so the screen's effect sees one
 * function for the life of the app.
 *
 * Returns the state that action leaves things in — denied, channel muted, or
 * granted — so the card can say which, not just "worked" or "did not"
 * (#bugs, 2026-09-26: a muted channel and a refused permission read as the
 * same flat "blocked").
 */
async function allowWorkoutAlerts(): Promise<NotificationAccessState> {
  if ((await getRestAlertPermission()) === 'denied') {
    await Linking.openSettings().catch(() => undefined);
    return 'denied';
  }
  if ((await requestRestAlertPermission()) !== 'granted') {
    return 'denied';
  }
  // Allowed, but the reader switched the rest-alert channel off in Android's
  // settings: no dialog can undo that, and "allowed" would hide the card
  // over an alert that stays silent (native audit, 2026-09-21). Their own
  // channel page does — sharper than the app's general settings, since the
  // toggle sits several taps deep in there (2026-09-26). The screen reads
  // again when the app comes back.
  if (await isRestAlertChannelBlocked()) {
    await openRestAlertChannelSettings();
    return 'channelMuted';
  }
  return 'granted';
}

function allowExactAlarms() {
  void openExactAlarmSettings();
}

export function renderProfileTab(deps: ProfileTabDeps): React.ReactElement | null {
  const {
    route,
    navigate,
    navigateBack,
    resetToRoute,
    preferences,
    updatePreferences,
    setPlanTrainingCycle,
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
    readyProgramCount,
    proUnlocked,
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
    resetAllData,
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
  } = deps;

  if (route.tab !== 'profile') {
    return null;
  }

  /**
   * The rhythm the reminders fire on, read by the two screens that talk about
   * reminders. They read `setupAvailableDays` alone, and said "No training
   * days" to a reader whose cycle or plan the reminders were following.
   */
  const leadPlan = database.workoutPlans.find((plan) => plan.id === preferences.activePlanId) ?? null;
  const reminderSchedule = () =>
    resolveReminderSchedule({
      trainingCycle: planTrainingCycle(leadPlan),
      planEntries: livePlanEntries(leadPlan?.entries ?? [], templateSessionsReader(database)),
      availableDays: preferences.setupAvailableDays,
    });

  if (route.screen === 'premium') {
    return (
      <PremiumScreen
        reason={route.reason ?? null}
        language={preferences.appLanguage}
        proUnlocked={coachProUnlocked}
        trialAvailable={canStartProTrial(preferences)}
        onManageSubscription={() => navigate({ tab: 'profile', screen: 'subscription' })}
        onBack={() => navigateBack(ROOT_ROUTES.profile)}
        onPurchase={async (plan) => {
          /**
           * The one purchase in the app.
           *
           * There is no billing account yet, so no money moves — but everything
           * else is real: the instant and the term are recorded, every renewal
           * date in the app is counted from them rather than written (the bug
           * #bugs logged when the receipt shipped a hardcoded "15.9.2026"),
           * cancelling runs it to the end of the period, and then the
           * entitlement stops. Wiring billing replaces this one write and
           * nothing else.
           *
           * It only ever turns Pro ON. The button that used to turn it back off
           * from this page is gone: ending a membership is the subscription
           * screen's job, and a paywall with an off switch is not a paywall.
           */
          /**
           * While the trial is on, the button that says "start the trial"
           * starts the trial (2026-09-09).
           *
           * `resolveTrialProUntil` was written months ago, imported into
           * App.tsx, and called from nowhere — the flag could be flipped and
           * nobody would get a day of anything. So the CTA and the write now
           * agree: a dated grant that expires on its own, exactly the shape a
           * promo code already has, rather than a subscription the reader was
           * never told they were starting.
           *
           * Lifetime is untouched: it has no trial CTA, so its button still
           * means what it says.
           */
          /**
           * The unlock screen says Pro is on, so it follows the write that turns
           * Pro on and never precedes it. It used to be navigated to beside a
           * `void` write: a refused write is rolled back by `commit` and
           * rethrown, so the reader got a receipt for Pro over an app that had
           * just put Pro back off, and an unhandled rejection with it (audit,
           * 2026-09-20).
           */
          const turnProOn = async (patch: Partial<AppPreferences>) => {
            try {
              await updatePreferences(patch);
              return true;
            } catch (error) {
              console.error('Failed to turn Pro on', error);
              showToast(t(preferences.appLanguage, 'toast.proUnlockFailed'));
              return false;
            }
          };
          // Once per install: a second press of the CTA after the trial is
          // what a purchase is for, so it falls through to the purchase below.
          const trialUntil = canStartProTrial(preferences) && plan !== 'lifetime' ? resolveTrialProUntil() : null;
          if (trialUntil) {
            if (!(await turnProOn({ proTrialUntil: trialUntil, proTrialStartedAt: new Date().toISOString() }))) {
              return;
            }
            // The hand-off row promised a warning two days out, and a promise
            // that needs a permission has to ask for it. Declining costs the
            // reminder, not the trial. Granting has to reach the switch the
            // warning is scheduled behind, or the permission was asked for
            // nothing — and only that switch: the trial asked for one warning,
            // not for the recaps that ship on inside it. A phone that had
            // already allowed notifications answers without a dialog, so this
            // also reaches a reader who once switched the reminders off; what
            // they get is the one warning the trial screen promised, since
            // every other scheduled category goes off with it.
            void requestNotificationPermission(preferences.appLanguage)
              .then((granted) =>
                granted
                  ? // After the system dialog, so from the stored prefs: this
                    // render's are from before it.
                    updatePreferences((current) => ({ notificationPrefs: remindersOptedIn(current.notificationPrefs) }))
                  : undefined,
              )
              .catch(() => undefined);
            navigate({ tab: 'profile', screen: 'premium_unlock', plan, trialUntil });
            return;
          }
          // The invented purchase belongs to the demo build alone. Reachable
          // here after the trial is spent (review, 2026-09-15), it would be a
          // free Pro that never expires in any build that shipped without
          // billing — a build releaseReadiness refuses, but the write must
          // not be the thing that makes the refusal matter.
          //
          // A release build buys from the store, and the record it writes is
          // the store's answer, not the moment the button was pressed. The
          // unlock screen follows that write, as it follows the demo's.
          if (!isDemoBuild()) {
            const outcome = await purchaseStorePlan(plan);
            if (outcome.status === 'cancelled') {
              return;
            }
            if (outcome.status !== 'purchased') {
              showToast(
                t(
                  preferences.appLanguage,
                  outcome.status === 'pending'
                    ? 'premium.purchasePending'
                    : outcome.status === 'failed'
                      ? 'premium.purchaseFailed'
                      : 'premium.purchaseUnavailable',
                ),
              );
              return;
            }
            const record = purchaseRecordFromStore(outcome.customer, preferences);
            if (record.mockSubscriptionPurchasedAt === null) {
              // Paid, and the store has not granted Pro yet: say so rather
              // than show a receipt for something that is not on.
              showToast(t(preferences.appLanguage, 'premium.purchasePending'));
              return;
            }
            if (await turnProOn(record)) {
              navigate({ tab: 'profile', screen: 'premium_unlock', plan: record.mockSubscriptionTerm });
            }
            return;
          }
          const purchased = await turnProOn({
            mockSubscriptionPurchasedAt: new Date().toISOString(),
            mockSubscriptionTerm: plan,
            // A re-purchase after cancelling starts a fresh subscription.
            mockSubscriptionCancelledAt: null,
          });
          if (purchased) {
            navigate({ tab: 'profile', screen: 'premium_unlock', plan });
          }
        }}
        onOpenLegal={(document) => navigate({ tab: 'profile', screen: 'legal', document })}
      />
    );
  }

  if (route.screen === 'premium_unlock') {
    return (
      <PremiumUnlockScreen
        language={preferences.appLanguage}
        plan={route.plan}
        // The reads just unlocked; this is the first one, from their own log.
        coachSpecimen={proCoachSpecimen}
        onOpenAnalysis={() => navigate({ tab: 'progress', screen: 'list' })}
        onManageSubscription={() => navigate({ tab: 'profile', screen: 'subscription' })}
        onSeeEverything={() => navigate({ tab: 'profile', screen: 'premium' })}
        // The badge names the moment only when there is a record of it. A
        // promo went live when it was redeemed, not now — with no instant to
        // show, the badge says "live" and leaves the time out. A trial is not
        // a purchase, so an older purchase record says nothing about it.
        liveSince={route.trialUntil ? null : preferences.mockSubscriptionPurchasedAt ?? null}
        // Counted here, from the instant the purchase was recorded plus the
        // term's own length. One function, shared with the subscription screen.
        //
        // Not for a trial: it renews into nothing. With no purchase record the
        // count ran from the mock charge date, so a monthly trial started today
        // read "renews 15.9.2026 at 9,90 €" — a charge nobody agreed to, on a
        // day already gone. The trial's receipt names the day it ends instead.
        renewsAt={
          route.trialUntil
            ? null
            : nextChargeAt(
                route.plan ?? preferences.mockSubscriptionTerm,
                preferences.mockSubscriptionPurchasedAt ?? MOCK_BILLING.lastChargedAt,
              )
        }
        trialEndsAt={route.trialUntil ?? null}
        // "Takaisin treeniin" goes to Home, not back to the tab the purchase
        // happened to start from. The route lives under `profile` because the
        // paywall does, but the button names a destination and the reader takes
        // it literally: Home is where training starts.
        //
        // Straight Home. The theme offer used to sit in between, because the
        // unlock screen listed dark as one of the things that just changed —
        // it does not any more (free since 2026-08-23), and offering a choice
        // the reader already made during onboarding is asking twice.
        onDone={() => resetToRoute(ROOT_ROUTES.home)}
      />
    );
  }

  if (route.screen === 'training_plan') {
    return (
      <TrainingPlanScreen
        language={preferences.appLanguage}
        startEditingSchedule={route.editSchedule === true}
        planName={profilePlanSummary.name}
        planType={homeActivePlanCard?.programType ?? null}
        planDaysPerWeek={profilePlanSummary.daysPerWeek}
        planExerciseCount={profilePlanSummary.exerciseCount}
        sessions={(homeActivePlanCard?.sessions ?? []).map((session) => ({
          id: session.id,
          // Focus only, no "Päivä N:" — the row's position already says which
          // day this is, and the ordinal cost the name its width (#bugs
          // 2026-08-25).
          title: localizeSessionFocus(formatWorkoutDisplayLabel(session.title), preferences.appLanguage),
          exerciseCount: session.exercises.length,
          totalSets: session.totalSets ?? 0,
          isNext: session.id === homeActivePlanCard?.nextSession.id,
        }))}
        // The days picked in setup, or — when there are none — the weekdays
        // the reminders follow instead, so an empty list here cannot sit
        // beside reminders that fire on the plan's own days.
        trainingDays={
          preferences.setupAvailableDays.length > 0
            ? preferences.setupAvailableDays
            : reminderWeekdays(reminderSchedule())
        }
        // The lead programme's rhythm: this screen is the reader's own week,
        // and that is the programme it follows.
        trainingCycle={planTrainingCycle(leadPlan)}
        exerciseLibrary={exerciseBrowserItems}
        nameBook={exerciseNameBook}
        onTeachName={(wrote, exercise) => teachExerciseName(wrote, { name: exercise.name, libraryItemId: exercise.id })}
        onPickImage={handlePickProgramImage}
        onBack={() => navigateBack(ROOT_ROUTES.profile)}
        onChangeTrainingDays={(days) => void handleChangeTrainingDays(days)}
        onChangeTrainingCycle={
          leadPlan
            ? (cycle) =>
                void setPlanTrainingCycle(leadPlan.id, cycle).catch((error) => {
                  console.error('Failed to save the training rhythm', error);
                  showToast(t(preferences.appLanguage, 'toast.planSaveFailed'));
                })
            : undefined
        }
        onEditCustomPlan={
          homeActivePlanCard?.programType === 'custom'
            ? () =>
                navigate({ tab: 'workout', screen: 'template', workoutTemplateId: homeActivePlanCard.programId })
            : undefined
        }
        onAiAssisted={() => navigate({ tab: 'home', screen: 'ai_chat', intent: 'new_program' })}
        onBrowseCatalog={() => navigate({ tab: 'workout', screen: 'catalog' })}
        catalogCount={readyProgramCount}
        proUnlocked={proUnlocked}
        onOpenPaywall={() => navigate({ tab: 'profile', screen: 'premium' })}
        onBuildYourself={() =>
          programSlots.canCreate
            ? navigate({ tab: 'workout', screen: 'template' })
            : setProgramLimitVisible(true)
        }
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
      />
    );
  }

  if (route.screen === 'notifications') {
    return (
      <NotificationsScreen
        language={preferences.appLanguage}
        prefs={preferences.notificationPrefs}
        scheduleKnown={isScheduleKnown(reminderSchedule())}
        onTrainingBreak={preferences.trainingBreak !== null}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
        onChange={(patch) =>
          // From the stored prefs, not this render's: two switches flipped in
          // quick succession each built from the same snapshot, and the second
          // write put the first switch back (2026-09-26).
          void updatePreferences((current) => ({ notificationPrefs: { ...current.notificationPrefs, ...patch } }))
        }
        requestPermission={() => requestNotificationPermission(preferences.appLanguage)}
        checkPermission={getNotificationPermissionGranted}
        checkWorkoutAlerts={getRestAlertAccessState}
        allowWorkoutAlerts={allowWorkoutAlerts}
        checkExactAlarms={canScheduleExactAlarms}
        onAllowExactAlarms={allowExactAlarms}
        onOpenTrainingPlan={() => navigate({ tab: 'profile', screen: 'training_plan' })}
      />
    );
  }

  if (route.screen === 'training_break') {
    return (
      <TrainingBreakScreen
        language={preferences.appLanguage}
        trainingBreak={preferences.trainingBreak}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
        onStartBreak={(reason, note) =>
          void updatePreferences({ trainingBreak: { reason, note, startedAt: new Date().toISOString() } })
        }
        onEndBreak={() => void updatePreferences({ trainingBreak: null })}
      />
    );
  }

  if (route.screen === 'milestones') {
    return (
      <MilestonesScreen
        language={preferences.appLanguage}
        lifetime={lifetimeSummary}
        ledger={milestoneLedger}
        unitPreference={unitPreference}
        onBack={() => navigateBack({ tab: 'profile', screen: 'list' })}
      />
    );
  }

  if (route.screen === 'subscription') {
    // In a release build every change to a paid subscription is made in the
    // store: the app cannot cancel, resume or switch a Play subscription, it
    // can only send the reader to the page that does and read the answer back
    // (useStoreBillingSync).
    const releaseBuild = !isDemoBuild();
    const openStoreSubscriptions = () =>
      void Linking.openURL(manageSubscriptionsUrl(storePlatformOf(Platform.OS))).catch(() => undefined);
    return (
      <SubscriptionScreen
        language={preferences.appLanguage}
        entitlement={proEntitlement}
        // Only an *expired* promo means "lapsed". A live one is active Pro and
        // resolveSubscriptionView reads it from the entitlement instead.
        lapsedPromoUntil={proEntitlement.unlocked ? null : preferences.promoProUntil}
        mockTerm={preferences.mockSubscriptionTerm}
        mockCancelled={preferences.mockSubscriptionCancelledAt !== null}
        purchasedAt={preferences.mockSubscriptionPurchasedAt}
        onChangeMockTerm={(term) => {
          if (releaseBuild) {
            openStoreSubscriptions();
            return;
          }
          // A plan change is a new subscription, and billing treats it as one.
          // Writing the term alone let a cancelled monthly become a yearly and
          // carry its end date eleven months forward — time nobody bought.
          void updatePreferences({
            mockSubscriptionTerm: term,
            mockSubscriptionPurchasedAt: new Date().toISOString(),
            mockSubscriptionCancelledAt: null,
          });
        }}
        onChangeMockCancelled={(cancelled) => {
          if (releaseBuild) {
            openStoreSubscriptions();
            return;
          }
          if (cancelled) {
            void updatePreferences({ mockSubscriptionCancelledAt: new Date().toISOString() });
            return;
          }
          // Resuming is only a thing while the paid period is still running.
          // After it lapses there is nothing to take back, and clearing the
          // cancellation would hand out Pro for free — so that reader is sent
          // to the one page that sells it.
          if (canResumePurchase(preferences)) {
            void updatePreferences({ mockSubscriptionCancelledAt: null });
            return;
          }
          navigate({ tab: 'profile', screen: 'premium' });
        }}
        demoBuild={isDemoBuild()}
        // The success toast follows the saved answer, never the tap. Without a
        // store in this build the row keeps sending the reader to Play.
        onRestorePurchases={
          releaseBuild && isStoreBillingConfigured()
            ? async () => {
                const customer = await restoreStorePurchases();
                if (!customer) {
                  showToast(t(preferences.appLanguage, 'subs.restore.failed'));
                  return;
                }
                const record = purchaseRecordFromStore(customer, preferences);
                try {
                  await updatePreferences(record);
                } catch (error) {
                  console.error('Failed to save the restored purchase', error);
                  showToast(t(preferences.appLanguage, 'subs.restore.failed'));
                  return;
                }
                showToast(
                  t(
                    preferences.appLanguage,
                    record.mockSubscriptionPurchasedAt ? 'subs.restore.done' : 'subs.restore.none',
                  ),
                );
              }
            : undefined
        }
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
        onManageMembership={() => navigate({ tab: 'profile', screen: 'membership_end' })}
        onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}
      />
    );
  }

  if (route.screen === 'membership_end') {
    return (
      <MembershipEndScreen
        language={preferences.appLanguage}
        // The entitlement names its own source, so the screen never has to
        // guess which of promo / demo switch is keeping Pro on.
        source={proEntitlement.source ?? 'none'}
        promoUntil={proEntitlement.promoUntil}
        // Counted from the same instant the subscription screen counts from,
        // or the two screens name different dates for the same period.
        // The date the entitlement itself will stop on: the end of the current
        // period, rolled forward through renewals. One period after the purchase
        // was months in the past for anyone who had renewed.
        periodEndsAt={
          proEntitlement.purchaseEndsAt ??
          currentPeriodEndAt(
            preferences.mockSubscriptionTerm,
            preferences.mockSubscriptionPurchasedAt ?? MOCK_BILLING.lastChargedAt,
          )
        }
        onBack={() => navigateBack({ tab: 'profile', screen: 'subscription' })}
        onKeep={() => navigateBack({ tab: 'profile', screen: 'subscription' })}
        // Cancelling leaves Pro switched ON until the period ends — that is what
        // the page promises two lines above the button, so ending it on the spot
        // would contradict the screen the reader is standing on.
        onEndNow={() => void updatePreferences({ mockSubscriptionCancelledAt: new Date().toISOString() })}
        // A store subscription is ended in the store. The page sends the reader
        // there instead of playing an "ended" splash over a subscription that
        // is still renewing; the cancellation comes back through the sync.
        onEndInStore={
          // Only with a store to send them to: without one, the record is the
          // demo's invented purchase, and Play would show an empty page.
          !isDemoBuild() && isStoreBillingConfigured() && proEntitlement.source === 'purchase'
            ? () =>
                void Linking.openURL(manageSubscriptionsUrl(storePlatformOf(Platform.OS))).catch(() => undefined)
            : undefined
        }
        onSurveyDone={(reasons, note) => {
          const answer = buildCancelSurveyAnswer(reasons, note, new Date().toISOString());
          if (answer) {
            void updatePreferences({ cancelSurveyAnswer: answer });
          }
        }}
      />
    );
  }

  if (route.screen === 'legal') {
    return (
      <LegalDocumentScreen
        document={route.document}
        language={preferences.appLanguage}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
      />
    );
  }

  if (route.screen === 'edit_profile') {
    return (
      <EditProfileScreen
        language={preferences.appLanguage}
        initialName={preferences.profileName}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
        onSave={(name) => void updatePreferences({ profileName: name })}
      />
    );
  }

  if (route.screen === 'my_data') {
    return (
      <MyDataScreen
        language={preferences.appLanguage}
        preferences={preferences}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
        onSaveBasics={(patch) => void updatePreferences(patch)}
        latestWeighInKg={latestWeighInKg}
        onOpenWeighIns={() => navigate({ tab: 'progress', screen: 'bodyweight' })}
        onEditLimitations={() => navigate({ tab: 'profile', screen: 'setup', stage: 'avoid' })}
        onCreateNewPlan={() => navigate({ tab: 'profile', screen: 'setup', stage: 'location' })}
      />
    );
  }

  if (route.screen === 'export_plan') {
    return (
      <ExportPlanScreen
        language={preferences.appLanguage}
        plans={exportablePlans}
        log={{
          sessions: database.workoutSessions,
          logs: database.exerciseLogs,
          cardio: database.cardioSessions,
        }}
        onBack={() => navigateBack({ tab: 'profile', screen: 'settings' })}
      />
    );
  }

  if (route.screen === 'settings') {
    /**
     * Delete account takes the reader's kept coach copies with it. Every line
     * goes off on the phone first (the account is gone; nothing may be kept
     * under the label from here on), then the server is asked, and a delete
     * that did not land is filed as owed the way Reset and "withdraw" file it,
     * for the retry runner. Called only after the account deletion resolved,
     * and it never reports a failure of that deletion: its own failure is the
     * "copies pending" toast.
     */
    const deleteCoachCopiesAfterAccountDeletion = async () => {
      const logId = preferences.aiLogId;
      if (!logId) {
        return;
      }
      try {
        await updatePreferences({ aiLogChatConsent: false, aiLogComposerConsent: false, aiLogPhotoConsent: false });
        const deleteSentAt = Date.now();
        const forgotten = await forgetAiCoachLog(logId);
        const settling = aiLogDeleteSettlesAt(lastAiLogCarriedAt(logId), deleteSentAt) !== null;
        const stillOwed = await retireAiLogLabel(logId, !forgotten.ok || settling);
        if (stillOwed && !forgotten.ok) {
          showToast(t(preferences.appLanguage, 'toast.coachCopiesPending'));
        }
      } catch {
        showToast(t(preferences.appLanguage, 'toast.coachCopiesPending'));
      }
    };
    return (
      <SettingsScreen
        preferences={preferences}
        initialScrollOffset={settingsScrollOffsetRef.current}
        onScrollOffsetChange={(offsetY) => {
          settingsScrollOffsetRef.current = offsetY;
        }}
        onOpenEditProfile={() => navigate({ tab: 'profile', screen: 'edit_profile' })}
        onBack={() => navigateBack(ROOT_ROUTES.profile)}
        onPreferencesChange={async (patch) => {
          await updatePreferences(patch);
        }}
        onOpenMyData={() => navigate({ tab: 'profile', screen: 'my_data' })}
        onReplayTour={() => {
          // Home's tour gets its first time back.
          void deps.updatePreferences({ firstRunToursSeen: [] });
          deps.resetToRoute(ROOT_ROUTES.home);
        }}
        onImportPlan={() => setSettingsImportVisible(true)}
        onExportPlan={() => navigate({ tab: 'profile', screen: 'export_plan' })}
        homeWidget={
          homeWidgetState?.supported
            ? { added: homeWidgetState.added, onAdd: () => void handleAddHomeWidget() }
            : null
        }
        onOpenNotifications={() => navigate({ tab: 'profile', screen: 'notifications' })}
        onOpenTrainingBreak={() => navigate({ tab: 'profile', screen: 'training_break' })}
        onOpenSubscription={() => navigate({ tab: 'profile', screen: 'subscription' })}
        onOpenPremium={() => navigate({ tab: 'profile', screen: 'premium' })}
        account={
          accountBackup.available
            ? {
                signedIn: accountBackup.state.status === 'signed_in',
                email: accountBackup.state.email,
                lastBackupAt: accountBackup.state.lastBackupAt,
                backupPaused: accountBackup.state.backupPaused,
                busy: accountBackup.phase !== 'idle',
                providers: accountBackup.providers,
                onSignIn: (provider) => void handleAccountSignIn(provider),
                // Only the failure speaks; the row's green timestamp is the
                // success, and it is already on screen. A phone that has never
                // synced may be asked restore-or-keep first, as at sign-in.
                onBackupNow: () => void handleAccountBackupNow(),
                onSignOut: () => void accountBackup.signOut(),
                onDeleteRemote: () => {
                  Alert.alert(
                    t(preferences.appLanguage, 'account.deleteRemote'),
                    t(preferences.appLanguage, 'account.deleteRemote.sub'),
                    [
                      { text: t(preferences.appLanguage, 'common.cancel'), style: 'cancel' },
                      {
                        text: t(preferences.appLanguage, 'account.deleteRemote'),
                        style: 'destructive',
                        onPress: () => {
                          // The one the reader photographed off the phone and
                          // marked prio 1: a white bar reading "Pilvivarmuus-
                          // kopio poistettu" over a row that has just changed
                          // to "Ei vielä varmuuskopiota". The row is the
                          // answer; the bar was the app saying it twice.
                          // A failure has no row to show it, so it speaks:
                          // silence read as "deleted" while the copy stayed.
                          void accountBackup.deleteRemoteBackup().then((result) => {
                            if (result === 'failed') {
                              showToast(t(preferences.appLanguage, 'account.deleteRemote.failed'));
                            } else if (result === 'ended') {
                              // Signed out because the sign-in was over; nothing
                              // was deleted, and "try again" would not work.
                              showToast(t(preferences.appLanguage, 'account.sessionEnded'));
                            }
                          });
                        },
                      },
                    ],
                  );
                },
                onDeleteAccount: () => {
                  Alert.alert(
                    t(preferences.appLanguage, 'account.deleteAccount'),
                    // The Apple sentence only for a reader signed in with Apple:
                    // a Google sign-in has no session of ours to end elsewhere.
                    t(
                      preferences.appLanguage,
                      accountBackup.state.provider === 'apple'
                        ? 'account.deleteAccount.message.apple'
                        : 'account.deleteAccount.message',
                    ),
                    [
                      { text: t(preferences.appLanguage, 'common.cancel'), style: 'cancel' },
                      {
                        text: t(preferences.appLanguage, 'account.deleteAccount'),
                        style: 'destructive',
                        onPress: () => {
                          // "Done" is said only once the server has deleted and
                          // this phone has signed out — both writes resolved.
                          // A failure speaks as a toast and leaves the reader
                          // signed in to try again.
                          void accountBackup
                            .deleteAccount()
                            .then((result) => {
                              if (result === 'done') {
                                Alert.alert(
                                  t(preferences.appLanguage, 'account.deleteAccount.done.title'),
                                  t(preferences.appLanguage, 'account.deleteAccount.done.body'),
                                );
                                // The account is deleted; the coach's kept copies
                                // go with it, asked for after and on their own:
                                // that call can take the whole request timeout,
                                // and its failure is a queued delete, never a
                                // failed account deletion.
                                void deleteCoachCopiesAfterAccountDeletion();
                              } else if (result === 'ended') {
                                // Signed out because the account was deleted
                                // elsewhere or its sign-in had ended: nothing was
                                // deleted by this tap, and the words say so.
                                Alert.alert(
                                  t(preferences.appLanguage, 'account.deleteAccount.ended.title'),
                                  t(preferences.appLanguage, 'account.deleteAccount.ended.body'),
                                );
                              } else if (result === 'failed') {
                                showToast(t(preferences.appLanguage, 'account.deleteAccount.failed'));
                              }
                            })
                            .catch(() => showToast(t(preferences.appLanguage, 'account.deleteAccount.failed')));
                        },
                      },
                    ],
                  );
                },
              }
            : null
        }
        onOpenLegal={(document) => navigate({ tab: 'profile', screen: 'legal', document })}
        /**
         * Withdrawing, and meaning it.
         *
         * The switch on the phone goes off whatever the server says — a reader
         * who said stop has said stop, and a failed network call must not leave
         * the app still allowed to send copies. The delete is attempted after,
         * and the label is cleared only once every line is off: a new yes then
         * mints a new label, so two stretches of consent cannot be joined into
         * one history.
         *
         * A delete that did not land is filed the way Reset files its own
         * (`pendingAiLogDeletions`), so the retry runner finishes it on the
         * next start and every foreground. Before that the one attempt made
         * here was the only one there would ever be: offline when the last
         * switch went off, and the copies waited for the reader to toggle
         * something again, or for the 24-month sweep (2026-09-19).
         */
        onWithdrawCoachLog={async (line, next) => {
          const patch =
            line === 'chat'
              ? { aiLogChatConsent: next }
              : line === 'composer'
                ? { aiLogComposerConsent: next }
                : { aiLogPhotoConsent: next };
          const remaining = {
            chat: line === 'chat' ? next : preferences.aiLogChatConsent,
            composer: line === 'composer' ? next : preferences.aiLogComposerConsent,
            photo: line === 'photo' ? next : preferences.aiLogPhotoConsent,
          };
          const allOff = !remaining.chat && !remaining.composer && !remaining.photo;
          const logId = preferences.aiLogId;
          await updatePreferences({
            ...patch,
            ...(next && !logId ? { aiLogId: randomLogId() } : {}),
          });
          if (next || !logId) {
            return;
          }
          const deleteSentAt = Date.now();
          const forgotten = await forgetAiCoachLog(logId);
          if (!allOff) {
            // A line is still on, so copies are still being kept under this
            // label: it stays, and it must not be filed as owed — the retry
            // would delete the copies the reader is still allowing.
            return;
          }
          // The label is retired here either way, and filed as a delete still
          // owed when the server did not confirm — after that the runner asks
          // again on every start and foreground until it does, and a new yes
          // mints a new label rather than reusing one whose copies are owed.
          //
          // Through the provider's queue rather than an `updatePreferences`
          // patch built here: the delete above can take the whole request
          // timeout, so the `preferences` this closure holds is stale by the
          // time it returns, and writing its list back would drop a label a
          // reset filed in the meantime — leaving those copies under a name
          // nothing can look up (CI review of #143).
          //
          // A confirmed delete is not the last word while a question sent
          // under the label may still be answered: the server keeps its copy
          // after the model replies, which is after this delete listed what
          // was there. Until that request's copy has landed the label stays
          // owed, and the runner asks again then (server audit, 2026-09-21).
          // Quietly: what was kept is gone, and the rest follows within the
          // minute — the toast is for a delete that did not land.
          const settling = aiLogDeleteSettlesAt(lastAiLogCarriedAt(logId), deleteSentAt) !== null;
          const stillOwed = await retireAiLogLabel(logId, !forgotten.ok || settling);
          if (stillOwed && !forgotten.ok) {
            showToast(t(preferences.appLanguage, 'toast.coachCopiesPending'));
          }
        }}
        onRestoreSetAsideWorkout={
          workout.setAsideWorkoutAvailable
            ? () => {
                // Said once the copy is stored and shown, or why it was not; a refused write changes nothing.
                void workout.restoreSetAsideWorkout().then(
                  (result) =>
                    showToast(
                      t(
                        preferences.appLanguage,
                        result === 'restored'
                          ? 'settings.restoreAside.done'
                          : result === 'busy'
                            ? 'settings.restoreAside.busy'
                            : result === 'unreadable'
                              ? 'settings.restoreAside.unreadable'
                              : 'settings.restoreAside.none',
                      ),
                    ),
                  (error) => {
                    // Not an error report: the policy lists the failures reported, and this is not one of them.
                    console.error('Restore of the set-aside workout failed', error);
                    showToast(t(preferences.appLanguage, 'settings.restoreAside.failed'));
                  },
                );
              }
            : null
        }
        onResetAllData={async () => {
          // The coach's kept copies are part of "all data". The reset files
          // their label as a delete still owed in the same write that clears
          // it (resetDatabase), so the delete is asked for after the wipe —
          // the local part never waits on the network, and a delete that
          // fails is retried on the next start or foreground until the server
          // confirms it.
          const logId = preferences.aiLogId;
          // Sign out BEFORE wiping: reset while signed in would let the
          // auto-backup push the freshly emptied database over the cloud
          // copy — the reset would silently destroy the one safety net it
          // is the safety net for. Signed out, the cloud copy survives and
          // the next sign-in offers it back.
          await accountBackup.signOut();
          //
          // The workout bundle (active session + slot history) goes BEFORE the
          // database write: that write is the one that makes the app open as
          // reset (onboarding showing), so a kill between the two used to
          // leave a reset-looking app with the old active session and slot
          // history resurfacing. In this order a kill or a failed database
          // write leaves the app not reset, with the database intact but the
          // active session and the "last time" loads already gone — the lesser
          // loss, and a retry finishes the job (bug hunt, 2026-10-04).
          await workout.resetWorkoutData();
          setCompletionSummary(null);
          setFinishSaveState({ status: 'idle', sessionId: null });
          await resetAllData();
          // Both wipes have resolved: nobody's data is on this phone, so the
          // accounts it was signed out of have nothing left to ask about. Not
          // earlier — a failed wipe throws above and keeps the marks. A failure
          // here keeps them too (asks once too often, never too seldom).
          try {
            await accountBackup.forgetSignedOutAccounts();
          } catch {
            // Fail closed.
          }
          resetToRoute(ROOT_ROUTES.home);
          if (logId) {
            // Empty in a build without the live coach: it sends nothing, and
            // there is nothing to say. Otherwise the reader hears once, here,
            // that part of the request is still under way; the retries after
            // this are quiet, because the label never comes back to a reset.
            const notYet = await deletePendingAiLogs([logId]);
            if (notYet.includes(logId)) {
              // In the language the app has just come back in — the phone's,
              // as resetDatabase chose it — not the one this closure remembers.
              showToast(t(resolveDeviceLanguage(), 'toast.resetCoachCopiesPending'));
            }
          }
        }}
      />
    );
  }

  return (
    <ProfileScreen
      preferences={preferences}
      lifetime={lifetimeSummary}
      trackedProgress={trackedProgress}
      exerciseLibrary={exerciseLibrary}
      unitPreference={unitPreference}
      onOpenSettings={() => navigate({ tab: 'profile', screen: 'settings' })}
      recordCount={distinctRecordCount}
      milestoneLedger={milestoneLedger}
      onOpenMilestones={() => navigate({ tab: 'profile', screen: 'milestones' })}
      onOpenRecords={() => navigate({ tab: 'progress', screen: 'list', section: 'records' })}
      onEditProfile={() => navigate({ tab: 'profile', screen: 'edit_profile' })}
      onOpenRating={(() => {
        // iPhone: no star sheet of ours (App Review 5.6.1) — the row opens the
        // App Store's write-review page, and is hidden until that URL exists.
        const store = storePlatformOf(Platform.OS);
        if (!usesSystemReviewPrompt(store)) {
          return () => setRatingSheetVisible(true);
        }
        const reviewUrl = writeReviewUrl(store, process.env.EXPO_PUBLIC_APP_STORE_URL);
        return reviewUrl
          ? () => {
              void updatePreferences((current) => ({ ratingPrompt: recordRatingCompleted(current.ratingPrompt) }));
              void Linking.openURL(reviewUrl);
            }
          : undefined;
      })()}
    />
  );
}
