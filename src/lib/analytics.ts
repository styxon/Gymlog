/**
 * Anonymous usage events — the answer to "is some step so hard that people
 * quit there" (user, 2026-08-25).
 *
 * The design constraint is the app's own privacy stance: Vinha's pitch is
 * that data stays on the phone. So this collects the minimum that answers
 * real questions and nothing more:
 *
 *  - a random install id, generated on the device, tied to nothing — not the
 *    account, not the email, not the advertising id
 *  - WHICH screen-level steps happened and when — never what was in them:
 *    no exercise names, no weights, no measurements, no question texts
 *
 * The allowlist below is the entire vocabulary. The client refuses to queue
 * anything outside it and the server refuses to store it, so a future call
 * site cannot quietly start shipping something new: widening the vocabulary
 * is a visible edit here, which is exactly where a privacy reviewer looks.
 * An event that answers no question is noise — the same rule as the labels.
 */

import {
  isValidAppErrorProps,
  isValidOperationFailedProps,
  type AppErrorProps,
  type OperationFailedProps,
} from './errorReport';

export const ANALYTICS_EVENTS = [
  /**
   * The app was opened: a cold start, or a return after half an hour away
   * (lib/analyticsMoments). Daily actives and retention fall out.
   */
  'app_open',
  /**
   * An onboarding step was reached; `path` names it — welcome, the path
   * picker, about, the catalogue, a questionnaire stage. The funnel's spine.
   */
  'onboarding_step',
  /** Onboarding finished; `path` says whether built, picked ready, or started empty. */
  'onboarding_completed',
  /** A programme started running: a plan joined the running set. */
  'plan_adopted',
  /** A workout session was started — guided, free or cardio. */
  'workout_started',
  /** A workout session was saved. Started-without-completed is a finding. */
  'workout_completed',
  /** The Pro paywall was opened by a reader without Pro; once per visit. */
  'paywall_viewed',
  /** A question left for the coach (the fact of it — never the text). */
  'coach_question_asked',
  /**
   * The app failed in a way the reader would feel: a crash, a render error, an
   * unhandled rejection. Where the code failed, never what it held — see
   * lib/errorReport for the fields and for why there is no message.
   */
  'app_error',
  /** A save, backup, restore, load, deletion or sign-in failed; which, and a closed code. */
  'operation_failed',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  /** ISO timestamp, client clock. */
  at: string;
  /**
   * The step/path pair the funnel events carry, or — for the two error events
   * only — their own closed shapes (lib/errorReport). Anything else is refused.
   */
  props?: AnalyticsEventProps;
}

type StepProps = { step?: number; path?: string };
export type AnalyticsEventProps = StepProps | AppErrorProps | OperationFailedProps;

interface AnalyticsBatch {
  /** Random UUID minted on the device. Identifies an install, not a person. */
  installId: string;
  sentAt: string;
  events: AnalyticsEvent[];
}

/** More than this in one batch means a stuck queue, not a busy user. */
export const MAX_BATCH_EVENTS = 100;
/** Queue cap on the device: beyond this the oldest events are dropped. */
export const MAX_QUEUED_EVENTS = 200;
/**
 * Error events one batch may carry. Two launches' worth of the per-launch
 * budget (lib/errorReport): a phone that crashed twice offline still sends
 * both in one go, and a client that sends more is not counting.
 */
export const MAX_APP_ERRORS_PER_BATCH = 20;
const MAX_OPERATION_FAILURES_PER_BATCH = 40;

