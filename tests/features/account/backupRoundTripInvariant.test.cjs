const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { callHandler, loadApiModule, withEnv } = require('../../helpers/apiModule.cjs');
const { createClock, createHookRuntime, flush, requireWithStubs } = require('../../helpers/hookHarness.cjs');
const { createFakeAsyncStorage, loadAgainstFake } = require('../../storage/fakeAsyncStorage.cjs');

/**
 * The backup round-trip invariant (never-list N5, and N6 for backup/restore).
 *
 * "A backup restores what was backed up." Random but realistic databases (and
 * the 16 releases of tests/fixtures/storage-history) go through the REAL path:
 * the real useAccountBackup hook builds the payload (lib/accountBackup, gzip
 * above the threshold), uploads it through the real backupApi to the real
 * api/backup.ts (size cap, ETag versions) over a fake blob store, a second
 * phone downloads and restores it. Four restore situations: the same phone, a
 * fresh phone, a phone holding other data (answer "restore"), a phone last
 * signed in to a different account. After each, the invariants:
 *
 *  1. EVERYTHING ARRIVES. Every backed-up collection equals the original (ids,
 *     order, every field, per-set and planned fields included) and so does the
 *     workout history. Preferences equal too, except the device-only and
 *     privacy fields (DEVICE_ONLY_PREFERENCE_FIELDS, "a no on either side wins"
 *     for usage statistics, the later legal acceptance), which keep the
 *     RESTORING phone's values. What the restore wrote is also what a reload
 *     from disk reads.
 *  2. IDEMPOTENT. backup(restore(backup(x))) is the same payload (compared
 *     without exportedAt and without the fields above); a second fresh phone
 *     restoring it ends the same.
 *  3. CROSS-VERSION. The body an OLDER release would have uploaded (built by
 *     that release's own compiled accountBackup.ts, tests/fixtures/backup-history)
 *     restores on today's code to what today's loader makes of the same stored
 *     rows, and nothing the old data held is gone.
 *  4. SIZE. Payloads at the client's gzip threshold and at the server's cap are
 *     restored whole or refused; a refused upload never reports success and
 *     leaves the cloud copy as it was (N6).
 *  5. NOTHING LOCAL IS DROPPED UNASKED. A phone holding a logged row (workout,
 *     run, measurement, weigh-in beyond setup's, programme, plan) that the copy
 *     lacks, or a live workout, is asked restore-or-keep before anything on it
 *     changes; "keep this phone's data" changes nothing on the phone and
 *     leaves the cloud holding exactly the phone's data. A refused disk write
 *     during a restore says so and changes nothing on the phone.
 *  6. NOTHING THROWS, and emoji, lone surrogates, a BOM, a very long name and
 *     NUL/newline/quote characters come back byte for byte.
 *
 * What is real: the hook (driven by tests/helpers/hookHarness), backupApi,
 * accountStore, accountBackup (build, encode/decode, describe, fingerprint,
 * preferencesForRestore), the endpoint (api/backup.ts: size cap, versions,
 * revocation), storage/database.ts and workoutPersistence (the loaders and the
 * writers, over the fake AsyncStorage with the 2 MB row limit), and the old
 * releases' payload builders.
 * What is modelled: the network (fetch routed to the handler in-process; the
 * body arrives as a string or already parsed, as Vercel hands it over), Google
 * sign-in, the blob store (the fake follows @vercel/blob's etag/ifMatch), the
 * two providers' restore functions (App's AppProvider.restoreDatabaseFromBackup
 * and WorkoutProvider.restoreHistoryFromBackup, rebuilt from the same real
 * normalisers and writers; a source guard below fails when their bodies move),
 * and the data (a generator of realistic databases, a corpus built from past
 * releases' own loaders).
 * Not simulated: two phones writing at one instant (see accountSafetyInvariant),
 * a payload larger than Vercel's own 4.5 MB request limit (the endpoint's cap
 * answers first).
 *
 * Reproduce a failure: BACKUP_ROUNDTRIP_SEED=<seed> BACKUP_ROUNDTRIP_SEQUENCES=<n>
 * node tests/run-tests.cjs prints the shortest case, already shrunk, and the
 * BACKUP_ROUNDTRIP_REPLAY='<json>' that reruns it alone. BACKUP_ROUNDTRIP_STATS=1
 * prints what the cases reached.
 */

const DIST = path.join(__dirname, '..', '..', '..', '.test-dist');
const ACCOUNT_DIR = path.join(DIST, 'features', 'account');
const HOOK = path.join(ACCOUNT_DIR, 'useAccountBackup.js');
const CORPUS_DIR = path.join(__dirname, '..', '..', 'fixtures', 'storage-history');
const OLD_PAYLOAD_DIR = path.join(__dirname, '..', '..', 'fixtures', 'backup-history');

const CASES = Number(process.env.BACKUP_ROUNDTRIP_SEQUENCES) || 1000;
const SEED = Number(process.env.BACKUP_ROUNDTRIP_SEED) || 20261003;
const REPLAY = process.env.BACKUP_ROUNDTRIP_REPLAY;
const STATS = process.env.BACKUP_ROUNDTRIP_STATS ? new Map() : null;
const count = (key) => STATS?.set(key, (STATS.get(key) ?? 0) + 1);

const API_URL = 'https://backup.test/api/backup';
const SECRET = 'test-secret';
const CLIENT_ID = 'client.apps.googleusercontent.com';
const START_MS = Date.UTC(2026, 9, 3, 12, 0, 0);
const SERVER_CAP = 4 * 1024 * 1024;

// The lists the invariant is written against. Held apart from the code's own so
// that a field added to (or taken off) the code's list is a failure here, not a
// silent change of what counts as "this phone's own".
const DEVICE_ONLY = [
  'promoProUntil',
  'proTrialUntil',
  'proTrialStartedAt',
  'mockSubscriptionPurchasedAt',
  'mockSubscriptionTerm',
  'mockSubscriptionCancelledAt',
  'aiCoachProQuota',
  'coachDemoMomentsUsed',
  'firstLaunchAt',
  'pendingAiLogDeletions',
  'seenServerNoticeIds',
];
const PRIVACY = ['usageStatisticsEnabled', 'aiLogId', 'aiLogChatConsent', 'aiLogComposerConsent', 'aiLogPhotoConsent'];
const DEVICE_KEPT = new Set([...DEVICE_ONLY, 'aiLogId', 'aiLogChatConsent', 'aiLogComposerConsent', 'aiLogPhotoConsent']);
const NOT_COMPARED = new Set([...DEVICE_ONLY, ...PRIVACY, 'legalAcceptance']);

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

/** A generator of its own for one part of a case, so shrinking one part leaves the others as they were. */
function part(seed, name) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let index = 0; index < name.length; index += 1) {
    h = Math.imul(h ^ name.charCodeAt(index), 16777619) >>> 0;
  }
  return mulberry32(h);
}

function tools(random) {
  return {
    random,
    int: (low, high) => low + Math.floor(random() * (high - low + 1)),
    pick: (list) => list[Math.floor(random() * list.length)],
    chance: (p) => random() < p,
    hex: (length) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join(''),
  };
}

// ---------------------------------------------------------------------------
// Helpers for comparing
// ---------------------------------------------------------------------------

const clean = (value) => JSON.parse(JSON.stringify(value ?? null));

function short(value) {
  const text = JSON.stringify(value);
  const shown = text === undefined ? 'undefined' : text;
  return shown.length > 70 ? `${shown.slice(0, 67)}...` : shown;
}

