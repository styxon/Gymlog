import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { I18nKey, t } from '../lib/i18n';
import type { ProgramSeason } from '../lib/programSeasons';
import {
  SEASON_BLOCK_WEEKS,
  SEASON_WEEKS,
  resolveSeasonWindow,
  seasonBlockIndex,
  seasonLastDay,
  seasonProgressRatio,
  seasonWeek,
  seasonWeeksLeft,
  nextSeasonWindow,
  SEASON_COLORS,
} from '../lib/season';
import {
  POINTS_PER_BLOCK,
  POINTS_PER_FULL_WEEK,
  POINTS_PER_RECORD,
  POINTS_PER_WORKOUT,
  SeasonBadge,
  SeasonProgress,
} from '../lib/seasonScoring';
import { Theme, useTheme, useThemedStyles } from '../theming';
import type { AppLanguage } from '../types/models';

/**
 * A season, as a screen.
 *
 * The design builds this on a leaderboard — 1 480 people, rank 412, "+38
 * places a week". None of that exists on a device that only knows its own
 * owner, and this app has already refused to ship invented social proof once.
 * So the series is the one section that waits for accounts, and it says so
 * rather than showing plausible names.
 *
 * Everything else on this screen is real today: the dates and the countdown
 * are the calendar, the points are the reader's own logged sessions against a
 * stated rule, the weekly requirement is their own program's days per week,
 * and every badge has a condition they can check.
 */

const BADGE_KEYS: Record<string, I18nKey> = {
  streak12: 'season.badge.streak12',
  finished: 'season.badge.finished',
  record: 'season.badge.record',
};

const BADGE_ICONS: Record<string, string> = {
  streak12: 'M5 19h14M6 15l5-5 3 3 5-6',
  finished: 'M12 3l2.3 4.7 5.2.8-3.8 3.7.9 5.1L12 15l-4.6 2.3.9-5.1L4.5 8.5l5.2-.8z',
  record: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
};

export interface SeasonProgramItem {
  id: string;
  name: string;
  blurb: string;
  days: number;
  fingerprint: number[];
}

interface SeasonScreenProps {
  season: ProgramSeason;
  language?: AppLanguage;
  progress: SeasonProgress;
  badges: SeasonBadge[];
  /** THE season program — one per season, see SEASON_PROGRAM_IDS. */
  seasonProgram: SeasonProgramItem;
  /** True when this is the program the reader is actually running. */
  running: boolean;
  onBack: () => void;
  onOpenProgram: (programId: string) => void;
  onStartToday: () => void;
  /** Makes the season programme the active plan — what "Start season" says. */
  onJoinSeason: () => void;
}

function formatDay(date: Date, language: AppLanguage): string {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return language === 'fi' ? `${day}.${month}.` : `${day}/${month}`;
}

/**
 * The season program's cover, in the season's own colours.
 *
 * It drew from the shared cover palette and came out blue on a green season —
 * this is not one of fifty-five catalog cards that needs to look distinct from
 * its neighbours, it is THE program of this season and there is nothing beside
 * it to be confused with.
 */
function ProgramMiniCover({ stops, fingerprint }: { stops: readonly [string, string]; fingerprint: number[] }) {
  const gid = `season-cov-${stops[0]}`.replace(/[^a-zA-Z0-9]/g, '');
  const size = 64;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0.2" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="1" stopColor={stops[1]} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} rx={13} fill={`url(#${gid})`} />
      {fingerprint.map((ratio, bar) => {
        const slot = (size - 14) / Math.max(1, fingerprint.length);
        const width = Math.max(2, slot - 2);
        const height = Math.max(4, ratio * 34);
        return (
          <Rect
            key={bar}
            x={7 + bar * slot}
            y={size - 8 - height}
            width={width}
            height={height}
            rx={1.5}
            fill="#FFFFFF"
            fillOpacity={0.85}
          />
        );
      })}
    </Svg>
  );
}

