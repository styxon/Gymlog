import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { type LegalDocumentId } from '../lib/legalDocuments';
import { AppRoute } from '../navigation/routes';
import { backSkipsHistory, getBackRoute } from './backRoute';

/**
 * The shell's two Android back listeners: the route-level one, and the one
 * that closes a document opened over the hand-off.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01). A hook
 * because the moved code is two effects: VinhaApp calls it at the slot they
 * stood in — after useSetupWeightSeed, before useDaySummaries — so React's
 * hook order, the order the effects run in, and so the order the listeners
 * register in (BackHandler calls the newest first) are unchanged. Every ref it
 * reads is read at key-press time, never during render. The hand-off and terms
 * refs are written in VinhaApp's render as before (useHandoffLegalHolders,
 * useSetupHandoffOverlays); workoutRef and summaryExitRouteRef keep their own
 * writers in App.tsx.
 */
export interface RouteBackDeps {
  cardioRunActive: boolean;
  route: AppRoute;
  /** Only the history's length is read, and depended on. */
  navigationState: { history: AppRoute[] };
  onboardingActive: boolean;
  workoutHomeRoute: AppRoute;
  handoffLegalDocument: LegalDocumentId | null;
  setHandoffLegalDocument: (document: LegalDocumentId | null) => void;
  handoffLegalOpenRef: { current: boolean };
  setupHandoffActiveRef: { current: boolean };
  legalConsentDueRef: { current: boolean };
  resetToRoute: (route: AppRoute) => void;
  navigateBack: (fallback?: AppRoute | null) => void;
  /** Leave the summary the way Done does: data and route in one transition (finishExits). */
  leaveFinishedScreen: (nextRoute: AppRoute) => void;
  /** The workout context, through the ref that always holds the latest one. */
  workoutRef: { current: { clearCompletedWorkout: () => void } };
  summaryExitRouteRef: { current: AppRoute | null };
}

