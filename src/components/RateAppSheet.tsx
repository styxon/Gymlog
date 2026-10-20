import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Svg, { Circle, Path } from 'react-native-svg';

import { t } from '../lib/i18n';
import { PW } from '../lightTheme';
import { Theme, useThemedStyles, useTheme } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The store-rating ask.
 *
 * NOT WIRED YET — nothing in the app opens this. It exists so the decision is
 * made once, on purpose, instead of being improvised the week before launch.
 * `src/lib/ratingPrompt.ts` holds the "when", this holds the "what", and the
 * only thing missing is a caller and a store deep link.
 *
 * Two constraints are baked in and must survive later edits:
 *
 * 1. EVERY star leads to the same CTA. Sending 4–5 stars to the store and 1–3
 *    to a private feedback form is rating gating, and Google Play prohibits it.
 *    `rating` is reported to the caller for analytics, never used to branch.
 * 2. The CTA must deep-link to the Play listing. Google's in-app review API is
 *    not allowed to be preceded by a custom prompt asking for a rating, which
 *    is precisely what this sheet is, so the two cannot be combined.
 *
 * `nudgeBestStar` reproduces what the 100M-download competitor does: the fifth
 * star pre-lit with a bubble pointing at it. It is off by default because it
 * steers a public rating, and turning it on should be somebody's decision
 * rather than a default nobody chose.
 */
interface RateAppSheetProps {
  visible: boolean;
  language: AppLanguage;
  /** Pre-light the fifth star and point a bubble at it. Off by default. */
  nudgeBestStar?: boolean;
  /** Fires with the star count the reader picked. Same action for 1 as for 5. */
  onRate: (rating: number) => void;
  onDismiss: () => void;
}

const STARS = [1, 2, 3, 4, 5];

export function RateAppSheet({ visible, language, nudgeBestStar = false, onRate, onDismiss }: RateAppSheetProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [rating, setRating] = useState(0);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      pop.setValue(0);
      // A reopened sheet must not still be holding the last reader's answer.
      setRating(0);
      return;
    }
    Animated.timing(pop, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [pop, visible]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  // The nudge singles the fifth star OUT without SELECTING it. Filling it in —
  // at all — states a rating the reader never gave, and the state it claims is
  // the exact one being asked for. So no star is ever filled until it is
  // tapped; the fifth is set apart by a halo, a smile and sparkles instead.
  const nudgedStar = nudgeBestStar && rating === 0 ? 5 : null;
  const canSubmit = rating > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.scrim} onPress={onDismiss}>
        <Animated.View style={{ opacity: pop, transform: [{ scale }] }}>
          <Pressable onPress={() => undefined} style={styles.card}>
            <View style={styles.mark}>
              <StarGlyph size={38} filled color={PW.amber} />
            </View>

            <Text style={styles.title}>{t(language, 'rating.title')}</Text>
            <Text style={styles.body}>{t(language, 'rating.body')}</Text>

            {nudgeBestStar ? (
              <View style={styles.hintRow}>
                <View style={styles.hintBubble}>
                  <Text style={styles.hintText}>{t(language, 'rating.hint')}</Text>
                </View>
                <View style={styles.hintTail} />
              </View>
            ) : null}

            <View style={styles.starRow}>
              {STARS.map((star) => {
                const lit = star <= rating;
                const nudged = star === nudgedStar;
                return (
                  <Pressable
                    key={star}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: rating === star }}
                    accessibilityLabel={t(language, 'rating.a11y.star', { count: star })}
                    hitSlop={6}
                    onPress={() => setRating(star)}
                    style={({ pressed }) => [
                      styles.starButton,
                      nudged && styles.starButtonNudged,
                      pressed && styles.pressed,
                    ]}
                  >
                    <StarGlyph
                      size={40}
                      filled={lit}
                      color={lit || nudged ? PW.amber : theme.faint}
                      face={nudged}
                    />
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={() => onRate(rating)}
              style={({ pressed }) => [styles.cta, !canSubmit && styles.ctaDisabled, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>{t(language, 'rating.cta')}</Text>
            </Pressable>

            <Pressable accessibilityRole="button" onPress={onDismiss} hitSlop={8}>
              <Text style={styles.notNow}>{t(language, 'rating.notNow')}</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function StarGlyph({
  size,
  filled,
  color,
  face = false,
}: {
  size: number;
  filled: boolean;
  color: string;
  /** The nudge decoration: a smile inside and sparkles outside. Never a fill. */
  face?: boolean;
}) {
  const d = 'M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05 1.11-6.47-4.7-4.58 6.5-.95z';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={d}
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      {face ? (
        <>
          {/* Eyes and a smile, sized to the star's waist rather than its
              bounding box — the widest clear band is around y = 10–14. */}
          <Circle cx={10} cy={10.6} r={0.95} fill={color} />
          <Circle cx={14} cy={10.6} r={0.95} fill={color} />
          <Path
            d="M9.9 13a2.6 2.6 0 004.2 0"
            stroke={color}
            strokeWidth={1.35}
            strokeLinecap="round"
          />
          {/* Sparkles in the empty corner between the top and right points. */}
          <Path
            d="M20.4 3.1v2.2M19.3 4.2h2.2M22.4 6.6l1.1 1.1"
            stroke={color}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </>
      ) : null}
    </Svg>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(16,10,32,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.surface,
    borderRadius: 26,
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 18,
    alignItems: 'center',
  },
  mark: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.amberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 16,
    fontSize: 22,
    fontWeight: '800',
    color: theme.ink,
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    color: theme.muted,
    textAlign: 'center',
  },
  hintRow: {
    marginTop: 16,
    alignSelf: 'flex-end',
    alignItems: 'center',
    // Sits over the fifth star rather than centred on the card.
    paddingRight: 6,
  },
  hintBubble: {
    backgroundColor: theme.purpleLight,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  hintText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: theme.proInk,
  },
  hintTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: theme.purpleLight,
    marginRight: 12,
    alignSelf: 'flex-end',
  },
  starRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  starButton: {
    padding: 2,
    borderRadius: 24,
  },
  starButtonNudged: {
    backgroundColor: theme.amberSoft,
  },
  pressed: {
    opacity: 0.75,
  },
  cta: {
    marginTop: 22,
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.4,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.onHighlight,
  },
  notNow: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '700',
    color: theme.muted,
    textAlign: 'center',
  },
});
