import React from 'react';
import { Linking } from 'react-native';

import { AppShell } from '../components/AppShell';
import { BottomTabBar } from '../components/BottomTabBar';
import type { NewProgramSheet } from '../components/NewProgramSheet';
import { ProgramLimitSheet } from '../components/ProgramLimitSheet';
import { RateAppSheet } from '../components/RateAppSheet';
import { ThemeChoiceDialog } from '../components/ThemeChoiceDialog';
import { AppUpdateDialog } from '../features/appUpdate/AppUpdateDialog';
import { ServerNoticeDialog } from '../features/serverNotice/ServerNoticeDialog';
import { hevyWorkoutsToLoggedSessions, HevyLoggedSession } from '../lib/hevyImport';
import { t } from '../lib/i18n';
import { resolveProEntitlement } from '../lib/proEntitlement';
import type { RunningCapRefusal } from '../lib/programCapNotice';
import { ProgramSlots } from '../lib/programSlots';
import { recordRatingCompleted } from '../lib/ratingPrompt';
import { AppRoute, RootTabKey } from '../navigation/routes';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppPreferences, WorkoutTemplateDraft } from '../types/models';
import { createUnlessAtLimit } from './programLimitGuard';

type SettingsImportSheetProps = Omit<React.ComponentProps<typeof NewProgramSheet>, 'bottomInset'>;
type TabBarProps = React.ComponentProps<typeof BottomTabBar>;
type RunningCapSheet = { visible: boolean } & RunningCapRefusal;

/**
 * The app shell and the sheets and dialogs that sit over every screen, moved
 * verbatim from the end of VinhaApp in phase C of the split (2026-10-01),
 * with the safe-area edges the shell is drawn inside. VinhaApp still returns
 * this, after its two early returns (the launch screen and the brand
 * splash), so the tree React sees is the one it always saw.
 *
 * `SettingsImportSheet` and `PLAY_LISTING_URL` are App.tsx's own, passed in
 * rather than moved: the sheet must stay the same component, or React would
 * remount it, and both are App.tsx module scope, outside this phase's cut.
 */
export interface AppShellDeps {
  content: React.ReactNode;
  route: AppRoute;
  historySessionActive: boolean;
  welcomeActive: boolean;
  workoutSummaryActive: boolean;
  onboardingScreenActive: boolean;
  premiumActive: boolean;
  showTabBar: boolean;
  fullBleedReview: 'light' | 'dark' | null;
  toastMessage: string | null;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  navigate: (nextRoute: AppRoute) => void;
  navigateToTab: (tab: RootTabKey) => void;
  /** Runs a bar press through the open screen's unsaved-work question. */
  leaveThroughScreenGuard: (leave: () => void) => void;
  tourSweep: TabBarProps['sweep'];
  tourRegistry: TabBarProps['tourTargets'];
  legalConsentDue: 'first' | 'changed' | null;
  renderLegalConsent: (shellPadsBottom: boolean) => React.ReactNode;
  tourElement: React.ReactNode;
  appUpdateHeld: boolean;
  handleServerNoticeSeen: (id: string) => void;
  SettingsImportSheet: React.ComponentType<SettingsImportSheetProps>;
  settingsImportVisible: boolean;
  setSettingsImportVisible: React.Dispatch<React.SetStateAction<boolean>>;
  exerciseBrowserItems: SettingsImportSheetProps['exerciseLibrary'];
  exerciseNameBook: NonNullable<SettingsImportSheetProps['nameBook']>;
  handlePickProgramImage: SettingsImportSheetProps['onPickImage'];
  teachExerciseName: (wrote: string, exercise: { name: string; libraryItemId: string | null }) => Promise<void>;
  upsertWorkoutTemplate: (draft: WorkoutTemplateDraft) => Promise<string>;
  importWorkoutHistory: (
    workouts: Parameters<NonNullable<SettingsImportSheetProps['onImportHistory']>>[0]['workouts'],
  ) => Promise<{ imported: number; duplicates: number; sessionIds: string[]; skipped: number }>;
  /** The workout store's bulk filing, so imported lifts open on their last time. */
  recordLoggedWorkouts: (sessions: HevyLoggedSession[]) => void;
  showToast: (message: string) => void;
  programLimitVisible: boolean;
  setProgramLimitVisible: React.Dispatch<React.SetStateAction<boolean>>;
  programSlots: ProgramSlots;
  runningCapSheet: RunningCapSheet;
  setRunningCapSheet: React.Dispatch<React.SetStateAction<RunningCapSheet>>;
  themeChoiceVisible: boolean;
  setThemeChoiceVisible: React.Dispatch<React.SetStateAction<boolean>>;
  ratingSheetVisible: boolean;
  setRatingSheetVisible: React.Dispatch<React.SetStateAction<boolean>>;
  PLAY_LISTING_URL: string;
}

