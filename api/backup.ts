/**
 * Cloud backup endpoint: one JSON blob per Google or Apple account.
 *
 * Identity is a Google ID token, verified against Google's tokeninfo endpoint
 * on every request — or, on iPhone, an Apple session (below) — this function keeps no session state, exactly like the
 * coach endpoint keeps none. The blob pathname is an HMAC of the Google
 * subject with a server secret, so the storage URL is deterministic for the
 * server and unguessable for anyone else. The store is PRIVATE access: no
 * blob URL is publicly fetchable, and nothing here returns one anyway.
 *
 * What this endpoint never does: log payloads, list users, or accept a write
 * without a verified token. The payload cap is a spend and abuse control the
 * same way the coach's request bounds are.
 *
 * Env (see docs/account-backup.md):
 * - GOOGLE_WEB_CLIENT_ID   — the OAuth Web client id; token audience must match
 * - Blob auth: connecting the store adds BLOB_STORE_ID and the SDK uses the
 *   function's OIDC identity — there is no BLOB_READ_WRITE_TOKEN in this flow
 * - BACKUP_PATH_SECRET     — any long random string; changing it orphans stored backups
 * - APPLE_BUNDLE_ID        — optional, default app.vinha; an Apple identity
 *   token's audience must match
 * - BACKUP_MAX_BYTES       — optional payload cap, default 4 MB (Vercel refuses
 *   request and response bodies over 4.5 MB whatever this says)
 *
 * Versions (server audit, 2026-09-21). Two phones on one Google account share
 * the one blob, and each used to upload whenever it had not shrunk against its
 * own last count, without looking at what the cloud held: the phone that wrote
 * last won, older data included. Every copy now has a version — the blob's
 * ETag — and a write names the copy it replaces:
 *
 * - GET answers with `version`, the copy it returned.
 * - PUT answers with `version`, the copy it wrote.
 * - PUT with `x-backup-expected-version: <version>` replaces that copy and no
 *   other; with `none` it writes only where there is no copy yet. When the
 *   store holds anything else it answers 412 BACKUP_CHANGED and writes
 *   nothing. The phone then reads the copy and asks the reader restore-or-keep,
 *   the question it already asks when it holds far less than the cloud. The 412
 *   body carries `version`, the copy the store holds now (null when none), so a
 *   phone can recognise a copy it wrote itself.
 * - PUT without the header is a build from before versions, and still
 *   overwrites: refusing it would stop every installed phone backing up until
 *   the reader updates, which is a worse loss than the one this closes.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from '@vercel/blob';

import { appUpdateRefusalBody, isAppVersionRefused } from '../src/lib/appUpdateGate';
import { isServicePaused, servicePausedBody } from '../src/lib/serverNotice';
import { webDeletionCorsHeaders } from '../src/lib/webAccountDeletion';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: {
    remoteAddress?: string;
  };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const MAX_BYTES = (() => {
  const parsed = Number(process.env.BACKUP_MAX_BYTES);
  // A zero, negative or unparseable value falls back rather than opening the
  // tap — same rule as the coach budget.
  // 4 MB, not the 2 MB it was: a plain-JSON history stopped fitting at about
  // 250 sessions and every backup after that failed. Large backups now arrive
  // gzipped (lib/accountBackup), and this is the headroom under the platform's
  // own 4.5 MB body limit, which the GET response has to fit as well.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4 * 1024 * 1024;
})();

// Same per-IP speed bump as the coach endpoint, and with the same honesty
// about what it is: per-instance, reset by a cold start, a brake on one
// hammering client. It sits BEFORE token verification, because the cost it
// bounds is the outbound tokeninfo call an unauthenticated spammer would
// otherwise make this function pay for.
const RATE_LIMIT_WINDOW_MS = Number(process.env.BACKUP_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.BACKUP_RATE_LIMIT_MAX ?? 60);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getIpAddress(req: ApiRequest) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = rateLimitStore.get(ip);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return true;
  }
  existing.count += 1;
  return false;
}

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

interface VerifiedIdentity {
  sub: string;
}

/**
 * Verifies the Google ID token and returns the stable subject, or null.
 * Audience must be OUR web client id: any Google-signed token for some other
 * app is somebody else's identity, not a key to a backup here.
 */
async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<VerifiedIdentity | null> {
  const response = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    return null;
  }
  const info = (await response.json()) as { aud?: string; sub?: string; exp?: string };
  if (!info.aud || !info.sub) {
    return null;
  }
  const expected = Buffer.from(clientId);
  const actual = Buffer.from(info.aud);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    // Client ids are public identifiers, so naming the prefixes is safe -
    // it turns "sign-in silently fails" into "the env var has a typo".
    console.error('backup aud mismatch:', info.aud.slice(0, 16), 'expected:', clientId.slice(0, 16));
    return null;
  }
  if (!info.exp || Number(info.exp) * 1000 < Date.now()) {
    return null;
  }
  return { sub: info.sub };
}

