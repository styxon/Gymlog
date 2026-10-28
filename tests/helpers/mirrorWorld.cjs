const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEmptyDatabase } = require('../../src/data/seed');
const { createSqliteHistoryMirror } = require('../../src/storage/sqlite/sqliteHistoryMirror');
const { HISTORY_COLLECTIONS, HISTORY_TABLES } = require('../../src/lib/historyRowCodec');
const { createFaultWorld } = require('./faultDriver.cjs');
const { readRawMeta, readRawTables } = require('./nodeSqliteDriver.cjs');

/**
 * Plumbing for the history-mirror suites: small realistic databases, a
 * database file in a temp directory, a crash/IO-fault world around it, and a
 * way to look into the file without going through the mirror.
 */

function session(index, extra = {}) {
  return {
    id: `ws_${index}`,
    workoutTemplateId: 'workout_a',
    workoutNameSnapshot: `Workout ${index}`,
    performedAt: `2026-10-${String((index % 27) + 1).padStart(2, '0')}T08:00:00.000Z`,
    durationMinutes: 40 + index,
    setsCompleted: 3,
    totalVolumeKg: 1000 + index,
    sessionNotes: '',
    ...extra,
  };
}

function log(index, sessionIndex, extra = {}) {
  return {
    id: `el_${index}`,
    sessionId: `ws_${sessionIndex}`,
    exerciseNameSnapshot: 'Bench press',
    weight: 60,
    sets: [
      { weight: 60, reps: 8 },
      { weight: 60, reps: 7 },
    ],
    ...extra,
  };
}

function weight(index) {
  return { id: `bw_${index}`, weight: 80 + index / 10, recordedAt: `2026-09-${String((index % 27) + 1).padStart(2, '0')}T07:00:00.000Z` };
}

function measurement(index) {
  return { id: `ms_${index}`, kind: index % 2 ? 'waist' : 'chest', value: 90 + index, recordedAt: `2026-09-${String((index % 27) + 1).padStart(2, '0')}T07:30:00.000Z` };
}

function cardio(index) {
  return { id: `cd_${index}`, activityType: 'run', durationSec: 1800 + index, performedAt: `2026-08-${String((index % 27) + 1).padStart(2, '0')}T06:00:00.000Z` };
}

/** A database with `n` of each history item (newest first, as the app keeps them). */
function makeDatabase(n = 3) {
  const database = createEmptyDatabase();
  database.workoutSessions = Array.from({ length: n }, (_, i) => session(n - i));
  database.exerciseLogs = Array.from({ length: n * 2 }, (_, i) => log(i + 1, (i % n) + 1));
  database.bodyweightEntries = Array.from({ length: n }, (_, i) => weight(i + 1));
  database.measurementEntries = Array.from({ length: n }, (_, i) => measurement(i + 1));
  database.cardioSessions = Array.from({ length: n }, (_, i) => cardio(i + 1));
  return database;
}

function memoryTexts(database) {
  const out = {};
  for (const collection of HISTORY_COLLECTIONS) {
    out[collection] = (database[collection] || []).map((item) => JSON.stringify(item));
  }
  return out;
}

/** What the file holds, collection by collection, as row texts in memory order. */
function storeTexts(file) {
  const tables = readRawTables(file, HISTORY_COLLECTIONS.map((c) => HISTORY_TABLES[c].table));
  const out = {};
  for (const collection of HISTORY_COLLECTIONS) {
    out[collection] = tables[HISTORY_TABLES[collection].table].map((row) => row.json);
  }
  return out;
}

function createMemoryGuardStore() {
  const cell = { value: null };
  return {
    cell,
    async read() {
      return cell.value;
    },
    async write(value) {
      cell.value = value;
    },
  };
}

function createWorld(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vinha-mirror-'));
  const file = path.join(dir, 'history.db');
  const faults = createFaultWorld(file);
  const guard = createMemoryGuardStore();
  const state = { database: options.database || makeDatabase(3) };
  const world = {
    dir,
    file,
    faults,
    guard,
    state,
    guardState() {
      return guard.cell.value === null ? null : JSON.parse(guard.cell.value);
    },
    /** A mirror for "this launch": a fresh instance over the same file and guard row. */
    newMirror(extra = {}) {
      return createSqliteHistoryMirror({
        opener: extra.opener || faults.opener,
        guardStore: faults.guardStore(guard),
        getDatabase: () => state.database,
        yieldToUi: async () => {},
        now: () => 1_700_000_000_000,
        ...extra,
      });
    },
    meta() {
      return readRawMeta(file);
    },
    /** True when the file holds exactly `database`'s five collections, row for row. */
    matches(database = state.database) {
      const wanted = memoryTexts(database);
      const got = storeTexts(file);
      return HISTORY_COLLECTIONS.every((c) => JSON.stringify(wanted[c]) === JSON.stringify(got[c]));
    },
    cleanup() {
      try {
        faults.kill();
      } catch {
        // Already closed.
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return world;
}

/** Run `body(world)` and always clean up. */
async function withWorld(options, body) {
  const world = createWorld(options);
  try {
    return await body(world);
  } finally {
    world.cleanup();
  }
}

module.exports = {
  session,
  log,
  weight,
  measurement,
  cardio,
  makeDatabase,
  memoryTexts,
  storeTexts,
  createMemoryGuardStore,
  createWorld,
  withWorld,
};
