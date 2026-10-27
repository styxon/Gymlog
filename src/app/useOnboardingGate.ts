import { useEffect, useState } from 'react';

import type { AppRoute } from '../navigation/routes';
import type { AboutYouValues } from '../screens/AboutYouScreen';
import type { useAppContext } from '../state/AppProvider';

type AppContextValue = ReturnType<typeof useAppContext>;

/**
 * The onboarding gate and the in-memory state of its flow, moved out of
 * App.tsx verbatim (app-split step 4b). VinhaApp calls it at the slot
 * `onboardingActive` stood in, ahead of useFunnelAnalytics, which reads it.
 *
 * The reset effect now runs before useFunnelAnalytics effects instead of
 * after them; both only read this render's values, so the order is unobservable.
 */
export function useOnboardingGate(preferences: AppContextValue['preferences'], route: AppRoute) {
  const onboardingActive = !preferences.onboardingCompleted;
  const entryFlowActive = onboardingActive && !preferences.entryFlowCompleted;
  // Pre-questionnaire flow: after Welcome the user picks a path (01b); the
  // build path then runs about-you (01e) before the questionnaire. The ready
  // path exits onboarding to the catalog.
  const [onboardingStep, setOnboardingStep] = useState<
    'path' | 'about' | 'questionnaire' | 'ready_catalog'
  >('path');
  const [busySavingReadyPick, setBusySavingReadyPick] = useState(false);
  const [aboutYouValues, setAboutYouValues] = useState<AboutYouValues | null>(null);

  // The onboarding flow state lives in memory; when the gate closes (finished)
  // or the app returns to the Welcome entry (e.g. after a data reset), start
  // the next run from the path screen - never mid-questionnaire.
  useEffect(() => {
    if (preferences.onboardingCompleted || !preferences.entryFlowCompleted) {
      setOnboardingStep('path');
      setAboutYouValues(null);
    }
  }, [preferences.entryFlowCompleted, preferences.onboardingCompleted]);

  /**
   * The onboarding's last two steps are full-bleed: the program picker's
   * diagonal and the paywall's hero both run to the top edge. The shell
   * reserves and paints the status-bar strip for onboarding, which would cut a
   * light band across either of them.
   */
  const [fullBleedReviewRaw, setFullBleedReview] = useState<'light' | 'dark' | null>(null);
  /**
   * Only meaningful while onboarding is on screen.
   *
   * OnboardingScreen reports this from an effect and had no cleanup, so
   * finishing on the paywall left it at 'light' forever: the shell kept the
   * full-bleed edges and the translucent status bar, and Home's greeting drew
   * underneath the clock on the reader's very first screen. Reading it through
   * onboardingActive means an unmount cannot leak, whatever the last stage
   * happened to report.
   */
  const fullBleedReview =
    onboardingActive || (route.tab === 'profile' && route.screen === 'setup')
      ? fullBleedReviewRaw
      : null;

  return {
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
  };
}
