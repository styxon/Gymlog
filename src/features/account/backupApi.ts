/**
 * The app's side of the backup endpoint. Thin on purpose: identity comes from
 * accountAuth, the payload shape from lib/accountBackup, and this file only
 * moves bytes. Configured by EXPO_PUBLIC_BACKUP_API_URL; without it the
 * feature is absent, same rule as the coach URL.
 */
import type { AccountBackupPayload } from '../../lib/accountBackup';
import { decodeAccountBackupBody, encodeAccountBackupBodyAsync, parseAccountBackupPayload } from '../../lib/accountBackup';
import { appVersionHeaders, noteServerAnswer } from '../appUpdate/appUpdateSignal';

const BACKUP_API_URL = (process.env.EXPO_PUBLIC_BACKUP_API_URL ?? '').trim();
const REQUEST_TIMEOUT_MS = 20000;

export function isBackupApiConfigured(): boolean {
  return BACKUP_API_URL.length > 0;
}

/**
 * The server's answer to an upload that named a copy the cloud no longer
 * holds: another phone on the account wrote since this one last did, and
 * nothing was written (api/backup.ts, "Versions").
 */
export const BACKUP_CHANGED = 'BACKUP_CHANGED';

/** `version` is the cloud copy's ETag; null from a server that does not send one yet. */
export type BackupUploadResult = { ok: true; savedAt: string; version: string | null } | { ok: false; error: string };
export type BackupDownloadResult =
  | { ok: true; payload: AccountBackupPayload; version: string | null }
  | { ok: false; error: 'NO_BACKUP' | string };

function versionOf(body: { version?: unknown }): string | null {
  return typeof body.version === 'string' && body.version ? body.version : null;
}

/** A macrotask turn: touches and frames get their go before the next stretch of encoding. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function withTimeout(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

/**
 * Writes the backup over the copy this phone knows, and no other.
 *
 * `expectedVersion` is the version of the cloud copy this phone last wrote or
 * restored, or null when it knows there is none (the first backup). The
 * server refuses the write when the cloud holds anything else, and this
 * answers BACKUP_CHANGED — the caller asks the reader instead of overwriting.
 */
export async function uploadBackup(
  idToken: string,
  payload: AccountBackupPayload,
  expectedVersion: string | null,
): Promise<BackupUploadResult> {
  if (!BACKUP_API_URL) {
    return { ok: false, error: 'NOT_CONFIGURED' };
  }
  // Compressed once the history is large; see ACCOUNT_BACKUP_COMPRESS_ABOVE_CHARS.
  // Done in stretches that let the UI run, and BEFORE the timeout starts, so
  // the time it takes is not taken from the network's.
  let body: string;
  try {
    body = await encodeAccountBackupBodyAsync(payload, yieldToUi);
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
  const { signal, cleanup } = withTimeout();
  try {
    const response = await fetch(BACKUP_API_URL, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${idToken}`,
        'x-backup-expected-version': expectedVersion ?? 'none',
        ...appVersionHeaders(),
      },
      body,
      signal,
    });
    const answer = (await response.json()) as { ok?: boolean; savedAt?: string; error?: string; version?: unknown };
    noteServerAnswer(response.status, answer);
    if (response.ok && answer.ok && typeof answer.savedAt === 'string') {
      return { ok: true, savedAt: answer.savedAt, version: versionOf(answer) };
    }
    // Only the server's own answer: a 412 from anything else is not a copy
    // another phone wrote, and must not start the restore-or-keep question.
    if (response.status === 412 && answer.error === BACKUP_CHANGED) {
      return { ok: false, error: BACKUP_CHANGED };
    }
    return { ok: false, error: answer.error ?? `HTTP_${response.status}` };
  } catch {
    return { ok: false, error: 'NETWORK' };
  } finally {
    cleanup();
  }
}

export async function downloadBackup(idToken: string): Promise<BackupDownloadResult> {
  if (!BACKUP_API_URL) {
    return { ok: false, error: 'NOT_CONFIGURED' };
  }
  const { signal, cleanup } = withTimeout();
  try {
    const response = await fetch(BACKUP_API_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${idToken}`, ...appVersionHeaders() },
      signal,
    });
    const body = (await response.json()) as { ok?: boolean; payload?: unknown; error?: string; version?: unknown };
    noteServerAnswer(response.status, body);
    // Only the server's own answer, never any 404: "no backup" makes the app
    // upload this phone's data as the first one, over whatever is really there.
    if (response.status === 404 && body.error === 'NO_BACKUP') {
      return { ok: false, error: 'NO_BACKUP' };
    }
    if (response.ok && body.ok) {
      const parsed = parseAccountBackupPayload(decodeAccountBackupBody(body.payload));
      if (parsed) {
        return { ok: true, payload: parsed, version: versionOf(body) };
      }
      return { ok: false, error: 'UNRECOGNIZED_PAYLOAD' };
    }
    return { ok: false, error: body.error ?? `HTTP_${response.status}` };
  } catch {
    return { ok: false, error: 'NETWORK' };
  } finally {
    cleanup();
  }
}