/** The first place two JSON values differ, or null. */
function firstDiff(a, b, where = '') {
  if (a === b) {
    return null;
  }
  // The same text is the same value (the fast path; a different key order falls through to the walk).
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b)) {
    return null;
  }
  const isObject = (value) => value !== null && typeof value === 'object';
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) {
    return `${where || '/'}: ${short(a)} vs ${short(b)}`;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return `${where || '/'}: ${a.length} items vs ${b.length}`;
    }
    for (let index = 0; index < a.length; index += 1) {
      const found = firstDiff(a[index], b[index], `${where}[${index}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(key in a)) {
      return `${where}/${key}: missing vs ${short(b[key])}`;
    }
    if (!(key in b)) {
      return `${where}/${key}: ${short(a[key])} vs missing`;
    }
    const found = firstDiff(a[key], b[key], `${where}/${key}`);
    if (found) {
      return found;
    }
  }
  return null;
}

/** A payload without what a restore does not carry from the backup, for comparing two copies. */
function stripPayload(payload) {
  const copy = clean(payload);
  delete copy.exportedAt;
  for (const field of NOT_COMPARED) {
    delete copy.database.preferences[field];
  }
  delete copy.database.exerciseLibrary;
  return copy;
}

function stateOf(database, history) {
  const { exerciseLibrary: _library, ...rest } = database;
  return clean({ database: rest, workoutHistory: history });
}

function laterAcceptance(left, right) {
  if (!left || !right) {
    return left ?? right ?? null;
  }
  if (left.version !== right.version) {
    return left.version > right.version ? left : right;
  }
  return left.acceptedAt <= right.acceptedAt ? left : right;
}

/** A broken invariant: its text starts with the number of the invariant. */
class Violation extends Error {}

function bad(message) {
  throw new Violation(message);
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
    puts: 0,
    body: (pathname) => blobs.get(pathname)?.body ?? null,
    etag: (pathname) => blobs.get(pathname)?.etag ?? null,
    bodies: () => [...blobs.entries()].filter(([name]) => name.startsWith('backups/')).map(([, entry]) => entry.body),
    async head(pathname) {
      if (!blobs.has(pathname)) {
        throw new BlobNotFoundError();
      }
      return { etag: blobs.get(pathname).etag };
    },
    async get(pathname) {
      const entry = blobs.get(pathname);
      if (!entry) {
        return null;
      }
      return { statusCode: 200, stream: new Blob([entry.body]).stream(), blob: { etag: entry.etag, uploadedAt: new Date(entry.uploaded) } };
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
      const existing = blobs.get(pathname);
      if (options.ifMatch !== undefined && options.ifMatch !== existing?.etag) {
        throw existing ? new BlobPreconditionFailedError() : new BlobNotFoundError();
      }
      if (options.allowOverwrite === false && existing) {
        throw new BlobError('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      }
      counter += 1;
      store.puts += 1;
      const etag = `"e${counter}"`;
      blobs.set(pathname, { body, etag, uploaded: Date.now() });
      return { etag };
    },
    async del(pathnames) {
      for (const pathname of [].concat(pathnames)) {
        blobs.delete(pathname);
      }
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// The world a case runs in: one endpoint, three phones
// ---------------------------------------------------------------------------

const googleIdToken = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
const googleSubOfToken = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub ?? null;
  } catch {
    return null;
  }
};
const backupPathOf = (sub) => `backups/${createHmac('sha256', SECRET).update(sub).digest('hex')}.json`;

let world = null;
let handler = null;
let phones = null;
let dist = null;
let REAL_THRESHOLD = 0;

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
  return { now: START_MS, store: createStore(), bodyMode: 'string', active: null, nextGoogle: null, nextDate: 0 };
}

const respond = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

async function fakeFetch(url, init = {}) {
  const text = String(url);
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
    world.now += 1000;
    // Vercel hands a JSON body over already parsed; the handler writes it back out.
    const parsed = world.bodyMode === 'parsed' && init.method === 'PUT' && typeof init.body === 'string';
    const result = await callHandler(handler, { method: init.method ?? 'GET', headers, body: parsed ? JSON.parse(init.body) : init.body });
    world.active?.seen.push({ method: init.method ?? 'GET', status: result.status, error: result.body?.error });
    return respond(result.status, result.body);
  }
  throw new Error(`unexpected fetch: ${text}`);
}

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
function googleAccountOf(sub) {
  return { idToken: googleIdToken(sub), user: { id: sub, email: `${sub}@example.com`, name: sub } };
}

// ---------------------------------------------------------------------------
// A phone: the real client and the real storage, one copy of the modules per phone
// ---------------------------------------------------------------------------

function accountModuleFiles() {
  return fs
    .readdirSync(ACCOUNT_DIR)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => path.join(ACCOUNT_DIR, entry));
}

function loadPhone(name) {
  const storage = createFakeAsyncStorage();
  const runtime = createHookRuntime();
  const listeners = new Set();
  const M = loadAgainstFake(storage, (requireDist) => ({
    database: requireDist('storage/database.js'),
    workout: requireDist('features/workout/workoutPersistence.js'),
  }));
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
      Platform: { OS: 'android' },
    },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  });
  return { name, storage, runtime, listeners, hook: useAccountBackup, M, clock: null, app: null, api: null, google: null, seen: [], live: false, writes: 0, failWrite: 0, restored: 0 };
}

function resetPhone(phone) {
  phone.storage.rows.clear();
  phone.runtime.unmount();
  phone.listeners.clear();
  phone.clock = createClock();
  phone.google = null;
  phone.seen = [];
  phone.live = false;
  phone.writes = 0;
  phone.failWrite = 0;
  phone.restored = 0;
  phone.api = null;
  phone.app = { database: null, history: null };
}

/**
 * What AppProvider.restoreDatabaseFromBackup and WorkoutProvider.restoreHistoryFromBackup
 * do, from the same real pieces: normalise, keep the phone's own fields, write.
 * A write the test has armed to fail fails here, before anything is written.
 */
/** A few turns of the event loop: a disk that takes its time, so a success claimed early is claimed visibly early. */
const slow = async () => {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise((done) => setImmediate(done));
  }
};

function props(phone) {
  const { app, M } = phone;
  const armed = () => {
    phone.writes += 1;
    if (phone.failWrite && phone.writes === phone.failWrite) {
      throw new Error('database or disk is full');
    }
  };
  return {
    hydrated: true,
    liveSession: phone.live,
    database: app.database,
    workoutHistory: app.history,
    async restoreDatabase(input, options = {}) {
      armed();
      if (options.rollback) {
        // The phone's own database from before, put back as it was (AppProvider's rollback branch).
        await slow();
        await M.database.saveDatabase(input, { withPreferences: input.preferences !== app.database.preferences });
        app.database = input;
        return input;
      }
      const restored = M.database.normalizeDatabase(input);
      const next = {
        ...restored,
        preferences: dist.accountBackup.preferencesForRestore(restored.preferences, app.database.preferences, restored.workoutPlans),
      };
      await slow();
      await M.database.saveDatabase(next, { withPreferences: next.preferences !== app.database.preferences });
      app.database = next;
      return next;
    },
    async restoreWorkoutHistory(history) {
      armed();
      const bundle = M.workout.normalizeWorkoutBundle({ activeSession: null, history, activeCardio: null, freestyleDraft: null });
      await slow();
      await M.workout.saveWorkoutBundle(bundle);
      await slow();
      app.history = bundle.history;
      phone.live = false;
      phone.restored += 1;
      return bundle.history;
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

async function settle(phone) {
  let quiet = 0;
  for (let round = 0; round < 400 && quiet < 3; round += 1) {
    await flush();
    const before = phone.api?.phase;
    render(phone);
    quiet = phone.api.phase === 'idle' && before === 'idle' ? quiet + 1 : 0;
  }
  if (phone.api.phase !== 'idle') {
    bad(`6: ${phone.name} never finished what it was doing (phase ${phone.api.phase})`);
  }
}

/** Puts a database on the phone's disk through the real writers, and reads it back through the real loaders. */
async function setDisk(phone, database, history) {
  await phone.M.database.saveDatabase(database, { withPreferences: true });
  await phone.M.workout.saveWorkoutBundle({ activeSession: null, history, activeCardio: null, freestyleDraft: null });
  await readIntoMemory(phone);
}

async function readDisk(phone) {
  return { database: await phone.M.database.loadDatabase(), history: (await phone.M.workout.loadWorkoutBundle()).history };
}

async function readIntoMemory(phone) {
  const disk = await readDisk(phone);
  phone.app.database = disk.database;
  phone.app.history = disk.history;
}

async function start(phone) {
  activate(phone);
  render(phone);
  await settle(phone);
}

async function signIn(phone, account) {
  activate(phone);
  render(phone);
  world.nextGoogle = account;
  const restoredBefore = phone.restored;
  const result = await phone.api.signIn('google');
  // N6: said before anything else happens, so both stores must already be on disk.
  if (result.kind === 'restored' && phone.restored === restoredBefore) {
    bad('6: "restored" was reported before the restore had written both stores');
  }
  await settle(phone);
  return result;
}

async function operation(phone, name, ...args) {
  activate(phone);
  render(phone);
  const restoredBefore = phone.restored;
  const result = await phone.api[name](...args);
  if (name === 'resolveRestoreChoice' && args[0] === 'restore' && result === 'done' && phone.restored === restoredBefore) {
    bad('6: "restore" was reported done before the restore had written both stores');
  }
  await settle(phone);
  return result;
}

const storedAccount = (phone) => {
  const raw = phone.storage.rows.get('@vinha/account/v1');
  return raw ? JSON.parse(raw) : null;
};

const snapshotOf = (phone) => stateOf(phone.app.database, phone.app.history);

/** The cloud copy of an account as the endpoint holds it, unwrapped. */
function cloudPayload(account) {
  const body = world.store.body(backupPathOf(account));
  if (body === null) {
    return null;
  }
  const decoded = dist.accountBackup.decodeAccountBackupBody(JSON.parse(body));
  if (!decoded || typeof decoded !== 'object' || !decoded.database) {
    bad(`6: the cloud copy of ${account} is stored and cannot be read back (a truncated or damaged envelope)`);
  }
  return decoded;
}

/** Plain JSON up to the client's threshold and a gzip envelope above it, on the wire as the endpoint stored it. */
function checkEncoding(label, account) {
  const stored = JSON.parse(world.store.body(backupPathOf(account)));
  const chars = JSON.stringify(cloudPayload(account)).length;
  const compressed = stored.encoding === dist.accountBackup.ACCOUNT_BACKUP_ENCODING;
  if (compressed !== chars > dist.accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS) {
    bad(`4: ${label}: a payload of ${chars} chars (threshold ${dist.accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS}) was stored ${compressed ? 'compressed' : 'plain'}`);
  }
  count(compressed ? 'stored gzip' : 'stored plain');
}

// ---------------------------------------------------------------------------
// The data: a generator of realistic databases
// ---------------------------------------------------------------------------

const LIFTS = [
  'Barbell Bench Press', 'Back Squat', 'Deadlift', 'Overhead Press', 'Pull-up', 'Romanian Deadlift', 'Lat Pulldown',
  'Dumbbell Curl', 'Plank', 'Leg Press', 'Seated Cable Row', 'Hip Thrust', 'Incline Dumbbell Press', 'Calf Raise',
];
// Names a reader can type or paste: emoji, a ZWJ family, accents, CJK, a BOM mid-string, lone surrogates (what
// a split emoji leaves), quotes and backslashes, a newline, a tab, a NUL, a very long one.
const WEIRD = [
  'Penkki \ud83d\udcaa',
  '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 perhe',
  '\u00dcn\u00ef\u00a9\u00f6d\u00e9 \u00c5\u00e4\u00f6',
  'a\ufeffb BOM',
  'lone \ud83d high',
  'lone \ude00 low',
  '\u65e5\u672c\u8a9e\u306e\u30c6\u30b9\u30c8',
  'quote " and \\ slash',
  'two\nlines',
  'tab\there',
  'nul\u0000inside',
  `long ${'\ud83c\udfcb\ufe0f pitk\u00e4 '.repeat(60)}end`,
];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const READY_TEMPLATE_IDS = ['tpl_4_day_upper_lower_v1', 'tpl_3_day_full_body_v1'];

const iso = (ms) => new Date(ms).toISOString();
const DAY_MS = 86400000;

function randomKnobs(random) {
  const { int, chance } = tools(random);
  const light = chance(0.12);
  return {
    light,
    lightExtra: light ? ['none', 'none', 'nameBook', 'strengthGoal', 'coachGoal', 'prefs'][int(0, 5)] : 'none',
    sessions: chance(0.1) ? 0 : int(1, 22),
    logs: int(1, 4),
    sets: int(1, 6),
    cardio: chance(0.4) ? 0 : int(1, 6),
    bodyweight: chance(0.3) ? 0 : int(1, 24),
    measurements: chance(0.4) ? 0 : int(1, 12),
    nameBook: chance(0.4) ? 0 : int(1, 5),
    custom: int(0, 3),
    freestyle: int(0, 2),
    plans: int(0, 3),
    history: int(0, 14),
    slots: int(0, 5),
    weird: chance(0.5),
    prefs: chance(0.85),
  };
}

function genState(seed, knobs, tag = `g${seed.toString(36)}`) {
  const k = knobs;
  const { createEmptyDatabase } = dist.seed;
  const base = createEmptyDatabase('fi');
  const weirdPick = (t, normal) => (k.weird && t.chance(0.25) ? t.pick(WEIRD) : normal);
  const baseMs = Date.UTC(2025, 9, 1);
  const database = {
    ...base,
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    workoutSessions: [],
    cardioSessions: [],
    exerciseLogs: [],
    bodyweightEntries: [],
    measurementEntries: [],
    exerciseNameBook: [],
  };
  const authoredTemplates = [];

  // Setup's own programme: what first-run setup leaves behind.
  const t0 = tools(part(seed, 'setup'));
  const setupWeight = 70 + t0.int(0, 25) + 0.5;
  const setupTemplateId = `${tag}_onb_tpl`;
  database.workoutTemplates.push({
    id: setupTemplateId,
    name: 'Setup programme',
    exerciseIds: [`${tag}_onb_ex1`, `${tag}_onb_ex2`],
    sessions: [{ id: `${setupTemplateId}_s1`, name: 'Day 1', orderIndex: 0, exerciseIds: [`${tag}_onb_ex1`, `${tag}_onb_ex2`] }],
    createdAt: iso(baseMs),
    updatedAt: iso(baseMs),
    origin: 'authored',
    sourceTemplateId: null,
  });
  ['Back Squat', 'Barbell Bench Press'].forEach((name, index) => {
    database.exerciseTemplates.push({
      id: `${tag}_onb_ex${index + 1}`,
      workoutTemplateId: setupTemplateId,
      workoutTemplateSessionId: `${setupTemplateId}_s1`,
      name,
      targetSets: 3,
      repMin: 8,
      repMax: 8,
      restSeconds: 120,
      trackedDefault: true,
      orderIndex: index,
      libraryItemId: null,
      supersetGroup: null,
    });
  });
  database.workoutPlans.push({
    id: `onboarding_plan_${setupTemplateId}`,
    name: 'Setup plan',
    mode: 'weekday',
    entries: [{ id: `${tag}_onb_e1`, workoutTemplateId: setupTemplateId, workoutTemplateSessionId: `${setupTemplateId}_s1`, label: 'Day 1', orderIndex: 0 }],
    isActive: true,
    createdAt: iso(baseMs),
    updatedAt: iso(baseMs),
  });
  database.bodyweightEntries.push({ id: `${tag}_bw_setup`, recordedAt: iso(baseMs), weight: setupWeight });

  if (!k.light) {
    // The reader's own programmes: days, supersets, a copy of a ready one.
    for (let index = 0; index < k.custom; index += 1) {
      const t = tools(part(seed, `tpl${index}`));
      const templateId = `${tag}_tpl_${index}`;
      const days = t.int(1, 3);
      const sessions = [];
      let order = 0;
      for (let day = 0; day < days; day += 1) {
        const sessionId = `${templateId}_s${day}`;
        const exerciseIds = [];
        const many = t.int(2, 5);
        let group = null;
        for (let slot = 0; slot < many; slot += 1) {
          const id = `${templateId}_e${day}_${slot}`;
          // Adjacent lifts share a group: a superset.
          if (slot > 0 && slot % 2 === 1 && t.chance(0.6)) {
            group = `ss_${templateId}_${day}_${slot}`;
            database.exerciseTemplates[database.exerciseTemplates.length - 1].supersetGroup = group;
          } else {
            group = null;
          }
          database.exerciseTemplates.push({
            id,
            workoutTemplateId: templateId,
            workoutTemplateSessionId: sessionId,
            name: weirdPick(t, t.pick(LIFTS)),
            targetSets: t.int(2, 5),
            repMin: t.int(5, 12),
            repMax: 0,
            restSeconds: t.pick([60, 90, 120, 180, null]),
            trackedDefault: t.chance(0.8),
            orderIndex: order,
            libraryItemId: null,
            persistedExerciseTemplateId: null,
            supersetGroup: group,
          });
          const row = database.exerciseTemplates[database.exerciseTemplates.length - 1];
          row.repMax = row.repMin;
          exerciseIds.push(id);
          order += 1;
        }
        sessions.push({ id: sessionId, name: weirdPick(t, `Day ${day + 1}`), orderIndex: day, exerciseIds });
      }
      const template = {
        id: templateId,
        name: weirdPick(t, `Programme ${index + 1}`),
        exerciseIds: sessions.flatMap((session) => session.exerciseIds),
        sessions,
        createdAt: iso(baseMs + index * DAY_MS),
        updatedAt: iso(baseMs + (index + 3) * DAY_MS),
        origin: 'authored',
        sourceTemplateId: t.chance(0.3) ? READY_TEMPLATE_IDS[0] : null,
      };
      database.workoutTemplates.push(template);
      authoredTemplates.push(template);
    }
    for (let index = 0; index < k.freestyle; index += 1) {
      const t = tools(part(seed, `free${index}`));
      const templateId = `${tag}_free_${index}`;
      database.workoutTemplates.push({
        id: templateId,
        name: 'Free workout',
        exerciseIds: [`${templateId}_e0`],
        sessions: [{ id: `${templateId}_s0`, name: 'Free workout', orderIndex: 0, exerciseIds: [`${templateId}_e0`] }],
        createdAt: iso(baseMs + 5 * DAY_MS),
        updatedAt: iso(baseMs + 5 * DAY_MS),
        origin: 'freestyle',
        sourceTemplateId: null,
      });
      database.exerciseTemplates.push({
        id: `${templateId}_e0`,
        workoutTemplateId: templateId,
        workoutTemplateSessionId: `${templateId}_s0`,
        name: t.pick(LIFTS),
        targetSets: 3,
        repMin: 10,
        repMax: 10,
        restSeconds: 90,
        trackedDefault: true,
        orderIndex: 0,
        libraryItemId: null,
        supersetGroup: null,
      });
      authoredTemplates.push(database.workoutTemplates[database.workoutTemplates.length - 1]);
    }
    // Plans: over the reader's programmes, a ready one, a rotation.
    for (let index = 0; index < k.plans; index += 1) {
      const t = tools(part(seed, `plan${index}`));
      const pool = [...authoredTemplates.map((template) => template.id), ...READY_TEMPLATE_IDS];
      const entries = Array.from({ length: t.int(1, 4) }, (_, entry) => ({
        id: `${tag}_plan${index}_e${entry}`,
        workoutTemplateId: t.pick(pool),
        workoutTemplateSessionId: null,
        label: weirdPick(t, `Day ${entry + 1}`),
        orderIndex: entry,
      }));
      database.workoutPlans.push({
        id: `${tag}_plan_${index}`,
        name: weirdPick(t, `Plan ${index + 1}`),
        mode: t.pick(['weekday', 'rotation']),
        entries,
        isActive: t.chance(0.5),
        createdAt: iso(baseMs + index * DAY_MS),
        updatedAt: iso(baseMs + (index + 2) * DAY_MS),
      });
    }

    // Saved workouts and their logs.
    const sessionPool = authoredTemplates.length ? authoredTemplates : [database.workoutTemplates[0]];
    for (let index = 0; index < k.sessions; index += 1) {
      const t = tools(part(seed, `sess${index}`));
      const template = t.pick([...sessionPool, ...sessionPool, { id: t.pick(READY_TEMPLATE_IDS), name: 'Ready programme', sessions: [{ id: 'upper_a' }] }]);
      const day = template.sessions[t.int(0, template.sessions.length - 1)];
      const performedMs = baseMs + 12 * DAY_MS + index * 2 * DAY_MS + t.int(0, 8) * 3600000;
      const sessionId = `${tag}_s_${index}`;
      for (let slot = 0; slot < k.logs; slot += 1) {
        const lt = tools(part(seed, `log${index}_${slot}`));
        const name = weirdPick(lt, lt.pick(LIFTS));
        const baseWeight = lt.pick([0, 20, 40, 52.5, 60, 80, 100, 142.5]);
        const style = lt.pick(['straight', 'ramp', 'drop', 'warm', 'skip', 'mixed']);
        const sets = [];
        const add = (kind, weight, reps, extra = {}) => {
          const done = extra.status !== 'skipped';
          sets.push({
            orderIndex: sets.length,
            weight,
            reps,
            kind,
            outcome: done ? lt.pick(['completed', 'completed', 'completed', 'failed']) : 'skipped',
            status: extra.status ?? 'completed',
            effort: lt.pick(['easy', 'good', 'hard', null]),
            completedAt: done ? iso(performedMs + sets.length * 120000) : null,
            skippedReason: done ? null : weirdPick(lt, 'felt a twinge'),
            planned: lt.chance(0.6)
              ? {
                  loadKg: lt.chance(0.8) ? weight : null,
                  repsMin: reps,
                  repsMax: reps + 2,
                  targetReps: lt.chance(0.3) ? reps : null,
                  basis: lt.pick(['added', 'progressed', 'held_caution', 'held_recovery', 'borrowed', 'repeat', 'none']),
                  fromKg: lt.chance(0.3) ? Math.max(0, weight - 2.5) : null,
                  fromReps: lt.chance(0.2) ? Math.max(0, reps - 1) : null,
                  cautionArea: lt.chance(0.2) ? lt.pick(['knees', 'shoulders', 'lower_back']) : null,
                }
              : undefined,
            ...extra,
          });
        };
        if (style === 'warm' || style === 'mixed') {
          add('warmup', Math.max(0, baseWeight * 0.4), 8);
        }
        const working = lt.int(1, k.sets);
        for (let s = 0; s < working; s += 1) {
          const ramped = style === 'ramp' ? baseWeight * (0.6 + (0.4 * s) / Math.max(1, working - 1)) : baseWeight;
          add('working', Math.round(ramped * 2) / 2, style === 'ramp' ? Math.max(1, 10 - s * 2) : lt.int(5, 12));
        }
        if (style === 'drop' || style === 'mixed') {
          add('drop', baseWeight * 0.8, lt.int(8, 15));
        }
        if (style === 'skip') {
          add('working', 0, 0, { status: 'skipped' });
        }
        const swapped = lt.chance(0.15);
        database.exerciseLogs.push({
          id: `${tag}_l_${index}_${slot}`,
          sessionId,
          exerciseTemplateId: swapped ? null : lt.pick([null, `${template.id}_e0_0`]),
          exerciseNameSnapshot: name,
          weight: baseWeight,
          repsPerSet: sets.map((set) => set.reps),
          sets,
          tracked: lt.chance(0.8),
          orderIndex: slot,
          skipped: false,
          sessionInserted: lt.chance(0.1),
          status: 'completed',
          slotId: `${template.id}:${day.id}:slot_${slot}`,
          templateSlotId: `slot_${slot}`,
          templateExerciseId: lt.chance(0.5) ? `${template.id}_e0_${slot}` : null,
          notes: lt.chance(0.25) ? weirdPick(lt, 'felt heavy today') : null,
          swappedFrom: swapped ? 'Barbell Row' : null,
        });
      }
      database.workoutSessions.push({
        id: sessionId,
        workoutTemplateId: template.id,
        workoutTemplateSessionId: day.id,
        workoutNameSnapshot: weirdPick(t, template.name),
        sessionNotes: t.chance(0.3) ? weirdPick(t, 'good day') : null,
        feel: t.pick(['easy', 'right', 'hard', 'too_hard', null]),
        performedAt: iso(performedMs),
        startedAt: iso(performedMs - 50 * 60000),
        durationMinutes: t.int(20, 90),
        trackedExercisesUpdated: t.int(0, 3),
        noteCount: t.int(0, 2),
        sessionInsertedCount: 0,
        exercisesSkipped: 0,
        exercisesSwapped: 0,
      });
    }

    for (let index = 0; index < k.cardio; index += 1) {
      const t = tools(part(seed, `cardio${index}`));
      const start = baseMs + index * 3 * DAY_MS + 7 * 3600000;
      database.cardioSessions.push({
        id: `${tag}_c_${index}`,
        activityType: t.pick(['run', 'tread-run', 'tread-walk', 'cycle-in', 'cycle-out', 'row']),
        startedAt: iso(start),
        performedAt: iso(start + 40 * 60000),
        durationSec: t.int(600, 5400),
        distanceKm: t.chance(0.6) ? t.int(2, 21) + 0.25 : null,
        feel: t.pick(['easy', 'steady', 'hard', 'max', null]),
      });
    }
    for (let index = 0; index < k.bodyweight; index += 1) {
      const t = tools(part(seed, `bw${index}`));
      database.bodyweightEntries.push({ id: `${tag}_bw_${index}`, recordedAt: iso(baseMs + (index + 1) * DAY_MS), weight: Math.round((setupWeight - index * 0.1 + t.int(0, 9) / 10) * 10) / 10 });
    }
    for (let index = 0; index < k.measurements; index += 1) {
      const t = tools(part(seed, `meas${index}`));
      const kind = t.pick(['bodyfat', 'shoulders', 'chest', 'back', 'arms', 'waist', 'hips', 'thighs', 'calves']);
      database.measurementEntries.push({
        id: `${tag}_m_${index}`,
        kind,
        recordedAt: iso(baseMs + index * 2 * DAY_MS + 8 * 3600000),
        value: kind === 'bodyfat' ? 14 + index / 4 : 30 + index * 1.25,
        unit: kind === 'bodyfat' ? '%' : t.pick(['cm', 'in']),
      });
    }
    for (let index = 0; index < k.nameBook; index += 1) {
      const t = tools(part(seed, `book${index}`));
      database.exerciseNameBook.push({
        alias: `alias_${tag}_${index}`,
        wrote: weirdPick(t, `Penkki ${index}`),
        exerciseName: t.pick(LIFTS),
        libraryItemId: null,
        learnedAt: iso(baseMs + index * DAY_MS),
      });
    }
  }

  // Preferences.
  const p = tools(part(seed, 'prefs'));
  const prefs = { ...database.preferences };
  prefs.setupCurrentWeightKg = setupWeight;
  const sessionDay = k.light ? `${setupTemplateId}_s1` : null;
  if (k.light) {
    prefs.activePlanId = `onboarding_plan_${setupTemplateId}`;
    prefs.activePlanIds = [`onboarding_plan_${setupTemplateId}`];
    prefs.onboardingCompleted = true;
    prefs.setupCompleted = true;
    if (k.lightExtra === 'nameBook') {
      database.exerciseNameBook.push({ alias: `alias_${tag}`, wrote: 'Penkki', exerciseName: 'Barbell Bench Press', libraryItemId: null, learnedAt: iso(baseMs) });
    } else if (k.lightExtra === 'strengthGoal') {
      prefs.strengthGoals = [{ exerciseName: 'Barbell Bench Press', targetKg: 100, createdAt: iso(baseMs) }];
    } else if (k.lightExtra === 'coachGoal') {
      prefs.coachGoals = [{ id: `${tag}_goal`, text: 'Bigger chest', kind: 'chest', targetValue: 110, unit: 'cm', startValue: 100, createdAt: iso(baseMs) }];
    } else if (k.lightExtra === 'prefs') {
      prefs.darkThemeEnabled = true;
      prefs.defaultRestSeconds = 150;
    }
  } else if (k.prefs) {
    const runnable = database.workoutPlans.filter((plan) => !plan.id.startsWith('onboarding_plan_'));
    const active = runnable.filter((plan) => plan.isActive).map((plan) => plan.id);
    prefs.activePlanIds = active;
    prefs.activePlanId = active[0] ?? null;
    prefs.appLanguage = p.pick(['fi', 'en']);
    prefs.defaultRestSeconds = p.pick([60, 90, 105, 120, 180]);
    prefs.darkThemeEnabled = p.chance(0.5);
    prefs.soundCuesEnabled = p.chance(0.7);
    prefs.hapticsEnabled = p.chance(0.7);
    prefs.profileName = weirdPick(p, 'Testi K\u00e4ytt\u00e4j\u00e4');
    prefs.onboardingCompleted = p.chance(0.9);
    prefs.setupCompleted = true;
    prefs.entryFlowCompleted = true;
    prefs.hasOpenedAppBefore = true;
    prefs.setupGoal = p.pick(['strength', 'muscle', 'general', null]);
    prefs.setupGoals = p.chance(0.5) ? [p.pick(['strength', 'muscle'])] : [];
    prefs.setupLevel = p.pick(['beginner', 'advanced', 'pro', null]);
    prefs.setupDaysPerWeek = p.pick([2, 3, 4, 5, 6, null]);
    prefs.setupGender = p.pick(['male', 'female', 'unspecified', null]);
    prefs.setupAge = p.pick([null, 24, 31, 47]);
    prefs.setupHeightCm = p.pick([null, 168, 181]);
    prefs.setupFocusAreas = p.chance(0.5) ? ['chest', 'back'] : [];
    prefs.setupEquipmentItems = p.chance(0.5) ? ['barbell', 'dumbbell'] : [];
    prefs.setupAvailableDays = p.chance(0.6) ? ['mon', 'wed', 'fri'] : [];
    prefs.setupCautionFlags = p.chance(0.6)
      ? Array.from({ length: p.int(1, 3) }, () => ({
          area: p.pick(['neck', 'shoulders', 'elbows', 'wrists', 'lower_back', 'hips', 'knees', 'ankles']),
          level: p.pick(['info', 'careful', 'avoid']),
          refinements: p.chance(0.5) ? ['pain when pressing', weirdPick(p, 'clicks')] : [],
        }))
      : [];
    prefs.trainingCycle = p.chance(0.3) ? { pattern: [true, true, false], anchorDayStart: Date.UTC(2026, 0, 5) } : null;
    prefs.restDayStarts = p.chance(0.3) ? [Date.UTC(2026, 8, 20), Date.UTC(2026, 8, 21)] : [];
    prefs.readerSessionNames = p.chance(0.4) ? { [`${tag}_tpl_0_s0`]: weirdPick(p, 'Chest and back') } : {};
    prefs.exerciseTechniqueChecks = p.chance(0.4) ? { 'Barbell Squat': [1, 2] } : {};
    prefs.dismissedTipIds = p.chance(0.4) ? ['tip_1', 'tip_2'] : [];
    prefs.strengthGoals = p.chance(0.4) ? [{ exerciseName: 'Deadlift', targetKg: 180, createdAt: iso(baseMs) }] : [];
    prefs.coachGoals = p.chance(0.3) ? [{ id: `${tag}_goal`, text: weirdPick(p, 'Smaller waist'), kind: 'waist', targetValue: 80, unit: 'cm', startValue: 90, createdAt: iso(baseMs) }] : [];
    prefs.seasonEnrolments = p.chance(0.2) ? [{ season: 'winter', year: 2026, joinedAt: iso(baseMs) }] : [];
    prefs.ratingPrompt = p.chance(0.3) ? { lastAskedAt: iso(baseMs), askCount: 2, rated: false } : prefs.ratingPrompt;
    prefs.notificationPrefs = { ...prefs.notificationPrefs, pushEnabled: p.chance(0.5), level: p.pick(['quiet', 'normal', 'motivating']), reminderTime: p.pick(['06:45', '18:30']) };
    prefs.trainingBreak = p.chance(0.15) ? { reason: p.pick(['injury', 'holiday', 'other']), note: weirdPick(p, 'knee'), startedAt: iso(baseMs) } : null;
    prefs.todaySession = sessionDay === null && p.chance(0.2) ? { dayStart: Date.UTC(2026, 9, 1), sessionId: `${tag}_tpl_0_s0`, pickedAt: Date.UTC(2026, 9, 1, 7) } : null;
  }
  // The phone's own: entitlement, meters, privacy answers, the acceptance of the terms.
  const d = tools(part(seed, 'device'));
  prefs.promoProUntil = d.chance(0.3) ? iso(baseMs + 400 * DAY_MS) : null;
  prefs.proTrialStartedAt = d.chance(0.5) ? iso(baseMs) : null;
  prefs.proTrialUntil = prefs.proTrialStartedAt ? iso(baseMs + 14 * DAY_MS) : null;
  prefs.aiCoachProQuota = d.chance(0.3) ? { monthStart: '2026-10-01', used: d.int(0, 20) } : null;
  prefs.coachDemoMomentsUsed = d.chance(0.5) ? ['day7'] : [];
  prefs.firstLaunchAt = iso(baseMs + d.int(0, 5) * DAY_MS);
  prefs.seenServerNoticeIds = d.chance(0.4) ? [`notice_${d.hex(4)}`] : [];
  prefs.pendingAiLogDeletions = d.chance(0.3) ? [`label_${d.hex(8)}`] : [];
  prefs.usageStatisticsEnabled = d.chance(0.6);
  prefs.aiLogId = d.chance(0.5) ? `log_${d.hex(12)}` : null;
  prefs.aiLogChatConsent = prefs.aiLogId !== null && d.chance(0.5);
  prefs.aiLogComposerConsent = prefs.aiLogId !== null && d.chance(0.5);
  prefs.aiLogPhotoConsent = prefs.aiLogId !== null && d.chance(0.5);
  prefs.legalAcceptance = d.chance(0.7) ? { version: d.pick(['2026-09-20', '2026-09-26', '2026-10-01']), acceptedAt: iso(baseMs + d.int(0, 20) * DAY_MS) } : null;
  database.preferences = prefs;

  // The player's history: a summary per recent workout, "last time" per slot.
  const h = tools(part(seed, 'history'));
  const sessions = [];
  const slotHistory = {};
  for (let index = 0; index < k.history; index += 1) {
    const performedMs = baseMs + 40 * DAY_MS - index * 2 * DAY_MS;
    const sessionId = `${tag}_h_${index}`;
    sessions.push({
      sessionId,
      templateId: h.pick(READY_TEMPLATE_IDS),
      templateSessionId: h.pick(['upper_a', 'lower_a', null]),
      templateName: weirdPick(h, 'Ready programme'),
      performedAt: iso(performedMs),
      durationMinutes: h.int(25, 80),
      setsCompleted: h.int(6, 30),
      exercisesCompleted: h.int(2, 6),
      exercisesSkipped: h.int(0, 1),
      exercisesSwapped: h.int(0, 1),
      totalVolumeKg: h.int(800, 9000),
    });
    for (let slot = 0; slot < Math.min(2, k.slots); slot += 1) {
      const key = `tpl_x:upper_a:slot_${slot}`;
      (slotHistory[key] ||= []).push({
        slotId: key,
        templateId: 'tpl_x',
        templateName: 'Ready programme',
        exerciseName: weirdPick(h, h.pick(LIFTS)),
        substitutionGroup: 'press',
        performedAt: iso(performedMs),
        sessionId,
        sets: Array.from({ length: h.int(1, 4) }, (_, setIndex) => ({ setIndex, loadKg: 40 + setIndex * 5, reps: 10 - setIndex, completedAt: iso(performedMs + setIndex * 90000), effort: h.pick(['easy', 'good', 'hard', null]) })),
        skipped: h.chance(0.1),
        ...(h.chance(0.2) ? { swappedFrom: 'Barbell Row' } : {}),
        ...(h.chance(0.2) ? { targetReps: 7 } : {}),
      });
    }
  }
  for (let slot = 2; slot < k.slots; slot += 1) {
    slotHistory[`tpl_y:lower_a:slot_${slot}`] = [
      { slotId: `tpl_y:lower_a:slot_${slot}`, templateId: 'tpl_y', templateName: 'Other', exerciseName: LIFTS[slot], substitutionGroup: 'squat', performedAt: iso(baseMs), sessionId: `${tag}_h_old${slot}`, sets: [{ setIndex: 0, loadKg: 60, reps: 8, completedAt: iso(baseMs), effort: null }], skipped: false },
    ];
  }
  return { database, history: { sessions, slotHistory, lastSelectedTemplateId: sessions.length ? 'tpl_x' : null } };
}

/** One more workout, as if logged on the phone after its last backup. */
function logMoreWork(state, seed) {
  const t = tools(part(seed, 'more'));
  const database = clean({ ...state.database, exerciseLibrary: [] });
  const history = clean(state.history);
  const id = `more_${seed.toString(36)}`;
  const performedMs = Date.UTC(2026, 9, 2, 17);
  const templateId = database.workoutTemplates[0]?.id ?? 'tpl_x';
  database.workoutSessions.push({ id, workoutTemplateId: templateId, workoutTemplateSessionId: null, workoutNameSnapshot: 'Newer workout', sessionNotes: null, feel: null, performedAt: iso(performedMs), startedAt: iso(performedMs - 3000000), durationMinutes: 50 });
  database.exerciseLogs.push({
    id: `${id}_l0`,
    sessionId: id,
    exerciseTemplateId: null,
    exerciseNameSnapshot: 'Back Squat',
    weight: 100,
    repsPerSet: [5, 5],
    sets: [
      { orderIndex: 0, weight: 100, reps: 5, kind: 'working', outcome: 'completed', status: 'completed', effort: 'good', completedAt: iso(performedMs), skippedReason: null },
      { orderIndex: 1, weight: 100, reps: 5, kind: 'working', outcome: 'completed', status: 'completed', effort: 'hard', completedAt: iso(performedMs + 180000), skippedReason: null },
    ],
    tracked: true,
    orderIndex: 0,
    skipped: false,
    sessionInserted: false,
    status: 'completed',
    slotId: null,
    templateSlotId: null,
    templateExerciseId: null,
    notes: null,
    swappedFrom: null,
  });
  if (t.chance(0.5)) {
    database.bodyweightEntries.push({ id: `${id}_bw`, recordedAt: iso(performedMs), weight: 79.5 });
  }
  history.sessions.unshift({ sessionId: id, templateId: templateId, templateSessionId: null, templateName: 'Newer workout', performedAt: iso(performedMs), durationMinutes: 50, setsCompleted: 2, exercisesCompleted: 1, exercisesSkipped: 0, exercisesSwapped: 0, totalVolumeKg: 1000 });
  return { database, history };
}

// ---------------------------------------------------------------------------
// The invariants
// ---------------------------------------------------------------------------

const ONBOARDING_PREFIX = 'onboarding_plan_';

/** Rows on `local` that a restore of `copy` would take away: the ones the reader logged or made, by id. */
function loggedRowsMissingFrom(local, copy) {
  const idsOf = (rows) => new Set((rows ?? []).map((row) => row.id));
  const missing = [];
  const lacks = (name, rows, inCopy) => {
    for (const row of rows) {
      if (!inCopy.has(row.id)) {
        missing.push(`${name} ${row.id}`);
      }
    }
  };
  lacks('workout', local.workoutSessions, idsOf(copy.workoutSessions));
  lacks('run', local.cardioSessions, idsOf(copy.cardioSessions));
  lacks('measurement', local.measurementEntries, idsOf(copy.measurementEntries));
  lacks('plan', local.workoutPlans.filter((plan) => !plan.id.startsWith(ONBOARDING_PREFIX)), idsOf(copy.workoutPlans));
  const onboardingPlanned = new Set(local.workoutPlans.filter((plan) => plan.id.startsWith(ONBOARDING_PREFIX)).map((plan) => plan.id.slice(ONBOARDING_PREFIX.length)));
  lacks('programme', local.workoutTemplates.filter((template) => !(onboardingPlanned.has(template.id) && template.createdAt === template.updatedAt && template.origin !== 'freestyle')), idsOf(copy.workoutTemplates));
  // Setup writes one weigh-in, at the weight it asked for: that one is not the reader's log.
  const setup = local.preferences.setupCurrentWeightKg ?? null;
  const weighIns = local.bodyweightEntries;
  const own = weighIns.length === 1 && weighIns[0].weight === setup ? [] : weighIns;
  lacks('weigh-in', own, idsOf(copy.bodyweightEntries));
  return missing;
}

/** What a reader wrote that is not a logged row (their name book, goals): worth keeping too. */
function authoredRowsMissingFrom(local, copy) {
  const missing = [];
  const book = new Set((copy.exerciseNameBook ?? []).map((entry) => entry.alias));
  for (const entry of local.exerciseNameBook) {
    if (!book.has(entry.alias)) {
      missing.push(`name book ${entry.alias}`);
    }
  }
  const goals = new Set((copy.preferences?.strengthGoals ?? []).map((goal) => goal.exerciseName));
  for (const goal of local.preferences.strengthGoals ?? []) {
    if (!goals.has(goal.exerciseName)) {
      missing.push(`strength goal ${goal.exerciseName}`);
    }
  }
  const coach = new Set((copy.preferences?.coachGoals ?? []).map((goal) => goal.id));
  for (const goal of local.preferences.coachGoals ?? []) {
    if (!coach.has(goal.id)) {
      missing.push(`coach goal ${goal.id}`);
    }
  }
  return missing;
}

/**
 * 1. What the phone holds after a restore is the source, apart from what is the
 * phone's own. `device` is the preferences the phone held before it.
 */
function checkArrived(label, source, device, got) {
  const sourceState = stateOf(source.database, source.history);
  const gotState = stateOf(got.database, got.history);
  for (const name of Object.keys(sourceState.database)) {
    if (name === 'preferences') {
      continue;
    }
    const found = firstDiff(sourceState.database[name], gotState.database[name], name);
    if (found) {
      bad(`1: ${label}: ${found}`);
    }
  }
  for (const name of Object.keys(gotState.database)) {
    if (!(name in sourceState.database)) {
      bad(`1: ${label}: the restored database has a collection ${name} the source lacks`);
    }
  }
  const found = firstDiff(sourceState.workoutHistory, gotState.workoutHistory, 'workoutHistory');
  if (found) {
    bad(`1: ${label}: ${found}`);
  }
  const sourcePrefs = sourceState.database.preferences;
  const gotPrefs = gotState.database.preferences;
  const devicePrefs = clean(device);
  for (const field of new Set([...Object.keys(sourcePrefs), ...Object.keys(gotPrefs)])) {
    let expected;
    if (DEVICE_KEPT.has(field)) {
      expected = devicePrefs[field];
    } else if (field === 'usageStatisticsEnabled') {
      expected = devicePrefs[field] !== false && sourcePrefs[field] !== false;
    } else if (field === 'legalAcceptance') {
      expected = laterAcceptance(devicePrefs[field], sourcePrefs[field]);
    } else {
      expected = sourcePrefs[field];
    }
    const diff = firstDiff(clean(expected), gotPrefs[field], `preferences.${field}`);
    if (diff) {
      bad(`1: ${label}: ${diff}${DEVICE_KEPT.has(field) ? ' (the restoring phone\'s own field)' : ''}`);
    }
  }
}

/** The cloud copy holds what the source phone had, field for field (a builder that drops something fails here). */
function checkCloudHolds(label, account, source) {
  const cloud = cloudPayload(account);
  if (!cloud) {
    bad(`6: ${label}: the cloud holds no copy`);
  }
  const expected = clean({ database: { ...source.database, exerciseLibrary: [] }, workoutHistory: source.history, exportedAt: 'x', version: 1 });
  const found = firstDiff(stripPayload(expected), stripPayload(cloud), 'payload');
  if (found) {
    bad(`1: ${label}: the cloud copy differs from what the phone sent: ${found}`);
  }
}

/** Reading the phone back from disk gives what the restore left in memory. */
async function checkOnDisk(label, phone) {
  const disk = await readDisk(phone);
  const found = firstDiff(stateOf(phone.app.database, phone.app.history), stateOf(disk.database, disk.history), 'disk');
  if (found) {
    bad(`6: ${label}: what a reload reads differs from what the restore reported: ${found}`);
  }
}

/** A generated or corpus state, with the real fingerprint and builder agreeing the round trip left it alone. */
function checkFingerprint(label, source, got) {
  if (firstDiff(clean(source.database.preferences.legalAcceptance), clean(got.database.preferences.legalAcceptance))) {
    return;
  }
  const before = dist.accountBackup.accountBackupFingerprint(source.database, source.history);
  const after = dist.accountBackup.accountBackupFingerprint(got.database, got.history);
  if (before !== after) {
    bad(`2: ${label}: the backup fingerprint of the restored phone (${after}) is not the original's (${before}): the automatic backup would see a change nobody made`);
  }
}

