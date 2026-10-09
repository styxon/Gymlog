import { LOG_ID_PATTERN } from './aiCoachLogId';
import type { AppPreferences } from '../types/models';

/**
 * Deletes of kept coach copies that could not be confirmed yet, and the
 * retries that finish them.
 *
 * The privacy policy promises the copies go when permission is taken back.
 * Reset takes it back and clears `aiLogId` with everything else — and that
 * label is the only thing the server's delete route asks for. A delete sent
 * once and lost to a dead network left copies nothing could name again until
 * the 24-month sweep. So the label is filed in `pendingAiLogDeletions` by the
 * reset itself (storage/database), and removed only when the server answers
 * that the copies are gone.
 */

/**
 * More than a handful means something is refusing every delete; the oldest
 * are dropped rather than letting the list grow without end.
 */
export const MAX_PENDING_AI_LOG_DELETIONS = 20;

/** A stored list, made safe: labels of the right shape, once each, newest kept. */
export function normalizePendingAiLogDeletions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && LOG_ID_PATTERN.test(item) && !labels.includes(item)) {
      labels.push(item);
    }
  }
  return labels.slice(-MAX_PENDING_AI_LOG_DELETIONS);
}

/** The list with `logId` owed as well; unchanged when there is no label to add. */
export function withPendingAiLogDeletion(pending: readonly string[], logId: string | null): string[] {
  return normalizePendingAiLogDeletions(logId ? [...pending, logId] : pending);
}

/** The list without the labels the server has confirmed. */
export function withoutAiLogDeletions(pending: readonly string[], deleted: readonly string[]): string[] {
  return pending.filter((label) => !deleted.includes(label));
}

/**
 * How long after a request that carried a label a copy of it may still be
 * written: the app's own outer bound on a coach call (aiCoachClient's request
 * timeout, pinned equal in tests/lib/aiLogDeletion).
 *
 * The server keeps a copy after the model has answered — up to its 30 s
 * upstream timeout after the request arrived — and a delete lists the copies
 * there when it arrives. So a withdrawal made while a question was still being
 * answered deleted every copy but that one, and the label was retired as done
 * (server audit, 2026-09-21).
 */
export const AI_LOG_WRITE_WINDOW_MS = 40_000;

/**
 * When a delete sent at `deleteSentAt` can be trusted to have found every
 * copy: null when it already can, otherwise the moment after which asking
 * again will. `lastCarriedAt` is when the last request carrying the label
 * left the phone, or null when none has in this run of the app.
 */
export function aiLogDeleteSettlesAt(lastCarriedAt: number | null, deleteSentAt: number): number | null {
  if (lastCarriedAt === null) {
    return null;
  }
  const settles = lastCarriedAt + AI_LOG_WRITE_WINDOW_MS;
  return deleteSentAt < settles ? settles : null;
}

/** The latest of those moments still ahead for any of `labels`, or null: when to ask once more. */
export function aiLogRetryAt(
  labels: readonly string[],
  lastCarriedAt: (logId: string) => number | null,
  now: number,
): number | null {
  let latest: number | null = null;
  for (const label of labels) {
    const at = aiLogDeleteSettlesAt(lastCarriedAt(label), now);
    if (at !== null && (latest === null || at > latest)) {
      latest = at;
    }
  }
  return latest;
}

type CoachLogFields = Pick<
  AppPreferences,
  'aiLogId' | 'aiLogChatConsent' | 'aiLogComposerConsent' | 'aiLogPhotoConsent' | 'pendingAiLogDeletions'
>;

/**
 * Preferences that do not point the coach at a label whose delete is owed.
 *
 * A backup made before a reset still holds that label and the yeses that went
 * with it. Restored as they were, the coach would file new copies under the
 * label, and the next retry would delete them with the old ones — copies the
 * reader had, as far as the screen said, agreed to keep. The permission those
 * answers belonged to was taken back by the reset, so they go with the label;
 * the next yes mints a new one.
 */
