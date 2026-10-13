import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';

import {
  formatHomeStatRecency,
  formatHomeStatTrend,
  formatHomeStatValue,
  groupHomeStatCards,
  HomeStatCard,
  HomeStatCardIcon,
} from '../lib/homeStatCards';
import { KitBar, KitGroupLabel, KitRow, KitSheet } from './sheetKit';
import { I18nKey, t } from '../lib/i18n';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * "Your cards" — pinned stat cards on Home. The user picks which stats appear;
 * nothing here is mandatory. A card shows the current and previous result with
 * no good/bad judgement — tapping it opens the matching tracking surface where
 * a new entry can be logged. Edit mode shows remove badges with a light jiggle.
 */

const RED = '#C0392B';

const SPARK_HEIGHT = 34;

interface HomeStatCardsSectionProps {
  /** Safe-area inset, read on the SCREEN — a Modal measures it as zero. */
  bottomInset?: number;
  /** One computed card per catalog item, in Add-sheet display order. */
  catalogCards: HomeStatCard[];
  /**
   * Card keys worth offering, from what onboarding was told. Empty when there
   * is nothing to offer — the row disappears rather than nagging.
   */
  suggestedKeys?: string[];
  onDismissSuggestion?: (key: string) => void;
  pinnedKeys: string[];
  onChangePinnedKeys: (next: string[]) => void;
  /** Tap on a card outside edit mode — opens the card's tracking surface. */
  onOpenCard: (key: string) => void;
  reduceMotion: boolean;
  language?: AppLanguage;
}

function StatIcon({ icon, size = 20, color }: { icon: HomeStatCardIcon; size?: number; color?: string }) {
  // A parameter default cannot reach a hook; resolve it in the body.
  const theme = useTheme();
  const stroke = color ?? theme.purple;

  switch (icon) {
    case 'scale':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM8 8l4 4M8 8h4"
            stroke={stroke}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'drop':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"
            stroke={stroke}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'tape':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M3 8h18a2 2 0 0 1 0 0v8H3V8zM7 8v4M11 8v4M15 8v4M19 8v4"
            stroke={stroke}
            strokeWidth={2.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" stroke={stroke} strokeWidth={2.1} strokeLinecap="round" />
        </Svg>
      );
  }
}

function Sparkline({ series }: { series: number[] }) {
  const theme = useTheme();

  const styles = useThemedStyles(makeStyles);

  const [width, setWidth] = useState(0);

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;

  /**
   * A sparkline needs a shape to be worth drawing.
   *
   * Two points make one straight line from edge to edge, and any number of
   * identical readings makes a flat one — both read as decoration rather than
   * as a trend, and the second is what "yksi pitkä viiva" was. The strip stays
   * empty until there is a third point and something to see; the value and its
   * delta above already carry the news until then.
   */
  if (series.length < 3 || span === 0) {
    return <View style={styles.sparkArea} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} />;
  }
  const pad = 4;

  const points = series.map((value, index) => {
    const x = series.length === 1 ? 0 : (index / (series.length - 1)) * Math.max(width - pad, 0) + pad / 2;
    const normalized = span === 0 ? 0.5 : (value - min) / span;
    const y = pad / 2 + (1 - normalized) * (SPARK_HEIGHT - pad);
    return { x, y };
  });

  // Neutral accent on purpose — the card reports the numbers and passes no
  // judgement on which direction is "good".
  const stroke = theme.purpleBright;
  const last = points[points.length - 1];

  return (
    <View style={styles.sparkArea} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={SPARK_HEIGHT}>
          <Polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={last.x} cy={last.y} r={2.6} fill={stroke} />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * What a stat card shows inside its frame: label, value, sparkline, recency
 * and trend. One component for Home and for the first-run preview, so the
 * preview cannot drift from the card it promises.
 */
export function StatCardFace({ card, language = 'en' }: { card: HomeStatCard; language?: AppLanguage }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <>
        <Text numberOfLines={1} style={styles.cardLabel}>
          {card.label}
        </Text>
        {card.value !== null ? (
          // The current value alone (user 2026-08-25): the "previous"
          // line under it restated what the sparkline already draws,
          // and the card is for the number that is true today.
          <View style={styles.valueRow}>
            <Text style={styles.valueText}>{formatHomeStatValue(card.value)}</Text>
            <Text style={styles.unitText}>
              {card.unit}
              {card.reps !== null ? ` · ×${card.reps}` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.valueRow}>
            <Text style={styles.noDataText}>{t(language, 'cards.noData')}</Text>
          </View>
        )}
        <Sparkline series={card.series} />
        {/* One honest line of context (design frame 12): when the
            number was true, and where it is heading per week. The
            trend only appears once the window spans a real week —
            see weeklyTrendOf. */}
        {card.recordedAt !== null ? (
          <Text numberOfLines={1} style={styles.cardWhen}>
            {formatHomeStatRecency(card.recordedAt, language)}
            {card.weeklyTrend !== null ? ' · ' : ''}
            {card.weeklyTrend !== null ? (
              <Text style={styles.cardTrend}>{formatHomeStatTrend(card.weeklyTrend, language)}</Text>
            ) : null}
          </Text>
        ) : null}
    </>
  );
}

