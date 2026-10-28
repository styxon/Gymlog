import { HISTORY_COLLECTIONS, HISTORY_TABLES } from '../../lib/historyRowCodec';
import type { SqlDriver, SqlExecutor } from './sqlDriver';

/**
 * The mirror's schema. The mirror is a row container, not a second truth about
 * fields: every row is the item's normalized JSON text, plus a few derived
 * columns that only find it.
 *
 * - No UNIQUE and no PRIMARY KEY on `id`: duplicate ids are kept as they are
 *   (normalizeDatabase does not prune them, and an old install may hold some).
 * - The derived columns are nullable text.
 * - `ord` is the position in memory. A prepend takes min(ord)-1, an append
 *   max(ord)+1, so a new workout moves no other row; it may be negative.
 * - No foreign keys: a log points at its session by `sessionId` only, as in
 *   memory, and the cascade stays in the repositories.
 */
export const MIRROR_SCHEMA_VERSION = 1;

/** Applied on every connection. WAL and FULL sync: the UI says "saved" only after a write is on disk. */
export const MIRROR_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = FULL',
  'PRAGMA secure_delete = ON',
] as const;

export const MIRROR_META_TABLE = 'meta';

export function mirrorSchemaStatements(): string[] {
  const statements = [`CREATE TABLE IF NOT EXISTS ${MIRROR_META_TABLE}(key TEXT PRIMARY KEY, value TEXT NOT NULL)`];
  for (const collection of HISTORY_COLLECTIONS) {
    const spec = HISTORY_TABLES[collection];
    const derived = spec.columns.map((column) => `${column} TEXT`).join(', ');
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${spec.table}(row_key INTEGER PRIMARY KEY AUTOINCREMENT, ord INTEGER NOT NULL, ${derived}, json TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS ${spec.table}_ord ON ${spec.table}(ord)`,
    );
  }
  statements.push('CREATE INDEX IF NOT EXISTS exercise_logs_session ON exercise_logs(session_id)');
  return statements;
}

function mirrorDropStatements(): string[] {
  const statements = HISTORY_COLLECTIONS.map((collection) => `DROP TABLE IF EXISTS ${HISTORY_TABLES[collection].table}`);
  statements.push(`DROP TABLE IF EXISTS ${MIRROR_META_TABLE}`);
  return statements;
}

/**
 * Settings, then the tables. A database of another schema version is dropped
 * and made again: the mirror is disposable, the blob is the truth.
 */
export async function ensureMirrorSchema(driver: SqlDriver): Promise<void> {
  for (const pragma of MIRROR_PRAGMAS) {
    // journal_mode answers with a row, so the pragmas go through `all`.
    await driver.all(pragma);
  }
  const versionRows = await driver.all<{ user_version: number }>('PRAGMA user_version');
  const version = Number(versionRows[0]?.user_version ?? 0);
  await driver.transaction(async (tx) => {
    if (version !== 0 && version !== MIRROR_SCHEMA_VERSION) {
      for (const statement of mirrorDropStatements()) {
        await tx.exec(statement);
      }
    }
    // CREATE ... IF NOT EXISTS, so a first setup that was interrupted is finished here.
    for (const statement of mirrorSchemaStatements()) {
      await tx.exec(statement);
    }
    if (version !== MIRROR_SCHEMA_VERSION) {
      await tx.exec(`PRAGMA user_version = ${MIRROR_SCHEMA_VERSION}`);
    }
  });
}

export async function readMirrorMeta(executor: SqlExecutor): Promise<Record<string, string>> {
  const rows = await executor.all<{ key: string; value: string }>(`SELECT key, value FROM ${MIRROR_META_TABLE}`);
  const meta: Record<string, string> = {};
  for (const row of rows) {
    if (typeof row.key === 'string' && typeof row.value === 'string') {
      meta[row.key] = row.value;
    }
  }
  return meta;
}

export async function writeMirrorMeta(executor: SqlExecutor, values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await executor.run(`INSERT OR REPLACE INTO ${MIRROR_META_TABLE}(key, value) VALUES (?, ?)`, [key, value]);
  }
}
