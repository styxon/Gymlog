/**
 * The Google account Play's reviewers sign in with.
 *
 * Reviewers cannot buy Pro and cannot be given a code that works in a build
 * with no codes in it, so one dedicated Google account is recognised instead:
 * when the signed-in account's email, or its Google account id (the `sub`
 * stored with the sign-in), hashes to a value on the list below, Pro is on for
 * as long as that account is signed in (entitlement source 'review',
 * lib/proEntitlement).
 *
 * Why this is safe to ship in a public repo and a public APK:
 * - Only SHA-256 hashes are here: of the lowercased, trimmed email, and
 *   (once it is known) of the `sub`. Neither value is recoverable from its
 *   hash, and nothing in the bundle is a secret to extract.
 * - The identity is proven by Google's own sign-in, not by anything the phone
 *   is told: knowing the hash is not a way in, owning the account is. A
 *   different account hashes to a different value.
 * - It unlocks nothing the server meters. The paywall is device-side, and the
 *   coach's cost is bounded by the server's own limits whoever asks.
 *
 * Pure TypeScript with no platform crypto, so it runs the same on Hermes and in
 * Node. Nothing is computed when this module loads: the hash is taken when an
 * email is checked, which happens when the signed-in account changes.
 */

/**
 * SHA-256 hex of an identifier of the review account: its email (lowercase,
 * trimmed) or its Google `sub` exactly as stored. One list serves both, since
 * a 64-character hash of one cannot collide with a hash of the other.
 *
 * The email claim in Google's ID token is not certain to be the address the
 * account was created with, so the `sub` is accepted as well. A sub hash can
 * be added here as a second line once the account's sub is known.
 */
export const REVIEW_ACCOUNT_HASHES: readonly string[] = [
  '33cbf8dc2cb8b5766a73c94a0d707e974647ec6d73c5f17188f4302eedb2f059',
];

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The UTF-8 bytes of a string; a lone surrogate becomes U+FFFD, as TextEncoder does. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** SHA-256 of the UTF-8 text, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  // The length is a 64-bit big-endian count; text this short never needs the top word.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);
  const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const at = offset + t * 4;
      w[t] = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) | 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choose + K[t] + w[t]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  return h.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * Whether this sign-in is a review account's: its email (trimmed and
 * lowercased first, as Google addresses are case-insensitive) OR its `sub`
 * (as stored, trimmed) hashes to a value on the list. `hashes` is injectable
 * so a test can use values of its own instead of the real ones.
 */
export function isReviewAccount(
  identity: { email?: string | null; sub?: string | null },
  hashes: readonly string[] = REVIEW_ACCOUNT_HASHES,
): boolean {
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  if (email && hashes.includes(sha256Hex(email))) {
    return true;
  }
  const sub = typeof identity.sub === 'string' ? identity.sub.trim() : '';
  return sub !== '' && hashes.includes(sha256Hex(sub));
}

/**
 * The flag the app stores for the signed-in account: true only for a Google
 * sign-in that is a review account's. Apple's address (or its private relay)
 * is never a review account — the dedicated account is a Google one.
 */
export function reviewAccountFlag(
  account: { status: string; email: string | null; sub: string | null; provider: string | null },
  hashes: readonly string[] = REVIEW_ACCOUNT_HASHES,
): boolean {
  return (
    account.status === 'signed_in' &&
    account.provider === 'google' &&
    isReviewAccount({ email: account.email, sub: account.sub }, hashes)
  );
}
