import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { WORKOUT_TEMPLATES_V1 } from '../features/workout/workoutCatalog';
import type { WorkoutFeatureState } from '../features/workout/workoutState';
import type { getTrackedExerciseProgress } from '../lib/progression';
import { ROOT_ROUTES } from '../navigation/routes';
import type { AppRoute } from '../navigation/routes';
import type { AppDatabase } from '../types/models';
import type { CompletionSummaryState } from './workoutCompletionState';
import type { FinishSaveState } from './useFinishState';

/**
 * The finish-save reset and the route guard: a save state that outlived its
 * session goes back to idle, and a route whose subject is gone — a guided
 * route with nothing to play, a summary with no summary, a detail page for a
 * deleted programme, lift or session — is replaced.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-C split (2026-10-01).
 * A hook, not a helper: these are effects, and VinhaApp calls this exactly
 * where the lines stood — after the toast timer, ahead of the onboarding
 * step's state — so every hook keeps its slot and the two effects still run
 * in this order, the reset first. The guard lists exerciseBrowserItems, the
 * array it reads — it listed exerciseLibrary, the same array today, which
 * would stop noticing the day the browser list filters (#bugs 2026-10-01).
 * The refs are VinhaApp's own objects, handed in,
 * so this reads and clears the flags the finish handlers set.
 * tests/screens/finishRouteGuard.test.cjs runs this source branch by branch.
 */
interface FinishRouteGuardDeps {
  finishSaveState: FinishSaveState;
  setFinishSaveState: Dispatch<SetStateAction<FinishSaveState>>;
  completionSummary: CompletionSummaryState | null;
  /** The workout context: the running session, and the ready catalog. */
  workout: Pick<WorkoutFeatureState, 'activeSession'> & { templates: typeof WORKOUT_TEMPLATES_V1 };
  route: AppRoute;
  /** VinhaApp's hoisted replaceRoute. */
  replaceRoute: (nextRoute: AppRoute) => void;
  workoutHomeRoute: AppRoute;
  /** Stamped by navigateToGuidedWorkout; read once and cleared here. */
  workoutLogNavigationAllowedAtRef: MutableRefObject<number | null>;
  summaryNavigationPendingRef: MutableRefObject<boolean>;
  summaryExitRouteRef: MutableRefObject<AppRoute | null>;
  workoutTemplates: AppDatabase['workoutTemplates'];
  exerciseBrowserItems: AppDatabase['exerciseLibrary'];
  trackedProgress: ReturnType<typeof getTrackedExerciseProgress>;
  workoutSessions: AppDatabase['workoutSessions'];
}

