import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import { Theme, useTheme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';
import { VinhaIcon } from './VinhaIcon';

interface LegalConsentCheckProps {
  language: AppLanguage;
  checked: boolean;
  onToggle: () => void;
  onOpenLegal: (document: 'privacy' | 'terms') => void;
}

/**
 * "Hyväksyn käyttöehdot ja vahvistan lukeneeni tietosuojaselosteen", as a tick
 * box, with the two documents one tap away under it.
 *
 * One component for both places that ask — the last page of onboarding and
 * the sheet over the app — so the sentence a reader agreed to is the same
 * sentence wherever they agreed to it.
 *
 * The links are their own targets beside the box rather than words inside the
 * sentence: a tap meant for the box that opened a document, or a tap meant for
 * a document that ticked the box, would each be the wrong answer to a legal
 * question.
 */
export function LegalConsentCheck({ language, checked, onToggle, onOpenLegal }: LegalConsentCheckProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const label = t(language, 'legal.consent.check');
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={onToggle}
        hitSlop={6}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.box, checked && styles.boxOn]}>
          {checked ? <VinhaIcon name="check" size={15} color="#FFFFFF" /> : null}
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      <View style={styles.links}>
        <Pressable
          accessibilityRole="link"
          onPress={() => onOpenLegal('terms')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.link}>{t(language, 'settings.terms')}</Text>
        </Pressable>
        <Text style={styles.dot}>·</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => onOpenLegal('privacy')}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.link}>{t(language, 'settings.privacy')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    box: {
      width: 26,
      height: 26,
      borderRadius: 7,
      borderWidth: 1.6,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: {
      borderColor: theme.purpleFill,
      backgroundColor: theme.purpleFill,
    },
    label: {
      flex: 1,
      color: theme.ink,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    links: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      // Under the sentence, not under the box.
      marginLeft: 38,
      marginTop: 2,
    },
    link: {
      color: theme.purpleBright,
      fontSize: 13,
      fontWeight: '800',
      // The tap target a 13pt label does not give on its own.
      paddingVertical: 6,
    },
    dot: {
      color: theme.faint,
      fontSize: 13,
    },
    pressed: {
      opacity: 0.7,
    },
  });