export function useRouteBack(deps: RouteBackDeps): void {
  const {
    cardioRunActive,
    route,
    navigationState,
    onboardingActive,
    workoutHomeRoute,
    handoffLegalDocument,
    setHandoffLegalDocument,
    handoffLegalOpenRef,
    setupHandoffActiveRef,
    legalConsentDueRef,
    resetToRoute,
    navigateBack,
    leaveFinishedScreen,
    workoutRef,
    summaryExitRouteRef,
  } = deps;

  /**
   * The route-level back. BackHandler calls the newest listener first, and a
   * screen with its own answer to back (the cardio end sheet, the guided
   * player's exit sheet, the free workout's discard question) registers after
   * this one. That only holds while this effect stays put: it used to depend on
   * the workout context, which is a new object every second while a rest timer
   * or cardio runs, so it re-subscribed every second, became the newest
   * listener, and walked the reader Home past the screen's own handler.
   */
  useEffect(() => {
    // Stands down on the cardio screen while a run is on the clock. The
    // player's back opens its end sheet, but this listener re-subscribes on
    // every route change and a parent's effect runs after its child's — so
    // coming back to a running session made this the newest listener, and
    // back walked Home past the sheet. The screen answers back in every mode.
    if (cardioRunActive && route.tab === 'home' && route.screen === 'cardio') {
      return undefined;
    }
    // Stands down on the free workout, in every state. Its own listener
    // answers back — the question before logged sets are lost, and the
    // discard when there is nothing to lose — and it registers once, on
    // mount. This listener re-subscribes on every route change and a
    // parent's effect runs after its child's, so it was the newest one:
    // back walked Home past the question and past the discard (CI review
    // of #162). Same stand-down as the cardio player and the questionnaire.
    if (route.tab === 'workout' && route.screen === 'empty') {
      return undefined;
    }
    // Stands down on the guided player, in both of its modes. Its own
    // listener answers back — the exit sheet in the player, a plain leave on
    // the overview. But "Continue" from Home mounts it straight into the
    // player in the same commit as the route change, and a parent's effect
    // runs after its child's: this listener was the newest, and back walked
    // Home past the exit sheet (live-session audit, 2026-09-20).
    if (route.tab === 'workout' && route.screen === 'guided') {
      return undefined;
    }
    // Stands down on the programme builder. It is a path of steps, and back
    // walks them — Exercises to Base to Days — before it leaves, asking first
    // when leaving drops work nothing has saved. Its own listener registers
    // on mount and this one would be newer, so back would have left the
    // whole path from any step (guided builder, 2026-10-04).
    if (route.tab === 'workout' && route.screen === 'template') {
      return undefined;
    }
    // Stands down for the questionnaire in BOTH of its forms. The setup route
    // is the same OnboardingScreen, which answers back itself, stage by
    // stage — but this listener re-subscribes on every route change, and a
    // parent's effect runs after its child's, so it was always the newest
    // one: back from any question of "create a new programme" went straight
    // to settings (device, 2026-09-16).
    if (onboardingActive || (route.tab === 'profile' && route.screen === 'setup')) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // A document open over the hand-off is not a route; back closes it
      // before anything behind it moves. Asked here as well as below, because
      // this listener re-subscribes on route changes and can end up newest.
      if (handoffLegalOpenRef.current) {
        setHandoffLegalDocument(null);
        return true;
      }
      // The hand-off answers back itself. It is drawn over the route rather
      // than routed, so this listener — re-subscribed as onboarding closes,
      // after the hand-off's own — was the newest and popped the route
      // behind it. False hands the key on to the hand-off's listener.
      if (setupHandoffActiveRef.current) {
        return false;
      }
      // The terms sheet answers back itself (it leaves the app). Walking the
      // route behind a sheet nobody can see past would change the screen the
      // reader returns to, for a key they pressed to get away.
      if (legalConsentDueRef.current) {
        return false;
      }
      const nextRoute = getBackRoute(route, workoutHomeRoute);
      if (!nextRoute && navigationState.history.length === 0) {
        return false;
      }

      if (nextRoute && backSkipsHistory(route)) {
        resetToRoute(nextRoute);
        return true;
      }

      if (route.tab === 'workout' && route.screen === 'summary') {
        // The same exit as the Done button: the summary's data and the route
        // leave in ONE transition, and the history is reset. The clear used
        // to be urgent and the pop a transition, so a frame showed the
        // summary route with its data gone (the exercise browser flashed),
        // and the pop then landed on whatever the history held — often the
        // finished workout's own player — while the route guard raced it to
        // Home with the old history kept (#bugs 2026-10-02).
        workoutRef.current.clearCompletedWorkout();
        const exitRoute = summaryExitRouteRef.current ?? workoutHomeRoute;
        // Not consumed here: the transition has not committed, so a second
        // Back before it does would read null and fall to the Programs tab.
        // Every path into the summary sets the ref just before it routes
        // there (finishSaves), so a later summary cannot inherit this exit;
        // the route guard clears it when it takes the exit itself.
        leaveFinishedScreen(exitRoute);
        return true;
      }

      navigateBack(nextRoute);
      return true;
    });

    return () => subscription.remove();
  }, [cardioRunActive, navigationState.history.length, onboardingActive, route]);

  /**
   * The back key closes a policy or terms page opened over the hand-off.
   *
   * The page is drawn over the hand-off rather than routed, so the handler
   * above never knew it was open: on a fresh install the route behind has no
   * history, back returned false, and Android put the app away with the terms
   * still up (backfill review of #92, 2026-09-16). Registered while the page
   * is open and after the route handler, so it is the newest listener — and it
   * works on the setup route too, where the route handler stands down.
   */
  useEffect(() => {
    if (!handoffLegalDocument) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setHandoffLegalDocument(null);
      return true;
    });
    return () => subscription.remove();
  }, [handoffLegalDocument]);
}
