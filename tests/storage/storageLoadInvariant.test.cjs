const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFakeAsyncStorage, loadAgainstFake } = require('./fakeAsyncStorage.cjs');

/**
 * The app opens on any data it ever wrote (never-list N3).
 *
 * The invariant, for both stored keys (`@vinha/database/v1` through
 * storage/database.ts and `@vinha/workout/v1` through
 * features/workout/workoutPersistence.ts, both via storage/largeItem.ts):
 *
 *   1. CORPUS. Rows written by sixteen past releases (April to October 2026,
 *      tests/fixtures/storage-history, built by build-corpus.cjs from each
 *      release's own compiled source) load without throwing, nothing the old
 *      version stored is gone afterwards (count and key values), nothing is
 *      set aside as corrupt, and load -> save -> load changes nothing.
 *   2. LONG HISTORY. ~300 sessions, past the 1.8 MB split point, round-trip
 *      through the splitting writer and the 2 MB-row-limit storage.
 *   3. FUZZ. 2400 seeded corruptions of valid stored values. The loader never
 *      throws; a value that cannot be read is set aside under the documented
 *      corrupt key, byte for byte; and one bad field degrades that field only:
 *      every collection and every element the corruption did not touch comes
 *      back.
 *
 * What the invariant does NOT promise: a quarantined blob is not loaded back
 * automatically, only kept. A collection or element that was itself corrupted
 * may be dropped or defaulted.
 */

const FUZZ_CASES = 2400;
const FUZZ_SEED = 0x5eed2026;

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'storage-history');
const DB_KEYS = ['@vinha/database/v1', '@gymlog/database/v1'];
const WK_KEYS = ['@vinha/workout/v1', '@gymlog/workout/v1'];
const DB_CORRUPT = '@vinha/database/corrupt';
const WK_CORRUPT = '@vinha/workout/corrupt';

// --------------------------------------------------------------- plumbing

function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) }));
}

function open(rows) {
  return openStorage(rows);
}
function openStorage(rows) {
  const fake = createFakeAsyncStorage();
  for (const [key, value] of rows) {
    fake.rows.set(key, value);
  }
  const mods = loadAgainstFake(fake, (requireDist) => ({
    database: requireDist('storage/database.js'),
    workout: requireDist('features/workout/workoutPersistence.js'),
    large: requireDist('storage/largeItem.js'),
  }));
  return { fake, ...mods };
}

function rowsOf(fixture) {
  return Object.entries(fixture.rows);
}

