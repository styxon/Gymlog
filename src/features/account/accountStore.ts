/**
 * The signed-in account record — device identity, not user data.
 *
 * Deliberately its own AsyncStorage key rather than a field on AppDatabase:
 * the database is what gets backed up and restored, and the account is the
 * thing doing the backing up. Restoring a backup onto a new phone must not
 * un-sign-in the person who just signed in to fetch it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isDeleteRequestId } from '../../lib/accountBackup';
import { isIsoDateString } from '../../lib/isoDate';

const STORAGE_KEY = '@vinha/account/v1';

export interface StoredAccount {
  sub: string;
  email: string | null;
  name: string | null;
  lastBackupAt: string | null;
  /**
   * How much of the log the cloud copy held when this phone last wrote or read
   * it (countBackupItems). The automatic backup compares against it so a phone
   * that has lost its log does not quietly replace the copy that still has it.
   * Null when unknown (an account stored before this was kept).
   */
  lastBackupItemCount: number | null;
  /**
   * The same for the workout history (countHistoryItems), which is set aside
   * on its own when it cannot be read and was not counted above. Null when
   * unknown: an account stored before it was kept looks at the copy once.
   */
  lastBackupHistoryCount: number | null;
  /**
   * accountBackupFingerprint of the data this phone last uploaded or
   * restored. The automatic backup runs while the data differs from it, so an
   * edit is backed up and a failed upload is tried again — the counts it used
   * to watch missed the first and marked the second done before it happened.
   * Null when unknown (one upload settles it).
   */
  lastBackupFingerprint: string | null;
  /**
   * True after "Delete cloud backup": the automatic backup stays out until
   * the reader backs up themselves, or signs in again.
   */
  autoBackupPaused: boolean;
  /**
   * The version (the server's ETag) of the cloud copy this phone last wrote
   * or restored: the one copy its next upload may replace. The server refuses
   * a write naming any other, so a second phone on the account can no longer
   * overwrite what the first one wrote (server audit, 2026-09-21). Null when
   * unknown — never synced, stored by an older build, or a server that does
   * not send versions yet — and then the next backup reads the copy first.
   */
  cloudVersion: string | null;
  /**
   * Set (to the time) when the cloud copy this phone last wrote or restored was
   * found gone: deleted on the web page or from another phone. The automatic
   * backup holds (autoBackupPaused), the row says the copy was deleted, and
   * "Back up now" asks before it makes a new one — re-uploading the whole
   * history as a first backup without a word undid the deletion the reader had
   * just made (bug hunt 5, 2026-10-03). Cleared by any upload or restore that lands.
   */
  cloudCopyDeletedAt?: string | null;
  /**
   * Set (to the time) just before this phone sends "Delete account", and
   * cleared by any answer that settles it. A phone that still has it later
   * meets "session ended" knowing why: its own delete went through and the
   * answer was lost, so the account IS deleted. A phone without it meets the
   * same answer because the account was deleted elsewhere, and says that.
   */
  deleteAccountPendingAt?: string | null;
  /**
   * The random id (128 bits, hex) this phone's "Delete account" request
   * carries, kept with the pending record. The server writes it into the
   * revocation marker and hands it back with SESSION_REVOKED, so a retry can
   * tell its own delete (same id) from one another phone made (another id).
   */
  deleteRequestId?: string | null;
  /**
   * accountBackupFingerprint of the data the latest uploads (newest first, at
   * most three) were made of, written BEFORE each request goes out and cleared
   * once an answer settles which copy the cloud holds. An upload can land while
   * its answer is lost; the copy that is then one version ahead of this phone
   * is recognised by it, also after a restart.
   */
  uploadInFlightFingerprints?: string[];
}

