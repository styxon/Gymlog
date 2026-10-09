import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { isWorkoutInProgress } from '../lib/activeWorkout';
import { parseWidgetDeepLink } from '../lib/widgetDeepLink';
import { HomeWidgetTarget, resolveHomeWidgetSessionTap } from '../lib/widgetPayload';
import { AppRoute, ROOT_ROUTES } from '../navigation/routes';

type TapInput = Parameters<typeof resolveHomeWidgetSessionTap>[0];

/**
 * The home-screen widget's taps: each arrives as a `vinha://widget/<target>`
 * URL, is held until the database has loaded, and is resolved against live
 * state into a route.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01). A hook
 * because the moved code is state and two effects: VinhaApp calls it at the
 * slot they stood in — after useHomeWidgetFeed, before useNotificationRoute —
 * so React's hook order and the order the effects run in are unchanged.
 */
export interface WidgetTapsDeps {
  appHydrated: boolean;
  workout: { activeSession: { status: string } | null };
  homeActivePlanCard: {
    programType: 'ready' | 'custom';
    programId: string;
    nextSession: { id: string };
    todayPickSessionId?: string | null;
    sessions: TapInput['sessions'];
    sessionForecast?: TapInput['sessionForecast'];
  } | null;
  homeTrainingSchedule: TapInput['schedule'];
  recommendedReadyTemplate: { id: string } | null;
  /** The workout-only day list the widget was drawn with (useHomeWidgetFeed). */
  widgetCompletedWorkoutDayStarts: number[];
  resetToRoute: (route: AppRoute) => void;
  navigateToActiveWorkout: (options?: { message?: string; resume?: boolean }) => boolean;
}

export function useWidgetTaps(deps: WidgetTapsDeps): void {
  const {
    appHydrated,
    workout,
    homeActivePlanCard,
    homeTrainingSchedule,
    recommendedReadyTemplate,
    widgetCompletedWorkoutDayStarts,
    resetToRoute,
    navigateToActiveWorkout,
  } = deps;

  // ── Widget taps ──────────────────────────────────────────────────────────
  // A widget can only ask Android to open a URL, so each tap arrives as
  // `vinha://widget/<target>` and is resolved here against live state. The
  // widget's own file can be half an hour old; the workout it named is looked
  // up again now, so a tap never opens yesterday's session.
  const [pendingWidgetTarget, setPendingWidgetTarget] = useState<HomeWidgetTarget | null>(null);

  useEffect(() => {
    function handleUrl(url: string | null | undefined) {
      const target = parseWidgetDeepLink(url);
      if (target) {
        setPendingWidgetTarget(target);
      }
    }

    // Cold start: the URL is already waiting. Warm start: it arrives here.
    void Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // Held until the database is loaded: resolving "the session you named"
    // against an empty store would land on Home every time.
    if (!appHydrated || !pendingWidgetTarget) {
      return;
    }
    setPendingWidgetTarget(null);

    if (pendingWidgetTarget === 'calendar') {
      // The widget's month opens the same calendar it is a small copy of:
      // Progress → Activity, scrolled to the calendar itself — the block
      // lives mid-page, and landing at the top of the overview is landing
      // somewhere else (user 2026-08-25). The standalone calendar screen
      // this used to open was retired as a duplicate.
      //
      // Stamped, as the notification taps are: Progress keeps its section and
      // scroll as state the reader moves, and a second tap names the same
      // section and target, which as bare values compare equal — the screen
      // stayed where the reader had left it (bug hunt 10, 2026-10-09).
      resetToRoute({
        tab: 'progress',
        screen: 'list',
        section: 'overview',
        scrollTo: 'activity',
        openedAt: Date.now(),
      });
      return;
    }
    if (pendingWidgetTarget === 'programs') {
      resetToRoute({ tab: 'workout', screen: 'programs_home' });
      return;
    }
    if (pendingWidgetTarget === 'suggestion') {
      // The programme the widget named, resolved again now — the catalog cannot
      // change under it, but the recommendation can, and the widget's copy of it
      // may be half an hour old.
      if (recommendedReadyTemplate) {
        resetToRoute({
          tab: 'workout',
          screen: 'program',
          programType: 'ready',
          workoutTemplateId: recommendedReadyTemplate.id,
        });
        return;
      }
      resetToRoute({ tab: 'workout', screen: 'programs_home' });
      return;
    }
    if (pendingWidgetTarget === 'schedule') {
      resetToRoute({ tab: 'profile', screen: 'training_plan', editSchedule: true });
      return;
    }
    if (pendingWidgetTarget === 'home') {
      resetToRoute(ROOT_ROUTES.home);
      return;
    }

    const tap = resolveHomeWidgetSessionTap({
      hasActiveSession: isWorkoutInProgress(workout.activeSession),
      hasActivePlan: homeActivePlanCard !== null,
      nowMs: Date.now(),
      schedule: homeTrainingSchedule,
      sessions: homeActivePlanCard?.sessions ?? [],
      completedWorkoutDayStarts: widgetCompletedWorkoutDayStarts,
      // Today's session is the one Home offers, not the calendar's slot for
      // today: the two differ whenever the rotation and the weekday disagree,
      // and the tap opened the one Home was not showing.
      homeSessionId: homeActivePlanCard?.nextSession.id ?? null,
      todayPicked: Boolean(homeActivePlanCard?.todayPickSessionId),
      // The same rotation the tile was drawn with, so a later day opens the
      // session it showed.
      sessionForecast: homeActivePlanCard?.sessionForecast ?? null,
    });

    // A running workout wins. The tile means "my training", and a reader who
    // stepped out to Home mid-set is asking for the set back, not for the
    // schedule to be looked up again (device report 2026-09-01).
    if (tap.kind === 'resume') {
      navigateToActiveWorkout({ resume: true });
      return;
    }
    // No session to open any more — the plan changed while the widget was
    // showing the old one. Home is the honest landing, not an empty screen.
    if (tap.kind === 'home' || !homeActivePlanCard) {
      resetToRoute(ROOT_ROUTES.home);
      return;
    }
    resetToRoute({
      tab: 'workout',
      screen: 'programDay',
      programType: homeActivePlanCard.programType,
      workoutTemplateId: homeActivePlanCard.programId,
      sessionId: tap.next.session.id,
    });
  }, [
    appHydrated,
    homeActivePlanCard,
    homeTrainingSchedule,
    pendingWidgetTarget,
    recommendedReadyTemplate,
    widgetCompletedWorkoutDayStarts,
  ]);
}
