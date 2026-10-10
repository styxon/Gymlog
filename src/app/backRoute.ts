import { AppRoute, ROOT_ROUTES } from '../navigation/routes';

/**
 * Where the hardware back button lands from a nested screen.
 *
 * Null means "no opinion" — the caller pops its own history instead. Moved
 * out of App.tsx in the phase-A split (2026-08-26); the route table is data
 * about navigation, not wiring.
 */
export function getBackRoute(route: AppRoute, workoutHome: AppRoute): AppRoute | null {
  if (
    route.tab === 'home' &&
    (route.screen === 'ai_chat' ||
      route.screen === 'history' ||
      route.screen === 'session' ||
      route.screen === 'analysis' ||
      route.screen === 'cardio')
  ) {
    return ROOT_ROUTES.home;
  }

  if (route.tab === 'workout' && route.screen === 'detail') {
    return ROOT_ROUTES.workout;
  }

  if (
    route.tab === 'workout' &&
    (route.screen === 'plans' ||
      route.screen === 'program' ||
      route.screen === 'programDay' ||
      route.screen === 'template' ||
      route.screen === 'guided' ||
      route.screen === 'summary')
  ) {
    return workoutHome;
  }

  if (
    route.tab === 'progress' &&
    (route.screen === 'detail' || route.screen === 'bodyweight')
  ) {
    return ROOT_ROUTES.progress;
  }

  if (route.tab === 'profile' && route.screen === 'setup') {
    return ROOT_ROUTES.profile;
  }

  if (route.tab === 'profile' && route.screen === 'premium') {
    return ROOT_ROUTES.profile;
  }

  // Back out of the unlock moment lands on Profile, not on the paywall you
  // just came through — going 'back' to a page selling what you now own.
  // Only true together with backSkipsHistory below.
  if (route.tab === 'profile' && route.screen === 'premium_unlock') {
    return ROOT_ROUTES.profile;
  }

  // The rest of Profile's pages, each to where its own back arrow goes. A
  // widget landing leaves the history empty, and the key answered null there:
  // Android closed the app from Training plan while the arrow went to
  // Profile (hunt 10, #39).
  if (route.tab === 'profile') {
    return PROFILE_BACK_FALLBACK[route.screen] ?? null;
  }

  return null;
}

/** The fallback each Profile page's own back arrow passes (renderProfileTab). */
const PROFILE_BACK_FALLBACK: Partial<Record<Extract<AppRoute, { tab: 'profile' }>['screen'], AppRoute>> = {
  settings: ROOT_ROUTES.profile,
  training_plan: ROOT_ROUTES.profile,
  milestones: ROOT_ROUTES.profile,
  notifications: { tab: 'profile', screen: 'settings' },
  training_break: { tab: 'profile', screen: 'settings' },
  subscription: { tab: 'profile', screen: 'settings' },
  legal: { tab: 'profile', screen: 'settings' },
  edit_profile: { tab: 'profile', screen: 'settings' },
  my_data: { tab: 'profile', screen: 'settings' },
  export_plan: { tab: 'profile', screen: 'settings' },
  membership_end: { tab: 'profile', screen: 'subscription' },
};

/**
 * Whether the back route above is the destination rather than a fallback.
 *
 * The shell hands getBackRoute's answer to navigateBack, which pops the history
 * first and only lands on that route when the history is empty. From the
 * unlock moment the history is never empty — its top is the paywall the reader
 * just came through — so the Profile route above was never reached and back
 * opened a page selling what they now own (audit 2026-09-16). For these routes
 * the history is left behind instead.
 */
export function backSkipsHistory(route: AppRoute): boolean {
  return route.tab === 'profile' && route.screen === 'premium_unlock';
}
