/**
 * What a stored history looks like from the outside: counts, duplicate ids,
 * rows missing the fields a SQLite mirror would index, and the order the rows
 * are kept in. SQLite plan, PR 0 (docs/sqlite-measurements.md).
 *
 * Pure, and the result holds numbers and fixed labels only, never a row, an id
 * or a note: the owner's own export can be scanned and the output pasted
 * anywhere. scripts/scan-history-ids.cjs is the thin wrapper that reads the file.
 */

export type HistoryOrder = 'newest-first' | 'oldest-first' | 'mixed' | 'flat' | 'n/a';

export interface HistoryCollectionScan {
  name: string;
  /** False when the key is absent or not an array; the other numbers are then 0. */
  present: boolean;
  count: number;
  /** Entries that are not objects at all. */
  notObjects: number;
  /** Distinct ids that appear on more than one row. */
  duplicateIds: number;
  /** Rows beyond the first for every duplicated id (what a UNIQUE index would reject). */
  duplicateExtraRows: number;
  missingId: number;
  /** Rows with no usable date. Not applicable to exerciseLogs, which are keyed by sessionId. */
  missingDate: number | null;
  /** exerciseLogs only: rows with no sessionId. */
  missingSessionId: number | null;
  /** exerciseLogs only: rows whose sessionId matches no workoutSessions id. */
  orphanedSessionId: number | null;
  order: HistoryOrder;
  /** Consecutive dated pairs going later / earlier, the evidence for `order`. */
  pairsAscending: number;
  pairsDescending: number;
}

export interface HistoryScan {
  /** 'appDatabase' (the blob), 'accountBackup' (the cloud/export payload) or 'unknown'. */
  format: 'appDatabase' | 'accountBackup' | 'unknown';
  collections: HistoryCollectionScan[];
}

interface CollectionSpec {
  name: string;
  /** The field that dates a row; null when rows have none. */
  dateField: string | null;
  idField: string;
}

