import { startTransition, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';

import { forgetRoutesForTemplate, popRoute, pushRoute, withoutTrailingRoute } from '../navigation/routeHistory';
import { AppRoute, ROOT_ROUTES, RootTabKey, WORKOUT_PLAN_ROUTE } from '../navigation/routes';
import type { TemplateLeaveGuard } from '../screens/CreateTemplateScreen';

/**
 * The route stack and the ways of moving on it, moved out of App.tsx verbatim
 * (app-split step 3). VinhaApp calls it below `setNumberLanguage`, where the
 * navigation state used to be declared.
 *
 * Every mover is a plain inner function, recreated each render, as before. The
 * split between startTransition and synchronous is load-bearing: navigate,
 * replaceRoute, resetToRoute, navigateBack and leaveDeletedProgramme go through
 * a transition, navigateNow does not (iOS hunt, 2026-10-17).
 */

export interface NavigationState {
  route: AppRoute;
  history: AppRoute[];
}

interface AppNavigationDeps {
  preferences: { programsTabEnabled?: boolean };
  templateLeaveGuardRef: MutableRefObject<TemplateLeaveGuard | null>;
}

export function useAppNavigation({ preferences, templateLeaveGuardRef }: AppNavigationDeps) {
  /**
   * Where "back to the programmes" lands.
   *
   * Three routes used to stand in for this: the tab bar opened Programs home,
   * the logger's fallback opened the exercise list, and deleting a programme —
   * along with leaving a summary and every missing-template fallback — opened
   * the pre-redesign catalog list, a screen nothing else in the app leads to.
   * Delete a programme and you were somewhere you could not get back to.
   * One answer now, and it is the same one the tab gives.
   */
  const workoutHomeRoute = useMemo<AppRoute>(
    () => (preferences.programsTabEnabled ? { tab: 'workout', screen: 'programs_home' } : WORKOUT_PLAN_ROUTE),
    [preferences.programsTabEnabled],
  );

  const [navigationState, setNavigationState] = useState<NavigationState>({
    route: ROOT_ROUTES.home,
    history: [],
  });

  function navigate(nextRoute: AppRoute) {
    startTransition(() =>
      setNavigationState((current) => ({
        route: nextRoute,
        history: pushRoute(current.history, current.route, nextRoute),
      })),
    );
  }

  /**
   * navigate, without the transition: for a hop that has to land in the same
   * render as a state write next to it.
   *
   * The hand-off's first half opens the Pro page and then records the Pro
   * step. Through navigate the route waited in the transition lane while the
   * Pro-step write rendered first, so for one commit the second half was due
   * on the old route: its tracking dialog was presented and torn down again
   * within the fade, which on iOS can leave an empty modal over the Pro page
   * that takes every touch (iOS hunt, 2026-10-17).
   */
  function navigateNow(nextRoute: AppRoute) {
    setNavigationState((current) => ({
      route: nextRoute,
      history: pushRoute(current.history, current.route, nextRoute),
    }));
  }

  function replaceRoute(nextRoute: AppRoute) {
    startTransition(() =>
      setNavigationState((current) => ({
        route: nextRoute,
        // No copy of the landing left on top: a builder opened from a
        // programme page saves back onto that page, and the first Back popped
        // the page it was already on (hunt 11).
        history: withoutTrailingRoute(current.history, nextRoute),
      })),
    );
  }

  function resetToRoute(nextRoute: AppRoute) {
    startTransition(() =>
      setNavigationState({
        route: nextRoute,
        history: [],
      }),
    );
  }

  /**
   * Where a tab lands. Programs-tab redesign (flagged): the workout tab lands
   * on the Programs home instead of the legacy exercise list.
   *
   * Separate from `navigateToTab` because the destination and the history are
   * two decisions. The bar resets; a button inside a screen must not.
   */
  function resolveTabRoute(tab: RootTabKey): AppRoute {
    if (tab === 'workout' && preferences.programsTabEnabled) {
      return { tab: 'workout', screen: 'programs_home' };
    }
    return ROOT_ROUTES[tab];
  }

  function navigateToTab(tab: RootTabKey) {
    resetToRoute(resolveTabRoute(tab));
  }

  /**
   * The bar's ways out, past the open screen's own unsaved-work question. The
   * builder asks it on Back; a tab or the AI button unmounted it without
   * asking and the draft was gone (hunt 10, #7).
   */
  function leaveThroughScreenGuard(leave: () => void) {
    if (templateLeaveGuardRef.current?.(leave)) {
      return;
    }
    leave();
  }

  /**
   * The same question for the exits that arrive from outside the screen: a
   * widget tap, a notification tap, the lock screen's resume. They reset the
   * route directly and unmounted an unsaved builder without asking. The
   * question is answerable, so a resume is held for it, not blocked.
   */
  function resetToRouteThroughGuard(nextRoute: AppRoute) {
    leaveThroughScreenGuard(() => resetToRoute(nextRoute));
  }

  function navigateBack(fallback: AppRoute | null = null) {
    startTransition(() =>
      setNavigationState((current) => {
        const previous = popRoute(current.history);
        if (previous.route) {
          return {
            route: previous.route,
            history: previous.history,
          };
        }

        if (fallback) {
          return {
            route: fallback,
            history: [],
          };
        }

        return current;
      }),
    );
  }

  /**
   * Off the page of a programme that no longer exists, and out of its pages.
   *
   * The programme's pages go with the programme. `navigate` pushes, so the
   * page the reader deleted it from stayed in the back stack: Back returned
   * to a programme that no longer exists, the route guard bounced them to
   * the list, and Back read as broken (2026-09-16).
   */
  function leaveDeletedProgramme(workoutTemplateId: string) {
    startTransition(() =>
      setNavigationState((current) => ({
        route: workoutHomeRoute,
        // And no copy of the destination left on top of the stack: the
        // programme was opened FROM this list, so without the second call the
        // first Back press pops the duplicate and lands on the screen the
        // reader is already looking at (PR #126 review).
        history: withoutTrailingRoute(
          forgetRoutesForTemplate(current.history, workoutTemplateId),
          workoutHomeRoute,
        ),
      })),
    );
  }

  return {
    route: navigationState.route,
    navigationState,
    setNavigationState,
    workoutHomeRoute,
    navigate,
    navigateNow,
    replaceRoute,
    resetToRoute,
    navigateBack,
    resolveTabRoute,
    navigateToTab,
    leaveThroughScreenGuard,
    resetToRouteThroughGuard,
    leaveDeletedProgramme,
  };
}