export function withoutOwedCoachLog<T extends CoachLogFields>(preferences: T): T {
  if (!preferences.aiLogId || !preferences.pendingAiLogDeletions.includes(preferences.aiLogId)) {
    return preferences;
  }
  return {
    ...preferences,
    aiLogId: null,
    aiLogChatConsent: false,
    aiLogComposerConsent: false,
    aiLogPhotoConsent: false,
  };
}

/** How one label's delete ended: gone and final, confirmed but not yet final, or not confirmed at all. */
type AiLogDeleteOutcome = 'deleted' | 'unsettled' | 'refused';

export interface AiLogDeletionRunnerOptions {
  /**
   * Whether this build can reach the coach server with its key. A build that
   * cannot never kept a copy, so it sends nothing and reports nothing — and
   * leaves the labels owed for a build that can: one an earlier build filed
   * copies under is still on the server.
   */
  live: boolean;
  /** The server's delete; resolves `ok: true` only when it confirmed. */
  forget: (logId: string) => Promise<{ ok: boolean }>;
  /** Called with the labels the server confirmed, to take them off the list. */
  onDeleted: (logIds: string[]) => Promise<void>;
  /**
   * When a request carrying the label last left the phone (aiCoachClient). A
   * delete confirmed before that request's copy can have landed is not
   * final: the label stays owed (aiLogDeleteSettlesAt).
   */
  lastCarriedAt?: (logId: string) => number | null;
  /** The clock, for the same question. */
  now?: () => number;
}

/**
 * One runner per app: `run(labels)` asks the server to delete each label's
 * copies and resolves with the labels it could NOT confirm.
 *
 * A label already on its way is not sent twice — the start-up retry, a
 * foreground retry and a reset can all ask for the same one within a second
 * — and every caller waits for that one answer, so the reset still learns
 * whether its own label went.
 */
export function createAiLogDeletionRunner(options: AiLogDeletionRunnerOptions) {
  const inFlight = new Map<string, Promise<AiLogDeleteOutcome>>();

  const deleteOne = (logId: string): Promise<AiLogDeleteOutcome> => {
    const running = inFlight.get(logId);
    if (running) {
      return running;
    }
    const attempt = (async (): Promise<AiLogDeleteOutcome> => {
      const sentAt = (options.now ?? Date.now)();
      try {
        const answer = await options.forget(logId);
        if (!answer.ok) {
          return 'refused';
        }
      } catch {
        return 'refused';
      }
      if (aiLogDeleteSettlesAt(options.lastCarriedAt?.(logId) ?? null, sentAt) !== null) {
        // Everything that was there is gone, but a copy may still be on its
        // way: owed until a delete sent after it has landed says so.
        return 'unsettled';
      }
      try {
        await options.onDeleted([logId]);
      } catch {
        // The copies are gone; only the note of it failed to save. The label
        // stays owed, and the next retry's delete finds nothing and succeeds.
      }
      return 'deleted';
    })().finally(() => {
      inFlight.delete(logId);
    });
    inFlight.set(logId, attempt);
    return attempt;
  };

  /**
   * Like `run`, but says why a label is still owed: `refused` - the request
   * failed or the server said no, which is what a retry backoff is for - or
   * `unsettled` - the server confirmed, and the label waits out its write
   * window, which is not a failure.
   */
  async function runDetailed(labels: readonly string[]): Promise<{ owed: string[]; refused: string[] }> {
    if (!options.live) {
      return { owed: [], refused: [] };
    }
    const unique = normalizePendingAiLogDeletions(labels);
    const results = await Promise.all(unique.map(deleteOne));
    return {
      owed: unique.filter((_, index) => results[index] !== 'deleted'),
      refused: unique.filter((_, index) => results[index] === 'refused'),
    };
  }

  async function run(labels: readonly string[]): Promise<string[]> {
    return (await runDetailed(labels)).owed;
  }

  return Object.assign(run, { detailed: runDetailed });
}
