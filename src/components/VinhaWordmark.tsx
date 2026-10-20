import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

// Animated is still imported for the deprecated appTagStyle prop type.

import { Theme, useThemedStyles } from '../theming';

/**
 * The Vinha wordmark, in its two brand forms (brand package, 2026-08-19).
 *
 * Short form (default, variant D): "V·in·ha" with the middle syllable in the
 * accent. This is the in-app mark — Home's header, the onboarding title, every
 * place the reader already knows where they are.
 *
 * Full lockup (`fitness`, variant A): "Vinha Fitness" — Vinha in ink at 800,
 * Fitness in orange at 700, one word-space apart, same size. The
 * official name, for the splash, the welcome screen, the store, anything that
 * introduces the app for the first time. Written as one mark so the weight
 * stays on "Vinha" and the two words cannot drift apart or be set in caps.
 *
 * The old transient "app" tag is gone with the rename: "Fitness" now does the
 * job it did — saying which Vinha this is — and it is part of the name, so it
 * stays rather than flying off.
 */
interface VinhaWordmarkProps {
  size?: number;
  /** Full lockup "Vinha Fitness" (brand variant A). Default is the short form. */
  fitness?: boolean;
  /** @deprecated The "app" tag was replaced by the Fitness lockup. Ignored. */
  showAppTag?: boolean;
  /** @deprecated Was the app-tag's animated style. Ignored. */
  appTagStyle?: Animated.WithAnimatedValue<object>;
  /** Overrides for the splash's ghost trails. */
  color?: string;
  accentColor?: string;
  fontFamily?: string;
}

export function VinhaWordmark({
  size = 64,
  fitness = false,
  color,
  accentColor,
  fontFamily,
}: VinhaWordmarkProps) {
  const styles = useThemedStyles(makeStyles);

  // Tracking scales with the mark like everything else here (brand: −0,045 em).
  // Left at a fixed value it would read tighter at 64 and looser at 74, so the
  // lockup would change shape whenever the size changed.
  const type = { fontSize: size, lineHeight: size, letterSpacing: size * -0.045, fontFamily };

  if (fitness) {
    return (
      <View style={styles.row}>
        <Text style={[styles.mark, type, color ? { color } : null]}>
          Vinha
          <Text style={[styles.fitness, accentColor ? { color: accentColor } : null]}> Fitness</Text>
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={[styles.mark, type, color ? { color } : null]}>
        V
        <Text style={[styles.accent, accentColor ? { color: accentColor } : null]}>in</Text>
        ha
      </Text>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    mark: {
      fontWeight: '800',
      color: theme.ink,
    },
    accent: {
      color: theme.purple,
    },
    // Brand: "Fitness" a step lighter than "Vinha" — 700 against 800 — so the
    // name reads as one and the weight stays on Vinha. Orange in both themes
    // and on every screen (user 2026-10-16; light wore the violet before).
    fitness: {
      fontWeight: '700',
      color: theme.orange,
    },
  });