/** The empty phone a new install is, with its own device fields. */
async function newPhoneState(phone, seed, extra) {
  const d = tools(part(seed, 'phone'));
  const empty = dist.seed.createEmptyDatabase('fi');
  const prefs = { ...empty.preferences };
  prefs.promoProUntil = d.chance(0.3) ? iso(START_MS + 90 * DAY_MS) : null;
  prefs.proTrialStartedAt = d.chance(0.6) ? iso(START_MS - 3 * DAY_MS) : null;
  prefs.proTrialUntil = prefs.proTrialStartedAt ? iso(START_MS + 11 * DAY_MS) : null;
  prefs.coachDemoMomentsUsed = d.chance(0.5) ? ['day7', 'day30'] : [];
  prefs.firstLaunchAt = iso(START_MS - 3 * DAY_MS);
  prefs.seenServerNoticeIds = d.chance(0.5) ? ['n_phone'] : [];
  prefs.pendingAiLogDeletions = d.chance(0.3) ? ['label_phone'] : [];
  prefs.usageStatisticsEnabled = d.chance(0.5);
  prefs.aiLogId = d.chance(0.5) ? `log_${d.hex(12)}` : null;
  prefs.aiLogChatConsent = prefs.aiLogId !== null && d.chance(0.5);
  prefs.legalAcceptance = d.chance(0.6) ? { version: d.pick(['2026-09-20', '2026-10-01']), acceptedAt: iso(START_MS - DAY_MS) } : null;
  const database = { ...empty, ...(extra?.database ?? {}), preferences: { ...(extra?.database?.preferences ?? prefs), ...Object.fromEntries([...DEVICE_ONLY, ...PRIVACY].map((field) => [field, prefs[field]])), legalAcceptance: prefs.legalAcceptance } };
  await setDisk(phone, database, extra?.history ?? { sessions: [], slotHistory: {}, lastSelectedTemplateId: null });
}

