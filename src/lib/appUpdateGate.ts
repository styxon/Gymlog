/**
 * The server's way to tell an old build to update, and the app's way to hear it.
 *
 * Once the app is in the stores, builds stay on phones for months or years,
 * and every one of them keeps calling the same endpoints. Without a version on
 * the request the server cannot tell them apart, so every change it makes has
 * to work for every build ever shipped — and a build shipped without this
 * cannot be given it later. So every request to our server carries the app's
 * version and platform, and a server that no longer understands a build can
 * refuse it with an answer that build knows to turn into "update the app".
 *
 * The version rides on the requests the reader already makes (backup, coach,
 * statistics); nothing new is sent to check it. A phone that never reaches the
 * server is never refused — and nothing on the server can break it either.
 *
 * Shared by api/ (which refuses) and the app (which listens), so both read
 * the same header names and the same comparison.
 */

const APP_VERSION_HEADER = 'x-vinha-app-version';
const APP_PLATFORM_HEADER = 'x-vinha-platform';

/** The `error` of a refusal, sent with HTTP 426 Upgrade Required. */
export const APP_UPDATE_REQUIRED = 'APP_UPDATE_REQUIRED';

export type AppPlatform = 'android' | 'ios';

export interface AppIdentity {
  version: string;
  platform: AppPlatform;
}

export function isAppPlatform(value: unknown): value is AppPlatform {
  return value === 'android' || value === 'ios';
}

/**
 * "1.1.0" as [1, 1, 0]. One to three dot-separated numbers; "1.2" is 1.2.0.
 * Anything else — a suffix, a letter, a fourth part — is null, and every
 * caller treats null as "cannot tell", never as "too old".
 */
export function parseAppVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{1,6}(\.\d{1,6}){0,2}$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) {
    parts.push(0);
  }
  return [parts[0], parts[1], parts[2]];
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareAppVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

/** The request headers an app build sends to our server. */
export function appIdentityHeaders(identity: AppIdentity | null): Record<string, string> {
  if (!identity) {
    return {};
  }
  return { [APP_VERSION_HEADER]: identity.version, [APP_PLATFORM_HEADER]: identity.platform };
}

/**
 * The server's environment (process.env). Three settings are read, each
 * optional: APP_MIN_VERSION_ANDROID, APP_MIN_VERSION_IOS and APP_STORE_URL_IOS.
 */
type AppUpdateServerEnv = Record<string, string | undefined>;

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether the server should refuse this request as coming from a build too
 * old for it. Every doubt answers no:
 *
 * - no version header: a build from before this existed, which cannot show
 *   the update prompt, so refusing it would only look like an outage;
 * - an unknown platform or an unreadable version: not one of ours to judge;
 * - no minimum set for the platform, or one that does not parse: the server
 *   has not asked for anything, and a typo in a setting must not lock every
 *   phone out.
 *
 * Only a readable version below a readable minimum is refused.
 */
export function isAppVersionRefused(
  headers: Record<string, string | string[] | undefined>,
  env: AppUpdateServerEnv,
): boolean {
  const platform = headerValue(headers, APP_PLATFORM_HEADER)?.trim();
  const version = parseAppVersion(headerValue(headers, APP_VERSION_HEADER));
  if (!version || !isAppPlatform(platform)) {
    return false;
  }
  const minimum = parseAppVersion(platform === 'android' ? env.APP_MIN_VERSION_ANDROID : env.APP_MIN_VERSION_IOS);
  if (!minimum) {
    return false;
  }
  return compareAppVersions(version, minimum) < 0;
}

/** Where an app is sent to update. The server may override it; see appStoreUrl. */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.vinha';

/**
 * The body of a refusal. The store address travels with it, so an iOS build
 * shipped before the App Store listing existed can still be sent to it.
 */
export function appUpdateRefusalBody(
  headers: Record<string, string | string[] | undefined>,
  env: AppUpdateServerEnv,
): { ok: false; error: typeof APP_UPDATE_REQUIRED; storeUrl?: string } {
  const platform = headerValue(headers, APP_PLATFORM_HEADER)?.trim();
  const storeUrl = platform === 'ios' ? safeStoreUrl(env.APP_STORE_URL_IOS) : PLAY_STORE_URL;
  return storeUrl ? { ok: false, error: APP_UPDATE_REQUIRED, storeUrl } : { ok: false, error: APP_UPDATE_REQUIRED };
}

/**
 * The two stores' own addresses, and nothing else. The app opens this with the
 * system's link handler, so a server answer (or anything posing as one) must
 * not be able to send the reader to an arbitrary page.
 */
const STORE_URL = /^https:\/\/(play\.google\.com|apps\.apple\.com)\/[^\s]*$/;

export function safeStoreUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return STORE_URL.test(trimmed) ? trimmed : null;
}

/**
 * Whether a response is our server refusing this build. Both parts, never the
 * status alone: a 426 from a proxy or a captive portal is not a request to
 * update, and the prompt it would raise is not one to show by mistake.
 */
export function isAppUpdateRefusal(status: number, body: unknown): boolean {
  return (
    status === 426 &&
    Boolean(body) &&
    typeof body === 'object' &&
    (body as { error?: unknown }).error === APP_UPDATE_REQUIRED
  );
}

/** Where to send the reader: the server's store address if it is a store's, else the platform's own. */
export function appStoreUrl(platform: AppPlatform | null, body: unknown): string | null {
  const fromServer =
    body && typeof body === 'object' ? safeStoreUrl((body as { storeUrl?: unknown }).storeUrl) : null;
  if (fromServer) {
    return fromServer;
  }
  return platform === 'android' ? PLAY_STORE_URL : null;
}
