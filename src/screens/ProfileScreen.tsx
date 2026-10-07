import React, { useMemo } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { AnimatedGreeting } from '../components/AnimatedGreeting';
import { CutSurface } from '../components/CutSurface';
import { CARD_SHADOW, SectionLabel, makeSettingsStyles } from '../components/SettingsUi';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { formatLiftDisplayLabel } from '../lib/displayLabel';
import { formatCompactVolume, formatWeight } from '../lib/format';
import { LifetimeTrainingSummary } from '../lib/lifetimeSummary';
import { MilestoneLedger } from '../lib/milestoneFacts';
import { milestoneCardFooter, milestoneCardRows } from '../lib/profileMilestoneRows';
import { t } from '../lib/i18n';
import { inviteMessage, storeListingUrl, storePlatformOf } from '../lib/storeLinks';
import {
  formatRecordWhenLabel,
} from '../lib/profileOverview';
import { ExerciseProgressSummary } from '../lib/progression';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { layout } from '../theme';
import { AppPreferences, ExerciseLibraryItem, UnitPreference } from '../types/models';


interface ProfileScreenProps {
  preferences: AppPreferences;
  lifetime: LifetimeTrainingSummary;
  trackedProgress: ExerciseProgressSummary[];
  exerciseLibrary: ExerciseLibraryItem[];
  unitPreference: UnitPreference;
  onOpenSettings: () => void;
  /** Opens the Records tab on Progress, where the full list lives. */
  onOpenRecords: () => void;
  /** Lifts holding a record — the count the Records tab itself shows. */
  recordCount: number;
  /**
   * The whole ladder. The card shows its front row; the page it opens shows
   * the rest. One reading of the log, so the two cannot disagree.
   */
  milestoneLedger: MilestoneLedger;
  onOpenMilestones?: () => void;
  /**
   * Opens the profile editor. The ready-programme path through onboarding
   * never asks for a name, so this screen is where an unnamed reader is
   * offered one — see the prompt under the identity name.
   */
  onEditProfile: () => void;
  /**
   * Opens the same rating sheet Settings and the finish flow use. The star
   * row renders only while the app is unrated, and disappears for good after
   * — same rule as everywhere else the ask lives.
   */
  onOpenRating?: () => void;
}

function getInitials(name: string | null | undefined) {
  if (!name) {
    return 'V';
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'V';
  }
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (first + second).toUpperCase();
}

