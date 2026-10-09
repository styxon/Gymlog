/**
 * Sign in, back up, restore — the whole account feature behind one hook,
 * instantiated once in App.tsx.
 *
 * Truthfulness rules, same as saved workouts:
 * - "Backed up" is only reported after the server accepted the write.
 * - A restore only replaces local data after the payload parsed and the
 *   providers committed it — the workout history included.
 * - When both the phone and the cloud hold data, nobody's copy is destroyed
 *   without the reader choosing (`SignInOutcome.choice`).
 * - Sign-out (and Reset, which signs out first) ends whatever was still
 *   running: nothing that was in flight may sign the account back in, or
 *   restore onto a phone that has just been emptied.
 *
 * The ID token is short-lived, so background backups fetch a fresh one via
 * silent sign-in. Only Google's "no saved credential" downgrades the account
 * to signed-out; offline is a backup that failed, and is tried again.
 *
 * Every upload names the cloud copy it replaces — the version this phone last
 * wrote or restored (`cloudVersion`), or none for a first backup — and the
 * server refuses it when the cloud holds another. Two phones on one account
 * used to overwrite each other that way, older data included (server audit,
 * 2026-09-21). A refusal is the look this phone would have done had it known:
 * the reader is asked restore-or-keep, or, when nobody is there to ask,
 * nothing is written.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { AppDatabase } from '../../types/models';
import type { WorkoutHistoryStore } from '../workout/workoutTypes';
import {
  AccountBackupPayload,
  AccountBackupSummary,
  accountBackupFingerprint,
  BackupContents,
  BackupLookResult,
  buildAccountBackupPayload,
  countBackup,
  countBackupContents,
  decideAfterLook,
  describeAccountBackup,
  describeRestoreChoice,
  backupWouldShrink,
  hasLocalDataWorthKeeping,
  isCloudCopyThisPhones,
  isCopyPhonesOwnWork,
  isDeleteRequestId,
  phoneDataIsInCopy,
  planBackup,
  RestoreChoiceSummary,
  revokedDeleteOutcome,
  syncCounts,
  uploadNeedsConsent,
} from '../../lib/accountBackup';
import { randomHex } from '../../lib/aiCoachLogId';
import { AUTO_BACKUP_PACING, EMPTY_PACING, notePacingSent, pacingWaitMs, type PacingState } from '../../lib/requestPacing';
import { reportOperationFailed } from '../errorReporting/errorReporter';
import {
  BACKUP_CHANGED,
  BackupDownloadResult,
  deleteBackup,
  downloadBackup,
  isBackupApiConfigured,
  uploadBackup,
} from './backupApi';
import type { SignInProvider } from './accountAuth';
import {
  availableSignInProviders,
  getFreshIdToken,
  isAccountSignInConfigured,
  renewSessionIfDue,
  signInWith,
  signOutAccount,
} from './accountAuth';
import {
  clearStoredAccount,
  forgetSignedOutAccount,
  loadSignedOutAccounts,
  loadStoredAccount,
  rememberSignedOutAccount,
  saveStoredAccount,
  StoredAccount,
} from './accountStore';

export type AccountBackupPhase = 'idle' | 'signing_in' | 'backing_up' | 'restoring' | 'deleting';

export interface AccountBackupState {
  /** 'unavailable' — this build has no sign-in configured; show nothing. */
  status: 'unavailable' | 'loading' | 'signed_out' | 'signed_in';
  email: string | null;
  name: string | null;
  lastBackupAt: string | null;
  /** Whose sign-in this is, for wording that only fits one (null when signed out). */
  provider: 'google' | 'apple' | null;
  /**
   * Why the automatic backup is standing still until the reader decides with
   * "Back up now", or null when it is not. 'other_phone': the cloud copy
   * changed on another phone since this one last saw it. 'smaller_phone': this
   * phone holds far less than the cloud copy (the shrink guard). The row says
   * so — a green timestamp over backups that were silently not happening.
   * 'copy_deleted': the cloud copy this phone had was deleted on the web page
   * or from another phone (StoredAccount.cloudCopyDeletedAt).
   */
  backupPaused: BackupPauseReason | null;
}

export type BackupPauseReason = 'other_phone' | 'smaller_phone' | 'copy_deleted';

export type SignInOutcome =
  | { kind: 'unavailable' }
  /** The reader closed the sheet, or sign-out overtook the operation. Nothing to say. */
  | { kind: 'cancelled' }
  | { kind: 'failed' }
  /**
   * The sign-in itself was over — the provider has no session for this phone
   * (a revoked Apple sign-in, a run-out session) or the server said so — and
   * the phone is signed out now. Not "check your connection": the reader signs
   * in again.
   */
  | { kind: 'ended' }
  /**
   * Signed in, but the cloud copy could not be read or the first one written.
   * Not a failed sign-in: the reader is signed in, and "Sign-in failed" told
   * them otherwise.
   */
  | { kind: 'not_backed_up' }
  /** No cloud backup existed; the local data was uploaded as the first one. */
  | { kind: 'backed_up' }
  /** Fresh device, cloud had data — restored without asking. */
  | { kind: 'restored'; summary: AccountBackupSummary }
  /** Signed in, and the phone refused to write the backup it downloaded. */
  | { kind: 'restore_failed' }
  /**
   * The phone refused the history after taking the backup's database, and
   * then refused to put its own database back: half the backup is on the
   * phone. Not "nothing changed" — the reader is told what is there and how
   * to finish (bug hunt, 2026-10-05).
   */
  | { kind: 'restore_incomplete' }
  /** Both sides matter. Call resolveRestoreChoice with the reader's answer. */
  | { kind: 'choice'; summary: RestoreChoiceSummary }
  /**
   * A new account with no cloud copy, on a phone last signed in to another
   * one (`reason` 'other_account'), or an account whose copy was deleted on
   * the web page or from another phone ('copy_deleted'): this phone's data is
   * not uploaded unasked. Call resolveUploadChoice.
   */
  | {
      kind: 'confirm_upload';
      reason: 'other_account' | 'copy_deleted';
      email: string | null;
      local: BackupContents & { workoutInProgress: boolean };
    };

/**
 * How an operation the reader started ended. 'cancelled': sign-out or Reset
 * overtook it. 'ended': the account's sign-in was over (deleted elsewhere, a
 * revoked or run-out session) — this phone is signed out, nothing was done by
 * this request, and the reader is told exactly that.
 */
export type AccountOperationResult = 'done' | 'failed' | 'cancelled' | 'ended';

/** Delete account's own results are the same set. */
export type DeleteAccountResult = AccountOperationResult;

export interface AccountBackupApi {
  available: boolean;
  /** The sign-ins this build offers, in display order (accountAuth). */
  providers: SignInProvider[];
  state: AccountBackupState;
  /**
   * True after an AUTOMATIC backup found the sign-in over and signed the phone
   * out: nobody pressed anything, so no operation could answer 'ended'. The app
   * shows "Signed out — your sign-in had ended…" once and acknowledges it;
   * the next sign-in clears it too.
   */
  sessionEndedNotice: boolean;
  acknowledgeSessionEnded: () => void;
  phase: AccountBackupPhase;
  /** Without a provider, the first one offered. */
  signIn: (provider?: SignInProvider) => Promise<SignInOutcome>;
  /** 'incomplete': see SignInOutcome's 'restore_incomplete'. */
  resolveRestoreChoice: (choice: 'restore' | 'keep_local') => Promise<AccountOperationResult | 'incomplete'>;
  /**
   * The answer to 'confirm_upload'. 'skip' stays signed in with nothing
   * uploaded and the automatic backup held, until the reader backs up.
   */
  resolveUploadChoice: (choice: 'upload' | 'skip') => Promise<AccountOperationResult>;
  /** The automatic backup: never asks, and never writes over an unseen copy. */
  backupNow: () => Promise<boolean>;
  /**
   * "Back up now". On a phone that has never synced, or whose upload would
   * shrink the cloud copy, it can come back as 'choice' or 'restored',
   * exactly like sign-in.
   */
  backUpOrAsk: () => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /**
   * Reset's last step, once the wipe has resolved: the phone holds nobody's
   * data now, so the accounts it was signed out of have nothing left to ask
   * about. Not before — a wipe that failed leaves the data, and the marks.
   */
  forgetSignedOutAccounts: () => Promise<void>;
  deleteRemoteBackup: () => Promise<AccountOperationResult>;
  /**
   * Deletes the cloud copy and the server's sign-in for this account, then
   * signs this phone out. The phone's training data stays.
   */
  deleteAccount: () => Promise<DeleteAccountResult>;
}

