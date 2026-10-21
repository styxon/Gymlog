const assert = require('node:assert/strict');
const { createHmac, generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { callHandler, loadApiModule, withEnv } = require('../../helpers/apiModule.cjs');
const { createClock, createHookRuntime, deferred, flush, requireWithStubs } = require('../../helpers/hookHarness.cjs');
const { createFakeAsyncStorage } = require('../../storage/fakeAsyncStorage.cjs');

/**
 * The account-safety invariant, run over random sequences (2026-10-02).
 *
 * Two phones (A and B) run the REAL client — useAccountBackup, accountAuth,
 * appleAuth, googleAuth, backupApi and accountStore, compiled in .test-dist —
 * against the REAL server handler (api/backup.ts, transpiled by the repo's
 * apiModule helper) over one shared in-memory blob store. A random sequence of
 * events — sign in (Google or Apple), sign out, log a workout, back up, the
 * automatic backup, the answers to the account-switch questions, Delete cloud
 * backup, Delete account, Reset, the server answering 401 / 502 / not at all,
 * Apple revoking a credential, a deletion made from another phone, a store that
 * cannot answer, the clock jumping past 180 days — is run, and after every
 * step the invariants below are looked at. Nothing here asserts a path the code
 * takes; it asserts what must hold whichever path it takes.
 *
 * What is real: the hook (driven by tests/helpers/hookHarness), every client
 * module under it, the endpoint, its HMAC sessions, its revocation markers, its
 * sweep, and the blob store's etag / ifMatch / allowOverwrite semantics (the
 * fake follows the one in tests/api/backupEndpoint.test.cjs).
 * What is faked: the network (fetch is routed to the handler in-process), Apple
 * (a 1024-bit key pair stands in for Apple's; expo-apple-authentication reports
 * the credential state the test sets), Google (tokeninfo and the native
 * sign-in module), AsyncStorage, the clock (Date.now is a counter the test
 * moves) and the app's two providers (they only hold the database).
 * Simulated since 2026-10-03: an operation held open across a sign-out (and a
 * sign-in to another account) and then released — the `overlap` event. Its
 * request's answer, or its closing account write, is held while the reader
 * signs out and in again, then let through; see invariant 7.
 * Not simulated: two phones hitting the endpoint at the same instant (the race
 * docs/account-backup.md describes).
 *
 * Invariants, after every step:
 *  1. No account's cloud copy holds a workout logged under another account,
 *     unless the reader said yes to a question that named that situation.
 *  2. Once Delete account has landed on the server for an Apple account, no
 *     session issued before it is accepted by anything — on any phone, renewals
 *     included — and a session issued after it is; so a new sign-in works.
 *  3. "Account deleted" is reported only by a phone whose own request deleted
 *     the copy (the answer may have been lost on the way), and then the phone
 *     is signed out.
 *  4. INVALID_TOKEN, a 502 and a network failure never sign a phone out; a
 *     SESSION_REVOKED / SESSION_EXPIRED that an Apple session was answered with
 *     always does; a Google token's 401 (any code) never does.
 *  5. A signed-out phone holds no Apple session and no account record.
 *  6. No step throws or leaves a promise rejected, and what the hook says
 *     (signed in / out) is what is stored.
 *  7. What an operation that sign-out overtook says or writes late — an answer
 *     (SESSION_REVOKED included), a closing account write — changes nothing: the
 *     stored account, the signed-out marks and the "sign-in ended" notice are
 *     what they were just before it was let through. (Held-operation shapes found
 *     by hunt 3, 2026-10-03: a late SESSION_REVOKED signed the NEXT account out;
 *     a late closing write's "forget the signed-out marks" erased the mark that
 *     sign-out had just written.)
 *
 * KNOWN GAPS — none. The first run (2026-10-02) failed on main in two places:
 *  - 5: a phone signed out by Apple (credential revoked, session run out) kept
 *    its Apple session (signIn@A:P2, appleRevoked:P2, deleteAccount@A);
 *  - 3: "account deleted" on any SESSION_REVOKED with a pending-delete record,
 *    though that request never reached the server and another phone deleted
 *    (signIn@A:P1, deleteAccount@A+net_before, elsewhere:P1, signIn@B:P1, deleteAccount@A).
 * Both were fixed in #273 (full sign-out on signed_out; the server names the
 * deleting request) and their relaxations removed: the run holds both as stated.
 *
 * Reproduce a failure: ACCOUNT_SAFETY_SEED=<seed> ACCOUNT_SAFETY_SEQUENCES=<n>
 * node tests/run-tests.cjs; the failing sequence is printed, already shrunk.
 * ACCOUNT_SAFETY_REPLAY runs one sequence given by hand (see parseEvents),
 * ACCOUNT_SAFETY_STATS=1 prints what the sequences reached.
 */

const DIST = path.join(__dirname, '..', '..', '..', '.test-dist');
const ACCOUNT_DIR = path.join(DIST, 'features', 'account');
const HOOK = path.join(ACCOUNT_DIR, 'useAccountBackup.js');

const DAY = 24 * 60 * 60 * 1000;
const QUIET_MS = 8000;
const API_URL = 'https://backup.test/api/backup';
const SECRET = 'test-secret';
const CLIENT_ID = 'client.apps.googleusercontent.com';
const BUNDLE_ID = 'app.vinha';
const ACCOUNT_KEY = '@vinha/account/v1';
const APPLE_SESSION_KEY = '@vinha/account/apple/v1';
const SIGNED_OUT_KEY = '@vinha/account/signedout/v1';
const START_MS = Date.UTC(2026, 9, 2, 12, 0, 0);

const SEQUENCES = Number(process.env.ACCOUNT_SAFETY_SEQUENCES) || 2000;
const SEED = Number(process.env.ACCOUNT_SAFETY_SEED) || 20261002;

const IGNORE = new Set(String(process.env.ACCOUNT_SAFETY_IGNORE ?? '').split(',').filter(Boolean));
// ACCOUNT_SAFETY_STATS=1 prints how often each thing happened, to show the sequences reach what they claim to.
const STATS = process.env.ACCOUNT_SAFETY_STATS ? new Map() : null;
const count = (key) => STATS?.set(key, (STATS.get(key) ?? 0) + 1);
const ACCOUNTS = ['G1', 'G2', 'P1', 'P2'];
const isApple = (account) => account.startsWith('P');
const subOf = (account) => (isApple(account) ? `apple:${account}` : account);
const accountOfSub = (sub) => (sub.startsWith('apple:') ? sub.slice('apple:'.length) : sub);

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The blob store, following @vercel/blob as the repo's other fakes do
// ---------------------------------------------------------------------------

class BlobError extends Error {}
class BlobNotFoundError extends BlobError {}
class BlobPreconditionFailedError extends BlobError {}

function createStore() {
  const blobs = new Map();
  let counter = 0;
  const store = {
    failGets: null,
    failPuts: null,
    delLog: [],
    body(pathname) {
      return blobs.get(pathname)?.body ?? null;
    },
    async head(pathname) {
      if (!blobs.has(pathname)) {
        throw new BlobNotFoundError();
      }
      return { etag: blobs.get(pathname).etag };
    },
    async get(pathname) {
      if (store.failGets?.(pathname)) {
        throw new Error('store unavailable');
      }
      const entry = blobs.get(pathname);
      if (!entry) {
        return null;
      }
      return {
        statusCode: 200,
        stream: new Blob([entry.body]).stream(),
        blob: { etag: entry.etag, uploadedAt: new Date(entry.uploaded) },
      };
    },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const all = [...blobs.keys()].filter((name) => name.startsWith(prefix) && (!cursor || name > cursor)).sort();
      const page = all.slice(0, limit);
      return {
        blobs: page.map((name) => ({ pathname: name, uploadedAt: new Date(blobs.get(name).uploaded) })),
        hasMore: all.length > page.length,
        cursor: all.length > page.length ? page[page.length - 1] : undefined,
      };
    },
    async put(pathname, body, options = {}) {
      if (store.failPuts?.(pathname)) {
        throw new Error('store unavailable');
      }
      const existing = blobs.get(pathname);
      if (options.ifMatch !== undefined && options.ifMatch !== existing?.etag) {
        throw existing ? new BlobPreconditionFailedError() : new BlobNotFoundError();
      }
      if (options.allowOverwrite === false && existing) {
        throw new BlobError('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      }
      counter += 1;
      const etag = `"e${counter}"`;
      blobs.set(pathname, { body, etag, uploaded: Date.now() });
      return { etag };
    },
    async del(pathnames) {
      for (const pathname of [].concat(pathnames)) {
        blobs.delete(pathname);
        store.delLog.push(pathname);
      }
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// The world one sequence runs in
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'apple-key-1', alg: 'RS256', use: 'sig' };

function appleIdentityToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'apple-key-1' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: 'https://appleid.apple.com', aud: BUNDLE_ID, sub: user, iat: now, exp: now + 600, email: `${user.toLowerCase()}@relay.test` }),
  ).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const googleIdToken = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
const googleSubOfToken = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub ?? null;
  } catch {
    return null;
  }
};

