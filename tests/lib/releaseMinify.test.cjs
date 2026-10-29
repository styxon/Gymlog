const assert = require('node:assert/strict');

/**
 * R8 on Android release builds, and that the setting is real.
 *
 * Play measures how much of the DEX is obfuscated (25 % floor from February
 * 2027). Both switches live in `android/gradle.properties`, which `expo
 * prebuild` regenerates, so they come from a config plugin; one that stops
 * running would not fail a build, it would quietly ship unminified again.
 */
const {
  applyReleaseMinify,
  applyKeepRules,
  MINIFY_KEY,
  SHRINK_KEY,
  WIDGET_RECEIVERS,
  KEEP_RULES,
} = require('../../plugins/withReleaseMinify.js');
const appConfig = require('../../app.json');

function valueOf(properties, key) {
  return properties.find((item) => item.type === 'property' && item.key === key)?.value ?? null;
}

module.exports = [
  {
    name: 'release minify: the plugin is registered, or it never runs',
    run() {
      const plugins = appConfig.expo.plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
      assert.ok(plugins.includes('./plugins/withReleaseMinify.js'), 'the release minify plugin is not in app.json');
    },
  },
  {
    name: 'release minify: both properties are the ones build.gradle reads, and replace the generated false',
    run() {
      // Spelled exactly as Expo's generated android/app/build.gradle reads them.
      assert.equal(MINIFY_KEY, 'android.enableMinifyInReleaseBuilds');
      assert.equal(SHRINK_KEY, 'android.enableShrinkResourcesInReleaseBuilds');

      const generated = [
        { type: 'property', key: MINIFY_KEY, value: 'false' },
        { type: 'property', key: 'newArchEnabled', value: 'true' },
      ];
      const applied = applyReleaseMinify(generated);
      assert.equal(valueOf(applied, MINIFY_KEY), 'true');
      assert.equal(valueOf(applied, SHRINK_KEY), 'true');
      assert.equal(applied.filter((item) => item.key === MINIFY_KEY).length, 1, 'the property is set twice');
      assert.ok(applied.some((item) => item.key === 'newArchEnabled'));
    },
  },
  {
    name: 'release minify: every widget receiver is kept by name, the same list the widget plugin declares',
    run() {
      // A receiver R8 renamed would orphan every widget already on a home screen;
      // HomeWidgetModule asks for these four by name.
      assert.deepEqual(WIDGET_RECEIVERS, [
        'app.vinha.HomeWidgetProvider',
        'app.vinha.WeekWidgetProvider',
        'app.vinha.StreakWidgetProvider',
        'app.vinha.RoutineWidgetProvider',
      ]);
      for (const name of WIDGET_RECEIVERS) {
        assert.ok(KEEP_RULES.includes(`-keep class ${name} { *; }`), `${name} is not kept`);
      }
    },
  },
  {
    name: 'release minify: expo-notifications is kept, since its own rule never reaches R8',
    run() {
      // Without it every scheduled notification failed with
      // NotSerializableException on the R8 build (2026-10-29).
      assert.ok(KEEP_RULES.includes('-keep class expo.modules.notifications.** { *; }'));
      assert.ok(KEEP_RULES.includes('private void writeObject(java.io.ObjectOutputStream);'));
    },
  },
  {
    name: 'release minify: the keep block is written once, after the generated rules, however often prebuild runs',
    run() {
      const generated = '# react-native-reanimated\n-keep class com.swmansion.reanimated.** { *; }\n';
      const once = applyKeepRules(generated);
      const twice = applyKeepRules(once);
      assert.equal(twice, once);
      assert.ok(once.startsWith(generated.trimEnd()), 'the generated rules were dropped');
      assert.equal(once.split('# vinha-release-minify:start').length, 2);
    },
  },
];
