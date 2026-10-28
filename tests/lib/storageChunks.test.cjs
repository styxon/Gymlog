const assert = require('node:assert/strict');

const {
  SINGLE_ROW_BYTES,
  STORAGE_CHUNK_CHARS,
  chunkIndexOf,
  chunkKey,
  describeIncompleteChunks,
  encodeChunkManifest,
  fitsOneRow,
  joinStoredChunks,
  readChunkManifest,
  splitStoredText,
} = require('../../src/lib/storageChunks');

const CURSOR_WINDOW_BYTES = 2 * 1024 * 1024;

/** A string survives UTF-8 on its own only when no surrogate is left alone. */
function isWellFormed(text) {
  return Buffer.from(text, 'utf8').toString('utf8') === text;
}

module.exports = [
  {
    name: 'storage chunks: a value that fits is one part, untouched',
    run() {
      const value = JSON.stringify({ workoutSessions: [], note: 'kyykky' });
      assert.deepEqual(splitStoredText(value), [value]);
      assert.deepEqual(splitStoredText('x'.repeat(STORAGE_CHUNK_CHARS)), ['x'.repeat(STORAGE_CHUNK_CHARS)]);
    },
  },
  {
    name: 'storage chunks: every history an older build can read stays one row it can read',
    run() {
      // A build from before splitting reads a manifest as a corrupt database
      // and writes an empty one over it. 1.7 MB opened on the emulator, so a
      // value that size must not be split just because it is bigger than a part.
      const readableByOldBuilds = 'x'.repeat(1_700_000);
      assert.deepEqual(splitStoredText(readableByOldBuilds), [readableByOldBuilds]);
      assert.ok(SINGLE_ROW_BYTES < 2 * 1024 * 1024, 'the single-row limit is past what the phone can read back');
      assert.ok(SINGLE_ROW_BYTES >= 1_700_000, 'values old builds still open are being split');
    },
  },
  {
    name: 'storage chunks: the single-row limit counts UTF-8 bytes, not characters',
    run() {
      assert.equal(fitsOneRow('x'.repeat(100), 100), true);
      assert.equal(fitsOneRow('x'.repeat(101), 100), false);
      // Two bytes each.
      assert.equal(fitsOneRow('ä'.repeat(50), 100), true);
      assert.equal(fitsOneRow('ä'.repeat(51), 100), false);
      // Three bytes each.
      assert.equal(fitsOneRow('€'.repeat(33), 100), true);
      assert.equal(fitsOneRow('€'.repeat(34), 100), false);
      // A pair is four bytes, not six.
      assert.equal(fitsOneRow('💪'.repeat(25), 100), true);
      assert.equal(fitsOneRow('💪'.repeat(26), 100), false);
      assert.equal(Buffer.byteLength('💪'.repeat(25), 'utf8'), 100);
    },
  },
  {
    name: 'storage chunks: every part fits a cursor window even when every character is three bytes',
    run() {
      // '€' is three bytes in UTF-8: the worst a part can do without surrogates.
      const value = '€'.repeat(STORAGE_CHUNK_CHARS * 3 + 17);
      const parts = splitStoredText(value);

      assert.equal(parts.length, 4);
      assert.equal(parts.join(''), value);
      for (const part of parts) {
        assert.ok(part.length <= STORAGE_CHUNK_CHARS);
        assert.ok(
          Buffer.byteLength(part, 'utf8') < CURSOR_WINDOW_BYTES,
          `a part is ${Buffer.byteLength(part, 'utf8')} bytes, which the phone cannot read back`,
        );
      }
    },
  },
  {
    name: 'storage chunks: a cut never separates the two halves of an emoji',
    run() {
      // The pair straddles the boundary: its high half is the last unit that
      // would fit. The tail makes the value long enough to be split at all.
      const value = 'a'.repeat(STORAGE_CHUNK_CHARS - 1) + '💪' + 'b'.repeat(SINGLE_ROW_BYTES);
      const parts = splitStoredText(value);

      assert.equal(parts.join(''), value);
      for (const part of parts) {
        assert.ok(isWellFormed(part), 'a part ends in half a surrogate pair and comes back as replacement characters');
      }
      assert.equal(parts[0].length, STORAGE_CHUNK_CHARS - 1);

      // A size too small to hold a pair still moves forward.
      const tiny = splitStoredText('💪💪x', 1, 0);
      assert.equal(tiny.join(''), '💪💪x');
      assert.ok(tiny.every(isWellFormed));
    },
  },
  {
    name: 'storage chunks: the manifest reads back, and a stored value is never taken for one',
    run() {
      const manifest = { count: 9, length: 2213327 };
      assert.deepEqual(readChunkManifest(encodeChunkManifest(manifest)), manifest);

      assert.equal(readChunkManifest('{"workoutSessions":[]}'), null);
      assert.equal(readChunkManifest(''), null);
      assert.equal(readChunkManifest('vinha-chunks:'), null);
      assert.equal(readChunkManifest('vinha-chunks:x:1'), null);
      assert.equal(readChunkManifest('vinha-chunks:0:0'), null, 'a manifest naming no parts is not a value');
    },
  },
  {
    name: 'storage chunks: a missing, extra or short part joins to nothing rather than to half a value',
    run() {
      const manifest = { count: 3, length: 9 };
      assert.equal(joinStoredChunks(manifest, ['abc', 'def', 'ghi']), 'abcdefghi');
      assert.equal(joinStoredChunks(manifest, ['abc', null, 'ghi']), null);
      assert.equal(joinStoredChunks(manifest, ['abc', 'def']), null);
      assert.equal(joinStoredChunks(manifest, ['abc', 'def', 'ghi', 'jkl']), null);
      assert.equal(joinStoredChunks(manifest, ['abc', 'de', 'ghi']), null);
    },
  },
  {
    name: 'storage chunks: what is left of an incomplete value never parses as a shorter one',
    run() {
      // Parts that happen to leave valid JSON when one is dropped: without the
      // manifest line in front, this would load as a history missing a session.
      const head = encodeChunkManifest({ count: 3, length: 40 });
      const parts = ['{"s":[{"id":"a"},', '{"id":"b"},', '{"id":"c"}]}'];
      assert.doesNotThrow(() => JSON.parse(parts[0] + parts[2]));

      const remains = describeIncompleteChunks(head, [parts[0], null, parts[2]]);
      assert.throws(() => JSON.parse(remains));
      assert.ok(remains.includes('#1'), 'the remains do not say which part is missing');
      assert.ok(remains.includes(parts[0]) && remains.includes(parts[2]), 'the parts that were there are not kept');
    },
  },
  {
    name: 'storage chunks: part keys belong to exactly one base key',
    run() {
      const key = '@vinha/database/v1';
      assert.equal(chunkKey(key, 4), '@vinha/database/v1#4');
      assert.equal(chunkIndexOf(key, chunkKey(key, 4)), 4);
      assert.equal(chunkIndexOf(key, chunkKey(key, 12)), 12);

      assert.equal(chunkIndexOf(key, key), null);
      assert.equal(chunkIndexOf(key, `${key}#`), null);
      assert.equal(chunkIndexOf(key, `${key}#2x`), null);
      assert.equal(chunkIndexOf(key, '@vinha/database/corrupt#0'), null);
      assert.equal(chunkIndexOf(key, '@vinha/database/v10#0'), null);
      assert.equal(chunkIndexOf('@vinha/workout/v1', chunkKey(key, 0)), null);
    },
  },
];
