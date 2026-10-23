import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, { Path } from 'react-native-svg';

import { PageHeader } from '../components/BackButton';
import { ListCard } from '../components/ListCard';
import { Seg } from '../components/Seg';
import { CARD_SHADOW, SectionLabel, ToggleSwitch } from '../components/SettingsUi';
import { MEASUREMENT_LABEL_KEYS } from '../lib/homeStatCards';
import { formatClockTime } from '../lib/format';
import { I18nKey, t } from '../lib/i18n';
import { MEASUREMENT_REMINDER_KINDS } from '../lib/measurementReminder';
import { NotificationAccessState } from '../lib/notificationAccessState';
import {
  DEFAULT_MEASUREMENT_KIND,
  notificationGroupsFor,
  NotificationGroup,
  NotificationGroupKey,
  NotificationGroupMemo,
  NotificationSwitch,
  notificationGroupSummary,
  readNotificationGroup,
  rememberNotificationGroup,
  toggleNotificationGroup,
} from '../lib/notificationGroups';
import { WEEKDAY_KEYS } from '../lib/programTrainingDays';
import { WEIGH_IN_HOUR, WEIGH_IN_MINUTE } from '../lib/notificationPlan';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppLanguage, NotificationLevel, NotificationPrefs, SetupWeekday } from '../types/models';

interface NotificationsScreenProps {
  prefs: NotificationPrefs;
  language?: AppLanguage;
  /**
   * Whether the reminders have days to fire on — read from the schedule the
   * reminders themselves follow (resolveReminderSchedule), not from the days
   * picked in setup. Those are only the last of three sources, and a reader
   * on a cycle, or whose plan names its weekdays, was told "No training days
   * picked yet" while the reminders fired.
   */
  scheduleKnown?: boolean;
  onTrainingBreak?: boolean;
  onBack: () => void;
  onChange: (patch: Partial<NotificationPrefs>) => void;
  /** Shows the system dialog when possible; resolves with what we ended up with. */
  requestPermission?: () => Promise<boolean>;
  /** Reads the current OS permission without prompting. */
  checkPermission?: () => Promise<boolean>;
  /**
   * Whether a rest alert can reach the reader, without prompting, and — when
   * it cannot — which of the two reasons: the permission refused, or granted
   * with the rest-alert channel switched off in Android's own settings. The
   * permission alone called a muted channel allowed (native audit,
   * 2026-09-21); a plain boolean then called it the same "not allowed" a
   * refused permission gets (#bugs, 2026-09-26). Falls back to
   * `checkPermission`, which cannot tell a muted channel from a refused
   * permission and reads every channel mute as `granted`.
   */
  checkWorkoutAlerts?: () => Promise<NotificationAccessState>;
  /**
   * Gets the workout alerts permission: the system dialog while Android can
   * still show it, its own settings page once it cannot — the channel's own
   * page when only the channel is muted, the app's general one otherwise.
   * Resolves with the state that leaves things in.
   */
  allowWorkoutAlerts?: () => Promise<NotificationAccessState>;
  /** Whether Android lets a rest alert ring on the second; null = cannot tell. */
  checkExactAlarms?: () => Promise<boolean | null>;
  /** Opens the system page that allows exact alarms for the app. */
  onAllowExactAlarms?: () => void;
  onOpenTrainingPlan?: () => void;
}

/** A time of day on the app's clock face, "07:30" — what formatClockTime writes. */
function clockLabel(hours: number, minutes: number) {
  return formatClockTime(new Date(2000, 0, 1, hours, minutes));
}

/** 05:00–22:00 in half hours — the window a reminder is worth sending in. */
const REMINDER_TIMES = Array.from({ length: 35 }, (_, index) => {
  const minutes = 5 * 60 + index * 30;
  return clockLabel(Math.floor(minutes / 60), minutes % 60);
});

const LEVELS: Array<{ key: NotificationLevel; titleKey: I18nKey; subKey: I18nKey }> = [
  { key: 'quiet', titleKey: 'notif.level.quiet', subKey: 'notif.level.quietSub' },
  { key: 'normal', titleKey: 'notif.level.normal', subKey: 'notif.level.normalSub' },
  { key: 'motivating', titleKey: 'notif.level.motivating', subKey: 'notif.level.motivatingSub' },
];