function GearIcon() {
  const theme = useTheme();

  /**
   * A toothed cog, not the prototype's ray-style one.
   *
   * The rays version was a circle with eight spokes around it — the same
   * construction as this app's own sun glyph (`IC_PATHS.sun` in Settings,
   * which means light theme). At 21px the two are indistinguishable, so the
   * one route into Settings read as a theme switch. Teeth cannot be mistaken
   * for rays.
   */
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3.2} stroke={theme.ink} strokeWidth={2} />
      <Path
        d="M19.1 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.13 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.03z"
        stroke={theme.ink}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function GiftIcon() {
  const theme = useTheme();

  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 12v8h16v-8M2 7h20v5H2V7zM12 7v13M12 7c-1.5 0-4.5-.6-4.5-2.7C7.5 2.6 9 2 10 2c1.8 0 2 2.6 2 5zM12 7c1.5 0 4.5-.6 4.5-2.7C16.5 2.6 15 2 14 2c-1.8 0-2 2.6-2 5z"
        stroke={theme.ink}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronIcon() {
  const theme = useTheme();

  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={theme.faint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function TrophyIcon() {
  const theme = useTheme();

  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 15h6M8 20h8M12 15v5"
        stroke={theme.purpleDark}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Avatar({ initials }: { initials: string }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.avatarWrap}>
      <Svg width={82} height={82} viewBox="0 0 82 82">
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7C3AED" />
            <Stop offset="1" stopColor="#C4B0FF" />
          </LinearGradient>
          <LinearGradient id="inner" x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor="#2A1B4E" />
            <Stop offset="1" stopColor="#5B21B6" />
          </LinearGradient>
        </Defs>
        <Circle cx={41} cy={41} r={41} fill="url(#ring)" />
        <Circle cx={41} cy={41} r={38} fill="url(#inner)" />
      </Svg>
      <View style={styles.avatarTextWrap} pointerEvents="none">
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
    </View>
  );
}


export function ProfileScreen({
  preferences,
  lifetime,
  trackedProgress,
  exerciseLibrary,
  unitPreference,
  onOpenSettings,
  onOpenRecords,
  recordCount,
  milestoneLedger,
  onOpenMilestones,
  onEditProfile,
  onOpenRating,
}: ProfileScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const settingsStyles = useThemedStyles(makeSettingsStyles);
  const identityName = preferences.profileName?.trim() ? preferences.profileName.trim() : null;
  const language = preferences.appLanguage;

  const bodyPartByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of exerciseLibrary) {
      map.set(item.name.trim().toLowerCase(), item.bodyPart);
    }
    return map;
  }, [exerciseLibrary]);

  // The same number the Records tab shows, passed in rather than counted
  // again here. Two definitions of "a record" put "0 ennätystä" on this screen
  // next to a link to a list holding two of them.

  const identityStats = [
    {
      key: 'sessions',
      value: `${lifetime.sessionCount}`,
      label: t(language, lifetime.sessionCount === 1 ? 'profile.stat.session' : 'profile.stat.sessions'),
    },
    {
      key: 'weeks',
      value: `${lifetime.weeksActive}`,
      label: t(language, lifetime.weeksActive === 1 ? 'profile.stat.week' : 'profile.stat.weeks'),
    },
    { key: 'prs', value: `${recordCount}`, label: t(language, recordCount === 1 ? 'profile.stat.pr' : 'profile.stat.prs') },
  ];

  const milestoneRows = useMemo(
    () => milestoneCardRows({ ledger: milestoneLedger, lifetime, unitPreference, language }),
    [language, lifetime, milestoneLedger, unitPreference],
  );

  const lifetimeStats = [
    {
      label: t(language, 'profile.lifetime.sessions'),
      value: `${lifetime.sessionCount}`,
      meta: t(language, 'profile.lifetime.sessionsMeta'),
    },
    {
      label: t(language, 'profile.lifetime.weeksActive'),
      value: `${lifetime.weeksActive}`,
      meta: t(language, 'profile.lifetime.weeksActiveMeta', { total: lifetime.weeksSinceStart }),
    },
    {
      label: t(language, 'profile.lifetime.totalVolume'),
      value: formatCompactVolume(lifetime.totalVolumeKg, unitPreference),
      meta: t(language, 'profile.lifetime.totalVolumeMeta'),
    },
    {
      label: t(language, 'profile.lifetime.bestRhythm'),
      value: t(language, 'profile.lifetime.bestRhythmValue', { count: lifetime.bestWeekStreak }),
      meta: t(language, 'profile.lifetime.bestRhythmMeta'),
    },
  ];


  const handleInvite = async () => {
    // OS share sheet only — the user picks the target and can edit the text.
    // The link is the store page for the phone's own store (lib/storeLinks);
    // an iPhone build without EXPO_PUBLIC_APP_STORE_URL shares the text alone.
    try {
      await Share.share({
        message: inviteMessage(
          t(language, 'profile.inviteMessage'),
          storeListingUrl(storePlatformOf(Platform.OS), process.env.EXPO_PUBLIC_APP_STORE_URL),
        ),
      });
    } catch {
      // Sharing is optional; a dismissed or failed sheet is not an error worth
      // interrupting the user for.
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>{t(language, 'profile.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(language, 'profile.a11y.settings')}
          onPress={onOpenSettings}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <CutSurface
            size="md"
            fill={theme.surface}
            stroke={theme.border}
            strokeWidth={1}
            style={styles.gearButton}
          >
            <GearIcon />
          </CutSurface>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* IDENTITY */}
        <View style={styles.identityRow}>
          <Avatar initials={getInitials(identityName)} />
          <View style={styles.identityStats}>
            {identityStats.map((stat) => (
              <View key={stat.key} style={styles.identityStat}>
                <Text style={styles.identityStatValue}>{stat.value}</Text>
                <Text style={styles.identityStatLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>
        {/* The name is a door, not a label. Onboarding's ready-programme path
            never asks for one on purpose (the reader had just declined the
            questionnaire), so an unnamed profile said "Vieras" and offered
            nothing to do about it. The prompt appears only while the name is
            missing; once it is set, tapping still opens the editor. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            identityName
              ? t(language, 'profile.editNameA11y', { name: identityName })
              : t(language, 'profile.addName')
          }
          onPress={onEditProfile}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <AnimatedGreeting
            text={identityName ?? t(language, 'profile.guestName')}
            style={styles.identityName}
            accentColor={theme.purple}
          />
          {identityName ? null : (
            <Text style={styles.identityPrompt}>{t(language, 'profile.addName')} →</Text>
          )}
        </Pressable>

        {/* INVITE */}
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleInvite()}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <CutSurface
            size="lg"
            fill={theme.surface}
            stroke={theme.border}
            strokeWidth={1}
            style={styles.inviteButton}
          >
            <GiftIcon />
            <Text style={styles.inviteButtonText}>{t(language, 'profile.invite')}</Text>
          </CutSurface>
        </Pressable>

        {/* Rate the app — five stars as the invitation (user 2026-08-25).
            One button, one destination: the whole row opens the same rating
            sheet Settings uses. The stars are not individually pressable on
            purpose — routing by star value is the pre-filtering Play's
            policy forbids. Gone for good once rated, like every other ask. */}
        {onOpenRating && !preferences.ratingPrompt.rated ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'settings.rate')}
            onPress={onOpenRating}
            style={({ pressed }) => [pressed && styles.pressedRow]}
          >
            <CutSurface
              size="lg"
              fill={theme.surface}
              stroke={theme.border}
              strokeWidth={1}
              style={styles.rateCard}
            >
              <Text style={styles.rateTitle}>{t(language, 'settings.rate')}</Text>
              <View style={styles.rateStars}>
                {[0, 1, 2, 3, 4].map((star) => (
                  <Svg key={star} width={22} height={22} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9L12 3.5z"
                      stroke={theme.gold}
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                    />
                  </Svg>
                ))}
              </View>
            </CutSurface>
          </Pressable>
        ) : null}

        {/* NEXT MILESTONE — the reward surface. It replaced the plan card
            (user 2026-09-02): programme management lives on the Programs tab,
            and the Profile is for what the reader has done. The rows are
            distances, never promises. */}
        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'profile.section.nextMilestone')} />
          {/* The footer is the door to the milestones page: every reached
              rung with its day, and every family's next one. Only the footer
              presses — a Pressable around the whole card would fold the three
              rows into one node for a screen reader. */}
          <CutSurface size="lg" fill={theme.surface} stroke={theme.border} strokeWidth={1} style={styles.milestoneCard}>
            {milestoneRows.map((row, index) => (
              <View key={row.key} style={[styles.milestoneRow, index > 0 && styles.milestoneRowDivider]}>
                <View style={styles.milestoneHead}>
                  <Text style={styles.milestoneTitle}>{row.title}</Text>
                  {row.remainder ? <Text style={styles.milestoneRemainder}>{row.remainder}</Text> : null}
                </View>
                <View style={styles.milestoneTrack}>
                  <View
                    style={[
                      styles.milestoneFill,
                      {
                        width: `${row.fillPercent}%`,
                        backgroundColor: index === 0 ? theme.highlight : theme.purpleBright,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.milestoneMeta}>{row.meta}</Text>
              </View>
            ))}
            {onOpenMilestones ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'milestones.title')}
                onPress={onOpenMilestones}
                style={({ pressed }) => [styles.milestoneRowDivider, styles.milestoneFooter, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.milestoneFooterText}>{milestoneCardFooter(milestoneLedger.reachedCount, language)}</Text>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 5l7 7-7 7" stroke={theme.highlight} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            ) : null}
          </CutSurface>
        </View>

        {/* PERSONAL RECORDS — one number and a way in.

            The full list lives on Progress, where it has three kinds, month
            groups and a Pro window. A second, thinner copy here added no
            information and could disagree with it — and did: this screen read
            "0 records" while Progress listed two. */}
        <View style={settingsStyles.section}>
          <Pressable
            accessibilityRole="button"
            onPress={onOpenRecords}
            style={({ pressed }) => [pressed && styles.pressedRow]}
          >
            <CutSurface
              size="lg"
              fill={theme.surface}
              stroke={theme.border}
              strokeWidth={1}
              speedLine={{ color: theme.purpleBright }}
              style={styles.recordsLinkCard}
            >
            <View style={styles.recordTile}>
              <TrophyIcon />
            </View>
            <View style={styles.recordCopy}>
              <Text style={styles.recordsLinkValue}>
                {recordCount === 1
                  ? t(language, 'profile.records.countOne')
                  : t(language, 'profile.records.count', { count: recordCount })}
              </Text>
              <Text style={styles.recordBodyPart}>{t(language, 'profile.records.link')}</Text>
            </View>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path
                d="M9 6l6 6-6 6"
                stroke={theme.faint}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            </CutSurface>
          </Pressable>
        </View>

        {/* LIFETIME */}
        <View style={settingsStyles.section}>
          <SectionLabel label={t(language, 'profile.section.lifetime')} />
          <View style={styles.statGrid}>
            {lifetimeStats.map((stat) => (
              <View key={stat.label} style={styles.statCard}>
                <Text style={styles.statLabel}>{stat.label.toUpperCase()}</Text>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statMeta}>{stat.meta}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 14,
  },
  topTitle: {
    color: theme.ink,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  gearButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: layout.bottomTabBarReserve,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  avatarWrap: {
    width: 82,
    height: 82,
  },
  avatarTextWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  identityStats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  identityStat: {
    alignItems: 'center',
  },
  identityStatValue: {
    color: theme.ink,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  identityStatLabel: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  // The screen's anchor. Every tab carries one oversized element (Home's
  // 38 pt session hero, Progress's 46 pt month figure); this is Profile's —
  // same scale as Home's hero so the tabs read as one family.
  identityName: {
    color: theme.ink,
    fontSize: 38,
    lineHeight: 43,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 14,
  },
  identityPrompt: {
    color: theme.highlight,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  inviteButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  inviteButtonText: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  rateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 10,
  },
  rateTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  rateStars: {
    flexDirection: 'row',
    gap: 4,
  },
  // The inactive fill was hardcoded pale, so under the dark theme the rest
  // days lit up white while the training days (theme.purpleLight, a dark tint)
  // went quiet — the card read backwards.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.highlightSoft,
  },
  milestoneCard: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  milestoneRow: {
    paddingVertical: 12,
    gap: 7,
  },
  milestoneRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  milestoneHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  milestoneTitle: {
    flex: 1,
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '700',
  },
  milestoneRemainder: {
    color: theme.highlight,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  milestoneTrack: {
    height: 7,
    borderRadius: 99,
    backgroundColor: theme.surfaceSoft,
    overflow: 'hidden',
  },
  milestoneFill: {
    height: 7,
    borderRadius: 99,
  },
  milestoneMeta: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '500',
  },
  milestoneFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  milestoneFooterText: {
    color: theme.highlight,
    fontSize: 12.5,
    fontWeight: '700',
  },
  recordsLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 14,
    paddingLeft: 26,
    paddingVertical: 13,
  },
  recordsLinkValue: {
    color: theme.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  pressedRow: {
    opacity: 0.85,
  },
  recordTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCopy: {
    flex: 1,
    minWidth: 0,
  },
  recordBodyPart: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    padding: 14,
    ...CARD_SHADOW,
  },
  statLabel: {
    color: theme.faint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.44,
  },
  // The numbers wear the accent ("Numerot oranssilla?" — user 2026-08-25):
  // orange in dark, violet in light, same token as every other emphasis.
  statValue: {
    color: theme.highlight,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 5,
  },
  statMeta: {
    color: theme.muted,
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
});
