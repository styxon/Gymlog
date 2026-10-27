/**
 * Which sign-in the account backup uses: Google everywhere it is configured,
 * and Sign in with Apple on iPhone — App Review asks for Apple's beside any
 * other third-party sign-in (guideline 4.8).
 *
 * The backup hook talks to this file only. Which provider the phone is
 * signed in with is not stored twice: it is the account's own subject, filed
 * as `apple:<user>` for Apple and a bare id for Google. The token is routed by
 * that and never by which session happens to be on the phone — a session left
 * behind by a sign-out that raced it must not decide whose backup this is.
 */
import {
  APPLE_SUB_PREFIX,
  appleDeletionCode,
  getFreshAppleToken,
  isAppleSignInConfigured,
  renewAppleSessionIfDue,
  signInWithApple,
  signOutApple,
} from './appleAuth';
import type { FreshIdTokenResult, GoogleSignInResult } from './googleAuth';
import { getFreshIdToken as getFreshGoogleToken, isGoogleSignInConfigured, signInWithGoogle, signOutGoogle } from './googleAuth';

export type SignInProvider = 'google' | 'apple';
type SignInResult = GoogleSignInResult;

/** The providers this build offers, in the order the screens show them: Apple first, as Apple asks. */
export function availableSignInProviders(): SignInProvider[] {
  const providers: SignInProvider[] = [];
  if (isAppleSignInConfigured()) {
    providers.push('apple');
  }
  if (isGoogleSignInConfigured()) {
    providers.push('google');
  }
  return providers;
}

export function isAccountSignInConfigured(): boolean {
  return availableSignInProviders().length > 0;
}

export async function signInWith(provider: SignInProvider): Promise<SignInResult> {
  if (!availableSignInProviders().includes(provider)) {
    return { status: 'unavailable' };
  }
  if (provider === 'apple') {
    return signInWithApple();
  }
  const result = await signInWithGoogle();
  if (result.status === 'signed_in') {
    // A Google account now: a session left from an Apple one must not route its backups.
    await signOutApple();
  }
  return result;
}

/** The fresh token for the account `sub`, from the provider that account signed in with. */
export async function getFreshIdToken(sub: string): Promise<FreshIdTokenResult> {
  return sub.startsWith(APPLE_SUB_PREFIX) ? getFreshAppleToken(sub.slice(APPLE_SUB_PREFIX.length)) : getFreshGoogleToken(sub);
}

/**
 * What the account's provider gives for deleting it: for an Apple account,
 * Apple's one-time code, so the server can end the sign-in at Apple too
 * (appleDeletionCode). A Google account has nothing to add — Google's grant
 * ends with Google's own account settings, and the server keeps no token of
 * it.
 */
export async function getAccountDeletionGrant(
  sub: string,
): Promise<{ status: 'ok'; appleAuthorizationCode: string } | { status: 'cancelled' } | { status: 'none' }> {
  if (!sub.startsWith(APPLE_SUB_PREFIX)) {
    return { status: 'none' };
  }
  const result = await appleDeletionCode(sub.slice(APPLE_SUB_PREFIX.length));
  return result.status === 'ok' ? { status: 'ok', appleAuthorizationCode: result.code } : result;
}

/** On coming back to the app: an Apple session inside its renewal window is renewed, backup or not. */
export async function renewSessionIfDue(sub: string): Promise<void> {
  if (sub.startsWith(APPLE_SUB_PREFIX)) {
    await renewAppleSessionIfDue(sub.slice(APPLE_SUB_PREFIX.length));
  }
}

export async function signOutAccount(): Promise<void> {
  await signOutApple();
  if (isGoogleSignInConfigured()) {
    await signOutGoogle();
  }
}
