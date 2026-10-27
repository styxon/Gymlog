import { useEffect, useState } from 'react';
import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { ActiveCardioSession, settleSavedCardioRun } from '../lib/cardio';
import type { CardioSession } from '../types/models';

/**
 * The boot sequence, moved out of App.tsx verbatim (app-split step 2): the
 * minimum-splash timer, the font load and the native splash hide. VinhaApp
 * calls it at the slot the three effects stood in, after useSettleSavedCardio
 * and useInstallStamps, so React's hook order and the order the effects run in
 * are unchanged.
 *
 * `SplashScreen.preventAutoHideAsync()`, MINIMUM_SPLASH_MS and
 * `splashFloorStartedAt` stay in App.tsx: the floor is counted from when
 * App's module body ran, and a module imported earlier would start it earlier.
 * Nothing here runs at load.
 */

interface AppBootDeps {
  /** Both stores have loaded: `hydrated && workout.hydrated` in App.tsx. */
  appHydrated: boolean;
  /** `performance.now()` taken when App.tsx's module body ran. */
  splashFloorStartedAt: number;
  /** How long the native splash stays up at least, counted from the floor. */
  minimumMs: number;
}

export function useAppBoot(deps: AppBootDeps): { nativeSplashHidden: boolean } {
  const { appHydrated, splashFloorStartedAt, minimumMs } = deps;
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    const remaining = minimumMs - (performance.now() - splashFloorStartedAt);
    const timeout = setTimeout(
      () => setMinimumSplashElapsed(true),
      Math.min(minimumMs, Math.max(0, remaining)),
    );
    return () => clearTimeout(timeout);
    // The floor and its length are module constants in App.tsx, fixed for the app's life.
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFonts() {
      await Font.loadAsync({
        // Variable Manrope kept as a fallback; the static per-weight families
        // below are what AppText.tsx maps fontWeight onto, because Android
        // does not drive a variable font's weight axis (headings rendered at
        // the ExtraLight default with a synthetic bold otherwise).
        Manrope: require('../../assets/fonts/Manrope.ttf'),
        'Manrope-Regular': require('../../assets/fonts/Manrope-Regular.ttf'),
        'Manrope-Medium': require('../../assets/fonts/Manrope-Medium.ttf'),
        'Manrope-SemiBold': require('../../assets/fonts/Manrope-SemiBold.ttf'),
        'Manrope-Bold': require('../../assets/fonts/Manrope-Bold.ttf'),
        'Manrope-ExtraBold': require('../../assets/fonts/Manrope-ExtraBold.ttf'),
        // Sets × reps numerals on the Home agenda list (design: JetBrains Mono).
        JetBrainsMono: require('../../assets/fonts/JetBrainsMono.ttf'),
      }).catch(() => {
        // Keep the app usable if font loading fails in a dev host.
      });

      if (!cancelled) {
        setFontsLoaded(true);
      }
    }

    void loadFonts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (nativeSplashHidden || !appHydrated || !fontsLoaded) {
      return;
    }

    if (!minimumSplashElapsed) {
      return;
    }

    let cancelled = false;

    async function hideNativeSplash() {
      await SplashScreen.hideAsync().catch(() => {
        // Ignore host-level splash errors on warm reloads.
      });

      if (!cancelled) {
        setNativeSplashHidden(true);
      }
    }

    void hideNativeSplash();

    return () => {
      cancelled = true;
    };
  }, [appHydrated, fontsLoaded, minimumSplashElapsed, nativeSplashHidden]);

  return { nativeSplashHidden };
}

interface SettleSavedCardioDeps {
  /** AppProvider has loaded. */
  hydrated: boolean;
  /** WorkoutProvider has loaded. */
  workoutHydrated: boolean;
  activeCardio: ActiveCardioSession | null;
  cardioSessions: readonly CardioSession[];
  settleCardio: (session: ActiveCardioSession, wasResumedAt: string | null) => void;
}

/**
 * A saved run that came back running (its pause and its clear both lost) is stopped where it was
 * saved, once both stores have loaded, before its clock carries the hours the app was dead into the
 * next Complete (lib/cardio settleSavedCardioRun).
 */
export function useSettleSavedCardio(deps: SettleSavedCardioDeps): void {
  const { hydrated, workoutHydrated, activeCardio, cardioSessions, settleCardio } = deps;
  useEffect(() => {
    if (!hydrated || !workoutHydrated) {
      return;
    }
    const settled = settleSavedCardioRun(activeCardio, cardioSessions);
    if (settled) {
      settleCardio(settled, activeCardio?.resumedAt ?? null);
    }
  }, [hydrated, workoutHydrated, activeCardio, cardioSessions, settleCardio]);
}
