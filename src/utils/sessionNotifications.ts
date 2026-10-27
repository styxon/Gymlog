/**
 * The notification surface of a live workout — what the app is while the
 * phone is dark (design: "Background Timer", built for Vinha).
 *
 * Three things, each owned here and nowhere else:
 *
 *  1. The rest ladder. A rest start schedules up to three OS notifications at
 *     absolute times: a silent haptic warning 10 s before the end, the end
 *     alert itself, and one repeat 30 s after. Logging the set, skipping,
 *     adjusting or finishing cancels the lot. Nothing about the alert depends
 *     on JavaScript being alive at that moment (rule 02).
 *  2. The ongoing card. One sticky, silent notification per session that says
 *     what is happening — rest ending at 18:42, or the session and its current
 *     lift — with the actions that matter. Android has no chronometer through
 *     expo-notifications, so the card states the wall-clock END rather than a
 *     countdown it could not keep honest while the app is suspended. It is
 *     re-posted whenever the session changes and removed when it ends.
 *  3. The idle nudge. Nothing logged for 25 minutes and one notification asks
 *     whether the session is still one. Rescheduled on every logged set.
 *
 * What this is not: a foreground service. expo-notifications cannot start one,
 * and none of the above needs JS running — rest end is OS-scheduled and elapsed
 * time is derived from timestamps. The one thing a service would add is a live
 * per-second countdown on the lock screen; the end time carries that job.
 *
 * Actions open the app. Handling "+30 s" or "skip" with the process dead needs
 * a background task (expo-task-manager), which is not in the build; opening the
 * app and then acting is the honest version of the same button.
 */
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { t } from '../lib/i18n';
import { NotificationAccessState, resolveNotificationAccessState } from '../lib/notificationAccessState';
import type { RestAlertPermissionAnswer } from '../lib/restAlertAnswer';
import { restAlertTimes } from '../lib/restSchedule';
import { createSerialTaskQueue } from '../lib/serialTaskQueue';
import type { AppLanguage } from '../types/models';
import { ONGOING_NOTIFICATION_MARKER, installNotificationHandler } from './notificationHandler';

/** app.json's `android.package` — the one static id a channel-settings intent needs. */
const ANDROID_PACKAGE_ID = 'app.vinha';

const REST_CHANNEL_ID = 'rest-timer';
const REST_WARNING_CHANNEL_ID = 'rest-warning';
const SESSION_CHANNEL_ID = 'session-ongoing';
const IDLE_CHANNEL_ID = 'session-idle';

/** Tags every notification here so shade sweeps leave unrelated ones alone. */
export const SESSION_NOTIFICATION_MARKER = 'gymlogRest';

const CATEGORY_REST_RUNNING = 'vinha-rest-running';
const CATEGORY_REST_END = 'vinha-rest-end';
const CATEGORY_SESSION = 'vinha-session';
const CATEGORY_IDLE = 'vinha-idle';

/** Action identifiers the response listener dispatches on. */
export const ACTION_EXTEND_30 = 'extend-30';
export const ACTION_EXTEND_60 = 'extend-60';
export const ACTION_SKIP_REST = 'skip-rest';
const ACTION_OPEN = 'open';
const ACTION_LOG_SET = 'log-set';
export const ACTION_FINISH = 'finish';
export const ACTION_STILL_GOING = 'still-going';

/**
 * The rest ladder's identifiers — fixed, not generated.
 *
 * They were the random ids `scheduleNotificationAsync` hands back, kept in a
 * screen's memory and nowhere else. A process that died mid-rest took them
 * with it: the alarms were still armed in the OS, nothing could name them to
 * cancel, and re-entering the player restarted the rest and armed a second
 * set beside the first — two "Rest over"s, one of them at a time that no
 * longer meant anything. A fixed id is its own handle: scheduling replaces,
 * and cancelling reaches whatever an earlier process left behind.
 */
