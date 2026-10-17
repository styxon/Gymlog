import { I18nKey } from './i18n';
import { AppLanguage, NotificationPrefs } from '../types/models';

/**
 * The notification screen's three groups (design "Vinha — Settings,
 * Notifications & My data", user 2026-09-03: "3 switches instead of 10").
 *
 * The screen shipped as ten switches in two flat lists, which is a form to
 * fill rather than a question to answer. The switches are unchanged and every
 * one is still reachable — they move one tap in, behind a group that says what
 * it sends and when. Nothing here changes what is scheduled: this is a reading
 * of NotificationPrefs, and the patches it returns are the same fields the
 * flat list wrote.
 *
 * A group is on when any of its switches is. Turning it off remembers what was
 * on so turning it back on restores that; with nothing remembered it restores
 * the app's own defaults rather than lighting everything up.
 */
export type NotificationGroupKey = 'workout' | 'wins' | 'nudges';

export interface NotificationSwitch {
  /** Stable id — the pref field, except for the measurement's kind/day pair. */
  key: string;
  titleKey: I18nKey;
  subKey: I18nKey;
  /**
   * The name in the group's one-line summary, where the full title would not
   * fit ("Keep session on lock screen"). Absent = the title is already short.
   */
  shortKey?: I18nKey;
  /** What a restore falls back to: the value a fresh install ships with. */
  restoreDefault: boolean;
  isOn: (prefs: NotificationPrefs) => boolean;
  patch: (next: boolean) => Partial<NotificationPrefs>;
  /**
   * The fields this switch owns, exactly as stored.
   *
   * `patch(true)` only knows "on", which for the measurement means the
   * DEFAULT kind — so a group turned off and back on silently moved a
   * reader's waist reminder to hips. A restore replays this instead.
   */
  capture: (prefs: NotificationPrefs) => Partial<NotificationPrefs>;
}

export interface NotificationGroup {
  key: NotificationGroupKey;
  titleKey: I18nKey;
  /** What the group is, shown while it is off. */
  blurbKey: I18nKey;
  /**
   * Whether the phone's Notifications switch governs this group.
   *
   * The scheduled groups wait on it; the workout group does not (user
   * 2026-09-17). Its alerts fire only while a session is open, so they have
   * their own switches and need nothing but the OS permission — gated on a
   * switch that ships off, the end-of-rest alert was silent on most phones.
   */
  scheduled: boolean;
  switches: NotificationSwitch[];
}

/** The kind a fresh measurement reminder picks — the one the request named. */
export const DEFAULT_MEASUREMENT_KIND = 'hips' as const;

function boolSwitch(
  field: 'restAlerts' | 'restWarning' | 'sessionOngoing' | 'idleNudge' | 'personalRecords' | 'weeklySummary' | 'comebackNudge' | 'sessionReminders' | 'weighInReminder',
  titleKey: I18nKey,
  subKey: I18nKey,
  restoreDefault: boolean,
  shortKey?: I18nKey,
): NotificationSwitch {
  return {
    key: field,
    titleKey,
    subKey,
    shortKey,
    restoreDefault,
    isOn: (prefs) => Boolean(prefs[field]),
    patch: (next) => ({ [field]: next }) as Partial<NotificationPrefs>,
    capture: (prefs) => ({ [field]: Boolean(prefs[field]) }) as Partial<NotificationPrefs>,
  };
}

/**
 * The measurement reminder has no boolean of its own: the kind IS the switch,
 * because "on" with nothing to measure is a reminder that cannot say what it
 * is for. It reads and writes like the others so the group does not need a
 * special case.
 */
const measurementSwitch: NotificationSwitch = {
  key: 'measurement',
  titleKey: 'notif.measure',
  subKey: 'notif.measureSub',
  restoreDefault: false,
  isOn: (prefs) => prefs.measurementReminderKind !== null,
  patch: (next) => ({ measurementReminderKind: next ? DEFAULT_MEASUREMENT_KIND : null }),
  // The kind AND the morning: both are the reader's, and both are lost if a
  // restore can only say "on".
  capture: (prefs) => ({
    measurementReminderKind: prefs.measurementReminderKind,
    measurementReminderDay: prefs.measurementReminderDay,
  }),
};

let iosGroups: readonly NotificationGroup[] | null = null;

/**
 * The groups as a platform shows them.
 *
 * iOS has no ongoing notification (a Live Activity would be the carrier
 * there), so its "Keep session on lock screen" switch did nothing, on by
 * default; and its 10-second warning is a silent notification, not the
 * haptic tick the Android line promises (iOS hunt 2026-10-17, S6-4). The
 * stored preference is left alone: only what is shown changes.
 */
