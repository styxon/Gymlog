import React from 'react';
import { View } from 'react-native';

import { availableSignInProviders } from '../features/account/accountAuth';
import { trackEvent } from '../features/analytics/analyticsClient';
import { FirstRunSetupSelection, getFocusAreaTitle } from '../lib/firstRunSetup';
import { t } from '../lib/i18n';
import { legalAcceptanceDue } from '../lib/legalAcceptance';
import { LEGAL_LAST_UPDATED, type LegalDocumentId } from '../lib/legalDocuments';
import type { SetupHandoffPlan } from '../lib/setupHandoff';
import type { TailoringPreferencesInput } from '../lib/tailoringFit';
import { AppRoute, ROOT_ROUTES } from '../navigation/routes';
import { AboutYouScreen, AboutYouValues } from '../screens/AboutYouScreen';
import { LegalDocumentScreen } from '../screens/LegalDocumentScreen';
import { OnboardingReadyCatalogScreen } from '../screens/OnboardingReadyCatalogScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SetupHandoffChoices, SetupHandoffScreen } from '../screens/SetupHandoffScreen';
import { StartPathScreen } from '../screens/StartPathScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import type { PreferencesPatch } from '../state/AppProvider';
import { AppPreferences, SetupCautionFlag, UnitPreference } from '../types/models';

type OnboardingStep = 'path' | 'about' | 'questionnaire' | 'ready_catalog';

/**
 * The first-run flow's screens — Welcome, the path fork, About you, the ready
 * catalogue and the questionnaire — moved verbatim from App.tsx's render
 * chain in phase C of the split (2026-10-01). App.tsx still decides WHEN
 * onboarding owns the screen (`onboardingActive`); this decides which step of
 * it is drawn. The `content` assignments are kept as they stood, so every
 * line moved byte for byte, one indent shallower.
 */
export interface OnboardingFlowDeps {
  entryFlowActive: boolean;
  onboardingStep: OnboardingStep;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  preferences: AppPreferences;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  handleContinueEntry: () => Promise<void>;
  completeOnboarding: (patch?: Partial<AppPreferences>) => Promise<void>;
  navigate: (nextRoute: AppRoute) => void;
  showToast: (message: string) => void;
  handleBackToEntry: () => Promise<void>;
  aboutYouValues: AboutYouValues | null;
  setAboutYouValues: React.Dispatch<React.SetStateAction<AboutYouValues | null>>;
  busySavingReadyPick: boolean;
  handleOnboardingPickReadyProgram: (programId: string) => Promise<void>;
  unitPreference: UnitPreference;
  tailoringPreferences: TailoringPreferencesInput;
  workout: { templates: unknown[] };
  dismissedTipIds: string[];
  handleDismissTip: (tipId: string) => Promise<void>;
  handleOnboardingCompleteToTraining: (selection: FirstRunSetupSelection, recommendedProgramId: string) => Promise<void>;
  setFullBleedReview: React.Dispatch<React.SetStateAction<'light' | 'dark' | null>>;
}