const REST_LADDER_IDS = {
  warning: 'vinha-rest-warning',
  end: 'vinha-rest-end',
  repeat: 'vinha-rest-repeat',
} as const;

/** Our one ongoing card, by a fixed id so re-posting replaces rather than stacks. */
const ONGOING_ID = 'vinha-session-ongoing';
const IDLE_ID = 'vinha-session-idle';

export type RestAlertPermission = RestAlertPermissionAnswer;

let permission: RestAlertPermission = 'undetermined';

/**
 * Every write below goes through one queue, in the order it was asked for.
 *
 * With fixed ids the ORDER is the correctness: "cancel the old rest" landing
 * after "schedule the new one" cancels the new one, and nothing would say so.
 * The native calls give no ordering promise of their own, so each waits for
 * the one before it. The last thing asked for is what the OS ends up holding.
 */
const runInOrder = createSerialTaskQueue();

interface SessionNotificationLabels {
  extend30: string;
  extend60: string;
  skip: string;
  open: string;
  logSet: string;
  finish: string;
  stillGoing: string;
  /** The channel names Android lists in its own notification settings. */
  restChannel: string;
  restWarningChannel: string;
  sessionChannel: string;
  idleChannel: string;
}

function sessionNotificationLabels(language: AppLanguage): SessionNotificationLabels {
  return {
    extend30: t(language, 'rest.notify.action.extend30'),
    extend60: t(language, 'rest.notify.action.extend60'),
    skip: t(language, 'rest.notify.action.skip'),
    open: t(language, 'rest.notify.action.open'),
    logSet: t(language, 'rest.notify.action.logSet'),
    finish: t(language, 'rest.notify.action.finish'),
    stillGoing: t(language, 'rest.notify.action.stillGoing'),
    // The same names the reader toggles in the app's own settings, so the two
    // lists can be matched line by line.
    restChannel: t(language, 'notif.rest.alerts'),
    restWarningChannel: t(language, 'notif.rest.warning'),
    sessionChannel: t(language, 'notif.channel.session'),
    idleChannel: t(language, 'notif.rest.idle'),
  };
}

/** The labels last registered with the OS; null until a registration landed. */
let registeredKey: string | null = null;

