const fs = require('node:fs');

/**
 * A SqlDriver (src/storage/sqlite/sqlDriver.ts) over Node's own node:sqlite.
 *
 * The SQL runs in a real engine, so a wrong statement, a missing column or a
 * constraint the schema forgot fails here the way it would on the phone. Node
 * 24 ships node:sqlite; there is nothing to install or compile.
 *
 * node:sqlite still prints an ExperimentalWarning on first use on some 24.x
 * builds. It is dropped here (only that one) so the test log stays readable.
 */
let DatabaseSync = null;

function loadDatabaseSync() {
  if (!DatabaseSync) {
    const emit = process.emitWarning;
    process.emitWarning = function filtered(warning, ...rest) {
      const text = typeof warning === 'string' ? warning : warning && warning.message;
      if (typeof text === 'string' && text.includes('SQLite')) {
        return;
      }
      return emit.call(process, warning, ...rest);
    };
    try {
      DatabaseSync = require('node:sqlite').DatabaseSync;
    } finally {
      process.emitWarning = emit;
    }
  }
  return DatabaseSync;
}

function executorOn(db) {
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params).map((row) => ({ ...row }));
    },
  };
}

function openNodeSqliteDriver(file) {
  const Database = loadDatabaseSync();
  const db = new Database(file);
  const base = executorOn(db);
  return {
    raw: db,
    ...base,
    async transaction(work) {
      db.exec('BEGIN IMMEDIATE');
      let result;
      try {
        result = await work(base);
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // The connection may already be closed (a simulated kill).
        }
        throw error;
      }
      db.exec('COMMIT');
      return result;
    },
    async close() {
      if (db.isOpen) {
        db.close();
      }
    },
  };
}

/** An opener for one database file. destroy() removes the file and its WAL/SHM. */
function nodeSqliteOpener(file) {
  return {
    file,
    async open() {
      return openNodeSqliteDriver(file);
    },
    async destroy() {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        fs.rmSync(file + suffix, { force: true });
      }
    },
  };
}

/** A plain read-only look at the file, outside any mirror: { table: [rows] }. */
function readRawTables(file, tables) {
  const Database = loadDatabaseSync();
  const db = new Database(file, { readOnly: true });
  try {
    const out = {};
    for (const table of tables) {
      out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ord, row_key`).all().map((row) => ({ ...row }));
    }
    return out;
  } finally {
    db.close();
  }
}

function readRawMeta(file) {
  const Database = loadDatabaseSync();
  const db = new Database(file, { readOnly: true });
  try {
    const meta = {};
    for (const row of db.prepare('SELECT key, value FROM meta').all()) {
      meta[row.key] = row.value;
    }
    return meta;
  } catch {
    return {};
  } finally {
    db.close();
  }
}

module.exports = { openNodeSqliteDriver, nodeSqliteOpener, readRawTables, readRawMeta };