const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What Date.prototype.toISOString writes, which is the only thing the client
 * ever sends. `Date.parse` alone let free text through: V8 reads
 * "Oct 3 2026 (anything at all)" as a date, the parentheses being a comment,
 * and the endpoint stores the string verbatim — an open text field in a batch
 * that is meant to have none, with no length cap (hunt 3, 2026-10-03).
 */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ISO_TIMESTAMP_MAX_LENGTH = 30;

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= ISO_TIMESTAMP_MAX_LENGTH &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidEventName(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/**
 * One event, shape-checked. Unknown property keys reject the whole event —
 * an open props bag is how "just this one extra field" becomes tracking.
 */
export function isValidEvent(value: unknown): value is AnalyticsEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!isValidEventName(candidate.name)) {
    return false;
  }
  if (!isIsoTimestamp(candidate.at)) {
    return false;
  }
  const keys = Object.keys(candidate).filter((key) => key !== 'name' && key !== 'at' && key !== 'props');
  if (keys.length > 0) {
    return false;
  }
  // The error events have their own closed shapes and need them: a report
  // without its fields answers nothing, and no other event may carry them.
  if (candidate.name === 'app_error') {
    return isValidAppErrorProps(candidate.props);
  }
  if (candidate.name === 'operation_failed') {
    return isValidOperationFailedProps(candidate.props);
  }
  if (candidate.props === undefined) {
    return true;
  }
  if (!candidate.props || typeof candidate.props !== 'object') {
    return false;
  }
  const props = candidate.props as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    if (key === 'step') {
      if (typeof props.step !== 'number' || !Number.isInteger(props.step) || props.step < 0 || props.step > 50) {
        return false;
      }
    } else if (key === 'path') {
      if (typeof props.path !== 'string' || props.path.length > 32) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/**
 * What the server keeps of a batch: the events that are valid, and a count of
 * the ones it dropped.
 *
 * It used to be all or nothing, so one event the server did not know — a new
 * screen, an event shape from a newer app — got the whole batch a 400, and a
 * client that retries the head of its queue forever sent that batch forever
 * behind which no funnel event could leave. Now the valid events are kept and
 * the rest are counted and dropped; only a batch that is not a batch at all
 * (the envelope, or more than MAX_BATCH_EVENTS) is refused.
 */
interface AcceptedBatch {
  batch: AnalyticsBatch;
  dropped: number;
}

/** The accepted part of a batch, or null when the batch itself is malformed. */
export function acceptBatch(payload: unknown): AcceptedBatch | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.installId !== 'string' || !INSTALL_ID_PATTERN.test(candidate.installId)) {
    return null;
  }
  if (!isIsoTimestamp(candidate.sentAt)) {
    return null;
  }
  if (!Array.isArray(candidate.events) || candidate.events.length === 0 || candidate.events.length > MAX_BATCH_EVENTS) {
    return null;
  }
  const events: AnalyticsEvent[] = [];
  let errors = 0;
  let failures = 0;
  for (const event of candidate.events) {
    if (!isValidEvent(event)) {
      continue;
    }
    // The client composes its batches by takeBatch, which holds the same caps;
    // an error event past them is dropped, not a reason to refuse the rest.
    if (event.name === 'app_error') {
      if (errors >= MAX_APP_ERRORS_PER_BATCH) {
        continue;
      }
      errors += 1;
    } else if (event.name === 'operation_failed') {
      if (failures >= MAX_OPERATION_FAILURES_PER_BATCH) {
        continue;
      }
      failures += 1;
    }
    events.push(event);
  }
  return {
    batch: { installId: candidate.installId, sentAt: candidate.sentAt, events },
    dropped: candidate.events.length - events.length,
  };
}

/**
 * Whether the server's answer to a batch is final: it will say the same to the
 * same batch tomorrow, so the batch is dropped instead of retried forever. A
 * 4xx is that — except the answers that are about timing or about this build
 * (408, 425, 429 rate limit, 426 update required), which keep the batch queued
 * for a later try. Network failures and 5xx are never final.
 */
export function isFinalRefusal(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 426, 429].includes(status);
}

/**
 * The device-side queue after one more event. Oldest drop first past the cap:
 * with the network gone for a week, the recent funnel is worth more than the
 * stale one, and an unbounded queue is a disk leak.
 */
export function appendToQueue(queue: AnalyticsEvent[], event: AnalyticsEvent): AnalyticsEvent[] {
  const next = [...queue, event];
  return next.length > MAX_QUEUED_EVENTS ? next.slice(next.length - MAX_QUEUED_EVENTS) : next;
}

/**
 * The next batch off the front of the queue: up to MAX_BATCH_EVENTS, in order,
 * stopping before an event that would put the batch over a per-batch error
 * cap. The rest waits for the next flush, where it leads. Without this a
 * queue whose first hundred held more error events than the server accepts
 * would be refused whole, forever, and the funnel behind it would never leave.
 */
export function takeBatch(queue: readonly AnalyticsEvent[]): AnalyticsEvent[] {
  const batch: AnalyticsEvent[] = [];
  let errors = 0;
  let failures = 0;
  for (const event of queue) {
    if (batch.length >= MAX_BATCH_EVENTS) {
      break;
    }
    if (event.name === 'app_error') {
      if (errors >= MAX_APP_ERRORS_PER_BATCH) {
        break;
      }
      errors += 1;
    } else if (event.name === 'operation_failed') {
      if (failures >= MAX_OPERATION_FAILURES_PER_BATCH) {
        break;
      }
      failures += 1;
    }
    batch.push(event);
  }
  return batch;
}