async function registerSessionSurfaces(labels: SessionNotificationLabels): Promise<void> {
  if (Platform.OS === 'android') {
    // Writing a channel again under the same id renames it and keeps what the
    // reader chose for it in system settings.
    await Notifications.setNotificationChannelAsync(REST_CHANNEL_ID, {
      name: labels.restChannel,
      importance: Notifications.AndroidImportance.HIGH,
      // No `sound` key: naming one makes expo-notifications look for a
      // bundled asset file, so the channel keeps the system default tone.
      vibrationPattern: [0, 220, 120, 220],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
    // The 10 s warning: a tick you feel, not a tone you hear — you may
    // still be under the bar.
    await Notifications.setNotificationChannelAsync(REST_WARNING_CHANNEL_ID, {
      name: labels.restWarningChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: [0, 80],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    // The ongoing card: silent, low, never buzzes — it is a surface, not an alert.
    await Notifications.setNotificationChannelAsync(SESSION_CHANNEL_ID, {
      name: labels.sessionChannel,
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(IDLE_CHANNEL_ID, {
      name: labels.idleChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 120],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const opens = { opensAppToForeground: true };
  await Notifications.setNotificationCategoryAsync(CATEGORY_REST_RUNNING, [
    { identifier: ACTION_EXTEND_30, buttonTitle: labels.extend30, options: opens },
    { identifier: ACTION_SKIP_REST, buttonTitle: labels.skip, options: opens },
    { identifier: ACTION_OPEN, buttonTitle: labels.open, options: opens },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY_REST_END, [
    { identifier: ACTION_LOG_SET, buttonTitle: labels.logSet, options: opens },
    { identifier: ACTION_EXTEND_60, buttonTitle: labels.extend60, options: opens },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY_SESSION, [
    { identifier: ACTION_OPEN, buttonTitle: labels.open, options: opens },
    { identifier: ACTION_FINISH, buttonTitle: labels.finish, options: opens },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY_IDLE, [
    { identifier: ACTION_STILL_GOING, buttonTitle: labels.stillGoing, options: opens },
    { identifier: ACTION_FINISH, buttonTitle: labels.finish, options: opens },
  ]);
}

/**
 * Channels and action categories, in the reader's language. Does NOT request
 * permission — that is asked in context, at the first rest, through
 * `requestRestAlertPermission` (rule 05).
 *
 * Safe to call on every render that might have changed the language: the work
 * happens when the labels differ from the ones registered. It used to happen
 * once per process, so the buttons under a rest alert kept the language the
 * app had started in — "Skip rest" on a phone just switched to Finnish.
 */
export function setupSessionNotifications(language: AppLanguage): Promise<void> {
  if (Platform.OS === 'web') {
    return Promise.resolve();
  }
  installNotificationHandler();
  const labels = sessionNotificationLabels(language);
  const key = JSON.stringify(labels);
  if (registeredKey === key) {
    return Promise.resolve();
  }
  registeredKey = key;
  return runInOrder(async () => {
    try {
      await registerSessionSurfaces(labels);
    } catch {
      // Notifications are an enhancement — never let setup break a workout.
      // Forget the key so the next call tries again.
      if (registeredKey === key) {
        registeredKey = null;
      }
    }
  });
}

/** Current permission without asking. */
export async function getRestAlertPermission(): Promise<RestAlertPermission> {
  if (Platform.OS === 'web') {
    return 'denied';
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      permission = 'granted';
    } else if (current.status === 'undetermined') {
      permission = 'undetermined';
    } else {
      // Android reports canAskAgain=false before the first ask too, so a
      // "denied" with canAskAgain still counts as not-yet-asked.
      permission = current.canAskAgain ? 'undetermined' : 'denied';
    }
  } catch {
    permission = 'denied';
  }
  return permission;
}

/**
 * Whether the reader has switched the rest-alert channel off in Android's
 * own settings (importance NONE). The app-wide permission stays granted
 * then, so every check that read only the permission called the alert
 * allowed while Android dropped each one (native audit, 2026-09-21). False
 * off Android and before the channel exists — nothing has muted it then.
 */
export async function isRestAlertChannelBlocked(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    const channel = await Notifications.getNotificationChannelAsync(REST_CHANNEL_ID);
    return channel?.importance === Notifications.AndroidImportance.NONE;
  } catch {
    return false;
  }
}

/**
 * What is standing between a rest alert and the reader, if anything: the
 * permission refused, granted but the rest-alert channel muted, or clear.
 * What Settings shows, and names which of the two it is (#bugs, 2026-09-26 —
 * both used to read as one flat "blocked").
 */
export async function getRestAlertAccessState(): Promise<NotificationAccessState> {
  const permissionGranted = (await getRestAlertPermission()) === 'granted';
  const channelMuted = permissionGranted && (await isRestAlertChannelBlocked());
  return resolveNotificationAccessState({ permissionGranted, channelMuted });
}

/**
 * Whether an end-of-rest alert can reach the reader: the app may notify AND
 * the rest-alert channel is not switched off.
 */
export async function getRestAlertsAllowed(): Promise<boolean> {
  return (await getRestAlertAccessState()) === 'granted';
}

/**
 * Opens Android's own settings page for the rest-alert channel — the one
 * screen with the toggle that muted it — rather than the app's general
 * notification page, where the reader would have to find the channel
 * themselves. Falls back to the app's own settings page when the specific
 * one is not there to open, same as `openExactAlarmSettings` (#bugs,
 * 2026-09-26: the channel-muted card used to send the reader to the general
 * page, same as a refused permission).
 */
export async function openRestAlertChannelSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE_ID },
      { key: 'android.provider.extra.CHANNEL_ID', value: REST_CHANNEL_ID },
    ]);
    return;
  } catch {
    // Fall through to the generic page.
  }
  await Linking.openSettings().catch(() => undefined);
}

/**
 * The page that fixes whatever is keeping rest alerts quiet: the rest-alert
 * channel's own page when only the channel is muted, the app's notification
 * settings otherwise. The in-workout banners' "Turn on" — they used to open the
 * general page for both (2026-09-26).
 */
export async function openRestAlertSettings(): Promise<void> {
  if ((await getRestAlertAccessState()) === 'channelMuted') {
    await openRestAlertChannelSettings();
    return;
  }
  await Linking.openSettings().catch(() => undefined);
}

/** The system dialog. Only called after the in-app ask (rule 05). */
export async function requestRestAlertPermission(): Promise<RestAlertPermission> {
  if (Platform.OS === 'web') {
    return 'denied';
  }
  try {
    const requested = await Notifications.requestPermissionsAsync();
    permission = requested.granted ? 'granted' : 'denied';
  } catch {
    permission = 'denied';
  }
  return permission;
}

function marker() {
  return { [SESSION_NOTIFICATION_MARKER]: true };
}

function secondsUntil(atMs: number): number {
  return (atMs - Date.now()) / 1000;
}

async function scheduleAt(
  identifier: string,
  atMs: number,
  content: Notifications.NotificationContentInput,
  channelId: string,
): Promise<void> {
  const seconds = secondsUntil(atMs);
  if (!Number.isFinite(seconds) || seconds < 1) {
    return;
  }
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { ...content, data: { ...(content.data ?? {}), ...marker() } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        channelId,
      },
    });
  } catch {
    // One rung missing is not worth failing the others over.
  }
}

async function cancelOne(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or cancelled.
  }
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    // Never made it to the shade.
  }
}

