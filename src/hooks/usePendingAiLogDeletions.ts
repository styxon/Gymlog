/**
 * Finishes the coach-log deletes this install still owes.
 *
 * Asks when the app has loaded and every time it comes back to the
 * foreground — the two moments a network that was down is likely to be up
 * again — and hands back the runner, so Reset can ask for its own label at
 * once and learn whether it went. Silent on a retry that fails: the label is
 * still owed and the next foreground asks again.
 *
 * And once more when a label was filed while a request carrying it could
 * still be writing its copy: the delete that ran then missed that copy, and
 * the next foreground may be days away (server audit, 2026-09-21).
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { forgetAiCoachLog, isAiCoachLiveConfigured, lastAiLogCarriedAt } from '../lib/aiCoachClient';
import { aiLogRetryAt, createAiLogDeletionRunner } from '../lib/aiLogDeletion';
import {
  AI_LOG_RETRY_PACING,
  EMPTY_PACING,
  notePacingOutcome,
  notePacingSent,
  pacingWaitMs,
  type PacingState,
} from '../lib/requestPacing';

/** Past the moment itself, so a timer that fires a little early still finds the delete final. */
const SETTLE_MARGIN_MS = 1000;

export function usePendingAiLogDeletions(input: {
  hydrated: boolean;
  pending: readonly string[];
  clear: (deleted: readonly string[]) => Promise<void>;
}) {
  const pendingRef = useRef(input.pending);
  pendingRef.current = input.pending;
  const clearRef = useRef(input.clear);
  clearRef.current = input.clear;
  const pacingRef = useRef<PacingState>(EMPTY_PACING);

  const [run] = useState(() =>
    createAiLogDeletionRunner({
      live: isAiCoachLiveConfigured(),
      forget: forgetAiCoachLog,
      onDeleted: (deleted) => clearRef.current(deleted),
      lastCarriedAt: lastAiLogCarriedAt,
      now: () => Date.now(),
    }),
  );

  useEffect(() => {
    if (!input.hydrated) {
      return undefined;
    }
    const at = aiLogRetryAt(input.pending, lastAiLogCarriedAt, Date.now());
    if (at === null) {
      return undefined;
    }
    // The owed list as it stands then: a label taken back into use since is
    // no longer on it, and its copies are the reader's again.
    const timer = setTimeout(() => {
      if (pendingRef.current.length > 0) {
        void run(pendingRef.current);
      }
    }, at - Date.now() + SETTLE_MARGIN_MS);
    return () => clearTimeout(timer);
  }, [input.hydrated, input.pending, run]);

  useEffect(() => {
    if (!input.hydrated) {
      return undefined;
    }
    // Paced (lib/requestPacing): a server that keeps refusing a delete is
    // asked on a return to the app, not on every one of them. The settle
    // timer above and Reset's own delete go through `run` unpaced - each is
    // a single, dated ask.
    const retry = () => {
      if (pendingRef.current.length === 0) {
        return;
      }
      if (pacingWaitMs(pacingRef.current, AI_LOG_RETRY_PACING, Date.now()) > 0) {
        return;
      }
      pacingRef.current = notePacingSent(pacingRef.current, AI_LOG_RETRY_PACING, Date.now());
      const settle = (confirmed: boolean) => {
        pacingRef.current = notePacingOutcome(pacingRef.current, confirmed, Date.now());
      };
      void run(pendingRef.current).then(
        (stillOwed) => settle(stillOwed.length === 0),
        () => settle(false),
      );
    };
    retry();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        retry();
      }
    });
    return () => subscription.remove();
  }, [input.hydrated, run]);

  return run;
}