const SPECS: CollectionSpec[] = [
  { name: 'workoutSessions', dateField: 'performedAt', idField: 'id' },
  { name: 'exerciseLogs', dateField: null, idField: 'id' },
  { name: 'bodyweightEntries', dateField: 'recordedAt', idField: 'id' },
  { name: 'measurementEntries', dateField: 'recordedAt', idField: 'id' },
  { name: 'cardioSessions', dateField: 'performedAt', idField: 'id' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function scanCollection(
  spec: CollectionSpec,
  rows: unknown,
  sessionIds: Set<string> | null,
  keyField: string = spec.idField,
): HistoryCollectionScan {
  const isLogs = spec.name === 'exerciseLogs';
  const scan: HistoryCollectionScan = {
    name: spec.name,
    present: Array.isArray(rows),
    count: 0,
    notObjects: 0,
    duplicateIds: 0,
    duplicateExtraRows: 0,
    missingId: 0,
    missingDate: spec.dateField ? 0 : null,
    missingSessionId: isLogs ? 0 : null,
    orphanedSessionId: isLogs ? 0 : null,
    order: 'n/a',
    pairsAscending: 0,
    pairsDescending: 0,
  };
  if (!Array.isArray(rows)) {
    return scan;
  }
  scan.count = rows.length;

  const seen = new Map<string, number>();
  let previous: number | null = null;
  for (const row of rows) {
    if (!isRecord(row)) {
      scan.notObjects += 1;
      continue;
    }
    const id = row[keyField];
    if (hasText(id)) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    } else {
      scan.missingId += 1;
    }
    if (spec.dateField) {
      const ms = dateMs(row[spec.dateField]);
      if (ms === null) {
        scan.missingDate = (scan.missingDate ?? 0) + 1;
      } else {
        if (previous !== null) {
          if (ms > previous) {
            scan.pairsAscending += 1;
          } else if (ms < previous) {
            scan.pairsDescending += 1;
          }
        }
        previous = ms;
      }
    }
    if (isLogs) {
      const sessionId = row.sessionId;
      if (!hasText(sessionId)) {
        scan.missingSessionId = (scan.missingSessionId ?? 0) + 1;
      } else if (sessionIds && !sessionIds.has(sessionId)) {
        scan.orphanedSessionId = (scan.orphanedSessionId ?? 0) + 1;
      }
    }
  }

  for (const times of seen.values()) {
    if (times > 1) {
      scan.duplicateIds += 1;
      scan.duplicateExtraRows += times - 1;
    }
  }

  if (spec.dateField) {
    const { pairsAscending: up, pairsDescending: down } = scan;
    const dated = scan.count - scan.notObjects - (scan.missingDate ?? 0);
    if (up === 0 && down === 0) {
      scan.order = dated < 2 ? 'n/a' : 'flat';
    } else if (up === 0) {
      scan.order = 'newest-first';
    } else if (down === 0) {
      scan.order = 'oldest-first';
    } else {
      scan.order = 'mixed';
    }
  }
  return scan;
}

/**
 * The payload as the app's backup holds it: `database` and `workoutHistory`
 * next to a version. A bare AppDatabase has the collections at the top.
 */
function resolveDatabase(input: unknown): { format: HistoryScan['format']; database: Record<string, unknown> | null; history: unknown } {
  if (!isRecord(input)) {
    return { format: 'unknown', database: null, history: null };
  }
  if (isRecord(input.database) && 'workoutHistory' in input) {
    return { format: 'accountBackup', database: input.database, history: input.workoutHistory };
  }
  if (SPECS.some((spec) => spec.name in input)) {
    return { format: 'appDatabase', database: input, history: null };
  }
  return { format: 'unknown', database: null, history: null };
}

/** Scan an already-decoded export (a bare AppDatabase or an account backup payload). */
export function scanHistoryIds(input: unknown): HistoryScan {
  const { format, database, history } = resolveDatabase(input);
  if (!database) {
    return { format, collections: [] };
  }

  const sessions = database.workoutSessions;
  const sessionIds = Array.isArray(sessions)
    ? new Set(sessions.filter(isRecord).map((row) => row.id).filter(hasText))
    : null;

  const collections = SPECS.map((spec) => scanCollection(spec, database[spec.name], sessionIds));

  // The backup also carries the slot-history side of the same sessions; the
  // sessions list there is keyed by sessionId and dated by performedAt.
  if (format === 'accountBackup' && isRecord(history)) {
    collections.push(
      scanCollection({ name: 'workoutHistory.sessions', dateField: 'performedAt', idField: 'sessionId' }, history.sessions, null, 'sessionId'),
    );
  }
  return { format, collections };
}

/** The scan as lines of text; counts and labels only. */
export function formatHistoryScan(scan: HistoryScan): string {
  if (scan.collections.length === 0) {
    return 'No history collections found in this file (not an AppDatabase or an account backup payload).';
  }
  const lines = [`format: ${scan.format}`];
  for (const c of scan.collections) {
    if (!c.present) {
      lines.push(`${c.name}: absent`);
      continue;
    }
    const parts = [
      `count ${c.count}`,
      `duplicate ids ${c.duplicateIds} (${c.duplicateExtraRows} extra rows)`,
      `missing id ${c.missingId}`,
    ];
    if (c.missingDate !== null) {
      parts.push(`missing date ${c.missingDate}`);
    }
    if (c.missingSessionId !== null) {
      parts.push(`missing sessionId ${c.missingSessionId}`, `orphaned sessionId ${c.orphanedSessionId}`);
    }
    if (c.notObjects > 0) {
      parts.push(`not objects ${c.notObjects}`);
    }
    if (c.order !== 'n/a' || c.pairsAscending + c.pairsDescending > 0) {
      parts.push(`order ${c.order} (${c.pairsDescending} descending, ${c.pairsAscending} ascending pairs)`);
    }
    lines.push(`${c.name}: ${parts.join('; ')}`);
  }
  return lines.join('\n');
}
