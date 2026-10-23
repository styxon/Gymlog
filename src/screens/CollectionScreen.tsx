import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { ExerciseCollection, resolveCollectionProgress } from '../lib/exerciseCollections';
import { exerciseNameLabel } from '../lib/exerciseNameLabel';
import { t } from '../lib/i18n';
import { layout } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * One course: a handful of lifts, in the order they are easiest to learn.
 *
 * NOTHING IS LOCKED, and that is the design's own line: teaching that withholds
 * the next lesson until you tick the last one is a game, not a library. Every
 * row opens whatever state it is in. The numbers and the NEXT badge are a
 * recommendation about where to start, not a gate.
 *
 * What finishing means is said honestly at the bottom — no badge, no unlock.
 * A course that promised a reward would be measuring the reader instead of
 * teaching them.
 */

function ChevronLeftIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronRightIcon({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function TickIcon({ color }: { color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      <Path d="M4.5 12.5l5 5L19.5 7" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

interface CollectionScreenProps {
  collection: ExerciseCollection;
  language?: AppLanguage;
  /** Names of the lifts in this course the reader has marked as learned. */
  learnedExerciseNames?: string[];
  onBack: () => void;
  onOpenExercise?: (exerciseName: string) => void;
}

export function CollectionScreen({
  collection,
  language = 'en',
  learnedExerciseNames = [],
  onBack,
  onOpenExercise,
}: CollectionScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const learned = new Set(learnedExerciseNames);
  const progress = resolveCollectionProgress(collection, (name) => learned.has(name));

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.cover}>
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="collectionCover" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={collection.cover[0]} />
                <Stop offset="1" stopColor={collection.cover[1]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#collectionCover)" />
          </Svg>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'common.back')}
            onPress={onBack}
            hitSlop={8}
            style={styles.coverBack}
          >
            <ChevronLeftIcon color="#FFFFFF" />
          </Pressable>
          <View style={styles.coverText}>
            <Text style={styles.coverEyebrow}>{t(language, 'learn.eyebrow')}</Text>
            <Text style={styles.coverTitle}>{collection.title}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.intro}>{collection.intro}</Text>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              {collection.entries.map((entry) => (
                <View
                  key={entry.exerciseName}
                  style={[styles.progressSegment, learned.has(entry.exerciseName) && styles.progressSegmentDone]}
                />
              ))}
            </View>
            <Text style={styles.progressLabel}>
              {t(language, 'learn.progress', { done: progress.done, total: progress.total })}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>{t(language, 'learn.theOrder')}</Text>
          <View style={styles.rows}>
            {collection.entries.map((entry, index) => {
              const isLearned = learned.has(entry.exerciseName);
              const isNext = progress.nextExerciseName === entry.exerciseName;
              return (
                <Pressable
                  key={entry.exerciseName}
                  accessibilityRole="button"
                  disabled={!onOpenExercise}
                  onPress={() => onOpenExercise?.(entry.exerciseName)}
                  style={({ pressed }) => [styles.row, isNext && styles.rowNext, pressed && styles.rowPressed]}
                >
                  <View
                    style={[
                      styles.marker,
                      isLearned && { backgroundColor: theme.green, borderColor: theme.green },
                      isNext && !isLearned && { borderColor: theme.highlight },
                    ]}
                  >
                    {isLearned ? (
                      <TickIcon color={theme.onHighlight} />
                    ) : (
                      <Text style={[styles.markerText, isNext && { color: theme.highlight }]}>{index + 1}</Text>
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.rowTitleLine}>
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {exerciseNameLabel(language, entry.exerciseName)}
                      </Text>
                      {isNext ? (
                        <View style={styles.nextBadge}>
                          <Text style={styles.nextBadgeText}>{t(language, 'learn.next')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.rowPattern}>
                      {entry.pattern}
                    </Text>
                  </View>
                  <ChevronRightIcon color={theme.faint} />
                </Pressable>
              );
            })}
          </View>

          {/* What finishing means, said honestly — and once. The line under
              the title spent half its length on what does NOT happen ("no
              badge, no unlock") and the other half restating the title (user
              2026-09-07). The eyebrow says when, the title says what. */}
          <Text style={styles.sectionLabel}>{t(language, 'learn.whenAllTicked')}</Text>
          <View style={styles.outcomeCard}>
            <Text style={styles.outcomeTitle}>{t(language, 'learn.outcomeTitle')}</Text>
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
  scroll: {
    flex: 1,
  },
  content: {
    // The floating tab bar is shown on this screen, so the last row has to
    // clear it — seen on device, where "Farmer's Walk" sat behind the bar.
    paddingBottom: layout.bottomTabBarReserve,
  },
  cover: {
    height: 168,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  // The shared BackButton's shape (40, round) and chevron, but a scrim and a
  // white chevron: it sits on the collection's own gradient, where the
  // button's light fill would be a white disc on a painted cover.
  coverBack: {
    position: 'absolute',
    top: 46,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(10, 7, 20, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverText: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  coverEyebrow: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  coverTitle: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 5,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  intro: {
    color: theme.muted,
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  progressTrack: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
  },
  progressSegmentDone: {
    backgroundColor: theme.purpleDark,
  },
  progressLabel: {
    color: theme.purpleBright,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    color: theme.faint,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 24,
    marginBottom: 11,
  },
  rows: {
    gap: 9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowNext: {
    backgroundColor: theme.surfaceSoft,
    borderColor: theme.highlight,
  },
  rowPressed: {
    opacity: 0.85,
  },
  marker: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  markerText: {
    color: theme.faint,
    fontSize: 12,
    fontWeight: '800',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  rowTitle: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  nextBadge: {
    backgroundColor: theme.highlight,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  nextBadgeText: {
    color: theme.onHighlight,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  rowPattern: {
    color: theme.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  outcomeCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 4,
  },
  outcomeTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
});
