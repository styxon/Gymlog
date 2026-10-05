const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readAppWiring } = require('../helpers/appWiringSource.cjs');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
/** App.tsx and the src/app modules its blocks moved into, line endings normalised like read(). */
const readShell = () => readAppWiring().replace(/\r\n/g, '\n');
/** Comments out, so a guard is matched against code and not against its own explanation. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/**
 * Data-loss audit, 2026-09-15. Each of these let a write land on top of data
 * the app had not read yet, or had read and was about to throw away.
 *
 * Source-level, like commitSavesPreferences and corruptDatabase beside them:
 * the providers and hooks are React on AsyncStorage, which does not run under
 * Node. So these pin the shape of each fix, and each was mutated back to the
 * old shape to see it fail.
 */
module.exports = [
  {
    name: 'writesWaitForLoad: the provider queues every write behind the load',
    run() {
      const provider = code(read('src', 'state', 'AppProvider.tsx'));
      // The first task in the write queue is the gate, so every write waits.
      assert.match(
        provider,
        /runExclusiveRef\.current = createSerialTaskQueue\(\);\s*const gate = hydrationGateRef\.current;\s*void runExclusiveRef\.current\(\(\) => gate\.promise\);/,
      );
      // The gate opens on a load that landed, and nowhere else.
      const opens = provider.match(/hydrationGateRef\.current\?\.open\(\)/g) ?? [];
      assert.equal(opens.length, 1, 'the gate opens in exactly one place');
      const hydrate = provider.slice(provider.indexOf('async function hydrate()'), provider.indexOf('hydrate();'));
      assert.ok(
        hydrate.indexOf('databaseRef.current = nextDatabase;') < hydrate.indexOf('hydrationGateRef.current?.open()'),
        'the gate opens after the loaded database is in the ref',
      );
      // A failed load is not a new install: no empty database is put in its place.
      assert.doesNotMatch(hydrate, /createEmptyDatabase/);
      assert.match(hydrate, /const result = await loadWithRetry\(loadDatabase, \{\s*isCancelled: \(\) => cancelled,/);
      // The failure is noted (error reports, 2026-10-03) and then, as before, shown — nothing else.
      assert.match(hydrate, /if \(result\.kind === 'failed'\) \{\s*reportOperationFailed\('database_load', result\.error\);\s*setLoadFailed\(true\);\s*return;\s*\}/);
      assert.ok(
        hydrate.indexOf("result.kind === 'cancelled'") < hydrate.indexOf('databaseRef.current = nextDatabase;') &&
          hydrate.indexOf("result.kind === 'failed'") < hydrate.indexOf('databaseRef.current = nextDatabase;'),
        'only a load that landed reaches the ref',
      );
      assert.match(provider, /if \(loadFailed\) \{\s*return \(\s*<StorageLoadFailedScreen/);
    },
  },
  {
    name: 'writesWaitForLoad: the workout store neither hangs nor saves an empty bundle over a failed read',
    run() {
      const provider = code(read('src', 'features', 'workout', 'WorkoutProvider.tsx'));
      const hydrate = provider.slice(provider.indexOf('async function hydrate()'), provider.indexOf('hydrate();'));
      // The read goes through loadWithRetry, which catches (tests/storage/loadWithRetry).
      assert.match(
        hydrate,
        /const result = await loadWithRetry\(loadWorkoutBundle, \{\s*isCancelled: \(\) => cancelled,/,
        'a read that throws has to be caught, or the splash never goes',
      );
      const failed = hydrate.slice(hydrate.indexOf("if (result.kind === 'failed') {"));
      assert.match(failed, /^if \(result\.kind === 'failed'\) \{\s*reportOperationFailed\('workout_load', result\.error\);\s*setLoadFailed\(true\);\s*return;\s*\}/);
      assert.ok(
        hydrate.indexOf("result.kind === 'failed'") < hydrate.indexOf("type: 'session/hydrate'"),
        'hydrating on a failed read saves the empty bundle over the stored one',
      );
      assert.match(provider, /if \(loadFailed\) \{\s*return \(\s*<StorageLoadFailedScreen/);

      // A bundle that reads but will not parse is set aside first, and a reset removes the copy.
      const persistence = code(read('src', 'features', 'workout', 'workoutPersistence.ts'));
      const load = persistence.slice(persistence.indexOf('export async function loadWorkoutBundle'), persistence.indexOf('export async function saveWorkoutBundle'));
      const parseCatch = load.slice(load.indexOf('catch {'));
      assert.ok(parseCatch.indexOf('setLargeItem(CORRUPT_STORAGE_KEY, raw)') >= 0, 'the unparseable bundle is not kept');
      assert.ok(parseCatch.indexOf('setLargeItem(CORRUPT_STORAGE_KEY, raw)') < parseCatch.indexOf('createEmptyWorkoutHistory()'));
      const clear = persistence.slice(persistence.indexOf('export async function clearWorkoutBundle'));
      assert.match(clear, /removeLargeItem\(CORRUPT_STORAGE_KEY\)/);
    },
  },
  {
    name: 'writesWaitForLoad: the Google name is adopted only after the stored preferences loaded',
    run() {
      const app = code(read('App.tsx'));
      const at = app.indexOf('const step = accountNameStep({');
      assert.notEqual(at, -1);
      const effect = app.slice(app.lastIndexOf('useEffect(() => {', at), app.indexOf(']);', app.indexOf('}, [', at)) + 3);
      assert.match(effect, /if \(!appHydrated\) \{\s*return;\s*\}/);
      assert.ok(effect.indexOf('!appHydrated') < effect.indexOf('updatePreferences('), 'the guard comes before the write');
      assert.match(effect, /\}, \[[^\]]*appHydrated[^\]]*\]\);/);
    },
  },
  {
    name: 'writesWaitForLoad: the route-level back listener does not re-subscribe on every workout tick',
    run() {
      // The whole shell: the listener left App.tsx for a src/app hook in the
      // phase-C split (2026-10-01). Every slice below is searched from the
      // listener it found, so it stays inside that one file.
      const app = code(readShell());
      // The listener that walks routes: the one holding getBackRoute. A check
      // for a document open over the hand-off now comes first inside it.
      const nextRouteAt = app.indexOf('const nextRoute = getBackRoute(route, workoutHomeRoute);');
      assert.notEqual(nextRouteAt, -1);
      const at = app.lastIndexOf("BackHandler.addEventListener('hardwareBackPress', () => {", nextRouteAt);
      assert.notEqual(at, -1);
      assert.ok(nextRouteAt - at < 400, 'getBackRoute is no longer at the top of a back listener');
      const deps = app.slice(app.indexOf('}, [', at), app.indexOf(']);', at) + 3);
      // The context is a new object every second while a rest timer or cardio
      // runs; depending on it made this the newest listener every second.
      assert.doesNotMatch(deps, /\bworkout\b/);
      assert.match(app.slice(at, app.indexOf(']);', at)), /workoutRef\.current\.clearCompletedWorkout\(\)/);
    },
  },
  {
    name: 'writesWaitForLoad: restore-or-keep answers with the account it was asked for, and nothing uploads meanwhile',
    run() {
      const hook = code(read('src', 'features', 'account', 'useAccountBackup.ts'));
      const resolve = hook.slice(hook.indexOf('const resolveRestoreChoice = useCallback('), hook.indexOf('const runBackup = useCallback('));
      // The dialog calls the function from the render that started sign-in,
      // when `account` was still null.
      assert.match(resolve, /const current = pending\.account;/);
      assert.doesNotMatch(resolve, /=\s*account\b/);
      assert.doesNotMatch(resolve.slice(resolve.lastIndexOf('[')), /\baccount\b/);

      const backup = hook.slice(hook.indexOf('const runBackup = useCallback('), hook.indexOf('const signOut = useCallback('));
      // Nor while the switch question (confirm_upload) is open.
      assert.match(backup, /if \(pendingRestoreRef\.current \|\| pendingUploadRef\.current\) \{\s*return \{ kind: 'failed' \};/);
      // What a backup may do — look first when the copy is unseen, of unknown
      // size, or about to shrink; ask the reader, or hold when unattended — is
      // decided in lib/accountBackup (planBackup, decideAfterLook; pinned in
      // tests/lib/accountBackup) and run in tests/features/account.
      // Both stores are counted, database and workout history: the history
      // is set aside on its own when it cannot be read, and counting the
      // database alone let its empty stand-in replace the cloud copy
      // (persistence audit, 2026-09-20).
      assert.match(backup, /const plan = planBackup\(\{\s*interactive,\s*sync: current,\s*local: countBackup\(latestRef\.current\.database, latestRef\.current\.workoutHistory\),\s*\}\);\s*if \(plan === 'skip'\) \{[\s\S]*?return \{ kind: 'failed' \};/);
      // The look also asks whether the copy is this phone's own: another
      // phone's copy is asked about, never overwritten (server audit,
      // 2026-09-21; run in tests/features/account).
      assert.match(backup, /local: countBackup\(latestRef\.current\.database, latestRef\.current\.workoutHistory\),\s*unseen: remote\.ok && !isCloudCopyThisPhones\(current, remote\),\s*\}\);\s*if \(decision === 'gone'\) \{\s*return await copyWasDeleted\(idToken, current, interactive, generation\);\s*\}\s*if \(decision === 'settle'\)/);
      assert.match(backup, /if \(decision === 'settle'\) \{\s*return await settleWithRemote\(idToken, current, remote, generation\);/);
      assert.match(backup, /if \(decision === 'ask' && remote\.ok\) \{\s*return await askRestoreOrKeep\(idToken, current, remote\.payload, remote\.version, generation\);/);
      assert.match(hook, /const running = runBackup\(false\)\.then\(\(outcome\) => outcome\.kind === 'backed_up'\);/);
      assert.match(hook, /const backUpOrAsk = useCallback\(\(\) => runBackup\(true\)/);
      // Sign-in settles through the same function, so the two cannot drift.
      const signIn = hook.slice(hook.indexOf('const signIn = useCallback('), hook.indexOf('const resolveRestoreChoice = useCallback('));
      assert.match(signIn, /return await settleWithRemote\(result\.account\.idToken, base, remote, generation\);/);

      // And the Settings row is wired to the asking path, through the same presenter as sign-in.
      const shell = code(readShell());
      assert.match(shell, /presentAccountOutcome\(await accountBackup\.backUpOrAsk\(\), 'account\.backupFailed'\)/);
      assert.match(shell, /presentAccountOutcome\(await accountBackup\.signIn\(provider\), 'account\.signInFailed'\)/);
      assert.match(code(read('src', 'app', 'renderProfileTab.tsx')), /onBackupNow: \(\) => void handleAccountBackupNow\(\)/);

      // The automatic path goes through the same planner: it runs backupNow,
      // which is runBackup(false), and only when the data differs.
      assert.match(hook, /if \(current\.lastBackupFingerprint === accountBackupFingerprint\(database, workoutHistory\)\) \{\s*return;\s*\}\s*void backupNowRef\.current\(\);/);
      // Every count the account keeps is taken the one way, both stores at
      // once (syncCounts of countBackup), so the stored size and the local
      // one it is compared with cannot be counted differently.
      assert.match(hook, /\.\.\.syncCounts\(countBackup\(database, workoutHistory\)\)/);
      assert.match(hook, /\.\.\.syncCounts\(countBackup\(payload\.database, payload\.workoutHistory\)\)/);
      assert.doesNotMatch(hook, /lastBackupItemCount: countBackupItems\(/, 'a count taken of the database alone');

      // A restore the disk refuses is reported, on both paths, not swallowed.
      const restoreBranch = resolve.slice(resolve.indexOf("if (choice === 'restore')"));
      assert.match(restoreBranch, /catch \(error\) \{[\s\S]*?return error instanceof RestoreHalfApplied \? 'incomplete' : 'failed';/);
      const settle = hook.slice(hook.indexOf('const settleWithRemote = useCallback('), hook.indexOf('const signIn = useCallback('));
      assert.match(settle, /try \{\s*fingerprint = await applyRestore\(remote\.payload, generation\);\s*\} catch \(error\) \{[\s\S]*?return \{ kind: error instanceof RestoreHalfApplied \? 'restore_incomplete' : 'restore_failed' \};/);
      const presenter = code(readShell());
      // The reader's own "use the backup": a refused write is said. A landed one is not — the
      // history on screen and the row's timestamp say it (#bugs 2026-10-03).
      assert.match(
        presenter,
        /resolveRestoreChoice\('restore'\)\.then\(\(result\) => \{[\s\S]*?\} else if \(result === 'failed'\) \{\s*showToast\(t\(language, 'account\.restore\.failed'\)\);/,
      );
      assert.doesNotMatch(presenter, /account\.restore\.restored/, 'a success bar over the restored history');
      assert.match(presenter, /if \(outcome\.kind === 'restore_failed'\) \{\s*showToast\(t\(language, 'account\.restore\.failed'\)\);/);
    },
  },
  {
    name: 'writesWaitForLoad: only a missing blob is "no backup"',
    run() {
      const api = code(read('api', 'backup.ts'));
      const get = api.slice(api.indexOf("if (req.method === 'GET')"), api.indexOf("if (req.method === 'DELETE')"));
      const failure = get.slice(get.indexOf('catch'), get.indexOf('if (!stored'));
      assert.match(failure, /res\.status\(502\)/);
      assert.doesNotMatch(failure, /stored = null|NO_BACKUP/, 'a store error answered as NO_BACKUP makes the app upload over the backup');

      const client = code(read('src', 'features', 'account', 'backupApi.ts'));
      assert.match(client, /if \(response\.status === 404 && body\.error === 'NO_BACKUP'\)/);
    },
  },
  {
    name: 'writesWaitForLoad: leaving a free workout with logged sets asks first, from the chevron and from back',
    run() {
      const screen = code(read('src', 'screens', 'EmptyWorkoutScreen.tsx'));
      assert.match(screen, /accessibilityLabel=\{t\(language, 'emptyWorkout\.a11y\.back'\)\} onPress=\{requestLeave\}/);
      assert.doesNotMatch(screen, /onPress=\{onBack\}/);
      assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress'/);
      const requestStart = screen.indexOf('const requestLeave = () => {');
      const request = screen.slice(requestStart, screen.indexOf('BackHandler.addEventListener', requestStart));
      assert.ok(request.indexOf('setConfirmingLeave(true)') < request.indexOf('onBack()'), 'with sets logged, the question comes before leaving');
      // Typed-but-unticked sets are lost the same way, so they ask too
      // (2026-09-16) — from the chevron and from hardware back alike.
      assert.match(screen, /const hasUnsavedWork = unsavedWork\.doneSets > 0 \|\| unsavedWork\.enteredSets > 0;/);
      assert.match(request, /if \(hasUnsavedWork\) \{\s*setConfirmingLeave\(true\);/);
      // One listener, registered always. This asserted the opposite — no
      // listener unless there was something to lose — which left the empty
      // board's back press to the app's route handling, so it kept a draft
      // the chevron in that same state discarded (CI review of #162). Back
      // still asks whenever the chevron would.
      assert.match(
        screen,
        /const subscription = BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*const guard = leaveGuardRef\.current;/,
      );
      const listener = screen.slice(screen.indexOf("BackHandler.addEventListener('hardwareBackPress'"));
      assert.match(listener, /if \(guard\.hasUnsavedWork\) \{\s*setConfirmingLeave\(true\);\s*return true;/, 'back asks whenever the chevron would');
      assert.doesNotMatch(screen, /if \(!hasUnsavedWork\) \{\s*return undefined;/, 'nothing left to lose is still a leave, and it discards');
      assert.match(screen, /<ConfirmDialog[\s\S]*?visible=\{confirmingLeave\}/);
    },
  },
];