/** The stored record, repaired: an account written by an older build lacks the newer fields. */
export function normalizeStoredAccount(parsed: Partial<StoredAccount> | null | undefined): StoredAccount | null {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.sub !== 'string' || !parsed.sub) {
    return null;
  }
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  return {
    sub: parsed.sub,
    email: typeof parsed.email === 'string' ? parsed.email : null,
    name: typeof parsed.name === 'string' ? parsed.name : null,
    lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
    lastBackupItemCount: count(parsed.lastBackupItemCount),
    lastBackupHistoryCount: count(parsed.lastBackupHistoryCount),
    lastBackupFingerprint:
      typeof parsed.lastBackupFingerprint === 'string' && parsed.lastBackupFingerprint ? parsed.lastBackupFingerprint : null,
    autoBackupPaused: parsed.autoBackupPaused === true,
    // Absent on every account stored before versions were kept: unknown,
    // which reads the copy once rather than trusting a version never seen.
    cloudVersion: typeof parsed.cloudVersion === 'string' && parsed.cloudVersion ? parsed.cloudVersion : null,
    ...(isIsoDateString(parsed.deleteAccountPendingAt) ? { deleteAccountPendingAt: parsed.deleteAccountPendingAt } : {}),
    ...(isDeleteRequestId(parsed.deleteRequestId) ? { deleteRequestId: parsed.deleteRequestId } : {}),
    ...(isIsoDateString(parsed.cloudCopyDeletedAt) ? { cloudCopyDeletedAt: parsed.cloudCopyDeletedAt } : {}),
    ...(Array.isArray(parsed.uploadInFlightFingerprints) &&
    parsed.uploadInFlightFingerprints.some((entry) => typeof entry === 'string' && entry)
      ? {
          uploadInFlightFingerprints: parsed.uploadInFlightFingerprints
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
            .slice(0, 3),
        }
      : {}),
  };
}

export async function loadStoredAccount(): Promise<StoredAccount | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeStoredAccount(JSON.parse(raw) as Partial<StoredAccount>);
  } catch {
    return null;
  }
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export async function clearStoredAccount(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * The accounts this phone has been signed out of since its data was last
 * settled. Sign-out keeps the local data, so the next sign-in may be someone
 * else — a second Google account, a shared phone — and that data is not
 * theirs to have backed up unasked (lib/accountBackup uploadNeedsConsent).
 * Forgotten once a sign-in has settled whose the data is.
 *
 * Every account, not the last one. One mark could say only one owner, and the
 * phone can hold several: A signed out, B logged a workout offline and signed
 * out, and A coming back counted as "the same account" and sent B's workout
 * to A's cloud (the account-switch invariant test, 2026-09-28).
 */
const SIGNED_OUT_KEY = '@vinha/account/signedout/v1';

/**
 * Stands for "somebody, I cannot tell who": the list could not be read, or what
 * was there is not a list. It is no account's own, so every sign-in meets it as
 * another account's data on the phone and is asked first — the safe way to be
 * wrong. Gone with the rest of the list once a sign-in settles whose the data is.
 * (The old reading, "nobody", skipped the account-switch question altogether
 * on a bad read; audit 2026-10-03.)
 */
export const UNKNOWN_SIGNED_OUT_ACCOUNT = '?unknown';

/** Throws when AsyncStorage cannot be read; an unreadable or malformed row reads as unknown. */
async function readSignedOutAccounts(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(SIGNED_OUT_KEY);
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  // A build from earlier the same day stored one bare identifier — a
  // Google account id, digits and nothing else JSON would start with.
  if (/^[A-Za-z0-9._-]+$/.test(raw)) {
    return [raw];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [UNKNOWN_SIGNED_OUT_ACCOUNT];
    }
    const subs = parsed.filter((sub): sub is string => typeof sub === 'string' && sub.length > 0);
    return subs.length === 0 && parsed.length > 0 ? [UNKNOWN_SIGNED_OUT_ACCOUNT] : subs;
  } catch {
    return [UNKNOWN_SIGNED_OUT_ACCOUNT];
  }
}

/**
 * Adds an account to the list. A list that cannot be read is not rewritten
 * from nothing — that dropped every account already on it — so this throws and
 * the caller decides; the entries stay as they were.
 */
export async function rememberSignedOutAccount(sub: string): Promise<void> {
  const known = await readSignedOutAccounts();
  if (!known.includes(sub)) {
    await AsyncStorage.setItem(SIGNED_OUT_KEY, JSON.stringify([...known, sub]));
  }
}

/** Never throws: what cannot be read is reported as UNKNOWN_SIGNED_OUT_ACCOUNT, which asks. */
export async function loadSignedOutAccounts(): Promise<string[]> {
  try {
    return await readSignedOutAccounts();
  } catch {
    return [UNKNOWN_SIGNED_OUT_ACCOUNT];
  }
}

export async function forgetSignedOutAccount(): Promise<void> {
  await AsyncStorage.removeItem(SIGNED_OUT_KEY);
}
