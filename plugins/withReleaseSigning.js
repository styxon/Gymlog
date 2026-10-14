const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Sign release builds (APK and AAB) with the upload key instead of the debug key.
 *
 * `expo prebuild` generates `signingConfig signingConfigs.debug` for release, and
 * `android/` is regenerated, so a hand edit does not last. The key itself lives
 * outside the repo; its location and passwords come from Gradle properties in
 * the owner's `~/.gradle/gradle.properties`:
 *   VINHA_UPLOAD_STORE_FILE, VINHA_UPLOAD_KEY_ALIAS,
 *   VINHA_UPLOAD_STORE_PASSWORD, VINHA_UPLOAD_KEY_PASSWORD
 *
 * With all four, release uses them. Without them a release build fails with a
 * message naming what is missing, unless VINHA_ALLOW_DEBUG_SIGNED_RELEASE=true
 * (a deliberate local test build). Never a silent fall back to debug.
 * See docs/android-release-signing.md.
 */
const MARKER = 'vinha-release-signing';

const SIGNING_BLOCK = `    signingConfigs {
        // ${MARKER}: upload key from Gradle properties (no secret in the repo)
        release {
            if (findProperty('VINHA_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('VINHA_UPLOAD_STORE_FILE'))
                storePassword findProperty('VINHA_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('VINHA_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('VINHA_UPLOAD_KEY_PASSWORD')
            }
        }
`;

const RELEASE_SIGNING = `// ${MARKER}: release is signed with the upload key, or fails loudly
            def vinhaSigningProps = ['VINHA_UPLOAD_STORE_FILE', 'VINHA_UPLOAD_KEY_ALIAS', 'VINHA_UPLOAD_STORE_PASSWORD', 'VINHA_UPLOAD_KEY_PASSWORD']
            def vinhaMissingProps = vinhaSigningProps.findAll { !findProperty(it) }
            if (vinhaMissingProps.isEmpty()) {
                signingConfig signingConfigs.release
            } else if (findProperty('VINHA_ALLOW_DEBUG_SIGNED_RELEASE') == 'true') {
                signingConfig signingConfigs.debug
            } else {
                gradle.taskGraph.whenReady { graph ->
                    if (graph.allTasks.any { it.name =~ /^(assemble|bundle|package|validateSigning)(.*)Release/ }) {
                        throw new GradleException("Release signing is not configured. Missing Gradle properties: \${vinhaMissingProps.join(', ')}. Set them in ~/.gradle/gradle.properties (see docs/android-release-signing.md), or set VINHA_ALLOW_DEBUG_SIGNED_RELEASE=true for a deliberately debug-signed local build.")
                    }
                }
            }`;

const SIGNING_ANCHOR = /^    signingConfigs \{\r?\n/m;
const DEBUG_LINE = /signingConfig signingConfigs\.debug/g;

function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!SIGNING_ANCHOR.test(contents)) {
    throw new Error('withReleaseSigning: "signingConfigs {" anchor not found in app/build.gradle');
  }
  const buildTypes = contents.indexOf('buildTypes {');
  const releaseIdx = buildTypes < 0 ? -1 : contents.indexOf('release {', buildTypes);
  let match = null;
  if (releaseIdx >= 0) {
    DEBUG_LINE.lastIndex = releaseIdx;
    match = DEBUG_LINE.exec(contents);
  }
  if (!match) {
    throw new Error(
      'withReleaseSigning: release buildType "signingConfig signingConfigs.debug" anchor not found in app/build.gradle',
    );
  }
  const lineStart = contents.lastIndexOf('\n', match.index) + 1;
  const indent = contents.slice(lineStart, match.index);
  // The template's "Caution! ... generate your own keystore" comments sit directly above the line.
  let head = contents.slice(0, lineStart);
  head = head.replace(/(?:[ \t]*\/\/[^\n]*\n)+$/, '');
  const tail = contents.slice(match.index + match[0].length);
  const patched = head + indent + RELEASE_SIGNING + tail;
  return patched.replace(SIGNING_ANCHOR, SIGNING_BLOCK);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = applyReleaseSigning(config.modResults.contents);
    return config;
  });
};

module.exports.applyReleaseSigning = applyReleaseSigning;
module.exports.RELEASE_SIGNING_MARKER = MARKER;