/**
 * Sign in with Apple. An Apple identity token lives ten minutes and Apple has
 * no silent refresh like Google's, so a background backup an hour later would
 * have nothing to send. The phone trades the identity token once, here, for an
 * Apple session: `vs1.<payload>.<mac>`, signed with a key derived from
 * BACKUP_PATH_SECRET, naming the Apple subject, the time it was issued and an
 * expiry. The phone checks with Apple that the sign-in has not been revoked
 * before it sends one, and deleting the account (DELETE with
 * `x-backup-action: delete-account`) records a revocation that ends every
 * session issued before it. Apple's own token revocation is not called: it
 * needs a client secret signed with the team's key (docs/ios-launch.md).
 *
 * Apple subjects are stored as `apple:<sub>`, so they can never land on a
 * Google account's blob. Google subjects stay bare: prefixing them now would
 * orphan every backup already stored.
 */
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_SESSION_PREFIX = 'vs1.';
const APPLE_SESSION_DAYS = 180;
/** The request header that asks for an Apple session instead of a backup operation. */
const ACTION_HEADER = 'x-backup-action';
const APPLE_SESSION_ACTION = 'apple-session';
/** Trades a still-valid Apple session for a fresh one, so an active reader is never timed out. */
const APPLE_RENEW_ACTION = 'apple-renew';
/**
 * On a DELETE: the reader is deleting the account, not only the copy. A plain
 * DELETE ("Delete cloud backup") keeps them signed in, so it must not end the
 * session that sent it.
 */
const DELETE_ACCOUNT_ACTION = 'delete-account';
/**
 * On a Delete account DELETE: an id the phone made for this attempt (32
 * lowercase hex characters; anything else is ignored). It is stored in the
 * revocation marker, and a refusal because of that marker carries it back as
 * `deleteRequestId`, so a phone whose answer was lost can tell its own deletion
 * from another phone's. Only a session of the same account is ever shown it.
 */
const DELETE_REQUEST_ID_HEADER = 'x-delete-request-id';
const DELETE_REQUEST_ID = /^[0-9a-f]{32}$/;

type AppleKey = { kty: string; n: string; e: string; kid?: string; alg?: string };
let appleKeys: { keys: AppleKey[]; fetchedAt: number } | null = null;

async function loadAppleKeys(forceRefresh: boolean): Promise<AppleKey[]> {
  // Apple rotates its keys rarely; an hour per instance spares the call,
  // and an unknown kid refetches once.
  if (!forceRefresh && appleKeys && Date.now() - appleKeys.fetchedAt < 60 * 60 * 1000) {
    return appleKeys.keys;
  }
  const response = await fetch(APPLE_KEYS_URL);
  if (!response.ok) {
    return appleKeys?.keys ?? [];
  }
  const body = (await response.json()) as { keys?: AppleKey[] };
  appleKeys = { keys: Array.isArray(body.keys) ? body.keys : [], fetchedAt: Date.now() };
  return appleKeys.keys;
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies an Apple identity token (RS256, Apple's published keys) for this app.
 * `iat` is the second Apple issued it in — 0 when the token names none, which
 * the replay check then treats as issued before any deletion.
 */
async function verifyAppleIdentityToken(idToken: string, bundleId: string): Promise<{ sub: string; iat: number } | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeSegment<{ alg?: string; kid?: string }>(headerPart);
  const payload = decodeSegment<{ iss?: string; aud?: string; sub?: string; exp?: number; iat?: number }>(payloadPart);
  if (!header || !payload || header.alg !== 'RS256' || !header.kid) {
    return null;
  }
  let key = (await loadAppleKeys(false)).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    key = (await loadAppleKeys(true)).find((candidate) => candidate.kid === header.kid);
  }
  if (!key) {
    return null;
  }
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    createPublicKey({ key, format: 'jwk' }),
    Buffer.from(signaturePart, 'base64url'),
  );
  if (!valid || payload.iss !== APPLE_ISSUER || typeof payload.sub !== 'string' || !payload.sub) {
    return null;
  }
  if (typeof payload.aud !== 'string' || !sameText(payload.aud, bundleId)) {
    console.error('backup apple aud mismatch:', String(payload.aud).slice(0, 32), 'expected:', bundleId);
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    return null;
  }
  return { sub: payload.sub, iat: typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? payload.iat : 0 };
}

function appleSessionKey(pathSecret: string): Buffer {
  // Derived, not BACKUP_PATH_SECRET itself: a session mac must never double as a blob pathname.
  return createHmac('sha256', pathSecret).update('apple-session-v1').digest();
}

/**
 * A session carries the millisecond it was issued (`iatMs`; `iat` is the same
 * in seconds, for anything that reads the older field). One from before
 * either existed has neither, and is taken to have been issued 180 days
 * before it expires — which is exactly when it was, since every session lasts
 * that long. One with only `iat` counts from the start of that second.
 */
