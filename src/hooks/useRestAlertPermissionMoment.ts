import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { RestAlertAskOutcome, restAlertMoment } from '../lib/restAlertAnswer';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../utils/exactAlarm';
import {
  RestAlertPermission,
  getRestAlertPermission,
  isRestAlertChannelBlocked,
  requestRestAlertPermission,
} from '../utils/sessionNotifications';

/**
 * The permission moment (design: Background Timer, rule 05): at the first
 * rest, in context, once.
 *
 * One hook for both workout screens. It lived inline in the empty workout
 * only, so the guided player — the default way to train — never asked at
 * all: on a fresh install its rests went to the OS behind a permission
 * nobody had been offered, and nothing said so.
 *
 * `restKey` names the current rest (its start time, or the step it is); the
 * moment fires once per rest START, so ±15 s on a running rest does not
 * re-open the sheet over it.
 */
export function useRestAlertPermissionMoment(input: {
  /** A rest is running right now. */
  restRunning: boolean;
  /** Identity of the current rest; null between rests. */
  restKey: number | string | null;
  /** The in-app ask has been answered before, whichever way. */
  asked: boolean;
  /**
   * The settings say rest alerts should fire — so silence is worth a banner.
   * Silence covers two different OS answers: the permission refused, or
   * granted with the rest-alert channel muted in Android's own settings. The
   * banner used to read the permission alone, so a muted channel armed a
   * silent rest with nothing said about it (#bugs, 2026-09-26).
   */
  alertsWanted: boolean;
  /**
   * Another sheet of the screen is up: the ask waits for a later rest rather
   * than open over it (lib/restAlertAnswer `restAlertMoment`).
   */
  blocked?: boolean;
  /** The answer, for the app to record. */
  onAnswered?: (outcome: RestAlertAskOutcome) => void;
  /**
   * Permission just landed while a rest runs: hand that rest to the OS now.
   * Called again when the reader comes back having allowed exact alarms, so
   * the rest is re-armed on the second rather than left inexact.
   */
  onGranted?: () => void;
}) {
  const { restRunning, restKey, asked, alertsWanted, blocked = false, onAnswered } = input;
  // The latest handler, not the one from the render that opened the dialog:
  // it runs after an await, and again after a trip to system settings, and
  // by then the rest it should hand over may have moved (native audit,
  // 2026-09-21).
  const onGrantedRef = useRef(input.onGranted);
  onGrantedRef.current = input.onGranted;
  const exactReturnRef = useRef<{ remove: () => void } | null>(null);
  useEffect(
    () => () => {
      // Emptied too, so a grant check already under way when the screen
      // goes cannot arm a rest behind it.
      exactReturnRef.current?.remove();
      exactReturnRef.current = null;
    },
    [],
  );
  // null until the OS has answered: the guided player can mount straight
  // onto a running rest (Continue after leaving mid-rest), and asking before
  // the answer is in showed the sheet for a permission that was never
  // undetermined (PR review).
  const [permission, setPermission] = useState<RestAlertPermission | null>(null);
  // null until the channel read answers too — kept apart from `false` so the
  // banner effect below does not fire on a stale "not muted" while the real
  // answer is still in flight (same reason `permission` starts at null).
  const [channelMuted, setChannelMuted] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deniedBannerShown, setDeniedBannerShown] = useState(false);

  useEffect(() => {
    void getRestAlertPermission().then(setPermission);
    void isRestAlertChannelBlocked().then(setChannelMuted);
    // Again on every return to the app: the answer can change in system
    // settings while the session runs, and the "Alerts are off — the timer
    // only runs while this screen is open" banner kept saying so after the
    // reader had allowed them there (emulator, 2026-09-30). The banner reads
    // these two on every render; the ask itself stays once per rest start.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void getRestAlertPermission().then(setPermission);
        void isRestAlertChannelBlocked().then(setChannelMuted);
      }
    });
    return () => subscription.remove();
  }, []);

  const resolved = permission !== null && channelMuted !== null;
  useEffect(() => {
    if (!resolved || !restRunning || restKey === null) {
      return;
    }
    const moment = restAlertMoment({ permission, asked, alertsWanted, channelMuted, blocked });
    if (moment === 'ask') {
      setSheetOpen(true);
    } else if (moment === 'banner') {
      // Anything that is not a granted permission after the ask — "Not now",
      // or alerts switched off in system settings later — is a rest that will
      // not reach the reader. So is a permission that stayed granted while
      // the rest-alert channel itself was muted in system settings: reading
      // `permission` alone missed exactly that case, so the rest ran silent
      // with no banner at all (#bugs, 2026-09-26). Say so at the start of the
      // rest rather than run a timer that silently cannot fire.
      setDeniedBannerShown(true);
    }
    // Once per rest START, on purpose — and once more for the rest that was
    // already running when the OS answer arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restKey, resolved]);

  /**
   * Back from "Alarms & reminders" with exact alarms allowed: arm the rest
   * again. An alarm keeps the kind it was set as, so the rest handed to the
   * OS before that grant would still ring minutes late (native audit,
   * 2026-09-21). Listens until the grant is really there rather than for one
   * return: the system dialog that just closed can report "active" after
   * this is set up, and a reader may come back without allowing it.
   */
  const rearmWhenExactAllowed = () => {
    exactReturnRef.current?.remove();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        return;
      }
      void canScheduleExactAlarms().then((exact) => {
        if (exact !== true || exactReturnRef.current !== subscription) {
          return;
        }
        subscription.remove();
        exactReturnRef.current = null;
        onGrantedRef.current?.();
      });
    });
    exactReturnRef.current = subscription;
  };

  const allow = async () => {
    setSheetOpen(false);
    const next = await requestRestAlertPermission();
    setPermission(next);
    onAnswered?.(next === 'granted' ? 'granted' : 'denied');
    if (next === 'granted') {
      onGrantedRef.current?.();
      // The sheet promised a ring when rest ends, and from Android 14 an
      // allowed notification is still an inexact alarm until the reader also
      // allows exact ones — minutes late, on a rest of ninety seconds. The
      // reader has just said yes to exactly that, so the one page that
      // finishes the job opens now rather than being left for them to find.
      if ((await canScheduleExactAlarms()) === false) {
        rearmWhenExactAllowed();
        void openExactAlarmSettings();
      }
    }
  };

  const later = () => {
    setSheetOpen(false);
    onAnswered?.('later');
  };

  return {
    permission: permission ?? 'undetermined',
    sheetOpen,
    allow,
    later,
    deniedBannerShown: deniedBannerShown && (permission !== 'granted' || channelMuted === true),
    dismissDeniedBanner: () => setDeniedBannerShown(false),
  };
}
