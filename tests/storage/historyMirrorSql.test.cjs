const assert = require('node:assert/strict');
const fs = require('node:fs');

const { accountBackupFingerprint } = require('../../src/lib/accountBackup');
const { historyContentHash, hashHistoryCollection } = require('../../src/lib/historyContentHash');
const { HISTORY_COLLECTIONS, HISTORY_TABLES } = require('../../src/lib/historyRowCodec');
const { workoutSessionRepository } = require('../../src/storage/repositories');
const seam = require('../../src/storage/historyMirror');
const { installSqliteHistoryMirror } = require('../../src/storage/sqlite/sqliteHistoryMirror');
const { SQLITE_MIRROR_ENABLED } = require('../../src/storage/sqlite/mirrorConfig');
const { MIRROR_SCHEMA_VERSION } = require('../../src/storage/sqlite/mirrorSchema');
const { openNodeSqliteDriver, readRawTables } = require('../helpers/nodeSqliteDriver.cjs');
const { makeDatabase, session, log, memoryTexts, storeTexts, withWorld, createWorld } = require('../helpers/mirrorWorld.cjs');

/**
 * The SQL side of the history mirror, against a real SQL engine (node:sqlite):
 * the schema, rebuild with its read-back, the start-up comparison, apply by
 * diff, reset and restore. Crashes and IO faults are in historyMirrorCrash and
 * historyMirrorStale.
 */

const NO_HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

async function commit(world, mirror, next) {
  const previous = world.state.database;
  world.state.database = next;
  await mirror.apply(previous, next);
}

function same(world, label) {
  assert.ok(world.matches(), `${label}: the file differs from memory`);
}

async function started(world) {
  const mirror = world.newMirror();
  const result = await mirror.start();
  return { mirror, result };
}


/** An opener over the world's file whose connections can rewrite what a query returns. `index` counts opens from 1. */
function tamperingOpener(world, rewrite) {
  let opens = 0;
  const patched = (all, index) => async (sql, params) => rewrite(index, sql, await all(sql, params));
  return {
    destroy: () => world.faults.opener.destroy(),
    async open() {
      const base = await world.faults.opener.open();
      opens += 1;
      const index = opens;
      return {
        ...base,
        all: patched(base.all, index),
        transaction: (work) => base.transaction((tx) => work({ ...tx, all: patched(tx.all, index) })),
      };
    },
  };
}