export function renderAppShell(deps: AppShellDeps): React.ReactElement {
  const {
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
    recordLoggedWorkouts,
    showToast,
    programLimitVisible,
    setProgramLimitVisible,
    programSlots,
    runningCapSheet,
    setRunningCapSheet,
    themeChoiceVisible,
    setThemeChoiceVisible,
    ratingSheetVisible,
    setRatingSheetVisible,
    PLAY_LISTING_URL,
  } = deps;

  const shellSafeAreaEdges: Array<'top' | 'left' | 'right' | 'bottom'> =
    // A saved workout drops the TOP edge so its gradient runs under the
    // status bar — and used to drop the bottom one with it, which put the
    // floating tab bar on top of the phone's own navigation buttons.
    historySessionActive
      ? ['left', 'right', 'bottom']
      : welcomeActive || workoutSummaryActive || fullBleedReview !== null
        ? ['left', 'right']
        : onboardingScreenActive
          ? // Every onboarding screen pads for the status bar itself — the
            // path fork, About you, the ready catalog, the questionnaire
            // and its back chevron all read insets.top. With the shell
            // padding the top edge too, each of them sat one status bar
            // too low, and the questionnaire's chevron (insets.top + 10
            // inside a root already below the bar) landed on "STEP 2 OF
            // 6" ("step teksti menee back napin taakse", user
            // 2026-09-02). Same edges as Welcome, for the same reason.
            //
            // onboardingScreenActive, not onboardingActive: the same
            // questionnaire is the plan editor under Profile, and it
            // reads the inset there too (PR review).
            ['left', 'right']
          : ['top', 'left', 'right', 'bottom'];

  return (
    <AppShell
      toastMessage={toastMessage}
      safeAreaEdges={shellSafeAreaEdges}
      // Only the gradient-hero screens want light icons; everything else takes
      // the shell's light default.
      // The Pro page is black in both themes, so the bands the shell paints
      // around it have to be too — see premiumActive.
      shellBackgroundColor={premiumActive ? '#000000' : undefined}
      statusBarStyleOverride={
        // The workout summary is off this list since its hero turned gold: a
        // pale gold bar needs dark icons, and the shell already derives that
        // from the theme.
        fullBleedReview
          ? fullBleedReview
          : historySessionActive || premiumActive
            ? 'light'
            : undefined
      }
      statusBarBackgroundColor={
        // The saved workout's hero scrolls, and under a transparent bar its
        // date ended up printed across the phone's clock. Painted with the
        // hero's own top colour it is invisible at rest and a clean cap once
        // the screen moves.
        historySessionActive
          ? '#8B5CF6'
          : premiumActive
            ? '#000000'
            : workoutSummaryActive || welcomeActive || fullBleedReview !== null
              ? 'transparent'
              : undefined
      }
      statusBarTranslucent={
        welcomeActive || workoutSummaryActive || historySessionActive || fullBleedReview !== null
      }
      tabBar={
        showTabBar ? (
          <BottomTabBar
            language={preferences.appLanguage}
            activeTab={route.tab === 'workout' && route.screen === 'plans' ? null : route.tab}
            aiActive={
              route.tab === 'home' &&
              route.screen === 'ai_chat'
            }
            // Both unmount the screen under them, so both ask what its Back
            // asks: the programme builder dropped its draft on a tab press.
            onTabPress={(tab) => leaveThroughScreenGuard(() => navigateToTab(tab))}
            // The design's rule for the middle button: it opens the chat, for
            // everyone, always. It used to open a paywall-shaped sheet — the
            // app's most valuable placement spent on an advert.
            onAiPress={() => leaveThroughScreenGuard(() => navigate({ tab: 'home', screen: 'ai_chat' }))}
            sweep={tourSweep}
            tourTargets={tourRegistry}
          />
        ) : undefined
      }
      overlay={
        legalConsentDue ? renderLegalConsent(shellSafeAreaEdges.includes('bottom')) : tourElement
      }
    >
      {content}
      <AppUpdateDialog language={preferences.appLanguage} held={appUpdateHeld} />
      <ServerNoticeDialog
        language={preferences.appLanguage}
        held={appUpdateHeld}
        seenIds={preferences.seenServerNoticeIds}
        onSeen={handleServerNoticeSeen}
      />
      <SettingsImportSheet
        visible={settingsImportVisible}
        initialView="csv"
        language={preferences.appLanguage}
        exerciseLibrary={exerciseBrowserItems}
        nameBook={exerciseNameBook}
        onPickImage={handlePickProgramImage}
        // The photo link on the paste box is Pro only (2026-09-29), so this
        // sheet passes the lock too; the AI-assisted row it also gates is
        // never drawn from here.
        proUnlocked={resolveProEntitlement(preferences).unlocked}
        onOpenPaywall={() => navigate({ tab: 'profile', screen: 'premium' })}
        onTeachName={(wrote, exercise) =>
          teachExerciseName(wrote, { name: exercise.name, libraryItemId: exercise.id })
        }
        onClose={() => setSettingsImportVisible(false)}
        // Settings' CSV sheet opens straight on the paste box, so this row is
        // never drawn from here. The lock itself was decided on 2026-09-01, reversing the
        // earlier "the chat, for everyone" call: the gate had moved onto the
        // act of composing, and the row went to the chat for anyone.
        onAiAssisted={() =>
          navigate({ tab: 'home', screen: 'ai_chat', intent: 'new_program' })
        }
        onBuildYourself={() => navigate({ tab: 'workout', screen: 'template' })}
        onImportProgram={async (draft) => {
          const workoutTemplateId = await createUnlessAtLimit(
            () => upsertWorkoutTemplate(draft),
            () => setProgramLimitVisible(true),
          );
          if (!workoutTemplateId) {
            // Refused at the cap: the sheet stays open with the table it read,
            // so this one does not hide it either.
            return false;
          }
          setSettingsImportVisible(false);
          navigate({ tab: 'workout', screen: 'program', programType: 'custom', workoutTemplateId });
          return true;
        }}
        onImportHistory={async (preview) => {
          // Thrown on when the write fails: the sheet keeps the pasted export
          // for a retry and says why itself. A toast from here would draw
          // behind its modal.
          let result;
          try {
            result = await importWorkoutHistory(preview.workouts);
          } catch (error) {
            console.error('Failed to import workout history', error);
            throw error;
          }
          // The database has them; the weight a set opens on and its "Last
          // time" card read the workout store, which the import never wrote
          // (hunt, 2026-10-09). Every workout the database now holds, those
          // it already had included, so importing the file again mends an
          // import made before this.
          recordLoggedWorkouts(
            hevyWorkoutsToLoggedSessions(preview.workouts, new Set(result.sessionIds), exerciseNameBook),
          );
          setSettingsImportVisible(false);
          const imported = t(
            preferences.appLanguage,
            result.duplicates > 0
              ? result.imported === 1
                ? 'hevy.doneWithDuplicatesOne'
                : 'hevy.doneWithDuplicates'
              : result.imported === 1
                ? 'hevy.doneOne'
                : 'hevy.done',
            { imported: String(result.imported), duplicates: String(result.duplicates) },
          );
          // Said apart from the duplicates: these were never in the app.
          showToast(
            result.skipped > 0
              ? `${imported} · ${t(preferences.appLanguage, 'hevy.doneLeftOut', { skipped: String(result.skipped) })}`
              : imported,
          );
        }}
      />
      <ProgramLimitSheet
        visible={programLimitVisible}
        kind="own"
        used={programSlots.used}
        limit={programSlots.limit ?? programSlots.used}
        language={preferences.appLanguage}
        onClose={() => setProgramLimitVisible(false)}
        onSeePro={() => {
          setProgramLimitVisible(false);
          navigate({ tab: 'profile', screen: 'premium' });
        }}
      />
      <ProgramLimitSheet
        visible={runningCapSheet.visible}
        kind="running"
        used={runningCapSheet.used}
        limit={runningCapSheet.cap}
        replacingStop={runningCapSheet.replacingStop}
        language={preferences.appLanguage}
        onClose={() => setRunningCapSheet((current) => ({ ...current, visible: false }))}
        onSeePro={() => {
          setRunningCapSheet((current) => ({ ...current, visible: false }));
          navigate({ tab: 'profile', screen: 'premium', reason: 'program_cap' });
        }}
      />
      <ThemeChoiceDialog
        visible={themeChoiceVisible}
        language={preferences.appLanguage}
        darkEnabled={preferences.darkThemeEnabled}
        // Written straight to preferences, so the dialog repaints itself along
        // with everything behind it. That IS the preview.
        onChange={(dark) => void updatePreferences({ darkThemeEnabled: dark })}
        // Closes onto the path screen, which onboarding is already showing
        // behind it. No navigation: the dialog interrupts the flow, it does
        // not move it.
        onDone={() => setThemeChoiceVisible(false)}
      />
      {/* Built months ago and left unwired — the strings even said so. The
          sheet takes the star it was given and ignores it on purpose: every
          star opens the same listing, because routing the low ones somewhere
          private is review gating and against Play policy. */}
      <RateAppSheet
        visible={ratingSheetVisible}
        language={preferences.appLanguage}
        onRate={() => {
          setRatingSheetVisible(false);
          // Every star arrives here. Marked rated on the way out rather than
          // on the way back: the app never learns whether a review was
          // actually left, and asking again someone who went to the listing
          // is worse than missing one who changed their mind.
          void updatePreferences((current) => ({ ratingPrompt: recordRatingCompleted(current.ratingPrompt) }));
          void Linking.openURL(PLAY_LISTING_URL);
        }}
        onDismiss={() => setRatingSheetVisible(false)}
      />
    </AppShell>
  );
}
