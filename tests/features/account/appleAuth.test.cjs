const assert = require('node:assert/strict');
const path = require('node:path');

const { requireWithStubs } = require('../../helpers/hookHarness.cjs');

/**
 * Sign in with Apple on the phone (2026-10-01): the session it keeps, when it
 * stops trusting it, and how the account layer picks between Apple and Google.
 */

const DIST = path.join(__dirname, '..', '..', '..', '.test-dist');
const APPLE_AUTH = path.join(DIST, 'features', 'account', 'appleAuth.js');
const ACCOUNT_AUTH = path.join(DIST, 'features', 'account', 'accountAuth.js');

const DAY = 24 * 60 * 60 * 1000;
const AUTHORIZED = 1;
const REVOKED = 0;
const NOT_FOUND = 2;

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

function loadApple({ os = 'ios', storage = memoryStorage(), apple = {}, exchange, renew } = {}) {
  const module = {
    isAvailableAsync: async () => true,
    signInAsync: async () => ({
      user: 'apple-user-1',
      identityToken: 'header.eyJlbWFpbCI6InJlbGF5QHByaXZhdGVyZWxheS5hcHBsZWlkLmNvbSJ9.sig',
      email: null,
      fullName: { givenName: 'Aino', familyName: 'Virtanen' },
    }),
    getCredentialStateAsync: async () => AUTHORIZED,
    ...apple,
  };
  require.cache[APPLE_MODULE] = { id: APPLE_MODULE, filename: APPLE_MODULE, loaded: true, exports: module };
  const auth = requireWithStubs(APPLE_AUTH, {
    'react-native': { Platform: { OS: os } },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    './backupApi': {
      exchangeAppleSession:
        exchange ?? (async () => ({ ok: true, sessionToken: 'vs1.session', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() })),
      renewAppleSession:
        renew ??
        (async () => {
          throw new Error('renewed a session with months left');
        }),
    },
  });
  return { auth, storage };
}

// appleAuth requires the native module lazily, at the call, after
// requireWithStubs has put the cache back — so the stub sits in the cache for
// the length of a test, and each test puts back what was there.
const APPLE_MODULE = require.resolve('expo-apple-authentication', { paths: [path.dirname(APPLE_AUTH)] });

function withAppleCache(run) {
  return async () => {
    const saved = require.cache[APPLE_MODULE];
    try {
      await run();
    } finally {
      if (saved) {
        require.cache[APPLE_MODULE] = saved;
      } else {
        delete require.cache[APPLE_MODULE];
      }
    }
  };
}

const stored = (expiresAt) =>
  JSON.stringify({ user: 'apple-user-1', sessionToken: 'vs1.session', expiresAt: new Date(expiresAt).toISOString() });