/** The frame Home draws around a card, for a card that is only shown. */
export function StatCardPreview({ card, language = 'en' }: { card: HomeStatCard; language?: AppLanguage }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.card, { flex: 0 }]} pointerEvents="none">
      <StatCardFace card={card} language={language} />
    </View>
  );
}

/** Only measurements are ever suggested, so this covers every case. */
const SUGGEST_TITLE_KEYS: Record<string, I18nKey> = {
  bodyweight: 'cards.suggest.bodyweight',
  bodyfat: 'cards.suggest.bodyfat',
  shoulders: 'cards.suggest.shoulders',
  chest: 'cards.suggest.chest',
  back: 'cards.suggest.back',
  arms: 'cards.suggest.arms',
  waist: 'cards.suggest.waist',
  hips: 'cards.suggest.hips',
  thighs: 'cards.suggest.thighs',
  calves: 'cards.suggest.calves',
};

export function HomeStatCardsSection({
  catalogCards,
  bottomInset = 0,
  suggestedKeys = [],
  onDismissSuggestion,
  pinnedKeys,
  onChangePinnedKeys,
  onOpenCard,
  reduceMotion,
  language = 'en',
}: HomeStatCardsSectionProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  /** Picked in the add sheet but not committed — the kit bar writes. */
  const [addPicks, setAddPicks] = useState<string[]>([]);
  const closeAddSheet = () => {
    setAddSheetVisible(false);
    setAddPicks([]);
  };

  const cardByKey = useMemo(() => new Map(catalogCards.map((card) => [card.key, card])), [catalogCards]);
  const pinnedCards = pinnedKeys.map((key) => cardByKey.get(key)).filter((card): card is HomeStatCard => Boolean(card));
  const availableCards = catalogCards.filter((card) => !pinnedKeys.includes(card.key));

  // Shared jiggle driver; even and odd cards read it in opposite phase so the
  // grid wobbles organically instead of in lockstep.
  const jiggle = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!editing || reduceMotion) {
      jiggle.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(jiggle, { toValue: 1, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(jiggle, { toValue: 0, duration: 320, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(jiggle, { toValue: 0.5, duration: 160, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [editing, jiggle, reduceMotion]);

  /**
   * One interpolation per card slot, created once and kept.
   *
   * "Interpolate once" was already the rule (rebuilding per render leaks
   * native nodes). The half of it that was missing: one interpolation is also
   * one native node, and `PropsAnimatedNode` holds exactly one
   * `connectedViewTag`. There used to be two nodes here — an even one and an
   * odd one — and with three pinned cards the even node was asked to sit on
   * card 0 and card 2 at the same time, which throws "Animated node N is
   * already attached to a view" and takes the app down.
   *
   * The same defect crashed the plan-build screen on 2026-08-24; this is the
   * other place it was waiting. Keyed by index rather than a fixed array
   * because the pinned list has no compile-time length. Direction still
   * alternates, so the jiggle looks exactly as it did.
   */
  const rotateNodes = useRef(new Map<number, ReturnType<Animated.Value['interpolate']>>()).current;
  const rotateFor = (index: number) => {
    const existing = rotateNodes.get(index);
    if (existing) {
      return existing;
    }
    const node = jiggle.interpolate({
      inputRange: [0, 1],
      outputRange: index % 2 === 0 ? ['-0.55deg', '0.55deg'] : ['0.55deg', '-0.55deg'],
    });
    rotateNodes.set(index, node);
    return node;
  };

  const removeCard = (key: string) => {
    onChangePinnedKeys(pinnedKeys.filter((pinned) => pinned !== key));
  };

  /**
   * All of them, in the order the suggester ranked them (user 2026-08-31).
   *
   * This showed one at a time, on the reasoning that a stack of offers is a
   * to-do list nobody asked for. The reader picked back, glutes, hamstrings
   * and abs in onboarding, saw a single card, and asked why only one of their
   * four answers had been used — which is the more expensive mistake: an
   * offer they never see reads as an answer that was thrown away.
   */
  const suggestions = useMemo(
    () =>
      suggestedKeys
        .filter((candidate) => !pinnedKeys.includes(candidate))
        .map((key) => cardByKey.get(key))
        .filter((card): card is HomeStatCard => card !== undefined),
    [suggestedKeys, pinnedKeys, cardByKey],
  );

  const addCard = (key: string) => {
    onChangePinnedKeys([...pinnedKeys, key]);
  };

  const addSheetSub = (card: HomeStatCard) => {
    if (card.value === null) {
      return t(language, 'cards.noData');
    }
    return `${formatHomeStatValue(card.value)} ${card.unit}`;
  };

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t(language, 'cards.title')}</Text>
        <Pressable hitSlop={8} onPress={() => setEditing((current) => !current)}>
          <Text style={styles.sectionAction}>{editing ? t(language, 'cards.done') : t(language, 'cards.edit')}</Text>
        </Pressable>
      </View>

      {/* An offer, never an action. Onboarding asked which areas the reader
          cares about and what they train for, and then nothing used the
          answer; a Home that pinned cards on its own because of a form filled
          in weeks ago would be unpredictable rather than helpful. */}
      {suggestions.map((suggestion, suggestionIndex) => (
        <View key={suggestion.key} style={styles.suggestCard}>
          {/* Where the suggestion came from, before what it wants (design
              frame 14): a card that opens with its own provenance reads as
              the app remembering, not the app selling. The X is the same
              answer as "Not now" — two doors, one meaning. */}
          <View style={styles.suggestKickerRow}>
            <Text style={styles.suggestKicker} numberOfLines={1}>
              {t(language, 'cards.suggest.from', { label: suggestion.label })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'cards.suggest.no')}
              hitSlop={8}
              onPress={() => onDismissSuggestion?.(suggestion.key)}
              style={({ pressed }) => [styles.suggestX, pressed && { opacity: 0.7 }]}
            >
              <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M6 6l12 12M18 6L6 18"
                  stroke={theme.muted}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          </View>
          <View style={styles.suggestCopy}>
            {/* One sentence per measurement, not one sentence with the label
                dropped in: Finnish inflects, so "{label}" produced
                "Seurataanko Rinta alkunäytöllä?" — a nominative where the
                partitive belongs. */}
            <Text style={styles.suggestTitle}>{t(language, SUGGEST_TITLE_KEYS[suggestion.key])}</Text>
            {/* Sentence first, sample after (user 2026-08-31). The preview sat
                between the title and the sentence explaining it, so the copy
                arrived in two halves either side of a box. */}
            {suggestionIndex === 0 ? (
              <Text style={styles.suggestBody}>
                {t(language, suggestion.value !== null ? 'cards.suggest.body' : 'cards.suggest.bodyEmpty')}
              </Text>
            ) : null}
            {/* The card itself, not a description of it. "Lisää kortti" was a
                promise; this is the sample — including the honest empty state,
                which is the answer to "what would I actually get". */}
            <View style={styles.suggestPreview}>
              <Text numberOfLines={1} style={styles.suggestPreviewLabel}>
                {suggestion.label}
              </Text>
              {suggestion.value !== null ? (
                <View style={styles.suggestPreviewRow}>
                  <Text style={styles.suggestPreviewValue}>{formatHomeStatValue(suggestion.value)}</Text>
                  <Text style={styles.suggestPreviewUnit}>{suggestion.unit}</Text>
                </View>
              ) : (
                <Text style={styles.suggestPreviewEmpty}>{t(language, 'cards.noData')}</Text>
              )}
            </View>
          </View>
          <View style={styles.suggestActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onDismissSuggestion?.(suggestion.key)}
              style={({ pressed }) => [styles.suggestGhost, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.suggestGhostText}>{t(language, 'cards.suggest.no')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                addCard(suggestion.key);
                onDismissSuggestion?.(suggestion.key);
              }}
              style={({ pressed }) => [styles.suggestPrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.suggestPrimaryText}>{t(language, 'cards.suggest.yes')}</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={styles.grid}>
        {pinnedCards.map((card, index) => (
          <Animated.View
            key={card.key}
            style={[
              styles.cardCell,
              editing && !reduceMotion && { transform: [{ rotate: rotateFor(index) }] },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(language, 'cards.a11y.open', { label: card.label })}
              onPress={editing ? undefined : () => onOpenCard(card.key)}
              style={({ pressed }) => [styles.card, pressed && !editing && { opacity: 0.8 }]}
            >
              <StatCardFace card={card} language={language} />
            </Pressable>
            {editing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(language, 'cards.a11y.remove', { label: card.label })}
                onPress={() => removeCard(card.key)}
                hitSlop={8}
                style={styles.removeBadge}
              >
                <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
                </Svg>
              </Pressable>
            ) : null}
          </Animated.View>
        ))}

        <View style={styles.cardCell}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(language, 'cards.addCard')}
            onPress={() => setAddSheetVisible(true)}
            style={({ pressed }) => [styles.addCard, pressed && { borderColor: theme.purpleBright }]}
          >
            <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
              <Path d="M12 5v14M5 12h14" stroke={theme.purpleBright} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
            <Text style={styles.addCardText}>{t(language, 'cards.addCard')}</Text>
          </Pressable>
        </View>
      </View>

      {/* The add sheet on the kit (design frame 13): rows pick, the bar
          counts what you picked, and one button writes them all. The per-row
          plus that added instantly was a write on a tap — the one thing the
          kit exists to prevent. */}
      <KitSheet
        visible={addSheetVisible}
        onClose={closeAddSheet}
        title={t(language, 'cards.addSheet.title')}
        description={t(language, 'cards.addSheet.subtitle')}
        bottomInset={bottomInset}
        closeLabel={t(language, 'common.close')}
        barUp={addPicks.length > 0}
        reduceMotion={reduceMotion}
        bar={
          <KitBar
            visible={addPicks.length > 0}
            from={t(language, 'cards.title')}
            to={
              addPicks.length === 1
                ? t(language, 'cards.addSheet.count.one')
                : t(language, 'cards.addSheet.count', { count: addPicks.length })
            }
            buttons={[
              {
                label: t(language, 'cards.addSheet.confirm'),
                kind: 'p',
                onPress: () => {
                  onChangePinnedKeys([...pinnedKeys, ...addPicks]);
                  closeAddSheet();
                },
              },
            ]}
            clearLabel={t(language, 'cards.addSheet.clear')}
            onClear={() => setAddPicks([])}
            bottomInset={bottomInset}
            reduceMotion={reduceMotion}
          />
        }
      >
        <ScrollView
          style={styles.sheetList}
          contentContainerStyle={styles.sheetListPad}
          showsVerticalScrollIndicator={false}
        >
          {availableCards.length > 0 ? (
            /* Named groups rather than one flat run (user 2026-08-31). Nine
               tape measurements already outnumber everything else put
               together, and a heading is what stops them reading as the whole
               catalogue. Empty groups never appear — see groupHomeStatCards. */
            groupHomeStatCards(availableCards).map((group) => (
              <View key={group.key}>
                <KitGroupLabel>{t(language, group.labelKey)}</KitGroupLabel>
                {group.items.map((card) => (
                  <KitRow
                    key={card.key}
                    title={card.label}
                    meta={addSheetSub(card)}
                    state={addPicks.includes(card.key) ? 'sel' : 'idle'}
                    onPress={() =>
                      setAddPicks((current) =>
                        current.includes(card.key)
                          ? current.filter((key) => key !== card.key)
                          : [...current, card.key],
                      )
                    }
                    accessibilityLabel={t(language, 'cards.a11y.add', { label: card.label })}
                  />
                ))}
              </View>
            ))
          ) : (
            <Text style={styles.sheetEmpty}>{t(language, 'cards.addSheet.empty')}</Text>
          )}
        </ScrollView>
      </KitSheet>
    </View>
  );
}

/**
 * The height every tile in the grid takes.
 *
 * A floor, not a fixed size: the row still grows for a card that needs
 * more, and `flex: 1` then hands that height to everything beside it.
 */
const TILE_MIN_HEIGHT = 124;

const makeStyles = (theme: Theme) => StyleSheet.create({
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  // The section's own heading, at the size the other Home headings use
  // (user 2026-08-31). At 16 it read as a label over the cards rather than a
  // section of the screen.
  sectionTitle: {
    color: theme.ink,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sectionAction: {
    color: theme.highlight,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    // Padding rather than hitSlop alone: the word is the target, so it should
    // look like one.
    paddingVertical: 4,
    paddingLeft: 12,
  },
  suggestCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceSoft,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  suggestKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  suggestKicker: {
    flex: 1,
    fontFamily: 'JetBrainsMono',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: theme.faint,
  },
  suggestX: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestCopy: {
    gap: 8,
  },
  suggestPreview: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 2,
  },
  suggestPreviewLabel: {
    color: theme.faint,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  suggestPreviewRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  suggestPreviewValue: {
    color: theme.ink,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  suggestPreviewUnit: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  suggestPreviewEmpty: {
    color: theme.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  suggestTitle: {
    color: theme.ink,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
  },
  suggestBody: {
    color: theme.muted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
  suggestActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  // Both sized for a thumb (user 2026-08-31). They were 13pt text in nine
  // points of padding, on a card whose whole job is to be answered.
  suggestGhost: {
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestGhostText: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  suggestPrimary: {
    minHeight: 48,
    borderRadius: 14,
    // The kit's colour rule: orange is "anything pressable", and adding the
    // card is the thing to do. Violet is for state.
    backgroundColor: theme.highlight,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestPrimaryText: {
    color: theme.onHighlight,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cardCell: {
    flexBasis: '48%',
    flexGrow: 1,
    maxWidth: '48.6%',
  },
  /**
   * One tile size (user 2026-08-31: "add card ei ole tuplasti pienempi kuin
   * bodyweight").
   *
   * A stat tile sized itself from its content, so a card with a sparkline
   * stood taller than one without and the dashed add tile was shorter than
   * both. `flex: 1` fills the cell, and the cells in a wrapped row already
   * stretch to the tallest — so the row decides one height and everything in
   * it takes it.
   */
  card: {
    flex: 1,
    minHeight: TILE_MIN_HEIGHT,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingTop: 13,
    paddingHorizontal: 14,
    paddingBottom: 11,
    overflow: 'hidden',
  },
  cardLabel: {
    fontFamily: 'JetBrainsMono',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: theme.faint,
  },
  cardWhen: {
    marginTop: 7,
    fontFamily: 'JetBrainsMono',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.faint,
  },
  cardTrend: {
    color: theme.green,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 6,
    marginBottom: 4,
  },
  valueText: {
    color: theme.ink,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unitText: {
    color: theme.muted,
    fontSize: 12.5,
    fontWeight: '800',
  },
  noDataText: {
    color: theme.faint,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 6,
  },
  sparkArea: {
    height: SPARK_HEIGHT,
  },
  removeBadge: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: RED,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    flex: 1,
    minHeight: TILE_MIN_HEIGHT,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#B4A9CC',
    borderRadius: 16,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addCardText: {
    color: theme.purpleBright,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(16,10,32,0.42)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '72%',
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: theme.border,
    marginBottom: 14,
  },
  sheetTitle: {
    color: theme.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 8,
  },
  sheetList: {
    flexGrow: 0,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  sheetRowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  sheetIconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowTitle: {
    color: theme.ink,
    fontSize: 14.5,
    fontWeight: '800',
  },
  sheetRowSub: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  sheetAddButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    // The white-label violet (accessibility audit, 2026-09-21): white on the
    // dark theme's purpleBright is 2.7:1.
    backgroundColor: theme.purpleFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetListPad: { paddingHorizontal: 18, paddingBottom: 6 },
  sheetEmpty: {
    color: theme.faint,
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 26,
  },
  sheetDone: {
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  sheetDoneText: {
    color: theme.purpleBright,
    fontSize: 14.5,
    fontWeight: '800',
  },
});
