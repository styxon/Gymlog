import { useEffect } from 'react';

import { AppPreferences } from '../types/models';
import { useAttemptOnce } from './useAttemptOnce';

/**
 * The two install stamps, written once both stores have loaded:
 * `hasOpenedAppBefore`, and `firstLaunchAt`, the install date the coach demo
 * moments count from. They stay two separate writes, in this order — the doc
 * on the second says why it is not folded into the first.
 *
 * Moved out of App.tsx verbatim in the phase-B split (2026-09-30). A hook
 * because the moved code is two effects: VinhaApp calls it at the slot they
 * stood in — after the day clock (todayKey, todayStartMs), before the
 * minimum-splash timer — so React's hook order and the order the effects run
 * in are unchanged.
 */

export interface InstallStampsDeps {
  /** Both stores have loaded: `hydrated && workout.hydrated` in App.tsx. */
  appHydrated: boolean;
  /** The stored preferences, passed whole so the deps arrays read as they did in App.tsx. */
  preferences: AppPreferences;
  /** `useAppContext().updatePreferences`. */
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<unknown>;
}

export function useInstallStamps(deps: InstallStampsDeps): void {
  const { appHydrated, preferences, updatePreferences } = deps;
  // Both stamps are tried once per session: a refused write is rolled back,
  // which put the missing value back and ran the effect again, forever.
  const tryOnce = useAttemptOnce();
  useEffect(() => {
    if (!appHydrated || preferences.hasOpenedAppBefore) {
      return;
    }

    tryOnce('hasOpenedAppBefore', () =>
      updatePreferences({
        hasOpenedAppBefore: true,
      }),
    );
  }, [appHydrated, preferences.hasOpenedAppBefore, tryOnce, updatePreferences]);

  /**
   * The install date the coach demo moments count their 7 / 30 / 90 days from.
   *
   * Stamped separately from hasOpenedAppBefore rather than beside it, because
   * an install that predates this field has already opened the app: it would
   * never take that branch, and its moments would never fire. Keyed on the
   * date being missing instead, so an upgrade starts the clock at the upgrade.
   */
  useEffect(() => {
    if (!appHydrated || preferences.firstLaunchAt) {
      return;
    }
    tryOnce('firstLaunchAt', () => updatePreferences({ firstLaunchAt: new Date().toISOString() }));
  }, [appHydrated, preferences.firstLaunchAt, tryOnce, updatePreferences]);
}
