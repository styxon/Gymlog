/**
 * The app's side of api/notice: ask the server whether it has something to
 * say to every reader (lib/serverNotice). Silent on any failure — offline, a
 * build with no server address, an answer that does not parse — because a
 * notice that cannot be fetched is simply not shown. The caller tells the two
 * apart: null is a failed ask, an answer with `notice: null` is "nothing to
 * say" — only the latter counts as having checked (shouldCheckServerNotice).
 */
import { parseServerNotice, ServerNotice, serverNoticeUrl } from '../../lib/serverNotice';
import { appVersionHeaders, noteServerAnswer } from '../appUpdate/appUpdateSignal';

// Literal reads: Expo inlines EXPO_PUBLIC_ variables only when written out.
const NOTICE_URL = serverNoticeUrl([
  process.env.EXPO_PUBLIC_AI_COACH_API_URL,
  process.env.EXPO_PUBLIC_BACKUP_API_URL,
  process.env.EXPO_PUBLIC_ANALYTICS_URL,
]);
const REQUEST_TIMEOUT_MS = 8000;

interface ServerNoticeAnswer {
  notice: ServerNotice | null;
  paused: boolean;
}

export async function fetchServerNotice(): Promise<ServerNoticeAnswer | null> {
  if (!NOTICE_URL) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(NOTICE_URL, { headers: appVersionHeaders(), signal: controller.signal });
    const body = (await response.json().catch(() => null)) as { ok?: unknown; notice?: unknown; paused?: unknown } | null;
    // Like every answer from our server: a refusal of this build is heard here too.
    noteServerAnswer(response.status, body);
    if (!response.ok || !body || body.ok !== true) {
      return null;
    }
    return { notice: parseServerNotice(body.notice), paused: body.paused === true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
