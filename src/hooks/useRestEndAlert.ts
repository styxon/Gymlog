import { useCallback, useEffect, useRef } from 'react';

import { t } from '../lib/i18n';
import { createRestActionBus, type RestAction, type RestActionListener } from '../lib/restActionBus';
import { formatEndsAt } from '../lib/restSchedule';
import type { AppLanguage } from '../types/models';
import {
  cancelRestLadder,
  clearOngoingSession,
  clearStaleSessionAlerts,
  scheduleRestLadder,
  setupSessionNotifications,
  showOngoingSession,
} from '../utils/sessionNotifications';

/**
 * What the ongoing lock-screen card says when no rest is running. The screen
 * that owns the session passes it; `null` means no card between rests.
 */
export interface SessionCardSummary {
  /** "Push A · Bench Press, set 3 of 4" */
  title: string;
  /** "8 of 17 sets logged" */
  body: string;
}

export interface RestAlertOptions {
  /** The 10 s haptic warning before the end. A setting; default on. */
  warning?: boolean;
  /** Whether to keep the ongoing session card at all. A setting; default on. */
  ongoing?: boolean;
  /** What the card says between rests. Without it the card is cleared then. */
  session?: SessionCardSummary | null;
}

/**
 * Keeps a rest deadline mirrored in the OS — the alert ladder and the ongoing
 * lock-screen card — so "rest is over" still lands when Android has suspended
 * our JS: screen off, another app in front, or the process killed outright.
 *
 * Every rest surface drives the same contract: call `sync(endsAtMs, nextName)`
 * when a rest starts or its deadline moves (`recovery`: an interval's, whose
 * card offers no "+30 s" or "skip"), and `sync(null)` when it is
 * skipped, paused or finished. Between rests the card shows the session.
 *
 * Permission is NOT requested here. The design asks at the first rest, in
 * context, through the sheet the screen shows — see `requestRestAlertPermission`.
 * Channels and action categories are set up on mount so the first rest has
 * somewhere to go the moment permission lands.
 *
 * Ordering is the module's job: every call below is queued there in the order
 * it is made, so a newer rest always replaces an older one on the OS clock.
 */
export function useRestEndAlert(language: AppLanguage, options: RestAlertOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Again on a language switch: the buttons under an alert are in the
  // language they were registered in.
  useEffect(() => {
    void setupSessionNotifications(language);
  }, [language]);

  // Once, on opening — not on a language switch, which would clear a running
  // rest's alerts. A rest from a session that died mid-rest has nothing left
  // to say; the screen arms its own rest again straight after this.
  useEffect(() => {
    void clearStaleSessionAlerts();
  }, []);

  const sync = useCallback(
    async (endsAtMs: number | null, nextName?: string | null, recovery = false) => {
      const { warning = true, ongoing = true, session = null } = optionsRef.current;

      if (endsAtMs === null) {
        void cancelRestLadder();
        // Back to the session card, or nothing.
        if (ongoing && session) {
          void showOngoingSession({ kind: 'session', title: session.title, body: session.body });
        } else {
          void clearOngoingSession();
        }
        return;
      }

      const next = nextName?.trim() ? nextName.trim() : null;
      const endsAt = formatEndsAt(endsAtMs);
      if (ongoing && recovery) {
        // An interval's recovery is not stretched or skipped, so its card is
        // the session's, which has neither button. The ladder still tells the
        // reader the bout is on.
        if (session) {
          void showOngoingSession({ kind: 'session', title: session.title, body: session.body });
        } else {
          void clearOngoingSession();
        }
      } else if (ongoing) {
        // The card states the END TIME, not a countdown it could not keep
        // honest while the app is suspended — the bar in the app says the same.
        void showOngoingSession({
          kind: 'rest',
          title: t(language, 'rest.notify.ongoingTitle', { time: endsAt }),
          body: next ? t(language, 'rest.notify.next', { name: next }) : t(language, 'rest.notify.plain'),
        });
      }

      // Replaces the ladder armed before it, whichever process armed it.
      await scheduleRestLadder({
        endsAtMs,
        warning,
        copy: {
          warningTitle: t(language, 'rest.notify.warningTitle'),
          warningBody: next ? t(language, 'rest.notify.next', { name: next }) : t(language, 'rest.notify.plain'),
          endTitle: t(language, 'rest.notify.over'),
          endBody: next ? t(language, 'rest.notify.next', { name: next }) : t(language, 'rest.notify.plain'),
          repeatTitle: t(language, 'rest.notify.repeatTitle'),
          repeatBody: next ? t(language, 'rest.notify.next', { name: next }) : t(language, 'rest.notify.plain'),
        },
      });
    },
    [language],
  );

  // Leaving the screen entirely retires whatever is still pending, and the
  // card with it — the session may go on, but this screen no longer speaks for it.
  useEffect(
    () => () => {
      void cancelRestLadder();
      void clearOngoingSession();
    },
    [],
  );

  return sync;
}

/* ------------------------------------------------------------------------- */
/* Lock-screen actions → the screen that owns the rest                         */
/* ------------------------------------------------------------------------- */

export type { RestAction } from '../lib/restActionBus';

/**
 * Tiny bus from the notification response (which lands in App) to whichever
 * screen holds the running rest. The rest lives in screen state on two of the
 * three loggers, so App cannot act on it directly. An action emitted while no
 * screen is listening — the cold start — is held and handed to the first
 * screen that subscribes (lib/restActionBus).
 */
const restActionBus = createRestActionBus();

/** `sessionId`: the session this screen belongs to, so a held action meant for another is not applied. */
export function subscribeRestActions(listener: RestActionListener, sessionId?: string | null): () => void {
  return restActionBus.subscribe(listener, sessionId);
}

export function emitRestAction(action: RestAction, sessionId?: string | null): void {
  restActionBus.emit(action, sessionId);
}
