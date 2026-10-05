const assert = require('node:assert/strict');
const path = require('node:path');

const { createClock, createHookRuntime, deferred, flush, requireWithStubs } = require('../../helpers/hookHarness.cjs');

const DIST = path.join(__dirname, '..', '..', '..', '.test-dist');
const HOOK = path.join(DIST, 'features', 'account', 'useAccountBackup.js');
const GOOGLE_AUTH = path.join(DIST, 'features', 'account', 'googleAuth.js');
const lib = require(path.join(DIST, 'lib', 'accountBackup.js'));
const { normalizeStoredAccount } = requireWithStubs(path.join(DIST, 'features', 'account', 'accountStore.js'), {
  '@react-native-async-storage/async-storage': { __esModule: true, default: {} },
});
const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));

/**
 * The account hook, run.
 *
 * Audit round 2 (2026-09-16) found the cloud backup losing and misreporting
 * data in ways that only show in order: an upload finishing after sign-out,
 * a failed upload never retried, a delete undone by the next weigh-in. These
 * drive the compiled hook through a small React stand-in
 * (tests/helpers/hookHarness) with Google, the server, the account store,
 * the clock and AppState replaced by fakes the test controls.
 */

const QUIET_MS = 8000;

function database(overrides = {}) {
  const base = createEmptyDatabase('fi');
  return {
    ...base,
    exerciseLibrary: [],
    ...overrides,
    preferences: { ...base.preferences, ...(overrides.preferences ?? {}) },
  };
}

const workout = (id, extra = {}) => ({
  id,
  workoutTemplateId: 'tpl_x',
  workoutNameSnapshot: 'Push',
  performedAt: '2026-09-01T10:00:00.000Z',
  ...extra,
});
const workouts = (count) => Array.from({ length: count }, (_, index) => workout(`w${index}`));
const emptyHistory = () => ({ sessions: [], slotHistory: {}, lastSelectedTemplateId: null });
const cloudCopy = (db) => JSON.parse(JSON.stringify(lib.buildAccountBackupPayload(db, emptyHistory(), '2026-09-10T08:00:00.000Z')));

function syncedAccount(local, extra = {}) {
  return {
    sub: 'sub-1',
    email: 'reader@example.com',
    name: 'Reader',
    lastBackupAt: '2026-09-10T08:00:00.000Z',
    lastBackupItemCount: lib.countBackupItems(local),
    // The copy these accounts made carries an empty history.
    lastBackupHistoryCount: 0,
    lastBackupFingerprint: lib.accountBackupFingerprint(local, emptyHistory()),
    autoBackupPaused: false,
    // The version the fake server gives the copy it starts with.
    cloudVersion: 'v1',
    ...extra,
  };
}

/**
 * The server's copy, versioned the way api/backup.ts versions it: every write
 * — this phone's upload, or a test standing in for another phone — is a new
 * version, and a delete leaves none.
 */
function versionedStore(initial) {
  let blob = initial;
  let version = initial ? 'v1' : null;
  let written = 1;
  return {
    get blob() {
      return blob;
    },
    set blob(next) {
      blob = next;
      written += 1;
      version = next ? `v${written}` : null;
    },
    get version() {
      return version;
    },
  };
}

