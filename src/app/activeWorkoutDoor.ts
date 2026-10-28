import type { MutableRefObject } from 'react';

import type { useWorkoutContext } from '../features/workout/WorkoutProvider';
import { isWorkoutInProgress } from '../lib/activeWorkout';
import { resolveWorkoutLoggerFallbackRoute } from '../lib/workoutLoggerNavigation';
import type { AppRoute } from '../navigation/routes';
import type { useAppContext } from '../state/AppProvider';

type AppContextValue = ReturnType<typeof useAppContext>;

export interface ActiveWorkoutDoorDeps {
  workout: ReturnType<typeof useWorkoutContext>;
  preferences: AppContextValue['preferences'];
  navigate: (nextRoute: AppRoute) => void;
  showToast: (message: string) => void;
  leaveThroughScreenGuard: (leave: () => void) => void;
  workoutLogNavigationAllowedAtRef: MutableRefObject<number | null>;
}

/**
 * The doors into the running workout, moved out of App.tsx verbatim (app-split
 * step 4d). VinhaApp calls it where `navigateToActiveWorkoutThroughGuard` and
 * `navigateToGuidedWorkout` stood. A factory with no hooks, and every door a
 * plain function, a new one every render, as they were.
 *
 * tests/features/workout/workoutLifecycleInvariant.test.cjs lifts
 * `navigateToActiveWorkout` out of this text and runs it, so its header must
 * stay as written.
 */
export function createActiveWorkoutDoor({
  workout,
  preferences,
  navigate,
  showToast,
  leaveThroughScreenGuard,
  workoutLogNavigationAllowedAtRef,
}: ActiveWorkoutDoorDeps) {
  function navigateToActiveWorkoutThroughGuard(options?: { message?: string; resume?: boolean }) {
    leaveThroughScreenGuard(() => {
      navigateToActiveWorkout(options);
    });
  }

  /**
   * Guided player (design_handoff_guided_player) is the only way to run a
   * PROGRAMME session.
   *
   * The list logger itself is alive and shipping — an empty workout runs on
   * it, and the editor route already seeds itself from a stored template. What
   * was removed is the button from here to there (see the note on
   * guided.exit.finishSave in i18n).
   *
   * The two are not interchangeable, and the difference is not layout. This
   * screen drives WorkoutProvider, so its session is the only one written to
   * @vinha/workout/v1 and the only one that survives the app being killed; the
   * list logger holds its sets in component state until you finish. And its
   * save is freestyle by construction (see finishLoggedWorkoutSave): no plan
   * identity, so no previous-session comparison and no progression. Offering
   * it for a programme day means giving it both, not adding a switch.
   */
  function navigateToGuidedWorkout(workoutTemplateId: string, options?: { resume?: boolean }) {
    workoutLogNavigationAllowedAtRef.current = Date.now();
    navigate({ tab: 'workout', screen: 'guided', workoutTemplateId, resume: options?.resume });
  }

  /**
   * Go to the session that is already running, if there is one.
   *
   * Two different intents come through here and they must not land the same
   * way. Home's hero and the lock-screen card ask to CONTINUE, and get the set
   * they left off on. But this is also the guard on "start a session": ask for
   * Day 2 while Day 1 is running and you are redirected, which is not a resume
   * at all — the app is telling you something, and dropping you mid-set in
   * Day 1's player says it silently. That reader logs sets into the wrong day.
   *
   * So `resume` is the caller's claim about its own button, and the guards
   * only make it when the running session IS the one that was asked for. The
   * overview is what a redirect owes you: the session's name, at the top.
   */
  function navigateToActiveWorkout(options?: { message?: string; resume?: boolean }) {
    // A finished session still held until its summary clears it is not a workout
    // to go back to: Start has to start, not open yesterday's player.
    if (!workout.activeSession || !isWorkoutInProgress(workout.activeSession)) {
      return false;
    }

    if (options?.message) {
      showToast(options.message);
    }

    workout.resumeWorkout();
    navigateToGuidedWorkout(workout.activeSession.templateId, { resume: options?.resume === true });
    return true;
  }

  /** Whether the running session is the very one a start button just asked for. */
  function isActiveSessionFor(workoutTemplateId: string, sessionId: string) {
    const active = workout.activeSession;
    return (
      active !== null
      && active.templateId === workoutTemplateId
      && active.templateSessionId === sessionId
    );
  }

  function getWorkoutLoggerFallbackRoute() {
    return resolveWorkoutLoggerFallbackRoute({
      activeWorkoutTemplateId: workout.activeSession?.templateId ?? null,
      recommendedProgramId: preferences.recommendedProgramId,
      setupCompleted: preferences.setupCompleted,
    });
  }

  return {
    navigateToActiveWorkoutThroughGuard,
    navigateToGuidedWorkout,
    navigateToActiveWorkout,
    isActiveSessionFor,
    getWorkoutLoggerFallbackRoute,
  };
}