async function runCase(spec) {
  // Some cases push the compression threshold down so ordinary data takes the gzip envelope path too.
  dist.accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS = spec.gzip ? 5000 : REAL_THRESHOLD;
  world = freshWorld();
  world.bodyMode = spec.body;
  Date.now = () => world.now;
  const [A, B, C] = [phones.A, phones.B, phones.C];
  for (const phone of [A, B, C]) {
    resetPhone(phone);
  }
  for (const phone of spec.scenario === 'same' ? [A] : [A, B]) {
    await start(phone);
  }
  const step = async (name, run) => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Violation) {
        throw error;
      }
      throw new Violation(`6: ${name} threw ${error instanceof Error ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`);
    }
  };

  // The source: a phone with the data, backing it up as a first backup.
  const source = await step('building the source', async () => sourceState(spec));
  await step('placing the source', () => setDisk(A, source.database, source.history));
  const original = { database: A.app.database, history: A.app.history };
  const putsBefore = world.store.puts;
  const first = await step('the first backup', () => signIn(A, 'G1'));
  if (first.kind !== 'backed_up') {
    bad(`6: the first sign-in of a phone with data, onto an account with no copy, ended "${first.kind}", not a backup`);
  }
  if (world.store.puts !== putsBefore + 1) {
    bad(`6: "backed up" was reported after ${world.store.puts - putsBefore} writes to the store`);
  }
  const account = storedAccount(A);
  if (!account?.lastBackupAt || account.cloudVersion !== world.store.etag(backupPathOf('G1'))) {
    bad('6: "backed up" was reported, and the phone does not hold the version of the copy that was written');
  }
  checkCloudHolds('after the first backup', 'G1', original);
  checkEncoding('after the first backup', 'G1');
  const firstCopy = world.store.body(backupPathOf('G1'));

  // What the source phone logs after that, if it does.
  let current = original;
  if (spec.newerLocal) {
    current = logMoreWork(original, spec.seed);
    await step('logging more', async () => {
      await setDisk(A, current.database, current.history);
      current = { database: A.app.database, history: A.app.history };
    });
  }

  // The phone that restores.
  let target;
  let targetStart;
  if (spec.scenario === 'same') {
    target = A;
    await operation(A, 'signOut');
    targetStart = current;
  } else {
    target = B;
    if (spec.scenario === 'fresh') {
      // A new phone is set up before anyone thinks of signing in: setup's programme and weigh-in count as empty.
      const setup = spec.freshSetup ? genState(spec.seed + 3, { ...randomKnobs(part(spec.seed, 'setup')), light: true, lightExtra: 'none' }, `n${spec.seed.toString(36)}`) : null;
      await step('the new phone', () => newPhoneState(B, spec.seed, setup));
    } else {
      const other = genState(spec.other.seed, spec.other.knobs, `o${spec.other.seed.toString(36)}`);
      await step('the other data', () => newPhoneState(B, spec.seed, other));
      if (spec.scenario === 'otherAccount') {
        const otherUp = await signIn(B, 'G2');
        if (otherUp.kind !== 'backed_up') {
          bad(`6: the other account's first backup ended "${otherUp.kind}"`);
        }
        await operation(B, 'signOut');
      }
    }
    targetStart = { database: B.app.database, history: B.app.history };
  }
  target.live = spec.live;
  render(target);
  const beforeAsk = snapshotOf(target);
  const devicePrefs = clean(target.app.database.preferences);
  const g2Before = world.store.body(backupPathOf('G2'));
  if (spec.fault) {
    target.writes = 0;
    target.failWrite = spec.fault;
  }

  const outcome = await step('the sign-in', () => signIn(target, 'G1'));
  count(`${spec.scenario} -> ${outcome.kind}`);
  const loggedMissing = loggedRowsMissingFrom(targetStart.database, original.database);
  const mustAsk = spec.live || loggedMissing.length > 0;

  // The restore the reader chose, or the one that needed no question.
  let restored = false;
  if (outcome.kind === 'choice') {
    // 5. Nothing on the phone has changed, nor has any copy, while the question is open.
    const found = firstDiff(beforeAsk, snapshotOf(target), 'phone');
    if (found) {
      bad(`5: the phone changed while the question was open: ${found}`);
    }
    if (world.store.body(backupPathOf('G1')) !== firstCopy) {
      bad('5: the cloud copy changed while the question was open');
    }
    if (spec.scenario === 'otherAccount' && loggedMissing.length > 0 && outcome.summary.localFromOtherAccount !== true) {
      bad('5: a phone holding another account\'s data was asked restore-or-keep without being told the data is another account\'s');
    }
    if (spec.answer === 'keep') {
      const keep = await step('keep', () => operation(target, 'resolveRestoreChoice', 'keep_local'));
      if (keep !== 'done') {
        bad(`6: "keep this phone's data" ended "${keep}" with nothing in the way`);
      }
      const found = firstDiff(beforeAsk, snapshotOf(target), 'phone');
      if (found) {
        bad(`5: keeping this phone's data changed the phone: ${found}`);
      }
      checkCloudHolds('after keeping the phone\'s data', 'G1', { database: target.app.database, history: target.app.history });
      if (storedAccount(target)?.cloudVersion !== world.store.etag(backupPathOf('G1'))) {
        bad('6: "keep" was reported done and the phone does not hold the version of the copy it wrote');
      }
      // A new phone gets what the reader kept.
      await step('a new phone', () => newPhoneState(C, spec.seed + 1, null));
      await start(C);
      const deviceC = beforeNew(C);
      const next = await signIn(C, 'G1');
      if (next.kind !== 'restored') {
        bad(`1: a new phone signing in after "keep" ended "${next.kind}", not a restore`);
      }
      checkArrived('a new phone after "keep"', { database: target.app.database, history: target.app.history }, deviceC, { database: C.app.database, history: C.app.history });
      return;
    }
    if (spec.fault) {
      const failed = await step('restore', () => operation(target, 'resolveRestoreChoice', 'restore'));
      await checkFailedRestore(target, spec, beforeAsk, failed === 'failed' ? 'restore_failed' : failed);
      return;
    }
    const done = await step('restore', () => operation(target, 'resolveRestoreChoice', 'restore'));
    if (done !== 'done') {
      bad(`6: "restore" ended "${done}" with nothing in the way`);
    }
    restored = true;
  } else if (outcome.kind === 'restored') {
    if (spec.fault) {
      bad('6: a restore reported "restored" although the write was armed to fail');
    }
    restored = true;
    // 5. A restore that asked nothing took nothing the reader made.
    if (mustAsk) {
      bad(`5: the restore asked nothing on a phone that ${spec.live ? 'had a workout going' : `held ${loggedMissing[0]}`} (the backup lacks it)`);
    }
    const authored = authoredRowsMissingFrom(targetStart.database, original.database);
    if (authored.length > 0) {
      bad(`5: the restore asked nothing on a phone that held ${authored.join(', ')}, which the backup lacks`);
    }
  } else if (outcome.kind === 'restore_failed' && spec.fault) {
    await checkFailedRestore(target, spec, beforeAsk, 'restore_failed');
    return;
  } else {
    bad(`6: the sign-in of ${spec.scenario === 'fresh' ? 'a new phone' : 'a phone'} onto an account holding a backup ended "${outcome.kind}"`);
  }
  if (spec.fault) {
    bad('6: the armed write failure never happened, so the case tested nothing');
  }

  // 1. Everything arrived, on disk too. The source is the copy that was uploaded.
  const got = { database: target.app.database, history: target.app.history };
  checkArrived(`${spec.scenario}, restored`, original, devicePrefs, got);
  await checkOnDisk(`${spec.scenario}, restored`, target);
  if (spec.scenario === 'otherAccount' && world.store.body(backupPathOf('G2')) !== g2Before) {
    bad('4: restoring the account\'s own copy changed the other account\'s copy');
  }
  if (!storedAccount(target)?.lastBackupAt || storedAccount(target).cloudVersion !== world.store.etag(backupPathOf('G1'))) {
    bad('6: "restored" was reported and the phone does not hold the version of the copy it restored');
  }

  // 2. Back it up again and restore that: nothing moves.
  checkFingerprint(`${spec.scenario}, restored`, original, got);
  const again = await step('the second backup', () => operation(target, 'backUpOrAsk'));
  if (again.kind !== 'backed_up') {
    bad(`2: a phone that has just restored could not back itself up: "${again.kind}"`);
  }
  const found = firstDiff(stripPayload(dist.accountBackup.decodeAccountBackupBody(JSON.parse(firstCopy))), stripPayload(cloudPayload('G1')), 'payload');
  if (found) {
    bad(`2: backup(restore(backup(x))) is not backup(x): ${found}`);
  }
  await step('a new phone', () => newPhoneState(C, spec.seed + 2, null));
  await start(C);
  const device = beforeNew(C);
  const last = await signIn(C, 'G1');
  if (last.kind !== 'restored') {
    bad(`1: a new phone signing in to the second copy ended "${last.kind}", not a restore`);
  }
  // The copy the restored phone uploaded carries ITS privacy answers and acceptance, so that copy is the source now.
  const second = cloudPayload('G1');
  checkArrived('the second round, on a new phone', { database: second.database, history: second.workoutHistory }, device, { database: C.app.database, history: C.app.history });
  await checkOnDisk('the second round, on a new phone', C);
}

