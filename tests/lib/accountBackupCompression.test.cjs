const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS,
  ACCOUNT_BACKUP_ENCODING,
  buildAccountBackupPayload,
  decodeAccountBackupBody,
  encodeAccountBackupBody,
  parseAccountBackupPayload,
} = require('../../.test-dist/lib/accountBackup.js');
const { base64ToBytes, bytesToBase64 } = require('../../.test-dist/lib/base64.js');
const { utf8Encode, utf8EncodeFallback } = require('../../.test-dist/lib/utf8.js');

/**
 * A long history still backs up.
 *
 * The endpoint refused bodies over 2 MB, and a plain-JSON history passes that
 * at roughly 250 sessions — from then on every backup failed. Large bodies are
 * gzipped now and the cap is 4 MB; these pin both halves and the round trip.
 */

function read(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', '..', ...segments), 'utf8');
}

const HISTORY = { sessions: [], slotHistory: {}, lastSelectedTemplateId: null };

function databaseWithSessions(count) {
  const lifts = ['Bench Press', 'Back Squat', 'Romanian Deadlift', 'Pull-Up', 'Overhead Press', 'Barbell Row', 'Leg Press'];
  const workoutSessions = [];
  const exerciseLogs = [];
  for (let index = 0; index < count; index += 1) {
    const performedAt = new Date(Date.UTC(2026, 8, 13, 9) - index * 2 * 86_400_000).toISOString();
    workoutSessions.push({
      id: `workout_session_${index}`,
      workoutTemplateId: 'workout_kyhgbfli8o4',
      workoutTemplateSessionId: 'onboarding_tpl_4_day_upper_lower_v1_1',
      workoutNameSnapshot: 'Rintamassa · Advanced - Day 1: Upper Body',
      sessionNotes: index % 9 === 0 ? 'Hyvä päivä 💪' : null,
      performedAt,
      startedAt: performedAt,
      durationMinutes: 50 + (index % 13),
      setsCompleted: 21,
      exercisesCompleted: 7,
      totalVolumeKg: 9000 + index,
      feel: 'right',
    });
    lifts.forEach((name, orderIndex) => {
      exerciseLogs.push({
        id: `log_${index}_${orderIndex}`,
        sessionId: `workout_session_${index}`,
        exerciseNameSnapshot: name,
        weight: 60 + ((index + orderIndex) % 40),
        repsPerSet: [8, 8, 9],
        sets: [0, 1, 2].map((setIndex) => ({
          orderIndex: setIndex,
          weight: 60 + ((index + orderIndex) % 40),
          reps: 8 + ((index + setIndex) % 3),
          kind: 'working',
          outcome: 'completed',
          status: 'completed',
          effort: null,
          completedAt: performedAt,
          skippedReason: null,
        })),
        tracked: true,
        orderIndex,
        skipped: false,
      });
    });
  }
  return {
    workoutTemplates: [],
    exerciseTemplates: [],
    workoutPlans: [],
    exerciseLibrary: [],
    workoutSessions,
    cardioSessions: [],
    exerciseLogs,
    bodyweightEntries: [],
    measurementEntries: [],
    preferences: { appLanguage: 'fi' },
  };
}