module.exports = [
  {
    name: 'historyMirror sql: the flag is off, and installing with it off leaves the no-op in place',
    run() {
      assert.equal(SQLITE_MIRROR_ENABLED, false);
      seam.setHistoryMirror(null);
      const installed = installSqliteHistoryMirror({
        opener: { open: async () => assert.fail('must not open') },
        guardStore: { read: async () => null, write: async () => {} },
        getDatabase: () => makeDatabase(1),
      });
      assert.equal(installed, null);
      assert.equal(seam.getHistoryMirror(), seam.noopHistoryMirror);
    },
  },
  {
    name: 'historyMirror sql: an enabled install replaces the no-op, and does not open anything until started',
    async run() {
      await withWorld({}, async (world) => {
        let opened = 0;
        const opener = {
          open: async () => {
            opened += 1;
            return world.faults.opener.open();
          },
        };
        const mirror = installSqliteHistoryMirror({
          enabled: true,
          opener,
          guardStore: world.faults.guardStore(world.guard),
          getDatabase: () => world.state.database,
          yieldToUi: async () => {},
        });
        try {
          assert.ok(mirror);
          assert.equal(seam.getHistoryMirror(), mirror);
          assert.equal(opened, 0);
        } finally {
          seam.setHistoryMirror(null);
        }
      });
    },
  },
  {
    name: 'historyMirror sql: the schema has no UNIQUE on id, nullable derived columns, ord and a meta table',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        await mirror.close();
        const driver = openNodeSqliteDriver(world.file);
        try {
          const version = await driver.all('PRAGMA user_version');
          assert.equal(version[0].user_version, MIRROR_SCHEMA_VERSION);
          const mode = await driver.all('PRAGMA journal_mode');
          assert.equal(mode[0].journal_mode, 'wal');
          for (const collection of HISTORY_COLLECTIONS) {
            const spec = HISTORY_TABLES[collection];
            const columns = await driver.all(`PRAGMA table_info(${spec.table})`);
            const byName = new Map(columns.map((column) => [column.name, column]));
            assert.ok(byName.get('ord'), `${spec.table}.ord`);
            assert.equal(byName.get('ord').notnull, 1);
            assert.equal(byName.get('json').notnull, 1);
            assert.equal(byName.get('row_key').pk, 1);
            for (const derived of spec.columns) {
              assert.equal(byName.get(derived).notnull, 0, `${spec.table}.${derived} must be nullable`);
              assert.equal(byName.get(derived).pk, 0, `${spec.table}.${derived} is not a key`);
            }
            const indexes = await driver.all(`PRAGMA index_list(${spec.table})`);
            assert.equal(
              indexes.filter((index) => index.unique === 1 && index.origin !== 'pk').length,
              0,
              `${spec.table} has a UNIQUE index`,
            );
          }
          const meta = await driver.all("SELECT name FROM sqlite_master WHERE name = 'meta'");
          assert.equal(meta.length, 1);
        } finally {
          await driver.close();
        }
      });
    },
  },
  {
    name: 'historyMirror sql: first start on an empty file rebuilds, verifies, and records the meta rows',
    async run() {
      await withWorld({}, async (world) => {
        const { result } = await started(world);
        assert.equal(result.status, 'rebuilt');
        assert.equal(result.reason, 'state:absent');
        same(world, 'after the first rebuild');
        const meta = world.meta();
        assert.equal(meta.state, 'verified');
        assert.equal(meta.rebuild_count, '1');
        assert.equal(meta.last_rebuild_reason, 'state:absent');
        assert.equal(meta.migrated_at, new Date(1_700_000_000_000).toISOString());
        const hash = historyContentHash(world.state.database);
        assert.equal(meta.content_hash, hash.combined);
        assert.deepEqual(JSON.parse(meta.counts), hash.counts);
        assert.equal(world.guardState().stale, false);
        assert.equal(world.guardState().attempt, 0);
      });
    },
  },
  {
    name: 'historyMirror sql: a start on a matching store changes nothing and does not rebuild',
    async run() {
      await withWorld({}, async (world) => {
        const first = await started(world);
        await first.mirror.close();
        const second = await started(world);
        assert.equal(second.result.status, 'unchanged');
        assert.equal(world.meta().rebuild_count, '1');
        // And the mirror it left behind can apply: row keys were bound to the memory objects.
        const db = world.state.database;
        await commit(world, second.mirror, workoutSessionRepository.append(db, session(99)));
        same(world, 'apply after an unchanged start');
      });
    },
  },
  {
    name: 'historyMirror sql: a new workout is a prepend, and no other row is touched',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const before = readRawTables(world.file, ['workout_sessions']).workout_sessions;
        await commit(world, mirror, workoutSessionRepository.append(world.state.database, session(50)));
        const after = readRawTables(world.file, ['workout_sessions']).workout_sessions;
        same(world, 'after the prepend');
        assert.equal(after.length, before.length + 1);
        const min = Math.min(...before.map((row) => row.ord));
        assert.equal(after[0].ord, min - 1, 'the new row takes min(ord)-1');
        for (const row of before) {
          const still = after.find((candidate) => candidate.row_key === row.row_key);
          assert.deepEqual(still, row, 'an old row moved');
        }
        // And an append at the far end takes max(ord)+1.
        const db = world.state.database;
        await commit(world, mirror, { ...db, workoutSessions: [...db.workoutSessions, session(51)] });
        same(world, 'after the append');
        const rows = readRawTables(world.file, ['workout_sessions']).workout_sessions;
        assert.equal(rows[rows.length - 1].ord, Math.max(...before.map((row) => row.ord)) + 1);
      });
    },
  },
  {
    name: 'historyMirror sql: removing a workout takes its logs with it and leaves the rest in order',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const next = workoutSessionRepository.remove(world.state.database, 'ws_2');
        assert.ok(next.exerciseLogs.length < world.state.database.exerciseLogs.length);
        await commit(world, mirror, next);
        same(world, 'after the delete');
      });
    },
  },
  {
    name: 'historyMirror sql: an edited workout (a new object with the same id) replaces its row in place of order',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const next = workoutSessionRepository.update(world.state.database, 'ws_2', { sessionNotes: 'felt strong' });
        await commit(world, mirror, next);
        same(world, 'after the edit');
        const rows = storeTexts(world.file).workoutSessions.map((text) => JSON.parse(text));
        assert.deepEqual(
          rows.map((row) => row.id),
          next.workoutSessions.map((item) => item.id),
          'an edit must keep the row where it was',
        );
        assert.equal(rows.find((row) => row.id === 'ws_2').sessionNotes, 'felt strong');
      });
    },
  },
  {
    name: 'historyMirror sql: a new item among kept ones, and a sort, renumber the table',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const db = world.state.database;
        const middle = [...db.measurementEntries];
        middle.splice(1, 0, { id: 'ms_new', kind: 'hips', value: 99, recordedAt: '2026-09-30T00:00:00.000Z' });
        await commit(world, mirror, { ...db, measurementEntries: middle });
        same(world, 'after the insert between kept rows');
        const sorted = [...world.state.database.measurementEntries].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
        await commit(world, mirror, { ...world.state.database, measurementEntries: sorted });
        same(world, 'after a sort');
        const reversed = [...sorted].reverse();
        await commit(world, mirror, { ...world.state.database, measurementEntries: reversed });
        same(world, 'after a reverse');
      });
    },
  },
  {
    name: 'historyMirror sql: duplicate ids are kept as they are, in a rebuild and through later changes',
    async run() {
      const database = makeDatabase(3);
      // Two different sessions with one id, and one object present twice in a list.
      database.workoutSessions = [...database.workoutSessions, { ...database.workoutSessions[0], sessionNotes: 'second with the same id' }];
      const shared = database.bodyweightEntries[0];
      database.bodyweightEntries = [shared, ...database.bodyweightEntries];
      await withWorld({ database }, async (world) => {
        const { mirror, result } = await started(world);
        assert.equal(result.status, 'rebuilt');
        same(world, 'with duplicate ids');
        assert.equal(storeTexts(world.file).workoutSessions.length, 4);
        assert.equal(storeTexts(world.file).bodyweightEntries.length, 4);

        const db = world.state.database;
        await commit(world, mirror, workoutSessionRepository.append(db, { ...db.workoutSessions[0] }));
        same(world, 'a third copy of the same id');
        await commit(world, mirror, { ...world.state.database, bodyweightEntries: world.state.database.bodyweightEntries.slice(1) });
        same(world, 'after the shared object lost one of its places');
      });
    },
  },
  {
    name: 'historyMirror sql: a commit that changes nothing in the history writes nothing',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const stepsBefore = world.faults.steps;
        await commit(world, mirror, { ...world.state.database, preferences: { ...world.state.database.preferences, darkThemeEnabled: false } });
        assert.equal(world.faults.steps, stepsBefore, 'no SQL for a preference change');
      });
    },
  },
  {
    name: 'historyMirror sql: restore swaps the whole database (replaceAll), and so does its rollback',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const original = world.state.database;
        const restored = makeDatabase(5);
        restored.workoutSessions = restored.workoutSessions.map((item, index) => ({ ...item, workoutNameSnapshot: `restored ${index}` }));
        world.state.database = restored;
        await mirror.replaceAll(restored);
        same(world, 'after the restore');
        assert.equal(world.meta().state, 'verified');
        assert.equal(world.meta().last_rebuild_reason, 'replaceAll');
        // The rollback puts the earlier database back.
        world.state.database = original;
        await mirror.replaceAll(original);
        same(world, 'after the rollback');
        // And the mirror still applies after both.
        await commit(world, mirror, workoutSessionRepository.append(original, session(77)));
        same(world, 'apply after replaceAll');
      });
    },
  },
  {
    name: 'historyMirror sql: reset empties the tables, and the mirror then follows the new database',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        await mirror.clear();
        const empty = storeTexts(world.file);
        for (const collection of HISTORY_COLLECTIONS) {
          assert.deepEqual(empty[collection], [], `${collection} after clear`);
        }
        assert.equal(world.meta().state, 'verified');
        // The reset database is empty; new history after it is mirrored from nothing.
        world.state.database = makeDatabase(0);
        await commit(world, mirror, workoutSessionRepository.append(world.state.database, session(1)));
        same(world, 'first workout after a reset');
        // A fresh launch agrees.
        await mirror.close();
        const next = await started(world);
        assert.equal(next.result.status, 'unchanged');
      });
    },
  },
  {
    name: 'historyMirror sql: clear before a start (nothing open) removes the file',
    async run() {
      await withWorld({}, async (world) => {
        const first = await started(world);
        await first.mirror.close();
        assert.ok(fs.existsSync(world.file));
        const cold = world.newMirror();
        await cold.clear();
        assert.equal(fs.existsSync(world.file), false);
      });
    },
  },
  {
    name: 'historyMirror sql: after a delete and after a clear the text is gone from the file and its log',
    async run() {
      const secret = 'SECRET-NOTE-9f3a-do-not-keep';
      const database = makeDatabase(3);
      database.workoutSessions = database.workoutSessions.map((item) => (item.id === 'ws_2' ? { ...item, sessionNotes: secret } : item));
      await withWorld({ database }, async (world) => {
        const { mirror } = await started(world);
        const onDisk = () =>
          ['', '-wal'].map((suffix) => (fs.existsSync(world.file + suffix) ? fs.readFileSync(world.file + suffix).toString('latin1') : ''));
        assert.ok(onDisk().some((text) => text.includes(secret)), 'the note must be there to begin with');
        await commit(world, mirror, workoutSessionRepository.remove(world.state.database, 'ws_2'));
        assert.ok(onDisk().every((text) => !text.includes(secret)), 'a deleted workout lingers in the file or its log');

        const second = { ...world.state.database };
        second.workoutSessions = [{ ...second.workoutSessions[0], sessionNotes: secret }, ...second.workoutSessions.slice(1)];
        await commit(world, mirror, second);
        assert.ok(onDisk().some((text) => text.includes(secret)));
        await mirror.clear();
        assert.ok(onDisk().every((text) => !text.includes(secret)), 'a cleared mirror lingers in the file or its log');
      });
    },
  },
  {
    name: 'historyMirror sql: start finds an edit that accountBackupFingerprint cannot see, and rebuilds',
    async run() {
      await withWorld({}, async (world) => {
        const first = await started(world);
        await first.mirror.close();
        // A log's exercise name is not in the fingerprint (id|setCount|volume only).
        const db = world.state.database;
        const edited = { ...db, exerciseLogs: db.exerciseLogs.map((item, index) => (index === 0 ? { ...item, exerciseNameSnapshot: 'Bench press (pause)' } : item)) };
        assert.equal(accountBackupFingerprint(edited, NO_HISTORY), accountBackupFingerprint(db, NO_HISTORY), 'the premise: the fingerprint is blind to this edit');
        assert.notEqual(historyContentHash(edited).combined, historyContentHash(db).combined, 'the content hash is not');
        world.state.database = edited;
        const second = await started(world);
        assert.equal(second.result.status, 'rebuilt');
        assert.equal(second.result.reason, 'content');
        same(world, 'after the rebuild');
        assert.equal(world.meta().rebuild_count, '2');
      });
    },
  },
  {
    name: 'historyMirror sql: start notices a row changed in the file behind the mirror, a missing row and an extra row',
    async run() {
      for (const tamper of [
        (driver) => driver.raw.exec("UPDATE exercise_logs SET json = replace(json, 'Bench press', 'Squat') WHERE row_key = 1"),
        (driver) => driver.raw.exec('DELETE FROM bodyweight_entries WHERE row_key = 1'),
        (driver) => driver.raw.exec("INSERT INTO cardio_sessions(ord, id, date, json) VALUES (99, 'x', NULL, '{}')"),
        (driver) => driver.raw.exec("UPDATE workout_sessions SET json = 'not json' WHERE row_key = 1"),
      ]) {
        await withWorld({}, async (world) => {
          const first = await started(world);
          await first.mirror.close();
          const driver = openNodeSqliteDriver(world.file);
          tamper(driver);
          await driver.close();
          const second = await started(world);
          assert.equal(second.result.status, 'rebuilt');
          same(world, 'after the rebuild');
        });
      }
    },
  },
  {
    name: 'historyMirror sql: a file that is not a database is removed and made again',
    async run() {
      await withWorld({}, async (world) => {
        fs.writeFileSync(world.file, 'this is not a sqlite database, it is text '.repeat(40));
        const { result } = await started(world);
        assert.equal(result.status, 'rebuilt');
        same(world, 'after the file was replaced');
      });
    },
  },
  {
    name: 'historyMirror sql: a database of another schema version is dropped and made again',
    async run() {
      await withWorld({}, async (world) => {
        const first = await started(world);
        await first.mirror.close();
        const driver = openNodeSqliteDriver(world.file);
        driver.raw.exec('PRAGMA user_version = 7');
        await driver.close();
        const second = await started(world);
        assert.equal(second.result.status, 'rebuilt');
        same(world, 'after the version change');
        const check = openNodeSqliteDriver(world.file);
        try {
          assert.equal((await check.all('PRAGMA user_version'))[0].user_version, MIRROR_SCHEMA_VERSION);
        } finally {
          await check.close();
        }
      });
    },
  },
  {
    name: 'historyMirror sql: the store-side digest equals the memory-side digest of the same rows',
    async run() {
      await withWorld({}, async (world) => {
        await started(world);
        const texts = storeTexts(world.file);
        const { hashHistoryRowTexts } = require('../../src/lib/historyContentHash');
        for (const collection of HISTORY_COLLECTIONS) {
          assert.deepEqual(hashHistoryRowTexts(texts[collection]), hashHistoryCollection(world.state.database[collection]));
        }
      });
    },
  },
  {
    name: 'historyMirror sql: random edit sequences applied by diff equal a full rebuild every time',
    async run() {
      // A small seeded generator; every step is one of the real kinds of change.
      let seed = 0x2f6e2b1;
      const rand = (n) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % n;
      };
      await withWorld({ database: makeDatabase(4) }, async (world) => {
        const { mirror } = await started(world);
        let counter = 1000;
        for (let step = 0; step < 120; step += 1) {
          const db = world.state.database;
          const kind = rand(8);
          const sessions = db.workoutSessions;
          let next = db;
          if (kind === 0) {
            next = workoutSessionRepository.append(db, session(counter++));
          } else if (kind === 1 && sessions.length) {
            next = workoutSessionRepository.remove(db, sessions[rand(sessions.length)].id);
          } else if (kind === 2 && sessions.length) {
            next = workoutSessionRepository.update(db, sessions[rand(sessions.length)].id, { sessionNotes: `n${step}` });
          } else if (kind === 3) {
            next = { ...db, bodyweightEntries: [...db.bodyweightEntries, { id: `bw_${counter++}`, weight: 70, recordedAt: '2026-10-01' }] };
          } else if (kind === 4 && db.measurementEntries.length > 1) {
            const copy = [...db.measurementEntries];
            const [moved] = copy.splice(rand(copy.length), 1);
            copy.splice(rand(copy.length + 1), 0, moved);
            next = { ...db, measurementEntries: copy };
          } else if (kind === 5) {
            next = { ...db, exerciseLogs: [log(counter++, 1), ...db.exerciseLogs] };
          } else if (kind === 6 && db.cardioSessions.length) {
            next = { ...db, cardioSessions: db.cardioSessions.filter((_, i) => i !== rand(db.cardioSessions.length)) };
          } else if (kind === 7) {
            next = { ...db, workoutSessions: [...db.workoutSessions].reverse() };
          }
          await commit(world, mirror, next);
          same(world, `step ${step} (kind ${kind})`);
        }
        // A fresh launch finds the diff-built store identical to memory.
        await mirror.close();
        const again = await started(world);
        assert.equal(again.result.status, 'unchanged');
      });
    },
  },
  {
    name: 'historyMirror sql: several new items at the head of a table in one commit keep memory order (a workout save prepends its logs)',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const db = world.state.database;
        const fresh = [log(100, 1), log(101, 1), log(102, 2)];
        await commit(world, mirror, { ...db, exerciseLogs: [...fresh, ...db.exerciseLogs] });
        same(world, 'three logs prepended at once');
        assert.deepEqual(
          storeTexts(world.file).exerciseLogs.slice(0, 3).map((text) => JSON.parse(text).id),
          ['el_100', 'el_101', 'el_102'],
        );
        // And again on top of the first three, with sessions saved in the same commit.
        const db2 = world.state.database;
        await commit(world, mirror, {
          ...db2,
          workoutSessions: [session(60), session(61), ...db2.workoutSessions],
          exerciseLogs: [log(110, 1), log(111, 1), ...db2.exerciseLogs],
        });
        same(world, 'a second multi-item prepend');
      });
    },
  },
  {
    name: 'historyMirror sql: several new items at the tail, and head and tail together with a removal, keep memory order',
    async run() {
      await withWorld({}, async (world) => {
        const { mirror } = await started(world);
        const db = world.state.database;
        await commit(world, mirror, { ...db, exerciseLogs: [...db.exerciseLogs, log(200, 1), log(201, 1), log(202, 2)] });
        same(world, 'three logs appended at once');
        const db2 = world.state.database;
        const kept = db2.exerciseLogs.slice(1, -1);
        await commit(world, mirror, {
          ...db2,
          exerciseLogs: [log(210, 1), log(211, 1), log(212, 1), ...kept, log(213, 1), log(214, 1)],
        });
        same(world, 'head, tail and a removal in one commit');
      });
    },
  },
  {
    name: 'historyMirror sql: several new items into an empty table keep memory order',
    async run() {
      await withWorld({ database: makeDatabase(0) }, async (world) => {
        const { mirror } = await started(world);
        assert.equal(storeTexts(world.file).exerciseLogs.length, 0);
        // Nothing is kept, so the diff is a renumber rather than edges; the order is the same either way.
        await commit(world, mirror, { ...world.state.database, exerciseLogs: [log(1, 1), log(2, 1), log(3, 1)] });
        same(world, 'three logs into an empty table');
        const db = world.state.database;
        await commit(world, mirror, { ...db, exerciseLogs: [log(4, 1), log(5, 1), ...db.exerciseLogs, log(6, 1)] });
        same(world, 'then more on both ends');
      });
    },
  },
  {
    name: 'historyMirror sql: a rebuild fails when the rows read back as equal text but decode to something the backup fingerprint tells apart',
    async run() {
      const database = makeDatabase(3);
      // JSON writes NaN as null, so the stored text equals JSON.stringify(memory), yet `${NaN}` is not `${null}`.
      database.workoutSessions = database.workoutSessions.map((item, index) => (index === 0 ? { ...item, totalVolumeKg: NaN } : item));
      const item = database.workoutSessions[0];
      const roundTripped = JSON.parse(JSON.stringify(item));
      assert.equal(JSON.stringify(roundTripped), JSON.stringify(item), 'the premise: the row text is the same');
      assert.notEqual(
        accountBackupFingerprint(database, NO_HISTORY),
        accountBackupFingerprint({ ...database, workoutSessions: [roundTripped, ...database.workoutSessions.slice(1)] }, NO_HISTORY),
        'the premise: the fingerprint tells them apart',
      );
      await withWorld({ database }, async (world) => {
        const { result } = await started(world);
        assert.equal(result.status, 'failed');
        assert.notEqual(world.meta().state, 'verified');
      });
    },
  },
  {
    name: 'historyMirror sql: a rebuild fails when a history item is not an object (its row cannot decode), and is never marked verified',
    async run() {
      const database = makeDatabase(3);
      database.bodyweightEntries = [...database.bodyweightEntries, 'not an object'];
      await withWorld({ database }, async (world) => {
        const { result } = await started(world);
        assert.equal(result.status, 'failed');
        assert.notEqual(world.meta().state, 'verified');
      });
    },
  },
  {
    name: 'historyMirror sql: the read-back compares the row text by itself (a change neither the fingerprint nor the counts can see is found)',
    async run() {
      await withWorld({}, async (world) => {
        // The second connection of a start is the verifier; it reads one field differently from what was written.
        const opener = tamperingOpener(world, (index, sql, rows) =>
          index === 2 && sql.startsWith('SELECT json')
            ? rows.map((row) => ({ ...row, json: typeof row.json === 'string' ? row.json.replace('Bench press', 'Squat') : row.json }))
            : rows,
        );
        const mirror = world.newMirror({ opener });
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.notEqual(world.meta().state, 'verified');
      });
    },
  },
  {
    name: 'historyMirror sql: the read-back fails when the store holds a different number of rows than memory',
    async run() {
      await withWorld({}, async (world) => {
        const opener = tamperingOpener(world, (index, sql, rows) =>
          index === 2 && sql.includes('COUNT(*)') ? rows.map((row) => ({ ...row, n: Number(row.n) + 1 })) : rows,
        );
        const mirror = world.newMirror({ opener });
        const result = await mirror.start();
        assert.equal(result.status, 'failed');
        assert.notEqual(world.meta().state, 'verified');
      });
    },
  },
  {
    name: 'historyMirror sql: a table made again for a repeated object that ends up with the wrong number of rows rolls back and marks the mirror stale',
    async run() {
      await withWorld({}, async (world) => {
        let lie = false;
        const opener = tamperingOpener(world, (index, sql, rows) =>
          lie && index === 1 && sql.startsWith('SELECT row_key') ? [...rows, { row_key: 987654 }] : rows,
        );
        const mirror = world.newMirror({ opener });
        const { status } = await mirror.start();
        assert.equal(status, 'rebuilt');
        const previous = world.state.database;
        const shared = previous.bodyweightEntries[0];
        lie = true;
        await commit(world, mirror, { ...previous, bodyweightEntries: [shared, shared, ...previous.bodyweightEntries.slice(1)] });
        lie = false;
        assert.equal(world.guardState().stale, true, 'the mirror must know it is behind');
        assert.ok(world.matches(previous), 'the transaction must have been rolled back');
      });
    },
  },
  {
    name: 'historyMirror sql: createWorld cleans up its directory',
    run() {
      const world = createWorld();
      const dir = world.dir;
      assert.ok(fs.existsSync(dir));
      world.cleanup();
      assert.equal(fs.existsSync(dir), false);
    },
  },
];
