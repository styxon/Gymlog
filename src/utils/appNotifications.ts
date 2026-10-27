/**
 * Puts the planned training notifications onto the OS clock.
 *
 * The plan from `src/lib/notificationPlan.ts` is the whole truth: whatever it
 * contains should be pending, and nothing else of ours should be. Sync diffs
 * the two so an unchanged plan does not re-arm a month of alarms every time the
 * app comes to the foreground — except on the first sync of each process,
 * which re-arms the lot (`planNotificationSync`).
 *
 * Permission is never assumed. If the user revoked notifications in system
 * settings, sync cancels everything instead of leaving stale alarms behind
 * pretending the feature still works.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { canScheduleExactAlarms } from './exactAlarm';
import { PLAN_NOTIFICATION_MARKER, installNotificationHandler } from './notificationHandler';
import { t } from '../lib/i18n';
import type { PlannedNotification } from '../lib/notificationPlan';
import { planNotificationSync, shouldRearmPlan } from '../lib/planNotificationSync';
import type { AppLanguage } from '../types/models';

const TRAINING_NOTIFICATION_CHANNEL_ID = 'training';

/** The name the channel was last written with; null until it exists. */
let channelName: string | null = null;

/**
 * The channel, under its name in the reader's language.
 *
 * The name is what Android's own notification settings list, and it was a
 * hard-coded "Training" on a Finnish phone. Writing the channel again with the
 * same id renames it — Android keeps the reader's own choices for it — so a
 * language switch reaches the system settings too. Without a language (the
 * permission ask, which only needs the channel to exist) an existing channel
 * is left as it is.
 */
async function ensureChannel(language?: AppLanguage) {
  if (Platform.OS !== 'android') {
    return;
  }
  const name = language ? t(language, 'notif.channel.training') : channelName ?? t('en', 'notif.channel.training');
  if (channelName === name) {
    return;
  }
  await Notifications.setNotificationChannelAsync(TRAINING_NOTIFICATION_CHANNEL_ID, {
    name,
    // DEFAULT, not HIGH: a reminder is not a rest timer going off. It should
    // land in the shade, not interrupt whatever the phone is doing.
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    bypassDnd: false,
  });
  channelName = name;
}

/** Current OS permission, without ever showing a dialog. */
export async function getNotificationPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    return current.granted;
  } catch {
    return false;
  }
}

/**
 * Asks for permission, showing the system dialog when that is still possible.
 * Returns what we actually ended up with — the caller must not store "on" for a
 * user the OS is going to keep silent.
 */
export async function requestNotificationPermission(language?: AppLanguage): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    installNotificationHandler();
    await ensureChannel(language);

    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      return true;
    }
    // Never gate this on `canAskAgain`. On Android it is backed by
    // shouldShowRequestPermissionRationale, which is false BOTH before the
    // first ask and after a permanent denial — so treating it as "already
    // refused" means the dialog never appears on a fresh install. Asking when
    // the permission really is blocked just returns denied, with no UI.
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

/** Identity of a scheduled item: same signature = nothing to re-schedule. */
function signatureOf(item: PlannedNotification) {
  return [item.key, item.fireAtMs, item.title, item.body].join('|');
}

/**
 * Whether this process has put the plan onto the OS clock itself yet.
 *
 * What the OS reports as pending is expo-notifications' stored list, and a
 * force-stop or an exact-alarm revoke cancels the alarms behind it without
 * touching the list; the library re-arms it on boot and app update only. So
 * the first sync of each process re-arms every plan request instead of
 * trusting the list, and later ones diff (native audit, 2026-09-21).
 */
let armedThisProcess = false;
/**
 * Android's exact-alarm answer when the plan was last armed. A grant does not
 * restart the app, so a plan armed without it stays inexact until something
 * re-arms it — see `shouldRearmPlan`.
 */
let exactWhenArmed: boolean | null = null;

async function cancelOurScheduled(identifiers: readonly string[]) {
  await Promise.all(
    identifiers.map(async (identifier) => {
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      } catch {
        // Already fired or cancelled; nothing to undo.
      }
    }),
  );
}

/**
 * Makes the pending notifications match `plan` exactly. Returns how many are
 * pending afterwards, or 0 when nothing could be scheduled.
 */
export async function syncPlannedNotifications(
  plan: PlannedNotification[],
  language?: AppLanguage,
): Promise<number> {
  if (Platform.OS === 'web') {
    return 0;
  }

  try {
    installNotificationHandler();

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const ours = scheduled.filter(
      (request) => request.content.data?.[PLAN_NOTIFICATION_MARKER] === true,
    );

    // No permission (never granted, or revoked in system settings): drop
    // everything rather than keep alarms that can no longer be delivered.
    const granted = await getNotificationPermissionGranted();
    const exactNow = await canScheduleExactAlarms();
    const wanted = new Map(plan.map((item) => [signatureOf(item), item] as const));
    const steps = planNotificationSync({
      pending: ours.map((request) => ({
        identifier: request.identifier,
        signature: String(request.content.data?.signature ?? ''),
      })),
      wanted: [...wanted.keys()],
      rearm: shouldRearmPlan({ armedThisProcess, exactNow, exactWhenArmed }),
      allowed: granted,
    });

    await cancelOurScheduled(steps.cancel);
    if (steps.schedule.length === 0 && steps.keep.length === 0) {
      armedThisProcess = true;
      exactWhenArmed = exactNow;
      return 0;
    }

    await ensureChannel(language);

    let pending = steps.keep.length;
    for (const signature of steps.schedule) {
      const item = wanted.get(signature);
      if (!item) {
        continue;
      }
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: item.title,
            body: item.body,
            sound: true,
            data: {
              [PLAN_NOTIFICATION_MARKER]: true,
              signature,
              // Read back by routeForNotification when the reader taps it.
              category: item.category,
              measureKind: item.measureKind,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: item.fireAtMs,
            channelId: TRAINING_NOTIFICATION_CHANNEL_ID,
          },
        });
        pending += 1;
      } catch {
        // One bad item must not take the rest of the plan down with it.
      }
    }

    // Set only once the writes are done: a sync that threw on the way leaves
    // the next one to re-arm everything again.
    armedThisProcess = true;
    exactWhenArmed = exactNow;
    return pending;
  } catch {
    // Notifications are an enhancement — never let scheduling break the app.
    return 0;
  }
}
