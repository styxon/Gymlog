import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

import { t } from '../lib/i18n';
import { Theme, useThemedStyles } from '../theming';
import { AppLanguage } from '../types/models';

/**
 * The coach demo moment, asked as a question rather than answered as a card.
 *
 * This started as a row inside the completion screen's list, and on a device
 * that was wrong in a way that is obvious once seen: the reader has to scroll
 * to find it. A moment that happens three times per INSTALL cannot be
 * something you can miss by not scrolling — and it is a decision ("shall I
 * ask this?"), which is what a dialog is for and what a list row is not.
 *
 * Centred rather than a bottom sheet, deliberately. The app's sheets are
 * browsing surfaces you pull up and push down; this is a yes/no that
 * interrupts, and it should read as one.
 *
 * Nothing here spends the moment. Both buttons and the scrim close it; only
 * the send path, two screens later, marks it used — see the chat's
 * onDemoQuestionSent. "Not now" is a real not-now: the offer returns after the
 * next session.
 */
interface CoachDemoSheetProps {
  visible: boolean;
  /** The question, already localized and interpolated. */
  question: string;
  language: AppLanguage;
  onSend: () => void;
  onDismiss: () => void;
  /**
   * Read from the SCREEN, never from inside this component.
   * `useSafeAreaInsets().bottom` returns 0 inside a Modal in this app — all
   * three ways of asking were measured on a device and all three gave zero.
   */
  bottomInset: number;
}

export function CoachDemoSheet({
  visible,
  question,
  language,
  onSend,
  onDismiss,
  bottomInset,
}: CoachDemoSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      enter.setValue(0);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.bezier(0.2, 0.9, 0.3, 1),
      useNativeDriver: true,
    }).start();
  }, [enter, visible]);

  const lift = enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {/* The inset belongs to the FRAME, not to the card. Adding it to the
          card's own padding is the bottom-sheet rule applied to a centred
          dialog, and it just makes the box lopsided — more air under the last
          button than over the first line. Here it keeps a tall dialog off the
          navigation bar, which is what the inset is actually for. */}
      <View style={[styles.root, { paddingBottom: bottomInset }]}>
        {/* Tapping the scrim is the same as "not now" — it costs nothing.
            The same as the skip button below, so a screen reader skips it:
            it was a second, nameless button for one action (accessibility
            audit, 2026-09-21). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessible={false}
          importantForAccessibility="no"
        />

        <Animated.View
          style={[styles.card, { opacity: enter, transform: [{ translateY: lift }] }]}
        >
          <Text style={styles.eyebrow}>{t(language, 'coach.demo.title')}</Text>
          <Text style={styles.question}>{question}</Text>
          <Text style={styles.body}>{t(language, 'coach.demo.body')}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={onSend}
            style={({ pressed }) => [styles.send, pressed && styles.pressed]}
          >
            <Text style={styles.sendText}>{t(language, 'coach.demo.send')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>{t(language, 'coach.demo.skip')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.62)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 22,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      borderRadius: 26,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 22,
      paddingTop: 22,
      paddingBottom: 18,
    },
    eyebrow: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.purple,
      letterSpacing: 0.4,
    },
    question: {
      fontSize: 21,
      fontWeight: '800',
      color: theme.ink,
      lineHeight: 28,
      letterSpacing: -0.4,
      marginTop: 10,
    },
    body: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.muted,
      lineHeight: 20,
      marginTop: 12,
    },
    send: {
      height: 54,
      borderRadius: 999,
      // The white-label violet (accessibility audit, 2026-09-21).
      backgroundColor: theme.purpleFill,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 22,
    },
    sendText: { fontSize: 16.5, fontWeight: '700', color: '#FFFFFF' },
    skip: {
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
    },
    skipText: { fontSize: 15, fontWeight: '600', color: theme.muted },
    pressed: { opacity: 0.85 },
  });
