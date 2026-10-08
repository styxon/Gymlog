import { buildAiCoachPreviewAnswer } from './aiCoachPreview';
import { classifyCoachScope } from './aiCoachScope';
import { resolveLiveAiCoachUrl } from './aiCoachLiveGate';
import { ProgramImageMediaType, ProgramTableRow, validateProgramTable } from './programImageImport';
import { AICoachAdvice, AICoachAdviceError, AICoachAdviceRequest, AICoachAdviceSuccess } from '../types/aiCoach';
import { appVersionHeaders, noteServerAnswer } from '../features/appUpdate/appUpdateSignal';
import { buildCoachReportBody, CoachReportReason } from './coachAnswerReport';
import { COACH_COPIES_KEPT } from './aiCoachLogId';
import { isCoachCrisisReply } from './coachCrisisTurn';

// The key the endpoint asks for on every call (api/ai-coach.ts, hasAppKey).
// Without it the server refuses, so a build that lacks it is a preview build
// and never makes the round trip.
const AI_COACH_APP_KEY = (process.env.EXPO_PUBLIC_AI_COACH_APP_KEY ?? '').trim();
// Routed through the spend-cap gate: a release build only sees the URL after
// a human has confirmed the Console usage limit (see aiCoachLiveGate.ts).
const AI_COACH_SERVER_URL = resolveLiveAiCoachUrl(
  process.env.EXPO_PUBLIC_AI_COACH_API_URL,
  process.env.NODE_ENV !== 'production',
);
// And only with the key: a build that has the server but not the key would
// be refused on every call, so it never makes the round trip.
const AI_COACH_API_URL = AI_COACH_APP_KEY ? AI_COACH_SERVER_URL : '';

/**
 * Every request's headers: JSON, the key that opens the endpoint, and which
 * build is asking (lib/appUpdateGate).
 */
function coachHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-vinha-app-key': AI_COACH_APP_KEY, ...appVersionHeaders() };
}
// Outer bound over the endpoint's 30 s Claude timeout plus the round trip.
// Also how long after a request its kept copy may still be written
// (lib/aiLogDeletion AI_LOG_WRITE_WINDOW_MS, pinned equal to this).
const REQUEST_TIMEOUT_MS = 40000;

/**
 * When a request carrying each coach-log label last left the phone.
 *
 * The server keeps a copy after the model answers, so a delete sent while a
 * question is still being answered misses that one copy. The withdrawal and
 * the delete retries read this to know when a delete of the label is final
 * (lib/aiLogDeletion, server audit 2026-09-21). Kept in memory: an app
 * restarted inside those forty seconds forgets it, which leaves the one late
 * copy to the 24-month sweep — the narrow case this cannot reach.
 */
const aiLogCarriedAt = new Map<string, number>();

/**
 * The permission as it leaves the phone: no while copies are off, whatever the
 * stored answer says, and never a label without a yes. Every request that can
 * carry one goes through this, so none can send a copy past the switch.
 */
function keepFields(keepConsent: boolean | undefined, logId: string | null | undefined): { keepConsent: boolean; logId?: string } {
  const keep = COACH_COPIES_KEPT && keepConsent === true;
  return keep && logId ? { keepConsent: true, logId } : { keepConsent: false };
}

function noteAiLogCarried(keepConsent: boolean | undefined, logId: string | null | undefined) {
  if (COACH_COPIES_KEPT && keepConsent === true && logId) {
    aiLogCarriedAt.set(logId, Date.now());
  }
}

export function lastAiLogCarriedAt(logId: string): number | null {
  return aiLogCarriedAt.get(logId) ?? null;
}