export function renderOnboardingFlow(deps: OnboardingFlowDeps): React.ReactNode {
  const {
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
  } = deps;

  let content: React.ReactNode = null;
  if (entryFlowActive) {
    content = (
      <WelcomeScreen
        language={preferences.appLanguage}
        onChangeLanguage={(nextLanguage) => void updatePreferences({ appLanguage: nextLanguage })}
        onContinue={() => void handleContinueEntry()}
      />
    );
  } else if (onboardingStep === 'path') {
    content = (
      <StartPathScreen
        language={preferences.appLanguage}
        // Both paths go straight to about-you. A Health Connect step used to
        // sit here and was removed for v1 on 2026-08-11: it imported exactly
        // two numbers that the next screen asks for anyway, and on a real
        // Galaxy A54 it imported nothing at all — the break is between
        // Samsung Health and Health Connect, outside this app, and only adb
        // can see it. A user just taps and watches nothing happen, in the
        // first minute, before the app has shown any value. Health returns in
        // v2 under Settings, and as an export of finished workouts rather
        // than an import of body stats.
        onGuidedOnboarding={() => {
          setOnboardingStep('about');
        }}
        /**
         * In with nothing at all (user 2026-08-31).
         *
         * A reader who wants to look around before committing had to answer
         * a questionnaire or adopt a programme first — the front door had no
         * handle for "not yet". No plan, no template, no questionnaire:
         * `setupCompleted` stays false, so Profile still offers to fill the
         * profile in later, and Home shows its no-programme state rather
         * than a plan nobody chose.
         */
        onStartEmpty={() => {
          // Returned, so the screen holds its button until the write settles
          // (bug hunt, 2026-10-04: a double tap ran this twice).
          return completeOnboarding({
            onboardingCompleted: true,
            setupCompleted: false,
            trainingFirstRunDismissed: false,
            // The handoff's two offers are skipped too: they are the
            // friction this path exists to escape, and both live in
            // Settings for whenever the reader wants them.
            setupHandoffCompleted: true,
          })
            .then(() => {
              // Counted once it has happened, not when it was asked for.
              trackEvent('onboarding_completed', { path: 'empty' });
              navigate({ tab: 'home', screen: 'dashboard' });
            })
            // A refused write left the reader on this screen with no word
            // about why the button did nothing (2026-09-17).
            .catch((error) => {
              console.error('Failed to start empty', error);
              showToast(t(preferences.appLanguage, 'toast.startEmptyFailed'));
            });
        }}
        onBrowsePrograms={() => {
          // Straight to the catalog. This fork used to detour through the
          // About-you form first, which is the opposite of what the card
          // promises ("choose the program you want yourself") — the reader
          // asked to skip the questions and got a form. Nothing downstream
          // needs the answers: handleOnboardingPickReadyProgram already
          // reads every basic through `aboutYouValues?.` and stores null.
          // The profile is filled in later, from Settings.
          setOnboardingStep('ready_catalog');
        }}
        onBack={() => void handleBackToEntry()}
      />
    );
  } else if (onboardingStep === 'about') {
    content = (
      <AboutYouScreen
        language={preferences.appLanguage}
        initialValues={aboutYouValues}
        onContinue={(values) => {
          setAboutYouValues(values);
          // Only the build path opens About; the ready path goes from the
          // fork straight to the catalogue.
          setOnboardingStep('questionnaire');
        }}
        onBack={() => {
          // The abandoned form must not travel on: the ready-pick finish
          // writes aboutYouValues into the profile (and the weight into a
          // weigh-in), and the reset effect in App.tsx only fires when the
          // gate closes (bug hunt, 2026-10-04).
          setAboutYouValues(null);
          setOnboardingStep('path');
        }}
      />
    );
  } else if (onboardingStep === 'ready_catalog') {
    content = (
      <OnboardingReadyCatalogScreen
        language={preferences.appLanguage}
        busy={busySavingReadyPick}
        onPick={(programId) => void handleOnboardingPickReadyProgram(programId)}
        // Back goes where the reader came from, which is the fork — not the
        // About form they deliberately did not open.
        onBack={() => setOnboardingStep('path')}
      />
    );
  } else {
    content = (
      <OnboardingScreen
        initialUnitPreference={unitPreference}
        language={preferences.appLanguage}
        tailoringPreferences={tailoringPreferences}
        readyProgramCount={workout.templates.length}
        dismissedTipIds={dismissedTipIds}
        basicsSeed={
          aboutYouValues
            ? {
                gender: aboutYouValues.gender ?? 'unspecified',
                ageRange: aboutYouValues.ageRange,
                currentWeightKg: aboutYouValues.weightKg,
              }
            : null
        }
        onDismissTip={handleDismissTip}
        onBackToEntry={() => setOnboardingStep('about')}
        onCompleteToTraining={handleOnboardingCompleteToTraining}
        onFullBleedReviewChange={setFullBleedReview}
      />
    );
  }
  return content;
}

/**
 * The hand-off between the last question and the app, with the legal
 * document laid over it rather than swapped in for it. Moved verbatim from
 * App.tsx's render chain; the overlay style is App.tsx's own constant, passed
 * in rather than copied so the consent sheet and this keep one geometry.
 */
export interface SetupHandoffDeps {
  preferences: AppPreferences;
  setupHandoffPlan: SetupHandoffPlan;
  handleSetupHandoffDone: (choices: SetupHandoffChoices) => Promise<void>;
  setHandoffLegalDocument: React.Dispatch<React.SetStateAction<LegalDocumentId | null>>;
  handoffLegalDocument: LegalDocumentId | null;
  LEGAL_OVER_HANDOFF: React.ComponentProps<typeof View>['style'];
}

