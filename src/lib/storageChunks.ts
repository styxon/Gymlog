/**
 * One stored value, split across several keys.
 *
 * Android's AsyncStorage reads a value through a SQLite cursor window of 2 MB,
 * and a row bigger than the window cannot be read back at all: `getItem`
 * rejects with "Row too big to fit into CursorWindow". The write before it
 * succeeds without complaint, so nothing warns until the next launch.
 *
 * Measured on the emulator on 2026-09-14 with the screenshot history copied
 * back in time: 210 logged sessions (1.7 MB) opened on Home, 273 sessions
 * (2.2 MB) opened on the welcome screen as a new install, with every byte still
 * on disk underneath. The database grows by about 8 KB a session and is never
 * trimmed, so a year of training at four or five sessions a week reaches the
 * limit — and a Hevy import of a few hundred workouts reaches it in one tap.
 *
 * The planning here is pure; `src/storage/largeItem.ts` does the reads and
 * writes.
 */

/**
 * The most UTF-8 bytes a value may take and still be stored as one row.
 *
 * Splitting starts only here, near the limit, and not at the part size: a
 * build from before splitting reads the manifest as a corrupt database and
 * writes an empty one over it. Every history such a build could still read —
 * 1.7 MB opened on the emulator — therefore stays one row it can read, and
 * only a history it could never have opened anyway gets split.
 */
export const SINGLE_ROW_BYTES = 1_800_000;

/**
 * The most UTF-16 code units one part holds once a value is split.
 *
 * The window counts UTF-8 bytes, which is at most three per code unit (a
 * surrogate pair is four bytes for two units), so a part tops out at 768 KB —
 * well inside 2 MB, with room left for a phone that ships a smaller window.
 */
export const STORAGE_CHUNK_CHARS = 256_000;

/**
 * What the base key holds when the value is split.
 *
 * Every value stored this way is JSON and starts with `{`, so a head that
 * starts with this prefix cannot be mistaken for an unsplit value.
 */
const MANIFEST_PREFIX = 'vinha-chunks:';
const MANIFEST_PATTERN = /^vinha-chunks:(\d+):(\d+)$/;

export interface ChunkManifest {
  /** How many parts follow the base key, as `${key}#0` … `${key}#${count - 1}`. */
  count: number;
  /** The joined length, so a part that came back short is caught, not parsed. */
  length: number;
}

export function chunkKey(key: string, index: number) {
  return `${key}#${index}`;
}

/** The part index when `candidate` is one of `key`'s parts, otherwise null. */
export function chunkIndexOf(key: string, candidate: string): number | null {
  const prefix = `${key}#`;
  if (!candidate.startsWith(prefix)) {
    return null;
  }
  const rest = candidate.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Whether `text` is at most `maxBytes` once encoded as UTF-8.
 *
 * Counts only when it has to. A string short enough at three bytes a unit
 * fits, and one longer than the limit in units cannot. Between the two, the
 * bytes are at most one per unit plus two for every unit outside ASCII (a
 * two-byte unit costs one extra at most, a three-byte one two, a surrogate
 * pair four bytes for two units), and the non-ASCII units are counted by a
 * native replace, not a per-character loop: a bundle or database in that
 * window is mostly ASCII JSON, and the loop cost 20-45 ms under an
 * interpreter on every save. Only a text that bound cannot decide gets the
 * exact count. A full save runs this on every commit, and the workout bundle
 * on every change to the session (a set, a swap, a rest settling).
 */
export function fitsOneRow(text: string, maxBytes: number = SINGLE_ROW_BYTES): boolean {
  if (text.length * 3 <= maxBytes) {
    return true;
  }
  if (text.length > maxBytes) {
    return false;
  }
  const nonAscii = text.replace(/[\u0000-\u007f]+/g, '').length;
  if (text.length + 2 * nonAscii <= maxBytes) {
    return true;
  }
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (isHighSurrogate(code) && index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) {
      return false;
    }
  }
  return true;
}

/**
 * The value as it should be stored: itself when it fits one row, otherwise in
 * order, each part at most `maxChars` long.
 *
 * A cut never lands between the two halves of a surrogate pair: the bridge
 * encodes each part to UTF-8 on its own, and half an emoji in a session note
 * would come back as two replacement characters.
 */
export function splitStoredText(
  text: string,
  maxChars: number = STORAGE_CHUNK_CHARS,
  maxRowBytes: number = SINGLE_ROW_BYTES,
): string[] {
  if (fitsOneRow(text, maxRowBytes)) {
    return [text];
  }

  // Two is the floor, not one: a one-unit part could never hold a whole pair,
  // and backing off the cut would never move forward.
  const size = Math.max(2, Math.floor(maxChars));
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
      end -= 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

export function encodeChunkManifest(manifest: ChunkManifest) {
  return `${MANIFEST_PREFIX}${manifest.count}:${manifest.length}`;
}

/** The manifest a head value names, or null when the head is the value itself. */
export function readChunkManifest(head: string): ChunkManifest | null {
  if (!head.startsWith(MANIFEST_PREFIX)) {
    return null;
  }
  const match = MANIFEST_PATTERN.exec(head);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  const length = Number(match[2]);
  return count > 0 ? { count, length } : null;
}

/**
 * Whether a head row can be a stored value rather than a manifest or wreckage.
 *
 * Every value kept under these keys is a JSON object, so it starts with `{`
 * (after a byte-order mark or blank space, which a parser forgives). A manifest
 * is read by `readChunkManifest`. A head that is neither is a manifest that
 * was damaged — empty, cut short, one byte flipped, something appended — and
 * handed on as the value it fails to parse, the caller sets that one line
 * aside, and the empty value it then saves sweeps the parts the head used to
 * name. The caller looks for parts before letting such a head through.
 *
 * The remains `describeIncompleteChunks` keeps under a corrupt key start with
 * the manifest prefix on purpose. They fail this test too, and are told apart
 * by having no parts on disk: they are one row, stored whole.
 */
export function looksLikeStoredValue(head: string): boolean {
  return /^[\uFEFF\s]*\{/.test(head);
}

/**
 * The parts joined back into the value, or null when any is missing or the
 * result is not the length the manifest wrote down.
 */
export function joinStoredChunks(manifest: ChunkManifest, parts: ReadonlyArray<string | null | undefined>): string | null {
  if (parts.length !== manifest.count) {
    return null;
  }
  let joined = '';
  for (const part of parts) {
    if (typeof part !== 'string') {
      return null;
    }
    joined += part;
  }
  return joined.length === manifest.length ? joined : null;
}

/**
 * What is left of a split value whose parts are not all there, kept for a
 * person to recover from.
 *
 * It starts with the manifest line, so no JSON parser accepts it and every
 * loader takes its corrupt branch — a missing middle part must never read back
 * as a shorter history that happens to parse.
 */
export function describeIncompleteChunks(head: string, parts: ReadonlyArray<string | null | undefined>): string {
  const missing = parts.flatMap((part, index) => (typeof part === 'string' ? [] : [`#${index}`]));
  return `${head}\nmissing ${missing.join(' ') || 'none'}\n${parts.map((part) => part ?? '').join('')}`;
}