/**
 * Deletes the cloud copy. With `account: true` the server also ends the Apple
 * sessions it has issued for the account, this phone's included
 * (api/backup.ts, `delete-account`); without it the reader stays signed in.
 */
export async function deleteBackup(
  idToken: string,
  options: { account?: boolean; requestId?: string } = {},
): Promise<{ ok: boolean; error?: string; definite?: boolean; deleteRequestId?: string | null }> {
  if (!BACKUP_API_URL) {
    return { ok: false };
  }
  const { signal, cleanup } = withTimeout();
  try {
    const response = await fetch(BACKUP_API_URL, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(options.account ? { 'x-backup-action': 'delete-account' } : {}),
        // Lets the server say, when it later turns this phone away because the
        // account is gone, whether the delete that did it was this phone's.
        ...(options.account && options.requestId ? { 'x-delete-request-id': options.requestId } : {}),
        ...appVersionHeaders(),
      },
      signal,
    });
    // The server's own yes, not just a 2xx from whatever answered.
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      deleteRequestId?: unknown;
    } | null;
    noteServerAnswer(response.status, body);
    // The server turning the sign-in itself away — SESSION_REVOKED, SESSION_EXPIRED
    // or INVALID_TOKEN; the hook signs an Apple session out on the first two — is
    // told apart from a store that could not answer.
    // `definite`: the server itself answered — its own JSON, a boolean `ok` or
    // an `error` code — and it was not a failure of its own (a 4xx). A 5xx, no
    // answer at all, a page that is not the server's (a captive portal), and
    // a 429 (the rate limit answers before the request is read) leave it open
    // whether the delete went through, which is what "Delete account" has to
    // remember. A 401 with the server's code is the server's own answer.
    if (response.status === 401 && typeof body?.error === 'string') {
      return {
        ok: false,
        error: body.error,
        definite: true,
        // A present null is this server saying the marker names no request.
        ...(typeof body.deleteRequestId === 'string' && body.deleteRequestId
          ? { deleteRequestId: body.deleteRequestId }
          : body.deleteRequestId === null
            ? { deleteRequestId: null }
            : {}),
      };
    }
    const serverJson = typeof body?.ok === 'boolean' || typeof body?.error === 'string';
    return {
      ok: response.ok && body?.ok === true,
      ...(response.status < 500 && response.status !== 429 && serverJson ? { definite: true } : {}),
    };
  } catch {
    return { ok: false };
  } finally {
    cleanup();
  }
}

export type AppleSessionResult = { ok: true; sessionToken: string; expiresAt: string } | { ok: false };

/**
 * Trades a ten-minute Apple identity token for the server's Apple session,
 * which the backup calls then carry instead (api/backup.ts, Sign in with Apple).
 */
export async function exchangeAppleSession(identityToken: string): Promise<AppleSessionResult> {
  return requestAppleSession(identityToken, 'apple-session');
}

/** Trades a still-valid Apple session for a fresh one before it runs out. */
export async function renewAppleSession(sessionToken: string): Promise<AppleSessionResult> {
  return requestAppleSession(sessionToken, 'apple-renew');
}

async function requestAppleSession(bearer: string, action: 'apple-session' | 'apple-renew'): Promise<AppleSessionResult> {
  if (!BACKUP_API_URL) {
    return { ok: false };
  }
  const { signal, cleanup } = withTimeout();
  try {
    const response = await fetch(BACKUP_API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'x-backup-action': action, ...appVersionHeaders() },
      signal,
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; sessionToken?: unknown; expiresAt?: unknown } | null;
    noteServerAnswer(response.status, body);
    if (!response.ok || body?.ok !== true || typeof body.sessionToken !== 'string' || typeof body.expiresAt !== 'string') {
      return { ok: false };
    }
    return { ok: true, sessionToken: body.sessionToken, expiresAt: body.expiresAt };
  } catch {
    return { ok: false };
  } finally {
    cleanup();
  }
}
