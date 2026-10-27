/**
 * The app's side of lib/appUpdateGate: who this build is, and whether the
 * server has said it is too old.
 *
 * Free of React Native on purpose. The clients that talk to the server
 * (features/aiCoach/aiCoachClient, features/account/backupApi, features/analytics) run
 * under the Node test suites too, so the version and platform are handed in
 * once by App.tsx (registerAppIdentity) rather than read here.
 *
 * The refusal is kept in memory only. A build the server refuses is refused on
 * every request, so the next launch that reaches the server hears it again;
 * a build the server has since let back in simply never hears it.
 */
import {
  AppIdentity,
  AppPlatform,
  appIdentityHeaders,
  appStoreUrl,
  isAppPlatform,
  isAppUpdateRefusal,
  parseAppVersion,
} from '../../lib/appUpdateGate';

export interface AppUpdateNotice {
  /** The store page to open, or null when this platform has none to name. */
  storeUrl: string | null;
}

let identity: AppIdentity | null = null;
let notice: AppUpdateNotice | null = null;
const listeners = new Set<(next: AppUpdateNotice | null) => void>();

/**
 * Called once, before anything talks to the server. A version that does not
 * parse is not sent at all: the server would ignore it anyway, and a header
 * the server cannot read is one it must not be tempted to act on.
 */
export function registerAppIdentity(version: unknown, platform: unknown): void {
  const text = typeof version === 'string' ? version.trim() : '';
  identity = parseAppVersion(text) && isAppPlatform(platform) ? { version: text, platform } : null;
}

export function currentAppPlatform(): AppPlatform | null {
  return identity?.platform ?? null;
}

/** The registered version, for the error reports; null until registered. */
export function currentAppVersion(): string | null {
  return identity?.version ?? null;
}

/** The headers every request to our server carries. Empty until registered. */
export function appVersionHeaders(): Record<string, string> {
  return appIdentityHeaders(identity);
}

/**
 * Every client passes each answer from our server through here. Only our
 * server's own refusal raises the notice (lib/appUpdateGate isAppUpdateRefusal).
 */
export function noteServerAnswer(status: number, body: unknown): void {
  if (notice || !isAppUpdateRefusal(status, body)) {
    return;
  }
  notice = { storeUrl: appStoreUrl(currentAppPlatform(), body) };
  listeners.forEach((listener) => listener(notice));
}

export function getAppUpdateNotice(): AppUpdateNotice | null {
  return notice;
}

export function subscribeAppUpdateNotice(listener: (next: AppUpdateNotice | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