const claimsOfSession = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const backupPathOf = (sub) => `backups/${createHmac('sha256', SECRET).update(sub).digest('hex')}.json`;

/** A broken invariant: its text starts with the number of the invariant. */
class Violation extends Error {}

/** A broken invariant found by the checks after a step (those named in ACCOUNT_SAFETY_IGNORE are skipped while exploring). */
function bad(message) {
  if (!IGNORE.has(message.split(':')[0])) {
    throw new Violation(message);
  }
}

/** Inside the fake network a throw would be read by the client as a lost connection: record it, report it after the step. */
function note(message) {
  if (!IGNORE.has(message.split(':')[0]) && !world.violations.length) {
    world.violations.push(message);
  }
}

let world = null;
let handler = null;
let phones = null;

const blobModule = {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  head: (...args) => world.store.head(...args),
  get: (...args) => world.store.get(...args),
  list: (...args) => world.store.list(...args),
  put: (...args) => world.store.put(...args),
  del: (...args) => world.store.del(...args),
};

function freshWorld() {
  return {
    now: START_MS,
    store: createStore(),
    // Every session the server has handed out: token -> { sub, iatMs, expMs }.
    issued: new Map(),
    // Apple sub -> when its delete landed on the server.
    deletedAt: new Map(),
    appleRevoked: new Set(),
    // Apple subs whose revocation record has been overwritten with junk and not yet read.
    corrupt: new Set(),
    nextApple: null,
    nextGoogle: null,
    active: null,
    fault: null,
    consent: new Map(ACCOUNTS.map((account) => [account, new Set()])),
    counter: 0,
    unhandled: [],
    violations: [],
  };
}

