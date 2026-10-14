const assert = require('node:assert/strict');

/**
 * Release signing plugin: the transform that turns the Expo template's
 * debug-signed release into an upload-key release that fails loudly without
 * its properties. `android/` is regenerated, so this is the only copy.
 */
const { applyReleaseSigning, RELEASE_SIGNING_MARKER } = require('../../plugins/withReleaseSigning.js');
const appConfig = require('../../app.json');

const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

const PROPS = ['VINHA_UPLOAD_STORE_FILE', 'VINHA_UPLOAD_KEY_ALIAS', 'VINHA_UPLOAD_STORE_PASSWORD', 'VINHA_UPLOAD_KEY_PASSWORD'];

module.exports = [
  {
    name: 'release signing: the plugin is registered in app.json',
    run() {
      const plugins = appConfig.expo.plugins.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
      assert.ok(plugins.includes('./plugins/withReleaseSigning.js'));
    },
  },
  {
    name: 'release signing: adds a release signingConfig and points the release buildType at it',
    run() {
      const out = applyReleaseSigning(TEMPLATE);
      assert.match(out, /signingConfigs \{\s*\/\/ vinha-release-signing[^\n]*\n\s*release \{/);
      for (const p of PROPS) assert.ok(out.includes(`'${p}'`), p);
      assert.ok(out.includes('VINHA_ALLOW_DEBUG_SIGNED_RELEASE'));
      assert.ok(out.includes('signingConfig signingConfigs.release'));
      assert.ok(out.includes('GradleException'));
      assert.ok(!out.includes('Caution!'), 'the template comment is gone');
      // the debug buildType and debug signingConfig are untouched
      assert.match(out, /debug \{\s*storeFile file\('debug\.keystore'\)/);
      assert.match(out, /buildTypes \{\s*debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
      // the rest of the release body survives
      assert.ok(out.includes('shrinkResources enableShrinkResources.toBoolean()'));
    },
  },
  {
    name: 'release signing: running twice does not duplicate the block',
    run() {
      const once = applyReleaseSigning(TEMPLATE);
      const twice = applyReleaseSigning(once);
      assert.equal(twice, once);
      assert.equal(once.split(RELEASE_SIGNING_MARKER).length - 1, 2);
    },
  },
  {
    name: 'release signing: throws when an anchor is missing',
    run() {
      assert.throws(() => applyReleaseSigning('android {\n}\n'), /signingConfigs/);
      assert.throws(
        () => applyReleaseSigning(TEMPLATE.replace(/release \{[\s\S]*?\n        \}\n/, 'release {\n        }\n')),
        /anchor not found/,
      );
    },
  },
];
