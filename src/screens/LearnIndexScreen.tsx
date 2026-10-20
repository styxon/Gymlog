import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/AppText';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { BackButton } from '../components/BackButton';

import { ExerciseCollection, resolveCollectionProgress } from '../lib/exerciseCollections';
import { t } from '../lib/i18n';
import { layout } from '../theme';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The short courses, listed.
 *
 * There is one today, and the note at the bottom says why rather than padding
 * the page: a course with no written lessons in it is just a title, and the
 * teaching layer covers three lifts so far. A shelf of empty covers would make
 * the app look bigger and be worth less.
 */

function ChevronLeftIcon({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

interface LearnIndexScreenProps {
  collections: ExerciseCollection[];
  language?: AppLanguage;
  learnedExerciseNames?: string[];
  onBack: () => void;
  onOpenCollection?: (collectionId: string) => void;
}

export function LearnIndexScreen({
  collections,
  language = 'en',
  learnedExerciseNames = [],
  onBack,
  onOpenCollection,
}: LearnIndexScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const learned = new Set(learnedExerciseNames);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <BackButton onPress={onBack} accessibilityLabel={t(language, 'common.back')} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{t(language, 'learn.title')}</Text>
          <Text style={styles.subtitle}>{t(language, 'learn.subtitle')}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 11 }}>
          {collections.map((collection) => {
            const progress = resolveCollectionProgress(collection, (name) => learned.has(name));
            const started = progress.done > 0 && progress.done < progress.total;
            return (
              <Pressable
                key={collection.id}
                accessibilityRole="button"
                disabled={!onOpenCollection}
                onPress={() => onOpenCollection?.(collection.id)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cover}>
                  <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id={`cover-${collection.id}`} x1="0" y1="0" x2="1" y2="1">
                        <Stop offset="0" stopColor={collection.cover[0]} />
                        <Stop offset="1" stopColor={collection.cover[1]} />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="100%" height="100%" fill={`url(#cover-${collection.id})`} />
                  </Svg>
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleLine}>
                    <Text numberOfLines={1} style={styles.cardTitle}>
                      {collection.title}
                    </Text>
                    {started ? (
                      <View style={styles.startedBadge}>
                        <Text style={styles.startedBadgeText}>{t(language, 'learn.inProgress')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={styles.cardBlurb}>
                    {collection.blurb}
                  </Text>
                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${progress.percent}%` },
                        ]}
                      />
                    </View>
                    <Text style={[styles.progressLabel, progress.done > 0 && styles.progressLabelOn]}>
                      {progress.done} / {progress.total}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>{t(language, 'learn.moreLater')}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    color: theme.ink,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    // Same floating bar as the collection screen below it.
    paddingBottom: layout.bottomTabBarReserve,
  },
  card: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 15,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cover: {
    width: 62,
    height: 62,
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  cardTitle: {
    flexShrink: 1,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  startedBadge: {
    backgroundColor: theme.purpleLight,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  startedBadgeText: {
    color: theme.purpleBright,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  cardBlurb: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 3,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 9,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.surfaceSoft,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.purpleDark,
    borderRadius: 999,
  },
  progressLabel: {
    color: theme.faint,
    fontSize: 10.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  progressLabelOn: {
    color: theme.purpleBright,
  },
  footnote: {
    color: theme.faint,
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '600',
    marginTop: 18,
  },
});
