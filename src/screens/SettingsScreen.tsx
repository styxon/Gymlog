import React, { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { AppleSignInButton } from '../components/AppleSignInButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenHeaderTitle } from '../components/ScreenHeaderTitle';
import { CARD_SHADOW, SectionLabel, ToggleSwitch } from '../components/SettingsUi';
import type { SignInProvider } from '../features/account/accountAuth';
import { buildFeedbackMailto } from '../lib/feedbackLink';
import { formatDateNumeric } from '../lib/format';
import { LEGAL_ENTITY } from '../lib/legalDocuments';
import { type CloudCopyState, resetDialogMessageKey } from '../lib/accountBackup';
import { profileInitials } from '../lib/profileName';
import { t } from '../lib/i18n';
import { resolveProEntitlement } from '../lib/proEntitlement';
import { Theme, darkTheme, useTheme, useThemedStyles } from '../theming';
import { appInfo, layout } from '../theme';
import { COACH_COPIES_KEPT } from '../lib/aiCoachLogId';
import { AppLanguage, AppPreferences } from '../types/models';

interface SettingsScreenProps {
  preferences: AppPreferences;
  /** ISO timestamp of the first completed session — the honest "member since". */
  onBack: () => void;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  onOpenMyData: () => void;
  onOpenEditProfile: () => void;
  /** Opens the paste-CSV sheet — the same importer the Programs tab uses. */
  onImportPlan: () => void;
  onExportPlan: () => void;
  /**
   * Null on devices that cannot pin a widget — the row is hidden rather than
   * shown as something that would do nothing.
   */
  homeWidget?: { added: boolean; onAdd: () => void } | null;
  onOpenNotifications: () => void;
  onOpenTrainingBreak: () => void;
  /** Hands Home, Progress and Profile their first-run tour back, and goes Home. */
  onReplayTour: () => void;
  onOpenSubscription: () => void;
  /**
   * The ONE Pro page. Every place a reader shows interest in Pro — the
   * locked theme row, the subscription row before there is a subscription
   * — goes here, not to the management screen with its price rows.
   * Management is for people who already pay.
   */
  onOpenPremium: () => void;
  onOpenLegal: (document: 'privacy' | 'terms') => void;
  /**
   * Turn one of the coach's keep-a-copy lines on or off. Off also deletes
   * what was already kept, which is why this is a callback rather than a
   * preference write the row could do itself.
   */
  onWithdrawCoachLog?: (line: 'chat' | 'composer' | 'photo', next: boolean) => void | Promise<void>;
  /**
   * Where the list was scrolled when a sub-screen was opened, so coming
   * back lands on the row that was tapped instead of the top (user,
   * 2026-08-22). The parent owns the value because this screen unmounts.
   */
  initialScrollOffset?: number;
  onScrollOffsetChange?: (offsetY: number) => void;
  /** Reports its own failures; the dialog closes when it is confirmed, not when this resolves. */
  onResetAllData: () => void | Promise<void>;
  /**
   * Shown only while the crash screen's set-aside copy of the workout data is on
   * the phone (WorkoutProvider setAsideWorkoutAvailable). Called after the
   * reader confirmed.
   */
  onRestoreSetAsideWorkout?: (() => void) | null;
  /**
   * Null in builds without a configured sign-in — the rows are hidden rather
   * than shown as buttons that would do nothing. Free and Pro alike.
   */
  account?: {
    signedIn: boolean;
    email: string | null;
    lastBackupAt: string | null;
    /**
     * Why the automatic backup is standing still until the reader decides
     * (useAccountBackup). A green time over backups that are not happening
     * was the row saying everything was fine.
     */
    backupPaused?: 'other_phone' | 'smaller_phone' | 'copy_deleted' | null;
    busy: boolean;
    /** The sign-ins this build offers (accountAuth): Apple on iPhone, Google where configured. */
    providers: SignInProvider[];
    onSignIn: (provider: SignInProvider) => void;
    onBackupNow: () => void;
    onSignOut: () => void;
    /**
     * What the cloud holds, read when the Reset dialog opens: "your cloud
     * backup stays" is only a promise of a restore when the copy holds
     * everything, and false when there is no copy (a deleted one, an upload
     * the reader declined).
     */
    cloudCopyState: () => CloudCopyState;
    onDeleteRemote: () => void;
    /** Deletes the cloud copy and the server's sign-in, then signs out (App Review 5.1.1(v)). */
    onDeleteAccount: () => void;
  } | null;
}


/*
 * Prototype icon set (psuite-shared.jsx `Ic`): 24x24 strokes, 20px in the tile.
 *
 * Keyed by name, and the name is a type. This was a Record<string, string>
 * read with `?? ''`, so a row asking for an icon the set never had — the three
 * coach-log rows asked for brain, file and eye — compiled, rendered an empty
 * tile, and nothing said so.
 */
const IC_PATHS = {
  gift: 'M4 11h16v9H4zM4 8h16v3H4zM12 8v12M12 8S9 3 6.5 5 8 8 12 8zM12 8s3-5 5.5-3S16 8 12 8',
  moon: 'M20 14a8 8 0 01-10-10 8 8 0 1010 10z',
  bell: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 004 0',
  chat: 'M4 5h16v11H9l-4 4V5z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  heart: 'M12 20S4 14 4 9a4 4 0 017.5-2A4 4 0 0120 9c0 5-8 11-8 11z',
  pause: 'M4 12a8 8 0 1116 0M8 9v6M16 9v6',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.5 3.6-5.5 8-5.5s8 2 8 5.5',
  body: 'M12 4a1.6 1.6 0 100 .1M5 8h14M9 8v4l-1.5 8M15 8v4l1.5 8',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  card: 'M3 6h18v12H3zM3 10h18',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  shield: 'M12 3l8 3v6c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6z',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5h.01',
  analytics: 'M4 20V4M4 20h16M8 16l3-4 3 2 4-6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 6l6 6-6 6',
  star: 'm12 3.5 2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.74.99-5.79-4.21-4.1 5.82-.85z',
} satisfies Record<string, string>;

type IcName = keyof typeof IC_PATHS;

function Ic({ n, c, s = 20, sw = 2 }: { n: IcName; c?: string; s?: number; sw?: number }) {
  // A parameter default cannot reach a hook; resolve it in the body.
  const theme = useTheme();
  const stroke = c ?? theme.purpleDark;

  return (
    <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <Path d={IC_PATHS[n]} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Prototype Seg: track #EEE8FA r12 pad3, active pill white r9, 13/800. */
function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.seg}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={[styles.segItem, active && styles.segItemActive]}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Prototype Row: 13px/15px padding, 36 tile r11, hairline divider inside a Card. */
/**
 * "22.8.2026 14:32" — the date alone hid every same-day backup. The date is
 * written in the app's language: toLocaleDateString() followed the phone, so
 * a Finnish reader on an English phone read "8/22/2026".
 */
function backupTimeLabel(iso: string, language: AppLanguage): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDateNumeric(date, language)} ${hh}:${mm}`;
}

function Row({
  icon,
  iconColor,
  title,
  sub,
  subNode,
  value,
  control,
  chevron = false,
  danger = false,
  positive = false,
  last = false,
  disabled = false,
  onPress,
}: {
  icon: IcName;
  iconColor?: string;
  title: string;
  sub?: string;
  /** Rich subtitle; wins over `sub` when both are given. */
  subNode?: React.ReactNode;
  value?: string;
  control?: React.ReactNode;
  chevron?: boolean;
  danger?: boolean;
  /** Green: an action that keeps the data safe (sign in, back up). */
  positive?: boolean;
  last?: boolean;
  /**
   * Shown, dimmed, and not pressable. A row that simply dropped its handler
   * looked exactly like a live one and swallowed the tap without a word.
   */
  disabled?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const inner = (
    <View style={[styles.row, !last && styles.rowDivider, disabled && styles.rowDisabled]}>
      {/* The danger tokens, not a fixed #C0392B on #FBEAE7: those were
          light-surface values, and the title was 3.23:1 on the dark card
          (accessibility audit, 2026-09-21). */}
      <View style={[styles.rowTile, danger && { backgroundColor: theme.dangerSoft }, positive && { backgroundColor: theme.greenSoft }]}>
        <Ic n={icon} c={danger ? theme.danger : positive ? theme.greenInk : iconColor ?? theme.highlight} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, danger && { color: theme.danger }, positive && { color: theme.greenInk }]}>{title}</Text>
        {subNode ?? (sub ? <Text style={styles.rowSub}>{sub}</Text> : null)}
      </View>
      {value !== undefined ? <Text style={styles.rowValue}>{value}</Text> : null}
      {control}
      {chevron ? <Ic n="chevron" c={theme.faint} s={18} sw={2.2} /> : null}
    </View>
  );

  if (disabled) {
    return (
      <View accessible accessibilityRole="button" accessibilityState={{ disabled: true }}>
        {inner}
      </View>
    );
  }
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

/**
 * Settings, pushed from the Profile gear. Mirrors psuite-screens1.jsx
 * SettingsMenu.
 *
 * Every row here either does something or states a fact. The two that asserted
 * an account the app does not have are gone, CSV import/export reach the real
 * importer and exporter, and the theme row became a live switch when the
 * engine landed (2026-08-01). If a row is added back without a handler, say
 * why in a comment.
 */
export function SettingsScreen({
  preferences,
  onBack,
  onPreferencesChange,
  onOpenMyData,
  onOpenEditProfile,
  onImportPlan,
  onExportPlan,
  homeWidget = null,
  onOpenNotifications,
  onOpenTrainingBreak,
  onReplayTour,
  onOpenSubscription,
  onOpenPremium,
  onOpenLegal,
  onWithdrawCoachLog,
  onResetAllData,
  onRestoreSetAsideWorkout = null,
  account,
  initialScrollOffset = 0,
  onScrollOffsetChange,
}: SettingsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [resetVisible, setResetVisible] = useState(false);
  const [resetCloudCopy, setResetCloudCopy] = useState<CloudCopyState>('current');
  const [restoreAsideVisible, setRestoreAsideVisible] = useState(false);
  const language = preferences.appLanguage;
  // A redeemed promo is Pro too, so the badge cannot read the preview switch.
  const proUnlocked = resolveProEntitlement(preferences).unlocked;
  const scrollRef = useRef<ScrollView>(null);
  const restoredRef = useRef(false);
  const displayName = preferences.profileName?.trim() ? preferences.profileName.trim() : t(language, 'profile.guestName');
  const soundAndHaptics = preferences.soundCuesEnabled || preferences.hapticsEnabled;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'settings.a11y.back')}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ic n="back" c={theme.ink} s={20} sw={2.4} />
        </Pressable>
        <ScreenHeaderTitle title={t(language, 'settings.title')} />
        {/* No PRO pill. It moved here from the profile chip on 2026-08-25 and
            was still a badge that told the reader something they already know,
            on the screen where they came to change a setting (user
            2026-09-04). The subscription row below says what they have. */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        scrollEventThrottle={64}
        onScroll={(event) => onScrollOffsetChange?.(event.nativeEvent.contentOffset.y)}
        onContentSizeChange={() => {
          // contentOffset is iOS-only, so the restore is a one-time scrollTo
          // once the content is tall enough to hold the old position.
          if (!restoredRef.current && initialScrollOffset > 0) {
            restoredRef.current = true;
            scrollRef.current?.scrollTo({ y: initialScrollOffset, animated: false });
          }
        }}
      >
        {/* profile chip */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'settings.a11y.editProfile')}
          onPress={onOpenEditProfile}
          style={({ pressed }) => [styles.profileChip, pressed && styles.pressed]}
        >
          <View style={styles.profileChipAvatar}>
            <Svg width={52} height={52} viewBox="0 0 52 52" style={StyleSheet.absoluteFill as object}>
              <Defs>
                <LinearGradient id="chipAv" x1="0" y1="0" x2="0.6" y2="1">
                  <Stop offset="0" stopColor="#2A1B4E" />
                  <Stop offset="1" stopColor="#5B21B6" />
                </LinearGradient>
              </Defs>
              <Circle cx={26} cy={26} r={26} fill="url(#chipAv)" />
            </Svg>
            <Text style={styles.profileChipInitials}>{profileInitials(preferences.profileName)}</Text>
          </View>
          <View style={styles.profileChipCopy}>
            {/* Just the name. The "member since / new here" line under it was
                the user's "ihan turha" (2026-08-25), and the PRO badge moved
                to the header's top-right corner on the same note. */}
            <Text numberOfLines={1} style={styles.profileChipName}>
              {displayName}
            </Text>
          </View>
          <Ic n="chevron" c={theme.faint} s={18} sw={2.2} />
        </Pressable>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.app')} />
          <View style={styles.card}>
            {/* One switch, for everyone. This row had two states — a live
                switch for Pro and a PRO pill for everyone else — until the
                gate came off on 2026-08-23. Nothing here consults the
                entitlement any more, which is the point: a leftover lock is
                how a removed gate keeps haunting the app. */}
            <Row
              icon="moon"
              title={t(language, 'settings.darkTheme')}
              sub={t(language, 'settings.darkTheme.sub')}
              control={
                <ToggleSwitch
                  label={t(language, 'settings.darkTheme')}
                  value={preferences.darkThemeEnabled}
                  onChange={(next) => onPreferencesChange({ darkThemeEnabled: next })}
                />
              }
            />
            <Row
              icon="bell"
              title={t(language, 'settings.soundHaptics')}
              sub={t(language, 'settings.soundHaptics.sub')}
              control={
                <ToggleSwitch
                  label={t(language, 'settings.soundHaptics')}
                  value={soundAndHaptics}
                  onChange={(next) => onPreferencesChange({ soundCuesEnabled: next, hapticsEnabled: next })}
                />
              }
            />
            <Row
              icon="sun"
              title={t(language, 'settings.keepAwake')}
              sub={t(language, 'settings.keepAwake.sub')}
              control={
                <ToggleSwitch
                  label={t(language, 'settings.keepAwake')}
                  value={preferences.keepScreenAwakeDuringWorkout}
                  onChange={(next) => onPreferencesChange({ keepScreenAwakeDuringWorkout: next })}
                />
              }
            />
            {/* The way back to the first-run tour. Saying it exists is what
                makes skipping the tour safe (design brief, the bar's pass). */}
            <Row
              icon="spark"
              title={t(language, 'settings.replayTour')}
              chevron
              onPress={onReplayTour}
            />
            <Row
              icon="chat"
              title={t(language, 'settings.language')}
              last
              control={
                <Seg
                  options={[
                    { key: 'fi', label: 'FIN' },
                    { key: 'en', label: 'ENG' },
                  ]}
                  value={preferences.appLanguage}
                  onChange={(next: AppLanguage) => onPreferencesChange({ appLanguage: next })}
                />
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.training')} />
          <View style={styles.card}>
            {/* Smart progression removed — returns later as a Pro feature. */}
            {/* Health Connect removed for v1 — returns in v2 as a workout
                export rather than a body-stats import. */}
            <Row
              icon="pause"
              title={t(language, 'settings.trainingBreak')}
              sub={t(language, 'settings.trainingBreak.sub')}
              chevron
              last
              onPress={onOpenTrainingBreak}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.account')} />
          <View style={styles.card}>
            {/* Edit profile row dropped — the profile chip above is the entry. */}
            <Row
              icon="bell"
              title={t(language, 'settings.notifications')}
              sub={t(language, 'settings.notifications.sub')}
              chevron
              onPress={onOpenNotifications}
            />
            <Row icon="body" title={t(language, 'settings.myData')} sub={t(language, 'settings.myData.sub')} chevron onPress={onOpenMyData} />
            {/* Before Pro the row is the way to Pro; after, it manages it. */}
            <Row
              icon="card"
              title={t(language, proUnlocked ? 'settings.subscription' : 'settings.pro')}
              chevron
              last
              onPress={proUnlocked ? onOpenSubscription : onOpenPremium}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.yourData')} />
          <View style={styles.card}>
            {/* The one thing the app sends on its own, and the reader's say
                over it (user, 2026-09-04). A real gate, not a statement: the
                preference reaches analyticsClient through App.tsx, and off
                also drops the queue and the install id. The old analytics row
                was a switch wired to nothing; tests/lib/legalDocuments.test.cjs
                pins every link of this one. */}
            <Row
              icon="analytics"
              title={t(language, 'settings.usageStats')}
              control={
                <ToggleSwitch
                  label={t(language, 'settings.usageStats')}
                  value={preferences.usageStatisticsEnabled}
                  onChange={(next) => onPreferencesChange({ usageStatisticsEnabled: next })}
                />
              }
            />
            {/* Taking back what the coach was allowed to keep (user,
                2026-09-10). Three lines, the same three the coach asked for,
                and switching one off does two things rather than one: it stops
                the next copy and deletes the ones already made. A withdrawal
                that only stopped the growth would leave the reader's own words
                on our server for two more years. */}
            {/* While copies are off (aiCoachLogId COACH_COPIES_KEPT) a line shows
                only for a reader who said yes before, so the yes can still be
                taken back and what was kept deleted. */}
            {onWithdrawCoachLog ? (
              <>
                {COACH_COPIES_KEPT || preferences.aiLogChatConsent ? (
                <Row
                  icon="chat"
                  title={t(language, 'settings.coachLog.chat')}
                  sub={t(language, 'settings.coachLog.sub')}
                  control={
                    <ToggleSwitch
                      label={t(language, 'settings.coachLog.chat')}
                      value={preferences.aiLogChatConsent}
                      onChange={(next) => void onWithdrawCoachLog('chat', next)}
                    />
                  }
                />
                ) : null}
                {COACH_COPIES_KEPT || preferences.aiLogComposerConsent ? (
                <Row
                  icon="doc"
                  title={t(language, 'settings.coachLog.composer')}
                  sub={COACH_COPIES_KEPT ? undefined : t(language, 'settings.coachLog.sub')}
                  control={
                    <ToggleSwitch
                      label={t(language, 'settings.coachLog.composer')}
                      value={preferences.aiLogComposerConsent}
                      onChange={(next) => void onWithdrawCoachLog('composer', next)}
                    />
                  }
                />
                ) : null}
                {COACH_COPIES_KEPT || preferences.aiLogPhotoConsent ? (
                <Row
                  icon="image"
                  title={t(language, 'settings.coachLog.photo')}
                  sub={COACH_COPIES_KEPT ? undefined : t(language, 'settings.coachLog.sub')}
                  control={
                    <ToggleSwitch
                      label={t(language, 'settings.coachLog.photo')}
                      value={preferences.aiLogPhotoConsent}
                      onChange={(next) => void onWithdrawCoachLog('photo', next)}
                    />
                  }
                />
                ) : null}
              </>
            ) : null}
            <Row
              icon="upload"
              title={t(language, 'settings.importCsv')}
              sub={t(language, 'settings.importCsv.sub')}
              chevron
              onPress={onImportPlan}
            />
            <Row
              icon="download"
              title={t(language, 'settings.exportCsv')}
              sub={t(language, 'settings.exportCsv.sub')}
              chevron
              last={!homeWidget}
              onPress={onExportPlan}
            />
            {/* Hidden entirely where pinning is unsupported. When the widget is
                already placed the row states that instead of offering again —
                Android will happily pin a second copy otherwise. */}
            {homeWidget ? (
              <Row
                icon="calendar"
                title={t(language, 'settings.widget')}
                sub={t(language, homeWidget.added ? 'settings.widget.added' : 'settings.widget.sub')}
                chevron={!homeWidget.added}
                last
                onPress={homeWidget.added ? undefined : homeWidget.onAdd}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.about')} />
          <View style={styles.card}>
            {/* The no-analytics fact moved into the privacy policy alone —
                a row restating one sentence of it was a sign explaining a
                sign (removed with the AI-info and support rows, 2026-08-22). */}
            {/* Rate Vinha left this card (design 2026-09-03) and Send feedback
                took its place. The star is not gone: it lives on the Profile,
                where the reader arrives having just seen what they have done.
                Asking for a review from a settings list is asking at the one
                moment nobody is pleased with anything. */}
            <Row
              icon="chat"
              title={t(language, 'settings.feedback')}
              sub={t(language, 'settings.feedback.sub')}
              chevron
              onPress={() => void Linking.openURL(buildFeedbackMailto(language, appInfo.version))}
            />
            <Row
              icon="shield"
              title={t(language, 'settings.privacy')}
              chevron
              onPress={() => onOpenLegal('privacy')}
            />
            <Row icon="doc" title={t(language, 'settings.terms')} chevron last onPress={() => onOpenLegal('terms')} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel label={t(language, 'settings.section.dangerZone')} />
          <View style={styles.card}>
            {/* Everything that removes or detaches lives here in red — the
                cloud copy, the account, the data (user, 2026-08-22). The
                sign-in offer itself stays up in YOUR DATA, because signing
                in is not a danger. */}
            {account && account.signedIn ? (
              <>
                <Row
                  icon="trash"
                  title={t(language, 'account.deleteRemote')}
                  sub={t(language, 'account.deleteRemote.sub')}
                  danger
                  disabled={account.busy}
                  onPress={account.onDeleteRemote}
                />
                <Row
                  icon="trash"
                  title={t(language, 'account.deleteAccount')}
                  sub={t(language, 'account.deleteAccount.sub')}
                  danger
                  disabled={account.busy}
                  onPress={account.onDeleteAccount}
                />
                <Row
                  icon="body"
                  title={t(language, 'account.signOut')}
                  danger
                  disabled={account.busy}
                  onPress={account.onSignOut}
                />
              </>
            ) : null}
            {/* Not while an account operation runs: Reset signs out and
                wipes, and a restore finishing after that wrote the backup
                onto the emptied phone. The hook also drops anything that
                sign-out overtakes; this keeps the two from meeting.
                Dimmed and saying why, not silently dead: the automatic
                backup runs on its own a few seconds after any change, and
                a red row that ignored the tap read as broken (PR #139
                review). Waiting after the confirm instead would be the
                same silence, only later. */}
            {onRestoreSetAsideWorkout ? (
              <Row
                icon="download"
                title={t(language, 'settings.restoreAside')}
                sub={t(language, 'settings.restoreAside.sub')}
                onPress={() => setRestoreAsideVisible(true)}
              />
            ) : null}
            <Row
              icon="trash"
              title={t(language, 'settings.resetData')}
              sub={t(language, account?.busy ? 'settings.resetData.busy' : 'settings.resetData.sub')}
              danger
              last
              disabled={account?.busy === true}
              onPress={() => {
                setResetCloudCopy(account?.signedIn ? account.cloudCopyState() : 'current');
                setResetVisible(true);
              }}
            />
          </View>
          {/* Under the red rows, in green: sign in when signed out, Back up
              now when signed in — the same place Sign out is found (user,
              2026-10-03). */}
          {account && (account.signedIn || account.providers.length > 0) ? (
            <View style={[styles.card, styles.cardFollow]}>
            {/* Sign in and the data survives a new phone. Hidden when the build
                has no sign-in configured; free and Pro alike (2026-08-22). */}
            {/* Apple's own button, as App Review wants it, above the Google row. */}
            {account && !account.signedIn && account.providers.includes('apple') ? (
              <View style={styles.appleSignIn}>
                <AppleSignInButton
                  variant="whiteOutline"
                  cornerRadius={12}
                  height={46}
                  disabled={account.busy}
                  onPress={() => account.onSignIn('apple')}
                />
                {account.providers.includes('google') ? null : (
                  <Text style={styles.appleSignInSub}>{t(language, 'account.signIn.sub')}</Text>
                )}
              </View>
            ) : null}
            {account && !account.signedIn && account.providers.includes('google') ? (
              <Row
                icon="shield"
                positive
                last
                title={t(language, 'account.signIn')}
                sub={t(language, 'account.signIn.sub')}
                chevron
                disabled={account.busy}
                onPress={() => account.onSignIn('google')}
              />
            ) : null}
            {account && account.signedIn ? (
              <Row
                icon="shield"
                positive
                last
                title={t(language, 'account.backupNow')}
                // Just the identity and, in green, when the cloud copy was
                // last written (user, 2026-08-22). Green only once a backup
                // exists — "never" is not a success state.
                subNode={
                  <>
                    <Text style={styles.rowSub}>
                      {account.email ? `${account.email} · ` : ''}
                      {account.lastBackupAt ? (
                        <Text style={styles.rowSubOk}>{backupTimeLabel(account.lastBackupAt, language)}</Text>
                      ) : (
                        t(language, 'account.noBackupYet')
                      )}
                    </Text>
                    {account.backupPaused ? (
                      <Text style={[styles.rowSub, styles.rowSubWarn]}>
                        {t(
                          language,
                          account.backupPaused === 'other_phone'
                            ? 'account.backupPaused.otherPhone'
                            : account.backupPaused === 'copy_deleted'
                              ? 'account.backupPaused.copyDeleted'
                              : 'account.backupPaused.smallerPhone',
                        )}
                      </Text>
                    ) : null}
                  </>
                }
                chevron
                disabled={account.busy}
                onPress={account.onBackupNow}
              />
            ) : null}
            </View>
          ) : null}
        </View>

        <Text style={styles.footer}>Vinha · v{appInfo.version} · {LEGAL_ENTITY.name}</Text>
      </ScrollView>

      <ConfirmDialog
        language={language}
        visible={resetVisible}
        title={t(language, 'settings.resetData')}
        message={t(language, resetDialogMessageKey(account?.signedIn === true, resetCloudCopy))}
        confirmLabel={t(language, 'settings.resetDialog.confirm')}
        cancelLabel={t(language, 'common.cancel')}
        destructive
        onCancel={() => setResetVisible(false)}
        onConfirm={() => {
          setResetVisible(false);
          void onResetAllData();
        }}
      />
      <ConfirmDialog
        language={language}
        visible={restoreAsideVisible}
        title={t(language, 'settings.restoreAside.dialog.title')}
        message={t(language, 'settings.restoreAside.dialog.message')}
        confirmLabel={t(language, 'settings.restoreAside.dialog.confirm')}
        cancelLabel={t(language, 'common.cancel')}
        onCancel={() => setRestoreAsideVisible(false)}
        onConfirm={() => {
          setRestoreAsideVisible(false);
          onRestoreSetAsideWorkout?.();
        }}
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  pressed: {
    opacity: 0.75,
  },
  body: {
    paddingTop: 4,
    paddingHorizontal: 18,
    paddingBottom: layout.bottomTabBarReserve,
  },
  appleSignIn: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 8,
  },
  appleSignInSub: {
    color: theme.muted,
    fontSize: 12.5,
    paddingBottom: 6,
  },
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    ...CARD_SHADOW,
  },
  cardFollow: {
    marginTop: 12,
  },
  demoCardGap: {
    marginTop: 10,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 14,
    marginTop: 4,
    ...CARD_SHADOW,
  },
  profileChipAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileChipInitials: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  profileChipCopy: {
    flex: 1,
    minWidth: 0,
  },
  profileChipName: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  // Accent-coded and in the header's corner now (user 2026-08-25).
  section: {
    marginTop: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  // Accent-tinted (user 2026-08-25: "tee ikoneista oransseja").
  rowTile: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: theme.highlightSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  rowSub: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 17,
  },
  rowSubOk: {
    color: theme.greenInk,
    fontWeight: '700',
  },
  rowSubWarn: {
    color: theme.amberInk,
    fontWeight: '700',
  },
  rowValue: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  seg: {
    flexDirection: 'row',
    // Was #EEE8FA — so close to the card that the control read as a ghost
    // (user, 2026-08-22). A firmer track makes the white active pill pop.
    // Dark takes theme fills: the fixed lavender and white put theme.muted
    // labels at 1.65:1 there (#bugs 2026-10-01 audit).
    backgroundColor: theme === darkTheme ? theme.surfaceSoft : '#D9CCF2',
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  segItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemActive: {
    backgroundColor: theme === darkTheme ? theme.purpleLight : '#FFFFFF',
    boxShadow: '0 1px 4px rgba(80, 40, 160, 0.14)',
  },
  segText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  segTextActive: {
    color: theme === darkTheme ? theme.ink : theme.purpleDark,
  },
  connectPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: theme.purpleLight,
  },
  connectPillText: {
    color: theme.purpleDark,
    fontSize: 13,
    fontWeight: '800',
  },
  footer: {
    color: theme.faint,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
  },
});
