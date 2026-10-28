/**
 * Ids and order in a history you already hold, counts only. SQLite plan, PR 0.
 *
 *   npm run scan:history -- path/to/export.json
 *
 * Reads ONE LOCAL FILE you name: the app's own export of a backup, the
 * AppDatabase JSON, or a gzip of either. Nothing is fetched, nothing is
 * written. For each collection (workout sessions, exercise logs, bodyweight,
 * measurements, cardio) it prints the count, duplicate ids, rows missing an
 * id, a date or a sessionId, logs whose session is not in the file, and
 * whether the list runs newest-first. It never prints a row, an id or a note,
 * so the output can be pasted anywhere; the logic is src/lib/historyIdScan.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
require('./registerTs.cjs');

const { scanHistoryIds, formatHistoryScan } = require(path.join(ROOT, 'src', 'lib', 'historyIdScan'));
const { decodeAccountBackupBody } = require(path.join(ROOT, 'src', 'lib', 'accountBackup'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

const file = process.argv[2];
if (!file || file.startsWith('-')) {
  fail('Usage: node scripts/scan-history-ids.cjs <path to an exported backup or AppDatabase JSON>');
}

let bytes;
try {
  bytes = fs.readFileSync(file);
} catch {
  fail('Could not read that file.');
}

// A gzip file starts 1f 8b. The app's own compressed backup is JSON holding a
// gzip-base64 envelope, which decodeAccountBackupBody opens below.
if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
  try {
    bytes = zlib.gunzipSync(bytes);
  } catch {
    fail('The file looks like gzip but could not be decompressed.');
  }
}

let parsed;
try {
  // The parse error is not shown: its message can quote the file's text.
  parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
} catch {
  fail('The file is not valid JSON.');
}

const decoded = decodeAccountBackupBody(parsed);
if (decoded === null) {
  fail('The file holds a compressed backup envelope that could not be decoded.');
}

console.log(formatHistoryScan(scanHistoryIds(decoded)));
