const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createClock, createHookRuntime, deferred, flush, requireWithStubs } = require('../../helpers/hookHarness.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, '.test-dist');
const HOOK = path.join(DIST, 'features', 'account', 'useAccountBackup.js');
const lib = require(path.join(DIST, 'lib', 'accountBackup.js'));
const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));

/**
 * The account's session, run (audit 2026-10-03): how sign-out ends what was
 * running, what a sign-in that was over is told as, and what Reset and Delete
 * account do around it. The hook is driven through the same React stand-in as
 * accountBackupHook.test.cjs, with gates a test can hold open to put one step
 * between two others.
 */

const QUIET_MS = 8000;
const UNKNOWN = '?unknown';

function database(overrides = {}) {
  const base = createEmptyDatabase('fi');
  return { ...base, exerciseLibrary: [], ...overrides, preferences: { ...base.preferences, ...(overrides.preferences ?? {}) } };
}
const workout = (id) => ({ id, workoutTemplateId: 'tpl_x', workoutNameSnapshot: 'Push', performedAt: '2026-09-01T10:00:00.000Z' });
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
    lastBackupHistoryCount: 0,
    lastBackupFingerprint: lib.accountBackupFingerprint(local, emptyHistory()),
    autoBackupPaused: false,
    cloudVersion: 'v1',
    ...extra,
  };
}

