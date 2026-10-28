/**
 * Whether the SQLite history mirror exists at all.
 *
 * False until the native driver ships: with it off, installSqliteHistoryMirror
 * installs nothing and the app's history mirror stays the no-op in
 * storage/historyMirror. A constant, not a setting; turning it on is a code
 * change that goes through review together with the driver.
 */
export const SQLITE_MIRROR_ENABLED = false;