function pick(obj, keys) {
  for (const key of keys) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function plainDescribe(value) {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(JSON.stringify(value));
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

// ------------------------------------------------- what "still there" means

const DB_COLLECTIONS = {
  workoutTemplates: { id: 'id', fields: ['name', 'createdAt'] },
  exerciseTemplates: { id: 'id', fields: ['name', 'targetSets', 'repMax', 'workoutTemplateId'] },
  workoutPlans: { id: 'id', fields: ['name'] },
  workoutSessions: { id: 'id', fields: ['workoutTemplateId', 'workoutNameSnapshot'] },
  cardioSessions: { id: 'id', fields: ['activityType', 'durationSec'] },
  exerciseLogs: { id: 'id', fields: ['sessionId', 'exerciseNameSnapshot'] },
  bodyweightEntries: { id: 'id', fields: ['weight'] },
  measurementEntries: { id: 'id', fields: ['kind', 'value'] },
  exerciseNameBook: { id: 'alias', fields: ['wrote', 'exerciseName'] },
};

/** Problems in `loaded` against `raw` for one collection; only `onlyIds` when given. */
function compareCollection(name, rawList, loadedList, onlyIds) {
  const spec = DB_COLLECTIONS[name];
  const problems = [];
  if (!Array.isArray(rawList)) return problems;
  const byId = new Map((Array.isArray(loadedList) ? loadedList : []).map((item) => [item && item[spec.id], item]));
  for (const rawItem of rawList) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const id = rawItem[spec.id];
    if (typeof id !== 'string') continue;
    if (onlyIds && !onlyIds.has(id)) continue;
    const got = byId.get(id);
    if (!got) {
      problems.push(`${name}: "${id}" is gone`);
      continue;
    }
    // Derived on load, by design: repMin follows repMax (one rep number per
    // lift, 2026-08-25) and a log's weight is its heaviest set when it has
    // sets. The sets themselves are compared below.
    const fields = name === 'exerciseLogs' && !Array.isArray(rawItem.sets) ? [...spec.fields, 'weight'] : spec.fields;
    for (const field of fields) {
      if (rawItem[field] !== undefined && rawItem[field] !== null && !same(rawItem[field], got[field])) {
        problems.push(`${name}: "${id}".${field} ${plainDescribe(rawItem[field])} became ${plainDescribe(got[field])}`);
      }
    }
    if (name === 'exerciseLogs' && Array.isArray(rawItem.sets)) {
      const gotSets = Array.isArray(got.sets) ? got.sets : [];
      if (gotSets.length !== rawItem.sets.length) {
        problems.push(`exerciseLogs: "${id}" had ${rawItem.sets.length} sets, has ${gotSets.length}`);
      } else {
        rawItem.sets.forEach((set, index) => {
          for (const field of ['weight', 'reps', 'kind']) {
            if (set[field] !== undefined && !same(set[field], gotSets[index][field])) {
              problems.push(`exerciseLogs: "${id}" set ${index}.${field} ${plainDescribe(set[field])} became ${plainDescribe(gotSets[index][field])}`);
            }
          }
        });
      }
    }
  }
  return problems;
}

/**
 * Every preference the release stored, as it was stored. The preferences key
 * (from 2026-08-18) wins over the blob's own copy, so it is the source when
 * the fixture has one. A flipped onboardingCompleted sends the reader back to
 * onboarding, so nothing here is a field to be lenient about.
 */
// Fields a later release took out on purpose: the old theme switch, the premium
// unlock, the tracked-lift list, the free-coach quota, the mock-subscription
// cancel flag, the own-warmup switch, the per-lift bar choice and the season
// sign-ups (the season feature, removed 2026-10-12).
const RETIRED_PREFERENCES = new Set(['theme', 'adaptiveCoachPremiumUnlocked', 'trackedExerciseLibraryItemIds', 'aiCoachFreeQuota', 'mockSubscriptionCancelled', 'alwaysOwnWarmup', 'barChoiceByExercise', 'seasonEnrolments']);

/** Every key of `raw` is in `loaded` with the same value; `loaded` may carry more. */
function holds(raw, loaded) {
  if (raw && loaded && typeof raw === 'object' && typeof loaded === 'object' && !Array.isArray(raw) && !Array.isArray(loaded)) {
    return Object.entries(raw).every(([key, value]) => holds(value, loaded[key]));
  }
  return same(raw, loaded);
}

function comparePreferences(rawPreferences, loadedPreferences) {
  const problems = [];
  for (const [field, value] of Object.entries(rawPreferences || {})) {
    if (RETIRED_PREFERENCES.has(field)) continue;
    if (!holds(value, loadedPreferences[field])) {
      problems.push(`preferences.${field} ${plainDescribe(value)} became ${plainDescribe(loadedPreferences[field])}`);
    }
  }
  return problems;
}

function compareDatabase(raw, loaded, protectedIds) {
  const problems = [];
  for (const name of Object.keys(DB_COLLECTIONS)) {
    if (!(name in raw)) continue;
    problems.push(...compareCollection(name, raw[name], loaded[name], protectedIds ? protectedIds[name] : null));
  }
  return problems;
}

/** `scope`: which parts of the bundle are protected; null means all of it. */
function compareBundle(raw, loaded, scope) {
  const problems = [];
  const want = (part) => !scope || scope.parts.has(part);
  if (want('activeSession') && raw.activeSession) {
    const session = loaded.activeSession;
    if (!session) {
      problems.push('activeSession: the running workout is gone');
    } else {
      if (session.sessionId !== raw.activeSession.sessionId) problems.push('activeSession: another sessionId');
      if (session.exercises.length !== raw.activeSession.exercises.length) {
        problems.push(`activeSession: ${raw.activeSession.exercises.length} lifts became ${session.exercises.length}`);
      } else {
        raw.activeSession.exercises.forEach((exercise, index) => {
          const got = session.exercises[index];
          if (got.exerciseName !== exercise.exerciseName) problems.push(`activeSession: lift ${index} renamed`);
          if (got.sets.length !== exercise.sets.length) problems.push(`activeSession: lift ${index} sets ${exercise.sets.length} -> ${got.sets.length}`);
          exercise.sets.forEach((set, setIndex) => {
            const gotSet = got.sets[setIndex];
            if (!gotSet) return;
            for (const field of ['status', 'actualLoadKg', 'actualReps', 'draftLoadText', 'draftRepsText']) {
              if (set[field] !== undefined && set[field] !== gotSet[field]) {
                problems.push(`activeSession: lift ${index} set ${setIndex}.${field} ${plainDescribe(set[field])} -> ${plainDescribe(gotSet[field])}`);
              }
            }
          });
        });
      }
    }
  }
  if (want('activeCardio') && raw.activeCardio && (!loaded.activeCardio || loaded.activeCardio.accumulatedMs !== raw.activeCardio.accumulatedMs)) {
    problems.push('activeCardio: the running cardio session is gone or changed');
  }
  if (want('freestyleDraft') && raw.freestyleDraft) {
    const draft = loaded.freestyleDraft;
    if (!draft || draft.exercises.length !== raw.freestyleDraft.exercises.length) {
      problems.push('freestyleDraft: the free workout in flight is gone');
    }
  }
  const history = raw.history;
  if (history && (!scope || scope.historyOk)) {
    const got = loaded.history;
    const sessionIds = new Map(got.sessions.map((session) => [session.sessionId, session]));
    for (const session of Array.isArray(history.sessions) ? history.sessions : []) {
      if (!session || typeof session.sessionId !== 'string') continue;
      if (scope && !scope.sessionIds.has(session.sessionId)) continue;
      const kept = sessionIds.get(session.sessionId);
      if (!kept) {
        problems.push(`history.sessions: "${session.sessionId}" is gone`);
      } else if (kept.performedAt !== session.performedAt || kept.totalVolumeKg !== session.totalVolumeKg) {
        problems.push(`history.sessions: "${session.sessionId}" changed`);
      }
    }
    for (const [slot, entries] of Object.entries(history.slotHistory || {})) {
      if (scope && !scope.slots.has(slot)) continue;
      const kept = got.slotHistory[slot];
      if (!kept) {
        problems.push(`history.slotHistory: "${slot}" is gone`);
      } else if (kept.length !== entries.length) {
        problems.push(`history.slotHistory: "${slot}" ${entries.length} entries became ${kept.length}`);
      } else {
        entries.forEach((entry, index) => {
          if (kept[index].sets.length !== entry.sets.length) problems.push(`history.slotHistory: "${slot}" entry ${index} lost sets`);
        });
      }
    }
    if (typeof history.lastSelectedTemplateId === 'string' && (!scope || scope.parts.has('lastSelected')) && got.lastSelectedTemplateId !== history.lastSelectedTemplateId) {
      problems.push('history.lastSelectedTemplateId changed');
    }
  }
  return problems;
}

function rawFrom(rows, keys) {
  const key = keys.find((candidate) => rows.has(candidate));
  return key ? JSON.parse(rows.get(key)) : undefined;
}

// ---------------------------------------------------------------- 1. corpus

async function checkFixture(fixture) {
  const rows = new Map(rowsOf(fixture));
  const rawDb = rawFrom(rows, DB_KEYS);
  const rawWk = rawFrom(rows, WK_KEYS);
  assert.ok(rawDb && rawWk, `${fixture.name}: fixture has both stored keys`);

  const app = open(rows);
  const db = await app.database.loadDatabase();
  const wk = await app.workout.loadWorkoutBundle();

  const quarantined = [DB_CORRUPT, WK_CORRUPT].filter((key) => app.fake.rows.has(key));
  assert.deepEqual(quarantined, [], `${fixture.name}: readable data was set aside as corrupt`);

  const prefsRow = rows.get('@vinha/preferences/v1');
  const problems = [
    ...compareDatabase(rawDb, db),
    ...compareBundle(rawWk, wk),
    ...comparePreferences(prefsRow ? JSON.parse(prefsRow) : rawDb.preferences, db.preferences),
  ];
  assert.deepEqual(problems, [], `${fixture.name} (${fixture.subject}) lost stored data:\n  ${problems.join('\n  ')}`);

  // Counts, not just ids: nothing is merged away either.
  for (const name of Object.keys(DB_COLLECTIONS)) {
    if (Array.isArray(rawDb[name])) {
      assert.ok(db[name].length >= rawDb[name].length, `${fixture.name}: ${name} ${rawDb[name].length} -> ${db[name].length}`);
    }
  }

  // Saving what was loaded and loading it again changes nothing.
  await app.database.saveDatabase(db);
  await app.workout.saveWorkoutBundle(wk);
  const again = open([...app.fake.rows.entries()]);
  const db2 = await again.database.loadDatabase();
  const wk2 = await again.workout.loadWorkoutBundle();
  assert.deepEqual(jsonClone(db2), jsonClone(db), `${fixture.name}: database load is not idempotent`);
  assert.deepEqual(jsonClone(wk2), jsonClone(wk), `${fixture.name}: workout load is not idempotent`);
  assert.equal(again.fake.rows.has(DB_CORRUPT), false);
}

// ------------------------------------------------------------ 2. long history

function buildLongRows(newest) {
  const base = open(rowsOf(newest));
  return base.database.loadDatabase().then(async (db) => {
    const wk = await base.workout.loadWorkoutBundle();
    const sessions = [];
    const logs = [];
    for (let index = 0; index < 300; index += 1) {
      const source = db.workoutSessions[index % db.workoutSessions.length];
      const id = `session_long_${index}`;
      const performedAt = new Date(Date.UTC(2025, 0, 1 + index)).toISOString();
      sessions.push({ ...source, id, performedAt, startedAt: performedAt });
      const sourceLogs = db.exerciseLogs.filter((log) => log.sessionId === source.id);
      for (let copy = 0; copy < 2; copy += 1) {
        sourceLogs.forEach((log, logIndex) => {
          logs.push({ ...log, id: `log_long_${index}_${copy}_${logIndex}`, sessionId: id });
        });
      }
    }
    const bigDb = { ...db, workoutSessions: sessions, exerciseLogs: logs };

    const slotHistory = {};
    const templateSlots = Object.keys(wk.history.slotHistory);
    const historySessions = [];
    for (let index = 0; index < 500; index += 1) {
      const slot = `${templateSlots[index % templateSlots.length]}:${index}`;
      const entries = wk.history.slotHistory[templateSlots[index % templateSlots.length]];
      slotHistory[slot] = Array.from({ length: 10 }, (_, entry) => ({
        ...entries[0],
        slotId: slot,
        sessionId: `wk_long_${index}_${entry}`,
      }));
    }
    for (let index = 0; index < 600; index += 1) {
      historySessions.push({ ...wk.history.sessions[index % wk.history.sessions.length], sessionId: `wk_long_s_${index}` });
    }
    const bigWk = { ...wk, history: { ...wk.history, sessions: historySessions, slotHistory } };

    // Written by TODAY's writer into a storage that refuses a big row on read.
    const store = open([]);
    await store.database.saveDatabase(bigDb);
    await store.workout.saveWorkoutBundle(bigWk);
    return { bigDb, bigWk, rows: [...store.fake.rows.entries()] };
  });
}

async function checkLongHistory(newest) {
  const { bigDb, bigWk, rows } = await buildLongRows(newest);
  const keys = rows.map(([key]) => key);
  assert.ok(keys.includes('@vinha/database/v1#1'), 'the database was split across rows (past the single-row limit)');
  assert.ok(keys.includes('@vinha/workout/v1#1'), 'the workout bundle was split across rows');
  assert.ok(JSON.stringify(bigDb).length > 2 * 1024 * 1024, 'the long database is past 2 MB of text');

  const reopened = open(rows);
  const db = await reopened.database.loadDatabase();
  const wk = await reopened.workout.loadWorkoutBundle();
  assert.equal(reopened.fake.rows.has(DB_CORRUPT), false, 'a long history is not set aside as corrupt');
  assert.equal(reopened.fake.rows.has(WK_CORRUPT), false);
  assert.equal(db.workoutSessions.length, 300);
  assert.equal(db.exerciseLogs.length, bigDb.exerciseLogs.length);
  assert.deepEqual(compareDatabase(bigDb, db), []);
  assert.deepEqual(compareBundle(bigWk, wk), []);
  assert.equal(wk.history.sessions.length, 600);
  assert.equal(Object.keys(wk.history.slotHistory).length, 500);

  // load -> save -> load.
  await reopened.database.saveDatabase(db);
  await reopened.workout.saveWorkoutBundle(wk);
  const third = open([...reopened.fake.rows.entries()]);
  assert.deepEqual(jsonClone(await third.database.loadDatabase()), jsonClone(db));
  assert.deepEqual(jsonClone(await third.workout.loadWorkoutBundle()), jsonClone(wk));
  return rows;
}

// ----------------------------------------------------------------- 3. fuzz

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allPaths(node, prefix = [], out = []) {
  if (node && typeof node === 'object') {
    const keys = Array.isArray(node) ? node.map((_, index) => index) : Object.keys(node);
    for (const key of keys) {
      const next = [...prefix, key];
      out.push(next);
      allPaths(node[key], next, out);
    }
  }
  return out;
}

function at(root, pathParts) {
  return pathParts.reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), root);
}