const beforeNew = (phone) => clean(phone.app.database.preferences);

/** A restore whose write was refused says so and leaves the phone as it was. */
async function checkFailedRestore(target, spec, before, kind) {
  count(`restore refused at write ${spec.fault} -> ${kind}`);
  if (kind !== 'restore_failed' && kind !== 'failed') {
    bad(`6: a restore whose write was refused ended "${kind}"`);
  }
  // In memory and on disk: the rollback puts back the phone's own database and preferences exactly, not through
  // the restore's merge (which would hand the phone the backup's "no" to usage statistics and later acceptance).
  const found = firstDiff(before, snapshotOf(target), 'phone');
  if (found) {
    bad(`5: a restore whose write was refused (write ${spec.fault}) changed the phone: ${found}`);
  }
  const disk = await readDisk(target);
  const onDisk = firstDiff(before, stateOf(disk.database, disk.history), 'disk');
  if (onDisk) {
    bad(`5: a restore whose write was refused (write ${spec.fault}) changed what the phone has on disk: ${onDisk}`);
  }
}

/** The source phone's data: generated, or one of the releases' stored rows. */
function sourceState(spec) {
  if (spec.src.kind === 'gen') {
    return genState(spec.src.seed, spec.src.knobs);
  }
  return corpusStates()[spec.src.index];
}

