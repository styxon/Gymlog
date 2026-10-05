/**
 * The one place the app touches Google Sign-In.
 *
 * Two gates decide whether the feature exists in this build:
 * - EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID — without it there is no OAuth client to
 *   sign in against, and every screen treats the feature as absent. No dead
 *   buttons: a build without the id shows no sign-in card anywhere.
 * - On iOS, also EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. app.config.js turns it into
 *   the URL scheme Google's iOS SDK returns through; without the scheme the
 *   SDK throws natively, so an iOS build without the id has no sign-in.
 * - The native module itself. It arrives with a prebuild; a dev client built
 *   before it is added would crash on a top-level import, so the require is
 *   lazy and a missing module reports `unavailable` instead of throwing.
 */
import { Platform } from 'react-native';

export interface GoogleAccount {
  /** Google's stable subject — the backup key. Never shown to the user. */
  sub: string;
  email: string | null;
  name: string | null;
  /** Short-lived ID token the backup endpoint verifies. */
  idToken: string;
}

export type GoogleSignInResult =
  | { status: 'signed_in'; account: GoogleAccount }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'failed' };

const WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
const IOS_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();

export function isGoogleSignInConfigured(): boolean {
  if (Platform.OS === 'ios' && IOS_CLIENT_ID.length === 0) {
    return false;
  }
  return WEB_CLIENT_ID.length > 0;
}

/**
 * The slice of the library this file actually calls, typed by hand: the
 * package ships ESM-only types that a CJS-mode `typeof import` cannot name,
 * and the lazy require below erases them anyway.
 */
interface GoogleSigninModule {
  GoogleSignin: {
    configure(options: { webClientId: string; iosClientId?: string }): void;
    hasPlayServices(options?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean>;
    signIn(): Promise<
      | { type: 'success'; data: { idToken: string | null; user: { id: string; email: string | null; name: string | null } } }
      | { type: 'cancelled'; data: null }
    >;
    signInSilently(): Promise<
      | { type: 'success'; data: { idToken: string | null; user: { id: string; email: string | null; name: string | null } } }
      | { type: 'noSavedCredentialFound'; data: null }
    >;
    signOut(): Promise<unknown>;
  };
  statusCodes?: { SIGN_IN_CANCELLED?: string; IN_PROGRESS?: string };
}

let configured = false;

function loadModule(): GoogleSigninModule | null {
  if (!isGoogleSignInConfigured()) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
    if (!configured) {
      loaded.GoogleSignin.configure(
        Platform.OS === 'ios' ? { webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID } : { webClientId: WEB_CLIENT_ID },
      );
      configured = true;
    }
    return loaded;
  } catch {
    // The build predates the native module (no prebuild yet).
    return null;
  }
}

function decodeSubFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(globalThis.atob ? globalThis.atob(normalized) : Buffer.from(normalized, 'base64').toString('utf8')) as {
      sub?: string;
    };
    return typeof decoded.sub === 'string' && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const module = loadModule();
  if (!module) {
    return { status: 'unavailable' };
  }
  try {
    await module.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await module.GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      return { status: 'cancelled' };
    }
    const idToken = response.data.idToken;
    if (!idToken) {
      return { status: 'failed' };
    }
    const sub = decodeSubFromIdToken(idToken) ?? response.data.user.id;
    return {
      status: 'signed_in',
      account: {
        sub,
        email: response.data.user.email ?? null,
        name: response.data.user.name ?? null,
        idToken,
      },
    };
  } catch (error) {
    // A sheet the reader dismissed can arrive as a rejection with the
    // library's own cancel code rather than as `type: 'cancelled'` — that is
    // the reader changing their mind, not a failed sign-in (and not an error
    // report), as Apple's cancel is handled.
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== undefined && code === module.statusCodes?.SIGN_IN_CANCELLED) {
      return { status: 'cancelled' };
    }
    return { status: 'failed' };
  }
}

export type FreshIdTokenResult =
  | { status: 'ok'; idToken: string }
  /** Google has no saved credential for this app: the session is really gone. */
  | { status: 'signed_out' }
  /** Anything else — offline, Play services busy, a timeout. Try again later. */
  | { status: 'error' };

/**
 * A fresh short-lived ID token for a background backup, without UI.
 *
 * Only the library's own "no saved credential" answer (SIGN_IN_REQUIRED,
 * which it returns as `noSavedCredentialFound`) means signed out; the caller
 * then downgrades the account, so the next backup asks the reader to sign in
 * again instead of failing silently forever. Every other failure used to mean
 * the same thing, so opening the app offline quietly signed the reader out,
 * and nothing was backed up again until they noticed.
 */
/**
 * `expectedSub` is the stored account the token is for. The library hands back
 * whichever Google account it holds, and a sign-in killed between the
 * provider's success and the account being stored, or a swallowed sign-out,
 * can leave it holding another one — whose token then backed up this phone's
 * data into that account's copy, or restored that copy here (bug hunt,
 * 2026-10-05). Apple's token already refuses a session of another user; this
 * does the same, as the same answer: that account is signed out here.
 */
export async function getFreshIdToken(expectedSub?: string): Promise<FreshIdTokenResult> {
  const module = loadModule();
  if (!module) {
    return { status: 'error' };
  }
  try {
    const response = await module.GoogleSignin.signInSilently();
    if (response.type === 'noSavedCredentialFound') {
      return { status: 'signed_out' };
    }
    const idToken = response.type === 'success' ? response.data.idToken : null;
    if (!idToken) {
      return { status: 'error' };
    }
    if (expectedSub !== undefined) {
      const sub = decodeSubFromIdToken(idToken) ?? response.data.user.id;
      if (sub !== expectedSub) {
        return { status: 'signed_out' };
      }
    }
    return { status: 'ok', idToken };
  } catch {
    return { status: 'error' };
  }
}

export async function signOutGoogle(): Promise<void> {
  const module = loadModule();
  if (!module) {
    return;
  }
  try {
    await module.GoogleSignin.signOut();
  } catch {
    // Signing out of a session that is already gone is still signed out.
  }
}
