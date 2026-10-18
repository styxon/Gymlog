const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldSweepSessionNotifications } = require('../../.test-dist/lib/sessionNotificationSweep.js');

const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * iOS hunt 2026-10-17, S6-3 (Android too). The app clears every session
 * notification when there is no live session — and before the workout store
 * had loaded there was none yet. A cold start in the middle of a rest
 * cleared the rest-end alert the old process had handed to the OS, so a
 * reader who opened the app and stayed on Home was never told the rest was
 * over.
 */
module.exports = [
  {
    name: 'sessionNotificationSweep: nothing is cleared before the workout store has loaded',
    run() {
      assert.equal(shouldSweepSessionNotifications({ hydrated: false, activeSessionId: null, status: null }), false);
      assert.equal(shouldSweepSessionNotifications({ hydrated: false, activeSessionId: 's1', status: 'completed' }), false);
    },
  },
  {
    name: 'sessionNotificationSweep: once loaded, no live session clears them and a live one keeps them',
    run() {
      assert.equal(shouldSweepSessionNotifications({ hydrated: true, activeSessionId: null, status: null }), true);
      assert.equal(shouldSweepSessionNotifications({ hydrated: true, activeSessionId: 's1', status: 'completed' }), true);
      assert.equal(shouldSweepSessionNotifications({ hydrated: true, activeSessionId: 's1', status: 'discarded' }), true);
      assert.equal(shouldSweepSessionNotifications({ hydrated: true, activeSessionId: 's1', status: 'active' }), false);
      // An empty id is no session, as the effect always read it.
      assert.equal(shouldSweepSessionNotifications({ hydrated: true, activeSessionId: '', status: 'active' }), true);
    },
  },
  {
    name: 'sessionNotificationSweep: the app sweeps through the rule, and runs again when the store loads',
    run() {
      const hook = strip(
        fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'useSessionNotifications.ts'), 'utf8'),
      );
      assert.match(
        hook,
        /if \(\s*shouldSweepSessionNotifications\(\{\s*hydrated: workout\.hydrated,\s*activeSessionId,\s*status: activeSessionStatus,\s*\}\)\s*\) \{\s*void clearAllSessionNotifications\(\);\s*\}\s*\}, \[workout\.hydrated, activeSessionId, activeSessionStatus\]\);/,
      );
      // The only sweep in the hook is that one.
      assert.equal(hook.split('clearAllSessionNotifications()').length - 1, 1);
    },
  },
];
