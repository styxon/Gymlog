import { useEffect, useRef } from 'react';

import { trackEvent } from '../features/analytics/analyticsClient';
import { countsAsPaywallView } from '../lib/analyticsMoments';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { AppRoute } from '../navigation/routes';
import { AppPreferences } from '../types/models';

/**
 * The onboarding funnel's two events: `onboarding_step`, the stage a reader
 * reached, and `paywall_viewed`, once per visit and only for a reader the
 * paywall is for. The comments below carry the history of each.
 *
 * Moved out of App.tsx verbatim in the phase-B split (2026-09-30). A hook
 * because the moved code is two effects and the paywall's visit ref: VinhaApp
 * calls it at the slot they stood in — after the onboardingStep state, before
 * busySavingReadyPick and the onboarding-reset effect — so React's hook order
 * and the order the effects run in are unchanged.
 */

interface FunnelAnalyticsDeps {
  /** The database store has loaded: `useAppContext().hydrated`. */
  hydrated: boolean;
  /** Onboarding is not finished: `!preferences.onboardingCompleted`. */
  onboardingActive: boolean;
  /** Onboarding is still on its Welcome entry: `onboardingActive && !preferences.entryFlowCompleted`. */
  entryFlowActive: boolean;
  /** The in-memory onboarding stage: App.tsx's onboardingStep state. */
  onboardingStep: 'path' | 'about' | 'questionnaire' | 'ready_catalog';
  /** The route on screen: `navigationState.route`. */
  route: AppRoute;
  /** The shell's navigation state, passed whole so `navigationState.history` reads as it did in App.tsx. */
  navigationState: { route: AppRoute; history: AppRoute[] };
  /** The stored preferences, for the Pro check. */
  preferences: AppPreferences;
}

export function useFunnelAnalytics(deps: FunnelAnalyticsDeps): void {
  const { hydrated, onboardingActive, entryFlowActive, onboardingStep, route, navigationState, preferences } = deps;
  // The funnel's spine: which onboarding stage was reached. If half of every
  // install stops at one stage, that stage is the finding — the question this
  // whole event pipe exists to answer (user, 2026-08-25).
  //
  // Gated on hydration: before the stored preferences are in,
  // onboardingCompleted is the provider's default false, so every cold start
  // of a long-finished install used to count as reaching step "path" —
  // the funnel's first stage was inflated by every returning user
  // (review finding, 2026-09-04).
  //
  // Welcome is its own step. The flow state starts at 'path' underneath the
  // Welcome screen, so "path" was sent while Welcome was showing — and when
  // the path picker itself came up nothing changed that this effect watches,
  // so the picker was never measured at all: the funnel's first row was
  // Welcome under the picker's name. A stage name in `path` is what the
  // questionnaire already sends; the vocabulary is unchanged (analytics
  // audit, 2026-09-21).
  useEffect(() => {
    if (hydrated && onboardingActive) {
      trackEvent('onboarding_step', { path: entryFlowActive ? 'welcome' : onboardingStep });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, onboardingActive, entryFlowActive, onboardingStep]);
  // Conversion's top of funnel: the paywall was on screen. Purchases will
  // come from Play's own reporting once billing exists.
  //
  // Once per visit, and only to a reader it is a paywall for. This ran on
  // every change of the route object: a Pro member looking at their own
  // membership counted as a view, and so did every return from the terms
  // page opened on top of it (analytics audit, 2026-09-21). The page counts
  // as still open while it waits in the back stack.
  const paywallOpenRef = useRef(false);
  useEffect(() => {
    const isPaywall = (candidate: AppRoute) => candidate.tab === 'profile' && candidate.screen === 'premium';
    const onPaywall = isPaywall(route);
    if (
      countsAsPaywallView({
        paywallWasOpen: paywallOpenRef.current,
        onPaywall,
        proUnlocked: resolveProEntitlement(preferences).unlocked,
      })
    ) {
      trackEvent('paywall_viewed');
    }
    paywallOpenRef.current = onPaywall || navigationState.history.some(isPaywall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, navigationState.history]);
}