async function cancelLadderNow(): Promise<void> {
  await Promise.all(Object.values(REST_LADDER_IDS).map(cancelOne));
}

interface RestLadderCopy {
  warningTitle: string;
  warningBody: string;
  endTitle: string;
  endBody: string;
  repeatTitle: string;
  repeatBody: string;
}

/**
 * Schedules the rest ladder for an absolute end time, in place of whatever
 * ladder was armed before — by this process or by one that died. Pass
 * `warning: false` to skip the 10 s tick (a setting).
 */
export function scheduleRestLadder(input: {
  endsAtMs: number;
  warning: boolean;
  copy: RestLadderCopy;
}): Promise<void> {
  return runInOrder(async () => {
    await cancelLadderNow();
    if ((await getRestAlertPermission()) !== 'granted') {
      return;
    }
    const times = restAlertTimes(input.endsAtMs);
    await Promise.all([
      input.warning
        ? scheduleAt(
            REST_LADDER_IDS.warning,
            times.warningAtMs,
            { title: input.copy.warningTitle, body: input.copy.warningBody, sound: false },
            REST_WARNING_CHANNEL_ID,
          )
        : Promise.resolve(),
      scheduleAt(
        REST_LADDER_IDS.end,
        input.endsAtMs,
        {
          title: input.copy.endTitle,
          body: input.copy.endBody,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          categoryIdentifier: CATEGORY_REST_END,
        },
        REST_CHANNEL_ID,
      ),
      scheduleAt(
        REST_LADDER_IDS.repeat,
        times.repeatAtMs,
        {
          title: input.copy.repeatTitle,
          body: input.copy.repeatBody,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          categoryIdentifier: CATEGORY_REST_END,
        },
        REST_CHANNEL_ID,
      ),
    ]);
  });
}

/** The ladder gone, whoever armed it. */
export function cancelRestLadder(): Promise<void> {
  return runInOrder(cancelLadderNow);
}

/**
 * Posts or replaces the ongoing session card. Sticky and silent. `kind`
 * picks the action set: a running rest offers +30 s / skip, a session offers
 * open / finish.
 */
