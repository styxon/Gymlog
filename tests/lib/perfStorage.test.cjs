const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SINGLE_ROW_BYTES, fitsOneRow, splitStoredText } = require('../../.test-dist/lib/storageChunks.js');
const {
  ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS,
  ACCOUNT_BACKUP_ENCODING,
  ACCOUNT_BACKUP_SLICE_CHARS,
  ACCOUNT_BACKUP_SLICES_PER_STRETCH,
  decodeAccountBackupBody,
  encodeAccountBackupBody,
  encodeAccountBackupBodyAsync,
} = require('../../.test-dist/lib/accountBackup.js');
const { groupLogsBySession, logsOfSession } = require('../../.test-dist/lib/sessionLogIndex.js');
const { exerciseLogRepository } = require('../../.test-dist/storage/repositories.js');

/**
 * Three costs that grew with a long history, each pinned by what it does and
 * not by a wall clock (a clock flakes in CI):
 *
 * - fitsOneRow walked every character of a 0.6-1.8 MB save, on every set;
 * - the account backup gzipped the whole history in one uninterrupted call;
 * - History asked for each session's logs with a pass over every log.
 */

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

/** A small deterministic generator, so a failure repeats. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ALPHABET = ['a', 'z', '{', '"', ' ', '0', 'ä', 'ö', 'é', '€', '—', '💪', '🏋️', '\u{10FFFF}', '\ud83d', '\udc00'];

function randomText(random, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return text;
}

/** The byte count by the encoder itself; a lone surrogate is three bytes there too. */
function referenceFits(text, maxBytes) {
  return Buffer.byteLength(text, 'utf8') <= maxBytes;
}

/** Counts how many times the per-unit loop's primitive is called during `work`. */
function countCharCodeAtCalls(work) {
  const original = String.prototype.charCodeAt;
  let calls = 0;
  String.prototype.charCodeAt = function counted(index) {
    calls += 1;
    return original.call(this, index);
  };
  try {
    work();
  } finally {
    String.prototype.charCodeAt = original;
  }
  return calls;
}

function backupPayload(database) {
  return { version: 1, exportedAt: '2026-10-08T09:00:00.000Z', database, workoutHistory: { sessions: [] } };
}

function bigDatabase(approxChars) {
  const logs = [];
  let size = 0;
  for (let n = 0; size < approxChars; n += 1) {
    const row = { id: `log_${n}`, name: n % 7 === 0 ? 'Hyvä päivä 💪' : 'Bench Press', reps: [8, 8, 9], weight: 60 + (n % 40) };
    logs.push(row);
    size += JSON.stringify(row).length + 1;
  }
  return { logs };
}

