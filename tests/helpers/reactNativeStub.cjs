const path = require('node:path');

/**
 * react-native for suites that load a compiled storage module directly.
 *
 * storage/largeItem.ts reads Platform.OS (iOS is written as one row, Android
 * in parts), and react-native's own entry is Flow source Node cannot parse.
 * A suite that needs only a pure export from a module that reaches largeItem
 * — workoutPersistence's normalizeWorkoutBundle, say — installs this before
 * the require. Suites that care about the platform go through
 * storage/fakeAsyncStorage.cjs's loadAgainstFake({ platform }) instead.
 */
function installReactNativeStub(os = 'android') {
  const file = require.resolve('react-native', { paths: [path.join(__dirname, '..', '..', 'src', 'storage')] });
  if (!require.cache[file]) {
    require.cache[file] = {
      id: file,
      filename: file,
      loaded: true,
      exports: { I18nManager: {}, NativeModules: {}, Platform: { OS: os } },
    };
  }
}

module.exports = { installReactNativeStub };
