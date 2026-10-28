const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { t } = require('../../src/lib/i18n');
const { readAppWiring } = require('../helpers/appWiringSource.cjs');
const { between } = require('../helpers/sourceSlices.cjs');

/**
 * A write the disk refuses does not stay in memory.
 *
 * `commit` used to move memory forward and never back. A failed save left the
 * new state on screen with nothing behind it: the finish screen showed its
 * error, the reader pressed Finish again, and the retry found the session
 * already "saved" in memory, reported success and wrote nothing (bug hunt
 * 2026-09-14). Source-level, like the sibling suite: commit lives inside the
 * React provider.
 */

const clean = (source) =>
  source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
const read = (...parts) => clean(fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8'));

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} is gone`);
  const ends = ['\n  function ', '\n  async function ']
    .map((marker) => source.indexOf(marker, start + signature.length))
    .filter((index) => index > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

module.exports = [
  {
    name: 'commitRollsBack: a commit whose write fails puts the previous database back and rethrows',
    run() {
      const commit = functionBody(read('src', 'state', 'AppProvider.tsx'), 'async function commit(nextDatabase: AppDatabase)');
      const snapshot = commit.indexOf('const previous = databaseRef.current;');
      const swap = commit.indexOf('databaseRef.current = nextDatabase;');
      assert.ok(snapshot >= 0 && snapshot < swap, 'the previous database is not held before memory moves');

      const tryAt = commit.indexOf('try {');
      const write = commit.indexOf('await saveDatabase(nextDatabase, { withPreferences: nextDatabase.preferences !== previous.preferences });');
      assert.ok(write > tryAt && tryAt > swap, 'the write is outside the try, or no longer carries the preferences with it');
      assert.match(
        commit,
        /catch \(error\) \{\s*databaseRef\.current = previous;\s*setDatabase\(previous\);\s*throw error;\s*\}/,
        'a failed write leaves the new state in memory, or is swallowed',
      );
      // One transaction, not two writes: the preferences key travels with the
      // blob, so there is no second write for a kill to land between (break
      // round, 2026-09-28), and nothing half-written to take back.
      assert.doesNotMatch(commit, /savePreferences\(/);
      assert.doesNotMatch(commit, /blobWritten/);
    },
  },
  {
    name: 'commitRollsBack: a preference the disk refused is not left switched on',
    run() {
      const update = functionBody(read('src', 'state', 'AppProvider.tsx'), 'function updatePreferences(patch: PreferencesPatch)');
      assert.match(
        update,
        /try \{\s*await savePreferences\(next\.preferences\);\s*\} catch \(error\) \{\s*databaseRef\.current = current;\s*setDatabase\(current\);\s*throw error;\s*\}/,
      );
    },
  },
  {
    name: 'commitRollsBack: a Hevy import whose write fails says so and keeps the pasted export on screen',
    run() {
      // The settings sheet mounts in the shell's render tail, which moved
      // from App.tsx into src/app (phase C). The handler runs to its own
      // closing `}}`, so the slice stays inside the one file that holds it.
      const opener = 'onImportHistory={async (preview) => {';
      const shell = clean(readAppWiring());
      assert.equal(shell.split(opener).length - 1, 1, 'expected exactly one Hevy import handler');
      const handler = between(shell, opener, '}}');
      // The throw: a handler that returned normally resolved the sheet's
      // await, and the sheet closed and cleared the export. No toast from
      // here — it would draw behind the sheet's modal.
      const failurePath = between(handler, '} catch (error) {', 'throw error;');
      assert.match(handler, /try \{\s*result = await importWorkoutHistory\(preview\.workouts\);\s*\} catch \(error\) \{[\s\S]*?throw error;/);
      assert.doesNotMatch(failurePath, /showToast/, 'a toast on the failure path draws behind the open sheet');
      const sheet = read('src', 'components', 'NewProgramSheet.tsx');
      const importHistory = sheet.slice(sheet.indexOf('async function handleImportHistory'), sheet.indexOf('async function handleImport()'));
      assert.match(
        importHistory,
        /await onImportHistory\(hevyPreview\);\s*handleClose\(\);\s*\}\s*catch \{\s*setImportError\(t\(language, 'hevy\.failed'\)\);/,
        'the sheet closes, crashes, or stays silent on a rejected import',
      );
      assert.match(sheet, /\{importError \? <Text style=\{styles\.errorNote\}>\{importError\}<\/Text> : null\}/, 'the reason is held but never drawn');
      assert.equal(t('fi', 'hevy.failed'), 'Tuotuja treenejä ei voitu tallentaa — mitään ei tuotu');
      assert.match(t('en', 'hevy.failed'), /nothing was imported/);
    },
  },
];