/** One glyph per group, from the design. */
const GROUP_ICONS: Record<NotificationGroupKey, string> = {
  workout: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  wins: 'M7 4h10v4a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 15h6M8 20h8M12 15v5',
  nudges: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

/** Full weekday names live under the widget's keys, Monday = 0. */
const WEEKDAY_NAME_KEYS: Record<SetupWeekday, I18nKey> = {
  mon: 'widget.weekday.0',
  tue: 'widget.weekday.1',
  wed: 'widget.weekday.2',
  thu: 'widget.weekday.3',
  fri: 'widget.weekday.4',
  sat: 'widget.weekday.5',
  sun: 'widget.weekday.6',
};
const MEASURE_TIME = clockLabel(WEIGH_IN_HOUR, WEIGH_IN_MINUTE);

/**
 * Notification settings (spec screen 4, restructured 2026-09-03 and again
 * 2026-09-17). Two kinds of notification, two kinds of switch.
 *
 * The workout alerts come first and answer to their own group switch: they
 * fire only while a session is open, ship on, and need nothing but the OS
 * permission (user decision 2026-09-17). They used to sit under the master
 * like everything else, and since the master ships off, the end-of-rest alert
 * was silent on most phones. When the OS is what keeps them quiet, the card
 * says so and offers the way to allow them.
 *
 * The master governs the scheduled notifications — reminders, recaps, the
 * trial warning — defaults to off, and everything below it dims and locks
 * while it stays off. It is the OS permission, not a wish: turning it on asks
 * Android for permission and only stores "on" if we got it. If the user later
 * revokes it in system settings, the mount check flips this back off rather
 * than letting the screen claim notifications are running when nothing can
 * be delivered.
 *
 * The switches are grouped (design "Vinha — Settings, Notifications & My
 * data"): each group says what it sends, carries one switch, and keeps every
 * original switch one tap in behind Details — see src/lib/notificationGroups.ts.
 */
export function NotificationsScreen({
  prefs,
  language = 'en',
  scheduleKnown = false,
  onTrainingBreak = false,
  onBack,
  onChange,
  requestPermission,
  checkPermission,
  // Cannot see a muted channel, only the app-wide permission — the best a
  // caller with no workout-specific check can offer.
  checkWorkoutAlerts = checkPermission &&
    (() => checkPermission().then((granted): NotificationAccessState => (granted ? 'granted' : 'denied'))),
  allowWorkoutAlerts,
  checkExactAlarms,
  onAllowExactAlarms,
  onOpenTrainingPlan,
}: NotificationsScreenProps) {
  // A training break silences the scheduled notifications until it ends, so
  // their switches show exactly that instead of staying lit under a note
  // (user, 2026-08-22). The workout alerts are not among them: a reader who
  // opens a session during a break is training, and wants its alerts.
  const effectiveEnabled = prefs.pushEnabled && !onTrainingBreak;
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [systemBlocked, setSystemBlocked] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<NotificationGroupKey | null>(null);
  /**
   * What each group held when it was switched off, so switching it back on
   * restores that rather than lighting everything up. Screen state, not a
   * stored preference: leaving the screen forgets it, and a restore with
   * nothing remembered falls back to the app's own defaults.
   */
  const [memos, setMemos] = useState<Partial<Record<NotificationGroupKey, NotificationGroupMemo>>>({});

  // Permission can be revoked while the app is closed, so trust the OS over
  // what we stored — and not only once on mount: the workout-alerts card
  // below already re-checks on every return to the foreground, but this
  // master card and every scheduled-notification toggle under it did not, so
  // revoking permission in Android settings and coming back left them all
  // still showing On (#bugs, 2026-09-29). Read through a ref rather than a
  // dependency array, so re-checking on every foreground does not also mean
  // re-checking on every prefs change the reader's own toggling causes.
  const latestScheduledRef = useRef({ pushEnabled: prefs.pushEnabled, checkPermission, onChange });
  latestScheduledRef.current = { pushEnabled: prefs.pushEnabled, checkPermission, onChange };
  // Bumped by every call, and read back once its own answer lands. AppState
  // fired 'active' twice in quick succession started two checks together; a
  // slower "denied" resolving after a fresher "granted" flipped the master
  // off under a permission that was actually still there (recheck round,
  // 2026-09-29). Only the call that is still the latest when it resolves may
  // act.
  const scheduledAccessGenerationRef = useRef(0);
  const readScheduledAccess = useCallback(() => {
    const { pushEnabled, checkPermission, onChange } = latestScheduledRef.current;
    if (!pushEnabled || !checkPermission) {
      return;
    }
    const generation = ++scheduledAccessGenerationRef.current;
    void checkPermission().then((granted) => {
      if (scheduledAccessGenerationRef.current !== generation) {
        // A newer check has started since this one; its answer, not this
        // stale one, is what the card must act on.
        return;
      }
      if (granted) {
        return;
      }
      setSystemBlocked(true);
      onChange({ pushEnabled: false });
    });
  }, []);

  /**
   * What the OS lets the workout alerts do: null until it has answered.
   * Denied and channelMuted both mean "the card shows", with different copy —
   * a plain boolean here is exactly the bug that called a muted channel the
   * same as a refused permission (#bugs, 2026-09-26). Read again whenever the
   * app comes back to the front, because the way to fix either answer is a
   * trip to system settings.
   */
  const [access, setAccess] = useState<NotificationAccessState | null>(null);
  const [exactAllowed, setExactAllowed] = useState<boolean | null>(null);
  // Same race as readScheduledAccess above, and the same fix: AppState firing
  // 'active' twice in quick succession can start two of these together, and a
  // slower stale answer resolving after a fresher one must not overwrite it —
  // exactly the bug that guard was added for one function up (recheck round,
  // 2026-09-29).
  const workoutAccessGenerationRef = useRef(0);
  const readWorkoutAccess = useCallback(() => {
    const generation = ++workoutAccessGenerationRef.current;
    void checkWorkoutAlerts?.().then((result) => {
      if (workoutAccessGenerationRef.current === generation) {
        setAccess(result);
      }
    });
    void checkExactAlarms?.().then((result) => {
      if (workoutAccessGenerationRef.current === generation) {
        setExactAllowed(result);
      }
    });
  }, [checkWorkoutAlerts, checkExactAlarms]);
  useEffect(() => {
    readWorkoutAccess();
    readScheduledAccess();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        readWorkoutAccess();
        readScheduledAccess();
      }
    });
    return () => subscription.remove();
  }, [readWorkoutAccess, readScheduledAccess]);

  const handleMasterChange = (next: boolean) => {
    if (!next) {
      setSystemBlocked(false);
      onChange({ pushEnabled: false });
      return;
    }
    if (!requestPermission) {
      onChange({ pushEnabled: true });
      return;
    }
    void requestPermission().then((granted) => {
      setSystemBlocked(!granted);
      // One permission for both kinds: the workout card's answer changed too.
      // Read, not assumed from `granted` — a muted rest-alert channel stays
      // muted whatever the permission says.
      readWorkoutAccess();
      onChange({ pushEnabled: granted });
    });
  };

  const handleGroupToggle = (group: NotificationGroup, next: boolean) => {
    setMemos((current) => ({
      ...current,
      [group.key]: next ? current[group.key] : rememberNotificationGroup(group, prefs),
    }));
    onChange(toggleNotificationGroup(group, next, next ? memos[group.key] ?? null : null));
    if (!next) {
      setOpenGroup((open) => (open === group.key ? null : open));
    }
  };

  /**
   * One switch inside a group.
   *
   * Turning off the last one empties the group, which closes the card — and
   * the reader's choices have to survive that, or tapping the group back on
   * would restore the defaults and re-enable the very switches they just
   * turned off. So the state BEFORE this change is remembered whenever the
   * group is about to empty, exactly as the group toggle does.
   */
  const handleSwitchToggle = (group: NotificationGroup, item: NotificationSwitch, next: boolean) => {
    const emptying = !next && readNotificationGroup(group, prefs).onCount === 1 && item.isOn(prefs);
    if (emptying) {
      setMemos((current) => ({ ...current, [group.key]: rememberNotificationGroup(group, prefs) }));
      setOpenGroup((open) => (open === group.key ? null : open));
    }
    onChange(item.patch(next));
  };

  const remindersWithoutDays = prefs.sessionReminders && !scheduleKnown;
  const measureKind = prefs.measurementReminderKind;
  const levelSub = LEVELS.find((level) => level.key === prefs.level)?.subKey ?? 'notif.level.normalSub';

  /**
   * The pickers that belong to one switch: a reminder needs a time, and a
   * measurement reminder needs a kind and a morning. They sit under their own
   * switch inside the group rather than in a section of their own.
   */
  const renderSwitchExtras = (item: NotificationSwitch) => {
    if (item.key === 'sessionReminders' && prefs.sessionReminders) {
      return (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'notif.reminderTime')}
            onPress={() => setTimePickerOpen((open) => !open)}
            style={({ pressed }) => [styles.detailRow, styles.rowDivider, pressed && { opacity: 0.75 }]}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.detailTitle}>{t(language, 'notif.reminderTime')}</Text>
              <Text style={styles.detailSub}>{t(language, 'notif.reminderTimeSub')}</Text>
            </View>
            <Text style={styles.timeValue}>{prefs.reminderTime}</Text>
          </Pressable>

          {timePickerOpen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeStrip}>
              {REMINDER_TIMES.map((time) => {
                const active = time === prefs.reminderTime;
                return (
                  <Pressable
                    key={time}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onChange({ reminderTime: time });
                      setTimePickerOpen(false);
                    }}
                    style={({ pressed }) => [styles.timeChip, active && styles.timeChipActive, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{time}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {/* No days picked = nothing to fire on. Say so instead of leaving a
              switch that quietly does nothing. */}
          {remindersWithoutDays ? (
            <View style={[styles.detailRow, styles.rowDivider]}>
              <View style={styles.rowCopy}>
                <Text style={styles.detailTitle}>{t(language, 'notif.noDaysTitle')}</Text>
                <Text style={styles.detailSub}>{t(language, 'notif.noDaysBody')}</Text>
              </View>
              {onOpenTrainingPlan ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onOpenTrainingPlan}
                  hitSlop={8}
                  style={({ pressed }) => pressed && { opacity: 0.65 }}
                >
                  <Text style={styles.rowAction}>{t(language, 'notif.noDaysAction')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      );
    }

    if (item.key === 'measurement' && measureKind) {
      return (
        <>
          <Text style={styles.pickerLabel}>{t(language, 'notif.measure.kind')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeStrip}>
            {MEASUREMENT_REMINDER_KINDS.map((kind) => {
              const active = kind === measureKind;
              return (
                <Pressable
                  key={kind}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => onChange({ measurementReminderKind: kind })}
                  style={({ pressed }) => [styles.timeChip, active && styles.timeChipActive, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                    {t(language, MEASUREMENT_LABEL_KEYS[kind])}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.pickerLabel}>{t(language, 'notif.measure.day')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeStrip}>
            {WEEKDAY_KEYS.map((day) => {
              const active = day === prefs.measurementReminderDay;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => onChange({ measurementReminderDay: day })}
                  style={({ pressed }) => [styles.timeChip, active && styles.timeChipActive, pressed && { opacity: 0.75 }]}
                >
                  <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                    {t(language, WEEKDAY_NAME_KEYS[day])}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      );
    }

    return null;
  };

  /**
   * What stands between a lit workout card and an alert that rings: the OS
   * permission or the rest-alert channel first, then — for the end-of-rest
   * alert — Android's exact-alarm grant, without which the alert may arrive
   * minutes after the rest ended. Nothing is shown while an answer is still
   * unknown.
   *
   * The permission and the channel say different things and fix differently,
   * so the card names which one is true rather than one flat "not allowed"
   * for both (#bugs, 2026-09-26).
   */
  const renderWorkoutAccess = () => {
    if (access !== null && access !== 'granted' && allowWorkoutAlerts) {
      const channelMuted = access === 'channelMuted';
      return (
        <View style={[styles.detailRow, styles.accessRow]}>
          <View style={styles.rowCopy}>
            <Text style={styles.detailTitle}>
              {channelMuted
                ? t(language, 'notif.workout.channelMutedTitle', { channel: t(language, 'notif.rest.alerts') })
                : t(language, 'notif.workout.blockedTitle')}
            </Text>
            <Text style={styles.detailSub}>
              {channelMuted ? t(language, 'notif.workout.channelMutedBody') : t(language, 'notif.workout.blockedBody')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void allowWorkoutAlerts().then(setAccess)}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.65 }}
          >
            <Text style={styles.rowAction}>{t(language, 'notif.workout.allow')}</Text>
          </Pressable>
        </View>
      );
    }
    if (access === 'granted' && prefs.restAlerts && exactAllowed === false && onAllowExactAlarms) {
      return (
        <View style={[styles.detailRow, styles.accessRow]}>
          <View style={styles.rowCopy}>
            <Text style={styles.detailTitle}>{t(language, 'notif.exact.title')}</Text>
            <Text style={styles.detailSub}>{t(language, 'notif.exact.body')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onAllowExactAlarms}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.65 }}
          >
            <Text style={styles.rowAction}>{t(language, 'notif.workout.allow')}</Text>
          </Pressable>
        </View>
      );
    }
    return null;
  };

  const renderGroup = (group: NotificationGroup) => {
    const reading = readNotificationGroup(group, prefs);
    // The master and a break govern the scheduled groups only; the workout
    // group is its own switch. A card the master governs reads off while the
    // master or a break keeps it quiet — the rule its switches follow.
    const governed = group.scheduled ? effectiveEnabled : true;
    const groupOn = governed && reading.isOn;
    const open = openGroup === group.key;
    const summary = groupOn
      ? notificationGroupSummary(group, prefs, language, t)
      : t(language, group.blurbKey);
    // The measurement's own line names what and when, which the summary cannot.
    const measureLine =
      group.key === 'nudges' && measureKind
        ? `${t(language, MEASUREMENT_LABEL_KEYS[measureKind])} · ${t(
            language,
            WEEKDAY_NAME_KEYS[prefs.measurementReminderDay],
          )} ${MEASURE_TIME}`
        : null;

    return (
      // A row of the section's one ListCard, not a card of its own: the lit
      // icon says it is on, not a purple border (the unified list style).
      <View key={group.key}>
        <View style={styles.groupHead}>
          <View style={[styles.groupIcon, groupOn && styles.groupIconOn]}>
            <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
              <Path
                d={GROUP_ICONS[group.key]}
                stroke={groupOn ? theme.highlight : theme.faint}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <View style={styles.rowCopy}>
            <Text style={styles.groupTitle}>{t(language, group.titleKey)}</Text>
            <Text numberOfLines={2} style={[styles.rowSub, !groupOn && styles.rowSubOff]}>
              {summary}
            </Text>
          </View>
          <ToggleSwitch
            label={t(language, group.titleKey)}
            value={groupOn}
            onChange={(next) => handleGroupToggle(group, next)}
          />
        </View>

        {groupOn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpenGroup(open ? null : group.key)}
            style={({ pressed }) => [styles.disclosure, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.disclosureText}>
              {open
                ? t(language, 'notif.group.hide')
                : t(language, 'notif.group.details', { on: reading.onCount, total: reading.total })}
            </Text>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path
                d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                stroke={theme.highlight}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        ) : null}

        {groupOn && open ? (
          <View style={styles.details}>
            {group.switches.map((item, index) => (
              <React.Fragment key={item.key}>
                <View style={[styles.detailRow, index !== group.switches.length - 1 && styles.rowDivider]}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.detailTitle}>{t(language, item.titleKey)}</Text>
                    <Text style={styles.detailSub}>
                      {item.key === 'measurement' && measureLine ? measureLine : t(language, item.subKey)}
                    </Text>
                  </View>
                  <ToggleSwitch
                    label={t(language, item.titleKey)}
                    value={governed && item.isOn(prefs)}
                    onChange={(next) => handleSwitchToggle(group, item, next)}
                  />
                </View>
                {renderSwitchExtras(item)}
              </React.Fragment>
            ))}
          </View>
        ) : null}

        {!group.scheduled && groupOn ? renderWorkoutAccess() : null}
      </View>
    );
  };

  const groups = notificationGroupsFor(Platform.OS);
  const workoutGroups = groups.filter((group) => !group.scheduled);
  const scheduledGroups = groups.filter((group) => group.scheduled);

  return (
    <View style={styles.screen}>
      <PageHeader
        style={styles.header}
        title={t(language, 'notif.title')}
        onBack={onBack}
        backLabel={t(language, 'common.back')}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* The workout alerts: their own switch, outside the master's reach. */}
        <View style={styles.firstSection}>
          <SectionLabel label={t(language, 'notif.section.workout')} />
          <ListCard>{workoutGroups.map(renderGroup)}</ListCard>
        </View>

        {/* master — the scheduled notifications */}
        <View style={[styles.card, styles.masterCard, prefs.pushEnabled && styles.masterCardOn]}>
          <View style={styles.masterCopy}>
            <Text style={styles.masterTitle}>{t(language, 'notif.push')}</Text>
            <Text style={[styles.masterSub, systemBlocked && styles.masterSubBlocked]}>
              {systemBlocked
                ? t(language, 'notif.blocked')
                : t(language, prefs.pushEnabled ? 'notif.pushOn' : 'notif.pushOff')}
            </Text>
          </View>
          <ToggleSwitch
            label={t(language, 'notif.push')}
            value={prefs.pushEnabled}
            onChange={handleMasterChange}
          />
        </View>

        {prefs.pushEnabled && onTrainingBreak ? (
          <Text style={styles.note}>{t(language, 'notif.breakNote')}</Text>
        ) : null}

        {/* Everything below obeys the master switch. The workout alerts do
            not, and so sit above it rather than lit inside a dimmed area. */}
        <View style={styles.dimmable} pointerEvents={effectiveEnabled ? 'auto' : 'none'}>
          <View style={effectiveEnabled ? null : styles.dimmed}>
            <View style={styles.section}>
              <SectionLabel label={t(language, 'notif.section.what')} />
              <ListCard>{scheduledGroups.map(renderGroup)}</ListCard>
            </View>

            <View style={styles.section}>
              <SectionLabel label={t(language, 'notif.howMuch')} />
              <View style={[styles.card, styles.levelCard]}>
                <Seg
                  grow
                  options={LEVELS.map((level) => ({ key: level.key, label: t(language, level.titleKey) }))}
                  value={prefs.level}
                  onChange={(next) => onChange({ level: next })}
                />
                <Text style={styles.levelLine}>
                  {`${t(language, levelSub)} ${t(language, 'notif.level.restNote')}`}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>{t(language, 'notif.footer')}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: 8,
    paddingBottom: 6,
  },
  body: {
    paddingTop: 4,
    paddingHorizontal: layout.screenGutter,
    paddingBottom: layout.bottomTabBarReserve,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    ...CARD_SHADOW,
  },
  masterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    marginTop: 22,
  },
  firstSection: {
    marginTop: 4,
  },
  accessRow: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  masterCardOn: {
    borderColor: theme.purple,
  },
  masterCopy: {
    flex: 1,
    minWidth: 0,
  },
  masterTitle: {
    color: theme.ink,
    fontSize: 15.5,
    fontWeight: '800',
  },
  masterSub: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 2,
  },
  // theme.danger rather than a fixed #C0392B, which was 3.23:1 on the dark
  // card (accessibility audit, 2026-09-21).
  masterSubBlocked: {
    color: theme.danger,
  },
  note: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  dimmable: {},
  dimmed: {
    opacity: 0.45,
  },
  section: {
    marginTop: 22,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: theme.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIconOn: {
    backgroundColor: theme.highlightSoft,
  },
  groupTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 11,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  disclosureText: {
    color: theme.highlight,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surfaceSoft,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingRight: 15,
    paddingLeft: 22,
  },
  detailTitle: {
    color: theme.ink,
    fontSize: 13.5,
    fontWeight: '800',
  },
  detailSub: {
    color: theme.faint,
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 16,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowSub: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
    lineHeight: 17,
  },
  rowSubOff: {
    color: theme.faint,
  },
  rowAction: {
    color: theme.purple,
    fontSize: 12.5,
    fontWeight: '800',
  },
  levelCard: {
    padding: 15,
  },
  levelLine: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17.5,
    marginTop: 11,
  },
  timeValue: {
    color: theme.purple,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pickerLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  timeStrip: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 22,
    paddingBottom: 14,
    paddingTop: 8,
  },
  timeChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
  },
  // The white-label violet (accessibility audit, 2026-09-21).
  timeChipActive: {
    borderColor: theme.purpleFill,
    backgroundColor: theme.purpleFill,
  },
  timeChipText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timeChipTextActive: {
    color: '#FFFFFF',
  },
  footer: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 24,
    paddingHorizontal: 10,
  },
});