export function renderSetupHandoff(deps: SetupHandoffDeps): React.ReactNode {
  const {
    preferences,
    setupHandoffPlan,
    handleSetupHandoffDone,
    setHandoffLegalDocument,
    handoffLegalDocument,
    LEGAL_OVER_HANDOFF,
  } = deps;

  let content: React.ReactNode = null;
  content = (
    <>
    <SetupHandoffScreen
      language={preferences.appLanguage}
      plan={setupHandoffPlan}
      focusLabel={
        setupHandoffPlan.tracking?.focus
          ? getFocusAreaTitle(setupHandoffPlan.tracking.focus, preferences.appLanguage)
          : null
      }
      signInProviders={availableSignInProviders()}
      onDone={(choices) => void handleSetupHandoffDone(choices)}
      onSkip={() =>
        void handleSetupHandoffDone({
          addWidget: false,
          signInForBackup: false,
          signInProvider: null,
          showPro: false,
          trackedSites: [],
          legalAccepted: false,
        })
      }
      onOpenLegal={(document) => setHandoffLegalDocument(document)}
      legalAlreadyAccepted={
        legalAcceptanceDue(preferences.legalAcceptance, LEGAL_LAST_UPDATED) === null
      }
    />
    {/* Over the hand-off, never instead of it (2026-09-10). The screen owns
        the reader's answers in local state — which page they are on, which
        sites they picked, whether they asked for the widget — so swapping it
        out to show a document threw all of that away and put them back on
        page one. Reading the policy is not a decision to unmake. */}
    {handoffLegalDocument ? (
      <View style={LEGAL_OVER_HANDOFF}>
        <LegalDocumentScreen
          document={handoffLegalDocument}
          language={preferences.appLanguage}
          onBack={() => setHandoffLegalDocument(null)}
        />
      </View>
    ) : null}
    </>
  );
  return content;
}

/**
 * The questionnaire re-opened from Profile as the plan editor. Moved verbatim
 * from App.tsx's render chain; its `key` still remounts it whenever the
 * recommendation, the setup state or the stage changes.
 */
export interface SetupEditorDeps {
  route: Extract<AppRoute, { tab: 'profile'; screen: 'setup' }>;
  preferences: AppPreferences;
  setupEditSelection: FirstRunSetupSelection | null;
  setupBasics: Partial<FirstRunSetupSelection>;
  setupSelection: FirstRunSetupSelection | null;
  unitPreference: UnitPreference;
  tailoringPreferences: TailoringPreferencesInput;
  workout: { templates: unknown[] };
  dismissedTipIds: string[];
  handleDismissTip: (tipId: string) => Promise<void>;
  navigateBack: (fallback?: AppRoute | null) => void;
  handleSetupCompleteToTraining: (selection: FirstRunSetupSelection, recommendedProgramId: string) => Promise<void>;
  handleSaveSetupLimitations: (cautionFlags: SetupCautionFlag[]) => Promise<void>;
}

export function renderSetupEditor(deps: SetupEditorDeps): React.ReactNode {
  const {
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
  } = deps;

  let content: React.ReactNode = null;
  content = (
    <OnboardingScreen
      key={`setup:${preferences.recommendedProgramId ?? 'none'}:${preferences.setupCompleted ? 'complete' : 'pending'}:${route.stage ?? 'default'}`}
      mode="edit"
      // Answers only for a reader who gave them. One who started empty or
      // picked from the catalogue was handed the questionnaire's defaults
      // here, and finishing wrote those over their My Data — gender, age,
      // height, weight, rhythm (2026-09-17). They get what they entered as
      // basics, and the questions open unanswered.
      initialSelection={setupEditSelection}
      existingTrainingCycle={preferences.trainingCycle}
      basicsSeed={setupEditSelection ? null : setupBasics}
      initialStage={route.stage ?? (setupSelection ? 'review' : 'location')}
      initialUnitPreference={unitPreference}
      language={preferences.appLanguage}
      tailoringPreferences={tailoringPreferences}
      readyProgramCount={workout.templates.length}
      dismissedTipIds={dismissedTipIds}
      onDismissTip={handleDismissTip}
      onCancel={() => navigateBack(ROOT_ROUTES.profile)}
      onCompleteToTraining={handleSetupCompleteToTraining}
      onSaveLimitations={route.stage === 'avoid' ? handleSaveSetupLimitations : undefined}
    />
  );
  return content;
}
