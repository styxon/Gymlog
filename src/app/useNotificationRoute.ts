import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { routeForNotification } from '../lib/notificationRoute';
import type { AppRoute } from '../navigation/routes';

/**
 * Planner-notification taps: the route a tapped record, reminder or weekly
 * summary asked for, from the cold start's stored response and from the
 * running app's listener, held until both stores have loaded.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30).
 * A hook, not a helper: it is a piece of state and two effects with the app
 * shell's lifetime, and VinhaApp calls it exactly where those lines stood —
 * right after the widget-tap effect — so every hook keeps its slot, the
 * planner listener still registers after the lock-screen one, and on a shared
 * hydration commit this route reset still runs after the widget's and wins.
 *
 * In the moved doc below, "the one near the top of this file" is the
 * lock-screen listener, now in src/app/useSessionNotifications.ts, and "the
 * widget's target above" is App.tsx's widget-tap effect.
 */
export interface NotificationRouteDeps {
  /** Both stores loaded: VinhaApp's appHydrated. */
  appHydrated: boolean;
  /** VinhaApp's resetToRoute: a hoisted function declaration, so it exists at the call. */
  resetToRoute: (nextRoute: AppRoute) => void;
}

export function useNotificationRoute(deps: NotificationRouteDeps): void {
  const { appHydrated, resetToRoute } = deps;

  /**
   * A scheduled notification's tap lands where the notification was about.
   *
   * A SECOND response listener, deliberately: the one near the top of this
   * file answers the lock-screen rest actions and returns early for anything
   * without the session marker, so the planner's notifications — records,
   * reminders, the weekly summary — were tapped and then dropped. The reader
   * tapped a personal record and arrived at the activity calendar, which was
   * not a wrong destination but no destination: the app resumed the screen it
   * had been left on (#bugs 2026-09-05). The two stay separate because they
   * share nothing but the API — that one drives a running workout over the
   * bus, this one sets a route — and each ignores the other's notifications by
   * marker.
   *
   * Held until the database is loaded, exactly like the widget's target above:
   * resetting the route into a half-built app lands somewhere that is about to
   * re-render underneath it. The stored last response covers the cold start,
   * where the tap is what launched the process and the listener is attached
   * far too late to hear it.
   */
  const [pendingNotificationRoute, setPendingNotificationRoute] = useState<AppRoute | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handle = (response: Notifications.NotificationResponse | null) => {
      if (cancelled || !response) {
        return;
      }
      const next = routeForNotification(response.notification.request.content.data);
      if (next) {
        setPendingNotificationRoute(next);
      }
    };

    /*
     * The cold start, and then FORGETTING it.
     *
     * The stored last response outlives the launch it belongs to. Read without
     * clearing, it answers every later cold start with the same tap: open the
     * record notification once and the app lands on Records on every launch
     * afterwards, including launches from the icon with nothing in the shade.
     * expo-notifications names this case in `clearLastNotificationResponse`'s
     * own documentation — "undesirable to continue selecting the route after
     * the response has already been handled" (found in review, 2026-09-05).
     *
     * Cleared whether or not the route resolved: a response this build has no
     * destination for is still a response that has been seen, and leaving it
     * stored only means re-reading it on the next launch to ignore it again.
     */
    // Throws on web, where there is no stored response to read (#bugs
    // 2026-10-01 browser smoke test): nothing launched the app from a shade.
    let cold: Notifications.NotificationResponse | null = null;
    try {
      cold = Notifications.getLastNotificationResponse();
    } catch (error) {
      // Expected on web; anywhere else it is a broken module, said aloud.
      if (Platform.OS !== 'web') {
        console.error('Could not read the notification that opened the app', error);
      }
      cold = null;
    }
    if (cold) {
      handle(cold);
      Notifications.clearLastNotificationResponse();
    }

    /*
     * A tap while the app is running is stored as the last response too, and
     * for as long as the native module lives — which outlasts this component
     * when Android recreates the activity around a live JS runtime. Left
     * there, the next mount read it as a cold start and opened the same
     * page again. Forgotten once it has been routed, like the cold one.
     */
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handle(response);
      try {
        Notifications.clearLastNotificationResponse();
      } catch {
        // Unavailable on this platform: nothing is stored to forget.
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!appHydrated || !pendingNotificationRoute) {
      return;
    }
    setPendingNotificationRoute(null);
    // Progress keeps its section and measure as state the reader can change;
    // the stamp lets a second tap for the same destination take them back.
    resetToRoute(
      pendingNotificationRoute.tab === 'progress' && pendingNotificationRoute.screen === 'list'
        ? { ...pendingNotificationRoute, openedAt: Date.now() }
        : pendingNotificationRoute,
    );
  }, [appHydrated, pendingNotificationRoute]);
}
