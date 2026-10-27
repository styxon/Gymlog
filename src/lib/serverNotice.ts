import type { AppLanguage } from '../types/models';

/**
 * Two things the server says to every app, whatever it was asked
 * (docs/tietoturvaloukkaus.md):
 *
 * - **A notice**: one message, in Finnish and English, that the app shows once
 *   — a service break, a security incident, anything readers must hear from
 *   us. The app never collected an email address, so this is the one way to
 *   reach everyone who opens the app.
 * - **A pause**: every server feature answers "paused" until it is lifted —
 *   the first step when something has leaked is to stop it leaking.
 *
 * Both are Vercel environment variables, read on each request:
 *
 *   APP_NOTICE     = {"id":"2026-11-03-backup","fi":{"title":"…","body":"…"},"en":{"title":"…","body":"…"}}
 *   SERVICE_PAUSED = 1
 *
 * A changed variable reaches the server with the next deployment (Vercel →
 * Deployments → Redeploy). Shared by api/ (which says it) and the app (which
 * reads it), so both parse the same shape.
 */

interface ServerNoticeText {
  title: string;
  body: string;
}

export interface ServerNotice {
  /** Shown once per id: a new id is a new notice. */
  id: string;
  fi: ServerNoticeText;
  en: ServerNoticeText;
}

/** The `error` of every paused answer, sent with HTTP 503. */
export const SERVICE_PAUSED = 'SERVICE_PAUSED';

const MAX_ID_CHARS = 64;
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 800;
/** Enough to never show one twice; old ids fall off the front. */
export const MAX_SEEN_NOTICE_IDS = 20;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function noticeText(value: unknown): ServerNoticeText | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title, MAX_TITLE_CHARS);
  const body = text(row.body, MAX_BODY_CHARS);
  return title && body ? { title, body } : null;
}

/**
 * A notice in both languages, or null. Half a notice is none: a reader must
 * never get the other language's text, or an empty dialog, because one side
 * was left out when the variable was written.
 */
export function parseServerNotice(value: unknown): ServerNotice | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, MAX_ID_CHARS);
  const fi = noticeText(row.fi);
  const en = noticeText(row.en);
  return id && fi && en ? { id, fi, en } : null;
}

type Env = Record<string, string | undefined>;

/** APP_NOTICE, parsed. A variable that does not parse is no notice, never an error. */
export function serverNoticeFromEnv(env: Env): ServerNotice | null {
  const raw = env.APP_NOTICE?.trim();
  if (!raw) return null;
  try {
    return parseServerNotice(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function isServicePaused(env: Env): boolean {
  return env.SERVICE_PAUSED?.trim() === '1';
}

/** The body every paused endpoint answers with. */
export function servicePausedBody(): { ok: false; error: typeof SERVICE_PAUSED } {
  return { ok: false, error: SERVICE_PAUSED };
}

export function serverNoticeText(notice: ServerNotice, language: AppLanguage): ServerNoticeText {
  return language === 'fi' ? notice.fi : notice.en;
}

/** The notice to show now: one the reader has not closed before. */
export function unseenServerNotice(notice: ServerNotice | null, seenIds: readonly string[]): ServerNotice | null {
  return notice && !seenIds.includes(notice.id) ? notice : null;
}

/** The seen list after closing `id`: newest last, capped, no repeats. */
export function rememberServerNotice(seenIds: readonly string[], id: string): string[] {
  return [...seenIds.filter((seen) => seen !== id), id].slice(-MAX_SEEN_NOTICE_IDS);
}

/** Stored ids, re-read on load: strings of a sane length, capped. */
export function normalizeSeenNoticeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS)
    .slice(-MAX_SEEN_NOTICE_IDS);
}

/**
 * Where the app asks for the notice: the same server as its other features.
 * Derived from whichever server address this build has, so it adds no build
 * variable that could be forgotten — every EXPO_PUBLIC_ variable left unset
 * switches its feature off without a word.
 */
export function serverNoticeUrl(serverUrls: readonly (string | undefined)[]): string | null {
  // A plain match rather than `new URL`: React Native's URL is a regex
  // polyfill that parses differently from Node's, and the suite runs on Node.
  for (const candidate of serverUrls) {
    const origin = (candidate ?? '').trim().match(/^(https?):\/\/([^/?#\s]+)/i);
    if (origin) {
      return `${origin[1].toLowerCase()}://${origin[2]}/api/notice`;
    }
  }
  return null;
}

/**
 * How often the app asks again while it stays open: at launch, and on coming
 * back to the foreground once this long has passed. A notice is for a rare
 * event; asking on every foreground would be a request per glance at the phone.
 */
export const SERVER_NOTICE_RECHECK_MS = 6 * 60 * 60 * 1000;

/** After a failed ask (offline, a 5xx) the next one waits this long, not hours. */
export const SERVER_NOTICE_RETRY_MS = 5 * 60 * 1000;

/**
 * Whether to ask now. Only an answer from the server starts the long window
 * (`lastAnsweredMs`): a failed ask — the usual outcome of opening the app on
 * a bad connection — used to count as one and silenced a service-break notice
 * for six hours. A failure (`lastFailedMs`) only backs off briefly.
 */
export function shouldCheckServerNotice(
  lastAnsweredMs: number | null,
  nowMs: number,
  lastFailedMs: number | null = null,
): boolean {
  if (lastFailedMs !== null && nowMs >= lastFailedMs && nowMs - lastFailedMs < SERVER_NOTICE_RETRY_MS) {
    return false;
  }
  return lastAnsweredMs === null || nowMs - lastAnsweredMs >= SERVER_NOTICE_RECHECK_MS || nowMs < lastAnsweredMs;
}