module.exports = [
  {
    name: 'backup compression: base64 matches Node for every tail length, and refuses what is not base64',
    run() {
      for (let length = 0; length < 40; length += 1) {
        const bytes = Uint8Array.from({ length }, (_, index) => (index * 97 + length * 13) & 255);
        const encoded = bytesToBase64(bytes);
        assert.equal(encoded, Buffer.from(bytes).toString('base64'), `length ${length}`);
        assert.deepEqual(Array.from(base64ToBytes(encoded)), Array.from(bytes), `length ${length}`);
      }
      // Across the encoder's internal chunk boundary.
      const large = Uint8Array.from({ length: 50_003 }, (_, index) => (index * 31) & 255);
      assert.equal(bytesToBase64(large), Buffer.from(large).toString('base64'));
      assert.deepEqual(Buffer.from(base64ToBytes(bytesToBase64(large))), Buffer.from(large));

      assert.equal(base64ToBytes('abc'), null, 'length not a multiple of four');
      assert.equal(base64ToBytes('ab=c'), null, 'padding in the middle');
      assert.equal(base64ToBytes('ab!c'), null);
      assert.equal(base64ToBytes('äbcd'), null);
    },
  },
  {
    name: 'backup compression: text becomes the same UTF-8 bytes with or without TextEncoder',
    run() {
      for (const text of ['', 'kyykky', 'Hyvä päivä', '€ 100', '💪', 'a💪b🏋️‍♀️c', '\u{10FFFF}', 'x'.repeat(5000) + 'ö']) {
        const expected = Buffer.from(text, 'utf8');
        assert.deepEqual(Buffer.from(utf8EncodeFallback(text)), expected, JSON.stringify(text));
        assert.deepEqual(Buffer.from(utf8Encode(text)), expected, JSON.stringify(text));
      }
      // A lone surrogate is U+FFFD, the way TextEncoder writes it.
      assert.deepEqual(Buffer.from(utf8EncodeFallback('a\ud83db')), Buffer.from(new TextEncoder().encode('a\ud83db')));
      assert.deepEqual(Buffer.from(utf8EncodeFallback('\udc00')), Buffer.from(new TextEncoder().encode('\udc00')));
    },
  },
  {
    name: 'backup compression: a small backup is the same plain JSON every existing build restores',
    run() {
      const payload = buildAccountBackupPayload(databaseWithSessions(20), HISTORY, '2026-09-14T10:00:00.000Z');
      const body = encodeAccountBackupBody(payload);
      assert.equal(body, JSON.stringify(payload));
      assert.equal(decodeAccountBackupBody(JSON.parse(body)).exportedAt, payload.exportedAt);
    },
  },
  {
    name: 'backup compression: a years-long history is compressed under the cap and restores whole',
    run() {
      const payload = buildAccountBackupPayload(databaseWithSessions(1500), HISTORY, '2026-09-14T10:00:00.000Z');
      const plain = JSON.stringify(payload);
      assert.ok(plain.length > 4 * 1024 * 1024, 'the history is too small to prove anything about the cap');
      assert.ok(plain.length > ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS);

      const body = encodeAccountBackupBody(payload);
      const envelope = JSON.parse(body);
      assert.equal(envelope.encoding, ACCOUNT_BACKUP_ENCODING);
      assert.ok(Buffer.byteLength(body, 'utf8') < 4 * 1024 * 1024, `compressed body is ${Buffer.byteLength(body)} bytes`);

      // What the server stores and hands back is exactly what was sent.
      const restored = parseAccountBackupPayload(decodeAccountBackupBody(JSON.parse(body)));
      assert.ok(restored, 'a compressed backup is refused on restore');
      assert.deepEqual(restored, JSON.parse(plain));
      assert.equal(
        restored.database.workoutSessions.find((session) => session.id === 'workout_session_0').sessionNotes,
        'Hyvä päivä 💪',
      );
    },
  },
  {
    // Node resolves fflate's `node` build; Metro bundles the `require` one
    // (lib/browser.cjs), and Hermes may have no TextDecoder. Load that build
    // with the text codecs gone, so the fallback the phone may use is the one
    // proven here. This is the test that found fflate's own encoder fallback
    // turning 💪 into 𝢪, which is why the text goes through lib/utf8.
    name: 'backup compression: the build Metro bundles round-trips Finnish and emoji without TextEncoder or TextDecoder',
    run() {
      const packageDir = path.dirname(require.resolve('fflate/package.json'));
      const browserBuild = path.join(packageDir, 'lib', 'browser.cjs');
      assert.equal(
        require(path.join(packageDir, 'package.json')).exports['.'].require.default,
        './lib/browser.cjs',
        'fflate changed which file a bundler gets',
      );

      const saved = { TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder };
      delete require.cache[browserBuild];
      delete globalThis.TextEncoder;
      delete globalThis.TextDecoder;
      let fflate;
      try {
        fflate = require(browserBuild);
      } finally {
        globalThis.TextEncoder = saved.TextEncoder;
        globalThis.TextDecoder = saved.TextDecoder;
        delete require.cache[browserBuild];
      }

      const text = JSON.stringify(databaseWithSessions(200));
      const packed = bytesToBase64(fflate.gzipSync(utf8EncodeFallback(text), { level: 6 }));
      const unpacked = fflate.strFromU8(fflate.gunzipSync(base64ToBytes(packed)));
      assert.equal(unpacked, text);
      assert.ok(unpacked.includes('Hyvä päivä 💪'));
      // And what one build packs, the other unpacks.
      const { gunzipSync, strFromU8 } = require('fflate');
      assert.equal(strFromU8(gunzipSync(base64ToBytes(packed))), text);
    },
  },
  {
    name: 'backup compression: a broken envelope is refused like any wrong-shaped download',
    run() {
      assert.equal(decodeAccountBackupBody({ encoding: ACCOUNT_BACKUP_ENCODING, data: 'not base64!' }), null);
      assert.equal(decodeAccountBackupBody({ encoding: ACCOUNT_BACKUP_ENCODING, data: 'aGVsbG8=' }), null, 'valid base64, not gzip');
      assert.equal(decodeAccountBackupBody({ encoding: ACCOUNT_BACKUP_ENCODING }), null);
      assert.equal(parseAccountBackupPayload(decodeAccountBackupBody(null)), null);
      const other = { version: 1, something: true };
      assert.equal(decodeAccountBackupBody(other), other, 'a plain body is not touched');
    },
  },
  {
    name: 'backup compression: the app sends and reads through the codec, and the server allows 4 MB',
    run() {
      const client = read('src', 'features', 'account', 'backupApi.ts');
      assert.match(client, /await encodeAccountBackupBodyAsync\(payload, yieldToUi\)/);
      assert.match(client, /parseAccountBackupPayload\(decodeAccountBackupBody\(body\.payload\)\)/);
      assert.doesNotMatch(client, /body: JSON\.stringify\(payload\)/);

      // fflate's own strToU8 mangles emoji when TextEncoder is missing, and Node
      // always has one, so a slip back to it would pass every test above.
      const codec = read('src', 'lib', 'accountBackup.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(codec, /strToU8/);
      assert.match(codec, /gzipSync\(utf8Encode\(json\)/);

      const server = read('api', 'backup.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.match(server, /parsed > 0 \? parsed : 4 \* 1024 \* 1024/);
    },
  },
];
