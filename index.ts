// First, so the error handlers are in place before the rest of the app's
// modules are evaluated. An error thrown while they load is handed to the
// reporter, which stores it under its own key (analyticsClient CRASH_KEY) and
// sends it on the next launch if the reader's statistics switch allows; the
// write is issued, not guaranteed to finish before the process ends.
import './src/features/errorReporting/installErrorReporting';
// Second, so a report of an error thrown while App's modules load names the build it came from.
import './src/features/appUpdate/registerAppIdentityAtStartup';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
//
// The store screenshots' build (docs/store-screenshots.md) opens on a seeded
// reader instead. The flag is read at bundle time and no store build sets it;
// tests/lib/screenshotSeedGate.test.cjs keeps this the only door to the seed.
registerRootComponent(
  process.env.EXPO_PUBLIC_SCREENSHOT_SEED === '1' ? require('./src/screenshots/SeededApp').default : App,
);
