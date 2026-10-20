import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import { Text } from './AppText';
import { AnimatedText } from './AnimatedText';

import { useTheme } from '../theming';

/**
 * The Home greeting, revealed one word at a time.
 *
 * Each word rises and fades in on a short stagger, and any occurrence of
 * "Vinha" gets the brand's purple "AI" treatment — the same three letters the
 * logo colours, so the word reads the same wherever it appears.
 *
 * Words, not letters: a per-letter stagger on a Finnish greeting means thirty
 * animated nodes on every Home mount, and long compounds ("Ensimmäinen") read
 * as a stutter rather than a flourish. Word-level keeps it to a handful of
 * nodes and still lands the effect.
 *
 * Re-runs whenever the text changes, so tomorrow's rotated greeting animates
 * in the same way rather than appearing fully formed.
 */
interface AnimatedGreetingProps {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Colour for the "AI" inside Vinha. */
  accentColor?: string;
  /** Milliseconds between consecutive words. */
  staggerMs?: number;
  /** Set false to render instantly (reduced motion, tests). */
  animate?: boolean;
  /**
   * 'words' staggers each word; 'line' rises the whole string as one node.
   *
   * Use 'line' wherever the text must stay on one line and shrink to fit —
   * `adjustsFontSizeToFit` measures a single Text, so the word-split version
   * would size each word on its own and the line would come out ragged.
   */
  mode?: 'words' | 'line';
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}

const BRAND = 'Vinha';

/** How long a single word takes to arrive, independent of the stagger. */
const WORD_DURATION_MS = 420;

/** "Vinha" → G + AI (accented) + NER, so the logo's colour break survives. */
function renderBrandWord(word: string, accentColor: string, key: string) {
  const at = word.toUpperCase().indexOf(BRAND);
  if (at === -1) {
    return word;
  }

  const before = word.slice(0, at);
  const brand = word.slice(at, at + BRAND.length);
  const after = word.slice(at + BRAND.length);

  return (
    <Text key={key}>
      {before}
      {brand.slice(0, 1)}
      <Text style={{ color: accentColor }}>{brand.slice(1, 3)}</Text>
      {brand.slice(3)}
      {after}
    </Text>
  );
}

export function AnimatedGreeting({
  text,
  style,
  accentColor: accentColorProp,
  staggerMs = 55,
  animate = true,
  mode = 'words',
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
}: AnimatedGreetingProps) {
  const theme = useTheme();
  const accentColor = accentColorProp ?? theme.purpleBright;
  // Split on spaces but keep them, so wrapping and spacing stay natural.
  // 'line' mode is a single unit and animates as one.
  const words = useMemo(
    () => (mode === 'line' ? [text] : text.split(/(\s+)/).filter((part) => part.length > 0)),
    [text, mode],
  );

  /**
   * ONE driver for the whole component, created once and never replaced.
   *
   * The first version allocated an Animated.Value per word and rebuilt the
   * array during render whenever the word count changed. That crashes:
   * "disconnectAnimatedNodeFromView: Animated node with tag [n] does not
   * exist" — React can render more than once per commit, so values were
   * created and thrown away while mounted views still referenced them, and a
   * changing text swapped the whole array under the live native graph.
   *
   * The stagger is interpolation off a single 0→1 driver instead. Words get
   * their offset from their index, no per-word node is ever created or
   * destroyed, and changing the text only restarts the one driver.
   */
  const driver = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      driver.setValue(1);
      return;
    }

    driver.setValue(0);
    const animation = Animated.timing(driver, {
      toValue: 1,
      duration: WORD_DURATION_MS + staggerMs * Math.max(0, words.length - 1),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [text, animate, staggerMs, words.length, driver]);

  /**
   * Interpolations are memoized per (words, stagger), not built during render:
   * Home re-renders every second on the workout tick, and a fresh
   * .interpolate() per render mints new native nodes and orphans the old ones
   * — the exact disconnectAnimatedNodes crash the single driver was added to
   * kill. The driver itself never changes, so restarting the animation on a
   * text change reuses these nodes.
   */
  const revealStyles = useMemo(() => {
    const total = WORD_DURATION_MS + staggerMs * Math.max(0, words.length - 1);
    return words.map((_, index) => {
      const start = (staggerMs * index) / total;
      const rawEnd = Math.min(1, start + WORD_DURATION_MS / total);
      // A zero-width range makes interpolate throw; keep it strictly increasing.
      const end = rawEnd > start ? rawEnd : Math.min(1, start + 0.0001);
      return {
        opacity: driver.interpolate({
          inputRange: [start, end],
          outputRange: [0, 1],
          extrapolate: 'clamp' as const,
        }),
        transform: [
          {
            translateY: driver.interpolate({
              inputRange: [start, end],
              outputRange: [10, 0],
              extrapolate: 'clamp' as const,
            }),
          },
        ],
      };
    });
  }, [driver, staggerMs, words]);

  const revealStyle = (index: number) => revealStyles[index];

  if (mode === 'line') {
    return (
      <AnimatedText
        style={[style, revealStyle(0)]}
        numberOfLines={numberOfLines}
        adjustsFontSizeToFit={adjustsFontSizeToFit}
        minimumFontScale={minimumFontScale}
      >
        {renderBrandWord(text, accentColor, 'line-brand')}
      </AnimatedText>
    );
  }

  return (
    <View style={styles.row}>
      {words.map((word, index) => {
        // Whitespace still needs a node so the stagger indexes line up, but it
        // must not animate on its own or the gaps flicker.
        if (/^\s+$/.test(word)) {
          return (
            <Text key={`space-${index}`} style={style}>
              {word}
            </Text>
          );
        }

        return (
          // Key by position, not by content: a content key remounts every word
          // when the text changes, which tears down live animated nodes.
          <AnimatedText key={`word-${index}`} style={[style, revealStyle(index)]}>
            {renderBrandWord(word, accentColor, `word-${index}-brand`)}
          </AnimatedText>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
});
