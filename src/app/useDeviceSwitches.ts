import { useEffect } from 'react';

import { setUsageStatisticsEnabled } from '../features/analytics/analyticsClient';
import { AppPreferences } from '../types/models';
import { setHapticsEnabled } from '../utils/haptics';
import { setSoundCuesEnabled } from '../utils/sound';

/**
 * The device-side switches that follow a stored preference: sound cues,
 * haptics and usage statistics. Each utility keeps its own module-level flag,
 * and these effects are what keep the flags in step with Settings.
 *
 * Moved out of App.tsx verbatim in the phase-B split (2026-09-30). A hook
 * because the moved code is three effects: VinhaApp calls it at the slot they
 * stood in — after the fontsLoaded state, before useScheduledNotifications —
 * so React's hook order and the order the effects run in are unchanged.
 */

interface DeviceSwitchesDeps {
  /** The database store has loaded: `useAppContext().hydrated`. */
  hydrated: boolean;
  /** The stored preferences, passed whole so the deps arrays read as they did in App.tsx. */
  preferences: AppPreferences;
}

export function useDeviceSwitches(deps: DeviceSwitchesDeps): void {
  const { hydrated, preferences } = deps;
  // Keep the cue utilities in sync with the user's preferences, so every call
  // site across the app is gated by one switch.
  useEffect(() => {
    setSoundCuesEnabled(preferences.soundCuesEnabled);
  }, [preferences.soundCuesEnabled]);
  useEffect(() => {
    setHapticsEnabled(preferences.hapticsEnabled);
  }, [preferences.hapticsEnabled]);
  // Usage statistics are the one thing the app sends on its own, so the
  // switch has to reach the client before anything can leave: the client
  // refuses to send until told, and it is only told once the stored
  // preferences are in — the pre-hydration default is "on", and a reader who
  // switched it off must never lose a batch to that default.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    setUsageStatisticsEnabled(preferences.usageStatisticsEnabled);
  }, [hydrated, preferences.usageStatisticsEnabled]);
}