function issueAppleSession(
  sub: string,
  pathSecret: string,
): { sessionToken: string; expiresAt: string } {
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + APPLE_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      iat: Math.floor(issuedAtMs / 1000),
      iatMs: issuedAtMs,
      exp: Math.floor(expiresAtMs / 1000),
    }),
  ).toString('base64url');
  const mac = createHmac('sha256', appleSessionKey(pathSecret)).update(payload).digest('base64url');
  return { sessionToken: `${APPLE_SESSION_PREFIX}${payload}.${mac}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

/** The revocation record could not be read or written: neither "revoked" nor "fine". */
class StoreUnavailable extends Error {}

/**
 * Where an Apple account's revocation is recorded: `revoked/<hash>.json`, next
 * to the backups, under a hash of its own so it never names the account and
 * never lands on a backup's pathname.
 */
function revocationPathname(sub: string, secret: string): string {
  return `revoked/${createHmac('sha256', secret).update(`revoked:${sub}`).digest('hex')}.json`;
}

/**
 * A marker stops mattering once every session it could have ended has
 * expired: those were issued before it, and last 180 days. A day of margin.
 */
const REVOCATION_KEPT_MS = (APPLE_SESSION_DAYS + 1) * 24 * 60 * 60 * 1000;

const REVOCATION_WRITE_OPTIONS = {
  access: 'private' as const,
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
};

/**
 * What a marker says, and when the store wrote it. `revokedAtMs` is null for
 * a marker that cannot be parsed. The SDK's `uploadedAt` is always a date: the
 * store's Last-Modified, or the moment of the read when the store sends none.
 * `deleteRequestId` is the id of the Delete account request that wrote it, when
 * it carried one (see DELETE_REQUEST_ID_HEADER).
 *
 * Only a body that was READ in full and then does not parse is "unreadable"
 * (revokedAtMs null). A read that fails part-way says nothing about the
 * marker — a valid one would be rewritten with the store's time, which can be
 * a LATER time than its own, ending sessions it never ended — so it is a
 * StoreUnavailable, the same 502 as a failed get.
 */
async function readRevocationMarker(pathname: string): Promise<{
  revokedAtMs: number | null;
  uploadedAtMs: number;
  etag: string | null;
  deleteRequestId: string | null;
} | null> {
  let stored;
  try {
    stored = await get(pathname, { access: 'private', useCache: false });
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    throw new StoreUnavailable();
  }
  if (!stored || stored.statusCode !== 200) {
    return null;
  }
  let text: string;
  try {
    text = await new Response(stored.stream).text();
  } catch {
    throw new StoreUnavailable();
  }
  let revokedAtMs: number | null = null;
  let deleteRequestId: string | null = null;
  try {
    const record = JSON.parse(text) as { revokedAtMs?: unknown; deleteRequestId?: unknown };
    if (typeof record.revokedAtMs === 'number' && Number.isFinite(record.revokedAtMs)) {
      revokedAtMs = record.revokedAtMs;
    }
    if (typeof record.deleteRequestId === 'string' && DELETE_REQUEST_ID.test(record.deleteRequestId)) {
      deleteRequestId = record.deleteRequestId;
    }
  } catch {
    // Unreadable: the caller resolves it.
  }
  const uploadedAtMs = new Date(stored.blob.uploadedAt).getTime();
  return {
    revokedAtMs,
    uploadedAtMs: Number.isFinite(uploadedAtMs) ? uploadedAtMs : Date.now(),
    etag: stored.blob.etag || null,
    deleteRequestId,
  };
}

/**
 * Removes a marker that was read as stale — only if it is still the copy that
 * was read. A new Delete account stamps the same pathname, and an unconditional
 * `del` landing after it would erase a fresh revocation and give the deleted
 * account's sessions their life back. So: the store's own current ETag is
 * fetched with `head` (the API's form, which `ifMatch` compares against; the
 * content response's header that `get` reads may be written differently), must
 * be the copy that was read, and is what `del` is conditional on. Anything
 * else — the marker moved, the forms cannot be matched, the condition fails, the
 * store errors — keeps the marker. It is housekeeping: a marker kept costs
 * nothing, one removed wrongly ends someone's deletion.
 */
async function removeStaleMarker(pathname: string, readEtag: string | null): Promise<void> {
  if (!readEtag) {
    return;
  }
  try {
    const current = (await head(pathname)).etag;
    if (!current || etagCore(current) !== etagCore(readEtag)) {
      // The marker moved since it was read — or the two forms can never match, and then no stale
      // marker would ever go. Said once per attempt, as shapes only (no value, no id).
      console.error(`backup stale marker etag forms differ: get=${etagShape(readEtag)} head=${etagShape(current)}`);
      return;
    }
    await del(pathname, { ifMatch: current });
  } catch {
    // BlobPreconditionFailedError (written since), not found, or a store error: kept.
  }
}

/** What an ETag looks like, never its value: for the log line that says two forms differ. */
function etagShape(etag: string | undefined): string {
  const text = (etag ?? '').trim();
  return `${text.startsWith('W/') ? 'weak' : 'strong'}-${/^(W\/)?".*"$/.test(text) ? 'quoted' : 'bare'}-len${text.length}`;
}

/** An ETag without its quotes and weak prefix, for comparing the API's form with a response header's. */
function etagCore(etag: string): string {
  return etag.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/**
 * When (unix ms) the account's sessions were last ended, or null if never — or
 * if the marker has outlived its use, in which case it is removed on the spot.
 *
 * A marker that cannot be parsed must never lock the account out for good. It
 * is resolved ONCE, to the time the store gave it (`uploadedAt`), and
 * rewritten in valid form with that time, so every later read gives the same
 * answer and a sign-in made after it works. Read on its own each time, a store
 * that sends no Last-Modified would say "now" on every read and refuse every
 * session for ever. If the rewrite fails the answer is a 502, not a guess.
 *
 * The rewrite is conditional on the corrupt copy it read (`ifMatch`): a
 * deletion that stamps the marker at the same moment wins, and its valid
 * marker is read back and used — the rewrite can never move a valid time
 * backwards. A stamp landing between the read and the write makes the write
 * fail its condition, and that is handled the same way. (The window that stays
 * open is the store's own: `ifMatch` is the only atomicity there is.)
 */
async function revocationOf(
  sub: string,
  secret: string,
): Promise<{ revokedAtMs: number; deleteRequestId: string | null } | null> {
  const pathname = revocationPathname(sub, secret);
  const marker = await readRevocationMarker(pathname);
  if (!marker) {
    return null;
  }
  let revokedAtMs = marker.revokedAtMs;
  let deleteRequestId = marker.deleteRequestId;
  let etag = marker.etag;
  if (revokedAtMs === null) {
    revokedAtMs = marker.uploadedAtMs;
    let lostRace = false;
    try {
      // The condition is the store's own current ETag, from `head` — the form
      // `ifMatch` compares against — and only when it is the copy that was
      // read (as removeStaleMarker does). `get`'s header can be written
      // differently (weak, unquoted), and named as the condition it failed
      // every time: the re-read below found the same unreadable marker and the
      // account got a 502 for ever (hunt 3, 2026-10-03).
      let ifMatch: string | undefined;
      if (marker.etag) {
        try {
          const current = (await head(pathname)).etag;
          if (current && etagCore(current) === etagCore(marker.etag)) {
            ifMatch = current;
          } else {
            console.error(`backup marker rewrite etag forms differ: get=${etagShape(marker.etag)} head=${etagShape(current)}`);
            lostRace = true;
          }
        } catch (error) {
          if (!(error instanceof BlobNotFoundError)) {
            throw error;
          }
          // Gone since it was read: the re-read below says so.
          lostRace = true;
        }
      }
      if (!lostRace) {
        await put(
          pathname,
          JSON.stringify({ revokedAtMs, ...(deleteRequestId ? { deleteRequestId } : {}) }),
          { ...REVOCATION_WRITE_OPTIONS, ...(ifMatch ? { ifMatch } : {}) },
        );
        // The copy that was read is gone; whatever is stored now is not it.
        etag = null;
        console.error('backup revocation marker was unreadable: rewritten as revoked at its write time');
      }
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) {
        throw new StoreUnavailable();
      }
      lostRace = true;
    }
    if (lostRace) {
      // Written by someone else since it was read — most likely a deletion's
      // own stamp. Whatever is there now is the answer, never an older time.
      const current = await readRevocationMarker(pathname);
      if (!current) {
        return null;
      }
      if (current.revokedAtMs === null) {
        throw new StoreUnavailable();
      }
      revokedAtMs = current.revokedAtMs;
      deleteRequestId = current.deleteRequestId;
      etag = current.etag;
    }
  }
  if (revokedAtMs + REVOCATION_KEPT_MS < Date.now()) {
    // Removing it is housekeeping, and only of the copy that was read.
    await removeStaleMarker(pathname, etag);
    return null;
  }
  return { revokedAtMs, deleteRequestId };
}

/** The sweep's bounds: pages of 100, at most 5 pages a run, and 1.5 s of the request's time. */
const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 5;
const SWEEP_BUDGET_MS = 1500;
/** The marker look after a write (PUT branch): the same budget as the sweep. */
const POST_WRITE_CHECK_BUDGET_MS = 1500;

/** Removes the markers of a listing that are stale, each one re-read first. */
async function sweepListed(blobs: Array<{ pathname: string; uploadedAt: Date }>): Promise<void> {
  for (const blob of blobs) {
    if (new Date(blob.uploadedAt).getTime() + REVOCATION_KEPT_MS >= Date.now()) {
      continue;
    }
    // Read again before removing: a marker written to this path since the
    // listing (a new deletion of the same account) is not the stale one.
    const marker = await readRevocationMarker(blob.pathname).catch(() => null);
    if (marker && (marker.revokedAtMs ?? marker.uploadedAtMs) + REVOCATION_KEPT_MS < Date.now()) {
      await removeStaleMarker(blob.pathname, marker.etag);
    }
  }
}

/**
 * One run: the first page of the whole listing — which is all of it while there
 * are 100 markers or fewer, the usual case — and, when there are more, the rest
 * of the page budget on a random one of the sixteen hex digits marker names
 * start with, going round. Five pages from the start of the listing each time
 * would never reach a marker past the 500th; started somewhere else each run,
 * every marker is reached over enough runs.
 */
async function sweepRevocations(): Promise<void> {
  const first = await list({ prefix: 'revoked/', limit: SWEEP_PAGE_SIZE });
  await sweepListed(first.blobs);
  if (!first.hasMore) {
    return;
  }
  let pages = 1;
  const start = Math.floor(Math.random() * 16);
  for (let step = 0; step < 16 && pages < SWEEP_MAX_PAGES; step += 1) {
    pages = await sweepPrefix(`revoked/${((start + step) % 16).toString(16)}`, pages);
  }
}

/** Sweeps one prefix by cursor; returns the pages used so far, never past SWEEP_MAX_PAGES. */
async function sweepPrefix(prefix: string, pagesUsed: number): Promise<number> {
  let cursor: string | undefined;
  let pages = pagesUsed;
  while (pages < SWEEP_MAX_PAGES) {
    const result = await list({ prefix, limit: SWEEP_PAGE_SIZE, cursor });
    pages += 1;
    await sweepListed(result.blobs);
    if (!result.hasMore || !result.cursor) {
      return pages;
    }
    cursor = result.cursor;
  }
  return pages;
}

/**
 * Housekeeping on Apple sign-in exchanges only — never on the deletion, whose
 * answer the phone is waiting for under a timeout, and never allowed to fail
 * or hold the request past SWEEP_BUDGET_MS. A marker is removed some time
 * after its 180 days, depending on how often someone signs in.
 */
async function purgeOldRevocations(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sweepRevocations(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SWEEP_BUDGET_MS);
      }),
    ]);
  } catch {
    // Best effort.
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * What the server answers a request carrying its own Apple session. Two
 * refusals are told apart, because the phone signs out on them — the session
 * is over, not wrong: SESSION_REVOKED (the account was deleted) and
 * SESSION_EXPIRED. A session that does not verify at all (a bad mac, a
 * malformed token — which is also what a wrong BACKUP_PATH_SECRET looks like)
 * stays INVALID_TOKEN, which signs nobody out.
 *
 * Test a refusal with `verdict.ok === false`, never `!verdict.ok`: Vercel
 * compiles api/ without `strict`, and there `!` does not narrow this union —
 * the deploy log fills with type errors that only `npm run typecheck:api` shows.
 */
type SessionVerdict =
  | { ok: true; sub: string }
  | { ok: false; error: 'INVALID_TOKEN' | 'SESSION_EXPIRED' }
  // `deleteRequestId`: the Delete account request behind the marker, when it carried one.
  | { ok: false; error: 'SESSION_REVOKED'; deleteRequestId: string | null };

/** The 401 body for a refused session: the revoking request's id rides along, and nothing else. */
function refusalBody(verdict: Extract<SessionVerdict, { ok: false }>): Record<string, unknown> {
  // Always present on SESSION_REVOKED, null when the marker names no request:
  // a phone tells 'this server says no id' apart from an older server that
  // never says, and only the latter falls back to its own pending record.
  return verdict.error === 'SESSION_REVOKED'
    ? { ok: false, error: verdict.error, deleteRequestId: verdict.deleteRequestId ?? null }
    : { ok: false, error: verdict.error };
}

const INVALID_SESSION: Extract<SessionVerdict, { ok: false }> = { ok: false, error: 'INVALID_TOKEN' };

async function verifyAppleSession(token: string, pathSecret: string): Promise<SessionVerdict> {
  const [payload, mac, extra] = token.slice(APPLE_SESSION_PREFIX.length).split('.');
  if (!payload || !mac || extra !== undefined) {
    return INVALID_SESSION;
  }
  const expected = createHmac('sha256', appleSessionKey(pathSecret)).update(payload).digest('base64url');
  if (!sameText(mac, expected)) {
    return INVALID_SESSION;
  }
  const claims = decodeSegment<{ sub?: string; iat?: number; iatMs?: number; exp?: number }>(payload);
  if (!claims || typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number') {
    return INVALID_SESSION;
  }
  if (claims.exp * 1000 < Date.now()) {
    return { ok: false, error: 'SESSION_EXPIRED' };
  }
  const sub = `apple:${claims.sub}`;
  // Ended by an account deletion since it was issued? A session is otherwise
  // good for 180 days and renews itself, so without this nothing stops it.
  const issuedAtMs =
    typeof claims.iatMs === 'number'
      ? claims.iatMs
      : typeof claims.iat === 'number'
        ? claims.iat * 1000
        : (claims.exp - APPLE_SESSION_DAYS * 24 * 60 * 60) * 1000;
  const revocation = await revocationOf(sub, pathSecret);
  if (revocation !== null && issuedAtMs <= revocation.revokedAtMs) {
    return { ok: false, error: 'SESSION_REVOKED', deleteRequestId: revocation.deleteRequestId };
  }
  return { ok: true, sub };
}

/**
 * An Apple identity token is good for ten minutes and for as many exchanges as
 * anyone cares to make, so one issued before a Delete account would otherwise
 * buy a fresh 180-day session after it. Refused when the token could have been
 * issued before the marker: `iat` is whole seconds, so the latest moment it can
 * be is the end of that second. A new sign-in's token is a later second, or the
 * same second as a marker stamped within it, and passes.
 */
async function appleIdentityRevoked(
  apple: { sub: string; iat: number },
  pathSecret: string,
): Promise<Extract<SessionVerdict, { ok: false }> | null> {
  const revocation = await revocationOf(`apple:${apple.sub}`, pathSecret);
  if (revocation !== null && (apple.iat + 1) * 1000 <= revocation.revokedAtMs) {
    return { ok: false, error: 'SESSION_REVOKED', deleteRequestId: revocation.deleteRequestId };
  }
  return null;
}

/** Deterministic, unguessable pathname for one account's backup. */
function backupPathname(sub: string, secret: string): string {
  return `backups/${createHmac('sha256', secret).update(sub).digest('hex')}.json`;
}

/** The header a versioned write names the copy it replaces with. */
const EXPECTED_VERSION_HEADER = 'x-backup-expected-version';
/** Its value for "there is no copy yet": the first backup of an account. */
const NO_COPY = 'none';

/**
 * The copy a write says it replaces: undefined when it says nothing (a build
 * from before versions), NO_COPY, a version, or null for a value that is not
 * one — an ETag is short and printable, and this one ends up in a header.
 */
function expectedVersion(req: ApiRequest): string | null | undefined {
  const header = req.headers[EXPECTED_VERSION_HEADER];
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === '') {
    return undefined;
  }
  return value.length <= 200 && /^[\x21-\x7e]+$/.test(value) ? value : null;
}

/**
 * The version of the stored copy, or null when there is none.
 *
 * Read with `head` because its ETag comes from the same API as the one `put`
 * returns and `ifMatch` compares against; `get`'s comes from the content
 * response's own header, and a format difference between the two would read
 * as a conflict on every write after a restore.
 */
async function storedVersion(pathname: string): Promise<string | null> {
  try {
    const meta = await head(pathname);
    return meta.etag || null;
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    throw error;
  }
}

function bearerToken(req: ApiRequest): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return null;
  }
  const token = value.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  // The web deletion page (lib/webAccountDeletion): its DELETE and the
  // browser's preflight for it, and nothing else, carry CORS headers. First,
  // so a refusal below still reaches the page as a status it can read.
  const cors = webDeletionCorsHeaders(req.headers.origin, req.method);
  for (const [name, value] of Object.entries(cors ?? {})) {
    res.setHeader(name, value);
  }
  if (req.method === 'OPTIONS') {
    res.status(cors ? 204 : 405).end();
    return;
  }
  // The kill switch (docs/tietoturvaloukkaus.md): first, before anything is
  // read, parsed or written. api/notice stays open to say why. Deleting stays
  // open too: the policy promises the copy goes at once, and during an
  // incident it is the one request a reader most needs to land.
  if (isServicePaused(process.env) && req.method !== 'DELETE') {
    res.status(503).json(servicePausedBody());
    return;
  }
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const pathSecret = process.env.BACKUP_PATH_SECRET;
  if (!clientId || !pathSecret) {
    res.status(500).json({ ok: false, error: 'MISSING_SERVER_CONFIG' });
    return;
  }

  if (isRateLimited(getIpAddress(req))) {
    res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    return;
  }

  // Only a write is refused to a build older than APP_MIN_VERSION_<platform>:
  // the shape it writes is what the server may no longer read. Reading your
  // own backup back and deleting it work from any build (lib/appUpdateGate).
  if ((req.method === 'PUT' || req.method === 'POST') && isAppVersionRefused(req.headers, process.env)) {
    res.status(426).json(appUpdateRefusalBody(req.headers, process.env));
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'MISSING_TOKEN' });
    return;
  }

  const actionHeader = req.headers[ACTION_HEADER];
  const action = Array.isArray(actionHeader) ? actionHeader[0] : actionHeader;
  if (action === APPLE_RENEW_ACTION) {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let current: SessionVerdict = INVALID_SESSION;
    try {
      current = token.startsWith(APPLE_SESSION_PREFIX) ? await verifyAppleSession(token, pathSecret) : INVALID_SESSION;
    } catch (error) {
      if (error instanceof StoreUnavailable) {
        console.error('backup revocation record unreadable');
        res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
        return;
      }
    }
    if (current.ok === false) {
      res.status(401).json(refusalBody(current));
      return;
    }
    const renewed = issueAppleSession(current.sub.slice('apple:'.length), pathSecret);
    // A second look just before answering. An account deleted while this
    // request was between its first look and here has its marker written by
    // now, and the session being renewed is older than it — the new one is
    // issued after the marker's time and would survive it. What is left is a
    // delete whose marker lands after this look, within milliseconds.
    try {
      current = await verifyAppleSession(token, pathSecret);
    } catch (error) {
      if (error instanceof StoreUnavailable) {
        console.error('backup revocation record unreadable');
        res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
        return;
      }
      current = INVALID_SESSION;
    }
    if (current.ok === false) {
      res.status(401).json(refusalBody(current));
      return;
    }
    res.status(200).json({ ok: true, ...renewed });
    return;
  }
  if (action === APPLE_SESSION_ACTION) {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let apple: { sub: string; iat: number } | null = null;
    try {
      apple = await verifyAppleIdentityToken(token, (process.env.APPLE_BUNDLE_ID ?? '').trim() || 'app.vinha');
    } catch {
      apple = null;
    }
    if (!apple) {
      console.error('backup INVALID_APPLE_TOKEN');
      res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
      return;
    }
    // Not a token Apple issued before this account was deleted (see appleIdentityRevoked).
    try {
      const revoked = await appleIdentityRevoked(apple, pathSecret);
      if (revoked) {
        console.error('backup SESSION_REVOKED (identity token older than the account deletion)');
        res.status(401).json(refusalBody(revoked));
        return;
      }
    } catch (error) {
      if (error instanceof StoreUnavailable) {
        console.error('backup revocation record unreadable');
        res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
        return;
      }
      throw error;
    }
    await purgeOldRevocations();
    res.status(200).json({ ok: true, ...issueAppleSession(apple.sub, pathSecret) });
    return;
  }

  let identity: VerifiedIdentity | null = null;
  let refusal = INVALID_SESSION;
  try {
    if (token.startsWith(APPLE_SESSION_PREFIX)) {
      const verdict = await verifyAppleSession(token, pathSecret);
      identity = verdict.ok ? { sub: verdict.sub } : null;
      if (verdict.ok === false) {
        refusal = verdict;
      }
    } else {
      identity = await verifyGoogleIdToken(token, clientId);
    }
  } catch (error) {
    // A store that cannot answer is not a sign-in that failed: a 401 here
    // signs the phone out, a 502 is tried again.
    if (error instanceof StoreUnavailable) {
      console.error('backup revocation record unreadable');
      res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
      return;
    }
    identity = null;
  }
  if (!identity) {
    console.error(`backup ${refusal.error}`);
    res.status(401).json(refusalBody(refusal));
    return;
  }

  const pathname = backupPathname(identity.sub, pathSecret);

  try {
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
      if (!body || body === 'null') {
        res.status(400).json({ ok: false, error: 'EMPTY_PAYLOAD' });
        return;
      }
      if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'PAYLOAD_TOO_LARGE', maxBytes: MAX_BYTES });
        return;
      }
      const expected = expectedVersion(req);
      if (expected === null) {
        res.status(400).json({ ok: false, error: 'BAD_VERSION' });
        return;
      }
      const options = { access: 'private' as const, contentType: 'application/json', addRandomSuffix: false };
      let written;
      try {
        written =
          expected === undefined
            ? await put(pathname, body, { ...options, allowOverwrite: true })
            : expected === NO_COPY
              ? await put(pathname, body, { ...options, allowOverwrite: false })
              : await put(pathname, body, { ...options, allowOverwrite: true, ifMatch: expected });
      } catch (error) {
        // The store names a lost race two ways: a version that no longer
        // matches, and a copy that has gone since it was read. A first write
        // refused because a copy exists comes back as a plain error, so for
        // that one the store is asked whether a copy is there now — anything
        // else is a storage failure, and the outer catch says so.
        const conflict =
          expected === undefined
            ? false
            : error instanceof BlobPreconditionFailedError ||
              (expected === NO_COPY
                ? (await storedVersion(pathname).catch(() => null)) !== null
                : error instanceof BlobNotFoundError);
        if (!conflict) {
          throw error;
        }
        // The copy the store holds now rides along, so a phone whose own
        // write was retried by the SDK after the first attempt had already
        // committed (and so fails against its own copy) can recognise it.
        // `null` means there is truly no copy; when the store cannot say,
        // the field is left out rather than claiming that.
        const body: { ok: false; error: 'BACKUP_CHANGED'; version?: string | null } = { ok: false, error: 'BACKUP_CHANGED' };
        try {
          body.version = await storedVersion(pathname);
        } catch {
          // Unknown: no `version`.
        }
        res.status(412).json(body);
        return;
      }
      // An Apple session that passed its check before Delete account landed
      // can write after it, and a first backup (`none`) or a write from a
      // build before versions asks the store for nothing that would stop it:
      // the deleted account's copy came back. So the record is looked at once
      // more now that the write is done, and the copy just written is taken
      // away again — only that copy (its own ETag), never a newer one written
      // since. Answered as every other request of a revoked session is. A
      // record that cannot be read here leaves the write standing: the check
      // before it passed, and the next request meets the store's answer.
      if (token.startsWith(APPLE_SESSION_PREFIX)) {
        let again: SessionVerdict | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Bounded like the sweep: the write has landed, so a store that
          // hangs on the record must not hold the answer. A timeout is
          // "unreadable" — the write stands.
          again = await Promise.race([
            // Caught here, not only by the try: a look that fails after the
            // timer has won would otherwise be an unhandled rejection, which
            // Node turns into a crash of the function.
            verifyAppleSession(token, pathSecret).catch(() => null),
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), POST_WRITE_CHECK_BUDGET_MS);
            }),
          ]);
        } catch {
          again = null;
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
        if (again && again.ok === false && again.error === 'SESSION_REVOKED') {
          if (written.etag) {
            try {
              await del(pathname, { ifMatch: written.etag });
            } catch (error) {
              // Written over since (not ours any more), already gone, or the store
              // cannot say: the answer is the same, and the log says which kind.
              console.error('backup write after account deletion could not be taken back:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
            }
          } else {
            // No ETag to name: an unconditional delete could remove a copy a
            // newer session wrote since, so nothing is taken back.
            console.error(`backup write after account deletion left in place: no etag (${typeof written.etag})`);
          }
          console.error('backup SESSION_REVOKED (revoked while its write was in flight)');
          res.status(401).json(refusalBody(again));
          return;
        }
      }
      // Success is reported only after the store accepted the write — the
      // same rule the app applies to saved workouts.
      res.status(200).json({ ok: true, savedAt: new Date().toISOString(), version: written.etag || null });
      return;
    }

    if (req.method === 'GET') {
      let stored;
      let version: string | null;
      try {
        // The version first, then the copy. The other way round, a write
        // landing between the two reads would pair the new version with the
        // old content, and a phone holding that pair could replace a copy it
        // never saw. This way round the worst is an old version with the new
        // content, which the phone's next write names wrongly and is refused.
        version = await storedVersion(pathname);
        stored = await get(pathname, { access: 'private', useCache: false });
      } catch (error) {
        // `get` answers a missing blob with null and throws for everything
        // else — a 403, a 5xx, the network. Those used to become NO_BACKUP,
        // and the app treats NO_BACKUP as "upload this phone's data as the
        // first backup": a new phone signing in during a storage blip wrote
        // its empty database over the reader's whole history.
        console.error('backup GET failed', error);
        res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
        return;
      }
      if (!stored || stored.statusCode !== 200) {
        res.status(404).json({ ok: false, error: 'NO_BACKUP' });
        return;
      }
      const payload = await new Response(stored.stream).text();
      res.setHeader('content-type', 'application/json');
      res.status(200).end(JSON.stringify({ ok: true, payload: JSON.parse(payload), version }));
      return;
    }

    if (req.method === 'DELETE') {
      try {
        await del(pathname);
      } catch (error) {
        // Already gone is the outcome the caller asked for (the store does
        // not throw for a missing blob, but should it, that is still done).
        // Anything else — auth, a 5xx, the network — used to be swallowed
        // here too, and the app told the reader the copy was gone while it
        // was still on the server.
        if (!(error instanceof BlobNotFoundError)) {
          console.error('backup DELETE failed:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
          res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
          return;
        }
      }
      // Deleting the account, not just the copy: the Apple sessions this
      // server has issued for it are refused from now on, this phone's
      // included. (A phone holding one learns of it at its next request, when
      // the 401 SESSION_REVOKED signs it out — useAccountBackup.) Written
      // AFTER the copy is gone, so a failure here leaves the session alive and
      // the reader able to ask again — the other order would lock them out of
      // a copy they were deleting. A Google account has no session of ours to
      // end (Google's token is checked with Google on every request).
      if (action === DELETE_ACCOUNT_ACTION && identity.sub.startsWith('apple:')) {
        try {
          const marker = revocationPathname(identity.sub, pathSecret);
          const requestHeader = req.headers[DELETE_REQUEST_ID_HEADER];
          const requestId = (Array.isArray(requestHeader) ? requestHeader[0] : requestHeader)?.trim();
          const stamp = () =>
            JSON.stringify({
              revokedAtMs: Date.now(),
              ...(requestId && DELETE_REQUEST_ID.test(requestId) ? { deleteRequestId: requestId } : {}),
            });
          await put(marker, stamp(), REVOCATION_WRITE_OPTIONS);
          // Written again with the time the first write RETURNED. The first
          // is stamped before the store has it, so a renewal that was minted
          // and checked while that write was in flight outlives it; anything
          // minted before this second stamp is refused by it, and the
          // renewal's second look sees at least the first.
          await put(marker, stamp(), REVOCATION_WRITE_OPTIONS);
        } catch (error) {
          console.error('backup revocation failed:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
          res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
          return;
        }
        // The copy once more, now that the sessions are refused. A write that
        // had passed its check before the first stamp can land between the
        // first delete and here (a first backup, or a build from before
        // versions, names no copy to fail against); one that lands after the
        // stamps takes itself back (the PUT branch). Failing is a 502 as at
        // the first delete. Unconditional on purpose: a brand-new session (one
        // issued after the second stamp) could write a copy in the
        // milliseconds before this delete and lose it. That is accepted — the
        // reader has just deleted the account, a sign-in and a first backup
        // inside those milliseconds is not a real sequence, and the copy that
        // would be kept instead is the resurrected one the reader asked to
        // have gone. A conditional delete cannot tell the two apart without
        // the ETag of the copy that was there, which is not known here.
        try {
          await del(pathname);
        } catch (error) {
          if (!(error instanceof BlobNotFoundError)) {
            console.error('backup DELETE failed:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
            res.status(502).json({ ok: false, error: 'STORE_UNAVAILABLE' });
            return;
          }
        }
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    // No payloads, no token contents — a storage failure is reported as a
    // plain code plus the store's own message, which names auth and config
    // problems without ever containing user data.
    console.error('backup STORAGE_FAILED:', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    res.status(502).json({ ok: false, error: 'STORAGE_FAILED' });
  }
}