/**
 * The season, one bar per week.
 *
 * This replaced a plain progress bar, which drew the same shape for a reader
 * who trained every week and one who trained twice in five months — the only
 * thing it knew was the date. These bars are the points each week earned, so
 * the picture is the season as it actually went: gaps are missed weeks, a tall
 * bar is a week with a record in it, and how far the bars reach is still how
 * far into the season you are.
 *
 * Weeks not yet reached are drawn as baseline ticks rather than left blank, so
 * the strip reads as 26 weeks from day one instead of growing a container.
 */
function SeasonChart({
  weeks,
  currentWeek,
  ratio,
}: {
  weeks: SeasonProgress['weeks'];
  currentWeek: number;
  ratio: number;
}) {
  const styles = useThemedStyles(makeStyles);
  // Measured, not "100%": a percentage width made react-native-svg scale the
  // HEIGHT with it too, and the strip opened a 50px hole in the hero.
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.max(200, windowWidth - 40);
  const height = 40;
  const slot = width / SEASON_WEEKS;
  const barWidth = Math.max(3, slot - 2.5);

  const points = weeks.map(
    (entry) => entry.workouts * POINTS_PER_WORKOUT + (entry.complete ? POINTS_PER_FULL_WEEK : 0),
  );
  // Scaled to the best week so far, floored at one full week so a single
  // three-workout week does not draw as a full-height column.
  const peak = Math.max(POINTS_PER_WORKOUT * 3 + POINTS_PER_FULL_WEEK, ...points, 1);

  /**
   * Nothing logged yet: draw the shape, greyed out.
   *
   * With no points every bar was a 2px tick and the strip read as a broken
   * line above a lot of empty space. A uniform half-height row is obviously
   * not a measurement — no week differs from another — so it shows what the
   * chart WILL be without pretending to be it.
   */
  const empty = points.every((value) => value === 0);

  return (
    <View style={styles.chartWrap}>
      <Svg width={width} height={height}>
        {Array.from({ length: SEASON_WEEKS }, (_, index) => {
          const earned = points[index] ?? 0;
          const reached = index < currentWeek;
          const barHeight = empty
            ? height * 0.45
            : earned > 0
              ? Math.max(4, (earned / peak) * (height - 4))
              : 2;
          return (
            <Rect
              key={index}
              x={index * slot + (slot - barWidth) / 2}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1.5}
              fill="#FFFFFF"
              fillOpacity={empty ? 0.16 : earned > 0 ? 0.95 : reached ? 0.4 : 0.22}
            />
          );
        })}
      </Svg>
      {/* The date still has to be readable when nothing has been logged. */}
      <View style={styles.chartBaseline}>
        <View style={[styles.chartBaselineFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
    </View>
  );
}

export function SeasonScreen({
  season,
  language = 'en',
  progress,
  badges,
  seasonProgram,
  running,
  onBack,
  onOpenProgram,
  onStartToday,
  onJoinSeason,
}: SeasonScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();

  /**
   * The window of the season being LOOKED AT, not the one containing today.
   *
   * Resolving from today meant opening the upcoming winter season and reading
   * the summer season's dates, its week 19 of 26 and its seven weeks left —
   * every number on the screen belonged to a different season than its title.
   */
  const current = resolveSeasonWindow();
  const upcoming = current.season !== season;
  const window = upcoming ? nextSeasonWindow() : current;

  const week = upcoming ? 0 : Math.max(1, seasonWeek(window));
  const weeksLeft = upcoming ? SEASON_WEEKS : seasonWeeksLeft(window);
  const ratio = upcoming ? 0 : seasonProgressRatio(window);
  // A season that has not opened has no current block; the first one is what
  // it starts with, so nothing is highlighted as "now".
  const blockIndex = upcoming ? -1 : seasonBlockIndex(week);
  const gradient = SEASON_COLORS[season];
  const earned = badges.filter((badge) => badge.earned).length;
  const weekRatio =
    progress.thisWeekTarget > 0 ? Math.min(1, progress.thisWeekDone / progress.thisWeekTarget) : 0;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgLinearGradient id="seasonHero" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={gradient[0]} />
                <Stop offset="1" stopColor={gradient[1]} />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#seasonHero)" />
          </Svg>

          <View style={styles.heroTopRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'common.back')}
              onPress={onBack}
              hitSlop={10}
              style={styles.backButton}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M15 6l-6 6 6 6" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
            {/* The label belongs to the BUTTON, not the screen. It read
                "KESÄKAUSI 2026" next to a back arrow that goes to Programs,
                repeating the title directly below it and naming the wrong
                destination at the same time. */}
            <Text style={styles.heroKicker}>{t(language, 'tabs.programs').toUpperCase()}</Text>
          </View>

          <Text style={styles.heroTitle}>
            {t(language, season === 'winter' ? 'season.winter' : 'season.summer')}
          </Text>
          <Text style={styles.heroDates}>
            {t(language, 'season.range', {
              start: formatDay(window.start, language),
              // Through `seasonLastDay`, not a fixed day of milliseconds. The
              // winter season ends the day the clocks move, so subtracting
              // 86 400 000 from local midnight lands at 23:00 the day before
              // and the hero printed 30.3. where the same season's range on
              // the Programs tile — which already steps by calendar date —
              // printed 31.3. (audit 3, 2026-09-19).
              end: formatDay(seasonLastDay(window), language),
            })}
            {'  ·  '}
            {t(language, 'season.weeksUnit', { count: SEASON_WEEKS })}
          </Text>
          <Text style={styles.heroLead}>
            {t(language, season === 'winter' ? 'season.winterLead' : 'season.summerLead')}
          </Text>

          {/* The reader's own numbers. Points are workouts and full weeks
              against a stated rule, so the total is checkable by hand. */}
          <View style={styles.heroStats}>
            <View>
              <Text style={styles.heroBigNumber}>{progress.points}</Text>
              <Text style={styles.heroStatLabel}>{t(language, 'season.yourPoints')}</Text>
            </View>
            <View style={styles.heroStatSpacer} />
            <View>
              <Text style={styles.heroMidNumber}>{progress.workouts}</Text>
              <Text style={styles.heroStatLabel}>
                {t(language, 'season.workoutsLogged', { count: progress.workouts }).toUpperCase()}
              </Text>
            </View>
          </View>

          <SeasonChart
            weeks={progress.weeks}
            currentWeek={upcoming ? 0 : week}
            ratio={ratio}
          />
          <View style={styles.heroTrackRow}>
            <Text style={styles.heroTrackLabel}>
              {upcoming
                ? t(language, 'season.upcoming', { date: formatDay(window.start, language) })
                : t(language, 'season.week', { week, total: SEASON_WEEKS })}
            </Text>
            <Text style={styles.heroTrackLabel}>
              {t(language, weeksLeft === 1 ? 'season.weeksLeftOne' : 'season.weeksLeft', { count: weeksLeft })}
            </Text>
          </View>
        </View>

        {/* This week: the requirement, and what a full one is worth.
            Hidden before the season opens — "this week" is not a thing a
            season that starts in October has. */}
        {upcoming ? null : (
        <View style={styles.weekCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardEyebrow}>{t(language, 'season.thisWeek')}</Text>
            {progress.thisWeekTarget > 0 ? (
              <Text style={styles.weekCount}>
                {t(language, 'season.thisWeekDone', {
                  done: progress.thisWeekDone,
                  target: progress.thisWeekTarget,
                })}
              </Text>
            ) : null}
          </View>
          {progress.thisWeekTarget > 0 ? (
            <>
              <Text style={styles.weekGoal}>
                {t(language, 'season.thisWeekGoal', { count: progress.thisWeekTarget })}
              </Text>
              <View style={styles.weekTrack}>
                <View style={[styles.weekTrackFill, { width: `${Math.round(weekRatio * 100)}%` }]} />
              </View>
              <Text style={styles.weekNote}>
                {t(language, 'season.thisWeekBonus', { count: POINTS_PER_FULL_WEEK })}
              </Text>
            </>
          ) : (
            <Text style={styles.weekGoal}>{t(language, 'season.noTarget')}</Text>
          )}
        </View>
        )}

        {/* THE season program. One, not ten.
            Ten season programs meant ten different day counts and therefore
            ten different point ceilings — the ranking would have sorted people
            by how many days their program prescribes. One shared program is
            what makes "week 9" a sentence two people can say to each other. */}
        <Text style={styles.sectionEyebrow}>{t(language, 'season.theProgram')}</Text>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={seasonProgram.name}
            onPress={() => onOpenProgram(seasonProgram.id)}
            style={({ pressed }) => [styles.programHeadRow, pressed && styles.pressedRow]}
          >
            <ProgramMiniCover stops={gradient} fingerprint={seasonProgram.fingerprint} />
            <View style={styles.programCopy}>
              {/* The programme's own name, the one its page wears. It led with
                  a season name ("Talvikunto") that the Programs list then put
                  on every programme tagged for the season (user 2026-09-21). */}
              <Text style={styles.programName} numberOfLines={1}>
                {seasonProgram.name}
              </Text>
              <Text style={styles.programMeta}>
                {t(language, 'programs.card.days', { count: seasonProgram.days })}
                {'  ·  '}
                {t(language, 'season.weeksUnit', { count: SEASON_WEEKS })}
              </Text>
              {running ? (
                <View style={[styles.runningPill, { backgroundColor: gradient[0] }]}>
                  <Text style={styles.runningPillText}>{t(language, 'season.running')}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
          <View style={styles.blockRow}>
            {SEASON_BLOCK_WEEKS.map((range, index) => (
              <View
                key={range[0]}
                style={[styles.block, index === blockIndex && { backgroundColor: gradient[1] }]}
              >
                <Text style={[styles.blockText, index === blockIndex && styles.blockTextOn]}>
                  {t(language, 'season.blockWeeks', {
                    from: SEASON_BLOCK_WEEKS[index][0],
                    to: SEASON_BLOCK_WEEKS[index][1],
                  })}
                </Text>
              </View>
            ))}
          </View>
          {/* The action lives with the program instead of in a bar pinned
              over the tab pill. Two stacked bars took a fifth of the screen
              on a page nobody has to act on right now. */}
          {/* Two jobs, no warning needed. Already in the season: start today.
              Not in it: join — which ADDS the season programme alongside
              whatever the reader is already running rather than evicting it,
              so there is nothing to confirm away. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, running ? 'home.startWorkout' : 'season.join')}
            onPress={running ? onStartToday : onJoinSeason}
            style={({ pressed }) => [styles.cta, { backgroundColor: gradient[0] }, pressed && styles.pressed]}
          >
            <Text style={styles.ctaText}>
              {t(language, running ? 'home.startWorkout' : 'season.join')}
            </Text>
          </Pressable>
        </View>
        {/* "Et ole vielä kaudessa" used to sit here, under a button that
            says "Aloita kausi". */}
        {running ? <Text style={styles.oneProgramNote}>{t(language, 'season.oneProgram')}</Text> : null}

        {/* Badges. Each condition is the reader's own log. */}
        <Text style={styles.sectionEyebrow}>
          {t(language, 'season.badges', { earned, total: badges.length })}
        </Text>
        <View style={styles.badgeRow}>
          {badges.map((badge) => (
            <View key={badge.key} style={[styles.badge, !badge.earned && styles.badgeLocked]}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d={BADGE_ICONS[badge.key]}
                  stroke={badge.earned ? gradient[0] : theme.faint}
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={[styles.badgeText, badge.earned && { color: gradient[1] }]}>
                {t(language, BADGE_KEYS[badge.key])}
              </Text>
            </View>
          ))}
        </View>

        {/* The series. The one section that needs other people, and the only
            one on this screen that cannot be true yet. */}
        <Text style={styles.sectionEyebrow}>{t(language, 'season.series')}</Text>
        <View style={styles.lockedCard}>
          <View style={styles.lockedRow}>
            <View style={[styles.avatar, { backgroundColor: theme.purpleFill }]}>
              <Text style={styles.avatarText}>{t(language, 'season.you').slice(0, 2).toUpperCase()}</Text>
            </View>
            <Text style={styles.lockedName}>{t(language, 'season.you')}</Text>
            <Text style={styles.lockedPoints}>{t(language, 'season.points', { count: progress.points })}</Text>
          </View>
          <Text style={styles.lockedNote}>{t(language, 'season.seriesLocked')}</Text>
        </View>

        {/* How it works — the scoring rule, stated where the number is. */}
        <Text style={styles.sectionEyebrow}>{t(language, 'season.how')}</Text>
        <View style={styles.card}>
          {(['season.how.1', 'season.how.2', 'season.how.records', 'season.how.3'] as I18nKey[]).map((key, index) => (
            <View key={key} style={styles.howRow}>
              <Text style={[styles.howIndex, { color: gradient[0] }]}>{index + 1}</Text>
              <Text style={styles.howText}>
                {t(language, key, {
                  perWorkout: POINTS_PER_WORKOUT,
                  perWeek: POINTS_PER_FULL_WEEK,
                  perRecord: POINTS_PER_RECORD,
                  perBlock: POINTS_PER_BLOCK,
                })}
              </Text>
            </View>
          ))}
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
  content: {
    paddingBottom: 120,
  },
  pressed: {
    opacity: 0.85,
  },
  pressedRow: {
    opacity: 0.7,
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    lineHeight: 37,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 18,
  },
  heroDates: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 6,
  },
  heroLead: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginTop: 10,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 20,
  },
  heroStatSpacer: {
    width: 24,
  },
  heroBigNumber: {
    color: '#FFFFFF',
    fontSize: 44,
    lineHeight: 46,
    fontWeight: '800',
    letterSpacing: -1.6,
  },
  heroMidNumber: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  chartWrap: {
    marginTop: 10,
  },
  chartBaseline: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.24)',
    marginTop: 5,
    overflow: 'hidden',
  },
  chartBaselineFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  heroTrackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  heroTrackLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  sectionEyebrow: {
    color: theme.faint,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginTop: 24,
    marginBottom: 10,
    paddingHorizontal: 22,
  },
  card: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 14,
  },
  cardEyebrow: {
    color: theme.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 14,
  },
  weekCount: {
    color: theme.muted,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  weekGoal: {
    color: theme.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 7,
  },
  weekTrack: {
    height: 8,
    borderRadius: 5,
    backgroundColor: theme.bg,
    marginTop: 11,
    overflow: 'hidden',
  },
  weekTrackFill: {
    height: 8,
    borderRadius: 5,
    backgroundColor: theme.purple,
  },
  weekNote: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 9,
  },
  howRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  howIndex: {
    width: 16,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  howText: {
    flex: 1,
    color: theme.ink,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  programName: {
    color: theme.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  programMeta: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },
  blockRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 11,
  },
  block: {
    flex: 1,
    borderRadius: 7,
    backgroundColor: theme.bg,
    paddingVertical: 6,
    alignItems: 'center',
  },
  blockText: {
    color: theme.faint,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  blockTextOn: {
    color: '#FFFFFF',
  },
  lockedCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 14,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
  },
  lockedName: {
    flex: 1,
    color: theme.ink,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '800',
  },
  lockedPoints: {
    color: theme.ink,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '800',
  },
  lockedNote: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 10,
  },
  programHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  runningPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  runningPillText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  programCopy: {
    flex: 1,
    minWidth: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  badge: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  badgeLocked: {
    opacity: 0.45,
  },
  badgeText: {
    color: theme.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
    marginTop: 5,
  },
  oneProgramNote: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 10,
    paddingHorizontal: 22,
  },
  cta: {
    height: 48,
    marginTop: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    lineHeight: 20,
    fontWeight: '800',
  },
});
