import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The permission moment, at the first rest (design: Background Timer, rule 05).
 *
 * The reader has just logged set 1 and the timer is already running behind
 * this sheet. The ask names the exact benefit, and the OS dialog only appears
 * after Allow. It is shown once; "Not now" is remembered, and the app then
 * says plainly at each rest what is off rather than pretending.
 */
interface RestAlertsSheetProps {
  visible: boolean;
  language: AppLanguage;
  /**
   * Safe-area inset, read on the screen that mounts this sheet — inside this
   * Modal, `useSafeAreaInsets` itself always answers 0 (#bugs 2026-08-28).
   */
  bottomInset: number;
  onAllow: () => void;
  onLater: () => void;
}

/** How long a press waits for the sheet's onShow before it counts anyway. */
export const REST_ALERTS_SHOW_FALLBACK_MS = 900;

export function RestAlertsSheet({ visible, language, bottomInset, onAllow, onLater }: RestAlertsSheetProps) {
  const styles = useThemedStyles(makeStyles);
  // Presses count only once the sheet has arrived. It slides up by itself a
  // moment after the tap that logged the set, so a second tap lands on it
  // mid-slide easily, and closing it then is a dismissal iOS drops while the
  // presentation runs: the sheet stayed on screen, closed as far as the app
  // knew, taking every touch (iOS hunt 2026-10-17, X2-1). onShow says it has
  // arrived; the timer covers an onShow that never comes.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), REST_ALERTS_SHOW_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  const allow = () => {
    if (shown) {
      onAllow();
    }
  };
  const later = () => {
    if (shown) {
      onLater();
    }
  };
  // Without this the "Not now" link sits behind the system nav buttons and
  // cannot be pressed at all — the same bug the Pro sheet had.
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={later}
      onShow={() => setShown(true)}
    >
      <View style={styles.veil}>
        <Pressable style={StyleSheet.absoluteFill} onPress={later} accessibilityLabel={t(language, 'rest.perm.later')} />
        <View style={[styles.sheet, { paddingBottom: bottomInset + 24 }]}>
          <View style={styles.grip} />
          <Text style={styles.title}>{t(language, 'rest.perm.title')}</Text>
          <Text style={styles.body}>{t(language, 'rest.perm.body')}</Text>
          <View style={styles.bullets}>
            {/* No "never marketing" line (#bugs 2026-10-17): it answered a
                worry the two lines above had not raised. */}
            {/* The end time on the lock screen is Android's ongoing card;
                iOS has none (iOS hunt 2026-10-17, S6-4). */}
            {(['rest.perm.b1', Platform.OS === 'ios' ? 'rest.perm.b2Ios' : 'rest.perm.b2'] as const).map((key) => (
              <View key={key} style={styles.bullet}>
                <View style={styles.dot} />
                <Text style={styles.bulletText}>{t(language, key)}</Text>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={allow}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.ctaText}>{t(language, 'rest.perm.allow')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={later} style={styles.ghost} hitSlop={8}>
            <Text style={styles.ghostText}>{t(language, 'rest.perm.later')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    veil: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,10,32,0.42)' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      paddingTop: 22,
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    grip: { width: 44, height: 5, borderRadius: 999, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 },
    title: { fontSize: 23, fontWeight: '800', letterSpacing: -0.5, color: theme.ink },
    body: { fontSize: 14.5, fontWeight: '600', color: theme.muted, marginTop: 8, lineHeight: 21 },
    bullets: { gap: 11, marginTop: 18, marginBottom: 20 },
    bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: theme.purple, marginTop: 7 },
    bulletText: { flex: 1, fontSize: 14, fontWeight: '700', color: theme.ink, lineHeight: 20 },
    cta: {
      height: 52,
      borderRadius: 16,
      // Orange, as every primary button in the app (user 2026-10-17).
      backgroundColor: theme.orange,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { fontSize: 15.5, fontWeight: '800', color: theme.onHighlight },
    ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    ghostText: { fontSize: 15, fontWeight: '800', color: theme.muted },
  });