// ---------------------------------------------------------------------------
// The corpus: what sixteen releases wrote, opened by today's loaders
// ---------------------------------------------------------------------------

let corpusCache = null;
function corpusFixtures() {
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'build-corpus.cjs')
    .sort()
    .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8')) }));
}

function corpusStates() {
  return corpusCache;
}

async function loadCorpus() {
  const states = [];
  for (const fixture of corpusFixtures()) {
    const fake = createFakeAsyncStorage();
    for (const [key, value] of Object.entries(fixture.rows)) {
      fake.rows.set(key, value);
    }
    const M = loadAgainstFake(fake, (requireDist) => ({
      database: requireDist('storage/database.js'),
      workout: requireDist('features/workout/workoutPersistence.js'),
    }));
    const database = await M.database.loadDatabase();
    const history = (await M.workout.loadWorkoutBundle()).history;
    states.push({ name: fixture.name, database, history });
  }
  corpusCache = states;
}

// ---------------------------------------------------------------------------
// Making and shrinking cases
// ---------------------------------------------------------------------------

function makeSpec(random, index) {
  const t = tools(random);
  const useCorpus = index % 9 === 8 && corpusCache.length > 0;
  const seed = Math.floor(random() * 1e9);
  const scenario = t.pick(['same', 'fresh', 'fresh', 'other', 'other', 'otherAccount']);
  const answer = t.chance(0.25) && scenario !== 'fresh' ? 'keep' : 'restore';
  return {
    seed,
    src: useCorpus ? { kind: 'corpus', index: Math.floor((index / 9)) % corpusCache.length } : { kind: 'gen', seed, knobs: randomKnobs(random) },
    scenario,
    answer,
    newerLocal: scenario === 'same' && t.chance(0.5),
    gzip: t.chance(0.3),
    freshSetup: scenario === 'fresh' && t.chance(0.5),
    live: scenario !== 'same' && t.chance(0.1),
    body: t.chance(0.5) ? 'parsed' : 'string',
    fault: scenario !== 'same' && answer === 'restore' && t.chance(0.08) ? t.pick([1, 2]) : 0,
    other: { seed: seed + 7, knobs: randomKnobs(random) },
  };
}

function describeSpec(spec) {
  const src = spec.src.kind === 'corpus' ? `corpus release #${spec.src.index}` : `generated (seed ${spec.src.seed}, ${JSON.stringify(spec.src.knobs)})`;
  return `${src}; restore on ${spec.scenario}${spec.freshSetup ? ' (after setup)' : ''}${spec.newerLocal ? ' after logging more' : ''}${spec.live ? ' with a workout going' : ''}; answer ${spec.answer}; body ${spec.body}${spec.gzip ? '; gzip from 5000 chars' : ''}${spec.fault ? `; write ${spec.fault} refused` : ''}${spec.scenario.startsWith('other') ? `; other data ${JSON.stringify(spec.other.knobs)}` : ''}`;
}

async function failureOf(spec) {
  try {
    await runCase(spec);
    return null;
  } catch (error) {
    if (error instanceof Violation) {
      return error.message;
    }
    return `6: ${error instanceof Error ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`;
  } finally {
    dist.accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS = REAL_THRESHOLD;
    for (const phone of Object.values(phones)) {
      phone.runtime.unmount();
    }
  }
}

/**
 * Cases the random run once found, kept as they were printed (shortest first), so they stay run on every seed.
 */
const ZERO = { light: false, lightExtra: 'none', sessions: 0, logs: 0, sets: 0, cardio: 0, bodyweight: 0, measurements: 0, nameBook: 0, custom: 0, freestyle: 0, plans: 0, history: 0, slots: 0, weird: false, prefs: false };
const FIXED_CASES = [
  {
    // A restore whose history write is refused rolled the database back through the restore's own merge: the phone
    // kept the backup's later terms acceptance and "no" to usage statistics.
    name: 'a refused history write is rolled back exactly',
    spec: { seed: 688214348, src: { kind: 'gen', seed: 688214348, knobs: ZERO }, scenario: 'other', answer: 'restore', newerLocal: false, gzip: false, freshSetup: false, live: false, body: 'string', fault: 2, other: { seed: 688214355, knobs: { ...ZERO, logs: 3, sets: 4, history: 9, slots: 1, prefs: true } } },
  },
  {
    // A phone holding only a name book it taught was restored over without being asked.
    name: 'a name book alone is worth keeping',
    spec: { seed: 5, src: { kind: 'gen', seed: 5, knobs: { ...ZERO, sessions: 2, logs: 1, sets: 1 } }, scenario: 'other', answer: 'restore', newerLocal: false, gzip: false, freshSetup: false, live: false, body: 'string', fault: 0, other: { seed: 12, knobs: { ...ZERO, light: true, lightExtra: 'nameBook', logs: 1, sets: 1 } } },
  },
  {
    name: 'a strength goal alone is worth keeping',
    spec: { seed: 6, src: { kind: 'gen', seed: 6, knobs: { ...ZERO, sessions: 2, logs: 1, sets: 1 } }, scenario: 'other', answer: 'restore', newerLocal: false, gzip: false, freshSetup: false, live: false, body: 'string', fault: 0, other: { seed: 13, knobs: { ...ZERO, light: true, lightExtra: 'strengthGoal' } } },
  },
  {
    name: 'a coach goal alone is worth keeping',
    spec: { seed: 7, src: { kind: 'gen', seed: 7, knobs: { ...ZERO, sessions: 2, logs: 1, sets: 1 } }, scenario: 'other', answer: 'restore', newerLocal: false, gzip: false, freshSetup: false, live: false, body: 'parsed', fault: 0, other: { seed: 14, knobs: { ...ZERO, light: true, lightExtra: 'coachGoal' } } },
  },
];

/** Smaller knobs and fewer features and fewer features while the same invariant still fails. */
async function shrink(spec, message) {
  const kind = message.split(':')[0];
  let best = spec;
  let bestMessage = message;
  const numeric = ['sessions', 'logs', 'sets', 'cardio', 'bodyweight', 'measurements', 'nameBook', 'custom', 'freestyle', 'plans', 'history', 'slots'];
  const tryChange = async (candidate) => {
    const failure = await failureOf(candidate);
    if (failure && failure.split(':')[0] === kind) {
      best = candidate;
      bestMessage = failure;
      return true;
    }
    return false;
  };
  const simplify = [
    (s) => ({ ...s, freshSetup: false }),
    (s) => ({ ...s, newerLocal: false }),
    (s) => ({ ...s, live: false }),
    (s) => ({ ...s, body: 'string' }),
    (s) => ({ ...s, gzip: false }),
    (s) => ({ ...s, answer: 'restore' }),
  ];
  for (const knob of numeric) {
    simplify.push((s) => ({ ...s, other: { ...s.other, knobs: { ...s.other.knobs, [knob]: 0 } } }));
  }
  simplify.push((s) => ({ ...s, other: { ...s.other, knobs: { ...s.other.knobs, weird: false } } }));
  let progress = true;
  while (progress) {
    progress = false;
    for (const change of simplify) {
      const candidate = change(best);
      if (JSON.stringify(candidate) !== JSON.stringify(best) && (await tryChange(candidate))) {
        progress = true;
      }
    }
    if (best.src.kind !== 'gen') {
      break;
    }
    for (const knob of numeric) {
      for (const value of [0, Math.floor(best.src.knobs[knob] / 2)]) {
        if (value < best.src.knobs[knob] && (await tryChange({ ...best, src: { ...best.src, knobs: { ...best.src.knobs, [knob]: value } } }))) {
          progress = true;
        }
      }
    }
    for (const flag of ['weird', 'prefs']) {
      if (best.src.knobs[flag] && (await tryChange({ ...best, src: { ...best.src, knobs: { ...best.src.knobs, [flag]: false } } }))) {
        progress = true;
      }
    }
  }
  return { spec: best, message: bestMessage };
}

// ---------------------------------------------------------------------------
// The older releases, the size cases, the generator's own check
// ---------------------------------------------------------------------------

/** Puts a request body on the endpoint as a Google account's first backup, the way an old phone's upload would. */
async function uploadAs(account, body) {
  return callHandler(handler, {
    method: 'PUT',
    headers: { authorization: `Bearer ${googleIdToken(account)}`, 'content-type': 'application/json', 'x-backup-expected-version': 'none' },
    body,
  });
}

const DERIVED_ON_LOAD = new Set(['libraryItemId', 'repMin', 'weight', 'repsPerSet', 'setsCompleted', 'exercisesCompleted', 'totalVolumeKg', 'exercisesSkipped', 'exercisesSwapped']);

