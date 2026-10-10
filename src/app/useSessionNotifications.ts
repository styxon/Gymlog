import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { emitRestAction } from '../hooks/useRestEndAlert';
import { isRepeatedRestOverExtend } from '../lib/restActionBus';
import { IDLE_NUDGE_MINUTES, idleNudgeAtMs } from '../lib/restSchedule';
import { minutesBoutDueMs } from '../lib/minutesExercises';
import {
  ACTION_EXTEND_30,
  ACTION_EXTEND_60,
  ACTION_FINISH,
  ACTION_SKIP_REST,
  ACTION_STILL_GOING,
  SESSION_NOTIFICATION_MARKER,
  cancelIdleNudge,
  clearAllSessionNotifications,
  scheduleIdleNudge,
  setupSessionNotifications,
} from '../utils/sessionNotifications';
import { formatWorkoutDisplayLabel } from '../lib/displayLabel';
import { t } from '../lib/i18n';
import { localizeSessionName } from '../lib/sessionNameLabel';
import type { WorkoutFeatureState } from '../features/workout/workoutState';
import type { AppPreferences } from '../types/models';

/**
 * The background timer's app-level half: the lock-screen action listener,
 * clearing the shade when a session ends, the session's buttons in the
 * reader's language, the idle nudge, and the one toast for a session restored
 * after a cold start.
 *
 * Moved verbatim from VinhaApp in App.tsx in the phase-B split (2026-09-30).
 * A hook, not a helper: these are effects with the app shell's lifetime, and
 * VinhaApp calls this exactly where the lines stood — after
 * useScheduledNotifications, before usePendingAiLogDeletions — so every hook
 * keeps its slot and the five effects register in the same order as before,
 * the lock-screen listener still ahead of the planner-tap listener further
 * down App.tsx.
 *
 * In the moved comments below, "here", "this file", "above" and "below" mean
 * App.tsx. The two refs start as no-ops and are returned for VinhaApp to fill
 * on every render, where navigateToActiveWorkout exists.
 */
export interface SessionNotificationsDeps {
  /** The workout context: the live session, and whether its store has loaded. */
  workout: Pick<WorkoutFeatureState, 'activeSession' | 'hydrated'>;
  /** The reader's preferences: the app language and the idle-nudge switch. */
  preferences: AppPreferences;
  /** VinhaApp's showToast: a hoisted function declaration, so it exists at the call. */
  showToast: (message: string) => void;
  /**
   * Both stores loaded. A lock-screen action that launched the app waits for
   * it, like the planner taps in useNotificationRoute: driving a session
   * before it has been restored drives nothing.
   */
  appHydrated: boolean;
}