export function notificationGroupsFor(platform: string): readonly NotificationGroup[] {
  if (platform !== 'ios') {
    return NOTIFICATION_GROUPS;
  }
  iosGroups ??= NOTIFICATION_GROUPS.map((group) => ({
    ...group,
    switches: group.switches
      .filter((item) => item.key !== 'sessionOngoing')
      .map((item) => (item.key === 'restWarning' ? { ...item, subKey: 'notif.rest.warningSubIos' as const } : item)),
  }));
  return iosGroups;
}

export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  {
    key: 'workout',
    titleKey: 'notif.group.workout',
    blurbKey: 'notif.group.workoutBlurb',
    scheduled: false,
    switches: [
      boolSwitch('restAlerts', 'notif.rest.alerts', 'notif.rest.alertsSub', true),
      boolSwitch('restWarning', 'notif.rest.warning', 'notif.rest.warningSub', true),
      boolSwitch('sessionOngoing', 'notif.rest.ongoing', 'notif.rest.ongoingSub', true, 'notif.short.ongoing'),
      boolSwitch('idleNudge', 'notif.rest.idle', 'notif.rest.idleSub', true),
    ],
  },
  {
    key: 'wins',
    titleKey: 'notif.group.wins',
    blurbKey: 'notif.group.winsBlurb',
    scheduled: true,
    switches: [
      boolSwitch('personalRecords', 'notif.records', 'notif.recordsSub', true),
      boolSwitch('weeklySummary', 'notif.weekly', 'notif.weeklySub', true),
    ],
  },
  {
    key: 'nudges',
    titleKey: 'notif.group.nudges',
    blurbKey: 'notif.group.nudgesBlurb',
    scheduled: true,
    switches: [
      boolSwitch('sessionReminders', 'notif.reminders', 'notif.remindersSub', false),
      boolSwitch('comebackNudge', 'notif.comeback', 'notif.comebackSub', true),
      boolSwitch('weighInReminder', 'notif.weighIn', 'notif.weighInSub', false),
      measurementSwitch,
    ],
  },
];

/**
 * What a group held while it was off, so it can come back exactly.
 *
 * `on` answers "was anything on" — a memo of all-off would restore nothing
 * and leave the group on with no switches. `values` is the replay: the
 * stored fields themselves, so a chosen measurement kind survives.
 */
export interface NotificationGroupMemo {
  on: Record<string, boolean>;
  values: Partial<NotificationPrefs>;
}

export interface NotificationGroupReading {
  onCount: number;
  total: number;
  /** A group is on when any of its switches is. */
  isOn: boolean;
  /** The switches that are on, in the group's own order. */
  onSwitches: NotificationSwitch[];
}

export function readNotificationGroup(group: NotificationGroup, prefs: NotificationPrefs): NotificationGroupReading {
  const onSwitches = group.switches.filter((item) => item.isOn(prefs));
  return {
    onCount: onSwitches.length,
    total: group.switches.length,
    isOn: onSwitches.length > 0,
    onSwitches,
  };
}

/** What the switches held, so turning the group back on can restore it. */
export function rememberNotificationGroup(group: NotificationGroup, prefs: NotificationPrefs): NotificationGroupMemo {
  return {
    on: group.switches.reduce<Record<string, boolean>>((flags, item) => {
      flags[item.key] = item.isOn(prefs);
      return flags;
    }, {}),
    values: Object.assign({}, ...group.switches.map((item) => item.capture(prefs))),
  };
}

/**
 * The patch a group toggle writes.
 *
 * Off: every switch goes false. On: the remembered set comes back, and if
 * nothing was remembered — or everything remembered was off, which would
 * leave the group on with no switches — the defaults do.
 */
export function toggleNotificationGroup(
  group: NotificationGroup,
  next: boolean,
  memo: NotificationGroupMemo | null,
): Partial<NotificationPrefs> {
  if (!next) {
    return Object.assign({}, ...group.switches.map((item) => item.patch(false)));
  }
  if (memo !== null && group.switches.some((item) => memo.on[item.key])) {
    // Replayed as stored, not re-derived from "on".
    return { ...memo.values };
  }
  return Object.assign({}, ...group.switches.map((item) => item.patch(item.restoreDefault)));
}

/**
 * The group's one line: what it will send, or what it is for when it is off.
 * `translate` is passed in rather than imported so this stays a pure reading
 * of the prefs — the same reason the rest of src/lib takes its language.
 */
export function notificationGroupSummary(
  group: NotificationGroup,
  prefs: NotificationPrefs,
  language: AppLanguage,
  translate: (language: AppLanguage, key: I18nKey) => string,
): string {
  const reading = readNotificationGroup(group, prefs);
  if (!reading.isOn) {
    return translate(language, group.blurbKey);
  }
  return reading.onSwitches.map((item) => translate(language, item.shortKey ?? item.titleKey)).join(' · ');
}