module.exports = [
  {
    name: 'perf storage: fitsOneRow gives the encoder\'s verdict across the limit for ASCII, Finnish, emoji and lone surrogates',
    run() {
      const random = rng(20261008);
      for (let round = 0; round < 400; round += 1) {
        const length = 1 + Math.floor(random() * 300);
        const text = randomText(random, length);
        const bytes = Buffer.byteLength(text, 'utf8');
        for (const maxBytes of [bytes - 1, bytes, bytes + 1, Math.floor(length * 1.5), length, length * 3, length * 3 + 1]) {
          if (maxBytes < 0) continue;
          assert.equal(fitsOneRow(text, maxBytes), referenceFits(text, maxBytes), `round ${round} max ${maxBytes}`);
        }
      }
      // Mostly ASCII JSON with a few Finnish letters, in the window the bound decides.
      const json = JSON.stringify({ note: 'Hyvä päivä', rows: 'x'.repeat(5000) });
      for (const maxBytes of [Buffer.byteLength(json) - 1, Buffer.byteLength(json), Buffer.byteLength(json) + 1]) {
        assert.equal(fitsOneRow(json, maxBytes), referenceFits(json, maxBytes));
      }
      // At the real limit.
      const edge = 'x'.repeat(SINGLE_ROW_BYTES - 2) + 'ä';
      assert.equal(fitsOneRow(edge), true, 'exactly at the limit still fits');
      assert.equal(fitsOneRow(edge + 'ä'), false, 'one byte over does not');
      assert.equal(splitStoredText(edge).length, 1);
      assert.ok(splitStoredText(edge + 'ä').length > 1);
    },
  },
  {
    name: 'perf storage: a mostly-ASCII text in the 0.6-1.8 MB window is decided without walking its characters',
    run() {
      const ascii = '{"a":"' + 'x'.repeat(1_000_000) + '"}';
      assert.equal(countCharCodeAtCalls(() => assert.equal(fitsOneRow(ascii), true)), 0, 'plain ASCII was walked');

      const finnish = '{"a":"' + 'kyykky '.repeat(140_000) + 'Hyvä päivä 💪"}';
      assert.ok(finnish.length > 600_000 && finnish.length < SINGLE_ROW_BYTES);
      assert.equal(countCharCodeAtCalls(() => assert.equal(fitsOneRow(finnish), true)), 0, 'a few non-ASCII letters sent it into the loop');

      // A text the bound cannot decide still gets the exact count.
      const heavy = 'ä'.repeat(700_000);
      assert.equal(fitsOneRow(heavy), Buffer.byteLength(heavy) <= SINGLE_ROW_BYTES);
      assert.equal(fitsOneRow('ä'.repeat(900_000)), true);
      assert.equal(fitsOneRow('ä'.repeat(900_001)), false);
    },
  },
  {
    name: 'perf storage: the async backup encoder hands the thread back at least once per quarter megabyte of input',
    async run() {
      const payload = backupPayload(bigDatabase(4_000_000));
      const json = JSON.stringify(payload);
      assert.ok(json.length > 3_500_000, `fixture is ${json.length} chars`);

      let yields = 0;
      const body = await encodeAccountBackupBodyAsync(payload, async () => {
        yields += 1;
      });
      assert.ok(
        yields >= Math.floor(json.length / 262_144),
        `${yields} yields for ${json.length} chars: a stretch is longer than 256 KB`,
      );
      // The cadence is the one the constants state.
      assert.ok(ACCOUNT_BACKUP_SLICE_CHARS * ACCOUNT_BACKUP_SLICES_PER_STRETCH <= 262_144);

      const envelope = JSON.parse(body);
      assert.equal(envelope.encoding, ACCOUNT_BACKUP_ENCODING);
      assert.deepEqual(decodeAccountBackupBody(envelope), payload, 'the backup does not restore to what was sent');
      // The synchronous encoder's body restores to the same payload: same envelope, same decoder.
      assert.deepEqual(decodeAccountBackupBody(JSON.parse(encodeAccountBackupBody(payload))), payload);
      assert.deepEqual(Object.keys(envelope).sort(), ['data', 'encoding']);
    },
  },
  {
    name: 'perf storage: a cut between the halves of an emoji does not damage it, and a small backup stays plain JSON',
    async run() {
      const build = (padding) =>
        backupPayload({ note: 'x'.repeat(padding) + '💪', filler: 'y'.repeat(ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS + 10), tail: 'Hyvä päivä 💪' });
      const probe = JSON.stringify(build(0));
      const emojiAt = probe.indexOf('💪');
      // The high half sits on the last unit of the first slice.
      const payload = build(ACCOUNT_BACKUP_SLICE_CHARS - 1 - emojiAt);
      const json = JSON.stringify(payload);
      assert.equal(json.indexOf('💪'), ACCOUNT_BACKUP_SLICE_CHARS - 1, 'the fixture does not straddle the cut');

      const body = await encodeAccountBackupBodyAsync(payload, async () => {});
      const restored = decodeAccountBackupBody(JSON.parse(body));
      assert.deepEqual(restored, payload);
      assert.ok(restored.database.note.endsWith('💪'));
      assert.ok(!JSON.stringify(restored).includes('�'), 'a half emoji came back as a replacement character');

      // At or below the threshold: the plain JSON every build restores, and no yield at all.
      const small = backupPayload({ note: 'Hyvä päivä 💪', rows: [1, 2, 3] });
      let yields = 0;
      assert.equal(
        await encodeAccountBackupBodyAsync(small, async () => {
          yields += 1;
        }),
        JSON.stringify(small),
      );
      assert.equal(yields, 0);
      assert.equal(await encodeAccountBackupBodyAsync(small, async () => {}), encodeAccountBackupBody(small));
    },
  },
  {
    name: 'perf storage: the upload encodes in stretches and before the network timeout starts',
    run() {
      const client = read('src', 'features', 'account', 'backupApi.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.match(client, /await encodeAccountBackupBodyAsync\(payload, yieldToUi\)/);
      assert.doesNotMatch(client, /encodeAccountBackupBody\(/, 'the upload is back on the one-shot encoder');
      assert.match(client, /setTimeout\(resolve, 0\)/);
      const upload = client.slice(client.indexOf('export async function uploadBackup'), client.indexOf('export async function downloadBackup'));
      assert.ok(
        upload.indexOf('encodeAccountBackupBodyAsync') < upload.indexOf('withTimeout()'),
        'the encode time is taken from the request timeout',
      );
      // The lib stays pure: the yield comes in as a parameter.
      const lib = read('src', 'lib', 'accountBackup.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(lib, /setTimeout|AsyncStorage|from 'react/);
    },
  },
  {
    name: 'perf storage: the session-log index answers what listBySessionId answers, for every session',
    run() {
      const random = rng(7);
      const sessionIds = Array.from({ length: 40 }, (_, index) => `workout_session_${index}`);
      const logs = [];
      for (let index = 0; index < 400; index += 1) {
        logs.push({
          id: `log_${index}`,
          sessionId: sessionIds[Math.floor(random() * 38)],
          exerciseNameSnapshot: `Lift ${index}`,
          // Ties on orderIndex keep their list order in both.
          orderIndex: Math.floor(random() * 6),
        });
      }
      const database = { exerciseLogs: logs };
      const index = groupLogsBySession(logs);
      for (const id of [...sessionIds, 'nobody']) {
        assert.deepEqual(logsOfSession(index, id), exerciseLogRepository.listBySessionId(database, id), id);
      }
      assert.deepEqual(logsOfSession(index, sessionIds[39]), [], 'a session without logs');
      assert.equal(logsOfSession(index, 'nobody'), logsOfSession(index, 'other'), 'the empty answer is one shared array');
      assert.equal(logs.length, 400, 'the source list was reordered');
      assert.deepEqual(logs.map((log) => log.id), Array.from({ length: 400 }, (_, i) => `log_${i}`));
    },
  },
  {
    name: 'perf storage: the app asks the index, built once per change to the log list',
    run() {
      const provider = read('src', 'state', 'AppProvider.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.match(provider, /useMemo\(\(\) => groupLogsBySession\(database\.exerciseLogs\), \[database\.exerciseLogs\]\)/);
      assert.match(provider, /return logsOfSession\(sessionLogIndex, sessionId\)/);
      assert.doesNotMatch(provider, /exerciseLogRepository\.listBySessionId/);
      // Callers that reorder copy first.
      assert.match(read('src', 'screens', 'HistoryScreen.tsx'), /\[\.\.\.getSessionLogs\(selectedSession\.id\)\]\.sort/);
      assert.match(read('src', 'app', 'useRecentSessions.ts'), /\[\.\.\.getSessionLogs\(session\.id\)\]\.sort/);
    },
  },
];