export interface RequestAiCoachAdviceResult {
  answer: AICoachAdvice;
  source: 'live' | 'preview';
  note?: string;
  /**
   * The server turned the question away for rate — too many from this
   * address in its window, or the coach's spend window full. Not an outage:
   * the chat says "ask again in a while" instead of going OFFLINE with the
   * canned answer (#bugs, 2026-09-30: "menikö offlineen koska viestiraja?").
   */
  limited?: boolean;
  /**
   * The crisis answer: this build's filter caught the question, or the server
   * said its own did (`crisis: true`, or the crisis answer's words from a
   * server older than the marker). The chat draws it as a crisis message and
   * keeps nothing of the thread the server may have caught it in.
   */
  crisis?: true;
}

/**
 * Whether this build can reach a coach server at all. The same check the
 * request path makes, exported so a screen can state which mode the user is in
 * rather than guessing — in preview mode nothing they log leaves the device,
 * and that is worth being able to say out loud.
 */
export function isAiCoachLiveConfigured() {
  return AI_COACH_API_URL.length > 0;
}

function getAbortSignal(timeoutMs: number, upstreamSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const handleAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener('abort', handleAbort);
      }
    },
  };
}

function isSuccessResponse(value: unknown): value is AICoachAdviceSuccess {
  return Boolean(value) && typeof value === 'object' && (value as AICoachAdviceSuccess).ok === true;
}

function isErrorResponse(value: unknown): value is AICoachAdviceError {
  return Boolean(value) && typeof value === 'object' && (value as AICoachAdviceError).ok === false;
}

/**
 * Flags one coach answer for the team to review (lib/coachAnswerReport).
 * `true` only when the server says it arrived: the sheet shows "sent" on
 * that and on nothing else.
 */
export async function reportAiCoachAnswer(reason: CoachReportReason, advice: AICoachAdvice): Promise<boolean> {
  if (!AI_COACH_API_URL) {
    return false;
  }
  const { signal, cleanup } = getAbortSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(AI_COACH_API_URL, {
      method: 'POST',
      headers: coachHeaders(),
      body: JSON.stringify(buildCoachReportBody(reason, advice)),
      signal,
    });
    const payload = (await response.json()) as { ok?: boolean };
    noteServerAnswer(response.status, payload);
    return response.ok && payload.ok === true;
  } catch {
    return false;
  } finally {
    cleanup();
  }
}

/**
 * Take back permission: ask the server to delete every copy under this label.
 *
 * Fire-and-report rather than fire-and-forget — the caller turns the switch off
 * on the phone whatever this returns, because a reader who said stop has said
 * stop. What the answer decides is whether we can also claim the old copies are
 * gone. Preview builds have no server and nothing was ever kept, so there is
 * nothing to delete and saying so is not a failure.
 */
export async function forgetAiCoachLog(logId: string): Promise<{ ok: boolean; removed: number }> {
  if (!AI_COACH_SERVER_URL) {
    return { ok: true, removed: 0 };
  }
  // A server this build cannot open is not a server with nothing on it: the
  // copies an earlier build kept are still there, so the label has to stay
  // until a build with the key can ask for them to go.
  if (!AI_COACH_API_URL) {
    return { ok: false, removed: 0 };
  }
  const { signal, cleanup } = getAbortSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(AI_COACH_API_URL, {
      method: 'POST',
      headers: coachHeaders(),
      body: JSON.stringify({ mode: 'forget', logId }),
      signal,
    });
    const payload = (await response.json()) as { ok?: boolean; removed?: number };
    noteServerAnswer(response.status, payload);
    return {
      ok: response.ok && payload.ok === true,
      removed: typeof payload.removed === 'number' ? payload.removed : 0,
    };
  } catch {
    return { ok: false, removed: 0 };
  } finally {
    cleanup();
  }
}

