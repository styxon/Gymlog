import { AppState } from 'react-native';
import { useEffect } from 'react';

import { trackEvent } from '../features/analytics/analyticsClient';
import { countsAsAppOpen } from '../lib/analyticsMoments';
import { AppPreferences } from '../types/models';

/**
 * Whether Android can pin the home-screen widget and whether it is pinned,
 * re-asked on every foreground (with the app_open count that rides on the same
 * listener), and the handler that asks Android to pin it.
 *
 * Moved out of App.tsx verbatim in the phase-C split (2026-10-01). A hook
 * because the moved code is an effect: VinhaApp calls it at the slot it stood
 * in — after the lead-plan repair, before the hand-off — so React's hook order
 * and the order the effects run in are unchanged. The native module's calls
 * are passed in rather than imported, so nothing in src/app reaches for
 * ./modules directly.
 */
interface HomeWidgetPinStateDeps {
  appHydrated: boolean;
  setHomeWidgetState: (state: { supported: boolean; added: boolean } | null) => void;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
  /** From ./modules/home-widget. */
  isHomeWidgetSupported: () => Promise<boolean>;
  /** From ./modules/home-widget. */
  isHomeWidgetAdded: () => Promise<boolean>;
  /** From ./modules/home-widget. */
  requestPinHomeWidget: () => Promise<boolean>;
}

export function useHomeWidgetPinState(deps: HomeWidgetPinStateDeps) {
  const {
    appHydrated,
    setHomeWidgetState,
    updatePreferences,
    isHomeWidgetSupported,
    isHomeWidgetAdded,
    requestPinHomeWidget,
  } = deps;

  // What Android says about pinning the widget. Re-asked on every foreground,
  // because the user may have added or removed it while we were away.
  useEffect(() => {
    if (!appHydrated) {
      return undefined;
    }
    let cancelled = false;
    const refresh = async () => {
      const supported = await isHomeWidgetSupported();
      const added = supported ? await isHomeWidgetAdded() : false;
      if (!cancelled) {
        setHomeWidgetState({ supported, added });
      }
    };
    void refresh();
    // Also app_open, which daily actives and retention are counted from: the
    // cold start, and a return after a real absence. Every foreground used to
    // count, and the app sends the reader out and back itself — the photo
    // picker, a permission dialog, the system settings — so one sitting read
    // as several opens (analytics audit, 2026-09-21).
    trackEvent('app_open');
    let backgroundedAtMs: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAtMs = Date.now();
        return;
      }
      if (state === 'active') {
        void refresh();
        if (countsAsAppOpen(backgroundedAtMs, Date.now())) {
          trackEvent('app_open');
        }
        backgroundedAtMs = null;
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [appHydrated]);

  // Android never reports whether the user accepted the pin dialog, so the
  // offer is retired on the attempt, not on a success we cannot observe. The
  // Settings row stays available either way.
  const handleAddHomeWidget = async () => {
    await requestPinHomeWidget();
    void updatePreferences({ homeWidgetPromptDismissed: true });
  };

  return { handleAddHomeWidget };
}
