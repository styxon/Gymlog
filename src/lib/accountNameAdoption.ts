import { storedProfileName } from './profileName';

/**
 * The name from a signed-in account, taken once.
 *
 * The profile name comes from Google, so the About form stopped asking for one
 * (2026-09-09). The rule that took it was "whenever the profile has no name",
 * and no name is also what a reader has the moment they clear theirs in
 * Profile: the account's name came straight back, and clearing it looked
 * broken — the same shape as the deleted weigh-in that setup kept writing
 * back (2026-09-16). A flag records that the account has had its say.
 */

export { MAX_PROFILE_NAME_LENGTH } from './profileName';

export type AccountNameStep =
  /** Nothing to write. */
  | { kind: 'none' }
  /** The profile already has a name: the account's turn is over. */
  | { kind: 'markAdopted' }
  /** Take the account's name, and record that it was taken. */
  | { kind: 'adopt'; name: string };

export function accountNameStep(input: {
  accountName: string | null | undefined;
  profileName: string | null | undefined;
  adopted: boolean;
}): AccountNameStep {
  if (input.adopted) {
    return { kind: 'none' };
  }
  // A name typed in Profile, or one taken before the flag existed, is the
  // reader's answer and outranks the account's.
  if (input.profileName?.trim()) {
    return { kind: 'markAdopted' };
  }
  const accountName = input.accountName?.trim();
  if (!accountName) {
    return { kind: 'none' };
  }
  return { kind: 'adopt', name: storedProfileName(accountName) };
}