export interface AccountBackupInput {
  /** Both stores loaded: an upload before the history has loaded writes an empty one. */
  hydrated: boolean;
  /** A workout or run is going. A restore would put it away, so it is asked about. */
  liveSession: boolean;
  database: AppDatabase;
  workoutHistory: WorkoutHistoryStore;
  /**
   * Replaces local data through the providers' own normalize-and-save path,
   * resolving with what was committed once it is on disk.
   *
   * `rollback` puts back a database this phone held before: exactly, as it
   * was, not merged with anything — the restore's own merge (a "no" to usage
   * statistics, the later terms acceptance) applied to it a second time left
   * the phone with the backup's answers after a restore that had failed.
   */
  restoreDatabase: (input: Partial<AppDatabase>, options?: { rollback?: boolean }) => Promise<AppDatabase>;
  restoreWorkoutHistory: (history: WorkoutHistoryStore) => Promise<WorkoutHistoryStore>;
  /**
   * Called once a restore has actually landed — both stores committed, never
   * on a rollback or a refused write. The coach's own memory (App.tsx state,
   * plus its AsyncStorage key — see storage/coachAdviceMemoryStore) sits
   * outside both of the stores above, so without this a restore that replaced
   * everything else, another account's data included, would leave it behind.
   *
   * Awaited before the restore resolves: fired-and-forgotten, a process kill
   * between the restore landing and this finishing left the erase for the
   * next account (recheck round, 2026-09-29). May reject — its own erase
   * already retries once and marks what it could not finish for next launch
   * (see coachAdviceMemoryStore) — but that must never turn an already-landed
   * restore into a reported failure or a rollback, so applyRestore below
   * only logs it.
   */
  onRestored?: () => void | Promise<void>;
}

/** How long the data has to stay still before the automatic backup looks at it. */
const AUTO_BACKUP_QUIET_MS = 8000;

/** Thrown inside an operation that sign-out overtook; never reaches the caller. */
class Superseded extends Error {}
/**
 * Thrown after the sign-in turned out to be over and the phone was signed out
 * for it (a session the server or the provider ended). Sign-out overtook the
 * operation like any other — but the reader is told, not left with silence.
 */
class SessionEnded extends Superseded {}

/**
 * Thrown by applyRestore when the history write failed and the database could
 * not be put back either: the phone holds the backup's database beside its own
 * history, and saying "nothing changed" would be false.
 */
class RestoreHalfApplied extends Error {
  constructor(readonly original: unknown) {
    super('Backup restore half applied');
  }
}

/**
 * What the server answers an Apple session that is over (api/backup.ts): the
 * account was deleted, or the session ran out. INVALID_TOKEN — a session that
 * does not verify, which a wrongly configured deploy produces for everyone at
 * once — is deliberately not among them: it signs nobody out.
 */
const SESSION_REVOKED = 'SESSION_REVOKED';
const SESSION_EXPIRED = 'SESSION_EXPIRED';
/** The prefix of the server's own Apple session. */
const APPLE_SESSION_PREFIX = 'vs1.';
/** Apple accounts are filed as `apple:<sub>` (appleAuth). */
const APPLE_ACCOUNT_PREFIX = 'apple:';

function lookResult(remote: BackupDownloadResult): BackupLookResult {
  if (remote.ok) {
    return { kind: 'backup', ...countBackup(remote.payload.database, remote.payload.workoutHistory) };
  }
  return remote.error === 'NO_BACKUP' ? { kind: 'none' } : { kind: 'unreachable' };
}