async function withHook({ local, stored = null, cloud = null }, scenario) {
  const clock = createClock();
  const runtime = createHookRuntime();
  const listeners = new Set();
  const calls = { upload: 0, download: 0, delete: 0, deleteOptions: [], signedOut: 0, restoreDatabase: 0, restoreHistory: 0, restored: 0, expected: [] };
  const server = Object.assign(versionedStore(cloud), { uploadError: null, downloadError: null, deleteOk: true, deleteError: null, deleteLost: false, gates: {} });
  const google = {
    silent: { status: 'ok', idToken: 'token' },
    signIn: { status: 'signed_in', account: { sub: 'sub-1', email: 'reader@example.com', name: 'Reader', idToken: 'token' } },
  };
  const store = { account: stored };
  const app = { database: local, history: emptyHistory(), historyWriteError: null, gates: {}, hydrated: true, liveSession: false };
  const pass = async (gates, name) => {
    if (gates[name]) {
      await gates[name].promise;
    }
  };

  const { useAccountBackup } = requireWithStubs(HOOK, {
    react: runtime.react,
    'react-native': {
      AppState: {
        addEventListener(_type, listener) {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      },
    },
    './backupApi': {
      isBackupApiConfigured: () => true,
      BACKUP_CHANGED: 'BACKUP_CHANGED',
      async uploadBackup(_token, payload, expected) {
        calls.upload += 1;
        calls.expected.push(expected);
        await pass(server.gates, 'upload');
        if (server.uploadError) {
          return { ok: false, error: server.uploadError };
        }
        // As the endpoint answers: no expectation at all is a build from
        // before versions and overwrites; null is "onto no copy"; a version
        // must be the copy that is there.
        const refused = expected === undefined ? false : expected === null ? server.blob !== null : expected !== server.version;
        if (refused) {
          return { ok: false, error: 'BACKUP_CHANGED' };
        }
        server.blob = JSON.parse(JSON.stringify(payload));
        return { ok: true, savedAt: '2026-09-17T12:00:00.000Z', version: server.version };
      },
      async downloadBackup() {
        calls.download += 1;
        await pass(server.gates, 'download');
        if (server.downloadError) {
          return { ok: false, error: server.downloadError };
        }
        return server.blob ? { ok: true, payload: server.blob, version: server.version } : { ok: false, error: 'NO_BACKUP' };
      },
      async deleteBackup(_token, options) {
        calls.delete += 1;
        calls.deleteOptions.push(options);
        await pass(server.gates, 'delete');
        if (server.deleteError) {
          // 4xx answers settle the request; a 5xx (STORE_UNAVAILABLE…) does not — api/backup.ts.
          return { ok: false, error: server.deleteError, definite: ['INVALID_TOKEN', 'SESSION_REVOKED', 'SESSION_EXPIRED'].includes(server.deleteError) };
        }
        if (server.deleteLost) {
          // The server did it; the answer never reached the phone.
          server.blob = null;
          return { ok: false };
        }
        if (!server.deleteOk) {
          return { ok: false };
        }
        server.blob = null;
        return { ok: true };
      },
    },
    './accountAuth': {
      availableSignInProviders: () => ['google'],
      isAccountSignInConfigured: () => true,
      signInWith: async () => google.signIn,
      getFreshIdToken: async () => google.silent,
      renewSessionIfDue: async () => undefined,
      signOutAccount: async () => {
        calls.signedOut += 1;
      },
    },
    './accountStore': {
      loadStoredAccount: async () => store.account,
      saveStoredAccount: async (account) => {
        store.account = account;
      },
      clearStoredAccount: async () => {
        store.account = null;
      },
      rememberSignedOutAccount: async (sub) => {
        store.signedOut = [...new Set([...(store.signedOut ?? []), sub])];
      },
      loadSignedOutAccounts: async () => store.signedOut ?? [],
      forgetSignedOutAccount: async () => {
        store.signedOut = [];
      },
    },
  });

  const props = () => ({
    hydrated: app.hydrated,
    liveSession: app.liveSession,
    database: app.database,
    workoutHistory: app.history,
    async restoreDatabase(input) {
      calls.restoreDatabase += 1;
      await pass(app.gates, 'database');
      app.database = { ...input, exerciseLibrary: [] };
      return app.database;
    },
    async restoreWorkoutHistory(history) {
      calls.restoreHistory += 1;
      await pass(app.gates, 'history');
      if (app.historyWriteError) {
        throw app.historyWriteError;
      }
      app.history = history;
      return history;
    },
    async onRestored() {
      calls.restored += 1;
      // A gate lets a test hold this open — proving the restore waits for it
      // — and an injected error lets a test prove that failure never reaches
      // the reader as a failed restore.
      await pass(app.gates, 'restored');
      if (app.restoredError) {
        throw app.restoredError;
      }
    },
  });

  const env = {
    calls,
    server,
    google,
    store,
    app,
    api: null,
    render() {
      env.api = runtime.render(useAccountBackup, props());
      return env.api;
    },
    async settle() {
      for (let round = 0; round < 4; round += 1) {
        await flush();
        env.render();
      }
    },
    async advance(ms) {
      clock.advance(ms);
      await env.settle();
    },
    async foreground() {
      for (const listener of [...listeners]) {
        listener('background');
        listener('active');
      }
      await env.settle();
    },
    async edit(change) {
      app.database = change(app.database);
      await env.settle();
    },
  };

  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  global.setTimeout = clock.setTimeout;
  global.clearTimeout = clock.clearTimeout;
  try {
    env.render();
    await env.settle();
    await scenario(env);
  } finally {
    runtime.unmount();
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

/** Signs in as A, backs up, signs out, and hands Google account B with no copy. */
async function switchToNewAccount(env) {
  assert.equal((await env.api.signIn()).kind, 'backed_up');
  await env.api.signOut();
  assert.deepEqual(env.store.signedOut, ['sub-1'], 'sign-out forgot whose data stayed on the phone');
  env.server.blob = null; // B's storage: never backed up
  env.google.signIn = { status: 'signed_in', account: { sub: 'sub-2', email: 'other@example.com', name: 'Other', idToken: 'token-b' } };
  return env.calls.upload;
}

module.exports = [
  {
    // Break round, 2026-09-28 (user decision: ask). Sign-out keeps the data;
    // the next account used to get all of it as its first backup, unasked.
    name: 'account hook: another account signing in is asked before this phone\'s data becomes its backup, and "not now" sends nothing',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(50) }) }, async (env) => {
        const uploadsBefore = await switchToNewAccount(env);
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'confirm_upload');
        assert.equal(outcome.email, 'other@example.com');
        assert.equal(outcome.local.workoutCount, 50);
        assert.equal(env.calls.upload, uploadsBefore, 'uploaded before the reader answered');
        assert.equal(env.store.account.sub, 'sub-2', 'not signed in while asked');
        assert.equal(env.store.account.autoBackupPaused, true);

        // The automatic backup does not answer for the reader.
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('new')] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, uploadsBefore, 'the automatic backup sent it while the question was open');

        assert.equal(await env.api.resolveUploadChoice('skip'), 'done');
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, uploadsBefore, '"not now" still sent it');
        assert.equal(env.server.blob, null);
        assert.equal(env.store.account.autoBackupPaused, true);
        // Recheck of #221: "Not now" forgot the mark, and the next "Back up
        // now" sent A's log to B unasked. The mark stays; the reader's own
        // backup asks again, and nothing is sent until "Back it up".
        assert.deepEqual(env.store.signedOut, ['sub-1'], '"not now" forgot whose data it is');
        assert.equal((await env.api.backUpOrAsk()).kind, 'confirm_upload', '"Back up now" after "not now" did not ask');
        assert.equal(env.calls.upload, uploadsBefore, '"Back up now" after "not now" sent it unasked');
        assert.equal(await env.api.resolveUploadChoice('upload'), 'done');
        assert.equal(env.calls.upload, uploadsBefore + 1);
        assert.deepEqual(env.store.signedOut, [], 'a landed yes did not settle it');
      });
    },
  },
  {
    // Review of the fix: B signed out before answering (a relaunch drops the
    // question), the mark became B, and B signing back in sent A's log unasked.
    name: 'account hook: signing out with the switch question unanswered keeps whose data it is, and B is asked again',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(5) }) }, async (env) => {
        const uploadsBefore = await switchToNewAccount(env);
        assert.equal((await env.api.signIn()).kind, 'confirm_upload');
        await env.api.signOut();
        // Both are remembered: A's data is still here, and B's may be too.
        assert.deepEqual(env.store.signedOut, ['sub-1', 'sub-2'], 'the unanswered account replaced the earlier one');
        assert.equal((await env.api.signIn()).kind, 'confirm_upload', 'B signed back in and was not asked');
        assert.equal(env.calls.upload, uploadsBefore);
      });
    },
  },
  {
    // CI review of #221: sign-in could not reach the server, so it could not
    // ask; the automatic retry found no copy and uploaded A's log to B.
    name: 'account hook: a switch signed in offline is not backed up unattended once the network returns, and "Back up now" asks',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(4) }) }, async (env) => {
        const uploadsBefore = await switchToNewAccount(env);
        env.server.downloadError = 'NETWORK';
        assert.equal((await env.api.signIn()).kind, 'not_backed_up');
        env.server.downloadError = null;

        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('later')] }));
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, uploadsBefore, "the automatic backup sent the other account's log");
        assert.equal(env.store.account.autoBackupPaused, true);

        assert.equal((await env.api.backUpOrAsk()).kind, 'confirm_upload');
        assert.equal(env.calls.upload, uploadsBefore);
      });
    },
  },
  {
    // Recheck of #221 (user decision 2026-09-28): B already had its own
    // backup, the restore-or-keep question showed bare counts, and "use the
    // phone's data" replaced B's own copy with A's log.
    name: 'account hook: restore-or-keep says the phone\'s data is another account\'s, and the mark stays until the answer lands',
    async run() {
      const { restoreQuestionCopy } = require(path.join(DIST, 'lib', 'accountBackupCopy.js'));
      await withHook({ local: database({ workoutSessions: workouts(50) }) }, async (env) => {
        await switchToNewAccount(env);
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(2) }));
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice');
        assert.equal(outcome.summary.localFromOtherAccount, true);
        assert.deepEqual(env.store.signedOut, ['sub-1'], 'the mark went before the answer');

        const copy = restoreQuestionCopy(outcome.summary, 'fi');
        assert.equal(copy.title, 'Puhelimessa on toisen tilin tiedot');
        assert.match(copy.body, /kirjattiin, kun puhelimessa oli kirjautuneena toinen tili/);
        assert.equal(copy.useBackup, 'Palauta oma varmuuskopioni');
        // Always asked twice, however the counts compare.
        assert.ok(copy.replace, 'keeping another account\'s data over your own backup was asked once');
        assert.equal(copy.replace.title, 'Korvataanko oma varmuuskopiosi?');

        assert.equal(await env.api.resolveRestoreChoice('restore'), 'done');
        assert.deepEqual(env.store.signedOut, [], 'a landed restore did not settle it');
      });

      // The same account's own data on both sides is the ordinary question.
      await withHook({ local: database({ workoutSessions: workouts(3) }), cloud: cloudCopy(database({ workoutSessions: workouts(2) })) }, async (env) => {
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice');
        assert.equal(outcome.summary.localFromOtherAccount, false);
        assert.equal(restoreQuestionCopy(outcome.summary, 'fi').title, 'Varmuuskopio löytyi');
      });
    },
  },
  {
    // Third break round, 2026-09-28: A's own log, adopted by B ("use the
    // phone's data"), was flagged "another account's data" when A signed back
    // in — the list says who left, not whose the rows are.
    name: 'account hook: an account whose own copy already holds every row on the phone is not told the data is someone else\'s',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(5) }) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'backed_up');
        const aCopy = env.server.blob;
        await env.api.signOut();

        env.server.blob = cloudCopy(database({ workoutSessions: [workout('b-own')] }));
        env.google.signIn = { status: 'signed_in', account: { sub: 'sub-2', email: 'other@example.com', name: 'Other', idToken: 'token-b' } };
        const atB = await env.api.signIn();
        assert.equal(atB.kind, 'choice');
        assert.equal(atB.summary.localFromOtherAccount, true, 'B was not told the phone\'s data is someone else\'s');
        assert.equal(await env.api.resolveRestoreChoice('keep_local'), 'done');
        await env.api.signOut();

        env.server.blob = aCopy;
        env.google.signIn = { status: 'signed_in', account: { sub: 'sub-1', email: 'reader@example.com', name: 'Reader', idToken: 'token' } };
        const back = await env.api.signIn();
        // Both sides hold data, so A is asked — the ordinary question.
        assert.equal(back.kind, 'choice');
        assert.equal(back.summary.localFromOtherAccount, false, 'A\'s own log was called another account\'s');
        // A phone holding a row A's copy lacks is still someone else's.
        const { phoneDataIsInCopy } = lib;
        assert.equal(phoneDataIsInCopy(database({ workoutSessions: workouts(2) }), aCopy.database), true);
        assert.equal(phoneDataIsInCopy(database({ workoutSessions: [workout('b-new')] }), aCopy.database), false);
        assert.equal(phoneDataIsInCopy(database({ workoutSessions: workouts(1) }), null), false);
        // Review of the fix: a programme or a workout in progress is data
        // too — no logged rows is not "all in the copy".
        const ownProgramme = { id: 'tpl-mine', name: 'Mine', exerciseIds: [], sessions: [], createdAt: 't', updatedAt: 't', origin: 'authored' };
        assert.equal(phoneDataIsInCopy(database({ workoutTemplates: [ownProgramme] }), aCopy.database), false);
        assert.equal(phoneDataIsInCopy(database({ workoutPlans: [{ id: 'plan-mine', name: 'Mine', entries: [] }] }), aCopy.database), false);
        assert.equal(phoneDataIsInCopy(database(), aCopy.database, true), false, 'a workout in progress passed as the copy\'s');
      });
    },
  },
  {
    // Review of the invariant fix: an unattended first upload that needed no
    // yes left the signed-out list standing, to ask the next account about
    // data that was no longer anyone else's.
    name: 'account hook: an unattended first backup that needed no yes settles the signed-out list',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(3) }) }, async (env) => {
        env.store.signedOut = ['sub-1'];
        env.server.downloadError = 'NETWORK';
        assert.equal((await env.api.signIn()).kind, 'not_backed_up');
        env.server.downloadError = null;
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.ok(env.server.blob, 'the automatic backup never ran');
        assert.deepEqual(env.store.signedOut, [], 'a landed unattended backup left the list standing');
      });
    },
  },
  {
    name: 'account hook: "back it up" on the switch question uploads to the new account and lifts the hold',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(3) }) }, async (env) => {
        const uploadsBefore = await switchToNewAccount(env);
        assert.equal((await env.api.signIn()).kind, 'confirm_upload');
        assert.equal(await env.api.resolveUploadChoice('upload'), 'done');
        assert.equal(env.calls.upload, uploadsBefore + 1);
        assert.equal(env.server.blob.database.workoutSessions.length, 3);
        assert.equal(env.store.account.autoBackupPaused, false);
      });
    },
  },
  {
    name: 'account hook: the same account signing back in is not asked, nor is a phone never signed in before',
    async run() {
      await withHook({ local: database({ workoutSessions: workouts(3) }) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'backed_up', 'a first-ever sign-in was asked');
        await env.api.signOut();
        env.server.blob = null;
        assert.equal((await env.api.signIn()).kind, 'backed_up', 'the same account was asked about its own data');
      });
    },
  },
  {
    name: 'account hook: a phone holding only what setup wrote restores the cloud copy without asking',
    async run() {
      const setupOnly = database({
        preferences: { setupCurrentWeightKg: 82 },
        workoutTemplates: [{ id: 'workout_a', name: 'Mine', exerciseIds: [], sessions: [], createdAt: 't', updatedAt: 't', origin: 'authored' }],
        workoutPlans: [{ id: 'onboarding_plan_workout_a', name: 'Mine', entries: [{}] }],
        bodyweightEntries: [{ id: 'bw', recordedAt: '2026-09-17T08:00:00.000Z', weight: 82 }],
      });
      const cloud = cloudCopy(database({ workoutSessions: workouts(5) }));
      await withHook({ local: setupOnly, cloud }, async (env) => {
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'restored', 'a new phone was asked restore-or-keep over what setup made');
        assert.equal(env.calls.restoreDatabase, 1);
        assert.equal(env.store.account.lastBackupAt, cloud.exportedAt);
        // What was restored is the cloud copy: it is not uploaded straight back.
        await env.settle();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 0);
      });
    },
  },
  {
    name: 'account hook: signing in mid-workout asks before a restore puts the workout away',
    async run() {
      const cloud = cloudCopy(database({ workoutSessions: workouts(5) }));
      await withHook({ local: database(), cloud }, async (env) => {
        env.app.liveSession = true;
        await env.settle();
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice', 'the workout in progress was restored over without asking');
        assert.equal(env.calls.restoreDatabase + env.calls.restoreHistory, 0);
        assert.equal(outcome.summary.local.workoutInProgress, true);
      });
    },
  },
  {
    name: 'account hook: a workout history set aside as unreadable is not backed up over the cloud copy of it',
    async run() {
      // The workout store's loader puts an unreadable bundle away and opens
      // on an empty history. The database is whole, so the guard that
      // counted only the database saw nothing shrink, the fingerprint moved,
      // and eight seconds later the empty history replaced the only copy of
      // every lift's "last time" (persistence audit, 2026-09-20).
      const local = database({ workoutSessions: workouts(4) });
      const history = {
        sessions: Array.from({ length: 20 }, (_, index) => ({ sessionId: `h${index}`, templateId: 'tpl_x', templateName: 'Push', performedAt: '2026-09-01T10:00:00.000Z' })),
        slotHistory: { 'tpl_x:s1:bench': Array.from({ length: 10 }, (_, index) => ({ slotId: 'tpl_x:s1:bench', sessionId: `h${index}`, sets: [] })) },
        lastSelectedTemplateId: 'tpl_x',
      };
      const cloud = JSON.parse(JSON.stringify(lib.buildAccountBackupPayload(local, history, '2026-09-10T08:00:00.000Z')));
      const madeWithHistory = { lastBackupFingerprint: lib.accountBackupFingerprint(local, history) };

      await withHook({ local, stored: syncedAccount(local, { ...madeWithHistory, lastBackupHistoryCount: 30 }), cloud }, async (env) => {
        assert.deepEqual(env.app.history.sessions, [], 'the phone should open on the empty history the loader hands over');
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 0, 'the empty history replaced the cloud copy of it');
        assert.equal(env.server.blob.workoutHistory.sessions.length, 20);
        // "Back up now" is the reader's decision, and it is asked twice.
        const outcome = await env.api.backUpOrAsk();
        assert.equal(outcome.kind, 'choice');
        assert.equal(outcome.summary.keepingLocalShrinksCloud, true, '"Use the data on this phone" was not asked a second time');
        assert.equal(env.calls.upload, 0);
      });

      // An account stored before the history was counted looks at the copy
      // once, stays out, and learns the size for next time.
      await withHook({ local, stored: syncedAccount(local, { ...madeWithHistory, lastBackupHistoryCount: null }), cloud }, async (env) => {
        await env.advance(QUIET_MS);
        assert.equal(env.calls.download, 1, 'an account with no history count uploaded without looking');
        assert.equal(env.calls.upload, 0);
        assert.equal(env.store.account.lastBackupHistoryCount, 30);
      });

      // A history that is all there backs up as before.
      await withHook({ local, stored: syncedAccount(local, { ...madeWithHistory, lastBackupHistoryCount: 30 }), cloud }, async (env) => {
        env.app.history = { ...history, sessions: [{ sessionId: 'h20', templateId: 'tpl_x', templateName: 'Push', performedAt: '2026-09-11T10:00:00.000Z' }, ...history.sessions] };
        await env.settle();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);
        assert.equal(env.store.account.lastBackupHistoryCount, 31);
      });
    },
  },
  {
    name: 'account hook: a phone running an adopted ready programme is asked, not restored over',
    async run() {
      const readyPlan = { id: 'ready_plan_tpl_gainer_x', name: 'X', entries: [{ workoutTemplateId: 'tpl_gainer_x' }] };
      const adopted = database({
        workoutPlans: [readyPlan],
        preferences: { activePlanId: readyPlan.id, activePlanIds: [readyPlan.id] },
      });
      await withHook({ local: adopted, cloud: cloudCopy(database({ workoutSessions: workouts(5) })) }, async (env) => {
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice', 'the adopted programme was replaced without asking');
        assert.equal(env.calls.restoreDatabase, 0);
        assert.equal(outcome.summary.local.readyProgramCount, 1);
      });
    },
  },
  {
    name: 'account hook: a restore after a delete turns the automatic backup back on',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      // Asked, then restored.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        assert.equal(await env.api.deleteRemoteBackup(), 'done');
        assert.equal(env.store.account.autoBackupPaused, true);
        // Another phone on the account writes a copy; this one restores it.
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(6) }));
        await env.settle();
        assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
        await env.settle();
        assert.equal(await env.api.resolveRestoreChoice('restore'), 'done');
        assert.equal(env.store.account.autoBackupPaused, false, 'the row showed a fresh backup while backups stayed off');
        await env.settle();
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna' } }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);
      });
      // Restored without asking (this phone was empty).
      const paused = syncedAccount(database(), { lastBackupAt: null, lastBackupItemCount: null, lastBackupFingerprint: null, autoBackupPaused: true });
      await withHook({ local: database(), stored: paused, cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        assert.equal((await env.api.backUpOrAsk()).kind, 'restored');
        assert.equal(env.store.account.autoBackupPaused, false);
      });
    },
  },
  {
    name: 'account hook: a restore that fails after Reset does not write the old database back',
    async run() {
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        env.app.gates.history = deferred();
        env.app.historyWriteError = new Error('database or disk is full');
        const pending = env.api.signIn();
        await env.settle();
        assert.equal(env.calls.restoreHistory, 1);
        // Reset: signs out, then wipes.
        await env.api.signOut();
        env.app.database = database();
        env.app.gates.history.resolve();
        const originalError = console.error;
        console.error = () => undefined;
        try {
          assert.equal((await pending).kind, 'cancelled');
        } finally {
          console.error = originalError;
        }
        assert.equal(env.calls.restoreDatabase, 1, 'the rollback wrote the pre-restore database over the reset');
        assert.equal(env.store.account, null);
      });
    },
  },
  {
    name: 'account hook: nothing is backed up until the workout store has loaded too',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      const loaded = {
        sessions: [{ sessionId: 'a', templateId: 'tpl_x', templateSessionId: null, templateName: 'Push', performedAt: '2026-09-01T10:00:00.000Z' }],
        slotHistory: {},
        lastSelectedTemplateId: 'tpl_x',
      };
      await withHook({ local, stored: syncedAccount(local, { lastBackupFingerprint: null }), cloud: cloudCopy(local) }, async (env) => {
        // The database is in; the player's store is still loading (or on its
        // Retry screen), holding the empty history it starts with.
        env.app.hydrated = false;
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna' } }));
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 0, 'an empty history was uploaded before the real one loaded');

        env.app.history = loaded;
        env.app.hydrated = true;
        await env.settle();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);
        assert.equal(env.server.blob.workoutHistory.sessions.length, 1);
      });
    },
  },
  {
    name: 'account hook: restore-or-keep shows both sides, and says when keeping this phone shrinks the cloud copy',
    async run() {
      const local = database({
        workoutSessions: [workout('mine')],
        workoutTemplates: [{ id: 'tpl_mine', name: 'Mine', exerciseIds: [], sessions: [], createdAt: 'a', updatedAt: 'b', origin: 'authored' }],
      });
      await withHook({ local, cloud: cloudCopy(database({ workoutSessions: workouts(10) })) }, async (env) => {
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice');
        assert.equal(outcome.summary.local.workoutCount, 1);
        assert.equal(outcome.summary.local.customProgramCount, 1);
        assert.equal(outcome.summary.local.workoutInProgress, false);
        assert.equal(outcome.summary.cloud.workoutCount, 10);
        assert.equal(outcome.summary.keepingLocalShrinksCloud, true);
        // Nothing is written while the question is open.
        assert.equal(env.calls.upload, 0);
        await env.settle();
        assert.equal(await env.api.resolveRestoreChoice('keep_local'), 'done');
        assert.equal(env.server.blob.database.workoutSessions.length, 1);
      });
      const bigger = database({ workoutSessions: workouts(8) });
      await withHook({ local: bigger, cloud: cloudCopy(database({ workoutSessions: workouts(10) })) }, async (env) => {
        const outcome = await env.api.signIn();
        assert.equal(outcome.kind, 'choice');
        assert.equal(outcome.summary.keepingLocalShrinksCloud, false, 'eight of ten is a reader tidying, not a loss');
      });
    },
  },
  {
    name: 'account hook: offline keeps the reader signed in; only Google having no credential signs them out',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      await withHook({ local, stored: syncedAccount(local, { lastBackupFingerprint: null }), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = { status: 'error' };
        assert.equal((await env.api.backUpOrAsk()).kind, 'failed');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in', 'being offline signed the reader out');
        assert.notEqual(env.store.account, null);

        env.google.silent = { status: 'signed_out' };
        assert.equal((await env.api.backUpOrAsk()).kind, 'ended');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.store.account, null);
      });
    },
  },
  {
    name: 'account hook: an edit reaches the cloud copy, and a failed upload is tried again when the app returns',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 0, 'unchanged data was uploaded');

        // A corrected workout: no count moves.
        await env.edit((db) => ({ ...db, workoutSessions: [workout('a', { sessionNotes: 'felt heavy' })] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1, 'an edited workout never reached the cloud copy');
        assert.equal(env.store.account.lastBackupFingerprint, lib.accountBackupFingerprint(env.app.database, env.app.history));

        // A setting, and this time the network is down.
        env.server.uploadError = 'NETWORK';
        const before = env.store.account.lastBackupFingerprint;
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna' } }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 2);
        assert.equal(env.store.account.lastBackupFingerprint, before, 'a failed upload was marked as done');
        // No retry loop while offline.
        await env.advance(QUIET_MS);
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 2);

        env.server.uploadError = null;
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 3, 'coming back to the app did not retry');
        assert.equal(env.server.blob.database.preferences.profileName, 'Sanna');
        assert.notEqual(env.store.account.lastBackupFingerprint, before);
      });
    },
  },
  {
    name: 'account hook: "Back up now" on a phone holding far less than the cloud asks instead of overwriting',
    async run() {
      const full = database({ workoutSessions: workouts(40) });
      const emptied = database();
      await withHook({ local: emptied, stored: syncedAccount(full, { lastBackupFingerprint: null }), cloud: cloudCopy(full) }, async (env) => {
        // Unattended, it does not even look.
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.download + env.calls.upload, 0);

        const outcome = await env.api.backUpOrAsk();
        assert.equal(outcome.kind, 'choice', 'the one good copy was overwritten by an emptied phone');
        assert.equal(env.calls.upload, 0);
        assert.equal(outcome.summary.cloud.workoutCount, 40);
        assert.equal(outcome.summary.local.workoutCount, 0);
        assert.equal(outcome.summary.keepingLocalShrinksCloud, true);
        await env.settle();
        assert.equal(await env.api.resolveRestoreChoice('restore'), 'done');
        assert.equal(env.app.database.workoutSessions.length, 40);
      });
      // A copy whose size this phone never learned is read first too.
      await withHook(
        { local: database({ workoutSessions: [workout('a')] }), stored: syncedAccount(full, { lastBackupItemCount: null }), cloud: cloudCopy(full) },
        async (env) => {
          assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
          assert.equal(env.calls.upload, 0);
        },
      );
    },
  },
  {
    name: 'account hook: deleting the cloud copy holds a phase, says when it failed, and keeps the automatic backup away',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.gates.delete = deferred();
        const pending = env.api.deleteRemoteBackup();
        await env.settle();
        assert.equal(env.api.phase, 'deleting', 'Sign out stayed enabled while the delete ran');
        env.server.gates.delete.resolve();
        assert.equal(await pending, 'done');
        await env.settle();
        assert.equal(env.api.state.lastBackupAt, null);
        assert.equal(env.api.phase, 'idle');

        // The next weigh-in does not write the history back.
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload + env.calls.download, 0, 'the delete was undone by the automatic backup');
        assert.equal(env.server.blob, null);

        // The reader's own backup starts it again.
        assert.equal((await env.api.backUpOrAsk()).kind, 'backed_up');
        assert.equal(env.store.account.autoBackupPaused, false);
      });
      // An automatic upload already on its way when Delete is confirmed: the
      // delete waits for it, or the upload lands after it and brings the copy back.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.gates.upload = deferred();
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);
        const pending = env.api.deleteRemoteBackup();
        await flush();
        assert.equal(env.calls.delete, 0, 'the delete ran beside an upload that would undo it');
        env.server.gates.upload.resolve();
        assert.equal(await pending, 'done');
        assert.equal(env.calls.delete, 1);
        assert.equal(env.server.blob, null);
        assert.equal(env.store.account.autoBackupPaused, true);
        assert.equal(env.store.account.lastBackupAt, null);
      });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.deleteOk = false;
        assert.equal(await env.api.deleteRemoteBackup(), 'failed');
        assert.equal(env.store.account.lastBackupAt, '2026-09-10T08:00:00.000Z', 'a failed delete cleared the backup row');
        assert.equal(env.store.account.autoBackupPaused, false);
      });
    },
  },
  {
    name: 'account hook: deleting the account asks the server to end the sign-in, and signs out only after it said yes',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.gates.delete = deferred();
        const pending = env.api.deleteAccount();
        await env.settle();
        // In flight: still signed in, nothing says done, the other rows wait.
        assert.equal(env.api.phase, 'deleting');
        assert.equal(env.api.state.status, 'signed_in');
        assert.equal(env.api.state.provider, 'google');
        assert.notEqual(env.store.account, null, 'the account was forgotten before the server answered');
        assert.equal(env.calls.signedOut, 0);

        env.server.gates.delete.resolve();
        assert.equal(await pending, 'done');
        await env.settle();
        assert.equal(env.calls.deleteOptions.length, 1);
        assert.equal(env.calls.deleteOptions[0].account, true, 'the server was not told this is the account');
        assert.match(env.calls.deleteOptions[0].requestId, /^[0-9a-f]{32}$/, 'the request carried no id of its own');
        assert.equal(env.server.blob, null);
        assert.equal(env.store.account, null);
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.api.state.provider, null);
        assert.equal(env.calls.signedOut, 1, 'the Google / Apple session on the phone was kept');
        assert.equal(env.api.phase, 'idle');
        // The phone's own data is not the reader's account: it stays.
        assert.equal(env.app.database.workoutSessions.length, 1);
        // The data left here is remembered as this account's, as after any sign-out.
        assert.deepEqual(env.store.signedOut, ['sub-1']);
      });
      // The server refused: still signed in, nothing forgotten, nothing claimed.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.deleteOk = false;
        assert.equal(await env.api.deleteAccount(), 'failed');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in');
        assert.notEqual(env.store.account, null);
        assert.equal(env.calls.signedOut, 0);
        assert.equal(env.api.phase, 'idle');
        // And can be asked again.
        env.server.deleteOk = true;
        assert.equal(await env.api.deleteAccount(), 'done');
      });
      await withHook({ local, stored: syncedAccount(local, { sub: 'apple:001234.abc' }), cloud: cloudCopy(local) }, async (env) => {
        assert.equal(env.api.state.provider, 'apple', 'the Apple-only confirmation would never show');
      });
      // Deleting only the copy still keeps the reader signed in, and does not ask for the account to go.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        assert.equal(await env.api.deleteRemoteBackup(), 'done');
        assert.deepEqual(env.calls.deleteOptions, [undefined]);
        assert.equal(env.api.state.status, 'signed_in');
        assert.equal(env.calls.signedOut, 0);
      });
    },
  },
  {
    name: 'account hook: the server saying an Apple session is over signs this phone out; INVALID_TOKEN, a Google 401 or a store that could not answer does not',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      const unsynced = () => syncedAccount(local, { lastBackupFingerprint: null });
      const apple = { status: 'ok', idToken: 'vs1.session.mac' };

      // The account was deleted on another phone (SESSION_REVOKED), or the session ran out
      // (SESSION_EXPIRED): the next request's refusal signs this one out.
      for (const code of ['SESSION_REVOKED', 'SESSION_EXPIRED']) {
        for (const operation of ['upload', 'download', 'delete', 'deleteAccount']) {
          // A phone that has never synced looks at the cloud first.
          const stored = operation === 'download' ? syncedAccount(local, { lastBackupAt: null, lastBackupItemCount: null, lastBackupFingerprint: null }) : unsynced();
          await withHook({ local, stored, cloud: cloudCopy(local) }, async (env) => {
            const label = `${code} on ${operation}`;
            env.google.silent = apple;
            if (operation === 'upload') {
              env.server.uploadError = code;
              assert.equal((await env.api.backUpOrAsk()).kind, 'ended', label);
            } else if (operation === 'download') {
              env.server.downloadError = code;
              assert.equal((await env.api.backUpOrAsk()).kind, 'ended', label);
            } else {
              env.server.deleteError = code;
              const outcome = await env.api[operation === 'delete' ? 'deleteRemoteBackup' : 'deleteAccount']();
              // "Delete account" on a phone that never tried before is told the account was deleted
              // elsewhere (or its sign-in ended) — never "deleted": nothing was deleted by this tap.
              assert.equal(outcome, 'ended', label);
            }
            await env.settle();
            assert.equal(env.store.account, null, `${label}: the account record stayed`);
            assert.equal(env.api.state.status, 'signed_out', `${label}: the UI kept saying Signed in`);
            assert.equal(env.calls.signedOut, 1, `${label}: the Apple session on the phone was kept`);
            assert.deepEqual(env.store.signedOut, ['sub-1'], `${label}: the phone forgot whose data it holds`);
            assert.equal(env.api.phase, 'idle');
            assert.equal(env.app.database.workoutSessions.length, 1, `${label}: signing out touched the phone's data`);
          });
        }
      }

      // The sign-in's own look at the cloud goes through the same screen.
      await withHook({ local: database(), cloud: cloudCopy(local) }, async (env) => {
        env.google.signIn = { status: 'signed_in', account: { sub: 'apple:001', email: null, name: null, idToken: 'vs1.fresh.mac' } };
        env.server.downloadError = 'SESSION_REVOKED';
        assert.equal((await env.api.signIn()).kind, 'ended');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_out', 'a refused sign-in left the reader signed in');
        assert.equal(env.store.account, null);
        assert.equal(env.calls.signedOut, 1);
      });
      await withHook({ local: database(), cloud: cloudCopy(local) }, async (env) => {
        env.google.signIn = { status: 'signed_in', account: { sub: 'apple:001', email: null, name: null, idToken: 'vs1.fresh.mac' } };
        env.server.downloadError = 'INVALID_TOKEN';
        assert.equal((await env.api.signIn()).kind, 'not_backed_up', 'INVALID_TOKEN signed the reader out');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in');
      });

      // The automatic backup too: nothing the reader pressed.
      await withHook({ local, stored: unsynced(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.uploadError = 'SESSION_REVOKED';
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        await env.settle();
        assert.equal(env.api.state.status, 'signed_out');
      });

      // A session that does not verify (a deploy with the wrong secret refuses everyone at once) and a
      // store that could not answer are failures to try again — never a sign-out.
      for (const error of ['INVALID_TOKEN', 'STORE_UNAVAILABLE', 'STORAGE_FAILED', 'HTTP_502', 'NETWORK']) {
        await withHook({ local, stored: unsynced(), cloud: cloudCopy(local) }, async (env) => {
          env.google.silent = apple;
          env.server.uploadError = error;
          assert.equal((await env.api.backUpOrAsk()).kind, 'failed');
          env.server.deleteError = error;
          assert.equal(await env.api.deleteRemoteBackup(), 'failed');
          assert.equal(await env.api.deleteAccount(), 'failed');
          await env.settle();
          assert.equal(env.api.state.status, 'signed_in', `${error} signed the reader out`);
          assert.notEqual(env.store.account, null);
          assert.equal(env.calls.signedOut, 0);
        });
      }

      // A Google token the server turned away behaves as it always did: still signed in.
      for (const code of ['INVALID_TOKEN', 'SESSION_REVOKED']) {
        await withHook({ local, stored: unsynced(), cloud: cloudCopy(local) }, async (env) => {
          env.server.uploadError = code;
          assert.equal((await env.api.backUpOrAsk()).kind, 'failed');
          env.server.deleteError = code;
          assert.equal(await env.api.deleteRemoteBackup(), 'failed');
          assert.equal(await env.api.deleteAccount(), 'failed');
          await env.settle();
          assert.equal(env.api.state.status, 'signed_in', `a Google token refused with ${code} signed the reader out`);
          assert.equal(env.calls.signedOut, 0);
        });
      }
    },
  },
  {
    name: 'account hook: a Delete account whose answer was lost reads as done on retry — and another phone is told only that the account was deleted elsewhere',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      const apple = { status: 'ok', idToken: 'vs1.session.mac' };
      const fresh = () => syncedAccount(local);

      // Phone A: the server deleted, the answer never arrived.
      await withHook({ local, stored: fresh(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.deleteLost = true;
        assert.equal(await env.api.deleteAccount(), 'failed');
        await env.settle();
        assert.equal(env.server.blob, null, 'the fake did not delete');
        assert.equal(typeof env.store.account.deleteAccountPendingAt, 'string', 'no record of a delete that may have gone through');
        assert.equal(env.api.state.status, 'signed_in', 'a lost answer signed the reader out');
        // The retry meets the session the server has by now ended.
        env.server.deleteLost = false;
        env.server.deleteError = 'SESSION_REVOKED';
        assert.equal(await env.api.deleteAccount(), 'done', 'the phone that did delete was not told so');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.calls.signedOut, 1);
        assert.equal(env.store.account, null, 'the pending record outlived the account');
      });

      // The same, with a 5xx: the server may have stamped one marker and failed the next.
      await withHook({ local, stored: fresh(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.deleteError = 'STORE_UNAVAILABLE';
        assert.equal(await env.api.deleteAccount(), 'failed');
        await env.settle();
        assert.equal(typeof env.store.account.deleteAccountPendingAt, 'string', 'a 5xx cleared the record');
        env.server.deleteError = 'SESSION_REVOKED';
        assert.equal(await env.api.deleteAccount(), 'done');
      });

      // Phone B never sent one. The account was deleted by A, who may have signed in again and backed up:
      // B is signed out and told that — "deleted" would be false while A's new copy lives.
      await withHook({ local, stored: fresh(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.deleteError = 'SESSION_REVOKED';
        assert.equal(await env.api.deleteAccount(), 'ended');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.calls.signedOut, 1);
        assert.equal(env.store.account, null);
        assert.equal(env.app.database.workoutSessions.length, 1, 'signing out touched the phone’s data');
      });

      // A try the server definitely refused leaves nothing pending: a later "session ended" is the
      // other phone's doing, not this one's.
      await withHook({ local, stored: fresh(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.deleteError = 'INVALID_TOKEN';
        assert.equal(await env.api.deleteAccount(), 'failed');
        await env.settle();
        assert.ok(!env.store.account.deleteAccountPendingAt, 'a refused try left a record that would later read as a delete');
        env.server.deleteError = 'SESSION_REVOKED';
        assert.equal(await env.api.deleteAccount(), 'ended');
      });

      // An expired session deleted nothing, whatever this phone tried before.
      await withHook({ local, stored: syncedAccount(local, { deleteAccountPendingAt: '2026-10-02T08:00:00.000Z' }), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = apple;
        env.server.deleteError = 'SESSION_EXPIRED';
        assert.equal(await env.api.deleteAccount(), 'ended');
      });

      // A Google account keeps no record that matters: its token is checked with Google, never "revoked".
      await withHook({ local, stored: fresh(), cloud: cloudCopy(local) }, async (env) => {
        env.server.deleteError = 'SESSION_REVOKED';
        assert.equal(await env.api.deleteAccount(), 'failed');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in');
      });
    },
  },
  {
    name: 'account hook: sign-out overtakes a running upload and a running sign-in',
    async run() {
      const local = database({ workoutSessions: [workout('a')] });
      await withHook({ local, stored: syncedAccount(local, { lastBackupFingerprint: null }), cloud: cloudCopy(local) }, async (env) => {
        env.server.gates.upload = deferred();
        const pending = env.api.backUpOrAsk();
        await flush();
        assert.equal(env.calls.upload, 1);
        await env.api.signOut();
        env.server.gates.upload.resolve();
        assert.equal((await pending).kind, 'cancelled');
        await env.settle();
        assert.equal(env.store.account, null, 'the upload signed the account back in');
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.api.phase, 'idle');
      });
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        env.server.gates.download = deferred();
        const pending = env.api.signIn();
        await flush();
        await env.api.signOut();
        env.server.gates.download.resolve();
        assert.equal((await pending).kind, 'cancelled');
        assert.equal(env.calls.restoreDatabase, 0, 'the backup was restored onto a phone that had just been reset');
        assert.equal(env.store.account, null);
      });
    },
  },
  {
    name: 'account hook: a sign-in whose backup failed is reported as a backup failure, signed in',
    async run() {
      await withHook({ local: database(), cloud: null }, async (env) => {
        env.server.downloadError = 'STORE_UNAVAILABLE';
        assert.equal((await env.api.signIn()).kind, 'not_backed_up');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in');
      });
      await withHook({ local: database({ workoutSessions: [workout('a')] }), cloud: null }, async (env) => {
        env.server.uploadError = 'NETWORK';
        assert.equal((await env.api.signIn()).kind, 'not_backed_up');
        await env.settle();
        assert.equal(env.api.state.status, 'signed_in');
        assert.equal(env.api.state.lastBackupAt, null);
      });
    },
  },
  {
    name: 'account hook: "Backup restored" waits for the workout history on disk, and a refused write fails the restore',
    async run() {
      const cloud = cloudCopy(database({ workoutSessions: workouts(3) }));
      await withHook({ local: database(), cloud }, async (env) => {
        env.app.gates.history = deferred();
        let settled = false;
        const pending = env.api.signIn().then((outcome) => {
          settled = true;
          return outcome;
        });
        await env.settle();
        assert.equal(env.calls.restoreHistory, 1);
        assert.equal(settled, false, 'the restore was reported before the history was written');
        env.app.gates.history.resolve();
        assert.equal((await pending).kind, 'restored');
      });
      const quietly = async (work) => {
        const originalError = console.error;
        console.error = () => undefined;
        try {
          return await work();
        } finally {
          console.error = originalError;
        }
      };
      await withHook({ local: database(), cloud }, async (env) => {
        env.app.historyWriteError = new Error('database or disk is full');
        assert.equal((await quietly(() => env.api.signIn())).kind, 'restore_failed');
        assert.equal(env.store.account.lastBackupAt, null, 'a half-written restore was marked as synced');
        // "Nothing on this phone changed" is made true: the database goes back.
        assert.equal(env.calls.restoreDatabase, 2);
        assert.equal(env.app.database.workoutSessions.length, 0, 'the backup database stayed beside this phone\'s history');
      });
      // The same on the "Back up now" path, where the account was synced
      // before: it is left unsynced, so the automatic backup cannot write
      // this phone over the copy the reader chose.
      const full = database({ workoutSessions: workouts(40) });
      await withHook(
        { local: database(), stored: syncedAccount(full, { lastBackupFingerprint: null }), cloud: cloudCopy(full) },
        async (env) => {
          assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
          await env.settle();
          env.app.historyWriteError = new Error('database or disk is full');
          assert.equal(await quietly(() => env.api.resolveRestoreChoice('restore')), 'failed');
          assert.equal(env.app.database.workoutSessions.length, 0);
          assert.equal(env.store.account.lastBackupAt, null);
          env.app.historyWriteError = null;
          await env.edit((db) => ({ ...db, workoutSessions: workouts(25) }));
          await env.advance(QUIET_MS);
          assert.equal(env.calls.upload, 0, 'a failed restore let the automatic backup replace the chosen copy');
          assert.equal(env.server.blob.database.workoutSessions.length, 40);
        },
      );
    },
  },
  {
    // Privacy fix: the coach's own memory sits outside both stores a restore
    // touches (App.tsx state, plus its own AsyncStorage key), so it is only
    // ever cleared through onRestored — fired once a restore has actually
    // landed, never on "keep this phone's data" or a failed write.
    name: 'account hook: onRestored fires once a restore lands, and only then',
    async run() {
      // A fresh phone, restored without asking.
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'restored');
        assert.equal(env.calls.restored, 1, 'a landed automatic restore did not clear the coach memory');
      });

      // Both sides hold data: "keep this phone's data" never restores.
      await withHook({ local: database({ workoutSessions: workouts(3) }), cloud: cloudCopy(database({ workoutSessions: workouts(2) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'choice');
        assert.equal(await env.api.resolveRestoreChoice('keep_local'), 'done');
        assert.equal(env.calls.restored, 0, '"keep this phone\'s data" cleared memory that still belongs to the phone');
      });

      // Both sides hold data, and the reader chooses the backup.
      await withHook({ local: database({ workoutSessions: workouts(3) }), cloud: cloudCopy(database({ workoutSessions: workouts(2) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'choice');
        assert.equal(await env.api.resolveRestoreChoice('restore'), 'done');
        assert.equal(env.calls.restored, 1, 'the reader\'s own "restore" did not clear the coach memory');
      });

      // The workout history write fails: rolled back, so "restored" never happened.
      const originalError = console.error;
      console.error = () => undefined;
      try {
        await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
          env.app.historyWriteError = new Error('database or disk is full');
          assert.equal((await env.api.signIn()).kind, 'restore_failed');
          assert.equal(env.calls.restored, 0, 'a restore that failed and rolled back still cleared the coach memory');
        });
      } finally {
        console.error = originalError;
      }
    },
  },
  {
    // Recheck round, 2026-09-29: onRestored erased the coach's memory
    // fire-and-forget — applyRestore called it without awaiting, so the
    // restore could resolve ('restored'/'done', the success UI shown) before
    // the erase had even started, let alone finished. A process kill in that
    // window left another account's coach memory on disk for the next
    // account. onRestored is now awaited before the restore resolves, and a
    // rejection from it — the erase already retries on its own side — must
    // never turn an already-landed restore into a reported failure.
    name: 'account hook: the restore does not resolve until onRestored settles, and a failure in it does not fail the restore',
    async run() {
      // A fresh phone, restored without asking: onRestored is held open, and
      // the restore must not resolve while it is.
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        env.app.gates.restored = deferred();
        let settled = false;
        const pending = env.api.signIn().then((outcome) => {
          settled = true;
          return outcome;
        });
        await env.settle();
        assert.equal(env.calls.restored, 1, 'onRestored was never called');
        assert.equal(settled, false, 'the restore resolved before onRestored settled');
        env.app.gates.restored.resolve();
        assert.equal((await pending).kind, 'restored', 'onRestored settling did not let the restore resolve');
        assert.equal(settled, true);
      });

      // The reader's own "restore" answer, same ordering.
      await withHook({ local: database({ workoutSessions: workouts(3) }), cloud: cloudCopy(database({ workoutSessions: workouts(2) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'choice');
        env.app.gates.restored = deferred();
        let settled = false;
        const pending = env.api.resolveRestoreChoice('restore').then((outcome) => {
          settled = true;
          return outcome;
        });
        await env.settle();
        assert.equal(settled, false, 'resolveRestoreChoice resolved before onRestored settled');
        env.app.gates.restored.resolve();
        assert.equal(await pending, 'done');
        assert.equal(settled, true);
      });

      // onRestored rejecting (its own erase failed twice, on its own side)
      // must not report the landed restore as failed.
      const originalError = console.error;
      console.error = () => undefined;
      try {
        await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
          env.app.restoredError = new Error('coach memory erase failed twice');
          const outcome = await env.api.signIn();
          assert.equal(outcome.kind, 'restored', 'a failed onRestored reported the landed restore as failed');
          // Nothing rolled back: the restored data is still there.
          assert.equal(env.app.database.workoutSessions.length, 3);
        });
      } finally {
        console.error = originalError;
      }
    },
  },
  {
    name: 'account hook: silent sign-in signs out only on no saved credential',
    async run() {
      const answers = [];
      const library = {
        GoogleSignin: {
          configure() {},
          async signInSilently() {
            const next = answers.shift();
            if (next instanceof Error) {
              throw next;
            }
            return next;
          },
        },
      };
      // The client id is read when the module loads, and the library when it
      // is first used — so the stub stays in the cache for the whole test.
      const savedId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
      const libraryFile = require.resolve('@react-native-google-signin/google-signin', { paths: [path.dirname(GOOGLE_AUTH)] });
      const savedLibrary = require.cache[libraryFile];
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'client.apps.googleusercontent.com';
      require.cache[libraryFile] = { id: libraryFile, filename: libraryFile, loaded: true, exports: library };
      try {
        const googleAuth = requireWithStubs(GOOGLE_AUTH, { 'react-native': { Platform: { OS: 'android' } } });
        answers.push({ type: 'success', data: { idToken: 'fresh', user: { id: 'u', email: null, name: null } } });
        assert.deepEqual(await googleAuth.getFreshIdToken(), { status: 'ok', idToken: 'fresh' });
        // The library turns SIGN_IN_REQUIRED into this answer and throws everything else.
        answers.push({ type: 'noSavedCredentialFound', data: null });
        assert.deepEqual(await googleAuth.getFreshIdToken(), { status: 'signed_out' });
        answers.push(Object.assign(new Error('A network error occurred'), { code: '7' }));
        assert.deepEqual(await googleAuth.getFreshIdToken(), { status: 'error' }, 'offline read as signed out');
        answers.push({ type: 'success', data: { idToken: null, user: { id: 'u', email: null, name: null } } });
        assert.deepEqual(await googleAuth.getFreshIdToken(), { status: 'error' });
      } finally {
        if (savedId === undefined) {
          delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
        } else {
          process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = savedId;
        }
        if (savedLibrary) {
          require.cache[libraryFile] = savedLibrary;
        } else {
          delete require.cache[libraryFile];
        }
      }
    },
  },
  {
    // Two phones on one Google account shared the one blob, and each uploaded
    // whenever it had not shrunk against its own last count — the phone that
    // wrote last won, older data included (server audit, 2026-09-21). Every
    // upload now names the copy it replaces, and the server keeps a copy it
    // was not named.
    name: 'account hook: a copy another phone wrote since is asked about, never overwritten',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        // The other phone logs two workouts and backs up.
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(5) }));
        const theirs = env.server.version;

        // This phone logs one; its automatic backup runs.
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('mine')] }));
        await env.advance(QUIET_MS);
        assert.equal(env.server.blob.database.workoutSessions.length, 5, "the other phone's workouts were overwritten");
        assert.equal(env.store.account.lastBackupAt, '2026-09-10T08:00:00.000Z', 'a refused upload was reported as a backup');
        assert.equal(env.calls.upload, 1);
        assert.deepEqual(env.calls.expected, ['v1'], 'the upload did not name the copy it replaces');
        assert.equal(env.store.account.cloudVersion, 'v1');

        // Unattended, it does not send the history again to hear the same no.
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna' } }));
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);

        // "Back up now" is refused the same way, and becomes the question.
        const outcome = await env.api.backUpOrAsk();
        assert.equal(outcome.kind, 'choice', '"Back up now" overwrote a copy this phone never saw');
        assert.equal(outcome.summary.cloud.workoutCount, 5);
        assert.equal(outcome.summary.local.workoutCount, 4);
        assert.equal(env.server.blob.database.workoutSessions.length, 5);

        // Keeping this phone's data replaces the copy that was shown, by name.
        await env.settle();
        assert.equal(await env.api.resolveRestoreChoice('keep_local'), 'done');
        assert.equal(env.calls.expected[env.calls.expected.length - 1], theirs);
        assert.equal(env.server.blob.database.workoutSessions.length, 4);
        assert.equal(env.store.account.cloudVersion, env.server.version);

        // And the automatic backup is back on.
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna K' } }));
        await env.advance(QUIET_MS);
        assert.equal(env.server.blob.database.preferences.profileName, 'Sanna K');
      });

      // Restoring the other phone's copy instead makes it this phone's.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(5) }));
        assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
        await env.settle();
        assert.equal(await env.api.resolveRestoreChoice('restore'), 'done');
        assert.equal(env.store.account.cloudVersion, env.server.version);
        await env.settle();
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('next')] }));
        await env.advance(QUIET_MS);
        assert.equal(env.server.blob.database.workoutSessions.length, 6);
      });
    },
  },
  {
    name: 'account hook: a restore remembers the copy it restored, and the next backup names it without reading it again',
    async run() {
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'restored');
        assert.equal(env.store.account.cloudVersion, 'v1', 'the restore did not keep the version of what it restored');
        await env.settle();
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.deepEqual(env.calls.expected, ['v1']);
        assert.equal(env.calls.download, 1, 'a phone that knows its copy read it again before every write');
        assert.equal(env.store.account.cloudVersion, env.server.version);
      });
    },
  },
  {
    name: 'account hook: the first backup is written onto no copy, and one that lost the race asks instead',
    async run() {
      await withHook({ local: database({ workoutSessions: [workout('a')] }), cloud: null }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'backed_up');
        assert.deepEqual(env.calls.expected, [null]);
        assert.equal(env.store.account.cloudVersion, env.server.version);
      });
      // Another phone's first backup lands between this one's look and its write.
      await withHook({ local: database({ workoutSessions: [workout('a')] }), cloud: null }, async (env) => {
        env.server.gates.upload = deferred();
        const pending = env.api.signIn();
        await env.settle();
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(4) }));
        env.server.gates.upload.resolve();
        assert.equal((await pending).kind, 'not_backed_up');
        assert.equal(env.server.blob.database.workoutSessions.length, 4, 'the first backup overwrote the other phone\'s');
        assert.equal(env.store.account.lastBackupAt, null);
        delete env.server.gates.upload;
        await env.settle();
        assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
      });
    },
  },
  {
    name: 'account hook: an account from before versions knows its own copy, and not another phone\'s',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      // Its last sync was an upload: the server's save time, not the copy's export time.
      const uploadedBefore = { cloudVersion: null, lastBackupAt: '2026-09-10T09:00:00.000Z' };
      await withHook({ local, stored: syncedAccount(local, uploadedBefore), cloud: cloudCopy(local) }, async (env) => {
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.download, 1, 'an account without a version wrote without reading the copy');
        assert.deepEqual(env.calls.expected, ['v1']);
        assert.equal(env.store.account.cloudVersion, env.server.version);
      });
      await withHook({ local, stored: syncedAccount(local, uploadedBefore), cloud: cloudCopy(database({ workoutSessions: workouts(5) })) }, async (env) => {
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 0, "an updated phone adopted the other phone's copy and wrote over it");
        assert.equal(env.server.blob.database.workoutSessions.length, 5);
        assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
      });
    },
  },
  {
    name: 'account store: an account saved by an older build loads with the new fields defaulted',
    run() {
      assert.deepEqual(normalizeStoredAccount({ sub: 's', email: 'e', name: null, lastBackupAt: 'x', lastBackupItemCount: 4 }), {
        sub: 's',
        email: 'e',
        name: null,
        lastBackupAt: 'x',
        lastBackupItemCount: 4,
        // Unknown for an account stored before the history was counted: its
        // next backup looks at the copy first and learns it.
        lastBackupHistoryCount: null,
        lastBackupFingerprint: null,
        autoBackupPaused: false,
        // Unknown for an account stored before versions were kept: its next
        // backup reads the copy before it names one (server audit, 2026-09-21).
        cloudVersion: null,
      });
      const odd = normalizeStoredAccount({
        sub: 's',
        lastBackupFingerprint: 7,
        autoBackupPaused: 'yes',
        lastBackupItemCount: -1,
        lastBackupHistoryCount: 'many',
        cloudVersion: 12,
      });
      assert.equal(odd.lastBackupFingerprint, null);
      assert.equal(odd.autoBackupPaused, false);
      assert.equal(odd.cloudVersion, null);
      assert.equal(normalizeStoredAccount({ sub: 's', cloudVersion: '' }).cloudVersion, null);
      // The pending "Delete account" record: kept when it is a date, dropped (not turned into a field of nulls) when not.
      assert.equal(normalizeStoredAccount({ sub: 's', deleteAccountPendingAt: '2026-10-02T08:00:00.000Z' }).deleteAccountPendingAt, '2026-10-02T08:00:00.000Z');
      for (const bad of ['', 'yesterday', 7, true, {}]) {
        assert.equal('deleteAccountPendingAt' in normalizeStoredAccount({ sub: 's', deleteAccountPendingAt: bad }), false, JSON.stringify(bad));
      }
      assert.equal(normalizeStoredAccount({ sub: 's', cloudVersion: '"v7"' }).cloudVersion, '"v7"');
      assert.equal(odd.lastBackupItemCount, null);
      assert.equal(odd.lastBackupHistoryCount, null);
      assert.equal(normalizeStoredAccount({ sub: 's', lastBackupHistoryCount: 12.7 }).lastBackupHistoryCount, 12);
      assert.equal(normalizeStoredAccount({ sub: 's', lastBackupFingerprint: 'abc', autoBackupPaused: true }).autoBackupPaused, true);
      assert.equal(normalizeStoredAccount({ sub: '' }), null);
      assert.equal(normalizeStoredAccount(null), null);
      // "Your cloud copy was deleted": kept when it is a date, dropped when not.
      assert.equal(normalizeStoredAccount({ sub: 's', cloudCopyDeletedAt: '2026-10-03T20:00:00.000Z' }).cloudCopyDeletedAt, '2026-10-03T20:00:00.000Z');
      for (const bad of ['', 'yesterday', 7, true, {}, null]) {
        assert.equal('cloudCopyDeletedAt' in normalizeStoredAccount({ sub: 's', cloudCopyDeletedAt: bad }), false, JSON.stringify(bad));
      }
    },
  },
  {
    // Bug hunt 5 (2026-10-03): a phone still signed in after its account's copy was deleted on the web page (#291) met
    // a refused upload, paused saying the copy "changed on another phone", and "Back up now" re-uploaded the whole
    // history as a first backup without a word.
    name: 'account hook: a cloud copy deleted elsewhere is said so, nothing is sent unattended, and "Back up now" asks before a new copy',
    async run() {
      const { confirmUploadCopy } = require(path.join(DIST, 'lib', 'accountBackupCopy.js'));
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        // Deleted on the web page.
        env.server.blob = null;
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('mine')] }));
        await env.advance(QUIET_MS);
        assert.equal(env.server.blob, null, 'the automatic backup made the deleted copy again');
        assert.equal(env.calls.upload, 1, 'one refused upload');
        assert.equal(env.api.state.backupPaused, 'copy_deleted', 'the row says the copy was deleted, not that it changed');
        assert.equal(env.api.state.lastBackupAt, null, 'a backup time over a copy that is gone');
        assert.ok(env.store.account.cloudCopyDeletedAt, 'remembered on the account, so a relaunch says it too');
        assert.equal(env.store.account.autoBackupPaused, true);
        assert.equal(env.store.account.cloudVersion, null);

        // Nothing more is sent unattended.
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna' } }));
        await env.advance(QUIET_MS);
        await env.foreground();
        await env.advance(QUIET_MS);
        assert.equal(env.calls.upload, 1);
        assert.equal(env.server.blob, null);

        // "Back up now" asks, saying why; "Not now" sends nothing and keeps the mark.
        const asked = await env.api.backUpOrAsk();
        assert.equal(asked.kind, 'confirm_upload', '"Back up now" re-made the deleted copy without asking');
        assert.equal(asked.reason, 'copy_deleted');
        assert.equal(env.server.blob, null);
        for (const language of ['en', 'fi']) {
          const copy = confirmUploadCopy(asked, language);
          assert.match(copy.body, language === 'en' ? /was deleted, on the web or on another phone/ : /poistettiin verkossa tai toisella puhelimella/);
          assert.match(copy.body, /reader@example\.com/);
        }
        await env.settle();
        assert.equal(await env.api.resolveUploadChoice('skip'), 'done');
        await env.settle();
        assert.equal(env.server.blob, null);
        assert.equal(env.api.state.backupPaused, 'copy_deleted');

        // A yes makes the new copy, lifts the mark and turns the automatic backup back on.
        assert.equal((await env.api.backUpOrAsk()).kind, 'confirm_upload');
        await env.settle();
        assert.equal(await env.api.resolveUploadChoice('upload'), 'done');
        await env.settle();
        assert.equal(env.server.blob.database.workoutSessions.length, 4);
        assert.equal(env.api.state.backupPaused, null);
        assert.equal(env.store.account.cloudCopyDeletedAt, null);
        await env.edit((db) => ({ ...db, preferences: { ...db.preferences, profileName: 'Sanna K' } }));
        await env.advance(QUIET_MS);
        assert.equal(env.server.blob.database.preferences.profileName, 'Sanna K');
      });

      // Pressed before any automatic backup noticed, and on an account from before versions (which looks first):
      // asked all the same.
      for (const extra of [{}, { cloudVersion: null }]) {
        await withHook({ local, stored: syncedAccount(local, extra), cloud: cloudCopy(local) }, async (env) => {
          env.server.blob = null;
          const outcome = await env.api.backUpOrAsk();
          assert.equal(outcome.kind, 'confirm_upload', JSON.stringify(extra));
          assert.equal(outcome.reason, 'copy_deleted');
          assert.equal(env.server.blob, null);
          await env.settle();
          assert.equal(env.api.state.backupPaused, 'copy_deleted');
        });
        await withHook({ local, stored: syncedAccount(local, extra), cloud: cloudCopy(local) }, async (env) => {
          env.server.blob = null;
          await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('mine')] }));
          await env.advance(QUIET_MS);
          assert.equal(env.server.blob, null, `unattended, ${JSON.stringify(extra)}`);
          assert.equal(env.api.state.backupPaused, 'copy_deleted');
        });
      }

      // A copy another phone wrote is still that question, not this one.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(5) }));
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('mine')] }));
        await env.advance(QUIET_MS);
        assert.equal(env.api.state.backupPaused, 'other_phone');
        assert.equal(env.store.account.cloudCopyDeletedAt ?? null, null);
      });

      // After a relaunch the stored mark alone says it: nothing sent, and "Back up now" asks.
      const marked = {
        ...syncedAccount(local),
        lastBackupAt: null,
        lastBackupItemCount: null,
        lastBackupHistoryCount: null,
        lastBackupFingerprint: null,
        autoBackupPaused: true,
        cloudVersion: null,
        cloudCopyDeletedAt: '2026-10-03T20:00:00.000Z',
      };
      await withHook({ local, stored: marked, cloud: null }, async (env) => {
        assert.equal(env.api.state.backupPaused, 'copy_deleted');
        await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('mine')] }));
        await env.advance(QUIET_MS);
        await env.foreground();
        assert.equal(env.calls.upload, 0);
        assert.equal((await env.api.backUpOrAsk()).reason, 'copy_deleted');
        assert.equal(env.server.blob, null);
      });

      // "Keep this phone's data" over a copy deleted while the question was open: no copy is made, and the row says why.
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.blob = cloudCopy(database({ workoutSessions: workouts(5) }));
        assert.equal((await env.api.backUpOrAsk()).kind, 'choice');
        await env.settle();
        env.server.blob = null;
        assert.equal(await env.api.resolveRestoreChoice('keep_local'), 'failed');
        await env.settle();
        assert.equal(env.server.blob, null);
        assert.equal(env.api.state.backupPaused, 'copy_deleted');
      });
    },
  },
  {
    /**
     * Whose data reaches whose cloud, over every order of events.
     *
     * The account switch was fixed four times in one day (break round and
     * rechecks, 2026-09-28): a switched account uploading unasked, a mark
     * overwritten by an unanswered sign-in, an offline sign-in retried
     * unattended, "Not now" forgetting the mark, restore-or-keep not saying
     * the data was someone else's. Each was one path. This walks hundreds of
     * seeded random sequences of sign-in, sign-out, logging, answers,
     * automatic and manual backups, offline spells and resets across three
     * accounts, and after every step checks one rule:
     *
     *   account S's cloud copy holds a workout logged by another account
     *   only if the reader said yes to a question that told them so.
     *
     * A failure prints the seed and the steps, which replay exactly.
     */
    name: 'account hook: over any order of events, no account\'s cloud copy gets another account\'s workouts without a yes to a question that said so',
    async run() {
      const ACCOUNTS = ['acct-a', 'acct-b', 'acct-c'];
      const SEQUENCES = 150;
      const STEPS = 16;

      // mulberry32: small, seeded, the same sequence on every machine.
      const rng = (seed) => () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const ownerOf = (sessionId) => sessionId.split(':')[0];

      for (let seed = 1; seed <= SEQUENCES; seed += 1) {
        const random = rng(seed);
        const pick = (list) => list[Math.floor(random() * list.length)];
        const steps = [];
        await withHook({ local: database() }, async (env) => {
          /** Each account's cloud copy; the fake server holds whichever is signed in. */
          const clouds = { 'acct-a': null, 'acct-b': null, 'acct-c': null };
          /** Owners whose workouts an account was told about and said yes to. */
          const allowed = { 'acct-a': new Set(), 'acct-b': new Set(), 'acct-c': new Set() };
          let serverOwner = null;
          let pending = null;
          let logged = 0;

          const signedIn = () => env.store.account?.sub ?? null;
          const localOwners = () => new Set(env.app.database.workoutSessions.map((session) => ownerOf(session.id)));
          const syncCloud = () => {
            if (serverOwner) {
              clouds[serverOwner] = env.server.blob;
            }
          };
          const check = () => {
            syncCloud();
            for (const account of ACCOUNTS) {
              const blob = clouds[account];
              for (const session of blob?.database?.workoutSessions ?? []) {
                const owner = ownerOf(session.id);
                if (owner !== account && owner !== 'anon' && !allowed[account].has(owner)) {
                  assert.fail(
                    `seed ${seed}: ${account}'s cloud holds ${owner}'s workout ${session.id} with no yes\n  ` +
                      steps.join('\n  '),
                  );
                }
              }
            }
          };
          const consent = (account) => {
            for (const owner of localOwners()) {
              allowed[account].add(owner);
            }
          };
          const take = (outcome) => {
            if (outcome && (outcome.kind === 'confirm_upload' || outcome.kind === 'choice')) {
              pending = outcome;
            }
          };

          for (let step = 0; step < STEPS; step += 1) {
            const who = signedIn();
            const roll = random();
            if (pending && roll < 0.7) {
              // The reader answers the question in front of them.
              const account = who;
              if (pending.kind === 'confirm_upload') {
                const answer = pick(['upload', 'skip']);
                steps.push(`answer confirm_upload: ${answer}`);
                if (answer === 'upload' && account) {
                  consent(account);
                }
                await env.api.resolveUploadChoice(answer);
              } else {
                const answer = pick(['restore', 'keep_local']);
                steps.push(`answer choice (otherAccount=${pending.summary.localFromOtherAccount}): ${answer}`);
                // "Use the phone's data" is a yes to someone else's data only
                // when the question said the data was someone else's.
                if (answer === 'keep_local' && account && pending.summary.localFromOtherAccount) {
                  consent(account);
                }
                await env.api.resolveRestoreChoice(answer);
              }
              pending = null;
            } else if (!who && roll < 0.85) {
              const account = pick(ACCOUNTS);
              steps.push(`sign in ${account}`);
              if (serverOwner !== account) {
                syncCloud();
                env.server.blob = clouds[account];
                serverOwner = account;
              }
              env.google.signIn = { status: 'signed_in', account: { sub: account, email: `${account}@example.com`, name: account, idToken: `token-${account}` } };
              pending = null;
              // Sometimes the server cannot be reached at sign-in: the phone is
              // signed in without having looked, and a later backup does it.
              const offline = random() < 0.3;
              if (offline) {
                steps[steps.length - 1] += ' (offline)';
                env.server.downloadError = 'NETWORK';
              }
              take(await env.api.signIn());
              env.server.downloadError = null;
            } else {
              const action = pick(who ? ['log', 'log', 'auto', 'backup', 'signout', 'offline', 'reset'] : ['log', 'auto', 'reset']);
              steps.push(action);
              if (action === 'log') {
                logged += 1;
                const id = `${who ?? 'anon'}:${seed}-${logged}`;
                await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout(id)] }));
              } else if (action === 'auto') {
                await env.advance(QUIET_MS);
                await env.foreground();
                await env.advance(QUIET_MS);
              } else if (action === 'backup') {
                take(await env.api.backUpOrAsk());
              } else if (action === 'signout') {
                pending = null;
                await env.api.signOut();
              } else if (action === 'offline') {
                env.server.downloadError = 'NETWORK';
                env.server.uploadError = 'NETWORK';
                await env.advance(QUIET_MS);
                env.server.downloadError = null;
                env.server.uploadError = null;
              } else if (action === 'reset') {
                // Settings → Reset all data: signs out first, then wipes.
                pending = null;
                await env.api.signOut();
                env.app.database = database();
                await env.settle();
              }
            }
            await env.settle();
            check();
          }
        });
      }
    },
  },
  {
    name: 'a restore whose rollback is refused too says it is half done, not "nothing changed" (bug hunt 2026-10-05)',
    async run() {
      const quietly = async (work) => {
        const originalError = console.error;
        console.error = () => undefined;
        try {
          return await work();
        } finally {
          console.error = originalError;
        }
      };
      // The first database write (the backup's) lands; the rollback after the
      // refused history write is refused too — a full disk refuses both.
      const refuseAfterFirst = () => {
        let reads = 0;
        return {
          get promise() {
            reads += 1;
            return reads === 1 ? Promise.resolve() : Promise.reject(new Error('database or disk is full'));
          },
          resolve() {},
        };
      };

      // A fresh phone's automatic restore.
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        env.app.gates.database = refuseAfterFirst();
        env.app.historyWriteError = new Error('database or disk is full');
        assert.equal((await quietly(() => env.api.signIn())).kind, 'restore_incomplete');
      });

      // The reader's own "use the backup" answer.
      const mine = database({ workoutSessions: workouts(2).map((row, index) => ({ ...row, id: `mine${index}` })) });
      await withHook({ local: mine, cloud: cloudCopy(database({ workoutSessions: workouts(5) })) }, async (env) => {
        assert.equal((await env.api.signIn()).kind, 'choice');
        await env.settle();
        env.app.gates.database = refuseAfterFirst();
        env.app.historyWriteError = new Error('database or disk is full');
        assert.equal(await quietly(() => env.api.resolveRestoreChoice('restore')), 'incomplete');
      });

      // A rollback that lands is still the plain failure, and still true.
      await withHook({ local: database(), cloud: cloudCopy(database({ workoutSessions: workouts(3) })) }, async (env) => {
        env.app.historyWriteError = new Error('database or disk is full');
        assert.equal((await quietly(() => env.api.signIn())).kind, 'restore_failed');
        assert.equal(env.app.database.workoutSessions.length, 0);
      });

      // And each answer has its own words, in both languages.
      const outcome = require('node:fs')
        .readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'useAccountOutcome.ts'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.match(outcome, /outcome\.kind === 'restore_incomplete'\) \{\s*showToast\(t\(language, 'account\.restore\.incomplete'\)\)/);
      assert.match(outcome, /result === 'incomplete'\) \{\s*showToast\(t\(language, 'account\.restore\.incomplete'\)\)/);
      const { t } = require(path.join(DIST, 'lib', 'i18n.js'));
      assert.match(t('fi', 'account.restore.incomplete'), /osittain/);
      assert.match(t('en', 'account.restore.incomplete'), /partly/);
    },
  },
];
