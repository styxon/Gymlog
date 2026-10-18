/**
 * The app, opened on the store screenshots' reader.
 *
 * Reached only from index.ts, and only when EXPO_PUBLIC_SCREENSHOT_SEED is
 * "1" at bundle time — the screenshots workflow's build. Every store build
 * bundles without it, and the require in index.ts is folded away with the
 * branch it sits in (tests/lib/screenshotSeedGate.test.cjs).
 *
 * On a first launch — nothing stored yet — the seed is written through the
 * app's own savers before App mounts, so both providers load it the way they
 * load any reader's data. A launch that finds data opens it as it is.
 *
 * Language and theme come from the launch arguments the Maestro flow passes
 * (`-vinhaLanguage fi -vinhaTheme light`): iOS files them in the arguments
 * domain of NSUserDefaults, which Settings reads. Absent, the phone's language
 * and the dark theme.
 */
import React, { useEffect, useState } from 'react';
import { Settings } from 'react-native';

import App from '../../App';
import { saveWorkoutBundle } from '../features/workout/workoutPersistence';
import { saveDatabase } from '../storage/database';
import { resolveDeviceLanguage } from '../storage/deviceLocale';
import { getLargeItem } from '../storage/largeItem';
import type { AppLanguage } from '../types/models';
import { buildScreenshotSeed } from './screenshotSeed';

/** database.ts's key, read only to see whether this is a first launch. */
const DATABASE_KEY = '@vinha/database/v1';

function launchArgument(name: string): string | null {
  try {
    const value = Settings.get(name);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function seedOnFirstLaunch() {
  if (await getLargeItem(DATABASE_KEY)) {
    return;
  }
  const requested = launchArgument('vinhaLanguage');
  const language: AppLanguage = requested === 'fi' || requested === 'en' ? requested : resolveDeviceLanguage();
  const seed = buildScreenshotSeed({
    language,
    dark: launchArgument('vinhaTheme') !== 'light',
    now: new Date(),
  });
  // The workout first: a database without its running session opens on Home
  // with no "Continue"; the other way round is never seen, since App waits.
  await saveWorkoutBundle(seed.workout);
  await saveDatabase(seed.database, { withPreferences: true });
}

export default function SeededApp() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    seedOnFirstLaunch()
      .catch((error) => console.error('Screenshot seed failed', error))
      .finally(() => setReady(true));
  }, []);
  return ready ? <App /> : null;
}