function respond(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

const faultApplies = (fault, vs1) => (fault.kind === 'g401' ? !vs1 : fault.kind === 'deleted_elsewhere' ? vs1 : true);

/**
 * One request to the endpoint — a phone's, or (who === null) another phone's
 * the test plays. Applies the armed fault, then checks what the endpoint
 * answered against what the invariants say it must.
 */
async function serverCall(req, who) {
  const bearer = String(req.headers.authorization ?? '').slice('Bearer '.length);
  const action = req.headers['x-backup-action'];
  const vs1 = bearer.startsWith('vs1.');
  const fault = who && world.fault && faultApplies(world.fault, vs1) ? world.fault : null;
  if (fault) {
    world.fault = null;
  }
  const deliver = async (result) => {
    count(`answer ${action ?? req.method} ${result.status} ${result.body?.error ?? ''}${vs1 ? ' (vs1)' : ''}`);
    // The overlap event holds one answer back: the server did its part, the phone has not heard yet.
    const hold = who?.hold;
    let stale = false;
    if (hold?.kind === 'request' && hold.armed) {
      if (hold.skip > 0) {
        hold.skip -= 1;
      } else {
        hold.armed = false;
        hold.reached = true;
        await hold.gate.promise;
        stale = true;
      }
    }
    who?.seen.push({ status: result.status, error: result.body?.error, vs1, op: action ?? req.method, stale });
    return respond(result.status, result.body);
  };
  if (fault?.kind === 'invalid') {
    return deliver({ status: 401, body: { ok: false, error: 'INVALID_TOKEN' } });
  }
  if (fault?.kind === 'bad502') {
    return deliver({ status: 502, body: { ok: false, error: 'STORE_UNAVAILABLE' } });
  }
  if (fault?.kind === 'net_before') {
    throw new TypeError('Network request failed');
  }
  if (fault?.kind === 'g401') {
    return deliver({ status: 401, body: { ok: false, error: fault.code } });
  }
  if (fault?.kind === 'deleted_elsewhere') {
    await deleteElsewhere(claimsOfSession(bearer).sub);
  }

  world.store.delLog.length = 0;
  const result = await callHandler(handler, { method: req.method, headers: req.headers, body: req.body });
  checkAnswer(req, bearer, action, result);
  if (who && req.method === 'PUT') {
    who.puts += 1;
  }
  noteAnswer(req, bearer, action, result, who);
  if (fault?.kind === 'net_after') {
    throw new TypeError('Network request failed');
  }
  return deliver(result);
}

/** What the endpoint must answer a session of its own, by the model of invariants 2 and 4. */
function checkAnswer(req, bearer, action, result) {
  if (!bearer.startsWith('vs1.')) {
    return;
  }
  const known = world.issued.get(bearer);
  if (!known) {
    note(`2: the endpoint was sent a session it never issued (${action ?? req.method})`);
    return;
  }
  const now = Date.now();
  const label = `${action ?? req.method} with a session of ${known.sub} issued at +${Math.round((known.iatMs - START_MS) / 1000)}s`;
  const deleted = world.deletedAt.get(known.sub);
  let expected;
  if (known.expMs < now) {
    expected = 'SESSION_EXPIRED';
  } else if (world.store.failGets?.('revoked/x') || (world.corrupt.has(known.sub) && world.store.failPuts?.('revoked/x'))) {
    // The record cannot be read, or is unreadable and cannot be rewritten: the endpoint will not guess.
    expected = 'STORE';
  } else if (deleted !== undefined && known.iatMs <= deleted) {
    expected = 'SESSION_REVOKED';
  } else {
    expected = 'ACCEPTED';
  }
  if (expected !== 'STORE' && result.status !== 502) {
    world.corrupt.delete(known.sub);
  }
  if (expected === 'STORE') {
    if (result.status !== 502) {
      note(`2: ${label}: the revocation record could not be read and the answer was ${result.status} ${result.body?.error}`);
    }
    return;
  }
  if (expected === 'ACCEPTED') {
    if (result.status === 401) {
      note(`2: ${label}: a session issued after the account's deletion (or never deleted) was refused ${result.body?.error}`);
    }
    return;
  }
  if (result.status !== 401 || result.body?.error !== expected) {
    note(`2: ${label}: should be refused ${expected}, was answered ${result.status} ${JSON.stringify(result.body)?.slice(0, 80)}`);
  }
}

/** Bookkeeping that follows an answer: sessions issued, deletions landed, whose request deleted. */
function noteAnswer(req, bearer, action, result, who) {
  if ((action === 'apple-session' || action === 'apple-renew') && result.status === 200 && typeof result.body?.sessionToken === 'string') {
    const claims = claimsOfSession(result.body.sessionToken);
    world.issued.set(result.body.sessionToken, { sub: `apple:${claims.sub}`, iatMs: claims.iatMs, expMs: claims.exp * 1000 });
    return;
  }
  if (req.method !== 'DELETE' || action !== 'delete-account') {
    return;
  }
  const sub = bearer.startsWith('vs1.') ? world.issued.get(bearer)?.sub : googleSubOfToken(bearer);
  if (!sub) {
    return;
  }
  if (who && world.store.delLog.includes(backupPathOf(sub))) {
    who.deletedByMe = true;
  }
  if (result.status === 200 && sub.startsWith('apple:')) {
    world.corrupt.delete(sub);
    world.deletedAt.set(sub, Date.now());
  }
}

/** The same account deleted from a phone that is not one of the two: a real exchange, a real DELETE. */
async function deleteElsewhere(user) {
  const exchange = await serverCall(
    { method: 'POST', headers: { authorization: `Bearer ${appleIdentityToken(user)}`, 'x-backup-action': 'apple-session' } },
    null,
  );
  const body = await exchange.json();
  if (!body.ok) {
    note(`2: a sign-in exchange for ${user} was refused: ${JSON.stringify(body)}`);
    return;
  }
  await serverCall({ method: 'DELETE', headers: { authorization: `Bearer ${body.sessionToken}`, 'x-backup-action': 'delete-account' } }, null);
}

async function fakeFetch(url, init = {}) {
  const text = String(url);
  if (text.startsWith('https://appleid.apple.com/auth/keys')) {
    return { ok: true, json: async () => ({ keys: [JWK] }) };
  }
  if (text.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const sub = googleSubOfToken(decodeURIComponent(text.split('id_token=')[1] ?? ''));
    return sub
      ? { ok: true, json: async () => ({ aud: CLIENT_ID, sub, exp: String(Math.floor(Date.now() / 1000) + 3600) }) }
      : { ok: false, json: async () => ({}) };
  }
  if (text === API_URL) {
    const headers = {};
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    return serverCall({ method: init.method ?? 'GET', headers, body: init.body }, world.active);
  }
  throw new Error(`unexpected fetch: ${text}`);
}

// The native modules appleAuth and googleAuth require lazily, at the call.
const appleModule = {
  isAvailableAsync: async () => true,
  async signInAsync() {
    const user = world.nextApple;
    world.appleRevoked.delete(user);
    return { user, identityToken: appleIdentityToken(user), email: null, fullName: { givenName: user, familyName: 'Reader' } };
  },
  getCredentialStateAsync: async (user) => (world.appleRevoked.has(user) ? 0 : 1),
};
const googleAccountOf = (sub) => ({ idToken: googleIdToken(sub), user: { id: sub, email: `${sub}@example.com`, name: sub } });
const googleModule = {
  GoogleSignin: {
    configure() {},
    hasPlayServices: async () => true,
    async signIn() {
      world.active.google = world.nextGoogle;
      return { type: 'success', data: googleAccountOf(world.nextGoogle) };
    },
    async signInSilently() {
      const sub = world.active.google;
      return sub ? { type: 'success', data: googleAccountOf(sub) } : { type: 'noSavedCredentialFound', data: null };
    },
    async signOut() {
      world.active.google = null;
    },
  },
};

// ---------------------------------------------------------------------------
// A phone: the real client, one copy of its modules per phone
// ---------------------------------------------------------------------------

const emptyHistory = () => ({ sessions: [], slotHistory: {}, lastSelectedTemplateId: null });

function accountModuleFiles() {
  return fs
    .readdirSync(ACCOUNT_DIR)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => path.join(ACCOUNT_DIR, entry));
}

