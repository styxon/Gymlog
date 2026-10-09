const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** The text of a function from its signature to the closing brace at its own indent. */
function functionBody(source, signature, indent) {
  const at = source.indexOf(signature);
  assert.notEqual(at, -1, `missing: ${signature}`);
  const end = source.indexOf(`\n${indent}}\n`, at);
  assert.notEqual(end, -1, `no end for: ${signature}`);
  return source.slice(at, end);
}

/**
 * Preferences live twice: inside the database blob and on their own key, and
 * loading reads the key OVER the blob. `commit` wrote only the blob, so every
 * mutation that changed a preference through it — onboarding's result above
 * all — was undone by the next launch if nothing had written the key since
 * (found 2026-09-14: finish onboarding, close the app, and it starts again).
 */
module.exports = [
  {
    name: 'commitSavesPreferences: loading lets the preferences key win over the blob',
    run() {
      // The premise of the fix. If this ever stops being true, the key write in
      // commit is dead weight and should go with it.
      const database = read('src', 'storage', 'database.ts');
      // The key's copy is what loadDatabase returns (after the running-set
      // repair, which reads the overlay rather than replacing it). The repair
      // is reconcileRunningSet since it also drops ids with no plan behind
      // them (2026-09-21); includeLeadInRunningSet is one step of it.
      assert.match(database, /const preferences = await loadStoredPreferences\(database\.preferences\)/);
      // Through reconcileWithPlans since the completion dismissals are
      // repaired in the same step (hunt 10, #19).
      assert.match(database, /preferences: reconcileWithPlans\(preferences, database\.workoutPlans\)/);
      assert.match(
        functionBody(database, 'function reconcileWithPlans(', ''),
        /reconcileRunningSet\(preferences, plans\)/,
      );
      assert.match(
        functionBody(database, 'async function loadStoredPreferences(', ''),
        /\{ \.\.\.fallback, \.\.\.parsed \}/,
      );
    },
  },
  {
    name: 'commitSavesPreferences: a commit that changes preferences writes the key too',
    run() {
      const provider = read('src', 'state', 'AppProvider.tsx');
      const commit = functionBody(provider, 'async function commit(nextDatabase: AppDatabase) {', '  ');
      const previousAt = commit.indexOf('const previous = databaseRef.current;');
      const swapAt = commit.indexOf('databaseRef.current = nextDatabase;');
      assert.ok(previousAt >= 0 && previousAt < swapAt, 'the previous preferences are read before the swap');
      // The key goes in the blob's own transaction (storage/database.ts
      // saveDatabase withPreferences, behaviour in tests/storage/
      // preferencesWithBlob): written after it, a kill between the two kept
      // the new blob under the old key (break round, 2026-09-28).
      assert.match(
        commit,
        /await saveDatabase\(nextDatabase, \{ withPreferences: nextDatabase\.preferences !== previous\.preferences \}\);/,
      );
      assert.doesNotMatch(commit, /await savePreferences\(/, 'the key is written apart from the blob again');

      // Onboarding's result goes through commit with its preferences — the case that was lost.
      const onboarding = provider.slice(provider.indexOf('await commit({\n        ...withPlan,'));
      assert.match(onboarding.slice(0, 300), /preferences: \{\s*\.\.\.withPlan\.preferences,\s*\.\.\.input\.preferences,/);
    },
  },
];
