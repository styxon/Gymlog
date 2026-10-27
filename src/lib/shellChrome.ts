import type { AppRoute } from '../navigation/routes';

/**
 * Which pieces of the shell's chrome the current route asks for. Pure and
 * route-only: App.tsx passes the three onboarding flags in and hands the
 * answer to renderAppShell.
 */
export type ShellChromeInput = {
  route: AppRoute;
  onboardingActive: boolean;
  entryFlowActive: boolean;
  setupHandoffActive: boolean;
};

export type ShellChrome = {
  showTabBar: boolean;
  setupOnboardingActive: boolean;
  onboardingScreenActive: boolean;
  welcomeActive: boolean;
  workoutSummaryActive: boolean;
  premiumActive: boolean;
  historySessionActive: boolean;
};

export function resolveShellChrome({
  route,
  onboardingActive,
  entryFlowActive,
  setupHandoffActive,
}: ShellChromeInput): ShellChrome {
  const showTabBar =
    !onboardingActive &&
    // The hand-off is the last step of onboarding wearing the app's clothes. A
    // tab bar under it offers four ways out of a step that has one button.
    !setupHandoffActive &&
    !(
      route.tab === 'workout' &&
      (route.screen === 'detail' ||
        route.screen === 'empty' ||
        route.screen === 'guided' ||
        route.screen === 'summary')
    ) &&
    !(route.tab === 'home' && route.screen === 'cardio') &&
    // The setup editor is a full-screen flow — the floating bar was covering
    // its footer Cancel/Back controls.
    !(route.tab === 'profile' && route.screen === 'setup') &&
    // The unlock moment is a full-screen takeover; a floating bar over it
    // would say 'you are still in the app' at the one moment that should not.
    !(route.tab === 'profile' && route.screen === 'premium_unlock') &&
    // The Pro page ends in its own pinned CTA. The floating bar sat on top of
    // it, so the page had to reserve a bar's worth of dead space under the
    // button — on a paywall, the most expensive space on the screen. The
    // membership screen has the same pinned footer, and there the bar covered
    // the second button outright.
    // Any new screen that pins a CTA to the bottom belongs on this list. The
    // post-onboarding offer was the third entry until the screen was deleted
    // (2026-08-25) — its bar covered the primary button outright.
    !(route.tab === 'profile' && (route.screen === 'premium' || route.screen === 'membership_end'));
  const setupOnboardingActive = route.tab === 'profile' && route.screen === 'setup';
  const onboardingScreenActive = onboardingActive || setupOnboardingActive;
  const welcomeActive = onboardingActive && entryFlowActive;
  // Workout Complete opens on a full-bleed purple hero — the status bar joins it
  // rather than sitting above it as a dark strip.
  const workoutSummaryActive = route.tab === 'workout' && route.screen === 'summary';
  /**
   * The Pro page commits to one dark treatment in BOTH themes (theme.ts,
   * PRO_TIER): the tier's colour is the only thing telling Free from Pro from
   * Lifetime, and repainting it per reader would make that signal mean
   * something different for each of them.
   *
   * The shell has to be told, or only the page obeys. v4 painted itself
   * theme.bg and matched by accident; v6 paints itself black, and under the
   * light theme the safe-area bands above and below it stayed light — two
   * pale strips framing a black page.
   */
  const premiumActive = route.tab === 'profile' && route.screen === 'premium';
  // The saved-session view opens on the same purple hero as Workout Complete,
  // so the status bar joins it instead of sitting above it as a light strip.
  const historySessionActive = route.tab === 'home' && route.screen === 'session';

  return {
    showTabBar,
    setupOnboardingActive,
    onboardingScreenActive,
    welcomeActive,
    workoutSummaryActive,
    premiumActive,
    historySessionActive,
  };
}