function loadPhone(name, createEmptyDatabase) {
  const storage = createFakeAsyncStorage();
  const runtime = createHookRuntime();
  const listeners = new Set();
  // The account feature's modules loaded fresh, so each holds this phone's AsyncStorage.
  for (const file of accountModuleFiles()) {
    delete require.cache[file];
  }
  const { useAccountBackup } = requireWithStubs(HOOK, {
    react: runtime.react,
    'react-native': {
      AppState: {
        addEventListener(_type, listener) {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      },
      Platform: { OS: 'ios' },
    },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  });
  const phone = {
    name,
    storage,
    runtime,
    listeners,
    hook: useAccountBackup,
    base: createEmptyDatabase('fi'),
    clock: null,
    app: null,
    api: null,
    google: null,
    seen: [],
    q: null,
    puts: 0,
    leftBehind: null,
    deletedByMe: false,
    hold: null,
  };
  // The overlap event's held write: applied at the call, as the native executor orders it, but not
  // finished until the test lets it — the closing account write of an operation that sign-out then overtakes.
  const rawSetItem = storage.setItem;
  storage.setItem = async (key, value) => {
    await rawSetItem.call(storage, key, value);
    const hold = phone.hold;
    if (hold?.kind === 'write' && hold.armed && key === ACCOUNT_KEY) {
      if (hold.skip > 0) {
        hold.skip -= 1;
      } else {
        hold.armed = false;
        hold.reached = true;
        await hold.gate.promise;
      }
    }
  };
  return phone;
}

function resetPhone(phone) {
  phone.hold = null;
  phone.storage.rows.clear();
  phone.runtime.unmount();
  phone.listeners.clear();
  phone.clock = createClock();
  phone.google = null;
  phone.seen = [];
  phone.q = null;
  phone.puts = 0;
  phone.leftBehind = null;
  phone.deletedByMe = false;
  phone.api = null;
  phone.app = { database: { ...phone.base, exerciseLibrary: [] }, history: emptyHistory() };
}

function props(phone) {
  const { app } = phone;
  return {
    hydrated: true,
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
    async onRestored() {},
  };
}

function render(phone) {
  phone.api = phone.runtime.render(phone.hook, props(phone));
  return phone.api;
}

function activate(phone) {
  world.active = phone;
  global.setTimeout = phone.clock.setTimeout;
  global.clearTimeout = phone.clock.clearTimeout;
}

/** Lets every operation the phone started finish. */
async function settle(phone) {
  let quiet = 0;
  for (let round = 0; round < 400 && quiet < 3; round += 1) {
    await flush();
    const before = phone.api?.phase;
    render(phone);
    quiet = phone.api.phase === 'idle' && before === 'idle' ? quiet + 1 : 0;
  }
  if (phone.api.phase !== 'idle') {
    throw new Violation(`6: ${phone.name} never finished what it was doing (phase ${phone.api.phase})`);
  }
}

const storedAccount = (phone) => {
  const raw = phone.storage.rows.get(ACCOUNT_KEY);
  return raw ? JSON.parse(raw) : null;
};
const storedAppleSession = (phone) => {
  const raw = phone.storage.rows.get(APPLE_SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
};
const workoutsOn = (phone) => phone.app.database.workoutSessions.map((entry) => entry.id);
const ownerOfWorkout = (id) => id.split('|')[1];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const REQUEST_EVENTS = new Set(['signIn', 'backUp', 'auto', 'answer', 'deleteRemote', 'deleteAccount']);
// What an overlap's held answer may be: mostly the endings that sign a phone out, which is what a late one must not repeat.
const OVERLAP_FAULTS = [null, null, { kind: 'deleted_elsewhere' }, { kind: 'deleted_elsewhere' }, { kind: 'g401', code: 'SESSION_REVOKED' }, { kind: 'g401', code: 'SESSION_EXPIRED' }, { kind: 'net_after' }, { kind: 'bad502' }];
const FAULTS = [
  { kind: 'invalid' },
  { kind: 'bad502' },
  { kind: 'net_before' },
  { kind: 'net_after' },
  { kind: 'g401', code: 'SESSION_REVOKED' },
  { kind: 'g401', code: 'SESSION_EXPIRED' },
  { kind: 'g401', code: 'INVALID_TOKEN' },
  { kind: 'deleted_elsewhere' },
  { kind: 'store_marker_read' },
  { kind: 'store_marker_write' },
  { kind: 'store_copy_read' },
];

function generate(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const length = 6 + Math.floor(random() * 30);
  const events = [];
  for (let index = 0; index < length; index += 1) {
    const roll = random();
    const event = { dt: 2000 + Math.floor(random() * 120000), phone: random() < 0.5 ? 'A' : 'B' };
    if (roll < 0.16) {
      event.t = 'signIn';
      // P2 signs in on phone A only; P1 and the Google accounts on both.
      event.account = pick(event.phone === 'A' ? ACCOUNTS : ['G1', 'G2', 'P1']);
    } else if (roll < 0.21) {
      event.t = 'signOut';
    } else if (roll < 0.36) {
      event.t = 'log';
    } else if (roll < 0.45) {
      event.t = 'backUp';
    } else if (roll < 0.53) {
      event.t = 'auto';
    } else if (roll < 0.57) {
      event.t = 'foreground';
    } else if (roll < 0.67) {
      event.t = 'answer';
      event.yes = random() < 0.5;
    } else if (roll < 0.71) {
      event.t = 'deleteRemote';
    } else if (roll < 0.78) {
      event.t = 'deleteAccount';
    } else if (roll < 0.81) {
      event.t = 'reset';
    } else if (roll < 0.83) {
      event.t = 'relaunch';
    } else if (roll < 0.86) {
      event.t = 'elsewhere';
      event.account = pick(['P1', 'P2']);
    } else if (roll < 0.89) {
      event.t = 'appleRevoked';
      event.account = pick(['P1', 'P2']);
    } else if (roll < 0.91) {
      event.t = 'googleLost';
    } else if (roll < 0.93) {
      event.t = 'corruptMarker';
      event.account = pick(['P1', 'P2']);
    } else if (roll < 0.99) {
      // An operation's answer or closing write held open while the reader signs out (and maybe in again).
      event.t = 'overlap';
      event.hold = { kind: pick(['request', 'write']), nth: pick([0, 0, 1, 1, 1, 2]) };
      event.op = pick(['auto', 'backUp', 'answer']);
      event.yes = random() < 0.5;
      event.account = random() < 0.6 ? pick(event.phone === 'A' ? ACCOUNTS : ['G1', 'G2', 'P1']) : null;
      event.fault = pick(OVERLAP_FAULTS) ?? undefined;
    } else {
      event.t = 'clock';
      event.dt = pick([1 * DAY, 1 * DAY, 20 * DAY, 20 * DAY, 151 * DAY, 160 * DAY, 179 * DAY + 23 * 3600000, 181 * DAY, 400 * DAY]);
    }
    if (event.t !== 'overlap' && REQUEST_EVENTS.has(event.t) && random() < 0.3) {
      event.fault = pick(FAULTS);
    }
    events.push(event);
  }
  return events;
}

// ACCOUNT_SAFETY_REPLAY="signIn@A:P1,elsewhere:P1,deleteAccount@A+bad502,deleteAccount@A" runs just that sequence:
// kind[@phone][:account | :yes | :no | :days][+fault[:code]], as describe() prints them.
const REPLAY = process.env.ACCOUNT_SAFETY_REPLAY;
function parseEvents(text) {
  return text.split(',').map((part) => {
    const [head, faultText] = part.trim().split('+');
    const [kindAndPhone, arg] = head.split(':');
    const [t, phone = 'A'] = kindAndPhone.split('@');
    const event = { t, phone, dt: 5000 };
    if (t === 'overlap') {
      // overlap@A:<request|write>.<nth>.<auto|backUp|answer>.<account|->
      const [kind, nth, op, account] = arg.split('.');
      event.hold = { kind, nth: Number(nth) };
      event.op = op;
      event.yes = false;
      event.account = account && account !== '-' ? account : null;
    } else if (arg === 'yes' || arg === 'no') {
      event.yes = arg === 'yes';
    } else if (t === 'clock') {
      event.dt = Number(arg) * DAY;
    } else if (arg) {
      event.account = arg;
    }
    if (faultText) {
      const [kind, code] = faultText.split(':');
      event.fault = code ? { kind, code } : { kind };
    }
    return event;
  });
}

const PHONELESS = new Set(['clock', 'elsewhere', 'appleRevoked', 'corruptMarker']);
function describe(event) {
  if (event.t === 'overlap') {
    const fault = event.fault ? ` +${event.fault.kind}${event.fault.code ? `:${event.fault.code}` : ''}` : '';
    return `overlap@${event.phone}:${event.hold.kind}.${event.hold.nth}.${event.op}.${event.account ?? '-'}${fault}`;
  }
  const where = PHONELESS.has(event.t) ? '' : `@${event.phone}`;
  const account = event.account ? `(${event.account})` : '';
  const yes = event.yes === undefined ? '' : event.yes ? '(yes)' : '(no)';
  const fault = event.fault ? ` +${event.fault.kind}${event.fault.code ? `:${event.fault.code}` : ''}` : '';
  const jump = event.t === 'clock' ? `(+${Math.round(event.dt / DAY)}d)` : '';
  return `${event.t}${where}${account}${yes}${jump}${fault}`;
}

/** Why the phone's own token fetch would say "signed out" as this event starts. */
function reasonToSignOut(phone, account) {
  if (account.sub.startsWith('apple:')) {
    const session = storedAppleSession(phone);
    if (!session) {
      return 'no session';
    }
    if (world.appleRevoked.has(accountOfSub(account.sub))) {
      return 'apple revoked';
    }
    if (Date.parse(session.expiresAt) - Date.now() < 60 * 60 * 1000) {
      return 'expired locally';
    }
    return null;
  }
  return phone.google === null ? 'google credential lost' : null;
}

async function runEvent(event) {
  world.now += event.dt;
  count(`event ${event.t}${event.fault ? ` +${event.fault.kind}` : ''}`);
  world.fault = null;
  world.store.failGets = null;
  world.store.failPuts = null;
  const fault = event.fault;
  if (fault?.kind === 'store_marker_read') {
    world.store.failGets = (pathname) => pathname.startsWith('revoked/');
  } else if (fault?.kind === 'store_marker_write') {
    world.store.failPuts = (pathname) => pathname.startsWith('revoked/');
  } else if (fault?.kind === 'store_copy_read') {
    world.store.failGets = (pathname) => pathname.startsWith('backups/');
  } else if (fault) {
    world.fault = fault;
  }

  const outcome = { event, deleteResult: null, signInOutcome: null, wasSignedIn: false, phone: null, skipped: false };
  if (event.t === 'clock') {
    return outcome;
  }
  if (event.t === 'elsewhere') {
    await deleteElsewhere(event.account);
    return outcome;
  }
  if (event.t === 'appleRevoked') {
    world.appleRevoked.add(event.account);
    return outcome;
  }
  if (event.t === 'corruptMarker') {
    // A revocation record that cannot be read: the endpoint resolves it to the time the store wrote it.
    // Only a record that exists: it was written by a deletion.
    const marker = `revoked/${createHmac('sha256', SECRET).update(`revoked:apple:${event.account}`).digest('hex')}.json`;
    if (world.store.body(marker) !== null) {
      await world.store.put(marker, '{not json', { allowOverwrite: true });
      world.deletedAt.set(`apple:${event.account}`, Date.now());
      world.corrupt.add(`apple:${event.account}`);
    }
    return outcome;
  }

  const phone = phones[event.phone];
  outcome.phone = phone;
  activate(phone);
  phone.seen = [];
  outcome.startAccount = storedAccount(phone);
  outcome.wasSignedIn = outcome.startAccount !== null;
  outcome.reason = outcome.startAccount ? reasonToSignOut(phone, outcome.startAccount) : null;
  render(phone);

  switch (event.t) {
    case 'signIn': {
      if (outcome.wasSignedIn) {
        outcome.skipped = true;
        break;
      }
      if (isApple(event.account)) {
        world.nextApple = event.account;
      } else {
        world.nextGoogle = event.account;
      }
      phone.deletedByMe = false;
      const result = await phone.api.signIn(isApple(event.account) ? 'apple' : 'google');
      outcome.signInOutcome = result;
      count(`signIn ${event.account} -> ${result.kind}`);
      noteQuestion(phone, event.account, result);
      break;
    }
    case 'signOut':
      await phone.api.signOut();
      phone.q = null;
      break;
    case 'log': {
      const account = storedAccount(phone);
      world.counter += 1;
      const id = `w|${account ? accountOfSub(account.sub) : 'anon'}|${world.counter}`;
      phone.app.database = {
        ...phone.app.database,
        workoutSessions: [
          ...phone.app.database.workoutSessions,
          { id, workoutTemplateId: 'tpl_x', workoutNameSnapshot: 'Push', performedAt: '2026-09-01T10:00:00.000Z' },
        ],
      };
      break;
    }
    case 'backUp': {
      const account = storedAccount(phone);
      const result = await phone.api.backUpOrAsk();
      count(`backUp -> ${result.kind}`);
      if (account) {
        noteQuestion(phone, accountOfSub(account.sub), result);
      }
      break;
    }
    case 'auto':
      phone.clock.advance(QUIET_MS);
      break;
    case 'foreground':
      for (const listener of [...phone.listeners]) {
        listener('background');
        listener('active');
      }
      phone.clock.advance(QUIET_MS);
      break;
    case 'answer':
      await answer(phone, event.yes);
      break;
    case 'deleteRemote':
      outcome.deleteRemote = await phone.api.deleteRemoteBackup();
      count(`deleteRemote -> ${outcome.deleteRemote}`);
      outcome.deleteRemoteSub = outcome.startAccount?.sub ?? null;
      break;
    case 'deleteAccount':
      outcome.deleteResult = await phone.api.deleteAccount();
      count(`deleteAccount -> ${outcome.deleteResult}`);
      break;
    case 'reset':
      await phone.api.signOut();
      phone.q = null;
      phone.app.database = { ...phone.base, exerciseLibrary: [] };
      phone.app.history = emptyHistory();
      break;
    case 'relaunch':
      // The app is closed and opened: what was only in memory (the open question) is gone.
      phone.runtime.unmount();
      phone.q = null;
      break;
    case 'googleLost':
      phone.google = null;
      break;
    case 'overlap':
      if (!outcome.wasSignedIn) {
        outcome.skipped = true;
        break;
      }
      await overlap(phone, event, outcome);
      break;
    default:
      throw new Error(`unknown event ${event.t}`);
  }
  await settle(phone);
  return outcome;
}

/** What a late, overtaken operation must leave exactly as it is (invariant 7). */
function snapshot(phone) {
  render(phone);
  return {
    account: phone.storage.rows.get(ACCOUNT_KEY) ?? null,
    marks: phone.storage.rows.get(SIGNED_OUT_KEY) ?? null,
    notice: phone.api.sessionEndedNotice,
  };
}

/**
 * One operation of the phone held open — its Nth request's answer, or its Nth
 * account write, not yet finished — while the reader signs out and, maybe, in as
 * another account; then the held thing is let through. The two operations of one
 * phone in flight at once that this file used to leave out.
 */
let lastOverlap = null;
async function overlap(phone, event, outcome) {
  lastOverlap = { reached: false, stale: [], late: null };
  const hold = { kind: event.hold.kind, skip: event.hold.nth, armed: true, reached: false, gate: deferred() };
  phone.hold = hold;
  let operation = null;
  let asked = null;
  let late = null;
  if (event.op === 'auto') {
    phone.clock.advance(QUIET_MS);
  } else if (event.op === 'backUp') {
    const account = storedAccount(phone);
    operation = phone.api.backUpOrAsk().then((result) => {
      asked = account ? { account: accountOfSub(account.sub), result } : null;
      late = result.kind;
    });
  } else {
    operation = answer(phone, event.yes);
  }
  render(phone);
  for (let round = 0; round < 80 && !hold.reached; round += 1) {
    await flush();
    render(phone);
    if (phone.api.phase === 'idle') {
      break;
    }
  }
  // The faults were for the held operation; the sign-in below meets a healthy network.
  world.fault = null;
  world.store.failGets = null;
  world.store.failPuts = null;
  if (!hold.reached) {
    // The operation ended without ever getting that far: nothing was overtaken.
    phone.hold = null;
    await operation;
    if (asked) {
      noteQuestion(phone, asked.account, asked.result);
    }
    return;
  }
  count(`overlap held ${hold.kind} of ${event.op}`);
  lastOverlap.reached = true;
  await phone.api.signOut();
  phone.q = null;
  phone.seen = [];
  if (event.account) {
    if (isApple(event.account)) {
      world.nextApple = event.account;
    } else {
      world.nextGoogle = event.account;
    }
    const result = await phone.api.signIn(isApple(event.account) ? 'apple' : 'google');
    count(`overlap then signIn ${event.account} -> ${result.kind}`);
    noteQuestion(phone, event.account, result);
  }
  await settle(phone);
  const before = snapshot(phone);
  hold.gate.resolve();
  phone.hold = null;
  await operation;
  await settle(phone);
  outcome.overlap = { before, after: snapshot(phone), stale: phone.seen.filter((entry) => entry.stale), late };
  lastOverlap.stale = outcome.overlap.stale;
  lastOverlap.late = late;
  count(`overlap released after ${event.account ? 'a sign-in' : 'sign-out'}${outcome.overlap.stale.length ? ` (answered ${outcome.overlap.stale[0].status} ${outcome.overlap.stale[0].error ?? ''})` : ''}`);
}

/** Remembers what was asked: the answer is only ever a yes or a no to that. */
function noteQuestion(phone, account, result) {
  if (result.kind === 'confirm_upload') {
    phone.q = { kind: 'upload', account, named: true };
  } else if (result.kind === 'choice') {
    phone.q = { kind: 'choice', account, named: result.summary.localFromOtherAccount === true };
  }
}

async function answer(phone, yes) {
  const q = phone.q;
  if (!q) {
    // Nothing is being asked: an answer must do nothing at all.
    await (yes ? phone.api.resolveUploadChoice('upload') : phone.api.resolveUploadChoice('skip'));
    return;
  }
  phone.q = null;
  // A yes counts only for a question that said whose data it is; the rows it covers
  // are the ones on the phone now. If nothing was sent, it covered nothing.
  const granted = yes && q.named ? grantConsent(phone, q.account) : [];
  const putsBefore = phone.puts;
  const result =
    q.kind === 'upload'
      ? await phone.api.resolveUploadChoice(yes ? 'upload' : 'skip')
      : await phone.api.resolveRestoreChoice(yes ? 'keep_local' : 'restore');
  count(`answer ${q.kind}${q.named ? ' named' : ''} ${yes ? 'yes' : 'no'} -> ${result}`);
  // An upload that reached the server and whose answer was lost did land: the yes stands.
  if (phone.puts === putsBefore) {
    for (const id of granted) {
      world.consent.get(q.account).delete(id);
    }
  }
}

function grantConsent(phone, account) {
  const added = [];
  for (const id of workoutsOn(phone)) {
    if (!world.consent.get(account).has(id)) {
      world.consent.get(account).add(id);
      added.push(id);
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// The invariants
// ---------------------------------------------------------------------------

/** An Apple session the phone itself would still send: credential standing, outside the expiry margin. */
function sessionStillTrusted(session) {
  return !world.appleRevoked.has(session.user) && Date.parse(session.expiresAt) - Date.now() >= 60 * 60 * 1000;
}

const signingOutEvent = (event) => event.t === 'signOut' || event.t === 'reset' || event.t === 'deleteAccount' || event.t === 'overlap';

function checkAfter(outcome) {
  const { event, phone } = outcome;
  if (world.violations.length > 0) {
    throw new Violation(world.violations[0]);
  }
  if (world.unhandled.length > 0) {
    bad(`6: an unhandled rejection: ${world.unhandled[0]}`);
  }

  // 1. Whose workouts are in whose copy.
  for (const account of ACCOUNTS) {
    const body = world.store.body(backupPathOf(subOf(account)));
    if (body === null) {
      continue;
    }
    for (const entry of JSON.parse(body).database?.workoutSessions ?? []) {
      const owner = ownerOfWorkout(entry.id);
      if (owner !== 'anon' && owner !== account && !world.consent.get(account).has(entry.id)) {
        bad(`1: ${account}'s cloud copy holds ${entry.id}, logged under ${owner}, with no yes to a question that named it`);
      }
    }
  }

  // 5. A signed-out phone holds nothing of an Apple sign-in, trusted or not.
  for (const each of Object.values(phones)) {
    const session = storedAppleSession(each);
    if (storedAccount(each) || !session) {
      each.leftBehind = null;
      continue;
    }
    // Judged as it was when the phone signed out, not by what Apple says since.
    const raw = JSON.stringify(session);
    if (each.leftBehind?.raw !== raw) {
      each.leftBehind = { raw, trusted: sessionStillTrusted(session) };
    }
    {
      bad(`5: ${each.name} is signed out (no account record) but still holds an Apple session${each.leftBehind.trusted ? '' : ' (one it no longer trusts)'}`);
    }
  }
  if (!phone) {
    return;
  }

  // 6. What the hook shows is what is stored.
  const shown = phone.api.state.status;
  if ((shown === 'signed_in') !== Boolean(storedAccount(phone))) {
    bad(`6: ${phone.name} shows "${shown}" while the stored account is ${storedAccount(phone)?.sub ?? 'none'}`);
  }

  // 3. "Deleted" is said by a phone whose own request deleted, and it is signed out.
  // An earlier request of its own that never got an answer is not proof: only the server naming this
  // phone's request id is (#273).
  const attempted = Boolean(outcome.startAccount?.deleteAccountPendingAt);
  // 'done_apple_kept' is "deleted" too, with a note about Apple's list.
  const saidDeleted = outcome.deleteResult === 'done' || outcome.deleteResult === 'done_apple_kept';
  if (saidDeleted && !phone.deletedByMe) {
    const sub = outcome.startAccount?.sub;
    const copy = sub && world.store.body(backupPathOf(sub)) !== null;
    bad(`3: ${phone.name} reported "account deleted" though no request of its own deleted the copy${attempted ? ' (an earlier request of its own never got an answer)' : ''}${copy ? ' and a copy of the account is there' : ''}`);
  }
  if ((saidDeleted || outcome.deleteResult === 'ended') && storedAccount(phone)) {
    bad(`3: ${phone.name} reported "${outcome.deleteResult}" and is still signed in`);
  }
  if (outcome.deleteRemote === 'done' && outcome.deleteRemoteSub && world.store.body(backupPathOf(outcome.deleteRemoteSub)) !== null) {
    bad(`3: ${phone.name} reported the cloud copy of ${outcome.deleteRemoteSub} deleted and it is there`);
  }

  // 4. What signs a phone out.
  if (outcome.wasSignedIn) {
    const over = phone.seen.find(
      (entry) =>
        !entry.stale && entry.vs1 && entry.op !== 'apple-renew' && entry.status === 401 && (entry.error === 'SESSION_REVOKED' || entry.error === 'SESSION_EXPIRED'),
    );
    const signedOut = storedAccount(phone) === null;
    if (over && !signedOut) {
      bad(`4: ${phone.name} was answered ${over.error} on its Apple session (${over.op}) and stayed signed in`);
    }
    const explained = signingOutEvent(event) && (event.t !== 'deleteAccount' || outcome.deleteResult === 'done' || outcome.deleteResult === 'done_apple_kept' || outcome.deleteResult === 'ended');
    if (signedOut && !explained && !over && !outcome.reason) {
      bad(`4: ${phone.name} was signed out by ${describe(event)} with no SESSION_* answer and no lost credential (answers seen: ${JSON.stringify(phone.seen)})`);
    }
  }

  // 7. What an overtaken operation says or writes late changes nothing.
  if (outcome.overlap) {
    const { before, after, stale, late } = outcome.overlap;
    const what = `${describe(event)}${stale.length ? ` (its held answer: ${stale[0].status} ${stale[0].error ?? ''})` : ''}`;
    if (after.account !== before.account) {
      bad(`7: ${phone.name}'s stored account changed when an operation sign-out had overtaken was let through (${what}): ${before.account ? JSON.parse(before.account).sub : 'none'} -> ${after.account ? JSON.parse(after.account).sub : 'none'}`);
    }
    if (after.marks !== before.marks) {
      bad(`7: ${phone.name}'s signed-out marks changed when an operation sign-out had overtaken was let through (${what}): ${before.marks} -> ${after.marks}`);
    }
    if (late === 'choice' || late === 'confirm_upload') {
      // The question was parked for an account that has left: its answer could only say "restore failed".
      bad(`7: ${phone.name} was handed a "${late}" question by an operation sign-out had overtaken (${what})`);
    }
    if (after.notice !== before.notice) {
      bad(`7: ${phone.name}'s "sign-in ended" notice changed when an operation sign-out had overtaken was let through (${what})`);
    }
  }

  // 2. A sign-in nothing was in the way of works.
  if (event.t === 'signIn' && !outcome.skipped && !event.fault) {
    const result = outcome.signInOutcome;
    if (['failed', 'cancelled', 'not_backed_up', 'unavailable', 'restore_failed'].includes(result.kind) || storedAccount(phone) === null) {
      bad(`2: ${describe(event)} with nothing in the way ended "${result.kind}"${storedAccount(phone) === null ? ' and signed out' : ''}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Running sequences
// ---------------------------------------------------------------------------

async function runSequence(events) {
  world = freshWorld();
  Date.now = () => world.now;
  let step = 0;
  try {
    for (const phone of Object.values(phones)) {
      resetPhone(phone);
      activate(phone);
      render(phone);
      await settle(phone);
    }
    for (step = 0; step < events.length; step += 1) {
      let outcome;
      try {
        outcome = await runEvent(events[step]);
      } catch (error) {
        if (error instanceof Violation) {
          throw error;
        }
        throw new Violation(`6: ${describe(events[step])} threw ${error instanceof Error ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`);
      } finally {
        world.store.failGets = null;
        world.store.failPuts = null;
        world.fault = null;
      }
      checkAfter(outcome);
    }
    return null;
  } catch (error) {
    if (error instanceof Violation) {
      return { message: error.message, step };
    }
    throw error;
  } finally {
    for (const phone of Object.values(phones)) {
      phone.runtime.unmount();
    }
  }
}

/** Removes events while the same invariant still fails: the shortest sequence that shows it. */
async function shrink(events, failure) {
  const kind = failure.message.split(':')[0];
  let current = events.slice(0, failure.step + 1);
  let best = failure;
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const candidate = current.filter((_, at) => at !== index);
      const result = await runSequence(candidate);
      if (result && result.message.split(':')[0] === kind) {
        current = candidate.slice(0, result.step + 1);
        best = result;
        changed = true;
        break;
      }
    }
  }
  return { events: current, failure: best };
}

async function withWorld(run) {
  const savedNow = Date.now;
  const savedFetch = global.fetch;
  const savedSetTimeout = global.setTimeout;
  const savedClearTimeout = global.clearTimeout;
  const quiet = console.error;
  const stubbed = new Map();
  const stubModule = (name, exports) => {
    const file = require.resolve(name, { paths: [ACCOUNT_DIR] });
    stubbed.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  const accountCache = new Map(accountModuleFiles().map((file) => [file, require.cache[file]]));
  const { createEmptyDatabase } = require(path.join(DIST, 'data', 'seed.js'));
  const onRejection = (reason) => world?.unhandled.push(reason instanceof Error ? reason.message : String(reason));

  console.error = () => undefined;
  process.on('unhandledRejection', onRejection);
  try {
    await withEnv(
      {
        GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
        BACKUP_PATH_SECRET: SECRET,
        APPLE_BUNDLE_ID: undefined,
        BACKUP_RATE_LIMIT_MAX: '100000000',
        EXPO_PUBLIC_BACKUP_API_URL: API_URL,
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios.client',
        APP_MIN_VERSION_IOS: undefined,
        APP_MIN_VERSION_ANDROID: undefined,
      },
      async () => {
        stubModule('expo-apple-authentication', appleModule);
        stubModule('@react-native-google-signin/google-signin', googleModule);
        global.fetch = fakeFetch;
        world = freshWorld();
        handler = loadApiModule('api/backup.ts', { '@vercel/blob': blobModule }).default;
        phones = { A: loadPhone('phone A', createEmptyDatabase), B: loadPhone('phone B', createEmptyDatabase) };
        await run();
      },
    );
  } finally {
    process.off('unhandledRejection', onRejection);
    console.error = quiet;
    Date.now = savedNow;
    global.fetch = savedFetch;
    global.setTimeout = savedSetTimeout;
    global.clearTimeout = savedClearTimeout;
    for (const cache of [stubbed, accountCache]) {
      for (const [file, entry] of cache) {
        if (entry) {
          require.cache[file] = entry;
        } else {
          delete require.cache[file];
        }
      }
    }
    for (const file of accountModuleFiles()) {
      if (!accountCache.has(file)) {
        delete require.cache[file];
      }
    }
    world = null;
    handler = null;
    phones = null;
  }
}

/**
 * The four shapes hunt 3 found (2026-10-03), run exactly: the random run above
 * reaches them only now and then. Each also asserts that the hold was reached
 * and what was held, so a change to the harness cannot turn them into
 * sequences that never exercise anything.
 */
const PINNED_OVERLAPS = [
  {
    // A late SESSION_REVOKED to the request of the account that left signed the next account out.
    name: "a late SESSION_REVOKED answer does not sign out the account that signed in since",
    replay: 'signIn@A:P2,elsewhere:P2,log@A,overlap@A:request.0.auto.P2',
    check: (last) => assert.deepEqual(last.stale.map((entry) => entry.error), ['SESSION_REVOKED']),
  },
  {
    // A late closing write of a backup forgot the signed-out mark sign-out had just written.
    name: 'a backup\'s closing write, let through after sign-out, does not erase the signed-out mark',
    replay: 'signIn@B:P1,overlap@B:write.1.backUp.-',
    check: () => undefined,
  },
  {
    // The same for the closing write of a restore the reader chose.
    name: "a restore's closing write, let through after sign-out, does not erase the signed-out mark",
    replay: 'signIn@A:G1,log@A,backUp@A,signIn@B:G1,log@B,backUp@B,log@A,backUp@A,overlap@A:write.0.answer.-',
    check: () => undefined,
  },
  {
    // The restore-or-keep question parked after sign-out took the account away was handed out anyway.
    name: 'the restore-or-keep question is not handed out once sign-out has overtaken it',
    replay: 'signIn@A:G1,log@A,backUp@A,signIn@B:G1,log@B,backUp@B,log@A,overlap@A:write.1.backUp.G2',
    check: (last) => assert.notEqual(last.late, 'choice'),
  },
];

module.exports = [
  {
    name: 'account safety: an operation held open across sign-out and let through late changes nothing (pinned shapes of hunt 3)',
    async run() {
      await withWorld(async () => {
        for (const shape of PINNED_OVERLAPS) {
          lastOverlap = null;
          const events = parseEvents(shape.replay);
          const failure = await runSequence(events);
          assert.equal(failure, null, `${shape.name}: ${failure?.message} (at step ${failure ? failure.step + 1 : 0} of ${events.map(describe).join(', ')})`);
          assert.ok(lastOverlap?.reached, `${shape.name}: the hold was never reached, so nothing was tested`);
          shape.check(lastOverlap);
        }
      });
    },
  },
  {
    name: `account safety: ${SEQUENCES} random sequences over two phones, Google and Apple accounts, the real client and the real endpoint, break no invariant`,
    async run() {
      await withWorld(async () => {
        const stats = STATS;
        if (REPLAY) {
          const events = parseEvents(REPLAY);
          const failure = await runSequence(events);
          assert.equal(failure, null, `${failure?.message} (at step ${failure ? failure.step + 1 : 0} of ${events.map(describe).join(', ')})`);
          return;
        }
        const random = mulberry32(SEED);
        for (let index = 0; index < SEQUENCES; index += 1) {
          const events = generate(random);
          const failure = await runSequence(events);
          if (failure) {
            const small = await shrink(events, failure);
            assert.fail(
              [
                `invariant broken (seed ${SEED}, sequence #${index}; reproduce with ACCOUNT_SAFETY_SEED=${SEED} ACCOUNT_SAFETY_SEQUENCES=${index + 1}).`,
                `  ${small.failure.message}`,
                `  shortest sequence (${small.events.length} steps):`,
                ...small.events.map((event, at) => `    ${at + 1}. ${describe(event)}`),
              ].join('\n'),
            );
          }
        }
        if (stats) {
          console.log([...stats].sort().map(([key, n]) => `${n} ${key}`).join('\n'));
        }
      });
    },
  },
];