export function showOngoingSession(input: {
  kind: 'rest' | 'session';
  title: string;
  body: string;
}): Promise<void> {
  if (Platform.OS !== 'android') {
    // iOS has no ongoing notification; a Live Activity is the carrier there
    // and is not in this build. The scheduled alerts still cover the rest end.
    return Promise.resolve();
  }
  return runInOrder(async () => {
    if ((await getRestAlertPermission()) !== 'granted') {
      return;
    }
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: ONGOING_ID,
        content: {
          title: input.title,
          body: input.body,
          sound: false,
          sticky: true,
          autoDismiss: false,
          priority: Notifications.AndroidNotificationPriority.LOW,
          categoryIdentifier: input.kind === 'rest' ? CATEGORY_REST_RUNNING : CATEGORY_SESSION,
          data: { ...marker(), [ONGOING_NOTIFICATION_MARKER]: true },
        },
        // Immediate, on the silent channel: a channel-only trigger presents now.
        trigger: { channelId: SESSION_CHANNEL_ID },
      });
    } catch {
      // Surface only; the session is unaffected.
    }
  });
}

export function clearOngoingSession(): Promise<void> {
  return runInOrder(() => cancelOne(ONGOING_ID));
}

/** (Re)schedules the idle nudge for an absolute time; cancels the previous one. */
export function scheduleIdleNudge(input: { atMs: number; title: string; body: string }): Promise<void> {
  return runInOrder(async () => {
    await cancelOne(IDLE_ID);
    if ((await getRestAlertPermission()) !== 'granted') {
      return;
    }
    const seconds = secondsUntil(input.atMs);
    if (!Number.isFinite(seconds) || seconds < 1) {
      return;
    }
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: IDLE_ID,
        content: {
          title: input.title,
          body: input.body,
          sound: true,
          categoryIdentifier: CATEGORY_IDLE,
          data: marker(),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(1, Math.round(seconds)),
          channelId: IDLE_CHANNEL_ID,
        },
      });
    } catch {
      // Nudge is advisory.
    }
  });
}

export function cancelIdleNudge(): Promise<void> {
  return runInOrder(() => cancelOne(IDLE_ID));
}

/**
 * Pending session notifications of ours, except the ones named in `keep`.
 * Catches what no fixed id reaches: a ladder armed by a build that still
 * generated its ids.
 */
async function cancelScheduledSessionNotifications(keep: readonly string[]): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter(
          (request) =>
            request.content.data?.[SESSION_NOTIFICATION_MARKER] === true && !keep.includes(request.identifier),
        )
        .map((request) => cancelOne(request.identifier)),
    );
  } catch {
    // Nothing pending.
  }
}

async function dismissPresentedSessionNotifications(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => n.request.content.data?.[SESSION_NOTIFICATION_MARKER] === true)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing in the shade.
  }
}

/**
 * A workout screen opening: whatever an earlier rest left behind goes, and
 * the screen arms its own rest again if one is running.
 *
 * NOT the idle nudge. It is the session's, not the screen's, and App arms it
 * only when a set is logged — cancelling it here meant that stepping out of
 * the player and back in switched the nudge off for the rest of the session.
 */
export function clearStaleSessionAlerts(): Promise<void> {
  return runInOrder(async () => {
    await cancelLadderNow();
    await cancelOne(ONGOING_ID);
    await cancelScheduledSessionNotifications([IDLE_ID]);
    await dismissPresentedSessionNotifications();
  });
}

/** Everything this module posted or armed, gone — for the end of a session. */
export function clearAllSessionNotifications(): Promise<void> {
  return runInOrder(async () => {
    await Promise.all([cancelLadderNow(), cancelOne(ONGOING_ID), cancelOne(IDLE_ID)]);
    await cancelScheduledSessionNotifications([]);
    await dismissPresentedSessionNotifications();
  });
}