/** Every readable field the old data held, found again in what the restore made (the storage invariant's rule). */
function oldDataKept(label, raw, got) {
  const collections = ['workoutTemplates', 'exerciseTemplates', 'workoutPlans', 'workoutSessions', 'cardioSessions', 'exerciseLogs', 'bodyweightEntries', 'measurementEntries', 'exerciseNameBook'];
  for (const name of collections) {
    const rawList = raw[name];
    if (!Array.isArray(rawList)) {
      continue;
    }
    const key = name === 'exerciseNameBook' ? 'alias' : 'id';
    const byId = new Map((got[name] ?? []).map((row) => [row[key], row]));
    for (const row of rawList) {
      const found = byId.get(row[key]);
      if (!found) {
        bad(`3: ${label}: ${name} "${row[key]}" is gone`);
      }
      for (const [field, value] of Object.entries(row)) {
        if (DERIVED_ON_LOAD.has(field) || value === null || value === undefined || field === 'sets' || field === 'sessions' || field === 'entries' || field === 'exerciseIds' || field === 'updatedAt' || field === 'swappedFrom' || field === 'exerciseTemplateId' || field === 'status' || field === 'workoutNameSnapshot' || field === 'activityType' || field === 'sessionNotes') {
          continue;
        }
        // The one rewrite a load makes on purpose: a programme saved before
        // the library's category correction keeps its lifts in the progression
        // (lib/trackingCategoryMigration) — false to true, on exactly the rows
        // its rule names, and nothing else.
        if (
          name === 'exerciseTemplates' &&
          field === 'trackedDefault' &&
          value === false &&
          found?.trackedDefault === true &&
          dist.tracking.restoreTrackingAfterCategoryCorrection([{ ...found, trackedDefault: false }], got.exerciseLibrary)[0].trackedDefault === true
        ) {
          continue;
        }
        const diff = firstDiff(clean(value), clean(found[field]), `${name} "${row[key]}".${field}`);
        if (diff) {
          bad(`3: ${label}: ${diff}`);
        }
      }
      if (name === 'exerciseLogs' && Array.isArray(row.sets)) {
        if ((found.sets ?? []).length !== row.sets.length) {
          bad(`3: ${label}: log "${row.id}" had ${row.sets.length} sets, has ${(found.sets ?? []).length}`);
        }
        row.sets.forEach((set, index) => {
          for (const field of ['weight', 'reps', 'kind']) {
            if (set[field] !== undefined && set[field] !== found.sets[index][field]) {
              bad(`3: ${label}: log "${row.id}" set ${index}.${field} ${short(set[field])} became ${short(found.sets[index][field])}`);
            }
          }
        });
      }
    }
  }
}

async function crossVersion() {
  const files = fs.readdirSync(OLD_PAYLOAD_DIR).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length >= 3, 'the cross-version corpus has at least three releases');
  const corpus = corpusFixtures();
  let checked = 0;
  for (const file of files) {
    const old = JSON.parse(fs.readFileSync(path.join(OLD_PAYLOAD_DIR, file), 'utf8'));
    const fixture = corpus.find((entry) => entry.sha === old.sha);
    assert.ok(fixture, `${file}: the release's stored rows are in storage-history`);
    world = freshWorld();
    Date.now = () => world.now;
    const [A, B] = [phones.A, phones.B];
    resetPhone(A);
    resetPhone(B);
    await start(A);
    await start(B);
    const label = `release ${old.sha} (${old.date})`;
    const up = await uploadAs('G1', old.body);
    if (up.status !== 200 || up.body?.ok !== true) {
      bad(`3: ${label}: the endpoint refused the body that release uploaded: ${up.status} ${JSON.stringify(up.body)}`);
    }
    // Today's phone, as the same rows would have it, is the oracle.
    const phoneRows = createFakeAsyncStorage();
    for (const [key, value] of Object.entries(fixture.rows)) {
      phoneRows.rows.set(key, value);
    }
    const M = loadAgainstFake(phoneRows, (requireDist) => ({
      database: requireDist('storage/database.js'),
      workout: requireDist('features/workout/workoutPersistence.js'),
    }));
    const today = { database: await M.database.loadDatabase(), history: (await M.workout.loadWorkoutBundle()).history };
    await newPhoneState(B, 1, null);
    const device = clean(B.app.database.preferences);
    const outcome = await signIn(B, 'G1');
    if (outcome.kind !== 'restored') {
      bad(`3: ${label}: a new phone signing in to that backup ended "${outcome.kind}"`);
    }
    // Same data, apart from what a release wrote into its preferences that no longer is one (the storage invariant's list).
    checkArrived(label, today, device, { database: B.app.database, history: B.app.history });
    await checkOnDisk(label, B);
    // And nothing the release held is gone, whatever today's loader makes of it.
    const rawDatabase = JSON.parse(fixture.rows['@vinha/database/v1'] ?? fixture.rows['@gymlog/database/v1']);
    oldDataKept(label, rawDatabase, B.app.database);
    const rawBundle = JSON.parse(fixture.rows['@vinha/workout/v1'] ?? fixture.rows['@gymlog/workout/v1']);
    if (B.app.history.sessions.length !== (rawBundle.history?.sessions ?? []).length) {
      bad(`3: ${label}: ${(rawBundle.history?.sessions ?? []).length} remembered sessions became ${B.app.history.sessions.length}`);
    }
    count('cross-version restore');
    checked += B.app.database.exerciseLogs.length + B.app.database.workoutSessions.length + B.app.history.sessions.length;
    for (const phone of [A, B]) {
      phone.runtime.unmount();
    }
  }
  assert.ok(checked > 60, `the cross-version check looked at ${checked} rows: too few to mean anything`);
}

/**
 * Loads a state onto a phone with one workout's note padded so the payload JSON is exactly `chars` long
 * (measured on what the loader made of it, built with a fixed-width exportedAt).
 */
async function placePadded(phone, state, chars) {
  const lengthOf = () => JSON.stringify(dist.accountBackup.buildAccountBackupPayload(phone.app.database, phone.app.history, new Date(0).toISOString())).length;
  const noted = (n) => {
    const database = clean({ ...state.database, exerciseLibrary: [] });
    database.workoutSessions[0].sessionNotes = `x${'y'.repeat(n)}`;
    return database;
  };
  await setDisk(phone, noted(0), state.history);
  const base = lengthOf();
  assert.ok(chars > base, 'the base state is smaller than the target');
  await setDisk(phone, noted(chars - base), state.history);
  assert.equal(lengthOf(), chars, 'the padding is exact');
}

async function sizeCases() {
  const accountBackup = dist.accountBackup;
  const threshold = accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS;
  // The threshold itself: one character either side of it.
  for (const delta of [-1, 0, 1]) {
    for (const bodyMode of ['string', 'parsed']) {
      world = freshWorld();
      world.bodyMode = bodyMode;
      Date.now = () => world.now;
      const [A, B] = [phones.A, phones.B];
      resetPhone(A);
      resetPhone(B);
      await start(A);
      await start(B);
      await placePadded(A, genState(11, { ...randomKnobs(part(11, 'k')), light: false, sessions: 6, logs: 3, sets: 3, weird: false }), threshold + delta);
      const sent = JSON.stringify(accountBackup.buildAccountBackupPayload(A.app.database, A.app.history, new Date(0).toISOString())).length;
      const first = await signIn(A, 'G1');
      if (first.kind !== 'backed_up') {
        bad(`4: a payload of ${sent} chars (threshold ${threshold}) was not backed up: "${first.kind}"`);
      }
      const stored = JSON.parse(world.store.body(backupPathOf('G1')));
      const compressed = stored.encoding === accountBackup.ACCOUNT_BACKUP_ENCODING;
      if (compressed !== sent > threshold) {
        bad(`4: a payload of ${sent} chars (threshold ${threshold}) was ${compressed ? '' : 'not '}compressed`);
      }
      checkCloudHolds(`${sent} chars`, 'G1', { database: A.app.database, history: A.app.history });
      await newPhoneState(B, 3, null);
      const device = clean(B.app.database.preferences);
      const next = await signIn(B, 'G1');
      if (next.kind !== 'restored') {
        bad(`4: a payload of ${sent} chars was backed up and a new phone's sign-in ended "${next.kind}"`);
      }
      checkArrived(`${sent} chars`, { database: A.app.database, history: A.app.history }, device, { database: B.app.database, history: B.app.history });
      count(`size ${delta} ${bodyMode} ${compressed ? 'gzip' : 'plain'}`);
      A.runtime.unmount();
      B.runtime.unmount();
    }
  }

  // The server's cap. Random text does not compress, so the wire size follows the text size closely.
  const wireBytes = (database, history) => Buffer.byteLength(accountBackup.encodeAccountBackupBody(accountBackup.buildAccountBackupPayload(database, history, new Date(0).toISOString())), 'utf8');
  // Seeded: the same text every run, so the sizes below are the same every run (an unseeded one moved them by a few KB).
  const filler = (n) => {
    const next = mulberry32(0x5eed);
    let text = '';
    while (text.length < n) {
      text += Math.floor(next() * 4294967296).toString(16).padStart(8, '0');
    }
    return text.slice(0, n);
  };
  const seedState = genState(13, { ...randomKnobs(part(13, 'k')), light: false, sessions: 3, logs: 2, sets: 2, weird: false });
  const withNote = (chars) => {
    const database = clean({ ...seedState.database, exerciseLibrary: [] });
    database.workoutSessions[0].sessionNotes = `n${filler(chars)}`;
    return database;
  };
  // Calibrate on two samples: the wire bytes are a line in the characters of random hex (the gzip window is 32 KB).
  const [lo, hi] = [1_000_000, 2_000_000];
  const wireLo = wireBytes(withNote(lo), seedState.history);
  const slope = (wireBytes(withNote(hi), seedState.history) - wireLo) / (hi - lo);
  const base = wireLo - slope * lo;
  const under = Math.floor((SERVER_CAP - 40_000 - base) / slope);
  const over = Math.ceil((SERVER_CAP + 40_000 - base) / slope);
  for (const bodyMode of ['string', 'parsed']) {
    for (const [name, size, fits] of [['just under the server cap', under, true], ['just over the server cap', over, false]]) {
      world = freshWorld();
      world.bodyMode = bodyMode;
      Date.now = () => world.now;
      const [A, B] = [phones.A, phones.B];
      resetPhone(A);
      resetPhone(B);
      await start(A);
      await start(B);
      const database = withNote(size);
      await setDisk(A, database, seedState.history);
      const bytes = wireBytes(A.app.database, A.app.history);
      if (fits !== bytes <= SERVER_CAP) {
        bad(`6: the calibration of the size case is off: ${bytes} bytes for a case that must ${fits ? 'fit' : 'not fit'}`);
      }
      const before = world.store.puts;
      const first = await signIn(A, 'G1');
      if (fits) {
        if (first.kind !== 'backed_up') {
          bad(`4: a backup of ${bytes} bytes (cap ${SERVER_CAP}) ended "${first.kind}"`);
        }
        checkCloudHolds(name, 'G1', { database: A.app.database, history: A.app.history });
        await newPhoneState(B, 5, null);
        const device = clean(B.app.database.preferences);
        const next = await signIn(B, 'G1');
        if (next.kind !== 'restored') {
          bad(`4: ${name}: a new phone signing in ended "${next.kind}"`);
        }
        checkArrived(name, { database: A.app.database, history: A.app.history }, device, { database: B.app.database, history: B.app.history });
        await checkOnDisk(name, B);
      } else {
        // 4/N6. Refused: never reported as saved, and nothing stored, not even a part of it.
        if (first.kind === 'backed_up') {
          bad(`4: a backup of ${bytes} bytes, over the cap, was reported as backed up`);
        }
        if (world.store.puts !== before || world.store.body(backupPathOf('G1')) !== null) {
          bad(`4: a backup of ${bytes} bytes, over the cap, left something in the store`);
        }
        const account = storedAccount(A);
        if (account?.lastBackupAt) {
          bad(`6: a backup the server refused left the phone believing it was backed up at ${account.lastBackupAt}`);
        }
        const refusal = A.seen.find((entry) => entry.method === 'PUT');
        if (refusal?.status !== 413 || refusal.error !== 'PAYLOAD_TOO_LARGE') {
          bad(`4: the refusal was ${refusal?.status} ${refusal?.error}, not a clear 413 PAYLOAD_TOO_LARGE`);
        }
        count(`size refused (${bodyMode})`);
      }
      A.runtime.unmount();
      B.runtime.unmount();
    }
  }

  // A copy that is already there is not touched by an upload that no longer fits.
  world = freshWorld();
  Date.now = () => world.now;
  const [A, B] = [phones.A, phones.B];
  resetPhone(A);
  resetPhone(B);
  await start(A);
  await start(B);
  await setDisk(A, withNote(1000), seedState.history);
  const small = await signIn(A, 'G1');
  if (small.kind !== 'backed_up') {
    bad(`4: the small backup ended "${small.kind}"`);
  }
  const copy = world.store.body(backupPathOf('G1'));
  const accountBefore = storedAccount(A);
  await setDisk(A, withNote(over), seedState.history);
  const grown = await operation(A, 'backUpOrAsk');
  if (grown.kind === 'backed_up') {
    bad('4: an upload over the cap, onto an existing copy, was reported as backed up');
  }
  if (world.store.body(backupPathOf('G1')) !== copy) {
    bad('4: an upload over the cap changed the copy the cloud holds');
  }
  if (storedAccount(A).lastBackupAt !== accountBefore.lastBackupAt || storedAccount(A).cloudVersion !== accountBefore.cloudVersion) {
    bad('6: an upload over the cap changed what the phone believes about the cloud copy');
  }
  await newPhoneState(B, 9, null);
  const next = await signIn(B, 'G1');
  if (next.kind !== 'restored' || B.app.database.workoutSessions[0].sessionNotes.length !== 1001) {
    bad('4: after a refused upload the cloud copy no longer restores as it was');
  }
  count('size refused over existing copy');
  A.runtime.unmount();
  B.runtime.unmount();
}