export async function requestAiCoachAdvice(input: AICoachAdviceRequest, upstreamSignal?: AbortSignal): Promise<RequestAiCoachAdviceResult> {
  /**
   * A reader in trouble is answered here, before anything goes anywhere.
   *
   * The rule is on the server too, but this is the one answer that must not
   * depend on a connection, on the spend cap, or on the model doing as it is
   * told — and the message itself is the last thing that should travel. The
   * answer is one sentence and a number to call, built by the same offline
   * coach that handles the no-URL case.
   */
  if (classifyCoachScope(input.prompt) === 'crisis') {
    return {
      answer: buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      source: 'preview',
      note: undefined,
      crisis: true,
    };
  }

  if (!AI_COACH_API_URL) {
    return {
      answer: buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      source: 'preview',
      note: 'Preview mode.',
    };
  }

  const { signal, cleanup } = getAbortSignal(REQUEST_TIMEOUT_MS, upstreamSignal);

  try {
    noteAiLogCarried(input.keepConsent, input.logId);
    const response = await fetch(AI_COACH_API_URL, {
      method: 'POST',
      headers: coachHeaders(),
      body: JSON.stringify({ ...input, logId: undefined, ...keepFields(input.keepConsent, input.logId) }),
      signal,
    });

    const payload = (await response.json()) as unknown;
    noteServerAnswer(response.status, payload);

    if (response.ok && isSuccessResponse(payload)) {
      return {
        answer: payload.answer,
        source: payload.source,
        note: payload.note,
        ...(isCoachCrisisReply({ crisis: payload.crisis, takeaway: payload.answer?.takeaway }) ? { crisis: true as const } : {}),
      };
    }

    if (isErrorResponse(payload) && payload.error?.code === 'RATE_LIMIT') {
      return {
        answer: payload.fallback ?? buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
        source: 'preview',
        note: payload.note ?? payload.error.message,
        limited: true,
      };
    }

    if (isErrorResponse(payload) && payload.fallback) {
      return {
        answer: payload.fallback,
        source: 'preview',
        note: payload.note ?? payload.error.message,
      };
    }

    return {
      answer: buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      source: 'preview',
      note: 'Live error. Preview answer.',
    };
  } catch {
    return {
      answer: buildAiCoachPreviewAnswer(input.prompt, input.context, input.language),
      source: 'preview',
      note: 'Live unavailable. Preview answer.',
    };
  } finally {
    cleanup();
  }
}

/**
 * The composer's live path: the brief and the training context go to the
 * same endpoint with `mode: 'compose'`, and Claude returns a week as NAMES.
 * Resolving those names to the library is the caller's job
 * (programmeBrief.resolveLiveProposal), so this function stays a transport.
 *
 * Returns null whenever the live path cannot answer — not configured, refused,
 * timed out, or the payload is not a proposal — and the caller composes
 * locally. There is no fallback proposal in the response the way advice has
 * one: the deterministic composer needs the exercise library, which lives on
 * the device, not on the server.
 *
 * Except a brief read as a crisis, by this build's filter or the server's:
 * that comes back as the crisis answer, for the chat to say. Read as "no
 * proposal", it had the device compose a week from the words (review,
 * 2026-10-08).
 */
export interface LiveProgrammeProposalPayload {
  title: string;
  sessions: Array<{
    name: string;
    focus?: string;
    exercises: Array<{ name: string; sets: number; repsMin: number; repsMax: number; restSeconds?: number }>;
  }>;
}

/** A brief answered with the crisis answer instead of a week. */
export interface ProgrammeCompositionCrisis {
  crisis: true;
  answer: AICoachAdvice;
}

export function isProgrammeCompositionCrisis(value: unknown): value is ProgrammeCompositionCrisis {
  return Boolean(value) && typeof value === 'object' && (value as ProgrammeCompositionCrisis).crisis === true;
}

function isProposalPayload(value: unknown): value is { ok: true; proposal: LiveProgrammeProposalPayload } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { ok?: unknown; proposal?: { title?: unknown; sessions?: unknown } };
  return (
    record.ok === true &&
    Boolean(record.proposal) &&
    typeof record.proposal?.title === 'string' &&
    Array.isArray(record.proposal?.sessions)
  );
}