export function useAccountBackup(input: AccountBackupInput): AccountBackupApi {
  const available = isAccountSignInConfigured() && isBackupApiConfigured();
  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<AccountBackupPhase>('idle');
  const [sessionEndedNotice, setSessionEndedNotice] = useState(false);
  const acknowledgeSessionEnded = useCallback(() => setSessionEndedNotice(false), []);

  // The payload waiting on the reader's restore-or-keep answer, with the
  // account it belongs to. The account travels with it because the answer is
  // given from a dialog opened by the render that started sign-in, whose
  // `account` was still null — reading it from there made "Use backup" return
  // without restoring anything, and "Keep this phone's data" report a failure.
  // `version` is the copy's: "keep this phone's data" replaces that copy and
  // no other, and "restore" remembers it as the one this phone now holds.
  const pendingRestoreRef = useRef<{
    payload: AccountBackupPayload;
    version: string | null;
    idToken: string;
    account: StoredAccount;
  } | null>(null);
  // The first backup waiting on the reader's yes (confirm_upload), with the
  // account it would go to — held for the same reason as the restore above.
  const pendingUploadRef = useRef<{ idToken: string; account: StoredAccount } | null>(null);
  const latestRef = useRef(input);
  latestRef.current = input;
  // Operations read the account from here, not from the render that started
  // them: the automatic backup runs from a timer, and an operation that has
  // just written the account reads its own write.
  const accountRef = useRef(account);
  accountRef.current = account;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** The automatic backup's starts, for its budget; and the look waiting for the budget to have room. */
  const backupPacingRef = useRef<PacingState>(EMPTY_PACING);
  const pacedLookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Bumped by sign-out — and so by Reset, which signs out before it wipes.
   * Every operation notes it when it starts and checks it after each await.
   * Without it an upload that finished after sign-out wrote the account back
   * (signed in again, on an empty phone that then backed itself up), and a
   * download that finished after Reset restored onto the wiped phone.
   */
  const generationRef = useRef(0);
  // The ref moves with the state, not a render later: the automatic backup's
  // timer reads it, and must not start beside an operation that began in the
  // same tick.
  const enterPhase = (next: AccountBackupPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const ensureCurrent = (generation: number) => {
    if (generationRef.current !== generation) {
      throw new Superseded();
    }
  };
  const endPhase = (generation: number) => {
    // Sign-out already put the phase back, and may have started something new.
    if (generationRef.current === generation) {
      enterPhase('idle');
    }
  };

  /**
   * An automatic look (or refused upload) that found a copy this phone has
   * never seen. The automatic path cannot ask about it, so it does not fetch
   * or send the whole history again every time the app comes back — once per
   * run of the app is enough. The reader's own backup, restore or sign-in
   * settles it.
   */
  const unseenCopyFoundRef = useRef(false);
  // What the row says about it: the same fact, and the shrink guard's, as state.
  const [backupPaused, setBackupPaused] = useState<BackupPauseReason | null>(null);
  const pauseRef = useRef<BackupPauseReason | null>(null);
  const pauseBackup = (reason: BackupPauseReason) => {
    if (reason === 'other_phone') {
      unseenCopyFoundRef.current = true;
    }
    if (pauseRef.current !== reason) {
      pauseRef.current = reason;
      setBackupPaused(reason);
    }
  };
  /** The reader's own backup, restore, sign-in or sign-out settles every pause. */
  const clearPause = () => {
    unseenCopyFoundRef.current = false;
    if (pauseRef.current !== null) {
      pauseRef.current = null;
      setBackupPaused(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadStoredAccount().then((stored) => {
      if (!cancelled) {
        setAccount(stored);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistAccount = useCallback(async (next: StoredAccount | null) => {
    accountRef.current = next;
    setAccount(next);
    if (next) {
      await saveStoredAccount(next);
    } else {
      await clearStoredAccount();
    }
  }, []);

  /**
   * The server saying an Apple session is over (SESSION_REVOKED: the account
   * was deleted from another phone; SESSION_EXPIRED) is something no retry can
   * change: this phone signs out the way the reader's own Sign out does, so the
   * UI shows signed-out instead of "Signed in" over backups that fail for up to
   * 180 days. Only for the server's own Apple session and only for those two
   * answers: a Google token's 401, INVALID_TOKEN (a session that does not
   * verify) and a 502 (the store could not answer) never sign anyone out.
   * Throws SessionEnded (a Superseded), like any operation that sign-out
   * overtakes — the callers answer 'ended', not silence. Takes the calling
   * operation's generation: see below.
   */
  const signOutRef = useRef<() => Promise<void>>(async () => undefined);
  const screenSession = useCallback(
    async <R extends { ok: boolean; error?: string }>(idToken: string, result: R, generation: number): Promise<R> => {
      if (
        !result.ok &&
        (result.error === SESSION_REVOKED || result.error === SESSION_EXPIRED) &&
        idToken.startsWith(APPLE_SESSION_PREFIX)
      ) {
        // An answer to a request of an operation sign-out has overtaken is
        // about the account that has left, not about the phone's account now:
        // a late answer to A's request signed B out the moment B had signed in,
        // and one after the reader's own sign-out signed out twice and left a
        // notice (hunt 3, 2026-10-03). Superseded, like every other late step.
        ensureCurrent(generation);
        await signOutRef.current();
        throw new SessionEnded();
      }
      return result;
    },
    [],
  );

  /**
   * Remembers whose data stays on the phone as an account signs out — added
   * to the accounts already remembered, never in their place.
   *
   * Replacing the mark let an unanswered account sign back in "as itself"
   * and send the earlier account's log (review of the break-round fix); only
   * keeping the first let the first sign back in and send a later one's
   * (the account-switch invariant test). Both are the same fact: until a
   * sign-in settles it, every account that left data here is still on the
   * phone.
   */
  const markSignedOut = useCallback(async (sub: string) => {
    try {
      await rememberSignedOutAccount(sub);
    } catch (error) {
      // The list could not be read, so it was not rewritten from nothing (that
      // dropped the accounts already on it). The sign-out itself goes on: a
      // phone that stayed signed in over a failed note would be worse.
      console.error('Could not note the signed-out account', error);
    }
  }, []);

  /** A sign-out that has begun and not finished: nothing may sign in over it, or start a backup beside it. */
  const signOutInFlightRef = useRef<Promise<void> | null>(null);

  /**
   * Uploads this phone's data over the copy `expectedVersion` names — null:
   * the first backup, onto no copy at all. 'changed' is the server refusing
   * because the cloud holds a copy this phone has not seen; nothing was
   * written, and the caller must not say "backed up". 'gone' is the same
   * refusal over a copy this phone named and the cloud no longer has: deleted
   * on the web page or from another phone (see copyWasDeleted).
   */
  const uploadCurrent = useCallback(
    async (
      idToken: string,
      base: StoredAccount,
      generation: number,
      expectedVersion: string | null,
    ): Promise<'done' | 'failed' | 'changed' | 'gone'> => {
      let version = expectedVersion;
      let sync = base;
      // At most one silent retry: a second refusal is a real race.
      for (let attempt = 0; ; attempt += 1) {
        const { database, workoutHistory } = latestRef.current;
        const payload = buildAccountBackupPayload(database, workoutHistory, new Date().toISOString());
        // Taken with the payload: an edit made while the upload runs is still a
        // difference afterwards, and gets its own backup.
        const fingerprint = accountBackupFingerprint(database, workoutHistory);
        // Kept BEFORE the request: it can land while its answer is lost, and
        // the copy that is then a version ahead of this phone is recognised by
        // this — also after the app was closed in between.
        ensureCurrent(generation);
        sync = {
          ...sync,
          uploadInFlightFingerprints: [fingerprint, ...(sync.uploadInFlightFingerprints ?? [])].slice(0, 3),
        };
        await persistAccount(sync);
        ensureCurrent(generation);
        const result = await screenSession(idToken, await uploadBackup(idToken, payload, version), generation);
        ensureCurrent(generation);
        if (!result.ok) {
          if (result.error !== BACKUP_CHANGED) {
            // Read-only: a note of what the server said, and no change to what happens next.
            reportOperationFailed('backup_upload', result.error);
            return 'failed';
          }
          if (attempt > 0) {
            return 'changed';
          }
          // The copy that refused is exactly what an earlier upload of this
          // phone sent (its answer lost): then nothing was written by anyone
          // else, and this upload goes onto it. Any other copy is another
          // phone's — rows, settings and the name book included — and asked about.
          const remote = await screenSession(idToken, await downloadBackup(idToken), generation);
          ensureCurrent(generation);
          if (!remote.ok && remote.error === 'NO_BACKUP' && version !== null) {
            return 'gone';
          }
          if (
            !remote.ok ||
            remote.version === null ||
            !isCopyPhonesOwnWork({
              inFlightFingerprints: sync.uploadInFlightFingerprints ?? [],
              lastBackupFingerprint: sync.lastBackupFingerprint,
              copy: remote.payload,
            })
          ) {
            return 'changed';
          }
          version = remote.version;
          // The copy is known now, and nothing in flight is a question any more.
          sync = {
            ...sync,
            cloudVersion: remote.version,
            ...syncCounts(countBackup(remote.payload.database, remote.payload.workoutHistory)),
            uploadInFlightFingerprints: [],
          };
          continue;
        }
        clearPause();
        await persistAccount({
          ...sync,
          lastBackupAt: result.savedAt,
          ...syncCounts(countBackup(database, workoutHistory)),
          lastBackupFingerprint: fingerprint,
          uploadInFlightFingerprints: [],
          // The reader's own backup (or restore, or sign-in) is what lifts a
          // delete's pause.
          autoBackupPaused: false,
          cloudCopyDeletedAt: null,
          cloudVersion: result.version,
        });
        // A sign-out that landed during the closing write is the next thing
        // this phone's callers must hear about: each of them forgets the
        // signed-out marks on 'done', and the mark that sign-out had just
        // written for this account is exactly what that would erase (hunt 3,
        // 2026-10-03: the next account's first backup then went out with this
        // account's data and no question).
        ensureCurrent(generation);
        return 'done';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistAccount],
  );

  /**
   * The token an answer to a question goes out with. The question can sit open
   * for hours and a Google ID token lasts about one: the one captured when it
   * was asked is a 401 by the time the reader taps "Use this phone's data".
   * A fresh one when there is one; the captured one when the lookup only failed
   * (offline — the upload will say so). When the provider has no session
   * left, signed out the full way and said so, like every other operation.
   */
  const tokenForAnswer = useCallback(async (captured: string, sub: string, generation: number): Promise<string> => {
    const token = await getFreshIdToken(sub);
    ensureCurrent(generation);
    if (token.status === 'ok') {
      return token.idToken;
    }
    if (token.status === 'signed_out') {
      await signOutRef.current();
      throw new SessionEnded();
    }
    return captured;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Both stores, each on disk before the next; resolves with the fingerprint of what landed. */
  const applyRestore = useCallback(async (payload: AccountBackupPayload, generation: number): Promise<string> => {
    const { database: previous, restoreDatabase, restoreWorkoutHistory } = latestRef.current;
    const database = await restoreDatabase(payload.database);
    ensureCurrent(generation);
    let history: WorkoutHistoryStore;
    try {
      history = await restoreWorkoutHistory(payload.workoutHistory);
    } catch (error) {
      // The database is already the backup's. Put this phone's back, so the
      // failure the reader is shown ("nothing on this phone changed") is
      // true, and the next backup cannot pair the backup's log with this
      // phone's history. A disk that refuses this too has already refused
      // one write; the account is left unsynced either way (the callers).
      // Not after sign-out: that is Reset, which has wiped the phone since,
      // and the old database written back would undo the wipe.
      if (generationRef.current === generation) {
        try {
          await restoreDatabase(previous, { rollback: true });
        } catch (rollbackError) {
          console.error('Backup restore could not be undone', rollbackError);
          throw new RestoreHalfApplied(error);
        }
      }
      throw error;
    }
    ensureCurrent(generation);
    // Both stores are on disk now: this is the one place a restore actually
    // lands, shared by a fresh phone's automatic restore and the reader's own
    // "restore" answer — so it is the one place that clears state neither
    // store above carries (see onRestored's own comment). Awaited, so a
    // process kill cannot land the restore while the erase is still on its
    // way — but never allowed to fail the restore that already committed:
    // both stores are already another account's, and there is nothing left
    // to roll back to.
    try {
      await latestRef.current.onRestored?.();
    } catch (error) {
      console.error('Post-restore cleanup failed', error);
    }
    return accountBackupFingerprint(database, history);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Parks the cloud copy and hands the reader the question, with both
   * sides' counts. The stored count becomes the cloud's, so the automatic
   * backup cannot shrink the copy while the question is open or after
   * "keep" is refused.
   */
  const askRestoreOrKeep = useCallback(
    async (
      idToken: string,
      base: StoredAccount,
      payload: AccountBackupPayload,
      version: string | null,
      generation: number,
      localFromOtherAccount = false,
    ): Promise<SignInOutcome> => {
      const pendingAccount = { ...base, ...syncCounts(countBackup(payload.database, payload.workoutHistory)) };
      pendingRestoreRef.current = { payload, version, idToken, account: pendingAccount };
      const summary = describeRestoreChoice(
        payload,
        latestRef.current.database,
        latestRef.current.liveSession,
        latestRef.current.workoutHistory,
        localFromOtherAccount,
      );
      await persistAccount(pendingAccount);
      // A sign-out during the write took the question away (it empties the
      // pending refs): handing it out anyway left a dialog whose answer could
      // only report "restore failed" / "backup failed" (hunt 3, 2026-10-03).
      ensureCurrent(generation);
      return { kind: 'choice', summary };
    },
    [persistAccount],
  );

  /** The question before a first backup this phone's data may not make unasked (resolveUploadChoice answers it). */
  const confirmUpload = (reason: 'other_account' | 'copy_deleted', account: StoredAccount): SignInOutcome => ({
    kind: 'confirm_upload',
    reason,
    email: account.email,
    local: {
      ...countBackupContents(latestRef.current.database),
      workoutInProgress: latestRef.current.liveSession,
    },
  });

  /** "Back up now" on an account whose cloud copy was deleted elsewhere: a new copy only on a yes. */
  const askToBackUpAgain = async (idToken: string, account: StoredAccount): Promise<SignInOutcome> => {
    pendingUploadRef.current = { idToken, account };
    return confirmUpload('copy_deleted', account);
  };

  /**
   * The cloud copy this phone had is gone: deleted on the web page (no app
   * needed) or from another phone. Remembered on the account as "no backup" —
   * the copy is not there — with the automatic backup held, so nothing is sent
   * until the reader says so; the row says why. Unattended, that is all.
   * "Back up now" asks before making a new copy. It used to upload the whole
   * history as a first backup, and the automatic backup paused saying the copy
   * had "changed on another phone" (bug hunt 5, 2026-10-03).
   */
  const copyWasDeleted = useCallback(
    async (idToken: string, current: StoredAccount, interactive: boolean, generation: number): Promise<SignInOutcome> => {
      const marked: StoredAccount = {
        ...current,
        lastBackupAt: null,
        lastBackupItemCount: null,
        lastBackupHistoryCount: null,
        lastBackupFingerprint: null,
        autoBackupPaused: true,
        cloudVersion: null,
        uploadInFlightFingerprints: [],
        cloudCopyDeletedAt: current.cloudCopyDeletedAt ?? new Date().toISOString(),
      };
      // Not "changed on another phone": the account's own mark says what happened.
      clearPause();
      await persistAccount(marked);
      ensureCurrent(generation);
      return interactive ? await askToBackUpAgain(idToken, marked) : { kind: 'failed' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistAccount],
  );

  /**
   * What this phone does once it has seen the cloud's answer: ask when both
   * sides hold data, restore onto an empty phone, upload as the first backup
   * only on a confirmed "no backup", and otherwise stay signed in without
   * claiming a backup. Shared by sign-in and by "Back up now" on a phone that
   * has never synced, so the second gets the same question as the first.
   */
  const settleWithRemote = useCallback(
    async (idToken: string, base: StoredAccount, remote: BackupDownloadResult, generation: number): Promise<SignInOutcome> => {
      if (remote.ok) {
        if (hasLocalDataWorthKeeping(latestRef.current.database, latestRef.current.liveSession)) {
          // Both sides have data — nobody's copy dies without a decision. When
          // the phone's is another account's, the question says so: shown
          // bare counts, "use the phone's data" replaced the reader's own
          // backup with someone else's log (recheck of #221; user decision
          // 2026-09-28). The mark stays until the answer lands.
          const signedOutSubs = await loadSignedOutAccounts();
          ensureCurrent(generation);
          // Not when every row on the phone is already in this account's own
          // copy: then nothing here is anyone else's, whoever signed out last.
          const fromOtherAccount =
            uploadNeedsConsent({ signedOutSubs, sub: base.sub, localWorthKeeping: true }) &&
            !phoneDataIsInCopy(latestRef.current.database, remote.payload.database, latestRef.current.liveSession);
          return await askRestoreOrKeep(idToken, base, remote.payload, remote.version, generation, fromOtherAccount);
        }
        // The phone is empty: the account signed out of earlier has nothing
        // left here to protect.
        await forgetSignedOutAccount();
        // Reset between the look and the restore must not meet a restore.
        ensureCurrent(generation);
        const summary = describeAccountBackup(remote.payload);
        const remoteCounts = syncCounts(countBackup(remote.payload.database, remote.payload.workoutHistory));
        enterPhase('restoring');
        let fingerprint: string;
        try {
          fingerprint = await applyRestore(remote.payload, generation);
        } catch (error) {
          if (error instanceof Superseded) {
            throw error;
          }
          // The disk refused the restore (full, or a row too big). Signed in,
          // nothing synced, so the next "Back up now" asks again — and the
          // reader is told now instead of seeing nothing happen.
          console.error('Backup restore failed', error);
          reportOperationFailed('backup_restore', error instanceof RestoreHalfApplied ? error.original : error);
          ensureCurrent(generation);
          await persistAccount({ ...base, ...remoteCounts });
          return { kind: error instanceof RestoreHalfApplied ? 'restore_incomplete' : 'restore_failed' };
        }
        await persistAccount({
          ...base,
          lastBackupAt: remote.payload.exportedAt,
          ...remoteCounts,
          // What is on the phone now is the cloud copy; nothing to upload.
          lastBackupFingerprint: fingerprint,
          // Phone and cloud agree again, by the reader's own doing — the
          // same as an upload. Left paused (a delete, then this phone restoring
          // a copy another phone wrote), the row showed a fresh backup time
          // while nothing was ever backed up again.
          autoBackupPaused: false,
          cloudCopyDeletedAt: null,
          // The copy this phone now holds, and so the one its next upload
          // may replace.
          cloudVersion: remote.version,
        });
        clearPause();
        return { kind: 'restored', summary };
      }
      if (remote.error !== 'NO_BACKUP') {
        // The server is unreachable or spoke nonsense: signed in, not backed
        // up, and the state says so instead of inventing a timestamp.
        reportOperationFailed('backup_restore', remote.error);
        await persistAccount(base);
        return { kind: 'not_backed_up' };
      }

      // The phone was last signed in to another account and still holds its
      // data. Uploaded here, that account's whole log became this one's first
      // backup with "backed up" on screen (break round, 2026-09-28). Asked
      // instead; until answered, signed in and nothing sent — the automatic
      // backup held too, or it would send it a few seconds later anyway.
      const signedOutSubs = await loadSignedOutAccounts();
      ensureCurrent(generation);
      if (
        uploadNeedsConsent({
          signedOutSubs,
          sub: base.sub,
          localWorthKeeping: hasLocalDataWorthKeeping(latestRef.current.database, latestRef.current.liveSession),
        })
      ) {
        const held = { ...base, autoBackupPaused: true };
        pendingUploadRef.current = { idToken, account: held };
        await persistAccount(held);
        return confirmUpload('other_account', base);
      }
      if (base.cloudCopyDeletedAt) {
        // "Back up now" after the copy was deleted elsewhere (copyWasDeleted): still asked. After the question
        // above, which says whose data it is when that is the matter.
        return await askToBackUpAgain(idToken, base);
      }
      await forgetSignedOutAccount();
      // The payload is read once the upload starts: a sign-out (Reset) during
      // the line above must not find an emptied phone being backed up.
      ensureCurrent(generation);

      enterPhase('backing_up');
      // Onto no copy: if another phone's first backup landed since the look,
      // the server refuses this one, and the account stays unsynced — the
      // next "Back up now" asks about the copy that is there.
      const uploaded = await uploadCurrent(idToken, base, generation, null);
      if (uploaded !== 'done') {
        // Signed in, nothing synced — and what the failed upload kept (its
        // fingerprint, see uploadCurrent) stays with the account.
        await persistAccount(accountRef.current ?? base);
        return { kind: 'not_backed_up' };
      }
      return { kind: 'backed_up' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyRestore, askRestoreOrKeep, persistAccount, uploadCurrent],
  );

  const signIn = useCallback(async (provider?: SignInProvider): Promise<SignInOutcome> => {
    if (!available) {
      return { kind: 'unavailable' };
    }
    // A sign-out that is still finishing (it clears the stored account and the
    // provider's session) must not be signed in over.
    await signOutInFlightRef.current;
    setSessionEndedNotice(false);
    const generation = generationRef.current;
    enterPhase('signing_in');
    try {
      const result = await signInWith(provider ?? availableSignInProviders()[0] ?? 'google');
      ensureCurrent(generation);
      if (result.status === 'failed') {
        // The provider's own refusal carries no code of ours: UNKNOWN.
        reportOperationFailed('sign_in');
      }
      if (result.status !== 'signed_in') {
        return { kind: result.status === 'cancelled' ? 'cancelled' : result.status === 'unavailable' ? 'unavailable' : 'failed' };
      }
      clearPause();
      const base: StoredAccount = {
        sub: result.account.sub,
        email: result.account.email,
        name: result.account.name,
        lastBackupAt: null,
        lastBackupItemCount: null,
        lastBackupHistoryCount: null,
        lastBackupFingerprint: null,
        autoBackupPaused: false,
        cloudVersion: null,
      };

      const remote = await screenSession(result.account.idToken, await downloadBackup(result.account.idToken), generation);
      ensureCurrent(generation);
      return await settleWithRemote(result.account.idToken, base, remote, generation);
    } catch (error) {
      if (error instanceof SessionEnded) {
        // Not reported: a session that ended is a known account state.
        return { kind: 'ended' };
      }
      if (error instanceof Superseded) {
        return { kind: 'cancelled' };
      }
      throw error;
    } finally {
      endPhase(generation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, settleWithRemote]);

  const resolveRestoreChoice = useCallback(
    async (choice: 'restore' | 'keep_local'): Promise<AccountOperationResult | 'incomplete'> => {
      const pending = pendingRestoreRef.current;
      if (!pending) {
        return 'failed';
      }
      const current = pending.account;
      pendingRestoreRef.current = null;
      const generation = generationRef.current;
      try {
        if (choice === 'restore') {
          enterPhase('restoring');
          let fingerprint: string;
          try {
            fingerprint = await applyRestore(pending.payload, generation);
          } catch (error) {
            if (error instanceof Superseded) {
              throw error;
            }
            // A refused write: the caller says so. The account is left
            // unsynced — also when it was synced before, as on the "Back up
            // now" path — so the automatic backup never writes over the copy
            // the reader chose, and "Back up now" asks again (PR #119 review).
            console.error('Backup restore failed', error);
            reportOperationFailed('backup_restore', error instanceof RestoreHalfApplied ? error.original : error);
            ensureCurrent(generation);
            await persistAccount({ ...current, lastBackupAt: null, lastBackupFingerprint: null, cloudVersion: null });
            return error instanceof RestoreHalfApplied ? 'incomplete' : 'failed';
          }
          await persistAccount({
            ...current,
            lastBackupAt: pending.payload.exportedAt,
            lastBackupFingerprint: fingerprint,
            autoBackupPaused: false,
            cloudCopyDeletedAt: null,
            cloudVersion: pending.version,
          });
          // As at the end of uploadCurrent: not over a sign-out's mark.
          ensureCurrent(generation);
          clearPause();
          // The phone now holds this account's own backup: whose data it was
          // is settled.
          await forgetSignedOutAccount();
          return 'done';
        }
        // The reader chose this phone, and was asked twice if it holds less
        // or is another account's. Over the copy they were shown and no
        // other: one written since then is refused, and the next "Back up
        // now" asks about that one.
        enterPhase('backing_up');
        const idToken = await tokenForAnswer(pending.idToken, current.sub, generation);
        const kept = await uploadCurrent(idToken, current, generation, pending.version);
        if (kept === 'done') {
          await forgetSignedOutAccount();
        }
        if (kept === 'gone') {
          // The copy shown was deleted while the question was open: the row says so, and a new copy is asked for.
          await copyWasDeleted(idToken, current, false, generation);
        }
        return kept === 'done' ? 'done' : 'failed';
      } catch (error) {
        if (error instanceof SessionEnded) {
          return 'ended';
        }
        if (error instanceof Superseded) {
          return 'cancelled';
        }
        throw error;
      } finally {
        endPhase(generation);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyRestore, copyWasDeleted, persistAccount, tokenForAnswer, uploadCurrent],
  );

  const resolveUploadChoice = useCallback(
    async (choice: 'upload' | 'skip'): Promise<AccountOperationResult> => {
      const pending = pendingUploadRef.current;
      if (!pending) {
        return 'failed';
      }
      pendingUploadRef.current = null;
      const generation = generationRef.current;
      try {
        if (choice === 'skip') {
          // Signed in, nothing sent, the automatic backup still held. The
          // mark stays: "Not now" is not a yes, and forgotten here the next
          // "Back up now" found no other account and sent its log unasked
          // (recheck of #221, 2026-09-28). It asks again instead.
          await persistAccount(pending.account);
          return 'done';
        }
        enterPhase('backing_up');
        // uploadCurrent lifts the hold when the upload lands. Only a landed
        // upload settles whose data this is; a failed one asks again.
        const idToken = await tokenForAnswer(pending.idToken, pending.account.sub, generation);
        const uploaded = await uploadCurrent(idToken, pending.account, generation, null);
        if (uploaded === 'done') {
          await forgetSignedOutAccount();
        }
        return uploaded === 'done' ? 'done' : 'failed';
      } catch (error) {
        if (error instanceof SessionEnded) {
          return 'ended';
        }
        if (error instanceof Superseded) {
          return 'cancelled';
        }
        throw error;
      } finally {
        endPhase(generation);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persistAccount, tokenForAnswer, uploadCurrent],
  );

  /**
   * One backup. `interactive` is the reader pressing "Back up now"; the
   * automatic backup is not. What it may do is decided by planBackup and
   * decideAfterLook (lib/accountBackup).
   */
  const runBackup = useCallback(
    async (interactive: boolean): Promise<SignInOutcome> => {
      const current = accountRef.current;
      if (!available || !current) {
        return { kind: 'failed' };
      }
      // The automatic backup's budget (lib/requestPacing) is spent when a
      // request to our server is about to start, once per run - not when the
      // run begins: a run that stops before the network (paused, offline, a
      // question open) sends nothing and must not use up the hour's slots.
      let slotSpent = false;
      const spendAutoSlot = () => {
        if (!interactive && !slotSpent) {
          slotSpent = true;
          backupPacingRef.current = notePacingSent(backupPacingRef.current, AUTO_BACKUP_PACING, Date.now());
        }
      };
      if (pendingRestoreRef.current || pendingUploadRef.current) {
        // The reader has not answered restore-or-keep, or whether this phone's
        // data goes to this account, yet. An upload now would answer for them.
        return { kind: 'failed' };
      }
      if (!interactive && unseenCopyFoundRef.current) {
        return { kind: 'failed' };
      }
      const plan = planBackup({
        interactive,
        sync: current,
        local: countBackup(latestRef.current.database, latestRef.current.workoutHistory),
      });
      if (plan === 'skip') {
        // A delete's own pause already shows as "No backup yet". The shrink
        // guard did not show at all: the row kept its green time while nothing
        // was being backed up.
        if (
          !interactive &&
          !current.autoBackupPaused &&
          backupWouldShrink(countBackup(latestRef.current.database, latestRef.current.workoutHistory), {
            itemCount: current.lastBackupItemCount,
            historyCount: current.lastBackupHistoryCount,
          })
        ) {
          pauseBackup('smaller_phone');
        }
        return { kind: 'failed' };
      }
      if (pauseRef.current === 'smaller_phone') {
        // The phone no longer holds far less than the copy.
        clearPause();
      }
      const generation = generationRef.current;
      enterPhase('backing_up');
      try {
        const token = await getFreshIdToken(current.sub);
        ensureCurrent(generation);
        if (token.status === 'signed_out') {
          // The provider has no session for this app any more; saying "signed
          // in" would promise backups that cannot happen. Signed out the full
          // way (the provider's session too, the next account asked about this
          // data), and said so: "check your connection" was not the matter.
          await signOutRef.current();
          throw new SessionEnded();
        }
        if (token.status !== 'ok') {
          // Offline, most likely. Still signed in: the next change, or the
          // next time the app comes to the front, tries again.
          return { kind: 'failed' };
        }
        const idToken = token.idToken;
        // The copy this upload replaces: the one this phone last wrote or
        // restored, or — after a look — the one it has just read.
        let expectedVersion = current.cloudVersion;
        if (plan === 'look') {
          spendAutoSlot();
          const remote = await screenSession(idToken, await downloadBackup(idToken), generation);
          ensureCurrent(generation);
          if (
            remote.ok &&
            !current.lastBackupAt &&
            remote.version !== null &&
            isCopyPhonesOwnWork({
              inFlightFingerprints: current.uploadInFlightFingerprints ?? [],
              copy: remote.payload,
            })
          ) {
            // This phone's own first backup, which landed while its answer was
            // lost. Nobody wrote it but this phone: no question to ask.
            const copyFingerprint = accountBackupFingerprint(remote.payload.database as AppDatabase, remote.payload.workoutHistory);
            const adopted: StoredAccount = {
              ...current,
              lastBackupAt: remote.payload.exportedAt,
              ...syncCounts(countBackup(remote.payload.database, remote.payload.workoutHistory)),
              lastBackupFingerprint: copyFingerprint,
              uploadInFlightFingerprints: [],
              cloudVersion: remote.version,
            };
            await persistAccount(adopted);
            ensureCurrent(generation);
            const { database, workoutHistory } = latestRef.current;
            if (accountBackupFingerprint(database, workoutHistory) === copyFingerprint) {
              return { kind: 'backed_up' };
            }
            return (await uploadCurrent(idToken, adopted, generation, remote.version)) === 'done'
              ? { kind: 'backed_up' }
              : { kind: 'failed' };
          }
          const decision = decideAfterLook({
            interactive,
            neverSynced: !current.lastBackupAt,
            remote: lookResult(remote),
            local: countBackup(latestRef.current.database, latestRef.current.workoutHistory),
            unseen: remote.ok && !isCloudCopyThisPhones(current, remote),
          });
          if (decision === 'gone') {
            return await copyWasDeleted(idToken, current, interactive, generation);
          }
          if (decision === 'settle') {
            // The reader is here to answer, so they get sign-in's question —
            // otherwise nothing but signing out and in again would ever lift
            // this (PR #119 review).
            return await settleWithRemote(idToken, current, remote, generation);
          }
          if (decision === 'ask' && remote.ok) {
            // "Back up now" on a phone holding far less than the copy it
            // would replace, or finding a copy another phone wrote: the
            // reader decides, with both counts in front of them, instead of
            // the upload deciding for them.
            return await askRestoreOrKeep(idToken, current, remote.payload, remote.version, generation);
          }
          if (decision === 'hold' && remote.ok) {
            // The copy is this phone's own (another phone's fails above), so
            // its version is the one the next upload names.
            if (!interactive) {
              pauseBackup('smaller_phone');
            }
            await persistAccount({
              ...current,
              ...syncCounts(countBackup(remote.payload.database, remote.payload.workoutHistory)),
              cloudVersion: remote.version,
            });
            return { kind: 'failed' };
          }
          if (decision !== 'upload') {
            if (remote.ok && !interactive) {
              pauseBackup('other_phone');
            }
            return { kind: 'failed' };
          }
          expectedVersion = remote.ok ? remote.version : null;
        }
        // This account's first backup, onto no copy, from a phone last signed
        // in to another account: not sent unattended. Sign-in could not ask
        // when the server was unreachable, and this retry used to send the
        // other account's log once the network came back (CI review of #221).
        // Held until the reader's own "Back up now", which asks.
        if (!interactive && !current.lastBackupAt && expectedVersion === null) {
          const signedOutSubs = await loadSignedOutAccounts();
          ensureCurrent(generation);
          if (
            uploadNeedsConsent({
              signedOutSubs,
              sub: current.sub,
              localWorthKeeping: hasLocalDataWorthKeeping(latestRef.current.database, latestRef.current.liveSession),
            })
          ) {
            await persistAccount({ ...current, autoBackupPaused: true });
            return { kind: 'failed' };
          }
        }
        spendAutoSlot();
        const uploaded = await uploadCurrent(idToken, current, generation, expectedVersion);
        if (uploaded === 'done') {
          // Landed without needing a yes (the check above held it otherwise):
          // the phone's data is this account's now, and an account signed out
          // of long ago must not ask the next one about it (review of the
          // invariant fix, 2026-09-28).
          await forgetSignedOutAccount();
        }
        if (uploaded === 'gone') {
          return await copyWasDeleted(idToken, current, interactive, generation);
        }
        if (uploaded !== 'changed') {
          return uploaded === 'done' ? { kind: 'backed_up' } : { kind: 'failed' };
        }
        // Another phone wrote the copy after this one last saw it, and the
        // server kept theirs. Unattended, nothing more is sent: the next try
        // would upload the whole history to hear the same refusal.
        if (!interactive) {
          pauseBackup('other_phone');
          return { kind: 'failed' };
        }
        // "Back up now": the look this phone would have done had it known.
        const remote = await screenSession(idToken, await downloadBackup(idToken), generation);
        ensureCurrent(generation);
        if (remote.ok) {
          return await askRestoreOrKeep(idToken, current, remote.payload, remote.version, generation);
        }
        if (remote.error === 'NO_BACKUP') {
          // Another phone wrote a copy and it has been deleted since: no copy now, and this phone had one.
          return await copyWasDeleted(idToken, current, interactive, generation);
        }
        return { kind: 'failed' };
      } catch (error) {
        if (error instanceof SessionEnded) {
          if (!interactive) {
            // Nobody is waiting for this answer (backupNow reduces it to a
            // boolean): the notice is how the reader hears it.
            setSessionEndedNotice(true);
          }
          return { kind: 'ended' };
        }
        if (error instanceof Superseded) {
          return { kind: 'cancelled' };
        }
        throw error;
      } finally {
        endPhase(generation);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [askRestoreOrKeep, available, copyWasDeleted, persistAccount, settleWithRemote, uploadCurrent],
  );

  /**
   * The automatic backup in flight, if any. Its timer can fire while the
   * delete confirmation is open, after the row's busy check has passed.
   */
  const automaticBackupRef = useRef<Promise<boolean> | null>(null);
  const backupNow = useCallback((): Promise<boolean> => {
    const running = runBackup(false).then((outcome) => outcome.kind === 'backed_up');
    automaticBackupRef.current = running;
    const clear = () => {
      if (automaticBackupRef.current === running) {
        automaticBackupRef.current = null;
      }
    };
    running.then(clear, clear);
    return running;
  }, [runBackup]);
  const backUpOrAsk = useCallback(() => runBackup(true), [runBackup]);

  const signOut = useCallback(async () => {
    generationRef.current += 1;
    // Everything below up to the first await is one synchronous step. Whatever
    // is still running belongs to the account being left and must not write it
    // back — and nothing may START as that account either: an automatic backup
    // whose timer fired in the gap before the account was cleared read the
    // new generation, built its payload after Reset's wipe and uploaded an
    // empty database over the cloud copy (audit 2026-10-03). The account is
    // therefore gone from the ref and from state before anything is awaited.
    pendingRestoreRef.current = null;
    pendingUploadRef.current = null;
    clearPause();
    lookWaitingRef.current = false;
    const leaving = accountRef.current;
    accountRef.current = null;
    setAccount(null);
    enterPhase('idle');
    const finish = (async () => {
      // The data stays on the phone, and so does whose it was: the next sign-in
      // to a different account asks before sending it there.
      if (leaving) {
        await markSignedOut(leaving.sub);
      }
      await persistAccount(null);
      await signOutAccount();
    })();
    const tracked = finish.then(
      () => undefined,
      () => undefined,
    );
    signOutInFlightRef.current = tracked;
    try {
      await finish;
    } finally {
      if (signOutInFlightRef.current === tracked) {
        signOutInFlightRef.current = null;
      }
    }
  }, [markSignedOut, persistAccount]);

  const forgetSignedOutAccounts = useCallback(async () => {
    await forgetSignedOutAccount();
  }, []);

  signOutRef.current = signOut;

  const deleteRemoteBackup = useCallback(async (): Promise<AccountOperationResult> => {
    if (!available || !accountRef.current) {
      return 'failed';
    }
    const generation = generationRef.current;
    const automatic = automaticBackupRef.current;
    if (automatic) {
      // An upload already on its way lands after a quick DELETE and puts the
      // copy back — and its account write lifts the pause. So the delete
      // goes after it.
      await automatic.catch(() => false);
      if (generationRef.current !== generation) {
        return 'cancelled';
      }
    }
    // Read after the wait: the backup that just ran may have written it.
    const current = accountRef.current;
    if (!current) {
      return 'failed';
    }
    // A phase like every other operation, so Sign out and the other rows wait
    // for it instead of racing its account write.
    enterPhase('deleting');
    try {
      const token = await getFreshIdToken(current.sub);
      ensureCurrent(generation);
      if (token.status === 'signed_out') {
        // Signed out the full way and said so; nothing was deleted.
        await signOutRef.current();
        throw new SessionEnded();
      }
      if (token.status !== 'ok') {
        return 'failed';
      }
      const result = await screenSession(token.idToken, await deleteBackup(token.idToken), generation);
      ensureCurrent(generation);
      if (!result.ok) {
        return 'failed';
      }
      // Paused rather than signed out. The reader asked for the copy to go,
      // not the account; signing them out would be a second thing they did
      // not ask for. But left running, the automatic backup wrote the whole
      // history back eight seconds after the next weigh-in, and the delete
      // was undone without a word. The row now says "No backup yet", and
      // "Back up now" — their own decision — is what starts backups again.
      await persistAccount({
        ...current,
        lastBackupAt: null,
        lastBackupItemCount: null,
        lastBackupHistoryCount: null,
        lastBackupFingerprint: null,
        autoBackupPaused: true,
        cloudVersion: null,
      });
      return 'done';
    } catch (error) {
      if (error instanceof SessionEnded) {
        return 'ended';
      }
      if (error instanceof Superseded) {
        return 'cancelled';
      }
      throw error;
    } finally {
      endPhase(generation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, persistAccount]);

  /**
   * Delete account: the cloud copy goes, the server ends the sign-in's
   * sessions (an Apple one is otherwise good for 180 days and renews itself),
   * and only then is this phone signed out. The training data on the phone is
   * not touched — Reset is the reader's other, separate choice.
   *
   * 'done' means both writes resolved: the server said yes, and the phone has
   * forgotten the account. A failure at the server leaves the reader signed in
   * and able to try again; nothing here says "deleted" before that.
   */
  const deleteAccount = useCallback(async (): Promise<DeleteAccountResult> => {
    if (!available || !accountRef.current) {
      return 'failed';
    }
    const generation = generationRef.current;
    const automatic = automaticBackupRef.current;
    if (automatic) {
      // As deleteRemoteBackup: an upload on its way would put the copy back.
      await automatic.catch(() => false);
      if (generationRef.current !== generation) {
        return 'cancelled';
      }
    }
    const current = accountRef.current;
    if (!current) {
      return 'failed';
    }
    enterPhase('deleting');
    try {
      const token = await getFreshIdToken(current.sub);
      ensureCurrent(generation);
      if (token.status === 'signed_out') {
        // The provider has no session for this app any more, so there is no
        // credential to delete with: signed out here the full way, and the
        // reader signs in again to delete — said as 'ended', not as a failed
        // connection and not as a deleted account.
        await signOutRef.current();
        throw new SessionEnded();
      }
      if (token.status !== 'ok') {
        // No credential to delete with (offline, Play services busy): the
        // provider says nothing more, so the code is UNKNOWN.
        reportOperationFailed('account_delete');
        return 'failed';
      }
      // Written BEFORE sending, cleared by any answer that settles it: if the
      // answer is slow or lost, the retry meets a session the server has by
      // then ended, and this is how that retry knows its own try went through.
      const triedBefore = Boolean(current.deleteAccountPendingAt);
      // The id this phone's request carries, kept with the record: the server
      // writes it into the revocation marker and hands it back when it turns a
      // later request away, so "the account is gone" can be told apart as this
      // phone's own delete or another's. A retry keeps the first try's id —
      // that is the one a delivered request left behind.
      const requestId = isDeleteRequestId(current.deleteRequestId) ? current.deleteRequestId : randomHex(32);
      await persistAccount({
        ...(accountRef.current ?? current),
        deleteAccountPendingAt: new Date().toISOString(),
        deleteRequestId: requestId,
      });
      ensureCurrent(generation);
      const answer = await deleteBackup(token.idToken, { account: true, requestId });
      ensureCurrent(generation);
      if (answer.ok) {
        // The server has deleted; now this phone forgets the account. Sign-out
        // ends whatever else is running, clears the Google or Apple session and
        // the pending record with the account record.
        await signOut();
        return 'done';
      }
      if (
        token.idToken.startsWith(APPLE_SESSION_PREFIX) &&
        (answer.error === SESSION_REVOKED || answer.error === SESSION_EXPIRED)
      ) {
        // The session is over, whichever way. It is "done" only if THIS phone
        // sent a delete earlier whose answer it never got: that one deleted
        // (the copy goes before the marker is written). Any other phone is
        // being told the account was deleted elsewhere — maybe by a phone that
        // has since signed in again and backed up, whose copy is alive — and
        // says only that, never "deleted". A server that returns the marker's
        // request id settles it exactly (revokedDeleteOutcome); the pending
        // record alone could not tell a lost delete from one another phone made
        // after this phone's try never arrived.
        await signOut();
        return answer.error === SESSION_REVOKED
          ? revokedDeleteOutcome({ pendingBefore: triedBefore, ownRequestId: requestId, answerRequestId: answer.deleteRequestId })
          : 'ended';
      }
      if (answer.definite) {
        // The server said no: nothing was deleted by this request, so there is
        // nothing to remember. (A 5xx or no answer keeps the record — it may
        // have gone through.)
        const latest = accountRef.current;
        if (latest) {
          await persistAccount({ ...latest, deleteAccountPendingAt: null, deleteRequestId: null });
        }
      }
      reportOperationFailed('account_delete', answer.error);
      return 'failed';
    } catch (error) {
      if (error instanceof SessionEnded) {
        return 'ended';
      }
      if (error instanceof Superseded) {
        return 'cancelled';
      }
      throw error;
    } finally {
      endPhase(generation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, persistAccount, signOut]);

  // Auto-backup: when signed in and the data differs from what the cloud copy
  // was made of, push a fresh copy after a quiet pause. The fingerprint moves
  // with edits as well as additions, and is only advanced by an upload that
  // landed — so a failed one is still a difference the next look finds.
  const backupNowRef = useRef(backupNow);
  backupNowRef.current = backupNow;
  /** A look that came while another account operation ran; taken once that ends. */
  const lookWaitingRef = useRef(false);
  const lookRef = useRef<() => void>(() => undefined);
  useEffect(
    () => () => {
      if (pacedLookTimerRef.current) {
        clearTimeout(pacedLookTimerRef.current);
        pacedLookTimerRef.current = null;
      }
    },
    [],
  );
  lookRef.current = () => {
    const current = accountRef.current;
    const { database, hydrated, workoutHistory } = latestRef.current;
    if (!available || !current || !hydrated || signOutInFlightRef.current) {
      return;
    }
    if (phaseRef.current !== 'idle') {
      lookWaitingRef.current = true;
      return;
    }
    lookWaitingRef.current = false;
    if (current.lastBackupFingerprint === accountBackupFingerprint(database, workoutHistory)) {
      return;
    }
    // The ceiling under every trigger (lib/requestPacing): a bug that keeps
    // changing the data would otherwise upload the whole history every
    // quiet pause for as long as the app is open. Held back, the look is
    // taken again when the budget has room - nothing is dropped.
    const wait = pacingWaitMs(backupPacingRef.current, AUTO_BACKUP_PACING, Date.now());
    if (wait > 0) {
      if (!pacedLookTimerRef.current) {
        pacedLookTimerRef.current = setTimeout(() => {
          pacedLookTimerRef.current = null;
          lookRef.current();
        }, wait);
      }
      return;
    }
    void backupNowRef.current();
  };

  const signedIn = account !== null;
  useEffect(() => {
    if (!available || !signedIn || !input.hydrated) {
      return undefined;
    }
    // Every change restarts the pause; the look decides whether anything changed.
    const timer = setTimeout(() => lookRef.current(), AUTO_BACKUP_QUIET_MS);
    return () => clearTimeout(timer);
  }, [available, signedIn, input.hydrated, input.database, input.workoutHistory]);

  useEffect(() => {
    // Not on every return to idle: a backup that failed would then retry
    // itself every eight seconds for as long as the phone is offline.
    if (phase !== 'idle' || !lookWaitingRef.current) {
      return undefined;
    }
    const timer = setTimeout(() => lookRef.current(), AUTO_BACKUP_QUIET_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!available) {
      return undefined;
    }
    // Coming back to the app is the retry: offline at the time is the usual
    // reason a backup did not land.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener('change', (next) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (next === 'active') {
        timer = setTimeout(() => lookRef.current(), AUTO_BACKUP_QUIET_MS);
        // An Apple session inside its renewal window is renewed now, not only
        // by the next backup: a phone left alone for the whole window ran the
        // session out and was signed out at its next change. Nothing here
        // signs anyone out — a failed renewal is tried again at the next return.
        const signedInAs = accountRef.current;
        if (signedInAs && !signOutInFlightRef.current) {
          void renewSessionIfDue(signedInAs.sub).catch(() => undefined);
        }
      }
    });
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, [available]);

  const state = useMemo<AccountBackupState>(() => {
    if (!available) {
      return { status: 'unavailable', email: null, name: null, lastBackupAt: null, provider: null, backupPaused: null };
    }
    if (!loaded) {
      return { status: 'loading', email: null, name: null, lastBackupAt: null, provider: null, backupPaused: null };
    }
    if (!account) {
      return { status: 'signed_out', email: null, name: null, lastBackupAt: null, provider: null, backupPaused: null };
    }
    return {
      status: 'signed_in',
      email: account.email,
      name: account.name,
      lastBackupAt: account.lastBackupAt,
      provider: account.sub.startsWith(APPLE_ACCOUNT_PREFIX) ? 'apple' : 'google',
      // Held across launches on the account: the copy stays deleted until the reader backs up again.
      backupPaused: backupPaused ?? (account.cloudCopyDeletedAt ? 'copy_deleted' : null),
    };
  }, [account, available, backupPaused, loaded]);

  return {
    available,
    providers: availableSignInProviders(),
    state,
    sessionEndedNotice,
    acknowledgeSessionEnded,
    phase,
    signIn,
    resolveRestoreChoice,
    resolveUploadChoice,
    backupNow,
    backUpOrAsk,
    signOut,
    forgetSignedOutAccounts,
    deleteRemoteBackup,
    deleteAccount,
  };
}