/** The generator is only worth running if it reaches what it claims to: what it makes survives the app's own loader. */
async function generatorReaches() {
  const phone = phones.A;
  const seen = { sessions: 0, rampSets: 0, dropSets: 0, warmups: 0, planned: 0, supersets: 0, swaps: 0, notes: 0, weird: 0, plans: 0, cardio: 0, nameBook: 0, cautions: 0 };
  for (let index = 0; index < 60; index += 1) {
    const random = mulberry32(900 + index);
    const knobs = { ...randomKnobs(random), light: false, weird: true, prefs: true };
    const state = genState(900 + index, knobs);
    resetPhone(phone);
    world = freshWorld();
    assert.equal(new Date().getTime(), world.now, 'new Date() reads the clock of the world, not the real one');
    assert.equal(Date.now(), world.now);
    await setDisk(phone, state.database, state.history);
    const got = phone.app.database;
    const lost = (name) => bad(`6: the generator's ${name} did not survive the loader (case ${index}, ${JSON.stringify(knobs)})`);
    if (got.workoutSessions.length !== state.database.workoutSessions.length) lost('workouts');
    if (got.exerciseLogs.length !== state.database.exerciseLogs.length) lost('logs');
    for (const log of got.exerciseLogs) {
      const wanted = state.database.exerciseLogs.find((entry) => entry.id === log.id);
      if (log.sets.length !== wanted.sets.length) lost('sets');
      log.sets.forEach((set, at) => {
        if (set.kind !== wanted.sets[at].kind || set.weight !== wanted.sets[at].weight || set.reps !== wanted.sets[at].reps) lost('set values');
        if (wanted.sets[at].planned && !set.planned) lost('planned data');
        if (set.kind === 'drop') seen.dropSets += 1;
        if (set.kind === 'warmup') seen.warmups += 1;
        if (set.planned) seen.planned += 1;
      });
      if (log.swappedFrom) seen.swaps += 1;
      if (log.notes) seen.notes += 1;
      if (log.sets.length > 2 && log.sets[0].weight < log.sets[log.sets.length - 1].weight) seen.rampSets += 1;
    }
    if (got.cardioSessions.length !== state.database.cardioSessions.length) lost('cardio');
    if (got.measurementEntries.length !== state.database.measurementEntries.length) lost('measurements');
    if (got.bodyweightEntries.length !== state.database.bodyweightEntries.length) lost('weigh-ins');
    if (got.exerciseNameBook.length !== state.database.exerciseNameBook.length) lost('name book');
    if (got.workoutPlans.length !== state.database.workoutPlans.length) lost('plans');
    if (got.workoutTemplates.length !== state.database.workoutTemplates.length) lost('programmes');
    if (phone.app.history.sessions.length !== state.history.sessions.length) lost('history');
    seen.sessions += got.workoutSessions.length;
    seen.supersets += got.exerciseTemplates.filter((row) => row.supersetGroup).length;
    seen.weird += got.workoutTemplates.filter((row) => /[\ud800-\udfff\ufeff\u0000]/.test(row.name)).length + got.exerciseLogs.filter((row) => /[\ud800-\udfff\u0000]/.test(row.notes ?? '')).length;
    seen.plans += got.workoutPlans.length;
    seen.cardio += got.cardioSessions.length;
    seen.nameBook += got.exerciseNameBook.length;
    seen.cautions += got.preferences.setupCautionFlags.length;
  }
  for (const [name, total] of Object.entries(seen)) {
    assert.ok(total > 0, `the generator never produced ${name}`);
  }
  phone.runtime.unmount();
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function withWorld(run) {
  // The clock is the world's, for `new Date()` as much as for Date.now: exportedAt, the endpoint's savedAt and the
  // loaders' fallbacks all read it, so no case depends on the real time (two uploads in one millisecond used to be
  // able to carry the same exportedAt).
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(world ? world.now : RealDate.now());
      } else {
        super(...args);
      }
    }
    static now() {
      return world ? world.now : RealDate.now();
    }
  }
  global.Date = FakeDate;
  const savedNow = RealDate.now;
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
  const require_ = (relative) => require(path.join(DIST, relative));
  console.error = () => undefined;
  try {
    await withEnv(
      {
        GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
        BACKUP_PATH_SECRET: SECRET,
        APPLE_BUNDLE_ID: undefined,
        BACKUP_RATE_LIMIT_MAX: '100000000',
        BACKUP_MAX_BYTES: undefined,
        EXPO_PUBLIC_BACKUP_API_URL: API_URL,
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios.client',
        APP_MIN_VERSION_IOS: undefined,
        APP_MIN_VERSION_ANDROID: undefined,
      },
      async () => {
        stubModule('@react-native-google-signin/google-signin', googleModule);
        stubModule('expo-apple-authentication', { isAvailableAsync: async () => false });
        global.fetch = fakeFetch;
        dist = { accountBackup: require_('lib/accountBackup.js'), seed: require_('data/seed.js'), tracking: require_('lib/trackingCategoryMigration.js') };
        REAL_THRESHOLD = dist.accountBackup.ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS;
        world = freshWorld();
        handler = loadApiModule('api/backup.ts', { '@vercel/blob': blobModule }).default;
        phones = { A: loadPhone('phone A'), B: loadPhone('phone B'), C: loadPhone('phone C') };
        await run();
      },
    );
  } finally {
    console.error = quiet;
    global.Date = RealDate;
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
    dist = null;
    corpusCache = null;
  }
}

function guardAgainstDrift() {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
  const app = read('src/state/AppProvider.tsx');
  assert.ok(
    app.includes('const restored = normalizeDatabase(input);') &&
      app.includes('preferencesForRestore(restored.preferences, databaseRef.current.preferences, restored.workoutPlans)') &&
      app.includes('await commit(next);') &&
      app.includes('if (options.rollback) {') &&
      app.includes('await commit(exact);'),
    'AppProvider.restoreDatabaseFromBackup changed: rebuild the phone model in props() from it',
  );
  assert.ok(read('App.tsx').includes('liveSession: hasWorkoutInProgress({ ...workout, freestyleDraft }),'), 'App.tsx no longer tells the backup hook about a workout in progress through hasWorkoutInProgress');
  const inProgress = require(path.join(DIST, 'lib', 'accountBackup.js')).hasWorkoutInProgress;
  for (const key of ['activeSession', 'activeCardio', 'freestyleDraft']) {
    assert.equal(inProgress({ activeSession: null, activeCardio: null, freestyleDraft: null, [key]: {} }), true, `a ${key} is a workout in progress`);
  }
  assert.equal(inProgress({ activeSession: null, activeCardio: null, freestyleDraft: null }), false);
  assert.ok(read('src/features/account/useAccountBackup.ts').includes('await restoreDatabase(previous, { rollback: true });'), 'a failed restore\'s rollback no longer asks for the exact previous database');
  const workout = read('src/features/workout/WorkoutProvider.tsx');
  assert.ok(
    workout.includes('normalizeWorkoutBundle({ activeSession: null, history, activeCardio: null, freestyleDraft: null })') &&
      workout.includes('await saveWorkoutBundle(bundle);'),
    'WorkoutProvider.restoreHistoryFromBackup changed: rebuild the phone model in props() from it',
  );
  const proEntitlement = require(path.join(DIST, 'lib', 'proEntitlement.js'));
  assert.deepEqual([...proEntitlement.DEVICE_ONLY_PREFERENCE_FIELDS].sort(), [...DEVICE_ONLY].sort(), 'DEVICE_ONLY_PREFERENCE_FIELDS changed: this invariant lists the phone\'s own fields itself');
  const accountBackup = require(path.join(DIST, 'lib', 'accountBackup.js'));
  assert.deepEqual([...accountBackup.DEVICE_PRIVACY_PREFERENCE_FIELDS].sort(), [...PRIVACY].sort(), 'DEVICE_PRIVACY_PREFERENCE_FIELDS changed: this invariant lists the privacy fields itself');
}

module.exports = [
  {
    name: 'backup round trip: the model of the restore still matches the providers, and the phone\'s own fields are the ones this test lists',
    run() {
      guardAgainstDrift();
    },
  },
  {
    name: 'backup round trip: the generator\'s databases survive the app\'s own loader, so the cases carry what they claim',
    async run() {
      await withWorld(generatorReaches);
    },
  },
  {
    name: `backup round trip: ${CASES} random databases and the 16 past releases, backed up through the real client and endpoint and restored on the same, a new, another-data and another-account phone, lose nothing`,
    async run() {
      await withWorld(async () => {
        if (REPLAY) {
          await loadCorpus();
          const spec = JSON.parse(REPLAY);
          const failure = await failureOf(spec);
          assert.equal(failure, null, `${failure} (${describeSpec(spec)})`);
          return;
        }
        await loadCorpus();
        for (const fixed of FIXED_CASES) {
          const failure = await failureOf(fixed.spec);
          assert.equal(failure, null, `${fixed.name}: ${failure}`);
        }
        const random = mulberry32(SEED);
        for (let index = 0; index < CASES; index += 1) {
          const spec = makeSpec(random, index);
          const failure = await failureOf(spec);
          if (failure) {
            const small = await shrink(spec, failure);
            assert.fail(
              [
                `invariant broken (seed ${SEED}, case #${index}; reproduce with BACKUP_ROUNDTRIP_SEED=${SEED} BACKUP_ROUNDTRIP_SEQUENCES=${index + 1}).`,
                `  ${small.message}`,
                `  shortest case: ${describeSpec(small.spec)}`,
                `  replay: BACKUP_ROUNDTRIP_REPLAY='${JSON.stringify(small.spec)}'`,
              ].join('\n'),
            );
          }
        }
        // Every release of the corpus, on every restore situation.
        for (let release = 0; release < corpusCache.length; release += 1) {
          for (const scenario of ['same', 'fresh', 'other', 'otherAccount']) {
            const spec = { seed: 77 + release, src: { kind: 'corpus', index: release }, scenario, answer: 'restore', newerLocal: scenario === 'same' && release % 2 === 0, live: false, body: release % 2 ? 'parsed' : 'string', fault: 0, other: { seed: 500 + release, knobs: randomKnobs(mulberry32(release)) } };
            const failure = await failureOf(spec);
            assert.equal(failure, null, `${failure} (${describeSpec(spec)}; corpus ${corpusCache[release].name})`);
          }
        }
        if (STATS) {
          console.log([...STATS].sort().map(([key, n]) => `${n} ${key}`).join('\n'));
        }
      });
    },
  },
  {
    name: 'backup round trip: what older releases uploaded restores on today\'s code with nothing readable lost',
    async run() {
      await withWorld(async () => {
        try {
          await crossVersion();
        } catch (error) {
          if (error instanceof Violation) {
            assert.fail(error.message);
          }
          throw error;
        }
      });
    },
  },
  {
    name: 'backup round trip: payloads at the gzip threshold and at the server cap are restored whole or refused, and a refusal is never reported as saved',
    async run() {
      await withWorld(async () => {
        try {
          await sizeCases();
        } catch (error) {
          if (error instanceof Violation) {
            assert.fail(error.message);
          }
          throw error;
        } finally {
          for (const phone of Object.values(phones)) {
            phone.runtime.unmount();
          }
        }
      });
    },
  },
];