/**
 * Read a programme out of a photograph.
 *
 * Returns the rows, or null when the app cannot reach a server or the answer
 * is not one. Null is deliberately indistinguishable from "the image had no
 * programme in it" at this layer: both leave the reader with nothing to
 * import, and the screen says so once rather than in two shades.
 *
 * The image is a one-off upload the reader initiated by choosing a photo, so
 * needing the network here is acceptable in a way it is not for logging a set.
 */
export async function requestProgramTableFromImage(
  input: {
    dataBase64: string;
    mediaType: ProgramImageMediaType;
    /** The photo line of the consent sheet. Absent or false keeps nothing. */
    keepConsent?: boolean;
    /** The label a kept photo is filed under, so it can be deleted again. */
    logId?: string | null;
  },
  upstreamSignal?: AbortSignal,
): Promise<ProgramTableRow[] | null> {
  if (!AI_COACH_API_URL) {
    return null;
  }
  const { signal, cleanup } = getAbortSignal(REQUEST_TIMEOUT_MS, upstreamSignal);
  try {
    noteAiLogCarried(input.keepConsent, input.logId);
    const response = await fetch(AI_COACH_API_URL, {
      method: 'POST',
      headers: coachHeaders(),
      body: JSON.stringify({
        mode: 'table',
        mediaType: input.mediaType,
        dataBase64: input.dataBase64,
        // Sent every time from the switch as it stands, and paired with the
        // label: the server refuses to keep anything without one, which
        // closes the window between the first yes and the id landing.
        ...keepFields(input.keepConsent, input.logId),
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown; rows?: unknown } | null;
    noteServerAnswer(response.status, payload);
    if (!response.ok || !payload) {
      return null;
    }
    // Validated again on the way in, with the same function the server used
    // on the way out: this side cannot assume the server it reached is the
    // one this build was written against.
    return payload?.ok === true ? validateProgramTable(payload) : null;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

export async function requestProgrammeComposition(
  input: {
    brief: string;
    context: AICoachAdviceRequest['context'];
    language?: 'fi' | 'en';
    /** The composer line of the consent sheet. Absent or false keeps nothing. */
    keepConsent?: boolean;
    /** The label a kept programme is filed under, so it can be deleted again. */
    logId?: string | null;
  },
  upstreamSignal?: AbortSignal,
): Promise<LiveProgrammeProposalPayload | ProgrammeCompositionCrisis | null> {
  // Before anything goes anywhere, as for a question: the brief can carry the
  // intake's free-text answer, and an offline build would build a week on it.
  if (classifyCoachScope(input.brief) === 'crisis') {
    return { crisis: true, answer: buildAiCoachPreviewAnswer(input.brief, input.context, input.language) };
  }
  if (!AI_COACH_API_URL) {
    return null;
  }
  const { signal, cleanup } = getAbortSignal(REQUEST_TIMEOUT_MS, upstreamSignal);
  try {
    noteAiLogCarried(input.keepConsent, input.logId);
    const response = await fetch(AI_COACH_API_URL, {
      method: 'POST',
      headers: coachHeaders(),
      body: JSON.stringify({
        mode: 'compose',
        prompt: input.brief,
        context: input.context,
        language: input.language,
        ...keepFields(input.keepConsent, input.logId),
      }),
      signal,
    });
    const payload = (await response.json()) as unknown;
    noteServerAnswer(response.status, payload);
    if (
      response.ok &&
      isSuccessResponse(payload) &&
      typeof payload.answer?.takeaway === 'string' &&
      isCoachCrisisReply({ crisis: payload.crisis, takeaway: payload.answer.takeaway })
    ) {
      return { crisis: true, answer: payload.answer };
    }
    return response.ok && isProposalPayload(payload) ? payload.proposal : null;
  } catch {
    return null;
  } finally {
    cleanup();
  }
}