const INF = '__INF__';
const VALUE_REPLACEMENTS = [
  ['string', 'x'],
  ['number', 42],
  ['negative', -7],
  ['zero', 0],
  ['huge', 1e308],
  ['infinity', INF],
  ['null', null],
  ['true', true],
  ['empty-array', []],
  ['empty-object', {}],
  ['mixed-array', [1, 'a', null]],
  ['nested-object', { a: { b: 1 } }],
  ['emoji', '💪🏋️‍♂️ ✓'],
  ['lone-surrogate', '\ud83d'],
  ['long-string', 'y'.repeat(20000)],
  ['unknown-enum', 'zz_unknown'],
  ['empty-string', ''],
  ['nul-char', 'a\u0000b'],
  ['bom-string', '\ufeffname'],
  ['rtl', 'abc‮def'],
  ['float-index', 1.5],
  ['date-garbage', '2026-13-45T99:99:99Z'],
];

function applyMutation(root, mutation) {
  const parentPath = mutation.path.slice(0, -1);
  const key = mutation.path[mutation.path.length - 1];
  const parent = at(root, parentPath);
  if (parent === undefined || parent === null || typeof parent !== 'object') return;
  switch (mutation.op) {
    case 'replace':
      parent[key] = jsonClone(mutation.value);
      break;
    case 'remove':
      if (Array.isArray(parent)) parent.splice(key, 1);
      else delete parent[key];
      break;
    case 'null-element':
      parent[key] = null;
      break;
    case 'dup-id': {
      const sibling = mutation.sibling;
      if (Array.isArray(parent) && parent[sibling] && typeof parent[sibling] === 'object' && parent[key] && typeof parent[key] === 'object') {
        const idKey = 'id' in parent[sibling] ? 'id' : 'sessionId' in parent[sibling] ? 'sessionId' : 'alias' in parent[sibling] ? 'alias' : null;
        if (idKey) parent[key][idKey] = parent[sibling][idKey];
      }
      break;
    }
    case 'extra-field': {
      const target = parent[key];
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        Object.defineProperty(target, mutation.name, {
          value: jsonClone(mutation.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      break;
    }
    default:
      throw new Error(`unknown op ${mutation.op}`);
  }
}

function chooseMutation(random, root) {
  const paths = allPaths(root);
  const pathParts = paths[Math.floor(random() * paths.length)];
  const target = at(root, pathParts);
  const parent = at(root, pathParts.slice(0, -1));
  const roll = random();
  if (roll < 0.5) {
    const [label, value] = VALUE_REPLACEMENTS[Math.floor(random() * VALUE_REPLACEMENTS.length)];
    return { path: pathParts, op: 'replace', label, value };
  }
  if (roll < 0.68) {
    return { path: pathParts, op: 'remove', label: 'remove' };
  }
  if (roll < 0.76 && Array.isArray(parent)) {
    return { path: pathParts, op: 'null-element', label: 'null-element' };
  }
  if (roll < 0.86 && Array.isArray(parent) && parent.length > 1) {
    const sibling = Math.floor(random() * parent.length);
    return { path: pathParts, op: 'dup-id', sibling, label: `dup-id of #${sibling}` };
  }
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const name = ['__proto__', 'constructor', 'prototype', 'toString', '__extra', 'hasOwnProperty'][Math.floor(random() * 6)];
    const value = [{ deep: [1, { x: 'y' }] }, 7, 'str', [], null][Math.floor(random() * 5)];
    return { path: pathParts, op: 'extra-field', name, value, label: `extra ${name}` };
  }
  return { path: pathParts, op: 'replace', label: 'string', value: 'x' };
}

function serialize(root) {
  return JSON.stringify(root).split(`"${INF}"`).join('1e999');
}

const TEXT_OPS = [
  ['truncate', (text, random) => text.slice(0, Math.floor(random() * text.length))],
  ['truncate-tail', (text) => text.slice(0, text.length - 1)],
  ['bom-prefix', (text) => `\ufeff${text}`],
  ['garbage-suffix', (text) => `${text}}}garbage`],
  ['nan-literal', (text) => text.replace(/:\s*(\d+)/, ':NaN')],
  ['double-write', (text) => text + text],
];

// A value that holds nothing to keep: the key is simply not there, or says null.
const EMPTY_TEXTS = ['', 'null', '[]', '0', '"x"', 'true', '{}'];

function describeCase(testCase) {
  if (testCase.text) return `${testCase.store}: text op ${testCase.text} on fixture ${testCase.fixture}`;
  if (testCase.chunk) return `${testCase.store}: chunk op ${testCase.chunk}`;
  return `${testCase.store}: ${testCase.mutations.map((m) => `${m.label} @ /${m.path.join('/')}`).join(' + ')} on fixture ${testCase.fixture}`;
}

/** Which elements/parts the mutations left alone. */
function protectedScope(store, raw, mutations) {
  // Two elements sharing an id leave one the loader may keep and the other it
  // may merge into it: neither is protected, only the survival of the id is.
  const ambiguous = new Set();
  for (const m of mutations) {
    if (m.op !== 'dup-id') continue;
    const list = at(raw, m.path.slice(0, -1));
    for (const index of [m.sibling, m.path[m.path.length - 1]]) {
      const item = Array.isArray(list) ? list[index] : null;
      for (const idKey of ['id', 'sessionId', 'alias']) {
        if (item && typeof item[idKey] === 'string') ambiguous.add(item[idKey]);
      }
    }
  }
  const hit = (pathParts) => mutations.some((m) => pathParts.every((part, index) => m.path[index] === part) || m.path.every((part, index) => pathParts[index] === part));
  if (store === 'db') {
    const ids = {};
    for (const [name, spec] of Object.entries(DB_COLLECTIONS)) {
      if (!Array.isArray(raw[name])) continue;
      ids[name] = new Set();
      raw[name].forEach((item, index) => {
        // An element is protected when no mutation touches it, or any
        // ancestor of it (the whole collection replaced).
        if (item && typeof item === 'object' && typeof item[spec.id] === 'string' && !ambiguous.has(item[spec.id]) && !hit([name, index]) && !mutations.some((m) => m.path.length === 1 && m.path[0] === name)) {
          // A duplicate-id mutation elsewhere in the array makes the id
          // ambiguous, not gone: protect it only if no mutation names it.
          ids[name].add(item[spec.id]);
        }
      });
    }
    return ids;
  }
  const parts = new Set();
  for (const part of ['activeSession', 'activeCardio', 'freestyleDraft']) {
    if (!hit([part])) parts.add(part);
  }
  if (!hit(['history', 'lastSelectedTemplateId'])) parts.add('lastSelected');
  const sessionIds = new Set();
  const slots = new Set();
  const historyTouched = hit(['history']) && mutations.some((m) => m.path.length <= 1 && m.path[0] === 'history');
  const sessionsTouched = mutations.some((m) => m.path[0] === 'history' && m.path[1] === 'sessions' && m.path.length === 2);
  const slotsTouched = mutations.some((m) => m.path[0] === 'history' && m.path[1] === 'slotHistory' && m.path.length === 2);
  if (!historyTouched && raw.history) {
    (raw.history.sessions || []).forEach((session, index) => {
      if (session && typeof session.sessionId === 'string' && !ambiguous.has(session.sessionId) && !sessionsTouched && !hit(['history', 'sessions', index])) sessionIds.add(session.sessionId);
    });
    for (const slot of Object.keys(raw.history.slotHistory || {})) {
      if (!slotsTouched && !hit(['history', 'slotHistory', slot])) slots.add(slot);
    }
  }
  return { parts, sessionIds, slots, historyOk: !historyTouched };
}

/** Runs one field-level or text-level case; returns problem strings. */
async function runFuzzCase(testCase, base) {
  const rows = new Map(rowsOf(base));
  const rowKeys = testCase.store === 'db' ? DB_KEYS : WK_KEYS;
  const corruptKey = testCase.store === 'db' ? DB_CORRUPT : WK_CORRUPT;
  const key = rowKeys.find((candidate) => rows.has(candidate));
  const original = rows.get(key);
  const raw = JSON.parse(original);
  let text;
  if (testCase.text) {
    const op = TEXT_OPS.find(([label]) => label === testCase.text)[1];
    text = op(original, mulberry32(testCase.textSeed));
  } else {
    const root = jsonClone(raw);
    testCase.mutations.forEach((mutation) => applyMutation(root, mutation));
    text = serialize(root);
  }
  rows.set(key, text);

  const app = open(rows);
  let loaded;
  try {
    loaded = testCase.store === 'db' ? await app.database.loadDatabase() : await app.workout.loadWorkoutBundle();
  } catch (error) {
    return [`load threw: ${error && error.message}`];
  }
  const problems = [];
  const store = app.fake;

  if (testCase.text) {
    let parses = true;
    try {
      JSON.parse(text);
    } catch {
      parses = false;
    }
    if (!parses) {
      // Unreadable: the bytes are set aside, whole, so a person can recover them.
      const kept = await app.large.getLargeItem(corruptKey);
      if (kept !== text) problems.push('the unreadable value was not kept under the corrupt key, byte for byte');
    }
  } else {
    const scope = protectedScope(testCase.store, raw, testCase.mutations);
    const found =
      testCase.store === 'db' ? compareDatabase(raw, loaded, scope) : compareBundle(raw, loaded, scope);
    problems.push(...found);
    if (found.length > 0 && !store.rows.has(corruptKey)) {
      problems.push('data vanished and nothing was set aside under the corrupt key');
    }
  }

  // The app has to keep opening: a second launch on whatever was written.
  try {
    const second = open([...store.rows.entries()]);
    if (testCase.store === 'db') await second.database.loadDatabase();
    else await second.workout.loadWorkoutBundle();
  } catch (error) {
    problems.push(`the next launch threw: ${error && error.message}`);
  }
  return problems;
}

function buildCases(fixtures) {
  const cases = [];
  for (let index = 0; index < FUZZ_CASES; index += 1) {
    const random = mulberry32(FUZZ_SEED + index);
    const store = random() < 0.5 ? 'db' : 'wk';
    const fixture = Math.floor(random() * fixtures.length);
    const kind = random();
    if (kind < 0.1) {
      const op = TEXT_OPS[Math.floor(random() * TEXT_OPS.length)][0];
      cases.push({ index, store, fixture, text: op, textSeed: Math.floor(random() * 1e9) });
      continue;
    }
    const rowKeys = store === 'db' ? DB_KEYS : WK_KEYS;
    const rows = fixtures[fixture].rows;
    const raw = JSON.parse(rows[rowKeys.find((candidate) => candidate in rows)]);
    const count = random() < 0.8 ? 1 : 2 + Math.floor(random() * 2);
    const mutations = [];
    for (let step = 0; step < count; step += 1) {
      mutations.push(chooseMutation(random, raw));
    }
    cases.push({ index, store, fixture, mutations });
  }
  return cases;
}

/**
 * Every distinct field path of a stored value (list positions collapsed to
 * the first, slot ids to the first slot), each hit with every value that has
 * ever been the junk of a bug here. Deterministic: no seed to be lucky with.
 */
const SWEEP_VALUES = [
  ['string', 'x'],
  ['number', 42],
  ['null', null],
  ['empty-array', []],
  ['empty-object', {}],
  ['infinity', INF],
  ['remove', undefined],
];

function sweepCases(fixtures, fixtureIndexes) {
  const cases = [];
  for (const fixture of fixtureIndexes) {
    for (const store of ['db', 'wk']) {
      const rowKeys = store === 'db' ? DB_KEYS : WK_KEYS;
      const rows = fixtures[fixture].rows;
      const raw = JSON.parse(rows[rowKeys.find((candidate) => candidate in rows)]);
      const seen = new Set();
      for (const pathParts of allPaths(raw)) {
        const shape = pathParts
          .map((part, index) => (typeof part === 'number' ? '#' : pathParts[index - 1] === 'slotHistory' ? '@slot' : part))
          .join('/');
        const collapsed = pathParts.every((part) => typeof part !== 'number' || part === 0);
        const firstSlot = pathParts.every((part, index) => pathParts[index - 1] !== 'slotHistory' || part === Object.keys(raw.history.slotHistory)[0]);
        if (seen.has(shape) || !collapsed || !firstSlot) continue;
        seen.add(shape);
        // An unknown field on an object: a key a newer or older release
        // wrote, or one that was never meant to be a key at all.
        const node = at(raw, pathParts);
        if (node && typeof node === 'object' && !Array.isArray(node)) {
          for (const name of ['__extra', '__proto__', 'constructor']) {
            cases.push({
              store,
              fixture,
              mutations: [{ path: pathParts, op: 'extra-field', name, value: { deep: [1, { x: 'y' }] }, label: `extra ${name}` }],
            });
          }
        }
        for (const [label, value] of SWEEP_VALUES) {
          cases.push({
            store,
            fixture,
            mutations: [label === 'remove' ? { path: pathParts, op: 'remove', label } : { path: pathParts, op: 'replace', label, value }],
          });
        }
      }
    }
  }
  return cases;
}

function signature(testCase, problem) {
  const shape = testCase.mutations
    ? testCase.mutations.map((m) => `${m.op}:${m.path.map((part) => (typeof part === 'number' ? '#' : part)).slice(0, 3).join('/')}`).join('+')
    : `text:${testCase.text}`;
  return `${testCase.store}|${shape}|${problem.replace(/"[^"]*"/g, '"?"').replace(/\d+/g, 'N').slice(0, 60)}`;
}

async function fuzz(fixtures) {
  const failures = [];
  for (const testCase of buildCases(fixtures)) {
    const problems = await runFuzzCase(testCase, fixtures[testCase.fixture]);
    if (problems.length > 0) {
      failures.push({ testCase, problems });
    }
  }
  return failures;
}

async function sweep(fixtures, fixtureIndexes) {
  const failures = [];
  const cases = sweepCases(fixtures, fixtureIndexes);
  for (const testCase of cases) {
    const problems = await runFuzzCase(testCase, fixtures[testCase.fixture]);
    if (problems.length > 0) failures.push({ testCase, problems });
  }
  return { failures, count: cases.length };
}

function shortest(failures) {
  const size = (failure) => {
    const { testCase } = failure;
    return testCase.mutations ? testCase.mutations.length * 1000 + JSON.stringify(testCase.mutations).length : 500;
  };
  return [...failures].sort((left, right) => size(left) - size(right))[0];
}

// ------------------------------------------------------ chunked-value faults

async function chunkFaults(rows) {
  const problems = [];
  const parts = rows.filter(([key]) => key.startsWith('@vinha/database/v1#')).map(([key]) => key);
  const faults = [
    ['delete-middle-part', (map) => map.delete('@vinha/database/v1#1')],
    ['delete-last-part', (map) => map.delete(`@vinha/database/v1#${parts.length - 1}`)],
    ['truncate-part', (map) => map.set('@vinha/database/v1#1', map.get('@vinha/database/v1#1').slice(0, 1000))],
    ['garbled-part-same-length', (map) => map.set('@vinha/database/v1#1', [...map.get('@vinha/database/v1#1')].reverse().join(''))],
    ['manifest-names-more-parts', (map) => map.set('@vinha/database/v1', map.get('@vinha/database/v1').replace(/^vinha-chunks:(\d+):/, (_, count) => `vinha-chunks:${Number(count) + 2}:`))],
  ];
  for (const [label, fault] of faults) {
    const map = new Map(rows);
    fault(map);
    const app = open([...map.entries()]);
    let loaded;
    try {
      loaded = await app.database.loadDatabase();
    } catch (error) {
      problems.push({ label, problem: `load threw: ${error.message}` });
      continue;
    }
    if (loaded.workoutSessions.length > 0) {
      problems.push({ label, problem: 'a damaged split value loaded as if whole' });
      continue;
    }
    // Opened empty: what was readable must be kept somewhere recoverable.
    const kept = await app.large.getLargeItem(DB_CORRUPT);
    if (kept === null) {
      problems.push({ label, problem: 'opened empty and kept nothing under the corrupt key' });
      continue;
    }
    // ...and a part the head still names must not be swept before it is kept.
    const survivingParts = [...map.keys()].filter((key) => key.startsWith('@vinha/database/v1#'));
    const keptSessions = (kept.match(/session_long_/g) || []).length;
    if (survivingParts.length > 0 && keptSessions === 0) {
      problems.push({ label, problem: `opened empty; ${survivingParts.length} surviving parts were swept and the corrupt copy holds none of their sessions` });
    }
  }
  // A head that is no longer a manifest, parts intact, on either key: the
  // load must keep head and parts under the corrupt key before the first save
  // sweeps them. Not only the exact prefix: the empty head reads as "nothing
  // stored" and a flipped byte as no manifest at all.
  const heads = {
    'damaged-manifest': 'vinha-chunks:3:abc',
    'empty-head': '',
    'cut-prefix': 'vinha-ch',
    'flipped-prefix-byte': 'vinha-chunkz:9:2000123',
    'manifest-plus-junk': 'vinha-chunks:9:2000123xyz',
    'manifest-plus-cr': 'vinha-chunks:9:2000123\r',
    'manifest-plus-nuls': `vinha-chunks:9:2000123${'\u0000'.repeat(80)}`,
    'bom-manifest': '\ufeffvinha-chunks:9:2000123',
    'whitespace-head': '   ',
    'garbage-head': 'not json at all',
  };
  const stores = [
    ['database', '@vinha/database/v1', DB_CORRUPT, 'session_long_', (app) => app.database.loadDatabase().then((loaded) => loaded.workoutSessions.length)],
    [
      'workout bundle',
      '@vinha/workout/v1',
      WK_CORRUPT,
      'wk_long_',
      async (app) => {
        const loaded = await app.workout.loadWorkoutBundle();
        // The provider saves what it loaded straight away.
        await app.workout.saveWorkoutBundle(loaded);
        return loaded.history.sessions.length;
      },
    ],
  ];
  for (const [store, key, corruptKey, marker, load] of stores) {
    for (const [name, head] of Object.entries(heads)) {
      const label = `${name}-${store}`;
      const map = new Map(rows);
      map.set(key, head);
      const app = open([...map.entries()]);
      let count;
      try {
        count = await load(app);
      } catch (error) {
        problems.push({ label, problem: `load threw: ${error.message}` });
        continue;
      }
      const kept = await app.large.getLargeItem(corruptKey);
      if (count > 0) {
        problems.push({ label, problem: 'a damaged head loaded as if whole' });
      } else if (kept === null || (kept.match(new RegExp(marker, 'g')) || []).length === 0) {
        problems.push({ label, problem: 'the parts were swept and the corrupt copy holds none of their sessions' });
      }
    }
    // No parts on disk: an empty head is simply nothing stored, as it was.
    const bare = open([[key, '']]);
    try {
      await load(bare);
    } catch (error) {
      problems.push({ label: `empty-head-without-parts-${store}`, problem: `load threw: ${error.message}` });
    }
  }
  return problems;
}

/**
 * A quarantine that could not be written leaves the stored rows exactly as
 * they were. The load fails (the providers retry, then show the storage error
 * screen) rather than opening on an empty value whose save would sweep the
 * only copy there is. Both keys, a small unreadable value and a split one.
 */
async function failedQuarantineKeepsRows(rows) {
  const problems = [];
  const stores = [
    ['database', '@vinha/database/v1', DB_CORRUPT, (app) => app.database.loadDatabase()],
    [
      'workout bundle',
      '@vinha/workout/v1',
      WK_CORRUPT,
      async (app) => {
        const loaded = await app.workout.loadWorkoutBundle();
        await app.workout.saveWorkoutBundle(loaded);
      },
    ],
  ];
  for (const [store, key, corruptKey, load] of stores) {
    const splitDamaged = new Map(rows);
    splitDamaged.set(key, 'vinha-chunks:3:abc');
    const small = new Map([[key, '{"workoutSessions":[{"id":']]);
    const smallSplitLess = new Map([[key, '{"history":{"sessions":[{"sessionId":']]);
    for (const [shape, map] of [
      ['split', splitDamaged],
      ['small', store === 'database' ? small : smallSplitLess],
    ]) {
      const label = `quarantine-write-fails-${shape}-${store}`;
      const app = open([...map.entries()]);
      const before = new Map(app.fake.rows);
      // A split copy is written by multiSet, a small one by setItem; refuse
      // whichever the corrupt key's write uses, and only that key's.
      app.fake.faults.multiSet = 1;
      const setItem = app.fake.setItem;
      app.fake.setItem = async (rowKey, value) => {
        if (rowKey === corruptKey) throw new Error('database or disk is full');
        return setItem.call(app.fake, rowKey, value);
      };
      let threw = false;
      try {
        await load(app);
      } catch {
        threw = true;
      }
      if (!threw) {
        problems.push({ label, problem: 'the load succeeded although the unreadable value could not be kept' });
      }
      const after = app.fake.rows;
      const changed = [...before.keys()].filter((rowKey) => after.get(rowKey) !== before.get(rowKey));
      if (changed.length > 0 || after.size !== before.size) {
        problems.push({ label, problem: `stored rows changed after a failed quarantine: ${changed.slice(0, 3).join(', ') || 'a row appeared'}` });
      }
    }
  }
  return problems;
}

/**
 * A healthy small value with stale parts beside it: the phone was killed
 * between a write that fell back under the split point and the sweep of the
 * parts the earlier, larger write left. The head is the value; the leftovers
 * are unreachable and must not make it look damaged.
 */
async function healthyHeadWithStaleParts(fixture) {
  const problems = [];
  const rows = new Map(rowsOf(fixture));
  const stale = (key) => [
    [`${key}#0`, 'stale part from an earlier, larger write'],
    [`${key}#1`, 'more of it'],
  ];
  for (const [store, keys, corruptKey] of [
    ['database', DB_KEYS, DB_CORRUPT],
    ['workout bundle', WK_KEYS, WK_CORRUPT],
  ]) {
    const key = keys.find((candidate) => rows.has(candidate));
    const raw = JSON.parse(rows.get(key));
    const app = open([...rows.entries(), ...stale(key)]);
    const loaded = store === 'database' ? await app.database.loadDatabase() : await app.workout.loadWorkoutBundle();
    const count = store === 'database' ? loaded.workoutSessions.length : loaded.history.sessions.length;
    const expected = store === 'database' ? raw.workoutSessions.length : raw.history.sessions.length;
    if (app.fake.rows.has(corruptKey) || count !== expected) {
      problems.push({
        label: `healthy-head-stale-parts-${store}`,
        problem: `a healthy value with leftover parts was ${app.fake.rows.has(corruptKey) ? 'set aside as corrupt' : 'not loaded whole'}`,
      });
    }
  }
  return problems;
}

/**
 * A split value whose middle part, once gone, leaves text that still parses.
 *
 * Three parts, cut on array element boundaries: [open, element 0] [element 1]
 * [element 2, close]. Without part 1 the rest is a valid, shorter history —
 * the case storageChunks promises can never read back as a history. Built by
 * hand so the cut is exactly where it has to be.
 */
function shortenableRows(key, open, idKey, close) {
  const element = (id, padLength) => `{"${idKey}":"${id}","pad":"${'p'.repeat(padLength)}"}`;
  const part0 = `${open}${element('s0', 256000 - open.length - element('s0', 0).length - 1)},`;
  const part1 = `${element('s1', 256000 - element('s1', 0).length - 1)},`;
  const part2 = `${element('s2', 0)}${close}`;
  assert.equal(part0.length, 256000);
  assert.equal(part1.length, 256000);
  const whole = part0 + part1 + part2;
  JSON.parse(whole);
  JSON.parse(part0 + part2);
  return {
    whole,
    rows: new Map([
      [key, `vinha-chunks:3:${whole.length}`],
      [`${key}#0`, part0],
      [`${key}#1`, part1],
      [`${key}#2`, part2],
    ]),
  };
}

async function shortenedHistoryNeverParses() {
  const problems = [];
  const cases = [
    ['database', '@vinha/database/v1', DB_CORRUPT, '{"workoutSessions":[', 'id', '],"exerciseLogs":[]}'],
    ['workout bundle', '@vinha/workout/v1', WK_CORRUPT, '{"history":{"sessions":[', 'sessionId', '],"slotHistory":{}}}'],
  ];
  for (const [label, key, corruptKey, open, idKey, close] of cases) {
    const { rows } = shortenableRows(key, open, idKey, close);
    rows.delete(`${key}#1`);
    const app = openStorage(rows);
    if (label === 'database') await app.database.loadDatabase();
    else await app.workout.loadWorkoutBundle();
    const kept = await app.large.getLargeItem(corruptKey);
    if (kept === null) {
      problems.push({ label: `shortened-${label}`, problem: 'a history missing its middle part loaded as a shorter history, nothing set aside' });
    } else if (!kept.startsWith('vinha-chunks:3:')) {
      problems.push({ label: `shortened-${label}`, problem: 'the kept copy is parseable or lost the manifest line' });
    }
  }
  return problems;
}

// -------------------------------------------------------------------- suites

function reportGaps(label, failures) {
  const unknown = [];
  const known = new Map();
  for (const failure of failures) {
    for (const problem of failure.problems) {
      const sig = signature(failure.testCase, problem);
      unknown.push({ failure, problem, sig });
    }
  }
  return { unknown, known };
}

module.exports = [
  {
    name: 'storage invariant: every release in the corpus loads, keeps what it stored, and reloads unchanged',
    async run() {
      const fixtures = loadFixtures();
      assert.ok(fixtures.length >= 10, 'the corpus spans at least ten releases');
      assert.ok(fixtures.some((f) => f.date < '2026-05-01'), 'the corpus holds the oldest release available');
      assert.ok(fixtures.some((f) => f.date >= '2026-09-28'), 'the corpus reaches the newest releases');
      assert.ok(
        fixtures.filter((fixture) => '@vinha/preferences/v1' in fixture.rows).length >= 8,
        'the releases that write the preferences key have it in the corpus',
      );
      const failures = [];
      for (const fixture of fixtures) {
        try {
          await checkFixture(fixture);
        } catch (error) {
          failures.push(error.message);
        }
      }
      assert.deepEqual(failures, [], failures.join('\n---\n'));
    },
  },
  {
    name: 'storage invariant: 300 sessions across the 1.8 MB split round-trip through the 2 MB row limit',
    async run() {
      const fixtures = loadFixtures();
      await checkLongHistory(fixtures[fixtures.length - 1]);
    },
  },
  {
    name: 'storage invariant: a missing, short or garbled part, or a damaged manifest, is kept recoverable and never loads as whole',
    async run() {
      const fixtures = loadFixtures();
      const rows = await checkLongHistory(fixtures[fixtures.length - 1]);
      const problems = [...(await chunkFaults(rows)), ...(await shortenedHistoryNeverParses()), ...(await failedQuarantineKeepsRows(rows)), ...(await healthyHeadWithStaleParts(fixtures[fixtures.length - 1]))];
      assert.deepEqual(problems, [], problems.map((entry) => `${entry.label}: ${entry.problem}`).join('\n'));
    },
  },
  {
    name: `storage invariant: ${FUZZ_CASES} seeded corruptions never throw, keep unreadable bytes, and cost only the field they hit`,
    async run() {
      const fixtures = loadFixtures();
      const failures = await fuzz(fixtures);
      const { unknown } = reportGaps('fuzz', failures);
      if (unknown.length > 0) {
        const worst = shortest(unknown.map((entry) => ({ testCase: entry.failure.testCase, problems: [entry.problem] })));
        const classes = new Map();
        for (const entry of unknown) classes.set(entry.sig, (classes.get(entry.sig) || 0) + 1);
        assert.fail(
          `${unknown.length} invariant breaks in ${FUZZ_CASES} cases (seed ${FUZZ_SEED.toString(16)}), ${classes.size} classes.\n` +
            `Shortest: ${describeCase(worst.testCase)}\n  -> ${worst.problems[0]}\n` +
            [...classes.entries()].slice(0, 12).map(([sig, n]) => `  ${n} x ${sig}`).join('\n'),
        );
      }
    },
  },
  {
    name: 'storage invariant: every field path of the newest and an older release, hit with each junk value, costs only that field',
    async run() {
      const fixtures = loadFixtures();
      const { failures, count } = await sweep(fixtures, [fixtures.length - 1, 4]);
      assert.ok(count > 1500, `the sweep covers the stored shape (${count} cases)`);
      const { unknown } = reportGaps('sweep', failures);
      if (unknown.length > 0) {
        const worst = shortest(unknown.map((entry) => ({ testCase: entry.failure.testCase, problems: [entry.problem] })));
        const classes = new Map();
        for (const entry of unknown) classes.set(entry.sig, (classes.get(entry.sig) || 0) + 1);
        assert.fail(
          [
            `${unknown.length} invariant breaks in ${count} sweep cases.`,
            `Shortest: ${describeCase(worst.testCase)}`,
            `  -> ${worst.problems[0]}`,
            ...[...classes.entries()].slice(0, 12).map(([sig, n]) => `  ${n} x ${sig}`),
          ].join('\n'),
        );
      }
    },
  },
];

module.exports.__internals = { sweep, buildCases, runFuzzCase, loadFixtures, checkLongHistory, chunkFaults, fuzz, shortest, describeCase, signature };
