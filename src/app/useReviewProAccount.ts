import { useEffect, useRef } from 'react';

import type { AccountBackupState } from '../features/account/useAccountBackup';
import { reviewAccountFlag } from '../lib/reviewAccount';
import type { PreferencesPatch } from '../state/AppProvider';

export interface ReviewProAccountDeps {
  /** The database store has loaded: `useAppContext().hydrated`. */
  hydrated: boolean;
  /** `accountBackup.state`: who is signed in, once the stored account has been read. */
  account: Pick<AccountBackupState, 'status' | 'email' | 'sub' | 'provider'>;
  /** The stored flag: `preferences.reviewProAccount`. */
  stored: boolean;
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
}

/**
 * Keeps `reviewProAccount` equal to "the signed-in account is Play's review
 * account" (lib/reviewAccount), and so gives that account Pro.
 *
 * One reconciliation rather than a write at each end of sign-in. Whatever
 * changes the signed-in account — signing in, signing out, Delete account, a
 * session the server ended, Reset, a stale flag found on start with no account
 * behind it — the next render sees the two disagree and corrects the flag. A
 * restore that replaced the database cannot hand it over either (it is a
 * device-only field), and is corrected the same way if it ever did.
 *
 * Waits for the stored account to be read ('loading'): deciding earlier would
 * clear the flag on every launch before the account had been found. An
 * unavailable sign-in (a build without the OAuth client) clears it, since
 * nobody can be signed in there.
 *
 * A refused write is tried once per value until the account changes again or
 * the app next starts — the rolled-back write would otherwise re-run this
 * forever.
 */
export function useReviewProAccount(deps: ReviewProAccountDeps): void {
  const { hydrated, account, stored } = deps;
  const updateRef = useRef(deps.updatePreferences);
  updateRef.current = deps.updatePreferences;
  const attemptedRef = useRef<boolean | null>(null);

  const settled = hydrated && account.status !== 'loading';
  const wanted = reviewAccountFlag({
    status: account.status,
    email: account.email,
    sub: account.sub,
    provider: account.provider,
  });

  useEffect(() => {
    if (!settled) {
      return;
    }
    if (stored === wanted) {
      attemptedRef.current = null;
      return;
    }
    if (attemptedRef.current === wanted) {
      return;
    }
    attemptedRef.current = wanted;
    void updateRef.current({ reviewProAccount: wanted }).catch((error) => {
      console.warn('Failed to save the review-account flag', error);
    });
  }, [settled, stored, wanted]);
}
