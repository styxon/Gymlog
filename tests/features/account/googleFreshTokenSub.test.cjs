const assert = require('node:assert/strict');
const path = require('node:path');

const { requireWithStubs } = require('../../helpers/hookHarness.cjs');

/**
 * Bug hunt (backup/restore, 2026-10-05): the Google silent token was not
 * checked against the account it is used for.
 *
 * accountAuth.getFreshIdToken(sub) routes by provider and, for Apple, refuses a
 * session that belongs to another user ("never sent for it, whatever left it on
 * the phone", appleAuth.getFreshAppleToken). For Google, `sub` is dropped:
 * googleAuth.getFreshIdToken() returns whatever account the native library is
 * signed in as. If the stored account is A and the library holds B (a sign-in
 * that was killed between the provider's success and persistAccount, a sign-out
 * whose signOutGoogle was swallowed and a later sign-in), the backup hook
 * uploads A's phone data to B's cloud copy, or restores B's copy over A's
 * phone — with "backed up" on screen.
 *
 * It asks for A's token while the library holds B: the answer is signed_out,
 * as Apple's is, and B's own token still comes back for B.
 */

const DIST = path.join(__dirname, '..', '..', '..', '.test-dist');
const ACCOUNT_AUTH = path.join(DIST, 'features', 'account', 'accountAuth.js');

function tokenFor(sub) {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `h.${payload}.s`;
}

module.exports = [
  {
    name: 'google sign-in: a silent token that names another account is not handed to the account asking',
    async run() {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'client.apps.googleusercontent.com';
      const GOOGLE_MODULE = require.resolve('@react-native-google-signin/google-signin', { paths: [path.dirname(ACCOUNT_AUTH)] });
      const saved = require.cache[GOOGLE_MODULE];
      require.cache[GOOGLE_MODULE] = {
        id: GOOGLE_MODULE,
        filename: GOOGLE_MODULE,
        loaded: true,
        exports: {
          GoogleSignin: {
            configure() {},
            async hasPlayServices() {
              return true;
            },
            // The library is signed in as account B.
            async signInSilently() {
              return { type: 'success', data: { idToken: tokenFor('google-B'), user: { id: 'google-B', email: 'b@example.com', name: 'B' } } };
            },
            async signOut() {},
          },
        },
      };
      try {
        const auth = requireWithStubs(ACCOUNT_AUTH, {
          'react-native': { Platform: { OS: 'android' } },
          '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
        });
        // The stored account is A.
        const result = await auth.getFreshIdToken('google-A');
        assert.deepEqual(result, { status: 'signed_out' }, "account A was handed account B's ID token");
        // B asking for B's token gets it.
        assert.deepEqual(await auth.getFreshIdToken('google-B'), { status: 'ok', idToken: tokenFor('google-B') });
      } finally {
        if (saved) {
          require.cache[GOOGLE_MODULE] = saved;
        } else {
          delete require.cache[GOOGLE_MODULE];
        }
      }
    },
  },
];
