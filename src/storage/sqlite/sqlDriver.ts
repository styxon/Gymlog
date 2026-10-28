/**
 * The narrow door to a SQL engine.
 *
 * Everything the mirror needs from SQLite fits in five calls, so the engine
 * behind them can be expo-sqlite on a phone or Node's own node:sqlite in the
 * tests (tests/helpers/nodeSqliteDriver.cjs), with the real SQL running in
 * both. Only the driver for the phone may import expo-sqlite, and only inside
 * a function, never at the top of a module.
 *
 * All calls are async because the phone's API is. A driver runs one statement
 * at a time; the mirror's own queue sees to the order.
 */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlExecutor {
  /** Statements that return nothing (DDL, PRAGMA assignments). */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  all<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

export interface SqlDriver extends SqlExecutor {
  /**
   * One transaction: commits when `work` resolves, rolls back when it rejects
   * (and rethrows). `work` gets an executor on the same connection.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SqlOpener {
  /** A new connection to the mirror's database file. Verification opens a second one. */
  open(): Promise<SqlDriver>;
  /** Delete the database file (and its journal). A broken or reset mirror is removed, never kept aside. */
  destroy?(): Promise<void>;
}
