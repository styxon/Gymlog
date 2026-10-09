import { AppRoute } from './routes';

export interface RouteHistoryResult {
  history: AppRoute[];
  route: AppRoute | null;
}

/**
 * Where a route goes, without how it was reached.
 *
 * The player's `resume` says which button opened it, not which screen it is.
 * Compared whole, a lock-screen or widget tap into the player that Start had
 * already opened stacked a second copy of it, and the player's first Back
 * landed on itself (hunt 10, #36).
 */
function routeIdentity(route: AppRoute): string {
  if (route.tab === 'workout' && route.screen === 'guided') {
    return JSON.stringify({ tab: route.tab, screen: route.screen, workoutTemplateId: route.workoutTemplateId });
  }
  return JSON.stringify(route);
}

export function isSameRoute(left: AppRoute, right: AppRoute) {
  return routeIdentity(left) === routeIdentity(right);
}

export function pushRoute(history: AppRoute[], current: AppRoute, next: AppRoute) {
  if (isSameRoute(current, next)) {
    return history;
  }

  return [...history, current];
}

export function popRoute(history: AppRoute[]): RouteHistoryResult {
  if (history.length === 0) {
    return {
      history,
      route: null,
    };
  }

  return {
    history: history.slice(0, -1),
    route: history[history.length - 1],
  };
}

/**
 * The history with every page about `workoutTemplateId` removed.
 *
 * Deleting a programme left its pages in the back stack: `navigate` pushes,
 * so the page the reader was standing on when they deleted it stayed behind
 * them. Back then returned to a programme that no longer exists, where the
 * route guard bounced them to the programme list — so Back read as broken
 * (2026-09-16). A programme's pages are deleted with the programme.
 */
export function forgetRoutesForTemplate(history: AppRoute[], workoutTemplateId: string): AppRoute[] {
  return history.filter(
    (entry) => !('workoutTemplateId' in entry) || entry.workoutTemplateId !== workoutTemplateId,
  );
}

/**
 * The history for a route being landed on directly, with no copy of it left
 * on top.
 *
 * `pushRoute` already refuses to stack a route on itself; a landing that sets
 * the route and keeps the history has to make the same check. Deleting a
 * programme opened from the programme list left that list both as the new
 * route and as the top of the stack, so the first Back press popped the
 * duplicate and landed on the screen the reader was already looking at — the
 * same "Back does nothing" this file exists to prevent, one press later
 * (PR #126 review).
 */
export function withoutTrailingRoute(history: AppRoute[], next: AppRoute): AppRoute[] {
  const last = history[history.length - 1];
  return last && isSameRoute(last, next) ? history.slice(0, -1) : history;
}
