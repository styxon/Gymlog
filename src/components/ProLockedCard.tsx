import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { BlurredPreview } from './BlurredPreview';
import { ProLockIcon, ProPill } from './ProLockMarks';

export { ProLockIcon, ProPill } from './ProLockMarks';

/**
 * The single locked pattern used at every paywall moment (pw-shared.jsx):
 * the app states the finding in plain text, then blurs ONLY the conclusion.
 *
 * The blurred lines are the REAL conclusion computed from the user's own log
 * (src/lib/proInsights.ts) — never a generic feature list.
 *
 * The blur is BlurredPreview's, which is a true gaussian via react-native-svg.
 * This card used to do its own: transparent ink plus a text shadow, under a
 * scrim. That was the best RN could do when the card was written, and it was
 * already known to be weak — BlurredPreview's own notes say why. Android's text
 * shadow is a mask filter rather than a gaussian, so the glyph shapes survive
 * it and short lines stay legible.
 *
 * Reported from the phone: the recommendation was readable through it. Which is
 * the worst possible failure for this card — it is the whole product being given
 * away by the screen that is supposed to be selling it.
 */
interface ProLockedCardProps {
  language: AppLanguage;
  /** Short plain-text finding line on the lock. */
  teaser: string;
  /** The real conclusion, shown blurred. */
  body: string;
  /** CTA label; defaults to "See the recommendation". */
  cta?: string;
  compact?: boolean;
  /**
   * Height of the blurred block. Three lines by default — enough for the shape
   * of an answer to read as an answer, and a fixed height so the card does not
   * change size with the length of a conclusion nobody can read anyway.
   */
  previewHeight?: number;
  onPress: () => void;
}

export function ProLockedCard({
  language,
  teaser,
  body,
  cta,
  compact,
  previewHeight = 60,
  onPress,
}: ProLockedCardProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={teaser}
      onPress={onPress}
      style={({ pressed }) => [styles.card, compact && styles.cardCompact, pressed && styles.pressed]}
    >
      <View style={styles.headRow}>
        <ProLockIcon />
        <Text style={styles.teaser} numberOfLines={2}>
          {teaser}
        </Text>
        <ProPill />
      </View>
      <View style={styles.hiddenBlock}>
        <BlurredPreview
          content={{ kind: 'text', text: body, fontSize: 13.5, lineHeight: 20 }}
          height={previewHeight}
        />
      </View>
      <Text style={styles.cta}>{cta ?? t(language, 'pro.locked.cta')} →</Text>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.purpleLight,
    borderWidth: 1.5,
    borderColor: theme.purple,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  cardCompact: {
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  pressed: {
    opacity: 0.85,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  teaser: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: theme.proInk,
  },
  hiddenBlock: {
    marginTop: 9,
  },
  cta: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '800',
    color: theme.purple,
  },
});