export function useFinishRouteGuard(deps: FinishRouteGuardDeps) {
  const {
    finishSaveState,
    setFinishSaveState,
    completionSummary,
    workout,
    route,
    replaceRoute,
    workoutHomeRoute,
    workoutLogNavigationAllowedAtRef,
    summaryNavigationPendingRef,
    summaryExitRouteRef,
    workoutTemplates,
    exerciseBrowserItems,
    trackedProgress,
    workoutSessions,
  } = deps;

  useEffect(() => {
    if (finishSaveState.status === 'idle') {
      return;
    }

    const activeSessionId = workout.activeSession?.sessionId ?? null;
    if (activeSessionId === finishSaveState.sessionId) {
      return;
    }

    setFinishSaveState({ status: 'idle', sessionId: null });
  }, [finishSaveState.sessionId, finishSaveState.status, workout.activeSession?.sessionId]);

  useEffect(() => {
    /** Re-checks the guided route when a start's window runs out with nothing landed. */
    let windowExpiry: ReturnType<typeof setTimeout> | null = null;
    if (route.tab === 'workout' && route.screen === 'guided') {
      const allowedAt = workoutLogNavigationAllowedAtRef.current;
      // Spent once the session it waited for has landed, or once it has run
      // out — not on the first read. Cleared on every guided render, a second
      // run inside the two seconds (anything else in the deps changing) found
      // no stamp and sent a starting workout Home (#bugs 2026-10-01, phase C).
      if (workout.activeSession || !allowedAt || Date.now() - allowedAt > 2000) {
        workoutLogNavigationAllowedAtRef.current = null;
      }

      if (
        !workout.activeSession &&
        finishSaveState.status !== 'saving' &&
        !summaryNavigationPendingRef.current &&
        (!allowedAt || Date.now() - allowedAt > 2000)
      ) {
        replaceRoute(ROOT_ROUTES.home);
        return;
      }

      // Inside the window with no session yet: nothing re-runs this effect if
      // the session never lands, so the expiry has to be scheduled, or a lost
      // start sat on an empty player screen until Back (review of #bugs
      // 2026-10-01). A session, a route change or a finish re-runs the effect
      // first, and the cleanup below cancels this.
      if (!workout.activeSession && allowedAt && Date.now() - allowedAt <= 2000) {
        windowExpiry = setTimeout(() => {
          workoutLogNavigationAllowedAtRef.current = null;
          if (!summaryNavigationPendingRef.current) {
            replaceRoute(ROOT_ROUTES.home);
          }
        }, 2000 - (Date.now() - allowedAt) + 1);
      }
    }

    if (
      route.tab === 'workout' &&
      route.screen === 'guided' &&
      !workout.templates.some((template) => template.id === route.workoutTemplateId) &&
      !workoutTemplates.some((template) => template.id === route.workoutTemplateId)
    ) {
      replaceRoute(workoutHomeRoute);
    }

      if (
        route.tab === 'workout' &&
        route.screen === 'detail' &&
        !exerciseBrowserItems.some((item) => item.id === route.exerciseId)
      ) {
        replaceRoute(ROOT_ROUTES.workout);
      }

    if (
      route.tab === 'workout' &&
      (route.screen === 'program' || route.screen === 'programDay') &&
      ((route.programType === 'ready' && !workout.templates.some((template) => template.id === route.workoutTemplateId)) ||
        (route.programType === 'custom' && !workoutTemplates.some((template) => template.id === route.workoutTemplateId)))
    ) {
      replaceRoute(workoutHomeRoute);
    }

    if (
      route.tab === 'workout' &&
      route.screen === 'template' &&
      route.workoutTemplateId &&
      !workoutTemplates.some((template) => template.id === route.workoutTemplateId)
    ) {
      replaceRoute(workoutHomeRoute);
    }

    if (
      route.tab === 'progress' &&
      route.screen === 'detail' &&
      !trackedProgress.some((item) => item.key === route.exerciseKey)
    ) {
      replaceRoute(ROOT_ROUTES.progress);
    }

    if (
      route.tab === 'home' &&
      route.screen === 'session' &&
      !workoutSessions.some((session) => session.id === route.sessionId)
    ) {
      replaceRoute({ tab: 'home', screen: 'history' });
    }

    if (
      route.tab === 'workout' &&
      route.screen === 'summary' &&
      completionSummary &&
      summaryNavigationPendingRef.current
    ) {
      summaryNavigationPendingRef.current = false;
    }

    if (
      route.tab === 'workout' &&
      route.screen === 'summary' &&
      !completionSummary &&
      finishSaveState.status !== 'saving' &&
      !summaryNavigationPendingRef.current
    ) {
      const nextRoute = summaryExitRouteRef.current ?? workoutHomeRoute;
      summaryExitRouteRef.current = null;
      replaceRoute(nextRoute);
    }

    return () => {
      if (windowExpiry) {
        clearTimeout(windowExpiry);
      }
    };
  }, [
    completionSummary,
    exerciseBrowserItems,
    finishSaveState.status,
    route,
    trackedProgress,
    workout.activeSession,
    workoutSessions,
    workout.templates,
    workoutTemplates,
  ]);
}