async function withHook({ local, stored = null, cloud = null, signedOut = [] }, scenario) {
  const clock = createClock();
  const runtime = createHookRuntime();
  const listeners = new Set();
  const calls = { upload: 0, download: 0, delete: 0, signedOut: 0, signIn: 0, renew: [] };
  let blob = cloud;
  let written = 1;
  const server = {
    gates: {},
    get blob() {
      return blob;
    },
  };
  const google = {
    silent: { status: 'ok', idToken: 'token' },
    signIn: { status: 'signed_in', account: { sub: 'sub-2', email: 'two@example.com', name: 'Two', idToken: 'token-2' } },
  };
  const store = { account: stored, signedOut, rememberError: null, renewError: null };
  const app = { database: local, history: emptyHistory(), hydrated: true };

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
      async uploadBackup(_token, payload) {
        calls.upload += 1;
        blob = JSON.parse(JSON.stringify(payload));
        written += 1;
        return { ok: true, savedAt: '2026-09-17T12:00:00.000Z', version: `v${written}` };
      },
      async downloadBackup() {
        calls.download += 1;
        return blob ? { ok: true, payload: blob, version: `v${written}` } : { ok: false, error: 'NO_BACKUP' };
      },
      async deleteBackup() {
        calls.delete += 1;
        blob = null;
        return { ok: true };
      },
    },
    './accountAuth': {
      availableSignInProviders: () => ['google'],
      isAccountSignInConfigured: () => true,
      async signInWith() {
        calls.signIn += 1;
        return google.signIn;
      },
      async getFreshIdToken() {
        if (server.gates.token) {
          await server.gates.token.promise;
        }
        return google.silent;
      },
      async renewSessionIfDue(sub) {
        calls.renew.push(sub);
        if (store.renewError) {
          throw store.renewError;
        }
      },
      async signOutAccount() {
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
        if (server.gates.remember) {
          await server.gates.remember.promise;
        }
        if (store.rememberError) {
          throw store.rememberError;
        }
        store.signedOut = [...new Set([...store.signedOut, sub])];
      },
      loadSignedOutAccounts: async () => store.signedOut,
      forgetSignedOutAccount: async () => {
        if (server.gates.forget) {
          await server.gates.forget.promise;
        }
        store.signedOut = [];
      },
    },
  });

  const props = () => ({
    hydrated: app.hydrated,
    liveSession: false,
    database: app.database,
    workoutHistory: app.history,
    async restoreDatabase(input) {
      app.database = { ...input, exerciseLibrary: [] };
      return app.database;
    },
    async restoreWorkoutHistory(history) {
      app.history = history;
      return history;
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

async function quietly(work) {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await work();
  } finally {
    console.error = original;
  }
}

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

module.exports = [
  {
    // The window: sign-out had bumped the generation but not yet cleared the
    // account (it awaited the signed-out note first). A backup whose timer fired
    // there took the new generation, built its payload after Reset's wipe and
    // uploaded an empty database over the cloud copy — and signed the account in
    // again on the emptied phone.
    name: 'sign-out: a backup that fires while it is finishing starts nothing, and the cloud copy keeps its workouts',
    async run() {
      for (const tokenBeforeWipe of [false, true]) {
        const local = database({ workoutSessions: workouts(30) });
        await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
          await env.edit((db) => ({ ...db, workoutSessions: [...db.workoutSessions, workout('w-new')] }));
          await env.advance(QUIET_MS - 1000);
          env.server.gates.remember = deferred();
          env.server.gates.token = deferred();
          const signingOut = env.api.signOut();
          await env.settle();
          await env.advance(1000); // the automatic backup's timer, inside the gap
          env.server.gates.remember.resolve();
          await signingOut;
          if (tokenBeforeWipe) {
            env.server.gates.token.resolve();
            await env.settle();
          }
          env.app.database = database({}); // Reset's wipe landed
          await env.settle();
          if (!tokenBeforeWipe) {
            env.server.gates.token.resolve();
            await env.settle();
          }
          const label = tokenBeforeWipe ? 'token before the wipe' : 'token after the wipe';
          assert.equal(env.calls.upload, 0, `${label}: something was uploaded`);
          assert.equal(env.server.blob.database.workoutSessions.length, 30, `${label}: the cloud copy lost its workouts`);
          assert.equal(env.store.account, null, `${label}: the account was signed in again`);
          assert.equal(env.api.state.status, 'signed_out', label);
          // And nothing starts later, on the wiped phone.
          await env.edit((db) => ({ ...db, workoutSessions: [workout('after-reset')] }));
          await env.advance(QUIET_MS + 10);
          assert.equal(env.calls.upload, 0, `${label}: the wiped phone backed itself up`);
          assert.equal(env.server.blob.database.workoutSessions.length, 30);
        });
      }
    },
  },
  {
    name: 'sign-out: the account is gone from the ref and the state before the first await, and a sign-in waits for it to finish',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.server.gates.remember = deferred();
        const signingOut = env.api.signOut();
        // No await has happened: the state already says so.
        env.render();
        assert.equal(env.api.state.status, 'signed_out');
        const signingIn = env.api.signIn('google');
        await env.settle();
        assert.equal(env.calls.signIn, 0, 'a sign-in began while the sign-out was still clearing the store');
        env.server.gates.remember.resolve();
        await signingOut;
        await env.settle();
        await signingIn;
        assert.equal(env.calls.signIn, 1);
      });
    },
  },
  {
    name: 'sign-out: a signed-out note that cannot be written does not keep the phone signed in',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: syncedAccount(local), cloud: cloudCopy(local) }, async (env) => {
        env.store.rememberError = new Error('read failed');
        await quietly(() => env.api.signOut());
        await env.settle();
        assert.equal(env.store.account, null);
        assert.equal(env.calls.signedOut, 1);
        assert.equal(env.api.state.status, 'signed_out');
      });
    },
  },
  {
    name: 'a sign-in that is over (no provider session) signs the phone out the full way and says "ended", for every operation',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      const stale = () => syncedAccount(local, { lastBackupFingerprint: null });
      const operations = {
        backUpOrAsk: async (env) => assert.equal((await env.api.backUpOrAsk()).kind, 'ended', 'Back up now'),
        deleteRemoteBackup: async (env) => assert.equal(await env.api.deleteRemoteBackup(), 'ended', 'Delete cloud backup'),
        deleteAccount: async (env) => assert.equal(await env.api.deleteAccount(), 'ended', 'Delete account'),
      };
      for (const [name, run] of Object.entries(operations)) {
        await withHook({ local, stored: stale(), cloud: cloudCopy(local) }, async (env) => {
          env.google.silent = { status: 'signed_out' };
          await run(env);
          await env.settle();
          assert.equal(env.api.state.status, 'signed_out', name);
          assert.equal(env.store.account, null, name);
          assert.equal(env.calls.signedOut, 1, `${name}: the provider's session was kept`);
          assert.deepEqual(env.store.signedOut, ['sub-1'], `${name}: the phone forgot whose data it holds`);
          assert.equal(env.calls.delete, 0, `${name}: something was deleted`);
          assert.equal(env.api.phase, 'idle', name);
        });
      }
      // The automatic one is silent, and signs out all the same.
      await withHook({ local, stored: stale(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = { status: 'signed_out' };
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.calls.signedOut, 1);
      });
    },
  },
  {
    name: 'foreground: an Apple account\'s session is renewed on returning to the app, and a failed renewal signs nobody out',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: syncedAccount(local, { sub: 'apple:001' }), cloud: cloudCopy(local) }, async (env) => {
        await env.foreground();
        assert.deepEqual(env.calls.renew, ['apple:001']);
        env.store.renewError = new Error('offline');
        await env.foreground();
        assert.equal(env.calls.renew.length, 2);
        assert.equal(env.api.state.status, 'signed_in', 'a failed renewal signed the reader out');
        assert.notEqual(env.store.account, null);
      });
      await withHook({ local, stored: null, cloud: cloudCopy(local) }, async (env) => {
        await env.foreground();
        assert.deepEqual(env.calls.renew, [], 'a signed-out phone renewed a session');
      });
    },
  },
  {
    name: 'signed-out list unreadable: the account-switch question is asked, not skipped',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: null, cloud: null, signedOut: [UNKNOWN] }, async (env) => {
        const outcome = await env.api.signIn('google');
        assert.equal(outcome.kind, 'confirm_upload', 'an unreadable list was read as nobody, and the phone\'s workouts went up unasked');
        assert.equal(env.calls.upload, 0);
      });
      assert.equal(lib.uploadNeedsConsent({ signedOutSubs: [UNKNOWN], sub: 'sub-1', localWorthKeeping: true }), true);
      assert.equal(lib.uploadNeedsConsent({ signedOutSubs: [UNKNOWN], sub: 'sub-1', localWorthKeeping: false }), false);
    },
  },
  {
    // Both branches of settleWithRemote await forgetSignedOutAccount and then
    // act on the phone's data: restore onto an empty phone, or upload as the
    // first backup. A sign-out (Reset) inside that await must stop both.
    name: 'sign-in: a sign-out during the signed-out list being forgotten stops the restore and the first upload',
    async run() {
      // Empty phone, cloud copy exists: the restore.
      const cloud = cloudCopy(database({ workoutSessions: workouts(5) }));
      await withHook({ local: database(), stored: null, cloud }, async (env) => {
        env.server.gates.forget = deferred();
        const signingIn = env.api.signIn('google');
        await env.settle();
        const signingOut = env.api.signOut();
        await env.settle();
        env.server.gates.forget.resolve();
        await signingOut;
        const outcome = await signingIn;
        await env.settle();
        assert.equal(outcome.kind, 'cancelled');
        assert.equal(env.app.database.workoutSessions.length, 0, 'a restore landed on the phone that Reset had emptied');
        assert.equal(env.store.account, null, 'the account was signed in again');
        assert.equal(env.api.state.status, 'signed_out');
      });
      // Phone with data, no cloud copy: the first upload.
      await withHook({ local: database({ workoutSessions: workouts(5) }), stored: null, cloud: null }, async (env) => {
        env.server.gates.forget = deferred();
        const signingIn = env.api.signIn('google');
        await env.settle();
        const signingOut = env.api.signOut();
        await env.settle();
        env.server.gates.forget.resolve();
        await signingOut;
        const outcome = await signingIn;
        await env.settle();
        assert.equal(outcome.kind, 'cancelled');
        assert.equal(env.calls.upload, 0, 'a backup was uploaded after the sign-out');
        assert.equal(env.store.account, null);
        assert.equal(env.api.state.status, 'signed_out');
      });
    },
  },
  {
    name: 'an automatic backup that finds the sign-in over leaves a one-time notice, cleared once acknowledged and by the next sign-in; the reader\'s own backup does not (it answers directly)',
    async run() {
      const local = database({ workoutSessions: workouts(3) });
      const stale = () => syncedAccount(local, { lastBackupFingerprint: null });
      await withHook({ local, stored: stale(), cloud: cloudCopy(local) }, async (env) => {
        assert.equal(env.api.sessionEndedNotice, false);
        env.google.silent = { status: 'signed_out' };
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.api.state.status, 'signed_out');
        assert.equal(env.api.sessionEndedNotice, true, 'the reader was signed out without a word');
        env.api.acknowledgeSessionEnded();
        await env.settle();
        assert.equal(env.api.sessionEndedNotice, false);
      });
      // Cleared by the next sign-in, acknowledged or not.
      await withHook({ local, stored: stale(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = { status: 'signed_out' };
        await env.edit((db) => ({ ...db, bodyweightEntries: [{ id: 'bw', recordedAt: 't', weight: 80 }] }));
        await env.advance(QUIET_MS);
        assert.equal(env.api.sessionEndedNotice, true);
        await env.api.signIn('google');
        await env.settle();
        assert.equal(env.api.sessionEndedNotice, false);
      });
      // Back up now answers 'ended' itself; no second notice.
      await withHook({ local, stored: stale(), cloud: cloudCopy(local) }, async (env) => {
        env.google.silent = { status: 'signed_out' };
        assert.equal((await env.api.backUpOrAsk()).kind, 'ended');
        await env.settle();
        assert.equal(env.api.sessionEndedNotice, false);
      });
      // And the app-level surface shows it once, then acknowledges.
      const outcome = read('src', 'app', 'useAccountOutcome.ts');
      assert.match(
        outcome,
        /if \(accountBackup\.sessionEndedNotice\) \{\s*showToast\(t\(preferences\.appLanguage, 'account\.sessionEnded'\)\);\s*accountBackup\.acknowledgeSessionEnded\(\);/,
      );
    },
  },
  {
    name: 'reset: the signed-out marks are forgotten after both wipes have resolved, never before',
    async run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      const handler = profile.slice(profile.indexOf('onResetAllData={async () => {'));
      const order = ['await accountBackup.signOut();', 'await workout.resetWorkoutData();', 'await resetAllData();', 'await accountBackup.forgetSignedOutAccounts();'].map(
        (needle) => handler.indexOf(needle),
      );
      assert.ok(order.every((at) => at > 0), 'a step of the reset is missing');
      assert.deepEqual([...order].sort((a, b) => a - b), order, 'the marks are forgotten before the wipe has resolved');
      // The hook's half: forgetting clears the list.
      const local = database({ workoutSessions: workouts(3) });
      await withHook({ local, stored: null, cloud: null, signedOut: ['sub-1', 'sub-2'] }, async (env) => {
        await env.api.forgetSignedOutAccounts();
        assert.deepEqual(env.store.signedOut, []);
      });
    },
  },
  {
    name: 'delete account: the coach\'s kept copies are asked to go after the account deletion resolved, and their failure is not the deletion\'s',
    run() {
      const profile = read('src', 'app', 'renderProfileTab.tsx');
      const from = profile.indexOf('onDeleteAccount: () => {');
      const handler = profile.slice(from, profile.indexOf('onOpenLegal=', from));
      const done = handler.indexOf("if (result === 'done') {");
      const ended = handler.indexOf("else if (result === 'ended')");
      const cleanup = handler.indexOf('deleteCoachCopiesAfterAccountDeletion()');
      assert.ok(done > 0 && cleanup > done && cleanup < ended, 'the coach copies are asked for outside the "deleted" branch');
      const helperAt = profile.indexOf('const deleteCoachCopiesAfterAccountDeletion = async () => {');
      assert.ok(helperAt > 0);
      const body = profile.slice(helperAt, profile.indexOf('<SettingsScreen', helperAt));
      assert.match(body, /aiLogChatConsent: false, aiLogComposerConsent: false, aiLogPhotoConsent: false/);
      assert.ok(body.indexOf('updatePreferences(') < body.indexOf('forgetAiCoachLog(logId)'), 'consent goes off before the server is asked');
      assert.match(body, /retireAiLogLabel\(logId, !forgotten\.ok \|\| settling\)/, 'a delete that did not land is not filed as owed');
      assert.match(body, /\} catch \{\s*showToast\(t\(preferences\.appLanguage, 'toast\.coachCopiesPending'\)\);/, 'a failure here became a failed account deletion');
    },
  },
  {
    name: 'reset dialog: says what happens — signed in, the sign-out and the cloud copy staying; signed out, only the wipe',
    run() {
      const { t } = require(path.join(DIST, 'lib', 'i18n.js'));
      assert.equal(
        t('en', 'settings.resetDialog.message.signedIn'),
        'Everything on this phone is deleted and you are signed out. Your cloud backup stays — sign in again to restore it.',
      );
      assert.equal(t('en', 'settings.resetDialog.message'), 'Everything on this phone is deleted.');
      assert.match(t('fi', 'settings.resetDialog.message.signedIn'), /kirjataan ulos.*pilvivarmuuskopiosi säilyy/i);
      assert.doesNotMatch(t('fi', 'settings.resetDialog.message'), /kirja/i);
      const settings = read('src', 'screens', 'SettingsScreen.tsx');
      assert.match(
        settings,
        /!account\?\.signedIn\s*\? 'settings\.resetDialog\.message'\s*:\s*resetCloudBehind\s*\? 'settings\.resetDialog\.message\.signedInBehind'\s*:\s*'settings\.resetDialog\.message\.signedIn'/,
      );
      assert.equal(
        t('en', 'account.deleteAccount.message.apple').includes('the next time they connect to our server'),
        true,
      );
      assert.match(t('fi', 'account.deleteAccount.message.apple'), /kun ne seuraavan kerran ottavat yhteyttä palvelimeemme/);
      assert.ok(t('en', 'account.sessionEnded').length > 0 && t('fi', 'account.sessionEnded').length > 0);
    },
  },
];