export function useSessionNotifications(deps: SessionNotificationsDeps) {
  const { workout, preferences, showToast, appHydrated } = deps;

  /* ---------------- Background timer: the app-level half ---------------- */
  // The rest ladder and the ongoing card are owned by the screen that holds the
  // rest (useRestEndAlert). What belongs here is everything that outlives a
  // screen: lock-screen action responses, the idle nudge, cleanup when the
  // session ends, and the truth about a session restored after a cold start.

  const activeSessionId = workout.activeSession?.sessionId ?? null;
  const activeSessionStatus = workout.activeSession?.status ?? null;
  /** Read by the lock-screen action closure below, which is built once. */
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const navigateToActiveWorkoutRef = useRef<() => boolean>(() => false);
  const finishFromNotificationRef = useRef<() => void>(() => {});
  /**
   * Bumped by "Still going" and by the app coming back to the foreground, and
   * read by the idle effect below, so either one arms a fresh nudge. The
   * comment there always promised this; nothing fed it, so after one nudge a
   * session left open never asked again (#bugs 2026-10-01, from the phase-B
   * split).
   */
  const [activityTick, setActivityTick] = useState(0);
  /** A session action that launched the app, held until both stores load. */
  const coldSessionResponseRef = useRef<Notifications.NotificationResponse | null>(null);

  /** When a rest-over alert's "+60 s" was last passed on; repeats inside the window are dropped. */
  const lastRestOverExtendAtRef = useRef<number | null>(null);
  // Lock-screen actions. Every action opens the app; the running rest is then
  // told over the bus, because it lives in screen state. Only refs and a
  // state setter inside, so the mount-time closure stays current.
  const runSessionActionRef = useRef((response: Notifications.NotificationResponse) => {
    const action = response.actionIdentifier;
    // Bring the session to the front first; the screen that owns the rest
    // mounts its bus listener on render.
    navigateToActiveWorkoutRef.current();
    // The rest actions go over the bus at once, not after a timer: on a cold
    // start the screen that owns the rest mounts only after the launch
    // screens and the splash (~4.5 s), long after any fixed delay, and the
    // bus holds the action for it (lib/restActionBus). A screen that is
    // already mounted gets it immediately. Tagged with the session, so a held
    // action never lands on a different one.
    const sessionId = activeSessionIdRef.current;
    if (action === ACTION_EXTEND_30) {
      emitRestAction({ kind: 'extend', seconds: 30 }, sessionId);
    } else if (action === ACTION_EXTEND_60) {
      // The rest-over alert answers once: a second press before the app has
      // dismissed it is the same tap, not another minute (lib/restActionBus).
      const now = Date.now();
      if (isRepeatedRestOverExtend(lastRestOverExtendAtRef.current, now)) {
        return;
      }
      lastRestOverExtendAtRef.current = now;
      emitRestAction({ kind: 'extend', seconds: 60 }, sessionId);
    } else if (action === ACTION_SKIP_REST) {
      emitRestAction({ kind: 'skip' }, sessionId);
    }
    setTimeout(() => {
      if (action === ACTION_FINISH) {
        finishFromNotificationRef.current();
      } else if (action === ACTION_STILL_GOING) {
        setActivityTick((tick) => tick + 1);
      }
    }, 350);
  });

  useEffect(() => {
    /*
     * The cold start: the action that launched the process was answered
     * before this listener existed, so it was never heard — and
     * useNotificationRoute, reading the same stored response just after this,
     * found no route in it and cleared it. "Finish" or "+30 s" from a killed
     * app did nothing (#bugs 2026-10-01). Read here first, held, and run once
     * the session is back (below); the route hook still clears the store.
     */
    try {
      const cold = Notifications.getLastNotificationResponse();
      if (cold && (cold.notification.request.content.data ?? {})[SESSION_NOTIFICATION_MARKER] === true) {
        coldSessionResponseRef.current = cold;
      }
    } catch (error) {
      // Unavailable on web: nothing launched the app from a shade. Anywhere
      // else it is a broken module, said aloud.
      if (Platform.OS !== 'web') {
        console.error('Could not read the notification that opened the app', error);
      }
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data ?? {};
      if (data[SESSION_NOTIFICATION_MARKER] !== true) {
        return;
      }
      runSessionActionRef.current(response);
    });
    // Back in the foreground counts as being there: a fresh nudge from now.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setActivityTick((tick) => tick + 1);
      }
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, []);

  // The held cold-start action, once the session it belongs to is restored.
  // Dropped when there is none: a "Finish" for a session already gone is
  // nothing to finish.
  useEffect(() => {
    if (!appHydrated || !coldSessionResponseRef.current) {
      return;
    }
    const response = coldSessionResponseRef.current;
    coldSessionResponseRef.current = null;
    if (activeSessionId && activeSessionStatus === 'active') {
      runSessionActionRef.current(response);
    }
  }, [appHydrated, activeSessionId, activeSessionStatus]);

  // Session ended or was discarded: nothing of ours stays in the shade.
  useEffect(() => {
    if (!activeSessionId || activeSessionStatus !== 'active') {
      void clearAllSessionNotifications();
    }
  }, [activeSessionId, activeSessionStatus]);

  // The session's buttons in the reader's language, from here as well as from
  // the workout screens: the idle nudge is armed here, and its buttons were
  // whatever language the player last registered — or the one the app had
  // started in, before the registration learned to follow a switch.
  useEffect(() => {
    if (activeSessionId && activeSessionStatus === 'active') {
      void setupSessionNotifications(preferences.appLanguage);
    }
  }, [activeSessionId, activeSessionStatus, preferences.appLanguage]);

  // The idle nudge: 25 minutes after the last logged set, one question. Keyed
  // on the count of completed sets so every logged set pushes it forward, and
  // on the app coming to the foreground, which also counts as being there.
  //
  // Its own switch and the OS permission decide it, and nothing else: the
  // phone's Notifications switch governs the scheduled reminders (user
  // 2026-09-17), and a training break silences only those — a reader who is
  // in a session is training, and wants its alerts.
  const completedSetCount = useMemo(
    () =>
      (workout.activeSession?.exercises ?? []).reduce(
        (sum, exercise) => sum + exercise.sets.filter((set) => set.status === 'completed').length,
        0,
      ),
    [workout.activeSession?.exercises],
  );
  /**
   * A bout of minutes on the clock: started or paused is the reader being
   * there, and a running one is due back only when its minutes are in.
   */
  const minutesClock = workout.activeSession?.minutesClock ?? null;
  const boutDueMs = minutesBoutDueMs(minutesClock);
  /**
   * When the reader was last there: a logged set, "Still going", the app
   * back in front, a new session, a resume from a pause, the nudge switched
   * on, a bout's clock started or paused. The nudge is timed from this, not from
   * whatever re-ran its effect — a rename or a language switch re-words the
   * nudge but must not push it back (review of #bugs 2026-10-01). Declared
   * before the nudge's effect, so it has run when that one reads it.
   */
  const lastActivityAtRef = useRef(Date.now());
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
  }, [activeSessionId, activeSessionStatus, completedSetCount, activityTick, preferences.notificationPrefs.idleNudge]);
  // A bout's clock started or paused is the reader being there too.
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
  }, [minutesClock?.runningSinceMs, minutesClock?.accumulatedMs]);
  useEffect(() => {
    if (!activeSessionId || activeSessionStatus !== 'active' || !preferences.notificationPrefs.idleNudge) {
      void cancelIdleNudge();
      return;
    }
    const language = preferences.appLanguage;
    const sessionName = localizeSessionName(
      formatWorkoutDisplayLabel(workout.activeSession?.templateName ?? ''),
      language,
    );
    // A ride on the clock is not idle: the 25 minutes count from the end of
    // its prescription, not from the last logged set (#bugs 2026-10-06).
    const atMs = idleNudgeAtMs(Math.max(lastActivityAtRef.current, boutDueMs ?? 0));
    if (atMs <= Date.now()) {
      // Its time has passed: it went already, or the app was away. Re-wording
      // it now would only send it a second time.
      return;
    }
    void scheduleIdleNudge({
      atMs,
      title: t(language, 'rest.notify.idleTitle', { minutes: IDLE_NUDGE_MINUTES }),
      body: t(language, completedSetCount === 1 ? 'rest.notify.idleBodyOne' : 'rest.notify.idleBody', {
        session: sessionName,
        done: completedSetCount,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeSessionId,
    activeSessionStatus,
    completedSetCount,
    activityTick,
    // The body names the workout: a rename mid-session reaches the nudge now,
    // not only after the next logged set (#bugs 2026-10-01).
    workout.activeSession?.templateName,
    preferences.notificationPrefs.idleNudge,
    preferences.appLanguage,
    boutDueMs,
  ]);

  // After a cold start the session comes back from stored timestamps: elapsed
  // is real and a rest that expired meanwhile is already resolved. Say so once.
  const restoredToastShownRef = useRef(false);
  useEffect(() => {
    if (!workout.hydrated || restoredToastShownRef.current) {
      return;
    }
    restoredToastShownRef.current = true;
    if (workout.activeSession?.status === 'active') {
      showToast(t(preferences.appLanguage, 'rest.notify.restoredToast'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout.hydrated]);

  return { navigateToActiveWorkoutRef, finishFromNotificationRef };
}