module.exports = [
  {
    name: 'apple sign-in: the identity token is traded for a session, kept, and the account is Apple’s own',
    run: withAppleCache(async () => {
      const { auth, storage } = loadApple();
      const result = await auth.signInWithApple();
      assert.equal(result.status, 'signed_in');
      assert.equal(result.account.sub, 'apple:apple-user-1', 'an Apple subject could collide with a Google one');
      assert.equal(result.account.idToken, 'vs1.session', 'the ten-minute identity token was used as the backup token');
      assert.equal(result.account.name, 'Aino Virtanen');
      // Apple sends the email on the credential only the first time; the token carries it every time.
      assert.equal(result.account.email, 'relay@privaterelay.appleid.com');
      assert.equal(JSON.parse(storage.items.get('@vinha/account/apple/v1')).user, 'apple-user-1');
      assert.equal(await auth.hasAppleSession(), true);
    }),
  },
  {
    name: 'apple sign-in: a cancelled sheet, a refused exchange and Android are not a sign-in',
    run: withAppleCache(async () => {
      const cancelled = loadApple({
        apple: {
          signInAsync: async () => {
            throw Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
          },
        },
      });
      assert.deepEqual(await cancelled.auth.signInWithApple(), { status: 'cancelled' });

      const refused = loadApple({ exchange: async () => ({ ok: false }) });
      assert.deepEqual(await refused.auth.signInWithApple(), { status: 'failed' });
      assert.equal(await refused.auth.hasAppleSession(), false, 'a session was kept that the server never issued');

      const android = loadApple({ os: 'android' });
      assert.equal(android.auth.isAppleSignInConfigured(), false);
      assert.deepEqual(await android.auth.signInWithApple(), { status: 'unavailable' });
    }),
  },
  {
    name: 'apple session: renewed in its last month, signed out when revoked or run out, kept when Apple is out of reach',
    run: withAppleCache(async () => {
      const fresh = () => memoryStorage({ '@vinha/account/apple/v1': stored(Date.now() + 100 * DAY) });

      assert.deepEqual(await loadApple({ storage: fresh() }).auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.session' });

      for (const state of [REVOKED, NOT_FOUND]) {
        const { auth } = loadApple({ storage: fresh(), apple: { getCredentialStateAsync: async () => state } });
        assert.deepEqual(await auth.getFreshAppleToken('apple-user-1'), { status: 'signed_out' }, `credential state ${state}`);
      }

      // Offline: Apple cannot be asked, and the server still judges the session.
      const offline = loadApple({
        storage: fresh(),
        apple: {
          getCredentialStateAsync: async () => {
            throw new Error('offline');
          },
        },
      });
      assert.deepEqual(await offline.auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.session' });

      // Within its last 30 days a backup renews it first, and keeps the new one.
      const renewedUntil = new Date(Date.now() + 180 * DAY).toISOString();
      const ending = loadApple({
        storage: memoryStorage({ '@vinha/account/apple/v1': stored(Date.now() + 12 * DAY) }),
        renew: async (token) => {
          assert.equal(token, 'vs1.session');
          return { ok: true, sessionToken: 'vs1.renewed', expiresAt: renewedUntil };
        },
      });
      assert.deepEqual(await ending.auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.renewed' });
      const kept = JSON.parse(ending.storage.items.get('@vinha/account/apple/v1'));
      assert.deepEqual(kept, { user: 'apple-user-1', sessionToken: 'vs1.renewed', expiresAt: renewedUntil });

      // A failed renewal still backs up with the session it has, and tries again next time.
      const unrenewed = loadApple({
        storage: memoryStorage({ '@vinha/account/apple/v1': stored(Date.now() + 12 * DAY) }),
        renew: async () => ({ ok: false }),
      });
      assert.deepEqual(await unrenewed.auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.session' });

      // A revoked sign-in is not renewed.
      const revokedEnding = loadApple({
        storage: memoryStorage({ '@vinha/account/apple/v1': stored(Date.now() + 12 * DAY) }),
        apple: { getCredentialStateAsync: async () => REVOKED },
      });
      assert.deepEqual(await revokedEnding.auth.getFreshAppleToken('apple-user-1'), { status: 'signed_out' });

      // Run out (months offline): one Face ID, not a backup the server refuses.
      const expired = loadApple({ storage: memoryStorage({ '@vinha/account/apple/v1': stored(Date.now() + 10 * 60 * 1000) }) });
      assert.deepEqual(await expired.auth.getFreshAppleToken('apple-user-1'), { status: 'signed_out' });

      // Garbage in storage is no session.
      const broken = loadApple({ storage: memoryStorage({ '@vinha/account/apple/v1': '{"user":1}' }) });
      assert.equal(await broken.auth.hasAppleSession(), false);

      const signedOut = loadApple({ storage: fresh() });
      await signedOut.auth.signOutApple();
      assert.equal(signedOut.storage.items.size, 0);
    }),
  },
  {
    name: 'account auth: the backup token is routed by the account, not by which session is on the phone; a Google sign-in drops the Apple one',
    async run() {
      const calls = [];
      let appleSession = true;
      const load = ({ apple = true, google = true } = {}) =>
        requireWithStubs(ACCOUNT_AUTH, {
          './appleAuth': {
            isAppleSignInConfigured: () => apple,
            APPLE_SUB_PREFIX: 'apple:',
            hasAppleSession: async () => appleSession,
            getFreshAppleToken: async (user) => {
              calls.push(`apple:${user}`);
              return { status: 'ok', idToken: 'apple-session' };
            },
            renewAppleSessionIfDue: async (user) => {
              calls.push(`renew:${user}`);
            },
            signInWithApple: async () => ({ status: 'signed_in', account: { sub: 'apple:x' } }),
            signOutApple: async () => {
              calls.push('signOutApple');
              appleSession = false;
            },
          },
          './googleAuth': {
            isGoogleSignInConfigured: () => google,
            getFreshIdToken: async () => ({ status: 'ok', idToken: 'google-token' }),
            signInWithGoogle: async () => ({ status: 'signed_in', account: { sub: 'g' } }),
            signOutGoogle: async () => {
              calls.push('signOutGoogle');
            },
          },
        });

      const auth = load();
      // Apple first, as Apple asks.
      assert.deepEqual(auth.availableSignInProviders(), ['apple', 'google']);
      assert.deepEqual(load({ apple: false }).availableSignInProviders(), ['google']);
      assert.equal(load({ apple: false, google: false }).isAccountSignInConfigured(), false);
      assert.deepEqual(await load({ apple: false }).signInWith('apple'), { status: 'unavailable' });

      assert.deepEqual(await auth.getFreshIdToken('apple:apple-user-1'), { status: 'ok', idToken: 'apple-session' });
      assert.deepEqual(calls, ['apple:apple-user-1'], 'the token is asked for the account\'s own Apple user');
      // A Google account on a phone where an Apple session is still lying about
      // (a renewal or sign-in that finished after a sign-out) is Google's.
      calls.length = 0;
      assert.deepEqual(await auth.getFreshIdToken('google-sub-1'), { status: 'ok', idToken: 'google-token' });
      assert.deepEqual(calls, [], 'a stale Apple session decided whose backup this was');
      await auth.renewSessionIfDue('google-sub-1');
      await auth.renewSessionIfDue('apple:apple-user-1');
      assert.deepEqual(calls, ['renew:apple-user-1'], 'only an Apple account renews an Apple session');
      calls.length = 0;
      await auth.signInWith('google');
      assert.deepEqual(calls, ['signOutApple'], 'a Google sign-in kept the Apple session that routes backups');

      calls.length = 0;
      await auth.signOutAccount();
      assert.deepEqual(calls, ['signOutApple', 'signOutGoogle']);
    },
  },
  {
    name: 'apple session: a renewal in flight across a sign-out, or across another account signing in, writes nothing back',
    run: withAppleCache(async () => {
      const KEY = '@vinha/account/apple/v1';
      const inWindow = () => memoryStorage({ [KEY]: stored(Date.now() + 12 * DAY) });
      const held = () => {
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        return { gate, release };
      };

      // Sign-out while the renewal is on its way: the old session must not come back.
      const first = held();
      const a = loadApple({
        storage: inWindow(),
        renew: async () => {
          await first.gate;
          return { ok: true, sessionToken: 'vs1.renewed', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() };
        },
      });
      const pending = a.auth.getFreshAppleToken('apple-user-1');
      await new Promise((resolve) => setImmediate(resolve));
      await a.auth.signOutApple();
      first.release();
      assert.deepEqual(await pending, { status: 'error' }, 'a renewal after sign-out was handed on as a session');
      assert.equal(a.storage.items.has(KEY), false, 'the renewed session was written after the sign-out');

      // Sign-out, then another Apple user signs in, then the held renewal lands.
      const second = held();
      const b = loadApple({
        storage: inWindow(),
        renew: async () => {
          await second.gate;
          return { ok: true, sessionToken: 'vs1.renewed-p1', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() };
        },
        apple: {
          signInAsync: async () => ({ user: 'apple-user-2', identityToken: 'h.e30.s', email: null, fullName: null }),
        },
        exchange: async () => ({ ok: true, sessionToken: 'vs1.p2', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() }),
      });
      const renewing = b.auth.getFreshAppleToken('apple-user-1');
      await new Promise((resolve) => setImmediate(resolve));
      await b.auth.signOutApple();
      assert.equal((await b.auth.signInWithApple()).status, 'signed_in');
      second.release();
      await renewing;
      const kept = JSON.parse(b.storage.items.get(KEY));
      assert.equal(kept.user, 'apple-user-2', 'the first account\'s renewed session replaced the second one\'s');
      assert.equal(kept.sessionToken, 'vs1.p2');
    }),
  },
  {
    name: 'apple sign-in: one that finishes after a sign-out is not kept, and a session of another user is never this account\'s',
    run: withAppleCache(async () => {
      const KEY = '@vinha/account/apple/v1';
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const a = loadApple({
        exchange: async () => {
          await gate;
          return { ok: true, sessionToken: 'vs1.late', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() };
        },
      });
      const signingIn = a.auth.signInWithApple();
      await new Promise((resolve) => setImmediate(resolve));
      await a.auth.signOutApple();
      release();
      assert.deepEqual(await signingIn, { status: 'cancelled' });
      assert.equal(a.storage.items.has(KEY), false, 'a sign-in that Reset overtook left its session behind');

      // The session on the phone is apple-user-1's; an account of another user gets none of it.
      const b = loadApple({ storage: memoryStorage({ [KEY]: stored(Date.now() + 100 * DAY) }) });
      assert.deepEqual(await b.auth.getFreshAppleToken('apple-user-2'), { status: 'signed_out' });
      assert.deepEqual(await b.auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.session' });
    }),
  },
  {
    name: 'apple sign-in: the name Apple sends once survives a failed exchange or write for the retry in this run, and never reaches the disk before the sign-in worked',
    run: withAppleCache(async () => {
      const KEY = '@vinha/account/apple/v1';
      const good = async () => ({ ok: true, sessionToken: 'vs1.session', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() });
      const authorizations = (names) => {
        let call = 0;
        return {
          signInAsync: async () => ({
            user: 'apple-user-1',
            identityToken: 'h.e30.s',
            email: null,
            fullName: names[Math.min(call++, names.length - 1)],
          }),
        };
      };
      const aino = { givenName: 'Aino', familyName: 'Virtanen' };

      // The exchange fails after the authorization: the retry's authorization carries no name.
      let exchangeOk = false;
      const first = loadApple({
        apple: authorizations([aino, null]),
        exchange: async () => (exchangeOk ? good() : { ok: false }),
      });
      assert.deepEqual(await first.auth.signInWithApple(), { status: 'failed' });
      // A phone with no account keeps no name and no Apple user id on disk.
      assert.equal(first.storage.items.size, 0, 'a failed sign-in left the reader\'s name or Apple id on the disk');
      exchangeOk = true;
      const retry = await first.auth.signInWithApple();
      assert.equal(retry.status, 'signed_in');
      assert.equal(retry.account.name, 'Aino Virtanen', 'the name Apple sends once was lost with the failed attempt');
      // Only the session is in the row.
      assert.deepEqual(Object.keys(JSON.parse(first.storage.items.get(KEY))).sort(), ['expiresAt', 'sessionToken', 'user']);

      // The write of the session fails instead.
      const flaky = memoryStorage();
      const realSet = flaky.setItem;
      let refuse = true;
      flaky.setItem = async (key, value) => {
        if (refuse && JSON.parse(value).sessionToken) {
          throw new Error('disk full');
        }
        return realSet.call(flaky, key, value);
      };
      const viaWrite = loadApple({ storage: flaky, apple: authorizations([aino, null]), exchange: good });
      assert.deepEqual(await viaWrite.auth.signInWithApple(), { status: 'failed' });
      assert.equal(flaky.items.size, 0);
      refuse = false;
      const again = await viaWrite.auth.signInWithApple();
      assert.equal(again.account.name, 'Aino Virtanen');

      // Handed over once, and gone with a sign-out.
      const later = await viaWrite.auth.signInWithApple();
      assert.equal(later.account.name, null);
      const out = loadApple({ apple: authorizations([aino, null]), exchange: async () => ({ ok: false }) });
      await out.auth.signInWithApple();
      await out.auth.signOutApple();
      assert.equal(out.storage.items.size, 0);
    }),
  },
  {
    name: 'apple session: a storage read that throws is an error (stay signed in), only a successful read of nothing or junk is signed out',
    run: withAppleCache(async () => {
      const KEY = '@vinha/account/apple/v1';
      const storage = memoryStorage({ [KEY]: stored(Date.now() + 100 * DAY) });
      const realGet = storage.getItem;
      let failing = true;
      storage.getItem = async (key) => {
        if (failing) {
          throw new Error('SQLiteDatabase locked');
        }
        return realGet.call(storage, key);
      };
      const { auth } = loadApple({ storage });
      assert.deepEqual(await auth.getFreshAppleToken('apple-user-1'), { status: 'error' }, 'a transient read failure signed the reader out');
      failing = false;
      assert.deepEqual(await auth.getFreshAppleToken('apple-user-1'), { status: 'ok', idToken: 'vs1.session' });
      assert.deepEqual(await loadApple({ storage: memoryStorage() }).auth.getFreshAppleToken('apple-user-1'), { status: 'signed_out' });
      assert.deepEqual(
        await loadApple({ storage: memoryStorage({ [KEY]: '{"user":1}' }) }).auth.getFreshAppleToken('apple-user-1'),
        { status: 'signed_out' },
      );
    }),
  },
  {
    name: 'apple session: renewed on foreground inside its window, left alone outside it, and a failure never signs anyone out',
    run: withAppleCache(async () => {
      const KEY = '@vinha/account/apple/v1';
      let renewals = 0;
      const renew = async () => {
        renewals += 1;
        return { ok: true, sessionToken: 'vs1.renewed', expiresAt: new Date(Date.now() + 180 * DAY).toISOString() };
      };
      const ending = loadApple({ storage: memoryStorage({ [KEY]: stored(Date.now() + 12 * DAY) }), renew });
      await ending.auth.renewAppleSessionIfDue('apple-user-1');
      assert.equal(renewals, 1);
      assert.equal(JSON.parse(ending.storage.items.get(KEY)).sessionToken, 'vs1.renewed');

      const young = loadApple({ storage: memoryStorage({ [KEY]: stored(Date.now() + 100 * DAY) }), renew });
      await young.auth.renewAppleSessionIfDue('apple-user-1');
      const other = loadApple({ storage: memoryStorage({ [KEY]: stored(Date.now() + 12 * DAY) }), renew });
      await other.auth.renewAppleSessionIfDue('apple-user-2');
      assert.equal(renewals, 1, 'a session outside the window, or another user\'s, was renewed');

      const failing = loadApple({
        storage: memoryStorage({ [KEY]: stored(Date.now() + 12 * DAY) }),
        renew: async () => {
          throw new Error('offline');
        },
      });
      await failing.auth.renewAppleSessionIfDue('apple-user-1');
      assert.equal(JSON.parse(failing.storage.items.get(KEY)).sessionToken, 'vs1.session', 'a failed renewal touched the session');
    }),
  },
  {
    name: 'apple deletion code: asked as the reader confirms, with no scopes, and only ever the account\'s own Apple ID\'s',
    run: withAppleCache(async () => {
      const asked = [];
      const credential = (overrides = {}) => async (options) => {
        asked.push(options);
        return { user: 'apple-user-1', identityToken: 'x.y.z', authorizationCode: 'code-1', email: null, fullName: null, ...overrides };
      };
      let { auth } = loadApple({ apple: { signInAsync: credential() } });
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'ok', code: 'code-1' });
      assert.deepEqual(asked, [{ requestedScopes: [] }], 'a confirmation asked Apple for the name and email again');
      // Another Apple ID on the phone: its grant is not this account's to end.
      ({ auth } = loadApple({ apple: { signInAsync: credential({ user: 'apple-user-2' }) } }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'none' });
      ({ auth } = loadApple({ apple: { signInAsync: credential({ authorizationCode: null }) } }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'none' });
      // Backing out of Apple's sheet is the reader's answer; anything else is no code.
      const failing = (code) => async () => {
        throw Object.assign(new Error('apple'), { code });
      };
      ({ auth } = loadApple({ apple: { signInAsync: failing('ERR_REQUEST_CANCELED') } }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'cancelled' });
      ({ auth } = loadApple({ apple: { signInAsync: failing('ERR_REQUEST_FAILED') } }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'none' });
      ({ auth } = loadApple({ apple: { isAvailableAsync: async () => false } }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'none' });
      ({ auth } = loadApple({ os: 'android' }));
      assert.deepEqual(await auth.appleDeletionCode('apple-user-1'), { status: 'none' });
    }),
  },
  {
    name: 'account auth: only an Apple account asks Apple for a deletion code, for its own Apple user',
    async run() {
      const asked = [];
      const auth = requireWithStubs(ACCOUNT_AUTH, {
        './appleAuth': {
          APPLE_SUB_PREFIX: 'apple:',
          isAppleSignInConfigured: () => true,
          appleDeletionCode: async (user) => {
            asked.push(user);
            return user === 'apple-user-1' ? { status: 'ok', code: 'code-1' } : { status: 'cancelled' };
          },
        },
        './googleAuth': { isGoogleSignInConfigured: () => true },
      });
      assert.deepEqual(await auth.getAccountDeletionGrant('google-sub-1'), { status: 'none' });
      assert.deepEqual(asked, [], 'a Google account opened Apple\'s sheet');
      assert.deepEqual(await auth.getAccountDeletionGrant('apple:apple-user-1'), { status: 'ok', appleAuthorizationCode: 'code-1' });
      assert.deepEqual(await auth.getAccountDeletionGrant('apple:apple-user-2'), { status: 'cancelled' });
      assert.deepEqual(asked, ['apple-user-1', 'apple-user-2']);
    },
  },
];
