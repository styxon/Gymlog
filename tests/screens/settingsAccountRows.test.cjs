const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settings = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');

/** Slices between two anchors, failing loudly when one is missing. */
function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0, `anchor missing: ${from}`);
  assert.ok(end > start, `anchor missing after ${from}: ${to}`);
  return source.slice(start, end);
}

/**
 * Sign in and Back up now sit under DANGER ZONE, green, where Sign out is
 * found (user, 2026-10-03) — not up in YOUR DATA any more.
 */
module.exports = [
  {
    name: 'settings: sign in and back up sit under the danger zone, and only there',
    run() {
      const yourData = between(settings, "'settings.section.yourData'", "'settings.section.about'");
      const bottom = between(settings, "'settings.section.dangerZone'", 'styles.footer');
      for (const key of ["'account.signIn.google'", "'account.backupNow'", 'AppleSignInButton', "onSignIn('google')"]) {
        assert.ok(!yourData.includes(key), `${key} left YOUR DATA`);
        assert.ok(bottom.includes(key), `${key} is under the danger zone`);
      }
      assert.ok(bottom.indexOf("'account.signOut'") < bottom.indexOf("'account.signIn.google'"), 'below the red rows');
      // Google's sign-in is a button drawn to match Apple's beside it (user
      // 2026-10-17), not a green row; Back up now stays a green row.
      assert.match(bottom, /<GoogleSignInButton\s+label=\{t\(language, 'account\.signIn\.google'\)\}/);
      for (const key of ["'account.backupNow'"]) {
        const row = bottom.slice(bottom.lastIndexOf('<Row', bottom.indexOf(key)), bottom.indexOf(key));
        assert.match(row, /\bpositive\b/, `${key} row is green`);
      }
    },
  },
];
