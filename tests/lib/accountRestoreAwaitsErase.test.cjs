const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Recheck round, 2026-09-29: App.tsx's onRestored erased the coach's own
 * memory fire-and-forget — `void clearCoachAdviceMemory()` — so
 * useAccountBackup's applyRestore (which never awaited it either) could
 * resolve the restore before the erase had even reached the disk. A process
 * kill in that window left another account's coach memory behind for the
 * next one. Source guard, the same convention as the rest of this app's
 * wiring tests: the handler is a plain object literal passed into a hook,
 * not something a runtime harness can drive without also driving the whole
 * hook it configures.
 */
module.exports = [
  {
    name: 'App.tsx: the account restore\'s onRestored handler awaits the coach memory erase',
    run() {
      const app = strip(readAppWiring());
      const start = app.indexOf('onRestored: async () => {');
      assert.ok(start >= 0, 'onRestored is gone, or no longer declared async — useAccountBackup awaits it, and a sync handler cannot hold the restore open for a promise it never returns');
      const end = app.indexOf('\n    },', start);
      const handler = app.slice(start, end);
      assert.match(
        handler,
        /await clearCoachAdviceMemory\(\);/,
        'onRestored no longer awaits the erase — a process kill between the restore landing and the erase finishing leaves the next account with this one\'s coach memory',
      );
    },
  },
  {
    name: 'useAccountBackup: applyRestore awaits onRestored, and a rejection from it does not fail the restore',
    run() {
      const hook = strip(read('src', 'features', 'account', 'useAccountBackup.ts'));
      const start = hook.indexOf('const applyRestore = useCallback(');
      assert.ok(start >= 0, 'applyRestore is gone');
      const end = hook.indexOf('return accountBackupFingerprint(database, history);', start);
      const body = hook.slice(start, end);
      assert.match(
        body,
        /try \{\s*await latestRef\.current\.onRestored\?\.\(\);\s*\}\s*catch \(error\) \{/,
        'applyRestore no longer awaits onRestored inside a try/catch — either it resolves before the erase is on disk, or a rejection from it now fails an already-landed restore',
      );
    },
  },
];
