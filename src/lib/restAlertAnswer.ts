import { NotificationPrefs } from '../types/models';

export type RestAlertAskOutcome = 'granted' | 'denied' | 'later';

/**
 * What the first-rest ask writes back, given how it was answered.
 *
 * The rest alerts have their own switches and no longer wait on the phone's
 * Notifications switch (user decision 2026-09-17). That switch defaults to
 * off, and gating the rest ladder on it left the end-of-rest alert silent on
 * most phones: the only thing that turned it on was this sheet, and the sheet
 * opens only while the OS permission is undetermined — never on Android 12
 * and older, where the permission is granted at install, and never after the
 * trial had already asked. The Notifications switch now governs the
 * scheduled reminders alone, so this answer has nothing to do with it.
 *
 * Allow keeps the end-of-rest alert on: the sheet promised "rings when rest
 * ends", and a reader who said yes to that has said yes to the alert.
 * "Not now" and a denied dialog record the ask and change nothing else — the
 * screens then say at each rest what is off rather than pretending.
 */
export function restAlertsAnswered(prefs: NotificationPrefs, outcome: RestAlertAskOutcome): NotificationPrefs {
  const asked = { ...prefs, restAlertsAsked: true };
  return outcome === 'granted' ? { ...asked, restAlerts: true } : asked;
}

/** The OS answer about notifications, as utils/sessionNotifications reads it. */
export type RestAlertPermissionAnswer = 'granted' | 'denied' | 'undetermined';

/**
 * What the start of a rest does about rest alerts: ask, wait to ask, say
 * they are off, or nothing.
 *
 * `blocked`: another sheet is up as the rest starts — the guided player's
 * contents sheet, which does not hold the clock, so an interval bout can run
 * out into its recovery under it. On iOS the ask cannot be presented over
 * it: UIKit refuses the second sheet, React Native records it as shown, and
 * its open flag holds every step clock for the rest of the workout (iOS hunt
 * 2026-10-17, S4-4). So it waits for a later rest. The banner does not stand
 * in for it either: nothing has been refused yet.
 */
export function restAlertMoment(input: {
  permission: RestAlertPermissionAnswer;
  asked: boolean;
  alertsWanted: boolean;
  channelMuted: boolean;
  blocked: boolean;
}): 'ask' | 'wait' | 'banner' | 'none' {
  const { permission, asked, alertsWanted, channelMuted, blocked } = input;
  if (permission === 'undetermined' && !asked) {
    return blocked ? 'wait' : 'ask';
  }
  if (alertsWanted && (permission !== 'granted' || channelMuted)) {
    return 'banner';
  }
  return 'none';
}
